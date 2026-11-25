import localforage from "localforage";

import i18n from "@/i18n";
import { PRESET_ASSETS } from "@/lib/canvas/canvas-preset-workflow";
import { projectBackupData, type BackupData, type BackupLog } from "@/services/canvas-backup-data";
import { pullAndMergeCanvasProjects } from "@/services/canvas-project-sync";
import { saveServerCanvasProject, uploadCanvasAsset } from "@/services/ciyuan";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { trackBackupLocalWrite } from "@/services/image-attempts";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import { downloadWebdavFile, uploadWebdavFile, webdavFileHasSize } from "@/services/webdav-sync";
import { flushPendingCanvasPersist, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCiyuanStore } from "@/stores/use-ciyuan-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";

export type AppSyncProgressEvent = { stage: string; current?: number; total?: number };
type Progress = (event: AppSyncProgressEvent) => void;
type BackupFile = { mime: string; bytes: number };
type Manifest = { app: "ciyuan-canvas"; version: 2; ownerId: number; syncedAt: string; data: BackupData; files: Record<string, BackupFile>; sources?: Record<string, string>; missingFiles: number };
type Session = { ownerId: number; path: string; signal: AbortSignal; catalog: Set<string>; check: () => void };
type Source = { url: string; storageKey: string; fallback: string };

const imageLogs = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogs = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const ownerKey = "ciyuan-canvas-owner";
const serverMedia = /^\/canvas-assets\/[a-f0-9]{32}\.(png|jpg|webp|gif|mp4|webm|mov|mp3|wav|m4a|ogg)$/;
const localKey = /^(image|video|audio|file|video-reference|audio-reference):[\w-]+$/;
const digestPattern = /^[a-f0-9]{64}$/;
const presetPaths = new Set<string>(Object.values(PRESET_ASSETS).map(({ url }) => url));
const mimeExtensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/ogg": "ogg",
};
const backupText = (key: string) => i18n.t(`config.webdav.backupData.${key}`);
const failure = (key: string) => new Error(backupText(key));

async function withSession<T>(outerSignal: AbortSignal | undefined, action: (session: Session) => Promise<T>) {
    const state = useCiyuanStore.getState();
    const ownerId = state.user?.id;
    if (!ownerId || state.status !== "ready" || localStorage.getItem(ownerKey) !== String(ownerId)) throw failure("sessionChanged");
    const controller = new AbortController();
    const cancel = () => controller.abort(new DOMException(backupText("sessionChanged"), "AbortError"));
    const check = () => {
        if (outerSignal?.aborted || useCiyuanStore.getState().user?.id !== ownerId || useCiyuanStore.getState().status !== "ready" || localStorage.getItem(ownerKey) !== String(ownerId)) cancel();
        controller.signal.throwIfAborted();
    };
    const unsubscribe = useCiyuanStore.subscribe((next) => {
        if (next.user?.id !== ownerId || next.status !== "ready") cancel();
    });
    const ownerChanged = (event: StorageEvent) => {
        if ((!event.key || event.key === ownerKey) && localStorage.getItem(ownerKey) !== String(ownerId)) cancel();
    };
    window.addEventListener("storage", ownerChanged);
    outerSignal?.addEventListener("abort", cancel, { once: true });
    try {
        check();
        await Promise.all([useCanvasStore.persist.hasHydrated() || useCanvasStore.persist.rehydrate(), useAssetStore.persist.hasHydrated() || useAssetStore.persist.rehydrate()]);
        check();
        return await action({ ownerId, path: `ciyuan/${ownerId}`, signal: controller.signal, catalog: new Set(state.models.map(({ id }) => id)), check });
    } finally {
        unsubscribe();
        window.removeEventListener("storage", ownerChanged);
        outerSignal?.removeEventListener("abort", cancel);
    }
}

