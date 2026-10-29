import axios, { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { nanoid } from "nanoid";

import { inferMediaRatio, inferMediaScale, inferVideoRatio } from "@/lib/media-size";
import { imageToDataUrl } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type CiyuanCapability = "image" | "video" | "text" | "audio";

export type CiyuanVideoSpec = {
    min_seconds: number;
    max_seconds: number;
    resolutions: string[];
    default_resolution: string;
    max_images: number;
    max_videos: number;
    max_audios: number;
    max_total_refs?: number;
    needs_video_durations?: boolean;
    requires_all_refs?: boolean;
    prompt_optional?: boolean;
    frames: boolean;
    aspect_ratios?: string[];
};

export type CiyuanImageSpec = {
    qualities?: string[];
    resolutions?: string[];
    ratios?: string[];
    max_count?: number;
    supports_background?: boolean;
};

export type CiyuanModel = {
    id: string;
    capability: CiyuanCapability;
    icon?: string;
    image?: CiyuanImageSpec;
    video?: CiyuanVideoSpec;
};

export type CiyuanUser = {
    id: number;
    username: string;
    display_name?: string;
    group: string;
    quota: number;
    used_quota: number;
};

export type CiyuanCanvasStorage = {
    used_bytes: number;
    quota_bytes: number;
    asset_count: number;
    retention_days: number;
    earliest_expiry: number;
};

export type CiyuanCanvasAsset = {
    name: string;
    kind: string;
    bytes: number;
    source: string;
    created_at: number;
    last_used_at: number;
    expires_at: number;
    url: string;
};

export type CiyuanServerProject = {
    id: string;
    title: string;
    bytes: number;
    created_at: number;
    updated_at: number;
    data?: unknown;
};

export type CiyuanBootstrap = {
    user: CiyuanUser;
    quota_per_unit: number;
    models: CiyuanModel[];
    defaults: Partial<Record<CiyuanCapability, string>>;
    storage?: CiyuanCanvasStorage;
};

export class CiyuanUnauthorizedError extends Error {
    constructor() {
        super("登录已失效，请重新登录");
        this.name = "CiyuanUnauthorizedError";
    }
}

let catalog: CiyuanModel[] = [];

export function setCiyuanCatalog(models: CiyuanModel[]) {
    catalog = models;
}

export function getCiyuanModel(id: string) {
    return catalog.find((model) => model.id === id);
}

let sessionAccessToken: { value: string; expiresAt: number } | null = null;

async function refreshSessionAccessToken(): Promise<string> {
    const response = await fetch("/api/user/auth/refresh", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
    });
    const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { access_token?: string; access_expires_at?: number };
    } | null;
    if (response.status === 401 || response.status === 403) {
        sessionAccessToken = null;
        throw new CiyuanUnauthorizedError();
    }
    if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        throw new Error(retryAfter ? `登录状态刷新过于频繁，请 ${retryAfter} 秒后重试` : "登录状态刷新过于频繁，请稍后再试");
    }
    if (!response.ok || !payload?.success || !payload.data?.access_token) {
        sessionAccessToken = null;
        throw new Error(readMessage(payload) || "刷新登录状态失败");
    }
    sessionAccessToken = {
        value: payload.data.access_token,
        expiresAt: payload.data.access_expires_at ?? 0,
    };
    return payload.data.access_token;
}

async function getSessionAccessToken(force = false): Promise<string> {
    if (!force && sessionAccessToken) {
        const freshUntil = Math.floor(Date.now() / 1000) + 30;
        if (!sessionAccessToken.expiresAt || sessionAccessToken.expiresAt > freshUntil) return sessionAccessToken.value;
    }
    return refreshSessionAccessToken();
}

async function sessionRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getSessionAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(path, { ...init, headers, credentials: "include" });
    if (response.status !== 401) return response;

    sessionAccessToken = null;
    const retryHeaders = new Headers(init.headers);
    retryHeaders.set("Authorization", `Bearer ${await getSessionAccessToken(true)}`);
    return fetch(path, { ...init, headers: retryHeaders, credentials: "include" });
}

export function ciyuanSessionFetch(path: string, init: RequestInit = {}) {
    return sessionRequest(path, init);
}

