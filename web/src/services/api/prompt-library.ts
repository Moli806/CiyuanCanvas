import type { Prompt } from "./prompts";

const libraryBase = "/canvas/prompt-library/";
const registryBase = "https://raw.githubusercontent.com/yukkcat/image-prompts";
const anonymousRead: RequestInit = { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" };

type LibrarySource = { id: string; name: string; homepage: string; sha256: string; sourceMode: "local" | "remote" };
type LibraryManifest = { registryCommit: string; sources: LibrarySource[] };
type LibraryRow = Partial<Prompt> & { id: string; title: string; entryUrl?: string };
type LibraryIndex = { items: Prompt[]; incomplete: boolean };
export type NativePromptSource = { url: string; mirror: string; integrity: string };

let libraryIndex: Promise<LibraryIndex> | undefined;
const nativeSources = new Map<string, Promise<Map<string, string>>>();

async function readJson<Data>(url: string, options?: RequestInit): Promise<Data> {
    const response = await fetch(url, { ...anonymousRead, ...options });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function readSource(source: LibrarySource, revision: string): Promise<Prompt[]> {
    if (!/^[a-z0-9-]+$/.test(source.id)) throw new Error("Invalid library source ID");
    const records = await readJson<LibraryRow[]>(`${libraryBase}${source.id}.json`, { cache: "no-cache" });
    let nativeSource: NativePromptSource | undefined;
    if (source.sourceMode === "remote") {
        if (!/^[a-f\d]{64}$/.test(source.sha256)) throw new Error("Invalid library source digest");
        const bytes = source.sha256.match(/../g)!.map((part) => Number.parseInt(part, 16));
        nativeSource = {
            url: `${registryBase}/${revision}/dist/sources/${source.id}.json`,
            mirror: `https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@${revision}/dist/sources/${source.id}.json`,
            integrity: `sha256-${btoa(String.fromCharCode(...bytes))}`,
        };
    }
    return records.map((row) => ({
        id: row.id, title: row.title, prompt: row.prompt || "", description: row.description || "", tags: row.tags || [],
        sourceId: source.id, category: source.name, author: row.author, githubUrl: row.sourceUrl || source.homepage,
        entryUrl: row.entryUrl, coverUrl: row.coverUrl || "", referenceImageUrls: row.referenceImageUrls || [], preview: "", createdAt: row.createdAt || "", updatedAt: row.updatedAt || "", nativeSource,
    }));
}

async function readIndex(): Promise<LibraryIndex> {
    try {
        const manifest = await readJson<LibraryManifest>(`${libraryBase}manifest.json`, { cache: "no-cache" });
        if (!/^[a-f\d]{40}$/.test(manifest.registryCommit) || !manifest.sources.length) throw new Error("Invalid library manifest");
        const results = await Promise.allSettled(manifest.sources.map((source) => readSource(source, manifest.registryCommit)));
        return { items: results.flatMap((result) => result.status === "fulfilled" ? result.value : []), incomplete: results.some((result) => result.status === "rejected") };
    } catch {
        return { items: [], incomplete: true };
    }
}

export function getPromptLibrary() {
    return libraryIndex ??= readIndex();
}

export function retryPromptLibrary() {
    libraryIndex = undefined;
}

export async function resolveLibraryPrompt(item: Prompt): Promise<Prompt> {
    if (item.prompt) return item;
    const source = item.nativeSource;
    if (!source) throw new Error("Prompt text is unavailable");
    let pending = nativeSources.get(source.url);
    if (!pending) {
        const load = (url: string) => readJson<Array<{ id: string; prompt: string }>>(url, { cache: "no-store", mode: "cors", integrity: source.integrity });
        pending = load(source.url).catch(() => load(source.mirror))
            .then((rows) => new Map(rows.map((row) => [row.id, row.prompt])))
            .catch((error) => { nativeSources.delete(source.url); throw error; });
        nativeSources.set(source.url, pending);
    }
    const prompt = (await pending).get(item.id);
    if (!prompt?.trim()) throw new Error("Prompt text is unavailable");
    return { ...item, prompt };
}
