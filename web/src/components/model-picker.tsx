import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ModelBrandIcon } from "@/components/model-brand-icon";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { getCiyuanModel } from "@/services/ciyuan";
import { cn } from "@/lib/utils";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => {
        const models = Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model))));
        return models.sort((left, right) => compareModelNames(modelOptionName(left), modelOptionName(right)));
    }, [capability, config, value]);
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : pickerPlaceholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : pickerPlaceholder}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] max-h-[var(--radix-select-content-available-height)] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)}>
                            <ModelLabel config={config} model={model} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : i18n.t("settingsPanels.model.select");
    return i18n.t("settingsPanels.model.managedEmpty", { capability: label });
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{modelOptionLabel(config, model)}</span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    return <ModelBrandIcon icon={getCiyuanModel(modelOptionName(model))?.icon} size={16} />;
}

// Model families keep a fixed order; inside a family the version, the "fast"
// variant, the resolution and finally the remaining suffix decide, so Seedance
// 2.0 listings never interleave with 2.5 and "-one" variants stay next to their
// base model.
const MODEL_FAMILY_ORDER = ["gpt-image", "banana", "Wan-", "Kling-", "Seedance-", "MiniMax-", "视频超分", "gpt-", "claude-", "gemini-", "Deepseek-", "Suno-"];

function modelSortValue(name: string) {
    const lower = name.toLowerCase();
    const familyIndex = MODEL_FAMILY_ORDER.findIndex((prefix) => lower.startsWith(prefix.toLowerCase()));
    const family = familyIndex >= 0 ? familyIndex : MODEL_FAMILY_ORDER.length;
    const versionMatch = name.match(/(\d+(?:\.\d+)?)(.*)$/);
    const version = versionMatch ? Number(versionMatch[1]) : 0;
    const rest = versionMatch ? versionMatch[2] : name;
    const resolution = Number(name.match(/(\d{3,4})p/i)?.[1] || 0);
    const fast = /fast/i.test(name) ? 1 : 0;
    return { family, version, fast, resolution, rest };
}

export function compareModelNames(left: string, right: string) {
    const a = modelSortValue(left);
    const b = modelSortValue(right);
    if (a.family !== b.family) return a.family - b.family;
    if (a.version !== b.version) return a.version - b.version;
    if (a.fast !== b.fast) return a.fast - b.fast;
    if (a.resolution !== b.resolution) return a.resolution - b.resolution;
    return a.rest.localeCompare(b.rest, undefined, { numeric: true, sensitivity: "base" });
}
