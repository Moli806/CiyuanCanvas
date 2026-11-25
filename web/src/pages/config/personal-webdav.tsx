import { useEffect, useRef, useState } from "react";
import { Button, Form, Input } from "antd";
import { Download, Upload, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";

import { testWebdavConnection } from "@/services/webdav-sync";
import { useCiyuanStore } from "@/stores/use-ciyuan-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";
import { forgetWebdavProfile, readWebdavProfile, rememberWebdavProfile } from "./webdav-profile";

type Action = "test" | "backup" | "restore";

export function PersonalWebdav({ owner }: { owner: number }) {
    const { t, i18n } = useTranslation();
    const [config, setConfig] = useState(() => readWebdavProfile(owner));
    const [busy, setBusy] = useState<Action | null>(null);
    const [status, setStatus] = useState("");
    const operation = useRef<AbortController | null>(null);

    useEffect(() => {
        const cancel = () => operation.current?.abort();
        const unsubscribe = useCiyuanStore.subscribe((state) => {
            if (state.user?.id !== owner || state.status !== "ready") cancel();
        });
        const onStorage = (event: StorageEvent) => {
            if (event.key === "ciyuan-canvas-owner" && event.newValue !== String(owner)) {
                cancel();
                void useCiyuanStore.getState().refresh();
            }
        };
        window.addEventListener("storage", onStorage);
        return () => {
            cancel();
            unsubscribe();
            window.removeEventListener("storage", onStorage);
        };
    }, [owner]);

    function change(field: keyof WebdavSyncConfig, value: string) {
        setStatus("");
        setConfig((previous) => ({
            ...previous,
            ...(field === "url" || field === "username" ? { password: "" } : {}),
            ...(field !== "password" ? { lastSyncedAt: "" } : {}),
            [field]: value,
        }));
    }

    async function run(action: Action) {
        if (operation.current) return;
        if (localStorage.getItem("ciyuan-canvas-owner") !== String(owner)) {
            await useCiyuanStore.getState().refresh();
            return;
        }
        const controller = new AbortController();
        operation.current = controller;
        const { signal } = controller;
        const profile = { ...config };
        setBusy(action);
        setStatus("");
        try {
            let resultText = t("config.webdav.available");
            if (action === "test") {
                await testWebdavConnection(profile, signal);
            } else {
                const { backupAppDataToWebdav, restoreAppDataFromWebdav } = await import("@/services/app-sync");
                signal.throwIfAborted();
                const transfer = action === "backup" ? backupAppDataToWebdav : restoreAppDataFromWebdav;
                const result = await transfer(profile, (event) => {
                    if (!signal.aborted) setStatus(event.total ? `${event.stage} · ${event.current ?? 0}/${event.total}` : event.stage);
                }, signal);
                profile.lastSyncedAt = result.syncedAt;
                resultText = t(action === "backup" ? "config.personal.backupDone" : "config.personal.restoreDone", {
                    projects: result.projects, assets: result.assets, records: result.imageLogs + result.videoLogs, files: result.files,
                });
                if (result.missingFiles) resultText += ` ${t("config.personal.missingFiles", { count: result.missingFiles })}`;
            }
            signal.throwIfAborted();
            rememberWebdavProfile(owner, profile);
            setConfig(profile);
            setStatus(resultText);
        } catch (error) {
            if (!signal.aborted) setStatus(error instanceof Error ? error.message : t("config.webdav.failed"));
        } finally {
            operation.current = null;
            setBusy(null);
        }
    }

    return (
        <section className="border-t border-border pt-5" aria-labelledby="personal-webdav-title">
            <h2 id="personal-webdav-title" className="text-base font-semibold">{t("config.personal.webdavTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("config.personal.webdavHelp", { origin: window.location.origin })}</p>
            <Form component="div" layout="vertical" requiredMark={false} disabled={Boolean(busy)} className="mt-4">
                <div className="grid gap-x-4 sm:grid-cols-2">
                    <Form.Item label={t("config.webdav.url")} htmlFor="personal-webdav-url">
                        <Input id="personal-webdav-url" type="url" value={config.url} placeholder="https://nas.example.com/dav/" autoComplete="off" onChange={(event) => change("url", event.target.value)} />
                    </Form.Item>
                    <Form.Item label={t("config.webdav.directory")} htmlFor="personal-webdav-directory">
                        <Input id="personal-webdav-directory" value={config.directory} onChange={(event) => change("directory", event.target.value)} />
                    </Form.Item>
                    <Form.Item label={t("config.webdav.username")} htmlFor="personal-webdav-user">
                        <Input id="personal-webdav-user" value={config.username} autoComplete="off" onChange={(event) => change("username", event.target.value)} />
                    </Form.Item>
                    <Form.Item label={t("config.webdav.password")} htmlFor="personal-webdav-password">
                        <Input.Password id="personal-webdav-password" value={config.password} autoComplete="new-password" onChange={(event) => change("password", event.target.value)} />
                    </Form.Item>
                </div>
            </Form>
            <p className="text-sm text-muted-foreground">{t("config.personal.passwordHelp")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("config.personal.directoryHelp")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
                <Button icon={<Wifi size={15} />} disabled={!config.url.trim() || Boolean(busy)} loading={busy === "test"} onClick={() => void run("test")}>{t("config.webdav.test")}</Button>
                <Button type="primary" icon={<Upload size={15} />} disabled={!config.url.trim() || Boolean(busy)} loading={busy === "backup"} onClick={() => void run("backup")}>{t("config.personal.backup")}</Button>
                <Button icon={<Download size={15} />} disabled={!config.url.trim() || Boolean(busy)} loading={busy === "restore"} onClick={() => void run("restore")}>{t("config.personal.restore")}</Button>
                <Button type="text" disabled={Boolean(busy)} onClick={() => { forgetWebdavProfile(owner); setConfig(readWebdavProfile(owner)); setStatus(""); }}>{t("config.personal.forget")}</Button>
            </div>
            <div className="mt-3 text-sm" role="status" aria-live="polite">{status}</div>
            {config.lastSyncedAt && <p className="text-xs text-muted-foreground">{t("config.personal.lastTransfer", { time: new Date(config.lastSyncedAt).toLocaleString(i18n.language) })}</p>}
        </section>
    );
}
