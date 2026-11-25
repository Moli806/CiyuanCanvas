import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AxiosHeaders } from "axios";

const root = new URL("../../", import.meta.url);
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
const turn = () => new Promise(setImmediate);
class CanvasProjectDeletedError extends Error {}
class CanvasProjectConflictError extends Error {}

function load(path, dependencies = {}, globals = {}) {
    const code = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const context = {
        exports: {},
        require: (name) => dependencies[name] ?? {},
        AbortController,
        AbortSignal,
        DOMException,
        Headers,
        Response,
        URL,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        console,
        ...globals,
    };
    vm.runInNewContext(code, context, { filename: path });
    return context.exports;
}

function syncHarness(api, store) {
    const timers = [];
    const module = load(
        "services/canvas-project-sync.ts",
        {
            "@/services/ciyuan": { CiyuanCanvasProjectDeletedError: CanvasProjectDeletedError, CiyuanCanvasProjectConflictError: CanvasProjectConflictError, ...api },
            "@/i18n": { t: (_, { title }) => `${title} (local conflict copy)` },
            nanoid: { nanoid: () => "local-conflict-copy" },
            "@/stores/canvas/use-canvas-store": { useCanvasStore: store },
        },
        {
            setTimeout: (callback) => {
                timers.push(callback);
                return timers.length;
            },
            clearTimeout: () => {},
        },
    );
    return { ...module, start: () => timers.shift()() };
}

test("logout aborts an active upload and prevents the remaining old-account uploads", async () => {
    const pending = deferred();
    const writes = [];
    const sync = syncHarness({
        saveServerCanvasProject: async (id, project, signal) => {
            writes.push({ id, signal });
            await pending.promise;
        },
    });
    sync.scheduleCanvasSync(
        [
            { id: "A-first", updatedAt: "1" },
            { id: "A-second", updatedAt: "1" },
        ],
        [],
    );
    sync.start();
    sync.resetCanvasSyncState();
    pending.resolve();
    await turn();
    assert.deepEqual(
        writes.map((row) => row.id),
        ["A-first"],
    );
    assert.equal(writes[0].signal.aborted, true);
});

test("an old-account download completing after reset cannot restore cleared projects", async () => {
    const pending = deferred();
    const entered = deferred();
    let state = { hydrated: true, projects: [], deletedProjects: [] };
    const store = {
        getState: () => state,
        setState: (patch) => {
            state = { ...state, ...patch };
        },
    };
    const sync = syncHarness(
        {
            fetchServerCanvasProjects: async () => ({ projects: [{ id: "A-private", updated_at: 2 }] }),
            getServerCanvasProject: async () => {
                entered.resolve();
                return pending.promise;
            },
        },
        store,
    );
    const pull = sync.pullAndMergeCanvasProjects();
    await entered.promise;
    sync.resetCanvasSyncState();
    pending.resolve({ data: { id: "A-private", updatedAt: "2026-01-01T00:00:00Z" } });
    assert.equal(await pull, 0);
    assert.equal(state.projects.length, 0);
});

test("a new account can sync while an aborted old upload is still finishing", async () => {
    const pending = deferred();
    const writes = [];
    const sync = syncHarness({
        saveServerCanvasProject: async (id) => {
            writes.push(id);
            if (id === "A-first") await pending.promise;
        },
    });
    sync.scheduleCanvasSync([{ id: "A-first", updatedAt: "1" }], []);
    sync.start();
    sync.resetCanvasSyncState();
    sync.scheduleCanvasSync([{ id: "B-first", updatedAt: "1" }], []);
    sync.start();
    await turn();
    assert.deepEqual(writes, ["A-first", "B-first"]);
    pending.resolve();
    await turn();
});

test("cloud deletion beats a newer cached copy while a local-only project still uploads", async () => {
    const deleted = { id: "deleted-project", updatedAt: "2026-11-20T10:00:00Z" };
    const local = { id: "local-only", updatedAt: "2026-11-20T10:00:00Z" };
    const state = { hydrated: true, projects: [deleted, local], deletedProjects: [] };
    const writes = [];
    const sync = syncHarness(
        {
            fetchServerCanvasProjects: async () => ({ projects: [], deleted_projects: [{ id: deleted.id, deleted_at: 1 }] }),
            deleteServerCanvasProject: async (id) => writes.push(`DELETE ${id}`),
            saveServerCanvasProject: async (id) => writes.push(`PUT ${id}`),
        },
        { getState: () => state, setState: (patch) => Object.assign(state, patch) },
    );
    await sync.pullAndMergeCanvasProjects();
    assert.deepEqual(Array.from(state.projects), [local]);
    assert.deepEqual(Array.from(state.deletedProjects, ({ id }) => id), [deleted.id]);
    sync.start();
    await turn();
    assert.deepEqual(writes, ["PUT local-only"]);
});

