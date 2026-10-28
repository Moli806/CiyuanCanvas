import type { CSSProperties } from "react";
import { useState } from "react";
import { Button, Dropdown, Tooltip, type MenuProps } from "antd";
import { BookOpen, HardDrive, House, KeyRound, LogOut, RefreshCw, UserRound, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";
import { useCiyuanStore } from "@/stores/use-ciyuan-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function CiyuanUserActions({ variant = "default", showPreferences = true }: { variant?: "default" | "canvas"; showPreferences?: boolean }) {
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useCiyuanStore((state) => state.user);
    const quotaPerUnit = useCiyuanStore((state) => state.quotaPerUnit);
    const refresh = useCiyuanStore((state) => state.refresh);
    const logout = useCiyuanStore((state) => state.logout);
    const canvasTheme = canvasThemes[theme];
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const balance = user ? user.quota / (quotaPerUnit || 1) : 0;
    const displayName = user?.display_name || user?.username || t("ciyuan.account");
    const [usage, setUsage] = useState<LocalStorageUsage | null>(null);
    const [usageLoading, setUsageLoading] = useState(false);

    const loadUsage = async () => {
        setUsageLoading(true);
        try {
            setUsage(await readLocalStorageUsage());
        } catch {
            setUsage(null);
        } finally {
            setUsageLoading(false);
        }
    };

    const storageLabel = usage
        ? t("ciyuan.localStorageUsage", {
              used: formatStorageBytes(usage.contentBytes),
              quota: usage.quota ? formatStorageBytes(usage.quota) : "—",
          })
        : t(usageLoading ? "ciyuan.localStorageLoading" : "ciyuan.localStorageUnavailable");

    const items: MenuProps["items"] = [
        {
            key: "balance",
            disabled: true,
            label: (
                <div className="min-w-44 py-1">
                    <div className="text-xs text-stone-500">{t("ciyuan.balance")}</div>
                    <div className="mt-1 text-base font-semibold">{formatBalance(balance, t("ciyuan.balanceUnit"))}</div>
                </div>
            ),
        },
        { key: "refresh", icon: <RefreshCw className="size-4" />, label: t("ciyuan.refresh") },
        { key: "storage", disabled: true, icon: <HardDrive className="size-4" />, label: storageLabel },
        { type: "divider" },
        { key: "wallet", icon: <Wallet className="size-4" />, label: t("ciyuan.wallet") },
        { key: "keys", icon: <KeyRound className="size-4" />, label: t("ciyuan.keys") },
        { key: "home", icon: <House className="size-4" />, label: t("ciyuan.home") },
        { key: "docs", icon: <BookOpen className="size-4" />, label: t("ciyuan.docs") },
        { type: "divider" },
        { key: "logout", danger: true, icon: <LogOut className="size-4" />, label: t("ciyuan.logout") },
    ];

    const onMenuClick: MenuProps["onClick"] = ({ key }) => {
        if (key === "refresh") {
            void refresh(true);
            return;
        }
        if (key === "wallet") window.location.assign("/wallet");
        if (key === "keys") window.location.assign("/keys");
        if (key === "home") window.location.assign("/");
        if (key === "docs") window.open("https://ciyuanweb.cn/docs/#guide/ciyuan-canvas", "_blank", "noopener,noreferrer");
        if (key === "logout") void logout();
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {showPreferences ? (
                <>
                    <Tooltip title={t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS")} mouseEnterDelay={0.2}>
                        <button
                            type="button"
                            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[11px] font-semibold text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
                            style={iconStyle}
                            onClick={() => void changeAppLocale(nextLocale)}
                        >
                            {locale === "zh-CN" ? "中" : "EN"}
                        </button>
                    </Tooltip>
                    <AnimatedThemeToggler
                        theme={theme}
                        onThemeChange={setTheme}
                        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4"
                        style={iconStyle}
                        aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
                        title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
                    />
                </>
            ) : null}
            <Dropdown
                trigger={["click"]}
                menu={{ items, onClick: onMenuClick }}
                onOpenChange={(open) => {
                    if (open) {
                        void refresh(true);
                        void loadUsage();
                    }
                }}
            >
                <Button
                    size="small"
                    type="text"
                    className="!h-8 !max-w-[240px] !justify-start !rounded-full !px-2.5"
                    style={{ background: variant === "canvas" ? canvasTheme.node.fill : undefined, color: variant === "canvas" ? canvasTheme.node.text : undefined }}
                >
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                        <UserRound className="size-3.5 shrink-0" />
                        <span className="max-w-[110px] truncate">{displayName}</span>
                        <span className="shrink-0 text-[11px] opacity-70">{formatBalance(balance, t("ciyuan.balanceUnit"))}</span>
                    </span>
                </Button>
            </Dropdown>
        </div>
    );
}

function formatBalance(balance: number, unit: string) {
    return `${unit}${balance.toFixed(2)}`;
}

function formatStorageBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}
