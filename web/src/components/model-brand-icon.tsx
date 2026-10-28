import type { ComponentType } from "react";
import { Cpu } from "lucide-react";
import ClaudeColor from "@lobehub/icons/es/Claude/components/Color";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color";
import DoubaoColor from "@lobehub/icons/es/Doubao/components/Color";
import GeminiColor from "@lobehub/icons/es/Gemini/components/Color";
import KlingColor from "@lobehub/icons/es/Kling/components/Color";
import MinimaxColor from "@lobehub/icons/es/Minimax/components/Color";
import NanoBananaColor from "@lobehub/icons/es/NanoBanana/components/Color";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono";
import QwenColor from "@lobehub/icons/es/Qwen/components/Color";
import ZhipuColor from "@lobehub/icons/es/Zhipu/components/Color";

type BrandIcon = ComponentType<{ size?: number | string }>;

const ICONS: Record<string, BrandIcon> = {
    OpenAI: OpenAIMono,
    "OpenAI.Color": OpenAIMono,
    Claude: ClaudeColor,
    "Claude.Color": ClaudeColor,
    Anthropic: ClaudeColor,
    "Anthropic.Color": ClaudeColor,
    Gemini: GeminiColor,
    "Gemini.Color": GeminiColor,
    Google: GeminiColor,
    "Google.Color": GeminiColor,
    Kling: KlingColor,
    "Kling.Color": KlingColor,
    Doubao: DoubaoColor,
    "Doubao.Color": DoubaoColor,
    Minimax: MinimaxColor,
    "Minimax.Color": MinimaxColor,
    Qwen: QwenColor,
    "Qwen.Color": QwenColor,
    Wan: QwenColor,
    "Wan.Color": QwenColor,
    NanoBanana: NanoBananaColor,
    "NanoBanana.Color": NanoBananaColor,
    Zhipu: ZhipuColor,
    "Zhipu.Color": ZhipuColor,
    DeepSeek: DeepSeekColor,
    "DeepSeek.Color": DeepSeekColor,
};

export function ModelBrandIcon({ icon, size = 16 }: { icon?: string; size?: number }) {
    const Icon = icon ? ICONS[icon] : undefined;
    if (!Icon) return <Cpu className="shrink-0 opacity-70" style={{ width: size, height: size }} />;
    return <Icon size={size} />;
}
