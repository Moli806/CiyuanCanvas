import { Info, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const DISMISS_KEY = "ciyuan-canvas:local-data-notice-dismissed";

export function LocalDataNotice() {
    const { t } = useTranslation();
    const [dismissed, setDismissed] = useState(() => window.sessionStorage.getItem(DISMISS_KEY) === "1");

    if (dismissed) return null;

    const dismiss = () => {
        window.sessionStorage.setItem(DISMISS_KEY, "1");
        setDismissed(true);
    };

    return (
        <div
            role="status"
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200"
        >
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t("localDataNotice.text")}</span>
            <Link className="font-medium underline underline-offset-2" to="/assets">
                {t("localDataNotice.action")}
            </Link>
            <button
                type="button"
                className="ml-1 inline-flex size-5 items-center justify-center rounded text-amber-700 transition hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
                aria-label={t("localDataNotice.dismiss")}
                title={t("localDataNotice.dismiss")}
                onClick={dismiss}
            >
                <X className="size-3.5" aria-hidden="true" />
            </button>
        </div>
    );
}
