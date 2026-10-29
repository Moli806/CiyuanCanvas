import { useEffect, type ReactNode } from "react";
import { Slider } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { getCiyuanModel } from "@/services/ciyuan";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];
const videoModeOptions = [
    { value: "frames", labelKey: "frames" },
    { value: "reference", labelKey: "reference" },
];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = videoRatioOptions.map((item) => ({ value: item.value, get label() { return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value; } }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

type VideoSettingsPanelProps = {
    config: AiConfig;
    model?: string;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, model: modelOverride, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const modelName = modelOptionName(modelOverride || config.model || config.videoModel);
    const spec = getCiyuanModel(modelName)?.video;
    const resolutionItems = spec?.resolutions?.length
        ? Array.from(new Map(spec.resolutions.map((item) => [item.replace(/p$/i, ""), { value: item.replace(/p$/i, ""), label: item }])).values())
        : resolutionOptions;
    const ratioItems = spec ? (spec.aspect_ratios?.length ? videoRatioOptions.filter((item) => spec.aspect_ratios!.includes(item.value)) : []) : videoRatioOptions;
    const modeItems = spec && !spec.frames ? videoModeOptions.filter((item) => item.value === "reference") : videoModeOptions;
    const minSeconds = spec?.min_seconds ?? VIDEO_SECONDS_MIN;
    const maxSeconds = spec?.max_seconds ?? VIDEO_SECONDS_MAX;
    const seconds = Number(clampVideoSeconds(config.videoSeconds || "6", minSeconds, maxSeconds));
    const videoMode = normalizeVideoModeValue(config.videoMode);
    const resolution = parseVideoResolution(config.vquality);
    const selectedRatio = inferVideoRatio(config.size || "auto");
    const dimensions = readVideoDimensions(config.size || "auto", resolution, selectedRatio);
    const applySize = (nextResolution: string, ratio: string) => {
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", computeVideoSize(nextResolution, ratio));
    };
    const selectResolution = (nextResolution: string) => {
        if (selectedRatio === "auto") onConfigChange("vquality", nextResolution);
        else applySize(nextResolution, selectedRatio);
    };

    useEffect(() => {
        if (!spec) return;
        const rawSeconds = Number(clampVideoSeconds(config.videoSeconds || "6", spec.min_seconds, spec.max_seconds));
        const nextSeconds = Math.min(spec.max_seconds, Math.max(spec.min_seconds, rawSeconds));
        if (nextSeconds !== rawSeconds) onConfigChange("videoSeconds", String(nextSeconds));
        if (spec.resolutions.length && !spec.resolutions.some((value) => value.replace(/p$/i, "") === resolution)) {
            onConfigChange("vquality", spec.default_resolution.replace(/p$/i, ""));
        }
        if (!spec.frames && videoMode === "frames") onConfigChange("videoMode", "reference");
        if (spec.aspect_ratios?.length && selectedRatio !== "auto" && !spec.aspect_ratios.includes(selectedRatio)) {
            onConfigChange("size", spec.aspect_ratios.find((value) => value !== "auto") || "auto");
        }
    }, [spec, config.videoSeconds, config.vquality, config.size, config.videoMode, onConfigChange, resolution, selectedRatio, videoMode]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {resolutionItems.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => selectResolution(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        {spec ? null : <ResolutionInput value={resolution} theme={theme} onChange={selectResolution} />}
                    </div>
                </SettingGroup>
                {spec ? (
                    ratioItems.length ? (
                        <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                            <div className="grid grid-cols-4 gap-2.5">
                                {ratioItems.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                        style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => applySize(resolution, item.value)}
                                    >
                                        <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                        <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                                    </button>
                                ))}
                            </div>
                        </SettingGroup>
                    ) : (
                        <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                            <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.video.ratioFixed")}
                            </div>
                        </SettingGroup>
                    )
                ) : (
                    <>
                        <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("width", value, dimensions, onConfigChange)} />
                                <span className="text-lg opacity-45">↔</span>
                                <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("height", value, dimensions, onConfigChange)} />
                            </div>
                        </SettingGroup>
                        <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                            <div className="grid grid-cols-4 gap-2.5">
                                {videoRatioOptions.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                        style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => applySize(resolution, item.value)}
                                    >
                                        <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                        <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                                    </button>
                                ))}
                            </div>
                        </SettingGroup>
                    </>
                )}
                <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                        <Slider className="min-w-0 flex-1" min={minSeconds} max={maxSeconds} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} />
                        <SecondsInput value={seconds} min={minSeconds} max={maxSeconds} theme={theme} onCommit={(value) => onConfigChange("videoSeconds", String(value))} />
                        <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>s</span>
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.mode")} color={theme.node.muted}>
                    <div className={modeItems.length > 1 ? "grid grid-cols-2 gap-2.5" : "grid grid-cols-1 gap-2.5"}>
                        {modeItems.map((item) => (
                            <OptionPill key={item.value} selected={videoMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                                {t(`settingsPanels.video.modes.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${parseVideoResolution(value)}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratio;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function videoModeLabel(value: string) {
    return i18n.t(`settingsPanels.video.modes.${normalizeVideoModeValue(value)}`);
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value === "reference" ? "reference" : "frames";
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

function updateDimension(key: "width" | "height", value: number | null, dimensions: { width: number; height: number }, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
    onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function SecondsInput({ value, min, max, theme, onCommit }: { value: number; min: number; max: number; theme: CanvasTheme; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Math.min(max, Math.max(min, Math.floor(Number(input.value) || min)));
        input.value = String(next);
        onCommit(next);
    };

    return (
        <label className="flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={min}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}