test("a delete conflict clears the stale project even when a newer upload is queued", async () => {
    const pending = deferred();
    const stale = { id: "deleted-project", updatedAt: "2026-11-20T10:00:00Z" };
    const edited = { ...stale, updatedAt: "2026-11-20T10:01:00Z" };
    const state = { hydrated: true, projects: [stale], deletedProjects: [] };
    const writes = [];
    const sync = syncHarness(
        {
            saveServerCanvasProject: async (id) => {
                writes.push(id);
                await pending.promise;
                throw new CanvasProjectDeletedError();
            },
        },
        { getState: () => state, setState: (patch) => Object.assign(state, patch) },
    );
    sync.scheduleCanvasSync([stale], []);
    sync.start();
    state.projects = [edited];
    sync.scheduleCanvasSync([edited], []);
    pending.resolve();
    await turn();
    assert.deepEqual(writes, [stale.id]);
    assert.equal(state.projects.length, 0);
    assert.deepEqual(Array.from(state.deletedProjects, ({ id }) => id), [stale.id]);
});

test("an interrupted download leaves the newer cloud project untouched and resumes on visibility", async () => {
    const local = { id: "project", title: "draft", updatedAt: "2026-01-01T01:00:00Z" };
    const cloud = { ...local, title: "newer", updatedAt: "2026-01-01T02:00:00Z" };
    const state = { hydrated: true, projects: [local], deletedProjects: [] };
    let interrupted = true;
    const writes = [];
    const sync = syncHarness({
        fetchServerCanvasProjects: async () => ({ projects: [{ id: local.id, revision: 2 }] }),
        getServerCanvasProject: async () => {
            if (interrupted) throw Error("offline");
            return { revision: 2, data: cloud };
        },
        saveServerCanvasProject: async (id) => writes.push(id),
    }, { getState: () => state, setState: (patch) => Object.assign(state, patch) });
    await sync.pullAndMergeCanvasProjects();
    sync.scheduleCanvasSync(state.projects, []);
    sync.start();
    await turn();
    assert.deepEqual(writes, []);
    interrupted = false;
    await sync.pullAndMergeCanvasProjects({ deletionsOnly: true });
    assert.equal(state.projects[0].title, cloud.title);
    assert.equal(state.projects[0].cloud.revision, 2);
});

test("concurrent device edits keep a local conflict copy and the server version", async () => {
    const local = { id: "project", title: "my edit", updatedAt: "2026-01-01T03:00:00Z", cloud: { revision: 1, updatedAt: "2026-01-01T01:00:00Z" } };
    const remote = { id: local.id, title: "other edit", updatedAt: "2026-01-01T02:00:00Z" };
    const state = { hydrated: true, projects: [local], deletedProjects: [] };
    const writes = [];
    const sync = syncHarness({
        saveServerCanvasProject: async (id, _data, _signal, revision) => {
            writes.push([id, revision]);
            if (id === local.id) throw new CanvasProjectConflictError();
        },
        fetchServerCanvasProjects: async () => ({ projects: [{ id: local.id, revision: 2 }] }),
        getServerCanvasProject: async () => ({ revision: 2, data: remote }),
    }, { getState: () => state, setState: (patch) => Object.assign(state, patch) });
    sync.scheduleCanvasSync(state.projects, []);
    sync.start();
    await turn();
    await sync.pullAndMergeCanvasProjects({ deletionsOnly: true });
    sync.start();
    await turn();
    assert.deepEqual(writes, [[local.id, 1], ["local-conflict-copy", 0]]);
    assert.equal(state.projects[0].title, remote.title);
    assert.equal(state.projects[1].title, "my edit (local conflict copy)");
});

test("a versioned browser merges a newer project from a rolled-back server", async () => {
    const initial = "2026-01-01T01:00:00Z";
    const state = { hydrated: true, projects: [{ id: "project", title: "before", updatedAt: initial, cloud: { revision: 5, updatedAt: initial } }], deletedProjects: [] };
    const latest = { id: "project", title: "after", updatedAt: "2026-01-01T02:00:00Z" };
    const sync = syncHarness({
        fetchServerCanvasProjects: async () => ({ projects: [{ id: latest.id }] }),
        getServerCanvasProject: async () => ({ data: latest }),
    }, { getState: () => state, setState: (patch) => Object.assign(state, patch) });
    await sync.pullAndMergeCanvasProjects();
    assert.equal(state.projects[0].title, latest.title);
    assert.equal(state.projects.length, 1);
});

