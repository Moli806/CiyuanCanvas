import { deleteServerCanvasProject, fetchServerCanvasProjects, saveServerCanvasProject } from "@/services/ciyuan";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

// Project JSON lives on the server; the IndexedDB copy is a cache. Saves are
// debounced and diffed by updatedAt so a project is only pushed when it changed;
// on startup the server copy merges back in, which restores canvases on a new
// browser or after clearing site data.

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

export function mergeServerProjects(local: CanvasProject[], server: CanvasProject[]): CanvasProject[] {
    const merged = new Map(local.map((project) => [project.id, project]));
    for (const project of server) {
        const existing = merged.get(project.id);
        if (!existing || Date.parse(project.updatedAt || "") > Date.parse(existing.updatedAt || "")) {
            merged.set(project.id, project);
        }
    }
    return Array.from(merged.values());
}

/** Pull server projects and merge them into the canvas store. */
export async function pullAndMergeCanvasProjects(): Promise<number> {
    const { projects } = await fetchServerCanvasProjects();
    const serverProjects = projects
        .filter((project) => project.data && typeof project.data === "object")
        .map((project) => project.data as CanvasProject)
        .filter((project) => Boolean(project?.id && project?.updatedAt));
    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
    for (const project of serverProjects) syncedUpdatedAt.set(project.id, project.updatedAt);
    if (!serverProjects.length) return 0;
    const local = useCanvasStore.getState().projects;
    const merged = mergeServerProjects(local, serverProjects);
    const changed = merged.length !== local.length || merged.some((project, index) => project !== local[index]);
    if (changed) useCanvasStore.setState({ projects: merged });
    return merged.length - local.length;
}
