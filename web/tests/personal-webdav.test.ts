import { afterAll, afterEach, expect, test } from "bun:test";
import { forgetWebdavProfile, readWebdavProfile, rememberWebdavProfile } from "../src/pages/config/webdav-profile";

const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { downloadWebdavFile, testWebdavConnection, uploadWebdavFile, webdavFileHasSize } = await import("../src/services/webdav-sync");
const profile = { url: "https://nas.example.test/dav", directory: "个人备份", username: "测试", password: "sample-password", lastSyncedAt: "" };

test("connection test only reads the selected HTTPS collection with the NAS login and no site credentials", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
        calls.push(`${init?.method} ${url}`);
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe(`Basic ${Buffer.from(`${profile.username}:${profile.password}`).toString("base64")}`);
        expect(headers.get("Depth")).toBe("0");
        expect(headers.has("Cookie")).toBe(false);
        expect(init?.credentials).toBe("omit");
        expect(init?.redirect).toBe("error");
        expect(init?.referrerPolicy).toBe("no-referrer");
        return new Response("", { status: 207 });
    }) as typeof fetch;
    await testWebdavConnection(profile);
    expect(calls).toEqual(["PROPFIND https://nas.example.test/dav/"]);
});

test("the remote directory and media files round trip through normal WebDAV requests", async () => {
    const calls: string[] = [];
    const uploaded = new Map<string, Blob>();
    globalThis.fetch = (async (url, init) => {
        const path = decodeURIComponent(new URL(String(url)).pathname);
        calls.push(`${init?.method} ${path}`);
        if (init?.method === "MKCOL") return new Response(null, { status: path.endsWith("个人备份/") ? 405 : 201 });
        if (init?.method === "PROPFIND") return new Response("", { status: 207 });
        if (init?.method === "PUT") { uploaded.set(path, init.body as Blob); return new Response(null, { status: 201 }); }
        return uploaded.has(path) ? new Response(uploaded.get(path)) : new Response(null, { status: 404 });
    }) as typeof fetch;
    expect(await downloadWebdavFile(profile, "empty/manifest.json")).toBeNull();
    await Promise.all(["first", "second"].map((name) => uploadWebdavFile(profile, `media/${name}.txt`, new Blob([name]))));
    expect(await (await downloadWebdavFile(profile, "media/first.txt"))?.text()).toBe("first");
    expect(calls.filter((call) => call.startsWith("MKCOL"))).toEqual(["MKCOL /dav/个人备份/", "MKCOL /dav/个人备份/media/"]);
    expect(calls.filter((call) => call.startsWith("PROPFIND"))).toEqual(["PROPFIND /dav/个人备份/"]);
});

test("invalid endpoints and parent folders fail before a request, and remote errors do not echo their content", async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response("private error details", { status: 500 }); }) as typeof fetch;
    for (const url of ["http://nas.example.test/dav", "https://name:password@nas.example.test/dav", "https://nas.example.test/dav?key=value"]) {
        await expect(testWebdavConnection({ ...profile, url })).rejects.toThrow();
    }
    await expect(testWebdavConnection({ ...profile, directory: "../other" })).rejects.toThrow();
    expect(calls).toBe(0);
    const message = await testWebdavConnection(profile).then(() => "", (error: Error) => error.message);
    expect(message).toContain("500");
    expect(message).not.toContain("private error details");
});

test("an account change aborts an in-flight transfer", async () => {
    const operation = new AbortController();
    let transfer: AbortSignal | null | undefined;
    globalThis.fetch = ((_url, init) => {
        transfer = init?.signal;
        return new Promise((_resolve, reject) => transfer?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    }) as typeof fetch;
    const pending = downloadWebdavFile(profile, "manifest.json", operation.signal);
    operation.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(transfer?.aborted).toBe(true);
});

test("only a confirmed remote size can skip an upload", async () => {
    for (const [status, size, matches] of [[200, "8", true], [200, "7", false], [200, "", false], [404, "", false], [405, "", false], [501, "", false]] as const) {
        globalThis.fetch = (async (_url, init) => {
            expect(init?.method).toBe("HEAD");
            return new Response(null, { status, headers: size ? { "Content-Length": size } : {} });
        }) as typeof fetch;
        expect(await webdavFileHasSize(profile, "file.bin", 8)).toBe(matches);
    }
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
    await expect(webdavFileHasSize(profile, "file.bin", 8)).rejects.toThrow();
});

test("saving and forgetting a connection affects only that canvas account and keeps passwords out of storage", () => {
    rememberWebdavProfile(1, profile);
    expect([...values.values()].join("")).not.toContain(profile.password);
    expect(readWebdavProfile(1)).toEqual({ ...profile, password: "" });
    expect(readWebdavProfile(2).url).toBe("");
    rememberWebdavProfile(2, { ...profile, url: "https://other.example.test/webdav/" });
    forgetWebdavProfile(1);
    expect(readWebdavProfile(1).url).toBe("");
    expect(readWebdavProfile(2).url).toBe("https://other.example.test/webdav/");
});