test("model requests use the official catalog and session even with imported channel preferences", () => {
    const origin = "https://canvas.example";
    const api = load("stores/use-config-store.ts", {
        zustand: { create }, "zustand/middleware": { persist: (initializer) => initializer }, "@/i18n": { t: (key) => key },
    }, { window: { location: { origin } } });
    const model = { name: "test-image", capability: "image", script: "legacy script" };
    const old = { id: "old", name: "Old", baseUrl: "https://old.example", apiKey: "old-key", apiFormat: "openai", models: [model] };
    const config = { ...api.defaultConfig, proxyEnabled: true, channels: [old, { ...old, id: "ciyuan", apiFormat: "ciyuan" }] };
    api.useConfigStore.setState({ config });
    const resolved = api.resolveModelRequestConfig(config, "ciyuan::test-image");
    assert.equal(resolved.baseUrl, origin);
    assert.equal(resolved.apiFormat, "ciyuan");
    assert.equal(resolved.apiKey, "");
    assert.equal(api.buildApiUrl(resolved.baseUrl, "/images/generations"), "/v1/images/generations");
    assert.equal(api.resolveModelScript(config, "ciyuan::test-image"), "");
    assert.throws(() => api.resolveModelRequestConfig(config, "old::test-image"), /officialModelRequired/);
    assert.throws(() => api.resolveModelRequestConfig(config, "ciyuan::removed"), /officialModelRequired/);
});

test("video retrieval resumes the paid task after a network interruption and distinguishes a terminal failure", async () => {
    const task = { id: "original-task", provider: "ciyuan", model: "video" };
    const config = { baseUrl: "https://example.test", apiFormat: "ciyuan", model: "video" };
    const queried = [];
    const outcomes = [new Error("connection interrupted"), { status: "completed", result: { url: "original-video" } }, { status: "failed", error: "provider declined" }];
    const api = load("services/api/video.ts", {
        "@/stores/use-config-store": { resolveModelRequestConfig: (config) => config },
        "@/services/ciyuan": {
            pollCiyuanVideoTask: async (original) => {
                queried.push(original.id);
                const next = outcomes.shift();
                if (next instanceof Error) throw next;
                return next;
            },
        },
    });
    await assert.rejects(api.waitForVideoGenerationTask(config, task), (error) => !api.isVideoTaskFailed(error));
    assert.equal((await api.waitForVideoGenerationTask(config, task)).url, "original-video");
    await assert.rejects(api.waitForVideoGenerationTask(config, task), api.isVideoTaskFailed);
    assert.deepEqual(queried, [task.id, task.id, task.id]);
});

test("restoring the official template uses a fresh ID and keeps its original deletion", () => {
    const original = "preset-rooftop-chase-v1";
    const prefix = "preset-restored-";
    const { useCanvasStore } = load(
        "stores/canvas/use-canvas-store.ts",
        {
            zustand: { create },
            "zustand/middleware": { persist },
            nanoid: { nanoid: () => "test-new-id" },
            "@/lib/localforage-storage": { localForageStorage: { getItem: async () => null } },
            "@/lib/canvas/canvas-preset-workflow": {
                PRESET_WORKFLOW_PROJECT_ID: original,
                RESTORED_PRESET_PROJECT_PREFIX: prefix,
                isDefaultPresetProjectId: (id) => id === original || id.startsWith(prefix),
                createPresetWorkflowProject: (id) => ({ id }),
            },
        },
        { setTimeout: () => 1, clearTimeout: () => {} },
    );
    const tombstone = { id: original, deletedAt: "2026-11-20T10:00:00Z" };
    useCanvasStore.setState({ deletedProjects: [tombstone] });
    useCanvasStore.getState().replaceProjects([{ id: original }]);
    useCanvasStore.getState().ensureDefaultPresetProject();
    assert.equal(useCanvasStore.getState().projects.length, 0);
    const restored = useCanvasStore.getState().createPresetProject();
    assert.equal(restored, `${prefix}test-new-id`);
    assert.equal(useCanvasStore.getState().createPresetProject(), restored);
    assert.deepEqual(Array.from(useCanvasStore.getState().deletedProjects), [tombstone]);
});

