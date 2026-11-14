import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { create } from "zustand";
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
            "@/services/ciyuan": api,
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
    return { store: module.useCiyuanStore, bootstrap, clear, clears: () => clears, records };
}

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
