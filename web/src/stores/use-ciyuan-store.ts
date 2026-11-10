import { create } from "zustand";

import { createModelChannel, encodeChannelModel, modelOptionName, modelOptionsFromChannels, useConfigStore } from "@/stores/use-config-store";
import {
    CiyuanUnauthorizedError,
    fetchCanvasStorage,
    fetchCiyuanBootstrap,
    logoutCiyuan,
    resetCiyuanSession,
    setCiyuanCatalog,
    type CiyuanBootstrap,
    type CiyuanCanvasStorage,
    type CiyuanCapability,
    type CiyuanModel,
    type CiyuanUser,
} from "@/services/ciyuan";

import { resetCanvasSyncState } from "@/services/canvas-project-sync";

type SessionStatus = "idle" | "loading" | "ready" | "unauthenticated" | "error";

type CiyuanState = {
    status: SessionStatus;
    user: CiyuanUser | null;
    models: CiyuanModel[];
    quotaPerUnit: number;
    error: string;
    storage: CiyuanCanvasStorage | null;
    imageReplayTimeoutSeconds: number;
    recoveredImages: number;
    refresh: (silent?: boolean) => Promise<void>;
    refreshStorage: () => Promise<void>;
    setStorage: (storage: CiyuanCanvasStorage) => void;
    setRecoveredImages: (count: number) => void;
    logout: () => Promise<void>;
};

let refreshPromise: Promise<void> | null = null;
let sessionVersion = 0;
const canvasOwnerKey = "ciyuan-canvas-owner";

function seedConfig(data: CiyuanBootstrap) {
    const channel = createModelChannel({
        id: "ciyuan",
        name: "词元API",
        baseUrl: window.location.origin,
        apiKey: "",
        apiFormat: "ciyuan",
        models: data.models.map((model) => ({ name: model.id, capability: model.capability })),
    });
    const models = modelOptionsFromChannels([channel]);
    const firstOf = (capability: CiyuanCapability) => data.models.find((model) => model.capability === capability)?.id;
    const pick = (capability: CiyuanCapability) => {
        const id = data.defaults[capability] || firstOf(capability);
        return id ? encodeChannelModel("ciyuan", id) : "";
    };
    const current = useConfigStore.getState().config;
    const managedBefore = current.channels.some((channel) => channel.id === "ciyuan");
    // The gate refreshes the bootstrap every minute; keep the user's current
    // choice while it is still offered for that capability instead of resetting
    // it to the default on every refresh.
    const pickKeeping = (capability: CiyuanCapability, previous: string) => {
        const name = modelOptionName(previous || "");
        return name && data.models.some((model) => model.id === name && model.capability === capability) ? encodeChannelModel("ciyuan", name) : pick(capability);
    };
    const image = pickKeeping("image", current.imageModel);
    const video = pickKeeping("video", current.videoModel);
    const text = pickKeeping("text", current.textModel);
    const activeName = modelOptionName(current.model || "");
    const activeModel = current.model && data.models.some((model) => model.id === activeName) ? current.model : image || video || text;

    useConfigStore.setState({
        config: {
            ...current,
            channelMode: "local",
            baseUrl: window.location.origin,
            apiKey: "",
            apiFormat: "ciyuan",
            channels: [channel],
            models,
            model: activeModel,
            imageModel: image,
            videoModel: video,
            textModel: text,
            audioModel: "",
            videoMode: managedBefore ? current.videoMode : "reference",
            proxyEnabled: false,
            systemPrompt: "",
        },
    });
}

function clearConfigToken() {
    const current = useConfigStore.getState().config;
    useConfigStore.setState({
        config: {
            ...current,
            baseUrl: "",
            apiKey: "",
            apiFormat: "openai",
            channels: [],
            models: [],
            model: "",
            imageModel: "",
            videoModel: "",
            textModel: "",
            audioModel: "",
        },
    });
}

export const useCiyuanStore = create<CiyuanState>((set, get) => ({
    status: "idle",
    user: null,
    models: [],
    quotaPerUnit: 500000,
    error: "",
    storage: null,
    imageReplayTimeoutSeconds: 1800,
    recoveredImages: 0,

    refresh: (silent = false) => {
        if (refreshPromise) return refreshPromise;
        const version = sessionVersion;
        if (!silent) set({ status: "loading", error: "" });
        const promise = (async () => {
            try {
                const data = await fetchCiyuanBootstrap();
                if (version !== sessionVersion) return;
                const owner = String(data.user.id);
                if (localStorage.getItem(canvasOwnerKey) !== owner || (get().user && get().user?.id !== data.user.id)) {
                    set({ status: "loading", user: null, storage: null, recoveredImages: 0 });
                    resetCanvasSyncState();
                    resetCiyuanSession();
                    const { clearCanvasLocalData } = await import("@/services/image-attempts");
                    await clearCanvasLocalData();
                    if (version !== sessionVersion) return;
                    localStorage.setItem(canvasOwnerKey, owner);
                }
                setCiyuanCatalog(data.models);
                seedConfig(data);
                set({
                    status: "ready",
                    user: data.user,
                    models: data.models,
                    quotaPerUnit: data.quota_per_unit,
                    error: "",
                    ...(data.storage ? { storage: data.storage } : {}),
                    imageReplayTimeoutSeconds: data.image_replay_timeout_seconds && data.image_replay_timeout_seconds > 0 ? data.image_replay_timeout_seconds : 1800,
                });
            } catch (error) {
                if (version !== sessionVersion) return;
                if (error instanceof CiyuanUnauthorizedError) {
                    resetCanvasSyncState();
                    resetCiyuanSession();
                    clearConfigToken();
                    set({ status: "unauthenticated", user: null, models: [], error: "" });
                    return;
                }
                if (silent && get().status === "ready") return;
                set({ status: "error", error: error instanceof Error ? error.message : "连接词元API失败" });
            } finally {
                if (version === sessionVersion) refreshPromise = null;
            }
        })();
        refreshPromise = promise;
        return promise;
    },

    refreshStorage: async () => {
        const version = sessionVersion;
        const userId = get().user?.id;
        const { storage } = await fetchCanvasStorage();
        if (version === sessionVersion && userId === get().user?.id) set({ storage });
    },

    setStorage: (storage) => set({ storage }),

    setRecoveredImages: (count) => set({ recoveredImages: count }),

    logout: async () => {
        sessionVersion += 1;
        refreshPromise = null;
        resetCanvasSyncState();
        set({ status: "loading", user: null, models: [], storage: null });
        const logout = logoutCiyuan();
        try {
            const { clearCanvasLocalData } = await import("@/services/image-attempts");
            await clearCanvasLocalData();
            localStorage.removeItem(canvasOwnerKey);
        } finally {
            await logout;
            clearConfigToken();
            set({ status: "unauthenticated", user: null, models: [], error: "", storage: null, imageReplayTimeoutSeconds: 1800, recoveredImages: 0 });
        }
    },
}));