test("a token refresh that finishes after logout cannot authenticate an old request", async () => {
    const pending = deferred();
    const paths = [];
    const session = load(
        "services/ciyuan.ts",
        {},
        {
            fetch: async (path) => {
                paths.push(path);
                if (path === "/api/user/auth/refresh") return pending.promise;
                if (path === "/api/user/auth/logout") return new Response("{}");
                return Response.json({ success: true, data: { user: { id: 1 } } });
            },
        },
    );
    const request = session.fetchCiyuanBootstrap();
    const rejected = assert.rejects(request, { name: "AbortError" });
    await session.logoutCiyuan();
    pending.resolve(Response.json({ success: true, data: { access_token: "audit-fake-token", access_expires_at: 9999999999 } }));
    await rejected;
    assert.equal(paths.includes("/api/canvas/bootstrap"), false);
});

function accountHarness(owner) {
    let state;
    const records = new Map(owner ? [["ciyuan-canvas-owner", owner]] : []);
    const config = { config: { channels: [], model: "", imageModel: "", videoModel: "", textModel: "" } };
    const bootstrap = deferred();
    const clear = deferred();
    let clears = 0;
    const dependencies = {
        zustand: { create },
        "@/stores/use-config-store": {
            useConfigStore: { getState: () => config, setState: (patch) => Object.assign(config, patch) },
            createModelChannel: (value) => value,
            encodeChannelModel: (_, model) => model,
            modelOptionName: (model) => model,
            modelOptionsFromChannels: () => [],
        },
        "@/services/ciyuan": {
            fetchCiyuanBootstrap: () => bootstrap.promise,
            setCiyuanCatalog: () => {},
            resetCiyuanSession: () => {},
            logoutCiyuan: async () => {},
            CiyuanUnauthorizedError: class extends Error {},
        },
        "@/services/canvas-project-sync": { resetCanvasSyncState: () => {} },
        "@/services/image-attempts": {
            clearCanvasLocalData: async () => {
                clears++;
                await clear.promise;
            },
        },
    };
    const module = load("stores/use-ciyuan-store.ts", dependencies, {
        window: { location: { origin: "https://ciyuan.invalid" } },
        localStorage: { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: (key) => records.delete(key) },
    });
    return { store: module.useCiyuanStore, config, bootstrap, clear, clears: () => clears, records };
}

test("an empty catalog clears the last configured model and keeps the signed-in account ready", async () => {
    const account = accountHarness("1");
    account.config.config.videoModel = "old-video";
    account.config.config.model = "old-video";
    const refresh = account.store.getState().refresh(true);
    account.bootstrap.resolve({ user: { id: 1 }, models: [], defaults: { video: "old-video" } });
    await refresh;
    assert.equal(account.store.getState().status, "ready");
    assert.equal(account.config.config.videoModel, "");
    assert.equal(account.config.config.model, "");
    assert.equal(account.config.config.channels[0].models.length, 0);
});

test("switching to another account clears the previous cache before making the new account ready", async () => {
    const h = accountHarness("1");
    h.store.setState({ status: "ready", user: { id: 1 } });
    const refresh = h.store.getState().refresh(true);
    h.bootstrap.resolve({ user: { id: 2 }, models: [], defaults: {}, quota_per_unit: 500000 });
    await turn();
    assert.equal(h.clears(), 1);
    assert.notEqual(h.store.getState().status, "ready");
    h.clear.resolve();
    await refresh;
    assert.equal(h.store.getState().user.id, 2);
    assert.equal(h.store.getState().status, "ready");
    assert.equal(h.records.get("ciyuan-canvas-owner"), "2");
});

test("logout discards a bootstrap response that was already in flight", async () => {
    const h = accountHarness("1");
    const refresh = h.store.getState().refresh();
    const logout = h.store.getState().logout();
    h.clear.resolve();
    await logout;
    h.bootstrap.resolve({ user: { id: 1 }, models: [], defaults: {}, quota_per_unit: 500000 });
    await refresh;
    assert.equal(h.store.getState().status, "unauthenticated");
    assert.equal(h.store.getState().user, null);
});

test("refreshing the same account keeps its cached projects", async () => {
    const h = accountHarness("1");
    h.store.setState({ status: "ready", user: { id: 1 } });
    const refresh = h.store.getState().refresh(true);
    h.bootstrap.resolve({ user: { id: 1 }, models: [], defaults: {}, quota_per_unit: 500000 });
    await refresh;
    assert.equal(h.clears(), 0);
    assert.equal(h.store.getState().status, "ready");
});