export async function ciyuanAxios<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const run = async () => {
        const headers = new AxiosHeaders(config.headers as Record<string, string> | undefined);
        headers.set("Authorization", `Bearer ${await getSessionAccessToken()}`);
        return axios.request<T>({ ...config, headers });
    };
    try {
        return await run();
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            sessionAccessToken = null;
            return run();
        }
        throw error;
    }
}

export async function fetchCiyuanBootstrap(): Promise<CiyuanBootstrap> {
    const response = await sessionRequest("/api/canvas/bootstrap", { cache: "no-store" });
    if (response.status === 401 || response.redirected || !response.headers.get("content-type")?.includes("application/json")) {
        throw new CiyuanUnauthorizedError();
    }
    const payload = (await response.json().catch(() => null)) as { success?: boolean; message?: string; data?: CiyuanBootstrap } | null;
    if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(readMessage(payload) || "连接词元API失败");
    }
    return payload.data;
}

export async function logoutCiyuan() {
    sessionAccessToken = null;
    await fetch("/api/user/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
}

export async function uploadCanvasAsset(source: string | Blob, name = "ref.png", signal?: AbortSignal): Promise<string> {
    const blob = typeof source === "string" ? await (await fetch(source, { signal })).blob() : source;
    const form = new FormData();
    form.append("file", blob, name);
    const response = await sessionRequest("/api/canvas/assets", { method: "POST", body: form, signal });
    if (response.status === 401 || response.redirected || !response.headers.get("content-type")?.includes("application/json")) {
        throw new CiyuanUnauthorizedError();
    }
    const payload = (await response.json().catch(() => null)) as { success?: boolean; message?: string; data?: { path?: string } } | null;
    if (!response.ok || !payload?.success || !payload.data?.path) {
        throw new Error(readMessage(payload) || "参考素材上传失败");
    }
    return new URL(payload.data.path, window.location.origin).toString();
}

export type CiyuanVideoTaskResult =
    | { status: "pending" }
    | { status: "completed"; result: { blob: Blob } }
    | { status: "failed"; error: string };

export async function createCiyuanVideoTask(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    options?: { videos?: ReferenceVideo[]; audios?: ReferenceAudio[]; signal?: AbortSignal },
): Promise<{ id: string; provider: "ciyuan"; model: string }> {
    const spec = getCiyuanModel(model)?.video;
    if (!spec) throw new Error(`词元画布未开放该视频模型：${model}`);
    const videos = options?.videos || [];
    const audios = options?.audios || [];
    if (references.length > spec.max_images) {
        throw new Error(`${model} 最多支持 ${spec.max_images} 张参考图`);
    }
    if (videos.length > spec.max_videos) {
        throw new Error(`${model} 最多支持 ${spec.max_videos} 个参考视频`);
    }
    if (audios.length > spec.max_audios) {
        throw new Error(`${model} 最多支持 ${spec.max_audios} 个参考音乐`);
    }
    if (spec.max_total_refs && references.length + videos.length + audios.length > spec.max_total_refs) {
        throw new Error(`${model} 的参考素材合计最多 ${spec.max_total_refs} 个`);
    }
    if (!spec.frames && config.videoMode === "frames" && references.length > 1) {
        throw new Error(`${model} 不支持首尾帧模式，请切换到全能参考模式`);
    }
    if (spec.frames && config.videoMode === "frames" && references.length > 2) {
        throw new Error("首尾帧模式最多支持 2 张参考图");
    }
    if (spec.frames && config.videoMode === "frames" && (videos.length || audios.length)) {
        throw new Error("首尾帧模式不支持参考视频或参考音乐");
    }

    const duration = Math.trunc(Number(config.videoSeconds) || 6);
    if (duration < spec.min_seconds || duration > spec.max_seconds) {
        throw new Error(`${model} 时长需为 ${spec.min_seconds}-${spec.max_seconds} 秒`);
    }
    const requested = normalizeVideoResolution(config.vquality);
    const resolution = spec.resolutions.includes(requested) ? requested : spec.default_resolution;

    const imageUrls = references.length ? await Promise.all(references.map((image) => uploadReferenceImage(image, options?.signal))) : [];
    const videoUrls = videos.length ? await Promise.all(videos.map((item) => uploadReferenceMedia(item, "ref.mp4", options?.signal))) : [];
    const audioUrls = audios.length ? await Promise.all(audios.map((item) => uploadReferenceMedia(item, "ref.mp3", options?.signal))) : [];
    const params: Record<string, unknown> = { duration, resolution };
    if (spec.frames && config.videoMode === "frames" && imageUrls.length) {
        params.first_frame_url = imageUrls[0];
        if (imageUrls[1]) params.last_frame_url = imageUrls[1];
    } else if (imageUrls.length) {
        params.images = imageUrls;
    }
    if (videoUrls.length) {
        params.video_url = videoUrls;
        if (spec.needs_video_durations) {
            const durations = videos.map((item) => Math.ceil((item.durationMs || 0) / 1000));
            if (durations.some((value) => value <= 0)) throw new Error("无法读取参考视频时长，请重新选择视频");
            params.video_durations = durations;
        }
    }
    if (audioUrls.length) params.audio_url = audioUrls;
    const ratio = inferVideoRatio(config.size || "auto");
    if (spec.aspect_ratios?.length && ratio !== "auto" && spec.aspect_ratios.includes(ratio)) {
        params.aspect_ratio = ratio;
    }

    const created = await ciyuanPost<{ task_id?: string | number }>(config, "/media/generate", { model, prompt, params }, options?.signal);
    if (!created?.task_id) throw new Error("视频接口没有返回任务 ID");
    return { id: String(created.task_id), provider: "ciyuan", model };
}

export async function pollCiyuanVideoTask(config: AiConfig, task: { id: string }, signal?: AbortSignal): Promise<CiyuanVideoTaskResult> {
    const state = await ciyuanGet<{ state?: string; error?: string }>(config, `/media/status/${encodeURIComponent(task.id)}`, signal);
    if (state.state === "failed") return { status: "failed", error: state.error || "视频生成失败" };
    if (state.state !== "success") return { status: "pending" };
    const blob = await ciyuanGetBlob(config, `/tasks/${encodeURIComponent(task.id)}/artifacts/video/content`, signal);
    return { status: "completed", result: { blob } };
}

export type CiyuanGeneratedImage = { id: string; dataUrl: string; serverUrl?: string };

export async function requestCiyuanBananaImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, signal?: AbortSignal): Promise<CiyuanGeneratedImage[]> {
    if (references.length > 14) throw new Error("banana-2.1 最多支持 14 张参考图");
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const ratio = bananaRatio(config.size);
    const imageSize = bananaSize(config.size);
    const results: CiyuanGeneratedImage[] = [];

    for (let index = 0; index < count; index += 1) {
        const params: Record<string, unknown> = {};
        if (ratio) params.aspect_ratio = ratio;
        if (imageSize) params.image_size = imageSize;
        if (refs.length) params.images = refs;
        const created = await ciyuanPost<{ task_id?: string | number }>(config, "/media/generate", { model: "banana-2.1", prompt, params }, signal);
        if (!created?.task_id) throw new Error("图片接口没有返回任务 ID");
        const taskId = String(created.task_id);
        await waitCiyuanTask(config, taskId, signal);
        const blob = await ciyuanGetBlob(config, `/tasks/${encodeURIComponent(taskId)}/artifacts/image/content`, signal);
        const dataUrl = await blobToDataUrl(blob);
        let serverUrl: string | undefined;
        try {
            serverUrl = await uploadCanvasAsset(blob, "banana.png", signal);
        } catch {
            serverUrl = undefined;
        }
        results.push({ id: `banana_${nanoid(16)}`, dataUrl, serverUrl });
    }
    return results;
}

