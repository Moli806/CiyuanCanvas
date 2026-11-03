import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Modal } from "antd";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { fetchCiyuanTextModels, getCiyuanModel, type CiyuanTextModel } from "@/services/ciyuan";
import { encodeChannelModel, modelOptionName, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useCiyuanStore } from "@/stores/use-ciyuan-store";

type PromptOptimizerKind = "image" | "video";

type PromptOptimizerDialogProps = {
    open: boolean;
    kind: PromptOptimizerKind;
    initialPrompt: string;
    onClose: () => void;
    onApply: (prompt: string) => void;
};

type Variant = {
    id: number;
    status: "running" | "done" | "error";
    content: string;
    error?: string;
};

const MAX_VARIANTS = 5;

const INSTRUCTIONS: Record<PromptOptimizerKind, string> = {
    image: "你是一名资深的 AI 生图提示词工程师。请把用户给出的粗略描述扩写成一条可直接用于生图模型的高质量提示词。保留原意和关键主体；补充主体细节、环境、构图、镜头、光线、色调、材质和风格；不要添加与原描述冲突的内容。只输出优化后的提示词本身，不要解释、不要分点、不要引号或代码块。输出语言与用户输入保持一致。",
    video: "你是一名资深的 AI 视频提示词工程师。请把用户给出的粗略描述扩写成一条可直接用于视频生成模型的高质量提示词。保留原意和关键主体；补充主体动作、镜头运动、节奏、场景、光线、色调、材质和风格；不要写秒数、分辨率或模型参数，不要添加与原描述冲突的内容。只输出优化后的提示词本身，不要解释、不要分点、不要引号或代码块。输出语言与用户输入保持一致。",
};

function normalizePrompt(text: string) {
    let value = text.trim();
    const fenced = value.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
    if (fenced) value = fenced[1].trim();
    return value.replace(/^(优化后的提示词|优化提示词|提示词|prompt)\s*[:：]\s*/i, "").trim();
}

