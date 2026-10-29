import localforage from "localforage";
import { nanoid } from "nanoid";

import { fetchCanvasImageResult, uploadCanvasAsset } from "@/services/ciyuan";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";

// One paid image attempt = one stable request id. The id is written to
// IndexedDB before the request leaves the browser; the server keeps the result
// under it, so reopening the page after a refresh can collect the finished
// images without paying the upstream provider twice.

const ATTEMPT_STORE_KEY = "canvas-image-attempts";
const attemptStore = localforage.createInstance({ name: "infinite-canvas", storeName: ATTEMPT_STORE_KEY });
const ATTEMPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_DROP_AFTER_MS = 10 * 60 * 1000;

export type ImageAttempt = { id: string; createdAt: number; owner: "workbench" | "auto" };

/** workbench attempts are resolved by the image page (which owns its logs); auto attempts by this module. */
export async function beginImageAttempt(owner: ImageAttempt["owner"] = "auto"): Promise<ImageAttempt> {
    const attempt = { id: `img_${nanoid(20)}`, createdAt: Date.now(), owner };
    await attemptStore.setItem(attempt.id, attempt).catch(() => undefined);
    return attempt;
}

export async function finishImageAttempt(id: string): Promise<void> {
    await attemptStore.removeItem(id).catch(() => undefined);
}

/** Wait briefly for the server to finish recording the attempt, then map its stored assets. */
export async function resolveAttemptAssets(requestId: string, count: number): Promise<string[]> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const result = await fetchCanvasImageResult(requestId).catch(() => null);
        if (result?.status === "completed" && result.assets.length) {
            return result.assets.slice(0, count).map((asset) => new URL(asset.url, window.location.origin).toString());
        }
        await delay(350);
    }
    return [];
}

/** Collect results of attempts whose page died mid-request; returns how many images were recovered. */
export async function resumeImageAttempts(): Promise<number> {
    const attempts: ImageAttempt[] = [];
    await attemptStore.iterate<ImageAttempt, void>((value) => {
        if (value?.id) attempts.push(value);
    });
    let recovered = 0;
    for (const attempt of attempts) {
        if (attempt.owner === "workbench") continue;
        const age = Date.now() - attempt.createdAt;
        if (age > ATTEMPT_MAX_AGE_MS) {
            await finishImageAttempt(attempt.id);
            continue;
        }
        const result = await fetchCanvasImageResult(attempt.id).catch(() => null);
        if (!result) {
            if (age > ATTEMPT_DROP_AFTER_MS) await finishImageAttempt(attempt.id);
            continue;
        }
        if (result.status !== "completed") continue;
        for (const asset of result.assets) {
            const url = new URL(asset.url, window.location.origin).toString();
            try {
                const image = await uploadImage(url);
                useAssetStore.getState().addAsset({
                    kind: "image",
                    title: `恢复的生成结果 ${asset.name.slice(0, 6)}`,
                    coverUrl: url,
                    tags: [],
                    source: "画布恢复",
                    data: { dataUrl: url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                    metadata: { source: "image-attempt", requestId: attempt.id, serverUrl: url },
                });
                recovered += 1;
            } catch {
                // Keep the attempt so the next load can retry the download.
                continue;
            }
        }
        await finishImageAttempt(attempt.id);
    }
    return recovered;
}

/** Mirror a generated media blob into the server asset store; returns its public path or null. */
export async function mirrorGeneratedMedia(blob: Blob, name: string): Promise<string | null> {
    try {
        return await uploadCanvasAsset(blob, name);
    } catch {
        return null;
    }
}

/** Logout must not leak one account's canvas data to the next login. */
export async function clearCanvasLocalData(): Promise<void> {
    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
    const { useAssetStore } = await import("@/stores/use-asset-store");
    // Drop the in-memory state first, then the persisted keys and every blob
    // cache, and wait for all of it: a 400ms persist debounce or a reload right
    // after logout could otherwise restore the previous account's projects.
    useCanvasStore.setState({ projects: [], deletedProjects: [] });
    useAssetStore.getState().replaceAssets([]);
    const stores = ["image_generation_logs", "video_generation_logs", "image_files", "image_previews", "media_files"];
    await Promise.all([
        attemptStore.clear().catch(() => undefined),
        Promise.resolve(useCanvasStore.persist.clearStorage()).catch(() => undefined),
        Promise.resolve(useAssetStore.persist.clearStorage()).catch(() => undefined),
        ...stores.map((storeName) => localforage.createInstance({ name: "infinite-canvas", storeName }).clear().catch(() => undefined)),
    ]);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
