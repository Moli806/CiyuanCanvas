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
let flushing = false;

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
    flushing = true;
    const current = queue;
    queue = null;
    try {
        for (const id of current.deleted) {
            if (sentDeletes.has(id)) continue;
            try {
                await deleteServerCanvasProject(id);
                sentDeletes.add(id);
                syncedUpdatedAt.delete(id);
            } catch {
                // Retry on the next save.
            }
        }
        for (const project of current.projects) {
            if (syncedUpdatedAt.get(project.id) === project.updatedAt) continue;
            try {
                await saveServerCanvasProject(project.id, project);
                syncedUpdatedAt.set(project.id, project.updatedAt);
            } catch {
                // Retry on the next save.
            }
        }
    } finally {
        flushing = false;
    }
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
    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
    await waitForCanvasHydration(useCanvasStore);
    const { projects: serverProjects } = await fetchServerCanvasProjects();
    const state = useCanvasStore.getState();
    const tombstoned = new Set(state.deletedProjects.map((project) => project.id));
    for (const meta of serverProjects) {
        if (tombstoned.has(meta.id)) void deleteServerCanvasProject(meta.id).catch(() => undefined);
    }
    const merged = [...state.projects];
    const indexById = new Map(merged.map((project, index) => [project.id, index]));
    let inserted = 0;
    for (const meta of serverProjects) {
        if (tombstoned.has(meta.id)) continue;
        const index = indexById.get(meta.id);
        const local = index === undefined ? undefined : merged[index];
        const serverNewer = meta.updated_at * 1000 > Date.parse(local?.updatedAt || "") ;
        if (local && !serverNewer) continue;
        try {
            const full = await getServerCanvasProject(meta.id);
            const project = full?.data as CanvasProject | undefined;
            if (!project?.id || !project.updatedAt) continue;
            if (index === undefined) {
                merged.push(project);
                inserted += 1;
            } else {
                merged[index] = project;
            }
            syncedUpdatedAt.set(project.id, project.updatedAt);
        } catch {
            // Skip unreadable payloads; the next pull retries.
        }
    }
    if (inserted > 0 || merged.length !== state.projects.length) {
        useCanvasStore.setState({ projects: merged });
    }
    return inserted;
}