async function digest(blob: Blob) {
    const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sitePath(value: string) {
    if (!value) return "";
    try {
        const url = new URL(value, window.location.origin);
        const ciyuan = ["ciyuanweb.cn", "www.ciyuanweb.cn"];
        if (url.origin !== window.location.origin && !(ciyuan.includes(window.location.hostname) && ciyuan.includes(url.hostname) && url.protocol === "https:" && !url.port)) return "";
        return url.pathname;
    } catch {
        return "";
    }
}

async function sourceBlob(source: Source, signal: AbortSignal) {
    let blob = localKey.test(source.storageKey) ? await (source.storageKey.startsWith("image:") ? getImageBlob(source.storageKey) : getMediaBlob(source.storageKey)) : null;
    for (const candidate of [source.url, source.fallback]) {
        if (blob?.size) break;
        const path = sitePath(candidate);
        const url = serverMedia.test(path) ? path : /^(data:(image|video|audio)\/|blob:)/i.test(candidate) ? candidate : "";
        if (!url) continue;
        signal.throwIfAborted();
        const response = await fetch(url, { credentials: "omit", redirect: "error", signal }).catch((error) => {
            if (signal.aborted || serverMedia.test(path)) throw error;
            return null;
        });
        if (!response || response.status === 404 || response.status === 410) continue;
        if (!response.ok) throw failure("missingMedia");
        blob = await response.blob();
    }
    if (!blob?.size) return null;
    const extension = [source.url, source.fallback]
        .map(sitePath)
        .map((path) => path.match(serverMedia)?.[1])
        .find(Boolean);
    const type = blob.type.toLowerCase().split(";")[0];
    const mime = Object.hasOwn(mimeExtensions, type) ? type : (!type || type === "application/octet-stream") && Object.keys(mimeExtensions).find((key) => mimeExtensions[key] === extension);
    return mime ? blob.slice(0, blob.size, mime) : null;
}

async function readLogs(store: typeof imageLogs) {
    const records: BackupLog[] = [];
    await store.iterate<BackupLog, void>((item) => {
        if (item?.id) records.push(item);
    });
    return records;
}

async function readManifest(config: WebdavSyncConfig, session: Session) {
    const file = await downloadWebdavFile(config, `${session.path}/manifest.json`, session.signal);
    session.check();
    if (!file) return null;
    let manifest: Manifest;
    try {
        manifest = JSON.parse(await file.text());
    } catch {
        throw failure("invalid");
    }
    if (manifest?.app !== "ciyuan-canvas" || manifest.version !== 2) throw failure("invalid");
    if (manifest.ownerId !== session.ownerId) throw failure("wrongOwner");
    if (!manifest.data || ![manifest.data.projects, manifest.data.assets, manifest.data.imageLogs, manifest.data.videoLogs].every(Array.isArray) || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files))
        throw failure("invalid");
    if (Object.values(manifest.data).some((items) => !Array.isArray(items) || items.some((item) => !item || typeof item.id !== "string" || !item.id))) throw failure("invalid");
    if (manifest.data.projects.some((item) => typeof item.title !== "string" || typeof item.updatedAt !== "string" || !item.updatedAt || !Array.isArray(item.nodes) || !Array.isArray(item.connections))) throw failure("invalid");
    for (const [hash, record] of Object.entries(manifest.files)) {
        if (!digestPattern.test(hash) || !record || !Object.hasOwn(mimeExtensions, record.mime) || !Number.isSafeInteger(record.bytes) || record.bytes <= 0) throw failure("invalid");
    }
    return manifest;
}

function result(data: BackupData, files: number, missingFiles: number) {
    return { syncedAt: new Date().toISOString(), projects: data.projects.length, assets: data.assets.length, imageLogs: data.imageLogs.length, videoLogs: data.videoLogs.length, files, missingFiles };
}