async function uploadReferenceImage(image: ReferenceImage, signal?: AbortSignal) {
    const dataUrl = await imageToDataUrl(image);
    return uploadCanvasAsset(dataUrl, "ref.png", signal);
}

async function uploadReferenceMedia(item: ReferenceVideo | ReferenceAudio, fallbackName: string, signal?: AbortSignal) {
    const blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) throw new Error("参考素材读取失败，请重新选择文件");
    return uploadCanvasAsset(blob, fallbackName, signal);
}

async function waitCiyuanTask(config: AiConfig, taskId: string, signal?: AbortSignal) {
    const deadline = Date.now() + 20 * 60 * 1000;
    for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await ciyuanGet<{ state?: string; error?: string }>(config, `/media/status/${encodeURIComponent(taskId)}`, signal);
        if (state.state === "failed") throw new Error(state.error || "图片生成失败");
        if (state.state === "success") return;
        if (Date.now() >= deadline) throw new Error(`任务 ${taskId} 等待超时，请勿重复提交`);
        await delay(3000, signal);
    }
}

function normalizeVideoResolution(value: string) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "low") return "480p";
    if (raw === "auto" || raw === "high" || raw === "medium") return "720p";
    const number = raw.replace(/p$/i, "");
    if (/^\d+k$/.test(number)) return number;
    return /^\d+$/.test(number) ? `${number}p` : "720p";
}