export function PromptOptimizerDialog({ open, kind, initialPrompt, onClose, onApply }: PromptOptimizerDialogProps) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const config = useEffectiveConfig();
    const group = useCiyuanStore((state) => state.user?.group || "default");
    const [draft, setDraft] = useState(initialPrompt);
    const [model, setModel] = useState("");
    const [count, setCount] = useState(3);
    const [variants, setVariants] = useState<Variant[]>([]);
    const [textModels, setTextModels] = useState<CiyuanTextModel[]>([]);
    const [running, setRunning] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const promptConfig = useMemo(() => {
        if (!textModels.length) return config;
        const channel = config.channels.find((item) => item.id === "ciyuan") ?? config.channels[0];
        if (!channel) return config;
        const models = textModels
            .filter((item) => {
                const capability = getCiyuanModel(item.id)?.capability;
                return !capability || capability === "text";
            })
            .map((item) => ({ name: item.id, capability: "text" as const }));
        if (!models.length) return config;
        return {
            ...config,
            channels: [{ ...channel, models }],
            models: models.map((item) => encodeChannelModel(channel.id, item.name)),
        };
    }, [config, textModels]);
    const availableModels = useMemo(() => selectableModelsByCapability(promptConfig, "text"), [promptConfig]);
    const defaultModel = useMemo(() => {
        const currentName = modelOptionName(config.textModel);
        return availableModels.find((item) => modelOptionName(item) === currentName) || availableModels[0] || "";
    }, [availableModels, config.textModel]);

    useEffect(() => {
        if (!open) return;
        setDraft(initialPrompt);
        setVariants([]);
        setRunning(false);
        abortRef.current?.abort();
        abortRef.current = null;
        // Only re-seed when the dialog opens; bootstrap refreshes must not overwrite the draft.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        fetchCiyuanTextModels(group)
            .then((models) => {
                if (!cancelled) setTextModels(models);
            })
            .catch(() => {
                if (!cancelled) message.warning(t("promptOptimizer.modelListFallback"));
            });
        return () => {
            cancelled = true;
        };
    }, [open, group, message, t]);

    useEffect(() => {
        if (!open) return;
        setModel((current) => (current && availableModels.includes(current) ? current : defaultModel));
    }, [open, availableModels, defaultModel]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const start = async () => {
        const text = draft.trim();
        if (!text) {
            message.warning(t("promptOptimizer.promptRequired"));
            return;
        }
        if (!model) {
            message.warning(t("promptOptimizer.noModel"));
            return;
        }
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const ids = Array.from({ length: count }, (_, index) => index);
        setRunning(true);
        setVariants(ids.map((id) => ({ id, status: "running", content: "" })));
        const requestConfig = { ...promptConfig, model, systemPrompt: "" };
        const messages: AiTextMessage[] = [
            { role: "system", content: INSTRUCTIONS[kind] },
            { role: "user", content: text },
        ];
        await Promise.all(
            ids.map(async (id) => {
                try {
                    const answer = await requestImageQuestion(requestConfig, messages, (delta) => setVariants((prev) => prev.map((item) => (item.id === id ? { ...item, content: delta } : item))), { signal: controller.signal });
                    const content = normalizePrompt(answer);
                    setVariants((prev) => prev.map((item) => (item.id === id ? { ...item, status: content ? "done" : "error", content, error: content ? undefined : t("promptOptimizer.emptyResult") } : item)));
                } catch (error) {
                    if (controller.signal.aborted) return;
                    setVariants((prev) => prev.map((item) => (item.id === id ? { ...item, status: "error", error: error instanceof Error ? error.message : t("promptOptimizer.failed") } : item)));
                }
            }),
        );
        if (abortRef.current === controller) {
            abortRef.current = null;
            setRunning(false);
        }
    };

    const stop = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setRunning(false);
        setVariants((prev) => prev.map((item) => (item.status === "running" ? { ...item, status: "error", error: t("promptOptimizer.stopped") } : item)));
    };

    const close = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setRunning(false);
        onClose();
    };

    const apply = (variant: Variant) => {
        const prompt = normalizePrompt(variant.content);
        if (!prompt) return;
        onApply(prompt);
        message.success(t("promptOptimizer.applied"));
        close();
    };

    return (
        <Modal
            open={open}
            onCancel={close}
            footer={null}
            width={720}
            title={
                <span className="flex items-center gap-2">
                    <Sparkles className="size-4" />
                    {t("promptOptimizer.title")}
                </span>
            }
        >
            <div className="space-y-4">
                <p className="text-sm text-stone-500 dark:text-stone-400">{t("promptOptimizer.hint")}</p>
                <div>
                    <div className="mb-1.5 text-sm font-semibold">{t("promptOptimizer.sourceLabel")}</div>
                    <Input.TextArea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} placeholder={t("promptOptimizer.sourcePlaceholder")} />
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <label className="min-w-[220px] flex-1">
                        <span className="mb-1.5 block text-sm font-semibold">{t("promptOptimizer.modelLabel")}</span>
                        <ModelPicker config={promptConfig} value={model} onChange={setModel} capability="text" fullWidth />
                    </label>
                    <label className="w-[120px]">
                        <span className="mb-1.5 block text-sm font-semibold">{t("promptOptimizer.countLabel")}</span>
                        <InputNumber className="w-full" min={1} max={MAX_VARIANTS} precision={0} value={count} disabled={running} onChange={(value) => setCount(Math.max(1, Math.min(MAX_VARIANTS, Number(value) || 1)))} />
                    </label>
                    <Button type="primary" danger={running} icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} onClick={running ? stop : start}>
                        {t(running ? "promptOptimizer.stop" : "promptOptimizer.start")}
                    </Button>
                </div>
                {variants.length ? (
                    <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                        {variants.map((variant, index) => (
                            <div key={variant.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-stone-500 dark:text-stone-400">{t("promptOptimizer.variant", { index: index + 1 })}</span>
                                    {variant.status === "running" ? (
                                        <span className="flex items-center gap-1 text-xs text-stone-500">
                                            <LoaderCircle className="size-3.5 animate-spin" />
                                            {t("promptOptimizer.running")}
                                        </span>
                                    ) : null}
                                    {variant.status === "done" ? (
                                        <Button size="small" type="primary" icon={<Check className="size-3.5" />} onClick={() => apply(variant)}>
                                            {t("promptOptimizer.apply")}
                                        </Button>
                                    ) : null}
                                </div>
                                {variant.status === "error" ? <p className="text-sm text-red-600 dark:text-red-400">{variant.error}</p> : <p className="whitespace-pre-wrap break-words text-sm leading-6">{variant.content || "…"}</p>}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="rounded-lg border border-dashed border-stone-300 px-3 py-6 text-center text-sm text-stone-500 dark:border-stone-700">{t("promptOptimizer.empty")}</p>
                )}
            </div>
        </Modal>
    );
}