export function backupAppDataToWebdav(config: WebdavSyncConfig, onProgress?: Progress, signal?: AbortSignal) {
    return withSession(signal, async (session) => {
        onProgress?.({ stage: backupText("preparing") });
        await pullAndMergeCanvasProjects({ requireComplete: true });
        session.check();
        const previous = await readManifest(config, session);
        const [storedImageLogs, storedVideoLogs] = await Promise.all([readLogs(imageLogs), readLogs(videoLogs)]);
        session.check();
        const local = { projects: useCanvasStore.getState().projects, assets: useAssetStore.getState().assets, imageLogs: storedImageLogs, videoLogs: storedVideoLogs };
        const sources = new Map<string, string>();
        const slots: Source[] = [];
        const draft = projectBackupData(
            local,
            (url, storageKey, fallback) => {
                const path = sitePath(url);
                if (presetPaths.has(path)) return path;
                if (!url && !storageKey && !fallback) return "";
                const sourceKey = storageKey || url || fallback;
                let slot = sources.get(sourceKey);
                if (!slot) {
                    slot = `slot:${slots.length}`;
                    sources.set(sourceKey, slot);
                    slots.push({ url, storageKey, fallback });
                }
                return slot;
            },
            session.catalog,
        );
        const resolved = new Map<string, string>();
        const files: Manifest["files"] = {};
        const sourceHashes: Record<string, string> = {};
        let missingFiles = 0;
        for (const [index, source] of slots.entries()) {
            session.check();
            onProgress?.({ stage: backupText("media"), current: index + 1, total: slots.length });
            const aliases = new Set([...(localKey.test(source.storageKey) ? [source.storageKey] : []), ...[source.url, source.fallback].map(sitePath).filter((path) => serverMedia.test(path))]);
            const fingerprints = await Promise.all([...aliases].map((alias) => digest(new Blob([alias]))));
            const blob = await sourceBlob(source, session.signal);
            session.check();
            let hash: string;
            if (blob) {
                hash = await digest(blob);
                if (!files[hash]) {
                    const path = `${session.path}/files/${hash}`;
                    const available = previous?.files[hash] && (await webdavFileHasSize(config, path, blob.size, session.signal));
                    if (!available) await uploadWebdavFile(config, path, blob, blob.type, session.signal);
                }
                files[hash] = { mime: blob.type, bytes: blob.size };
            } else {
                const saved = fingerprints.map((fingerprint) => previous?.sources?.[fingerprint]).find((value) => value && digestPattern.test(value) && previous?.files[value]);
                if (!saved || !previous) {
                    missingFiles++;
                    continue;
                }
                hash = saved;
                const record = previous.files[hash];
                const archived = await downloadWebdavFile(config, `${session.path}/files/${hash}`, session.signal);
                if (!archived || archived.size !== record.bytes || (await digest(archived)) !== hash) throw failure("missingMedia");
                files[hash] = record;
            }
            for (const fingerprint of fingerprints) sourceHashes[fingerprint] = hash;
            resolved.set(`slot:${index}`, `media:${hash}`);
        }
        const data = projectBackupData(draft, (url) => (presetPaths.has(url) ? url : resolved.get(url) || ""), session.catalog);
        const summary = result(data, Object.keys(files).length, missingFiles);
        const manifest: Manifest = { app: "ciyuan-canvas", version: 2, ownerId: session.ownerId, syncedAt: summary.syncedAt, data, files, sources: sourceHashes, missingFiles };
        const body = new Blob([JSON.stringify(manifest)], { type: "application/json" });
        session.check();
        onProgress?.({ stage: backupText("writing") });
        await uploadWebdavFile(config, `${session.path}/snapshots/${await digest(body)}.json`, body, body.type, session.signal);
        session.check();
        await uploadWebdavFile(config, `${session.path}/manifest.json`, body, body.type, session.signal);
        session.check();
        return summary;
    });
}

async function restoreLogs(store: typeof imageLogs, logs: BackupLog[], session: Session) {
    let added = 0;
    for (const log of logs) {
        if (await store.getItem(log.id)) continue;
        session.check();
        await trackBackupLocalWrite(store.setItem(log.id, log));
        added++;
    }
    return added;
}