function bananaRatio(size: string) {
    const ratio = inferMediaRatio(size, "1:1");
    if (ratio === "auto") return "1:1";
    if (ratio === "21:9") return "16:9";
    if (ratio === "9:21") return "9:16";
    return ratio;
}

function bananaSize(size: string) {
    const scale = inferMediaScale(size);
    if (scale === "1k") return "1K";
    if (scale === "2k") return "2K";
    if (scale === "4k") return "4K";
    return undefined;
}

async function ciyuanPost<T>(config: AiConfig, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    try {
        const response = await ciyuanAxios({ method: "post", url: apiUrl(config, path), data: body, headers: { "Content-Type": "application/json" }, signal });
        return unwrap<T>(response.data);
    } catch (error) {
        throw new Error(readError(error));
    }
}

async function ciyuanGet<T>(config: AiConfig, path: string, signal?: AbortSignal): Promise<T> {
    try {
        const response = await ciyuanAxios({ method: "get", url: apiUrl(config, path), signal });
        return unwrap<T>(response.data);
    } catch (error) {
        throw new Error(readError(error));
    }
}

async function ciyuanGetBlob(config: AiConfig, path: string, signal?: AbortSignal) {
    try {
        const response = await ciyuanAxios<Blob>({ method: "get", url: apiUrl(config, path), responseType: "blob", signal });
        const blob = response.data;
        if (blob.type.includes("json")) {
            let message = "下载生成结果失败";
            try {
                message = readMessage(JSON.parse(await blob.text())) || message;
            } catch {
                // Keep the generic message when the error body is not JSON.
            }
            throw new Error(message);
        }
        return blob;
    } catch (error) {
        throw new Error(readError(error));
    }
}

export type CiyuanChatMessage = {
    role: string;
    content:
        | string
        | Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
          >;
    tool_call_id?: string;
};

