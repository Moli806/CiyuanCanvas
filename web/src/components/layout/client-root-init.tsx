import type { ReactNode } from "react";

// The canvas runs as a managed Ciyuan page: model channels come from the
// dashboard bootstrap and URL credential injection is intentionally disabled.
export function ClientRootInit({ children }: { children: ReactNode }) {
    return <>{children}</>;
}
