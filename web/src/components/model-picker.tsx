import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ModelBrandIcon } from "@/components/model-brand-icon";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { formatModelUnitPrice, formatMultiplier, resolveModelPrice, type ModelPriceUnit, type ResolvedModelPrice } from "@/lib/model-pricing";
import { getCiyuanModel } from "@/services/ciyuan";
import { cn } from "@/lib/utils";
import { useCiyuanStore } from "@/stores/use-ciyuan-store";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

export type ModelPickerPricingContext = {
    hasReferenceVideo?: boolean;
    resolution?: string;
    showTriggerPrice?: boolean;
    showDropdownPrice?: boolean;
};

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    pricingContext?: ModelPickerPricingContext;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig, pricingContext }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const pricing = useCiyuanStore((state) => state.pricing);
    const groupRatios = useCiyuanStore((state) => state.groupRatios);
    const pricingLoadedAt = useCiyuanStore((state) => state.pricingLoadedAt);
    const pricingLoading = useCiyuanStore((state) => state.pricingLoading);
    const userGroup = useCiyuanStore((state) => state.user?.group);
    const refreshPricing = useCiyuanStore((state) => state.refreshPricing);

    const options = useMemo(() => {
        const models = Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model))));
        return models.sort((left, right) => compareModelNames(modelOptionName(left), modelOptionName(right)));
    }, [capability, config, value]);
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");
    const supportsPrice = capability === "image" || capability === "video";
    const showDropdownPrice = pricingContext?.showDropdownPrice ?? supportsPrice;
    const showTriggerPrice = pricingContext?.showTriggerPrice ?? (supportsPrice && fullWidth);

    const unitLabels = useMemo<Record<ModelPriceUnit, string>>(
        () => ({
            second: t("workbench.priceUnitSecond"),
            clip: t("workbench.priceUnitClip"),
            image: t("workbench.priceUnitImage"),
            request: t("workbench.priceUnitRequest"),
        }),
        [t],
    );

    const resolveOptionPrice = (modelValue: string, allowResolutionRange: boolean): ResolvedModelPrice | null => {
        if (!modelValue) return null;
        const modelName = modelOptionName(modelValue);
        const entry = pricing[modelName];
        if (!entry) return null;
        return resolveModelPrice(entry, {
            capability,
            hasReferenceVideo: pricingContext?.hasReferenceVideo,
            resolution: allowResolutionRange ? undefined : pricingContext?.resolution,
            userGroup,
            groupRatios,
            spec: getCiyuanModel(modelName),
            allowResolutionRange,
        });
    };

    const triggerPrice = showTriggerPrice ? resolveOptionPrice(current, false) : null;

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
                if (nextOpen) {
                    window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                    if (showDropdownPrice || showTriggerPrice) void refreshPricing(true);
                }
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
                {showTriggerPrice ? (
                    triggerPrice ? (
                        <ModelPriceBadge price={triggerPrice} unitLabels={unitLabels} />
                    ) : pricingLoading && !pricingLoadedAt ? (
                        <span className="shrink-0 text-xs text-muted-foreground">…</span>
                    ) : null
                ) : null}
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] max-h-[var(--radix-select-content-available-height)] w-[22rem] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => {
                        const itemPrice = showDropdownPrice ? resolveOptionPrice(model, model !== current) : null;
                        return (
                            <SelectItem
                                key={model}
                                value={model}
                                textValue={modelOptionLabel(config, model)}
                                className="[&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
                            >
                                <ModelLabel config={config} model={model} price={itemPrice} unitLabels={unitLabels} loading={showDropdownPrice && pricingLoading && !pricingLoadedAt} />
                            </SelectItem>
                        );
                    })
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

function ModelPriceBadge({ price, unitLabels }: { price: ResolvedModelPrice; unitLabels: Record<ModelPriceUnit, string> }) {
    const { t } = useTranslation();
    const text = formatModelUnitPrice(price, unitLabels);
    const multiplier = formatMultiplier(price.videoInputMultiplier);
    if (price.videoInputSurcharge) {
        return (
            <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium tabular-nums text-amber-600 dark:text-amber-400"
                title={t("workbench.priceRefVideoSurcharge", { multiplier })}
            >
                <span>{text}</span>
                {multiplier ? <span className="text-[10px] leading-none">{multiplier}</span> : null}
            </span>
        );
    }
    return <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{text}</span>;
}

function ModelLabel({ config, model, price, unitLabels, loading }: { config: AiConfig; model: string; price: ResolvedModelPrice | null; unitLabels: Record<ModelPriceUnit, string>; loading?: boolean }) {
    const { t } = useTranslation();
    return (
        <span className="flex w-full min-w-0 items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
                <ModelIcon model={model} />
                <span className="truncate">{modelOptionLabel(config, model)}</span>
                {getCiyuanModel(modelOptionName(model))?.video?.spec_required ? <span className="shrink-0 text-xs text-muted-foreground">{t("workbench.specRequired")}</span> : null}
            </span>
            {price ? <ModelPriceBadge price={price} unitLabels={unitLabels} /> : loading ? <span className="shrink-0 text-xs text-muted-foreground">…</span> : null}
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
const MODEL_FAMILY_ORDER = ["gpt-image", "banana", "Wan-", "Kling-", "Seedance-", "MiniMax-", "Omini-", "视频超分", "gpt-", "claude-", "gemini-", "Deepseek-", "Suno-"];

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
