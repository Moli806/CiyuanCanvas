import i18n from "@/i18n";
import type { WebdavSyncConfig } from "@/stores/use-config-store";

export const WEBDAV_MANIFEST_FILE_NAME = "manifest.json";
const WEBDAV_REQUEST_TIMEOUT_MS = 120000;
const directories = new WeakMap<WebdavSyncConfig, Map<string, Promise<void>>>();
const webdavText = (key: string, options?: Record<string, unknown>) => i18n.t(`config.webdav.errors.${key}`, options);

function pathParts(path: string) {
    const parts = path.trim().split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === ".." || part.includes("\\"))) throw new Error(i18n.t("config.personal.invalidDirectory"));
    return parts;
}

function endpoint(config: WebdavSyncConfig, parts: string[], collection: boolean) {
    const raw = config.url.trim();
    if (!raw) throw new Error(webdavText("urlRequired"));
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(i18n.t("config.personal.invalidUrl"));
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || raw.includes("\\")) throw new Error(i18n.t("config.personal.invalidUrl"));
    url.pathname = [url.pathname.replace(/\/+$/, ""), ...parts.map(encodeURIComponent)].join("/") + (collection ? "/" : "");
    return url.href;
}

async function request<T>(config: WebdavSyncConfig, parts: string[], collection: boolean, options: RequestInit, read: (response: Response) => T | Promise<T>) {
    const url = endpoint(config, parts, collection);
    const headers = new Headers(options.headers);
    if (config.username || config.password) {
        const bytes = new TextEncoder().encode(`${config.username}:${config.password}`);
        headers.set("Authorization", `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`);
    }
    const signal = options.signal;
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, WEBDAV_REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, { ...options, headers, credentials: "omit", mode: "cors", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal });
        return await read(response);
    } catch (error) {
        signal?.throwIfAborted();
        if (controller.signal.aborted) throw new Error(webdavText("requestTimeout"));
        if (error instanceof TypeError) throw new Error(webdavText("connectionFailed"));
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
    }
}

function checkResponse(response: Response, fallback: string) {
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) throw new Error(webdavText("authenticationFailed"));
    if (response.status === 404) throw new Error(webdavText("pathMissing"));
    throw new Error(webdavText("responseFailed", { fallback: webdavText(fallback), status: response.status, detail: "" }));
}

function checkCollection(config: WebdavSyncConfig, parts: string[], signal?: AbortSignal) {
    return request(config, parts, true, { method: "PROPFIND", headers: { Depth: "0" }, signal }, (response) => checkResponse(response, "testFailed"));
}

export async function testWebdavConnection(config: WebdavSyncConfig, signal?: AbortSignal) {
    pathParts(config.directory);
    await checkCollection(config, [], signal);
}

async function createCollection(config: WebdavSyncConfig, parts: string[], signal?: AbortSignal) {
    const exists = await request(config, parts, true, { method: "MKCOL", signal }, (response) => {
        if (response.status === 405 || response.status === 423) return true;
        checkResponse(response, "directoryFailed");
        return false;
    });
    if (exists) await checkCollection(config, parts, signal);
}

async function ensureCollections(config: WebdavSyncConfig, parts: string[], signal?: AbortSignal) {
    let cache = directories.get(config);
    if (!cache) directories.set(config, (cache = new Map()));
    for (let count = 1; count <= parts.length; count++) {
        const parent = parts.slice(0, count);
        const key = parent.join("/");
        let created = cache.get(key);
        if (!created) {
            created = createCollection(config, parent, signal);
            cache.set(key, created);
        }
        try {
            await created;
        } catch (error) {
            cache.delete(key);
            throw error;
        }
    }
}

export function downloadWebdavFile(config: WebdavSyncConfig, path: string, signal?: AbortSignal) {
    const parts = [...pathParts(config.directory), ...pathParts(path)];
    return request(config, parts, false, { method: "GET", signal }, (response) => {
        if (response.status === 404) return null;
        checkResponse(response, "downloadFailed");
        return response.blob();
    });
}

export function webdavFileHasSize(config: WebdavSyncConfig, path: string, bytes: number, signal?: AbortSignal) {
    const parts = [...pathParts(config.directory), ...pathParts(path)];
    return request(config, parts, false, { method: "HEAD", signal }, (response) => {
        if ([404, 405, 501].includes(response.status)) return false;
        checkResponse(response, "downloadFailed");
        const length = response.headers.get("Content-Length");
        return response.status === 200 && length !== null && Number(length) === bytes;
    });
}

export async function uploadWebdavFile(config: WebdavSyncConfig, path: string, file: Blob, contentType = "application/octet-stream", signal?: AbortSignal) {
    if (!file.size) throw new Error(webdavText("emptyUpload"));
    const parts = [...pathParts(config.directory), ...pathParts(path)];
    await ensureCollections(config, parts.slice(0, -1), signal);
    return request(config, parts, false, { method: "PUT", headers: { "Content-Type": contentType }, body: file, signal }, (response) => checkResponse(response, "uploadFailed"));
}