test("unowned browser cache is cleared before binding it to the signed-in account", async () => {
    const h = accountHarness();
    const refresh = h.store.getState().refresh();
    h.bootstrap.resolve({ user: { id: 2 }, models: [], defaults: {}, quota_per_unit: 500000 });
    await turn();
    assert.equal(h.clears(), 1);
    h.clear.resolve();
    await refresh;
    assert.equal(h.records.get("ciyuan-canvas-owner"), "2");
});

test("an image recovery finishing after logout cannot restore the previous account's assets", async () => {
    const pending = deferred();
    const entered = deferred();
    const assets = [];
    const persist = { hasHydrated: () => true, getOptions: () => ({ name: "fake-state" }) };
    const assetStore = {
        getState: () => ({
            addAsset: (asset) => assets.push(asset),
            replaceAssets: () => {
                assets.length = 0;
            },
        }),
        persist,
    };
    const recovery = load(
        "services/image-attempts.ts",
        {
            "@/lib/localforage-storage": { localForageStorage: { removeItem: async () => {} } },
            localforage: {
                createInstance: () => ({
                    iterate: async (callback) => callback({ id: "A-image", owner: "auto", createdAt: Date.now() }),
                    clear: async () => {},
                    removeItem: async () => {},
                }),
            },
            "@/services/ciyuan": {
                fetchCanvasImageResult: async () => {
                    entered.resolve();
                    return pending.promise;
                },
            },
            "@/stores/use-asset-store": { useAssetStore: assetStore },
            "@/stores/canvas/use-canvas-store": { useCanvasStore: { setState: () => {}, persist }, cancelPendingCanvasPersist: () => {} },
            "@/services/canvas-project-sync": { resetCanvasSyncState: () => {} },
        },
        { localStorage: { removeItem: () => {} } },
    );
    const result = recovery.resumeImageAttempts();
    await entered.promise;
    await recovery.clearCanvasLocalData();
    pending.resolve({ status: "completed", assets: [{ name: "private.png", url: "/canvas-assets/private.png" }] });
    assert.equal(await result, 0);
    assert.equal(assets.length, 0);
});

test("refreshing credentials for a different account cannot resend an old project's write", async () => {
    let refreshes = 0;
    const writes = [];
    const session = load(
        "services/ciyuan.ts",
        {},
        {
            fetch: async (path, init) => {
                if (path === "/api/user/auth/refresh") {
                    refreshes++;
                    return Response.json({
                        success: true,
                        data: {
                            access_token: refreshes === 1 ? "fake-A" : "fake-B",
                            access_expires_at: 9999999999,
                            user: { id: refreshes === 1 ? 1 : 2 },
                        },
                    });
                }
                if (path === "/api/canvas/bootstrap") return Response.json({ success: true, data: { user: { id: 1 } } });
                writes.push(init.headers.get("Authorization"));
                return new Response("{}", { status: 401 });
            },
        },
    );
    await session.fetchCiyuanBootstrap();
    await assert.rejects(session.ciyuanSessionFetch("/api/canvas/projects/A-project", { method: "PUT" }), { name: "CiyuanUnauthorizedError" });
    await assert.rejects(session.ciyuanSessionFetch("/api/canvas/projects/A-other", { method: "PUT" }), { name: "CiyuanUnauthorizedError" });
    assert.deepEqual(writes, ["Bearer fake-A"]);
});

test("a late same-origin Axios response cannot restore data or retry after logout", async () => {
    const pending = deferred();
    const entered = deferred();
    let refreshes = 0;
    const session = load(
        "services/ciyuan.ts",
        {
            axios: {
                __esModule: true,
                AxiosHeaders,
                default: {
                    request: async () => {
                        entered.resolve();
                        return pending.promise;
                    },
                    isAxiosError: () => false,
                },
            },
        },
        {
            window: { location: { origin: "https://ciyuan.invalid" } },
            fetch: async (path) => {
                if (path === "/api/user/auth/refresh") {
                    refreshes++;
                    return Response.json({ success: true, data: { access_token: "fake-A", access_expires_at: 9999999999, user: { id: 1 } } });
                }
                return new Response("{}");
            },
        },
    );
    const request = session.ciyuanAxios({ url: "/v1/images/generations" });
    const rejected = assert.rejects(request, { name: "AbortError" });
    await entered.promise;
    await session.logoutCiyuan();
    pending.resolve({ data: { privateImage: true } });
    await rejected;
    assert.equal(refreshes, 1);
});

