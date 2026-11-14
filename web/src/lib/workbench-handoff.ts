import { modelOptionName } from "@/stores/use-config-store";

export const SHOWCASE_CANVAS_HANDOFF_STORAGE_KEY = "ciyuan-canvas-handoff";
const HANDOFF_TTL_MS = 30 * 60 * 1000;

type StoredCanvasHandoffEntry = {
    capability?: "image" | "video";
    model?: string;
    prompt?: string;
    createdAt?: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem"> | null | undefined;

export type ResolvedWorkbenchHandoff = {
    model: string;
    prompt: string;
    cleanedSearch: string;
};

export function resolveWorkbenchHandoff(input: {
    search: string;
    capability: "image" | "video";
    storage?: StorageLike;
    now?: number;
}): ResolvedWorkbenchHandoff | null {
    const raw = input.search.replace(/^\?/, "");
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    if (!params.has("model") && !params.has("prompt") && !params.has("handoff")) {
        return null;
    }

    const urlModel = params.get("model")?.trim() || "";
    const urlPrompt = params.get("prompt")?.trim() || "";
    const handoffId = params.get("handoff")?.trim() || "";
    const now = input.now ?? Date.now();

    let storedEntry: StoredCanvasHandoffEntry | undefined;
    if (handoffId && input.storage) {
        try {
            const text = input.storage.getItem(SHOWCASE_CANVAS_HANDOFF_STORAGE_KEY);
            if (text) {
                const parsed = JSON.parse(text) as Record<string, StoredCanvasHandoffEntry>;
                if (parsed && typeof parsed === "object") {
                    const validEntries = Object.entries(parsed).filter(
                        ([, entry]) =>
                            Boolean(entry) &&
                            typeof entry.createdAt === "number" &&
                            now - entry.createdAt <= HANDOFF_TTL_MS,
                    );
                    if (validEntries.length !== Object.keys(parsed).length) {
                        input.storage.setItem(SHOWCASE_CANVAS_HANDOFF_STORAGE_KEY, JSON.stringify(Object.fromEntries(validEntries)));
                    }
                    const candidate = Object.fromEntries(validEntries)[handoffId];
                    if (candidate && (!candidate.capability || candidate.capability === input.capability)) {
                        storedEntry = candidate;
                    }
                }
            }
        } catch {
            storedEntry = undefined;
        }
    }

    const model = urlModel || storedEntry?.model?.trim() || "";
    const prompt = storedEntry?.prompt?.trim() || urlPrompt;

    params.delete("model");
    params.delete("prompt");
    params.delete("handoff");

    return {
        model,
        prompt,
        cleanedSearch: params.toString(),
    };
}

export function matchWorkbenchModelOption(requestedModel: string, options: string[]): string | null {
    const target = requestedModel.trim();
    if (!target) return null;
    const exact = options.find((option) => modelOptionName(option) === target);
    if (exact) return exact;
    const lower = target.toLowerCase();
    return options.find((option) => modelOptionName(option).toLowerCase() === lower) || null;
}
