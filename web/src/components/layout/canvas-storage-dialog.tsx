import { useCallback, useEffect, useState } from "react";
import { App, Button, Popconfirm, Select, Spin } from "antd";
import { Download, HardDrive, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cleanupCanvasServerAssets, deleteCanvasServerAsset, fetchCanvasStorage, saveCanvasRetentionDays, type CiyuanCanvasAsset, type CiyuanCanvasStorage } from "@/services/ciyuan";
import { useCiyuanStore } from "@/stores/use-ciyuan-store";

const RETENTION_OPTIONS = [1, 3, 7, 14, 30];

export function CanvasStorageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const setStorage = useCiyuanStore((state) => state.setStorage);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [storage, setLocalStorage] = useState<CiyuanCanvasStorage | null>(null);
    const [assets, setAssets] = useState<CiyuanCanvasAsset[]>([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchCanvasStorage();
            setLocalStorage(data.storage);
            setAssets(data.assets);
            setStorage(data.storage);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvasStorage.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [message, setStorage, t]);

    useEffect(() => {
        if (open) void load();
    }, [open, load]);

    const changeRetention = async (days: number) => {
        setBusy(true);
        try {
            const next = await saveCanvasRetentionDays(days);
            setLocalStorage(next);
            setStorage(next);
            message.success(t("canvasStorage.saved", { days }));
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvasStorage.saveFailed"));
        } finally {
            setBusy(false);
        }
    };

    const cleanup = async () => {
        setBusy(true);
        try {
            const result = await cleanupCanvasServerAssets();
            setLocalStorage(result.storage);
            setStorage(result.storage);
            message.success(t("canvasStorage.cleaned", { count: result.deleted, size: formatBytes(result.freed) }));
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvasStorage.cleanFailed"));
        } finally {
            setBusy(false);
        }
    };

    const removeAsset = async (name: string) => {
        setBusy(true);
        try {
            await deleteCanvasServerAsset(name);
            message.success(t("canvasStorage.deleted"));
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvasStorage.deleteFailed"));
        } finally {
            setBusy(false);
        }
    };

    const used = storage?.used_bytes || 0;
    const quota = storage?.quota_bytes || 0;
    const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
    const now = Date.now() / 1000;

    return (
        <div className={`fixed inset-0 z-[1300] flex items-center justify-center bg-black/45 px-4 ${open ? "" : "hidden"}`} onMouseDown={onClose}>
            <div className="max-h-[86dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-950" onMouseDown={(event) => event.stopPropagation()}>
                <div className="mb-4 flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
                    <HardDrive className="size-4" />
                    {t("canvasStorage.title")}
                </div>
                {loading ? (
                    <div className="flex justify-center py-8">
                        <Spin />
                    </div>
                ) : (
                    <div className="space-y-4 text-sm text-stone-700 dark:text-stone-300">
                        <div>
                            <div className="mb-1.5 flex items-center justify-between text-xs text-stone-500">
                                <span>{t("canvasStorage.usage", { used: formatBytes(used), quota: formatBytes(quota) })}</span>
                                <span>{percent.toFixed(0)}%</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                                <div className={`h-full rounded-full ${percent >= 90 ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${percent}%` }} />
                            </div>
                            <p className="mt-1.5 text-xs leading-5 text-stone-500">{t("canvasStorage.quotaHint", { assets: storage?.asset_count || 0 })}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-stone-500">{t("canvasStorage.retention")}</span>
                            <Select
                                size="small"
                                className="w-28"
                                value={storage?.retention_days || 7}
                                disabled={busy}
                                options={RETENTION_OPTIONS.map((days) => ({ value: days, label: t("canvasStorage.days", { count: days }) }))}
                                onChange={(value) => void changeRetention(value as number)}
                            />
                            <span className="text-xs leading-5 text-stone-500">{t("canvasStorage.retentionHint")}</span>
                            <Popconfirm title={t("canvasStorage.cleanupConfirm")} okText={t("canvasStorage.cleanup")} cancelText={t("common.cancel")} onConfirm={() => void cleanup()}>
                                <Button size="small" danger disabled={busy}>
                                    {t("canvasStorage.cleanup")}
                                </Button>
                            </Popconfirm>
                        </div>

                        <div>
                            <div className="mb-2 text-xs text-stone-500">{t("canvasStorage.assets")}</div>
                            {assets.length ? (
                                <div className="max-h-64 divide-y divide-stone-100 overflow-y-auto rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                                    {assets.map((asset) => {
                                        const daysLeft = Math.ceil((asset.expires_at - now) / 86400);
                                        return (
                                            <div key={asset.name} className="flex items-center gap-2 px-2.5 py-2 text-xs">
                                                <span className="w-10 shrink-0 text-stone-500">{asset.kind}</span>
                                                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-stone-600 dark:text-stone-400">{asset.name}</span>
                                                <span className="w-16 shrink-0 text-right text-stone-500">{formatBytes(asset.bytes)}</span>
                                                <span className={`w-16 shrink-0 text-right ${daysLeft <= 1 ? "text-red-500" : "text-stone-500"}`}>{t("canvasStorage.expiresIn", { count: Math.max(0, daysLeft) })}</span>
                                                <button type="button" className="shrink-0 text-stone-500 transition hover:text-stone-900 dark:hover:text-stone-100" title={t("canvasStorage.download")} onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")}>
                                                    <Download className="size-3.5" />
                                                </button>
                                                <Popconfirm title={t("canvasStorage.deleteConfirm")} okText={t("common.delete")} cancelText={t("common.cancel")} onConfirm={() => void removeAsset(asset.name)}>
                                                    <button type="button" className="shrink-0 text-stone-500 transition hover:text-red-500" title={t("common.delete")}>
                                                        <Trash2 className="size-3.5" />
                                                    </button>
                                                </Popconfirm>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-xs text-stone-500">{t("canvasStorage.empty")}</p>
                            )}
                        </div>

                        <p className="text-xs leading-5 text-stone-500">{t("canvasStorage.cacheHint")}</p>
                        <div className="flex justify-end">
                            <Button size="small" onClick={onClose}>
                                {t("common.close")}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatBytes(bytes: number) {
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