test("clearing account data waits for persisted state removal and removes fallback keys", async () => {
    const pending = deferred();
    const entered = deferred();
    const removed = [];
    const persist = { hasHydrated: () => true, getOptions: () => ({ name: "account-state" }) };
    const recovery = load(
        "services/image-attempts.ts",
        {
            localforage: { createInstance: () => ({ clear: async () => {} }) },
            "@/lib/localforage-storage": {
                localForageStorage: {
                    removeItem: async () => {
                        entered.resolve();
                        await pending.promise;
                    },
                },
            },
            "@/stores/use-asset-store": { useAssetStore: { getState: () => ({ replaceAssets: () => {} }), persist } },
            "@/stores/canvas/use-canvas-store": { useCanvasStore: { setState: () => {}, persist }, cancelPendingCanvasPersist: () => {} },
            "@/services/canvas-project-sync": { resetCanvasSyncState: () => {} },
        },
        { localStorage: { removeItem: (key) => removed.push(key) } },
    );
    let completed = false;
    const clearing = recovery.clearCanvasLocalData().then(() => {
        completed = true;
    });
    await entered.promise;
    assert.equal(completed, false);
    assert.equal(removed.length, 2);
    pending.resolve();
    await clearing;
    assert.equal(completed, true);
});

test("workbench handoff resolves inline URL params, long localStorage payloads, and matches catalog models", () => {
    const handoffMod = load("lib/workbench-handoff.ts", {
        "@/stores/use-config-store": {
            modelOptionName: (value) => (value.includes("::") ? value.split("::")[1] : value),
        },
    });

    const inline = handoffMod.resolveWorkbenchHandoff({
        search: "?model=gpt-image-2.5-sunburst&prompt=%E6%9F%94%E5%85%89%E4%BA%BA%E5%83%8F&keep=1",
        capability: "image",
    });
    assert.deepEqual({ ...inline }, {
        model: "gpt-image-2.5-sunburst",
        prompt: "柔光人像",
        cleanedSearch: "keep=1",
    });

    const storeData = new Map([
        [
            handoffMod.SHOWCASE_CANVAS_HANDOFF_STORAGE_KEY,
            JSON.stringify({
                deadbeef: {
                    capability: "video",
                    model: "Seedance-2.5-720p",
                    prompt: "超长电影级镜头提示词".repeat(120),
                    createdAt: 1000,
                },
                expired1: {
                    capability: "video",
                    model: "Seedance-2.0-720p",
                    prompt: "过期条目",
                    createdAt: 1,
                },
            }),
        ],
    ]);
    const storage = {
        getItem: (key) => storeData.get(key) ?? null,
        setItem: (key, val) => storeData.set(key, val),
    };
    const stashed = handoffMod.resolveWorkbenchHandoff({
        search: "?model=Seedance-2.5-720p&handoff=deadbeef",
        capability: "video",
        storage,
        now: 1000 + 30 * 60 * 1000 - 500,
    });
    assert.equal(stashed.model, "Seedance-2.5-720p");
    assert.equal(stashed.prompt, "超长电影级镜头提示词".repeat(120));
    assert.equal(stashed.cleanedSearch, "");
    assert.equal(JSON.parse(storeData.get(handoffMod.SHOWCASE_CANVAS_HANDOFF_STORAGE_KEY)).expired1, undefined);

    const options = ["ciyuan::gpt-image-2.5-sunburst", "ciyuan::Seedance-2.5-720p", "ciyuan::banana-2.1"];
    assert.equal(handoffMod.matchWorkbenchModelOption("Seedance-2.5-720p", options), "ciyuan::Seedance-2.5-720p");
    assert.equal(handoffMod.matchWorkbenchModelOption("seedance-2.5-720p", options), "ciyuan::Seedance-2.5-720p");
    assert.equal(handoffMod.matchWorkbenchModelOption("non-existent-model", options), null);
});

