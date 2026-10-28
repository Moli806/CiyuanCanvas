export const APP_VERSION = __APP_VERSION__ || "dev";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://ciyuanweb.cn/docs/";

// Remote node plugins are disabled in the managed Ciyuan build.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "";