export function restoreAppDataFromWebdav(config: WebdavSyncConfig, onProgress?: Progress, signal?: AbortSignal) {
    return withSession(signal, async (session) => {
        onProgress?.({ stage: backupText("preparing") });
        const manifest = await readManifest(config, session);
        if (!manifest) throw failure("noBackup");
        await pullAndMergeCanvasProjects({ requireComplete: true });
        session.check();
        const current = useCanvasStore.getState();
        const live = new Set(current.projects.map(({ id }) => id));
        const deleted = new Map(current.deletedProjects.map(({ id, deletedAt }) => [id, deletedAt]));
        const copyId = async (fields: string[]) => `wd-copy-${(await digest(new Blob([JSON.stringify(fields)]))).slice(0, 40)}`;
        const copies = await Promise.all(
            manifest.data.projects.map(async (project) => {
                const previouslyRestored = /^wd-copy-[a-f0-9]{40}$/.test(project.id);
                let id = previouslyRestored ? project.id : await copyId([project.id, project.updatedAt]);
                while (deleted.has(id)) id = await copyId([id, deleted.get(id)!]);
                const title = previouslyRestored ? project.title : i18n.t("config.webdav.backupData.restoredProject", { title: project.title }).slice(0, 200);
                return { ...project, id, title };
            }),
        );
        const assetIds = new Set(useAssetStore.getState().assets.map(({ id }) => id));
        const [imageIds, videoIds] = await Promise.all([imageLogs.keys(), videoLogs.keys()]);
        const savedImageIds = new Set(imageIds);
        const savedVideoIds = new Set(videoIds);
        const pending = {
            projects: copies.filter(({ id }) => !live.has(id)),
            assets: manifest.data.assets.filter(({ id }) => !assetIds.has(id)),
            imageLogs: manifest.data.imageLogs.filter(({ id }) => !savedImageIds.has(id)),
            videoLogs: manifest.data.videoLogs.filter(({ id }) => !savedVideoIds.has(id)),
        };
        const hashes = new Set<string>();
        const safe = projectBackupData(
            pending,
            (url) => {
                if (presetPaths.has(url)) return url;
                if (!url.startsWith("media:")) return "";
                const hash = url.slice(6);
                if (!digestPattern.test(hash) || !manifest.files[hash]) throw failure("missingMedia");
                hashes.add(hash);
                return url;
            },
            session.catalog,
        );
        const urls = new Map<string, string>();
        const storedKeys = new Map<string, string>();
        for (const hash of hashes) {
            session.check();
            onProgress?.({ stage: backupText("media"), current: urls.size + 1, total: hashes.size });
            const record = manifest.files[hash];
            const blob = await downloadWebdavFile(config, `${session.path}/files/${hash}`, session.signal);
            if (!blob || blob.size !== record.bytes || (await digest(blob)) !== hash) throw failure("missingMedia");
            session.check();
            const typedBlob = blob.slice(0, blob.size, record.mime);
            const url = await uploadCanvasAsset(typedBlob, `restore.${mimeExtensions[record.mime]}`, session.signal, "generated");
            const path = sitePath(url);
            if (!serverMedia.test(path)) throw failure("missingMedia");
            session.check();
            const kind = record.mime.split("/")[0];
            const key = `${kind}:wd-${hash}`;
            const cached = await (kind === "image" ? getImageBlob(key) : getMediaBlob(key));
            session.check();
            if (cached?.size !== record.bytes) await trackBackupLocalWrite(kind === "image" ? setImageBlob(key, typedBlob) : setMediaBlob(key, typedBlob));
            storedKeys.set(path, key);
            urls.set(`media:${hash}`, path);
        }
        session.check();
        onProgress?.({ stage: backupText("restoring") });
        const data = projectBackupData(safe, (url) => urls.get(url) || (presetPaths.has(url) ? url : ""), session.catalog, storedKeys);
        const confirmed: CanvasProject[] = [];
        for (const project of data.projects) {
            session.check();
            const current = useCanvasStore.getState();
            if (current.projects.some(({ id }) => id === project.id) || current.deletedProjects.some(({ id }) => id === project.id)) continue;
            const saved = await saveServerCanvasProject(project.id, project, session.signal, 0);
            confirmed.push({ ...project, cloud: { revision: saved.revision ?? 0, updatedAt: project.updatedAt } });
        }
        const importedImages = await restoreLogs(imageLogs, data.imageLogs, session);
        const importedVideos = await restoreLogs(videoLogs, data.videoLogs, session);
        session.check();
        const latest = useCanvasStore.getState();
        const existing = new Set([...latest.projects, ...latest.deletedProjects].map(({ id }) => id));
        const projects = confirmed.filter(({ id }) => !existing.has(id) && existing.add(id));
        const assetState = useAssetStore.getState();
        const existingAssets = new Set(assetState.assets.map(({ id }) => id));
        const assets = data.assets.filter(({ id }) => !existingAssets.has(id) && existingAssets.add(id));
        if (projects.length) {
            useCanvasStore.setState({ projects: [...projects, ...latest.projects] });
            await trackBackupLocalWrite(flushPendingCanvasPersist());
        }
        session.check();
        if (assets.length) {
            const latestAssets = useAssetStore.getState().assets;
            const existingIds = new Set(latestAssets.map(({ id }) => id));
            await trackBackupLocalWrite(Promise.resolve(assetState.replaceAssets([...assets.filter(({ id }) => !existingIds.has(id)), ...latestAssets])));
        }
        session.check();
        return { ...result({ ...data, projects, assets }, urls.size, manifest.missingFiles || 0), imageLogs: importedImages, videoLogs: importedVideos };
    });
}
