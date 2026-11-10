import { deleteServerCanvasProject, fetchServerCanvasProjects, getServerCanvasProject, saveServerCanvasProject } from "@/services/ciyuan";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

// Project JSON lives on the server; the IndexedDB copy is a cache. Saves are
// debounced and diffed by updatedAt so a project is only pushed when it changed;
// on startup the server copy merges back in, which restores canvases on a new
// browser or after clearing site data. Tombstones from deletedProjects always
// win, so a deleted project is never resurrected by a pull.

const syncedUpdatedAt = new Map<string, string>();
const sentDeletes = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let queue: { projects: CanvasProject[]; deleted: string[] } | null = null;
let syncController = new AbortController();
let flushing: AbortController | null = null;

export function scheduleCanvasSync(projects: CanvasProject[], deletedIds: string[]) {
    queue = { projects, deleted: deletedIds };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        void flushCanvasSync();
    }, 1200);
}

async function flushCanvasSync() {
    if (flushing || !queue) return;
    const controller = syncController;
    const { signal } = controller;
    flushing = controller;
    const current = queue;
    queue = null;
    try {
        for (const id of current.deleted) {
            if (signal.aborted) return;
            if (sentDeletes.has(id)) continue;
            try {
                await deleteServerCanvasProject(id, signal);
                if (signal.aborted) return;
                sentDeletes.add(id);
                syncedUpdatedAt.delete(id);
            } catch {
                // Retry on the next save.
            }
        }
        for (const project of current.projects) {
            if (signal.aborted) return;
            if (syncedUpdatedAt.get(project.id) === project.updatedAt) continue;
            try {
                await saveServerCanvasProject(project.id, project, signal);
                if (signal.aborted) return;
                syncedUpdatedAt.set(project.id, project.updatedAt);
            } catch {
                // Retry on the next save.
            }
        }
    } finally {
        if (flushing === controller) {
            flushing = null;
            // Edits can be queued while an upload is in flight; run them now.
            if (queue) void flushCanvasSync();
        }
    }
}

/** Drop all local sync bookkeeping so the next account starts clean. */
export function resetCanvasSyncState() {
    syncController.abort();
    syncController = new AbortController();
    flushing = null;
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    queue = null;
    syncedUpdatedAt.clear();
    sentDeletes.clear();
}

function waitForCanvasHydration(store: { getState: () => { hydrated: boolean }; subscribe: (listener: (state: { hydrated: boolean }) => void) => () => void }): Promise<void> {
    if (store.getState().hydrated) return Promise.resolve();
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            unsubscribe();
            resolve();
        }, 3000);
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated) return;
            clearTimeout(timeout);
            unsubscribe();
            resolve();
        });
    });
}

/** Pull server projects and merge them into the canvas store (metadata first, payloads on demand). */
export async function pullAndMergeCanvasProjects(): Promise<number> {
    const { signal } = syncController;
    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
    await waitForCanvasHydration(useCanvasStore);
    if (signal.aborted) return 0;
    const { projects: serverProjects } = await fetchServerCanvasProjects(signal);
    if (signal.aborted) return 0;
    const before = useCanvasStore.getState();
    const tombstoned = new Set(before.deletedProjects.map((project) => project.id));
    const localById = new Map(before.projects.map((project) => [project.id, project]));
    for (const meta of serverProjects) {
        if (tombstoned.has(meta.id)) void deleteServerCanvasProject(meta.id, signal).catch(() => undefined);
    }
    const fetched: CanvasProject[] = [];
    for (const meta of serverProjects) {
        if (signal.aborted) return 0;
        if (tombstoned.has(meta.id)) continue;
        const local = localById.get(meta.id);
        if (local && Date.parse(local.updatedAt) >= meta.updated_at * 1000) continue;
        try {
            const full = await getServerCanvasProject(meta.id, signal);
            if (signal.aborted) return 0;
            const project = full?.data as CanvasProject | undefined;
            if (project?.id && project.updatedAt) fetched.push(project);
        } catch {
            // Skip unreadable payloads; the next pull retries.
        }
    }
    // Merge against the store as it is right before applying, so edits made
    // while the payloads were downloading are not overwritten.
    if (signal.aborted) return 0;
    const state = useCanvasStore.getState();
    const skip = new Set(state.deletedProjects.map((project) => project.id));
    const merged = [...state.projects];
    const indexById = new Map(merged.map((project, index) => [project.id, index]));
    let changed = 0;
    for (const project of fetched) {
        if (skip.has(project.id)) continue;
        const index = indexById.get(project.id);
        if (index === undefined) {
            indexById.set(project.id, merged.length);
            merged.push(project);
            changed += 1;
            syncedUpdatedAt.set(project.id, project.updatedAt);
            continue;
        }
        if (Date.parse(merged[index].updatedAt) >= Date.parse(project.updatedAt)) continue;
        merged[index] = project;
        changed += 1;
        syncedUpdatedAt.set(project.id, project.updatedAt);
    }
    if (changed > 0) useCanvasStore.setState({ projects: merged });
    return changed;
}
