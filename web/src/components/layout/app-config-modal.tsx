import { App, Button, Form, Input, Modal, Radio, Select, Switch, Tabs } from "antd";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { videoResolutionOptions } from "@/components/video-settings-panel";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ConfigLocalProxy } from "@/components/layout/config-local-proxy";
import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import { PersonalWebdav } from "@/pages/config/personal-webdav";
import { useCiyuanStore } from "@/stores/use-ciyuan-store";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaScaleOptions, parseVideoResolution } from "@/lib/media-size";
import { createModelChannel, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    labelKey: string;
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "config.preferences.defaultVideoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "config.preferences.defaultAudioModel" },
];

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const configInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannelId, setEditingChannelId] = useState("");
    const owner = useCiyuanStore((state) => state.user?.id);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    const imageResolutionOptions = mediaScaleOptions.map((value) => ({ value, label: value === "auto" ? t("settingsPanels.common.auto") : value.toUpperCase() }));
    useEffect(() => setActiveTab(initialTab), [initialTab]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(t(shouldPromptContinue ? "config.savedContinue" : "config.saved"));
        clearPromptContinue();
    };

    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            message.success(t("config.imported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.importFailed"));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        const channel = createModelChannel({ name: t("config.channels.numberedName", { count: config.channels.length + 1 }) });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("config.channels.keepOne"));
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="text-xs text-stone-500">{t("config.fileSecurity")}</div>
                <div className="flex gap-2">
                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>
                        {t("config.import")}
                    </Button>
                    <Button icon={<Download className="size-4" />} onClick={exportAppConfig}>
                        {t("config.export")}
                    </Button>
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: t("config.tabs.channels"),
                        children: (
                            <div>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-stone-500">{t("config.channels.description")}</div>
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                        {t("config.channels.add")}
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {config.channels.map((channel) => (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold">{channel.name || t("config.channels.unnamed")}</div>
                                                <div className="mt-1 truncate text-xs text-stone-500">
                                                    {apiFormatLabel(channel.apiFormat)} · {t("config.channels.modelCount", { count: channel.models.length })} · {channel.baseUrl || t("config.channels.missingUrl")}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>
                                                    {t("common.edit")}
                                                </Button>
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "local-proxy",
                        label: t("config.tabs.localProxy"),
                        children: <ConfigLocalProxy />,
                    },
                    {
                        key: "preferences",
                        label: t("config.tabs.preferences"),
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}</div>
                                <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={t(group.labelKey)} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.generation")}</div>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountDescription")} className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.imageResolution")} className="mb-4">
                                        <Select value={inferMediaScale(config.size)} options={imageResolutionOptions} onChange={(scale) => updateConfig("size", computeMediaSize(scale, inferMediaRatio(config.size)))} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.videoResolution")} className="mb-4">
                                        <Select value={parseVideoResolution(config.vquality)} options={videoResolutionOptions} onChange={(value) => updateConfig("vquality", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioVoice")} className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioFormat")} className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioSpeed")} className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label={t("config.preferences.regenerateBehavior")} className="mb-4">
                                    <Radio.Group value={config.nodeRegenerateBehavior} onChange={(event) => updateConfig("nodeRegenerateBehavior", event.target.value)} className="flex flex-col gap-2">
                                        <Radio value="overwrite">
                                            <span className="block text-sm font-medium">{t("config.preferences.regenerateBehaviorOverwrite")}</span>
                                            <span className="mt-0.5 block text-xs opacity-60">{t("config.preferences.regenerateBehaviorOverwriteDescription")}</span>
                                        </Radio>
                                        <Radio value="new-node">
                                            <span className="block text-sm font-medium">{t("config.preferences.regenerateBehaviorNewNode")}</span>
                                            <span className="mt-0.5 block text-xs opacity-60">{t("config.preferences.regenerateBehaviorNewNodeDescription")}</span>
                                        </Radio>
                                    </Radio.Group>
                                </Form.Item>
                                <Form.Item className="mb-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-sm">{t("config.preferences.autoFocusOnSelect")}</span>
                                        <Switch checked={config.autoFocusOnSelect} onChange={(checked) => updateConfig("autoFocusOnSelect", checked)} />
                                    </div>
                                </Form.Item>
                                <Form.Item label={t("config.preferences.audioInstructions")} className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("config.preferences.audioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "prompt-sources",
                        label: t("config.tabs.promptSources"),
                        children: <ConfigPromptSources />,
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: owner ? <PersonalWebdav key={owner} owner={owner} /> : null,
                    },
                    {
                        key: "local-storage",
                        label: t("config.tabs.localStorage"),
                        children: <ConfigLocalStorage active={activeTab === "local-storage"} />,
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        {t("common.done")}
                    </Button>
                </div>
            ) : null}
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
        </>
    );
}

export function AppConfigModal() {
    const { t } = useTranslation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">{t("config.title")}</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("config.modalDescription")}</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return "Gemini";
    return "OpenAI";
}
