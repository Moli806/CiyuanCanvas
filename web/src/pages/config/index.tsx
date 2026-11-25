import { Form, Radio, Select, Switch } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { computeMediaSize, inferMediaRatio, inferMediaScale, parseVideoResolution } from "@/lib/media-size";
import { useCiyuanStore } from "@/stores/use-ciyuan-store";
import { modelOptionName, useConfigStore } from "@/stores/use-config-store";
import { PersonalWebdav } from "./personal-webdav";

const modelFields = [
    { key: "imageModel", capability: "image", label: "defaultImageModel" },
    { key: "videoModel", capability: "video", label: "defaultVideoModel" },
    { key: "textModel", capability: "text", label: "defaultTextModel" },
] as const;
const countOptions = Array.from({ length: 15 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }));

export default function ConfigPage() {
    const { t } = useTranslation();
    const owner = useCiyuanStore((state) => state.user?.id);
    const models = useCiyuanStore((state) => state.models);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const imageSpec = models.find((model) => model.id === modelOptionName(config.imageModel))?.image;
    const videoSpec = models.find((model) => model.id === modelOptionName(config.videoModel))?.video;
    const imageScales = imageSpec?.resolutions ?? [];
    const videoSizes = (videoSpec?.resolutions ?? []).map((label) => ({ value: parseVideoResolution(label), label }));
    const imageScale = inferMediaScale(config.size);
    const videoSize = parseVideoResolution(config.vquality);
    if (!owner) return null;

    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
                <header>
                    <h1 className="text-xl font-semibold">{t("config.personal.title")}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">{t("config.personal.description")}</p>
                </header>
                <section aria-labelledby="personal-preferences-title">
                    <h2 id="personal-preferences-title" className="text-base font-semibold">{t("config.preferences.generation")}</h2>
                    <Form component="div" layout="vertical" requiredMark={false} className="mt-4">
                        <div className="grid gap-x-4 sm:grid-cols-3">
                            {modelFields.map(({ key, capability, label }) => (
                                <Form.Item key={key} label={t(`config.preferences.${label}`)}>
                                    <ModelPicker config={config} value={config[key]} capability={capability} onChange={(model) => updateConfig(key, model)} fullWidth />
                                </Form.Item>
                            ))}
                            <Form.Item label={t("config.preferences.canvasImageCount")} htmlFor="personal-image-count" extra={t("config.preferences.canvasImageCountDescription")}>
                                <Select id="personal-image-count" options={countOptions} value={config.canvasImageCount} onChange={(value) => updateConfig("canvasImageCount", value)} />
                            </Form.Item>
                            {imageScales.length > 0 && (
                                <Form.Item label={t("config.preferences.imageResolution")} htmlFor="personal-image-scale">
                                    <Select id="personal-image-scale" options={imageScales.map((value) => ({ value, label: value === "auto" ? t("settingsPanels.common.auto") : value.toUpperCase() }))}
                                        value={imageScales.includes(imageScale) ? imageScale : imageScales[0]}
                                        onChange={(value) => {
                                            const ratio = inferMediaRatio(config.size);
                                            updateConfig("size", computeMediaSize(value, ratio === "auto" ? "1:1" : ratio));
                                        }} />
                                </Form.Item>
                            )}
                            {videoSizes.length > 0 && (
                                <Form.Item label={t("config.preferences.videoResolution")} htmlFor="personal-video-size">
                                    <Select id="personal-video-size" options={videoSizes} value={videoSizes.some((item) => item.value === videoSize) ? videoSize : parseVideoResolution(videoSpec?.default_resolution)} onChange={(value) => updateConfig("vquality", value)} />
                                </Form.Item>
                            )}
                        </div>
                        <Form.Item label={t("config.preferences.regenerateBehavior")}>
                            <Radio.Group value={config.nodeRegenerateBehavior} onChange={(event) => updateConfig("nodeRegenerateBehavior", event.target.value)}>
                                <Radio value="new-node">{t("config.preferences.regenerateBehaviorNewNode")}</Radio>
                                <Radio value="overwrite">{t("config.preferences.regenerateBehaviorOverwrite")}</Radio>
                            </Radio.Group>
                        </Form.Item>
                        <label className="flex w-fit items-center gap-3">
                            <Switch checked={config.autoFocusOnSelect} onChange={(checked) => updateConfig("autoFocusOnSelect", checked)} />
                            {t("config.preferences.autoFocusOnSelect")}
                        </label>
                    </Form>
                </section>
                <PersonalWebdav key={owner} owner={owner} />
            </div>
        </main>
    );
}
