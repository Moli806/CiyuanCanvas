import { useEffect, type ReactNode } from "react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { BrandLogo } from "@/components/layout/brand-logo";
import { useCiyuanStore } from "@/stores/use-ciyuan-store";
import { pullAndMergeCanvasProjects } from "@/services/canvas-project-sync";
import { resumeImageAttempts } from "@/services/image-attempts";

export function CiyuanGate({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const status = useCiyuanStore((state) => state.status);
    const error = useCiyuanStore((state) => state.error);
    const refresh = useCiyuanStore((state) => state.refresh);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        const storage = navigator.storage;
        if (storage?.persist) void storage.persist().catch(() => undefined);
    }, []);

    useEffect(() => {
        if (status !== "ready") return;
        let cancelled = false;
        void (async () => {
            await pullAndMergeCanvasProjects().catch(() => undefined);
            const recovered = await resumeImageAttempts().catch(() => 0);
            if (!cancelled && recovered > 0) useCiyuanStore.getState().setRecoveredImages(recovered);
        })();
        return () => {
            cancelled = true;
        };
    }, [status]);

    useEffect(() => {
        if (status !== "unauthenticated") return;
        const redirect = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/sign-in?redirect=${encodeURIComponent(redirect)}`);
    }, [status]);

    useEffect(() => {
        if (status !== "ready") return;
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") void refresh(true);
        }, 60_000);
        return () => window.clearInterval(timer);
    }, [refresh, status]);

    if (status === "ready") return <>{children}</>;

    return (
        <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground">
            <div className="flex items-center gap-2 text-lg font-semibold">
                <BrandLogo className="size-8" />
                <span>{t("meta.title")}</span>
            </div>
            {status === "error" ? (
                <>
                    <div className="max-w-md text-sm text-stone-500">{error || t("ciyuan.loadFailed")}</div>
                    <Button type="primary" onClick={() => void refresh()}>
                        {t("ciyuan.retry")}
                    </Button>
                </>
            ) : (
                <div className="text-sm text-stone-500">{status === "unauthenticated" ? t("ciyuan.loginRedirect") : t("ciyuan.loading")}</div>
            )}
        </div>
    );
}
