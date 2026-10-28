import { useThemeStore } from "@/stores/use-theme-store";

export function BrandLogo({ className = "size-6" }: { className?: string }) {
    const theme = useThemeStore((state) => state.theme);
    const file = theme === "dark" ? "ciyuan-logo-dark.svg" : "ciyuan-logo-light.svg";
    return <img src={`${import.meta.env.BASE_URL}brand/${file}?v=2`} alt="" className={`${className} shrink-0 object-contain`} />;
}