test("uploadCanvasAsset marks generated media with source=generated while keeping reference uploads unmarked", async () => {
    const forms = [];
    const mod = load(
        "services/ciyuan.ts",
        {},
        {
            Blob,
            FormData,
            window: { location: { origin: "https://ciyuanweb.cn" } },
            fetch: async (path, init) => {
                if (path === "/api/user/auth/refresh") {
                    return Response.json({ success: true, data: { access_token: "test-token", access_expires_at: 9999999999 } });
                }
                if (path === "/api/canvas/assets") {
                    forms.push(init.body);
                    return Response.json({ success: true, data: { path: "/canvas-assets/0123456789abcdef0123456789abcdef.jpg" } });
                }
                throw new Error(`unexpected path: ${path}`);
            },
        },
    );

    const sample = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    const refUrl = await mod.uploadCanvasAsset(sample, "ref.png");
    const genUrl = await mod.uploadCanvasAsset(sample, "banana.png", undefined, "generated");
    assert.equal(refUrl, "https://ciyuanweb.cn/canvas-assets/0123456789abcdef0123456789abcdef.jpg");
    assert.equal(genUrl, "https://ciyuanweb.cn/canvas-assets/0123456789abcdef0123456789abcdef.jpg");
    assert.equal(forms[0].get("source"), null);
    assert.equal(forms[1].get("source"), "generated");
});

test("requestCiyuanChatQuestion buffers and parses SSE when WebView response.body lacks getReader()", async () => {
    const rawSse = [
        'data: {"choices":[{"delta":{"content":"柔光霓虹雨夜，"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"蓝鲸少女抬头望向浮空岛"}}]}',
        "",
        "data: [DONE]",
        "",
    ].join("\n");

    const deltas = [];
    const mod = load(
        "services/ciyuan.ts",
        {},
        {
            window: { location: { origin: "https://ciyuanweb.cn" } },
            fetch: async (path) => {
                if (path === "/api/user/auth/refresh") {
                    return Response.json({ success: true, data: { access_token: "test-token", access_expires_at: 9999999999 } });
                }
                if (path === "https://ciyuanweb.cn/pg/chat/completions") {
                    return {
                        ok: true,
                        status: 200,
                        headers: new Headers({ "content-type": "text/event-stream; charset=utf-8" }),
                        body: null,
                        text: async () => rawSse,
                    };
                }
                throw new Error(`unexpected path: ${path}`);
            },
        },
    );

    const answer = await mod.requestCiyuanChatQuestion(
        { baseUrl: "https://ciyuanweb.cn/v1", model: "deepseek-v4.1-flash" },
        [{ role: "user", content: "反推这张图提示词" }],
        (partial) => deltas.push(partial),
    );
    assert.equal(answer, "柔光霓虹雨夜，蓝鲸少女抬头望向浮空岛");
    assert.deepEqual(deltas, ["柔光霓虹雨夜，", "柔光霓虹雨夜，蓝鲸少女抬头望向浮空岛"]);
});

test("motion transfer validates both references before upload and uses exact source seconds without a resolution", async () => {
    const requests = [];
    const uploads = [];
    const session = load("services/ciyuan.ts", {
        axios: { __esModule: true, AxiosHeaders, default: { request: async (config) => { requests.push(config); return { data: { task_id: "fixture-task" } }; } } },
        "@/lib/media-size": { inferVideoRatio: () => "auto" },
        "@/services/image-storage": { imageToDataUrl: async () => "data:image/png;base64,AA==" },
        "@/services/file-storage": { getMediaBlob: async () => new Blob(["fixture"], { type: "video/mp4" }) },
    }, {
        window: { location: { origin: "https://canvas.invalid" } }, Blob, FormData,
        fetch: async (url, init) => {
            if (url === "/api/user/auth/refresh") return Response.json({ success: true, data: { access_token: "fixture", access_expires_at: 9999999999 } });
            if (url.startsWith("data:")) return new Response(new Blob(["fixture"], { type: "image/png" }));
            assert.equal(url, "/api/canvas/assets");
            const name = init.body.get("file").name;
            uploads.push(name);
            return Response.json({ success: true, data: { path: `/canvas-assets/${name}` } });
        },
    });
    const model = "Wan-2.2-plus";
    session.setCiyuanCatalog([{ id: model, transport: "media-task", capability: "video", video: { min_images: 1, max_images: 1, min_videos: 1, max_videos: 1, max_audios: 0, min_seconds: 1, max_seconds: 15, source_video_duration: true, prompt_optional: true, frames: false, resolutions: [], default_resolution: "" } }]);
    const video = { storageKey: "motion", durationMs: 3750 };
    const create = (images, videos) => session.createCiyuanVideoTask({ videoMode: "reference", videoSeconds: "8", vquality: "1080" }, model, "", images, { videos });
    await assert.rejects(create([], [video]), /参考图/);
    await assert.rejects(create([{}], []), /参考视频/);
    await assert.rejects(create([{}, {}], [video]), /参考图/);
    await assert.rejects(create([{}], [{ ...video, durationMs: 15001 }]), /时长/);
    assert.equal(uploads.length, 0);
    assert.equal((await create([{}], [video])).id, "fixture-task");
    assert.equal(requests[0].url, "/v1/media/generate");
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0].data)), { model, prompt: "", params: { duration: 3.75, images: ["https://canvas.invalid/canvas-assets/ref.png"], video_url: ["https://canvas.invalid/canvas-assets/ref.mp4"] } });
});

