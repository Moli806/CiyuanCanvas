import { ImagePlus, Images, Maximize2, Video } from "lucide-react";

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
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
