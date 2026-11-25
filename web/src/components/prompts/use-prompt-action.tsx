import { useEffect, useRef, useState } from "react";
import { Button, Spin } from "antd";
import { useTranslation } from "react-i18next";
import { resolveLibraryPrompt } from "@/services/api/prompt-library";
import type { Prompt } from "@/services/api/prompts";

export function PromptSourceError({ item, retry }: { item: Prompt; retry: () => void }) {
    const { t } = useTranslation();
    const url = item.entryUrl || item.githubUrl;
    return <div role="alert" className="my-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {t("prompts.textUnavailable")}
        <Button size="small" onClick={retry}>{t("common.retry")}</Button>
        {url?.startsWith("https://") ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">{t("prompts.originalSource")}</a> : null}
    </div>;
}

type PromptAction = { item: Prompt; apply: (resolved: Prompt) => void; failed: boolean };

export function usePromptAction(enabled = true) {
    const [action, setAction] = useState<PromptAction | null>(null);
    const version = useRef(0);
    useEffect(() => {
        if (!enabled) setAction(null);
        return () => { version.current++; };
    }, [enabled]);

    async function run(item: Prompt, apply: PromptAction["apply"]) {
        const current = ++version.current;
        if (item.prompt) { setAction(null); apply(item); return; }
        setAction({ item, apply, failed: false });
        try {
            const resolved = await resolveLibraryPrompt(item);
            if (current !== version.current) return;
            setAction(null);
            apply(resolved);
        } catch {
            if (current === version.current) setAction({ item, apply, failed: true });
        }
    }

    const feedback = !action ? null : action.failed
        ? <PromptSourceError item={action.item} retry={() => void run(action.item, action.apply)} />
        : <div role="status" className="my-3 flex items-center gap-2 text-sm text-muted-foreground"><Spin size="small" />{action.item.title}</div>;
    return { run, feedback };
}
