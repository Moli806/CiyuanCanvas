import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { matchWorkbenchModelOption, resolveWorkbenchHandoff } from "@/lib/workbench-handoff";
import { modelMatchesCapability, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";

export function useWorkbenchModel(capability: "image" | "video", onPrompt: (prompt: string) => void) {
    const [search, setSearch] = useSearchParams();
    const applied = useRef("");
    const [requested, setRequested] = useState("");
    const config = useConfigStore((state) => state.config);
    const update = useConfigStore((state) => state.updateConfig);
    const key = capability === "image" ? "imageModel" : "videoModel";

    useEffect(() => {
        const raw = search.toString();
        if (!raw) {
            applied.current = "";
            return;
        }
        if (raw === applied.current) return;
        const handoff = resolveWorkbenchHandoff({ search: raw, capability, storage: localStorage });
        if (!handoff) {
            applied.current = "";
            return;
        }
        applied.current = raw;
        if (handoff.prompt) onPrompt(handoff.prompt);
        setRequested(handoff.model);
        if (handoff.model) {
            const matched = matchWorkbenchModelOption(handoff.model, selectableModelsByCapability(config, capability));
            if (!matched) return;
            update(key, matched);
        }
        setSearch(new URLSearchParams(handoff.cleanedSearch), { replace: true });
    }, [search, capability, config, key, onPrompt, setSearch, update]);

    const selected = modelMatchesCapability(config, config[key], capability) ? config[key] : "";
    const model = requested ? matchWorkbenchModelOption(requested, selectableModelsByCapability(config, capability)) || "" : selected;
    const selectModel = (value: string) => {
        update(key, value);
        setRequested("");
        if (applied.current) {
            const cleaned = new URLSearchParams(search);
            for (const param of ["model", "prompt", "handoff"]) cleaned.delete(param);
            setSearch(cleaned, { replace: true });
        }
    };
    return { model, unavailableModel: model ? "" : requested, selectModel };
}
