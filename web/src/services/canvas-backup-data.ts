import { encodeChannelModel, modelOptionName } from "@/stores/use-config-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { Asset } from "@/stores/use-asset-store";

type Row = Record<string, unknown>;
export type BackupLog = Row & { id: string; createdAt: number };
export type BackupData = { projects: CanvasProject[]; assets: Asset[]; imageLogs: BackupLog[]; videoLogs: BackupLog[] };
export type MediaReference = (url: string, storageKey: string, fallback: string) => string;

function row(value: unknown): Row {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

function text(value: unknown) {
    return typeof value === "string" ? value : "";
}

function list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function coordinate(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function fields(source: Row, keys: string) {
    const result: Row = {};
    for (const key of keys.split(" ")) {
        const value = source[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") result[key] = value;
    }
    return result;
}

export function projectBackupData(input: unknown, media: MediaReference, catalog: ReadonlySet<string>, storedKeys?: ReadonlyMap<string, string>): BackupData {
    const model = (value: unknown) => {
        const name = modelOptionName(text(value));
        return name && catalog.has(name) ? encodeChannelModel("ciyuan", name) : "";
    };
    const attachment = (value: unknown, key: string) => {
        const item = row(value);
        const url = media(text(item[key]), text(item.storageKey), text(item.serverUrl) || text(item.url));
        return {
            ...fields(item, "id name title type prompt text width height durationMs naturalWidth naturalHeight bytes mimeType"),
            ...(item.status ? { status: item.status === "loading" ? "idle" : text(item.status) } : {}),
            [key]: url,
            ...(storedKeys?.has(url) ? { storageKey: storedKeys.get(url) } : {}),
        };
    };
    const node = (value: unknown) => {
        const item = row(value);
        const meta = row(item.metadata);
        const kind = text(item.type);
        const builtIn = ["image", "video", "audio", "text", "config", "group"].includes(kind);
        const isMedia = ["image", "video", "audio"].includes(kind);
        const content = isMedia ? media(text(meta.content), text(meta.storageKey), "") : text(meta.content);
        return {
            ...fields(item, "id title width height"),
            type: builtIn ? kind : "text",
            position: { x: coordinate(row(item.position).x), y: coordinate(row(item.position).y) },
            metadata: {
                ...fields(
                    meta,
                    "prompt composerContent fontSize generationMode generationType reasoningEffort size quality background count textCount primaryTextId seconds vquality generateAudio watermark videoMode audioVoice audioFormat audioSpeed audioInstructions naturalWidth naturalHeight freeResize primaryImageId mimeType bytes durationMs groupId",
                ),
                model: model(meta.model),
                status: meta.status === "loading" ? "idle" : text(meta.status) || "idle",
                content,
                ...(isMedia && storedKeys?.has(content) ? { storageKey: storedKeys.get(content) } : {}),
                images: list(meta.images).map((entry) => attachment(entry, "content")),
                texts: list(meta.texts).map((entry) => ({ ...fields(row(entry), "id content"), status: row(entry).status === "loading" ? "idle" : text(row(entry).status) })),
                references: list(meta.references)
                    .map((url) => media(text(url), "", ""))
                    .filter(Boolean),
            },
        };
    };
    const project = (value: unknown) => {
        const item = row(value);
        const viewport = row(item.viewport);
        const zoom = coordinate(viewport.k);
        return {
            ...fields(item, "id title createdAt updatedAt showImageInfo backgroundMode"),
            activeChatId: text(item.activeChatId) || null,
            viewport: { x: coordinate(viewport.x), y: coordinate(viewport.y), k: zoom > 0 ? zoom : 1 },
            nodes: list(item.nodes).map(node),
            connections: list(item.connections).map((entry) => fields(row(entry), "id fromNodeId toNodeId")),
            chatSessions: list(item.chatSessions).map((entry) => {
                const session = row(entry);
                return {
                    ...fields(session, "id title createdAt updatedAt"),
                    messages: list(session.messages).map((message) => ({
                        ...fields(row(message), "id role title text"),
                        references: list(row(message).references).map((reference) => attachment(reference, "dataUrl")),
                    })),
                };
            }),
        } as CanvasProject;
    };
    const asset = (value: unknown) => {
        const item = row(value);
        const data = row(item.data);
        const kind = text(item.kind);
        const key = kind === "image" ? "dataUrl" : "url";
        const own = text(data[key]);
        const body = kind === "text" ? { content: text(data.content) } : attachment(data, key);
        const cover = text(item.coverUrl);
        return {
            ...fields(item, "id kind title note createdAt updatedAt"),
            tags: list(item.tags).filter((tag) => typeof tag === "string"),
            coverUrl: cover && cover === own ? text(row(body)[key]) : media(cover, "", ""),
            metadata: fields(row(item.metadata), "prompt"),
            data: body,
        } as Asset;
    };
    const log = (value: unknown) => {
        const item = row(value);
        const config = row(item.config);
        return {
            id: text(item.id),
            createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
            ...fields(item, "title prompt time durationMs successCount failCount imageCount size quality resolution seconds"),
            model: model(item.model),
            config: { ...fields(config, "quality size count vquality videoSeconds videoGenerateAudio videoWatermark videoMode"), model: model(config.model), imageModel: model(config.imageModel), videoModel: model(config.videoModel) },
            status: item.status === "success" || (!item.status && (list(item.images).length || item.video)) ? "success" : "failed",
            references: list(item.references).map((entry) => attachment(entry, "dataUrl")),
            images: list(item.images).map((entry) => attachment(entry, "dataUrl")),
            videoReferences: list(item.videoReferences).map((entry) => attachment(entry, "url")),
            audioReferences: list(item.audioReferences).map((entry) => attachment(entry, "url")),
            ...(item.video ? { video: attachment(item.video, "url") } : {}),
        };
    };
    const data = row(input);
    const completedLogs = (values: unknown) =>
        list(values)
            .filter((value) => !["pending", "interrupted"].includes(text(row(value).status)))
            .map(log);
    return {
        projects: list(data.projects).map(project),
        assets: list(data.assets)
            .filter((value) => ["text", "image", "video"].includes(text(row(value).kind)))
            .map(asset),
        imageLogs: completedLogs(data.imageLogs),
        videoLogs: completedLogs(data.videoLogs),
    };
}
