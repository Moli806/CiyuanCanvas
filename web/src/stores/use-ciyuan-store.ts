import { create } from "zustand";

import { createModelChannel, encodeChannelModel, modelOptionsFromChannels, useConfigStore } from "@/stores/use-config-store";
import {
    CiyuanUnauthorizedError,
    fetchCiyuanBootstrap,
    logoutCiyuan,
    setCiyuanCatalog,
    type CiyuanBootstrap,
    type CiyuanCapability,
    type CiyuanModel,
    type CiyuanUser,
} from "@/services/ciyuan";

type SessionStatus = "idle" | "loading" | "ready" | "unauthenticated" | "error";

type CiyuanState = {
    status: SessionStatus;
    user: CiyuanUser | null;
    models: CiyuanModel[];
    quotaPerUnit: number;
    error: string;
    refresh: (silent?: boolean) => Promise<void>;
    logout: () => Promise<void>;
};

let refreshPromise: Promise<void> | null = null;

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
    const image = pick("image");
    const video = pick("video");
    const text = pick("text");
    const current = useConfigStore.getState().config;
    const managedBefore = current.channels.some((channel) => channel.id === "ciyuan");

    useConfigStore.setState({
        config: {
            ...current,
            channelMode: "local",
            baseUrl: window.location.origin,
            apiKey: "",
            apiFormat: "ciyuan",
            channels: [channel],
            models,
            model: image || video || text,
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

    refresh: (silent = false) => {
        if (refreshPromise) return refreshPromise;
        if (!silent) set({ status: "loading", error: "" });
        const promise = (async () => {
            try {
                const data = await fetchCiyuanBootstrap();
                setCiyuanCatalog(data.models);
                seedConfig(data);
                set({
                    status: "ready",
                    user: data.user,
                    models: data.models,
                    quotaPerUnit: data.quota_per_unit,
                    error: "",
                });
            } catch (error) {
                if (error instanceof CiyuanUnauthorizedError) {
                    clearConfigToken();
                    set({ status: "unauthenticated", user: null, models: [], error: "" });
                    return;
                }
                if (silent && get().status === "ready") return;
                set({ status: "error", error: error instanceof Error ? error.message : "连接词元API失败" });
            } finally {
                refreshPromise = null;
            }
        })();
        refreshPromise = promise;
        return promise;
    },

    logout: async () => {
        await logoutCiyuan();
        clearConfigToken();
        set({ status: "unauthenticated", user: null, models: [], error: "" });
    },
}));
