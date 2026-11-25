import type { WebdavSyncConfig } from "@/stores/use-config-store";

const profileKey = (owner: number) => `ciyuan-canvas:webdav:${owner}`;

export function readWebdavProfile(owner: number): WebdavSyncConfig {
    const empty = { url: "", username: "", password: "", directory: "ciyuan-canvas", lastSyncedAt: "" };
    const stored = localStorage.getItem(profileKey(owner));
    if (!stored) return empty;
    try {
        const { url, username, directory, lastSyncedAt } = JSON.parse(stored);
        return { url: url || "", username: username || "", password: "", directory: directory ?? empty.directory, lastSyncedAt: lastSyncedAt || "" };
    } catch {
        return empty;
    }
}

export function rememberWebdavProfile(owner: number, { url, username, directory, lastSyncedAt }: WebdavSyncConfig) {
    localStorage.setItem(profileKey(owner), JSON.stringify({ url: url.trim(), username, directory, lastSyncedAt }));
}

export function forgetWebdavProfile(owner: number) {
    localStorage.removeItem(profileKey(owner));
}
