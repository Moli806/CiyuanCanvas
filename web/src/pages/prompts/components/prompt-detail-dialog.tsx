import { Copy, FolderPlus } from "lucide-react";
import { Button, Modal, Space, Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { resolveLibraryPrompt } from "@/services/api/prompt-library";
import { PromptSourceError } from "@/components/prompts/use-prompt-action";

export function PromptDetailDialog({ prompt: selected, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const { i18n, t } = useTranslation();
    const content = useQuery({
        queryKey: ["prompt-detail", selected?.nativeSource?.url, selected?.id],
        queryFn: () => resolveLibraryPrompt(selected!),
        enabled: Boolean(selected?.nativeSource && !selected.prompt), retry: false,
    });
    const prompt = selected?.prompt ? selected : content.data ?? selected;
    const originUrl = prompt?.entryUrl || prompt?.githubUrl;
    const references = prompt?.referenceImageUrls.filter((url) => url !== prompt.coverUrl) ?? [];

    return (
        <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={720} centered styles={{ body: { height: "calc(85vh - 55px)", overflow: "hidden" } }}>
            {prompt ? (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-y border-stone-200 py-4 pr-2 dark:border-stone-800">
                        {prompt.coverUrl ? <img src={prompt.coverUrl} alt={prompt.title} className="mb-4 max-h-56 w-full rounded-lg object-contain" crossOrigin="anonymous" referrerPolicy="no-referrer" /> : null}
                        {references.length > 0 ? <div className="mb-4 grid grid-cols-6 gap-2">{references.slice(0, 6).map((url) => <img key={url} src={url} alt="" className="aspect-square w-full rounded-md object-cover" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" />)}</div> : null}
                        <div className="flex flex-wrap gap-1.5">
                            {prompt.tags.map((tag) => (
                                <Tag key={tag} className="m-0">
                                    {tag}
                                </Tag>
                            ))}
                        </div>
                        {prompt.description ? <p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">{prompt.description}</p> : null}
                        {prompt.preview ? <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre> : null}
                        {content.isError && !prompt.prompt ? <PromptSourceError item={prompt} retry={() => void content.refetch()} /> : null}
                        {content.isFetching && !prompt.prompt ? <Spin size="small" /> : null}
                        {prompt.prompt ? <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p> : null}
                        {originUrl?.startsWith("https://") ? <p className="mt-4 text-sm text-muted-foreground">{[prompt.category, prompt.author].filter(Boolean).join(" · ")}{" · "}<a className="underline" href={originUrl} target="_blank" rel="noopener noreferrer">{t("prompts.originalSource")}</a></p> : null}
                        {prompt.createdAt || prompt.updatedAt ? <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">{prompt.createdAt ? t("common.created", { date: formatPromptDate(prompt.createdAt, i18n.resolvedLanguage) }) : null}{prompt.createdAt && prompt.updatedAt ? " · " : null}{prompt.updatedAt ? t("common.updated", { date: formatPromptDate(prompt.updatedAt, i18n.resolvedLanguage) }) : null}</div> : null}
                    </div>
                    <div className="shrink-0 pt-4">
                        <Space wrap>
                            <Button type="primary" disabled={!prompt.prompt} icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                {t("common.copyPrompt")}
                            </Button>
                            {onSaveAsset ? (
                                <Button disabled={!prompt.prompt} icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                    {t("common.addToAssets")}
                                </Button>
                            ) : null}
                        </Space>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
