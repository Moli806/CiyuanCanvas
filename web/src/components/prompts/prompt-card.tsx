import { Copy, FileText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Card, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";

export function PromptCard({
    item,
    onOpen,
    onCopy,
    actionLabel,
    actionIcon = <Copy className="size-3.5" />,
    actionType = "text",
    extraAction,
    compact = false,
}: {
    item: Prompt;
    onOpen: () => void;
    onCopy: () => void;
    actionLabel?: string;
    actionIcon?: ReactNode;
    actionType?: "text" | "primary";
    extraAction?: ReactNode;
    compact?: boolean;
}) {
    const { i18n, t } = useTranslation();
    const [failedCover, setFailedCover] = useState("");
    return (
        <Card
            hoverable
            className={compact ? "group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1" : "flex h-full flex-col overflow-hidden"}
            styles={{ body: compact ? { padding: 0 } : { display: "flex", flex: 1, flexDirection: "column", padding: 0 } }}
            cover={
                <button type="button" aria-label={item.title} className="block w-full cursor-pointer text-left" onClick={onOpen}>
                    {item.coverUrl && failedCover !== item.coverUrl ? (
                        <img src={item.coverUrl} alt="" className={compact ? "aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" : "aspect-[4/3] w-full object-cover"} loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={() => setFailedCover(item.coverUrl)} />
                    ) : (
                        <span className={`flex w-full flex-col justify-center gap-2 bg-muted p-4 text-muted-foreground ${compact ? "aspect-square" : "aspect-[4/3]"}`}>
                            <FileText className="size-4 shrink-0" />
                            <span className="line-clamp-3 text-xs leading-relaxed">{item.prompt || item.title}</span>
                        </span>
                    )}
                </button>
            }
        >
            <button type="button" className={compact ? "block w-full cursor-pointer text-left" : "block w-full flex-1 cursor-pointer text-left"} onClick={onOpen}>
                <div className={compact ? "px-3 py-2.5" : "p-4"}>
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</h2>
                        {!compact ? <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">{formatPromptDate(item.updatedAt, i18n.resolvedLanguage)}</span> : null}
                    </div>
                    {!compact ? <><p className="mt-2 line-clamp-3 text-xs leading-5 text-stone-600 dark:text-stone-400">{item.description || item.prompt || [item.category, item.author].filter(Boolean).join(" · ")}</p><div className="mt-3 flex flex-wrap gap-1.5">{item.tags.map((tag) => <Tag key={tag} className="m-0 text-[11px]">{tag}</Tag>)}</div></> : null}
                </div>
            </button>
            {!compact ? <div className="mt-auto flex items-center gap-2 px-4 pb-4"><Button block={actionType === "primary"} type={actionType} size="small" icon={actionIcon} onClick={onCopy}>{actionLabel || t("common.copy")}</Button>{extraAction}</div> : null}
        </Card>
    );
}