test("new media-task video submits only its prompt and a pending spec never submits", async () => {
    const requests = [];
    const media = load("services/ciyuan.ts", { axios: { __esModule: true, AxiosHeaders, default: { request: async (request) => { requests.push(request); return { data: { task_id: "mock" } }; } } } }, {
        window: { location: { origin: "https://canvas.invalid" } },
        fetch: async () => Response.json({ success: true, data: { access_token: "fixture", access_expires_at: 9999999999 } }),
    });
    const model = "future-video";
    const entry = { id: model, capability: "video", transport: "media-task", video: { max_images: 0, max_videos: 0, max_audios: 0, prompt_only: true } };
    media.setCiyuanCatalog([entry]);
    const config = { videoSeconds: "12", vquality: "1080", size: "16:9" };
    await media.createCiyuanVideoTask(config, model, "camera pans", []);
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0].data)), { model, prompt: "camera pans" });
    media.setCiyuanCatalog([{ ...entry, video: { ...entry.video, spec_required: true } }]);
    await assert.rejects(media.createCiyuanVideoTask(config, model, "camera pans", []), /待补充画布规格/);
    assert.equal(requests.length, 1);
});

test("new image models use the declared transport and omit unsupported request parameters", async () => {
    const posts = [];
    let transport = "openai-image";
    const config = { apiFormat: "ciyuan", model: "studio-example", systemPrompt: "", count: "9", quality: "high", size: "1024x1024", background: "transparent" };
    const image = load("services/api/image.ts", {
        "@/services/ciyuan": {
            getCiyuanModel: () => ({ image: { max_count: 1, supports_edit: false } }), imageTransport: () => transport,
            ciyuanAxios: async (request) => { posts.push(request); return { data: { data: [{ url: "/fixture.png" }] } }; },
            requestCiyuanMediaImages: async (current) => { posts.push({ media: current.model }); return []; },
        },
        "@/stores/use-config-store": { resolveModelRequestConfig: (current) => current, resolveModelScript: () => "", buildApiUrl: (_, url) => `/v1${url}` },
        "@/services/image-attempts": { resolveAttemptAssets: async () => [], finishImageAttempt: async () => {} },
        "@/i18n": { t: (key) => key }, nanoid: { nanoid: () => "fixture" },
    });
    await image.requestGeneration(config, "studio", { requestId: "fixture" });
    assert.equal(posts[0].url, "/v1/images/generations");
    assert.deepEqual({ ...posts[0].data }, { model: "studio-example", prompt: "studio" });
    await assert.rejects(image.requestEdit(config, "studio", [{}]), /imageEditUnavailable/);
    transport = "media-task";
    await image.requestGeneration(config, "studio");
    assert.deepEqual(posts[1], { media: "studio-example" });
});

test("ciyuanSessionFetch refuses WHATWG backslash and tab cross-origin URLs", async () => {
    const seen = [];
    const mod = load(
        "services/ciyuan.ts",
        {},
        {
            window: { location: { origin: "https://ciyuanweb.cn" } },
            fetch: async (path, init = {}) => {
                seen.push({ path, auth: new Headers(init.headers).get("Authorization"), credentials: init.credentials });
                if (path === "/api/user/auth/refresh") {
                    return Response.json({ success: true, data: { access_token: "secret-session-token", access_expires_at: 9999999999 } });
                }
                return Response.json({ ok: true });
            },
        },
    );

    await mod.ciyuanSessionFetch("/\\evil.example/pg/chat/completions");
    await mod.ciyuanSessionFetch("/\t/evil.example/pg/chat/completions");
    await mod.ciyuanSessionFetch("/api/canvas/projects");

    assert.equal(seen[0].auth, null);
    assert.equal(seen[0].credentials, "omit");
    assert.equal(seen[1].auth, null);
    assert.equal(seen[1].credentials, "omit");
    const projectCall = seen.find((item) => item.path === "/api/canvas/projects");
    assert.equal(projectCall.auth, "Bearer secret-session-token");
    assert.equal(projectCall.credentials, "include");
});