// The playground endpoint authenticates with the dashboard session and accepts
// image input for every vision-capable relay model. The canvas uses it for the
// reverse-prompt composer instead of the OpenAI-only Responses shape.
export async function requestCiyuanChatQuestion(
    config: AiConfig,
    messages: CiyuanChatMessage[],
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
): Promise<string> {
    const base = config.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const response = await ciyuanSessionFetch(`${base}/pg/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ model: config.model, messages, stream: true }),
        signal,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        let message = "";
        try {
            message = readMessage(JSON.parse(text));
        } catch {
            message = text.slice(0, 200);
        }
        throw new Error(message || "反推提示词请求失败");
    }
    const contentType = response.headers.get("content-type") || "";
    if (!response.body || contentType.includes("application/json")) {
        const payload = (await response.json().catch(() => null)) as ChatCompletionPayload | null;
        const content = chatCompletionText(payload);
        if (content) onDelta?.(content);
        return content;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const consume = (block: string) => {
        for (const line of block.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let payload: ChatCompletionPayload;
            try {
                payload = JSON.parse(data) as ChatCompletionPayload;
            } catch {
                continue;
            }
            const delta = payload.choices?.[0]?.delta;
            const text = chatContentText(delta?.content) || chatContentText(payload.choices?.[0]?.message?.content);
            if (text) {
                content += text;
                onDelta?.(content);
            }
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        blocks.forEach(consume);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!content) {
        const fallback = chatCompletionTextFromText(buffer);
        if (fallback) {
            content = fallback;
            onDelta?.(content);
        }
    }
    return content;
}

type ChatCompletionPayload = {
    choices?: Array<{
        delta?: { content?: unknown };
        message?: { content?: unknown };
    }>;
    error?: { message?: string };
    message?: string;
};

function chatCompletionText(payload: ChatCompletionPayload | null) {
    const message = payload?.choices?.[0]?.message;
    return chatContentText(message?.content);
}

function chatCompletionTextFromText(payload: string) {
    try {
        return chatCompletionText(JSON.parse(payload) as ChatCompletionPayload);
    } catch {
        return "";
    }
}

function chatContentText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("");
    }
    return "";
}

function apiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function unwrap<T>(payload: unknown): T {
    if (payload && typeof payload === "object" && "code" in payload) {
        const record = payload as { code?: unknown; data?: unknown };
        const code = record.code;
        if (code !== undefined && code !== null && code !== 200 && code !== "200" && code !== 0 && code !== "0") {
            throw new Error(readMessage(payload) || "请求失败");
        }
        if (record.data === undefined || record.data === null) throw new Error(readMessage(payload) || "接口没有返回数据");
        return record.data as T;
    }
    return payload as T;
}

function readError(error: unknown) {
    if (axios.isAxiosError(error)) {
        return readMessage(error.response?.data) || error.message || "请求失败";
    }
    return error instanceof Error ? error.message : "请求失败";
}

function readMessage(payload: unknown): string {
    if (!payload) return "";
    if (typeof payload === "string") return payload;
    if (typeof payload !== "object") return "";
    const record = payload as { msg?: unknown; message?: unknown; error?: unknown };
    if (typeof record.msg === "string" && record.msg) return record.msg;
    if (typeof record.message === "string" && record.message) return record.message;
    if (typeof record.error === "string" && record.error) return record.error;
    if (record.error && typeof record.error === "object") {
        const message = (record.error as { message?: unknown }).message;
        if (typeof message === "string" && message) return message;
    }
    return "";
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

async function canvasJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await sessionRequest(path, init);
    const payload = (await response.json().catch(() => null)) as { success?: boolean; message?: string; data?: T } | null;
    if (response.status === 401 || response.status === 403) throw new CiyuanUnauthorizedError();
    if (!response.ok || !payload?.success) throw new Error(readMessage(payload) || "请求失败");
    return payload.data as T;
}

export function fetchCanvasStorage() {
    return canvasJson<{ storage: CiyuanCanvasStorage; assets: CiyuanCanvasAsset[] }>("/api/canvas/storage", { cache: "no-store" });
}

export function saveCanvasRetentionDays(retentionDays: number) {
    return canvasJson<CiyuanCanvasStorage>("/api/canvas/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retention_days: retentionDays }),
    });
}

export function cleanupCanvasServerAssets() {
    return canvasJson<{ deleted: number; freed: number; storage: CiyuanCanvasStorage }>("/api/canvas/assets/cleanup", { method: "POST" });
}

export function deleteCanvasServerAsset(name: string) {
    return canvasJson<{ deleted: string }>(`/api/canvas/assets/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function fetchCanvasImageResult(requestId: string): Promise<{ status: string; assets: Array<{ name: string; url: string }> } | null> {
    const response = await sessionRequest(`/api/canvas/image-results/${encodeURIComponent(requestId)}`, { cache: "no-store" });
    if (response.status === 404) return null;
    const payload = (await response.json().catch(() => null)) as { success?: boolean; data?: { status?: string; assets?: Array<{ name: string; url: string }> } } | null;
    if (!response.ok || !payload?.success || !payload.data) return null;
    return { status: payload.data.status || "", assets: payload.data.assets || [] };
}

export function fetchServerCanvasProjects() {
    return canvasJson<{ projects: CiyuanServerProject[] }>("/api/canvas/projects", { cache: "no-store" });
}

export function saveServerCanvasProject(id: string, project: unknown) {
    return canvasJson<{ id: string; bytes: number; saved_at: number }>(`/api/canvas/projects/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
    });
}

export function deleteServerCanvasProject(id: string) {
    return canvasJson<unknown>(`/api/canvas/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}
