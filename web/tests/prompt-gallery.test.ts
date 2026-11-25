import { expect, spyOn, test } from "bun:test";
import { readFile } from "node:fs/promises";

const directory = new URL("../public/prompt-library/", import.meta.url);
const manifest = await Bun.file(new URL("manifest.json", directory)).json();
const prefix = "/canvas/prompt-library/";

async function gallery() {
    if (!Object.hasOwn(globalThis, "localStorage")) Object.defineProperty(globalThis, "localStorage", {
        configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    const api = await import("../src/services/api/prompts");
    const library = await import("../src/services/api/prompt-library");
    library.retryPromptLibrary();
    return { ...api, ...library };
}

async function indexResponse(url: string) {
    const data = await readFile(new URL(url.slice(prefix.length), directory), "utf8");
    return new Response(data, { headers: { "content-type": "application/json" } });
}

test("both gallery entry points page and search the local index, preserving presets and ignoring legacy source settings", async () => {
    const api = await gallery();
    const request = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        expect(String(input).startsWith(prefix)).toBe(true);
        expect(init?.credentials).toBe("omit");
        return indexResponse(String(input));
    });
    const { usePromptSourceStore } = await import("../src/stores/use-prompt-source-store");
    const previous = usePromptSourceStore.getState().sources;
    try {
        usePromptSourceStore.setState({ sources: [{ id: "legacy", name: "Legacy", enabled: true, builtIn: false, url: "https://legacy.invalid/prompts", homepage: "" }] });
        const first = await api.fetchPrompts({ language: "zh-CN" });
        const second = await api.fetchPrompts({ language: "zh-CN", page: 2 });
        expect(first.total).toBe(manifest.total + 6);
        expect(first.items).toHaveLength(20);
        expect(first.incomplete).toBe(false);
        expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(40);
        expect(first.categories).not.toContain("Legacy");
        expect((await api.fetchPrompts({ keyword: "蒸汽", category: "视频与分镜", language: "zh-CN" })).items.map((item) => item.id)).toEqual(["coffee-closeup"]);
        expect((await api.fetchPrompts({ keyword: "steam", category: "Video and storyboards", language: "en-US" })).items.map((item) => item.id)).toEqual(["coffee-closeup"]);
        const source = manifest.sources[0];
        const category = await api.fetchPrompts({ category: source.name });
        expect(category.total).toBe(source.count);
        const sample = category.items[0];
        expect((await api.fetchPrompts({ keyword: sample.title, tag: sample.tags.slice(0,1), category: source.name })).items.some((item) => item.id === sample.id)).toBe(true);
        expect(request).toHaveBeenCalledTimes(manifest.sources.length + 1);
    } finally {
        usePromptSourceStore.setState({ sources: previous });
        request.mockRestore();
    }
});

test("remote text is looked up by native ID, read anonymously by digest, and shared by concurrent gallery and node actions", async () => {
    const api = await gallery();
    const source = manifest.sources.find((item: {sourceMode:string}) => item.sourceMode === "remote");
    const nativeRequests: string[] = [];
    let selectedId = "";
    const request = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.startsWith(prefix)) return indexResponse(url);
        nativeRequests.push(url);
        expect(init?.integrity).toBe(`sha256-${Buffer.from(source.sha256,"hex").toString("base64")}`);
        expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", mode: "cors", cache: "no-store" });
        if (url === source.nativeUrl) return new Response("", { status: 503 });
        return Response.json([{ id: "unrelated", prompt: "other" }, { id: selectedId, prompt: "Original\npublic text" }]);
    });
    try {
        const sample = (await api.fetchPrompts({ category: source.name })).items[0];
        selectedId = sample.id;
        expect(sample.prompt).toBe("");
        expect(nativeRequests).toHaveLength(0);
        const result = await Promise.all([api.resolveLibraryPrompt(sample), api.resolveLibraryPrompt(sample)]);
        expect(result.every((item) => item.id === sample.id && item.prompt === "Original\npublic text" && item.coverUrl === sample.coverUrl)).toBe(true);
        expect(nativeRequests).toEqual([source.nativeUrl, `https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@${manifest.registryCommit}/dist/sources/${source.id}.json`]);
        const localSource = manifest.sources.find((item: {sourceMode:string}) => item.sourceMode === "local");
        const direct = (await api.fetchPrompts({ category: localSource.name })).items[0];
        expect(direct.prompt.trim().length).toBeGreaterThan(0);
        expect(await api.resolveLibraryPrompt(direct)).toBe(direct);
        expect(nativeRequests).toHaveLength(2);
    } finally { request.mockRestore(); }
});

test("a missing index leaves presets available and an explicit retry restores all sources", async () => {
    const api = await gallery();
    const request = spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
    try {
        const offline = await api.fetchPrompts();
        expect(offline.total).toBe(6);
        expect(offline.incomplete).toBe(true);
        request.mockImplementation((input) => indexResponse(String(input)));
        api.retryPromptLibrary();
        expect((await api.fetchPrompts()).total).toBe(manifest.total + 6);
    } finally { request.mockRestore(); }
});
