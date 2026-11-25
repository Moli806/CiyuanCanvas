import { BookOpen, ImagePlus, Images, Maximize2, Settings, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    {
        slug: "assets",
        icon: Images,
    },
    {
        slug: "prompts",
        icon: BookOpen,
    },
    {
        slug: "config",
        icon: Settings,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
