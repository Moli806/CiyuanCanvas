import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(name, dependencies, globals = {}) {
    const source = readFileSync(new URL(`../${name}.ts`, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const context = { exports: {}, require: (key) => dependencies[key], Blob, URL, AbortController, DOMException, crypto: webcrypto, ...globals };
    vm.runInNewContext(code, context);
    return context.exports;
}

const cloudPath = `/canvas-assets/${"a".repeat(32)}.png`;
const localBytes = new Blob(["local-original"], { type: "image/png" });
const serverBytes = new Blob(["server-original"], { type: "image/png" });
const savedAt = "2026-11-24T10:00:00.000Z";

function harness({ save, flush } = {}) {
    const dav = new Map();
    const logs = new Map();
    const local = new Map([["image:local", localBytes]]);
    const uploaded = [];
    const savedProjects = [];
    let flushCount = 0;
    let serverAvailable = true;
    const remoteReads = [];
    const listeners = new Set();
    let userId = 12;
    const i18n = { t: (key, options) => (options?.title ? `${options.title} (backup)` : key) };
    const project = {
        id: "original",
        title: "Original",
        createdAt: savedAt,
        updatedAt: savedAt,
        cloud: { revision: 41, updatedAt: savedAt },
        nodes: [
            { id: "photo", type: "image", position: { x: 5, y: 1 }, metadata: { content: cloudPath, model: "outside::approved", baseUrl: "PRIVATE-ENDPOINT", apiKey: "PRIVATE-KEY" } },
            { id: "local", type: "image", position: { x: 0, y: 0 }, metadata: { storageKey: "image:local", content: "blob:expired" } },
            { id: "external", type: "video", position: { x: 0, y: 0 }, metadata: { content: "https://private.example/video?token=PRIVATE-TOKEN", videoTaskProvider: "gemini", videoTaskId: "PRIVATE-TASK" } },
        ],
        connections: [],
        chatSessions: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
    const canvasState = { projects: [project], deletedProjects: [{ id: "deleted", deletedAt: savedAt }] };
    const assetState = {
        assets: [{ id: "asset", kind: "image", title: "Photo", data: { dataUrl: cloudPath }, coverUrl: cloudPath, metadata: { token: "PRIVATE-ASSET" } }],
        replaceAssets(assets) {
            this.assets = assets;
        },
    };
    const persist = { hasHydrated: () => true };
    const settings = { encodeChannelModel: (channel, model) => `${channel}::${model}`, modelOptionName: (name) => name.split("::").at(-1) };
    const storage = (name) => {
        if (!logs.has(name)) logs.set(name, new Map());
        const entries = logs.get(name);
        return {
            iterate: async (cb) => {
                for (const value of entries.values()) cb(value);
            },
            keys: async () => [...entries.keys()],
            getItem: async (id) => entries.get(id),
            setItem: async (key, value) => entries.set(key, value),
        };
    };
    const readBlob = async (key) => local.get(key);
    const writeBlob = async (key, blob) => local.set(key, blob);
    const davApi = {
        downloadWebdavFile: async (_, path) => dav.get(path) ?? null,
        uploadWebdavFile: async (_, path, blob) => dav.set(path, blob),
        webdavFileHasSize: async (_, path, size) => dav.get(path)?.size === size,
    };
    const module = load(
        "app-sync",
        {
            localforage: { createInstance: ({ storeName }) => storage(storeName) },
            "@/i18n": i18n,
            "@/stores/canvas/use-canvas-store": {
                useCanvasStore: { getState: () => canvasState, setState: (patch) => Object.assign(canvasState, patch), persist },
                flushPendingCanvasPersist: async () => {
                    flushCount++;
                    await flush?.();
                },
            },
            "@/stores/use-asset-store": { useAssetStore: { getState: () => assetState, persist } },
            "@/stores/use-ciyuan-store": {
                useCiyuanStore: {
                    getState: () => ({ user: { id: userId }, status: "ready", models: [{ id: "approved" }] }),
                    subscribe: (cb) => {
                        listeners.add(cb);
                        return () => listeners.delete(cb);
                    },
                },
            },
            "@/lib/canvas/canvas-preset-workflow": { PRESET_ASSETS: {} },
            "@/services/canvas-backup-data": load("canvas-backup-data", { "@/stores/use-config-store": settings }),
            "@/services/canvas-project-sync": { pullAndMergeCanvasProjects: async () => {} },
            "@/services/file-storage": { getMediaBlob: readBlob, setMediaBlob: writeBlob },
            "@/services/image-storage": { getImageBlob: readBlob, setImageBlob: writeBlob },
            "@/services/image-attempts": { trackBackupLocalWrite: (promise) => promise },
            "@/services/ciyuan": {
                uploadCanvasAsset: async (blob) => {
                    uploaded.push(await blob.text());
                    return `/canvas-assets/${String(uploaded.length).padStart(32, "0")}.png`;
                },
                saveServerCanvasProject: async (id, data, signal, revision) => {
                    assert.equal(revision, 0);
                    savedProjects.push(id);
                    await save?.();
                    return { revision: 1 };
                },
            },
            "@/services/webdav-sync": davApi,
        },
        {
            localStorage: { getItem: () => String(userId) },
            window: { location: new URL("https://ciyuanweb.cn"), addEventListener() {}, removeEventListener() {} },
            fetch: async (url, options) => {
                remoteReads.push(url);
                if (url.startsWith("blob:")) throw new TypeError("Expired");
                assert.equal(url, cloudPath);
                assert.equal(options.credentials, "omit");
                return serverAvailable ? new Response(serverBytes) : new Response(null, { status: 404 });
            },
        },
    );
    const imageStore = logs.get("image_generation_logs");
    imageStore.set("history", { id: "history", createdAt: 12, config: { apiKey: "PRIVATE-HISTORY", imageModel: "outside::approved" }, images: [{ id: "image", dataUrl: "", serverUrl: cloudPath }] });
    imageStore.set("ongoing", { id: "ongoing", createdAt: 13, status: "pending", requestIds: ["PRIVATE-TASK"] });
    return {
        ...module,
        dav,
        davApi,
        local,
        uploaded,
        remoteReads,
        canvasState,
        assetState,
        imageStore,
        savedProjects,
        get flushCount() {
            return flushCount;
        },
        expireOriginals() {
            serverAvailable = false;
            local.clear();
        },
        changeOwner(id) {
            userId = id;
            listeners.forEach((cb) => cb({ status: "ready", user: { id } }));
        },
        manifest: async () => JSON.parse(await dav.get("ciyuan/12/manifest.json").text()),
        writeManifest: (value) => dav.set("ciyuan/12/manifest.json", new Blob([JSON.stringify(value)])),
    };
}

test("backs up real local and server bytes, then restores copies, safe model choices and reusable local media", async () => {
    const fixture = harness();
    const summary = await fixture.backupAppDataToWebdav({});
    assert.equal(summary.files, 2);
    assert.equal(summary.missingFiles, 1);
    assert.equal(
        fixture.remoteReads.every((path) => path === cloudPath),
        true,
    );
    const manifest = await fixture.manifest();
    assert.doesNotMatch(JSON.stringify(manifest), /PRIVATE|private\.example|videoTaskId|revision|deletedProjects|blob:expired/);
    assert.equal(manifest.data.projects[0].nodes[0].metadata.model, "ciyuan::approved");
    assert.equal(manifest.data.imageLogs[0].status, "success");
    assert.equal(manifest.data.imageLogs.length, 1);
    const binary = [...fixture.dav].filter(([path]) => path.includes("/files/"));
    assert.deepEqual((await Promise.all(binary.map(([, blob]) => blob.text()))).sort(), ["local-original", "server-original"]);
    fixture.local.clear();
    fixture.assetState.assets = [];
    fixture.imageStore.clear();
    const original = { ...fixture.canvasState.projects[0], updatedAt: "newer", title: "Still editing" };
    fixture.canvasState.projects = [original];
    const result = await fixture.restoreAppDataFromWebdav({});
    assert.equal(result.projects, 1);
    assert.equal(result.assets, 1);
    assert.equal(result.imageLogs, 1);
    assert.deepEqual(fixture.uploaded.sort(), ["local-original", "server-original"]);
    const [copy, retained] = fixture.canvasState.projects;
    assert.equal(retained, original);
    assert.equal(retained.cloud.revision, 41);
    assert.equal(copy.cloud.revision, 1);
    assert.deepEqual(fixture.savedProjects, [copy.id]);
    assert.equal(fixture.flushCount, 1);
    assert.notEqual(copy.id, original.id);
    const media = copy.nodes[1].metadata;
    assert.match(media.content, /^\/canvas-assets\//);
    assert.equal(await fixture.local.get(media.storageKey).text(), "local-original");
    const second = await fixture.restoreAppDataFromWebdav({});
    assert.deepEqual([second.projects, second.assets, second.imageLogs, second.files], [0, 0, 0, 0]);
    assert.equal(fixture.canvasState.deletedProjects.length, 1);
    fixture.dav.delete(binary[0][0]);
    await fixture.backupAppDataToWebdav({});
    assert.ok(fixture.dav.has(binary[0][0]));
});

test("a deliberately deleted restore copy can be recovered again without reviving its tombstone", async () => {
    const fixture = harness();
    await fixture.backupAppDataToWebdav({});
    await fixture.restoreAppDataFromWebdav({});
    const firstCopy = fixture.canvasState.projects.shift();
    fixture.canvasState.deletedProjects.push({ id: firstCopy.id, deletedAt: savedAt });
    const again = await fixture.restoreAppDataFromWebdav({});
    assert.equal(again.projects, 1);
    assert.notEqual(fixture.canvasState.projects[0].id, firstCopy.id);
    assert.equal(fixture.canvasState.deletedProjects.at(-1).id, firstCopy.id);
    assert.equal((await fixture.restoreAppDataFromWebdav({})).projects, 0);
});

test("restore resolves only after both the server and the browser have saved the copied project", async () => {
    function deferred() {
        let resolve;
        const promise = new Promise((finish) => { resolve = finish; });
        return { promise, resolve };
    }
    const saving = deferred();
    const saved = deferred();
    const flushing = deferred();
    const flushed = deferred();
    const fixture = harness({
        save: () => { saving.resolve(); return saved.promise; },
        flush: () => { flushing.resolve(); return flushed.promise; },
    });
    await fixture.backupAppDataToWebdav({});
    let finished = false;
    const restore = fixture.restoreAppDataFromWebdav({}).then(() => { finished = true; });
    await saving.promise;
    assert.equal(fixture.canvasState.projects.length, 1);
    saved.resolve();
    await flushing.promise;
    assert.equal(finished, false);
    flushed.resolve();
    await restore;
    assert.equal(fixture.canvasState.projects.length, 2);
});

test("a later backup recovers expired originals from the preceding archive and keeps its last good manifest on corruption", async () => {
    const fixture = harness();
    const original = await fixture.backupAppDataToWebdav({});
    fixture.expireOriginals();
    const second = await fixture.backupAppDataToWebdav({});
    assert.equal(second.files, original.files);
    assert.equal(second.missingFiles, original.missingFiles);
    const lastGood = fixture.dav.get("ciyuan/12/manifest.json");
    const hash = Object.keys((await fixture.manifest()).files)[0];
    fixture.dav.delete(`ciyuan/12/files/${hash}`);
    await assert.rejects(fixture.backupAppDataToWebdav({}), /missingMedia/);
    assert.equal(fixture.dav.get("ciyuan/12/manifest.json"), lastGood);
});

test("rejects legacy, foreign-owner and damaged archives before creating local projects", async () => {
    const fixture = harness();
    fixture.dav.set("canvas/manifest.json", new Blob(["legacy"]));
    await assert.rejects(fixture.restoreAppDataFromWebdav({}), /noBackup/);
    await fixture.backupAppDataToWebdav({});
    const manifest = await fixture.manifest();
    fixture.writeManifest({ ...manifest, ownerId: 13 });
    await assert.rejects(fixture.restoreAppDataFromWebdav({}), /wrongOwner/);
    fixture.writeManifest({ ...manifest, version: 3 });
    await assert.rejects(fixture.restoreAppDataFromWebdav({}), /invalid/);
    fixture.writeManifest(manifest);
    const hash = Object.keys(manifest.files)[0];
    fixture.dav.set(`ciyuan/12/files/${hash}`, new Blob(["x".repeat(manifest.files[hash].bytes)]));
    await assert.rejects(fixture.restoreAppDataFromWebdav({}), /missingMedia/);
    assert.equal(fixture.canvasState.projects.length, 1);
    assert.equal(fixture.uploaded.length, 0);
});

test("switching accounts during a delayed WebDAV file download prevents upload and data application", async () => {
    const fixture = harness();
    await fixture.backupAppDataToWebdav({});
    const previous = fixture.davApi.downloadWebdavFile;
    fixture.davApi.downloadWebdavFile = async (config, path, signal) => {
        if (path.includes("/files/")) {
            fixture.changeOwner(13);
            assert.equal(signal.aborted, true);
        }
        return previous(config, path, signal);
    };
    await assert.rejects(fixture.restoreAppDataFromWebdav({}), { name: "AbortError" });
    assert.deepEqual(fixture.uploaded, []);
    assert.equal(fixture.canvasState.projects.length, 1);
    await assert.rejects(fixture.restoreAppDataFromWebdav({}), /noBackup/);
});
