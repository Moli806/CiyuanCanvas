import { nanoid } from "nanoid";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";
import { getGroupResourceNodes } from "./canvas-resource-references";

export const PRESET_WORKFLOW_PROJECT_ID = "preset-rooftop-chase-v1";
export const PRESET_WORKFLOW_TITLE = "🎬【官方预设】角色三视图到电影短片 · 一键出片";
export const DEFAULT_PRESET_VIEWPORT = { x: 24, y: 140, k: 0.36 } as const;

function resolveBaseUrl() {
    try {
        return (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
    } catch {
        return "/canvas/";
    }
}
const BASE = resolveBaseUrl();
const tplAsset = (file: string) => `${BASE}templates/rooftop-chase/${file}`;

export const PRESET_ASSETS = {
    portrait: { url: tplAsset("heroine-portrait.jpg"), width: 960, height: 1280, bytes: 114877, mimeType: "image/jpeg" },
    threeView: { url: tplAsset("heroine-three-view.jpg"), width: 1440, height: 810, bytes: 86670, mimeType: "image/jpeg" },
    scene: { url: tplAsset("rooftop-scene.jpg"), width: 1280, height: 720, bytes: 201428, mimeType: "image/jpeg" },
    storyboard: { url: tplAsset("storyboard-sheet.jpg"), width: 1440, height: 810, bytes: 218803, mimeType: "image/jpeg" },
    video: { url: tplAsset("final-video.mp4"), width: 1280, height: 720, bytes: 5198640, mimeType: "video/mp4", durationMs: 30090 },
} as const;

export const PRESET_NODE_IDS = {
    inputPortrait: "preset-input-portrait",
    inputStory: "preset-input-story",
    cfgThreeView: "preset-cfg-threeview",
    cfgScene: "preset-cfg-scene",
    cfgScript: "preset-cfg-script",
    outThreeView: "preset-out-threeview",
    outScene: "preset-out-scene",
    outScript: "preset-out-script",
    cfgStoryboard: "preset-cfg-storyboard",
    outStoryboard: "preset-out-storyboard",
    cfgVideo: "preset-cfg-video",
    outVideo: "preset-out-video",
} as const;

export const PRESET_STORY_TEXT = `【项目题材】30秒韩国高燃动作大片 · 天台绝境追逐

【女主角设定】
留齐下巴粉彩粉色（pastel pink）波波头短发与轻薄刘海的韩国年轻女性，眼神凌厉坚毅；身穿哑光黑色修身战术背心套装、肩带挂具、黑色露指战术手套与系带作战靴。全程所有镜头严格锁死面部五官、发色与服装比例。

【场景与氛围】
夜幕下密集的混凝土高层公寓楼群，一座狭窄摇晃的银色钢管脚手架天桥悬于高空连接两栋天台；清冷蓝灰色月光与远处公寓火光浓烟形成强烈冷暖对比，数十名感染者沿脚手架疯狂追击。`;

export const PRESET_SCRIPT_TEXT = `SCENE 01｜高空脚手架追逐（0:00–0:07）
景别与运镜：广角侧面高速跟拍，带轻微手持震颤感。
画面调度：粉发战术服女主在悬空金属脚手架天桥上全力冲刺，发丝随夜风后扬；身后感染尸群狂奔扑抓，远处楼群火光冲天。

SCENE 02｜钢管倒立极限翻转（0:07–0:14）
景别与运镜：低角度仰拍跟镜，最高点切入短暂电影慢动作。
画面调度：女主冲至竖直钢管前双手死死抓握，借惯性腾空倒立旋转一周避开下方猛扑的感染者，粉色短发随重力垂落。

SCENE 03｜狭窄金属通道冲刺（0:14–0:21）
景别与运镜：正前方中近景快速后退推轨，聚焦面部紧张神情。
画面调度：女主稳稳落地朝镜头方向狂奔，呼吸急促，身后通道护栏在尸群撞击下剧烈摇晃。

SCENE 04｜天台深渊腾空飞跃（0:21–0:30）
景别与运镜：史诗感大远景侧面轮廓跟拍 + 落地特写。
画面调度：脚手架尽头断裂，女主毫不犹豫蹬地跃入高空深渊，身体在月光与火光映衬下舒展飞越两楼间隙，伴随急促脚步声、金属断裂声与管弦打击乐高潮。`;

const PRESET_PROMPTS = {
    threeView:
        "严格参考输入角色的面部五官、粉彩粉色短发波波头与哑光黑色战术背心套装，在深灰网格标准设定背景上生成同一角色的全身正面、侧面、背面标准三视图，保持头身比例、露指手套与作战靴细节完全一致。",
    scene:
        "根据故事设定生成韩国夜景高层混凝土公寓楼群之间的悬空银色钢管脚手架天桥空镜概念图，清冷蓝灰月光与远处建筑火光浓烟形成冷暖对比，电影级写实质感，无人空镜。",
    script:
        "结合角色参考图与故事创意，拆解为一段 30 秒高燃动作短片的 4 个连续电影分镜脚本（含景别运镜与动作调度），全程保持粉发战术服女主外观一致。",
    storyboard:
        "综合角色三视图、高空天台场景设定图与 4 镜动作分镜脚本，生成一张 16:9 电影级 2×2 四宫格关键帧分镜大图：左上横向跟拍脚手架狂奔，右上低角度钢管倒立翻转，左下狭窄通道正面冲刺，右下腾空飞跃两楼天台深渊，全程锁死粉发黑色战术服女主外观。",
    video:
        "严格锁定角色三视图外观与四宫格分镜动作调度，生成一段紧张刺激的超写实韩国动作大片天台脚手架追逐戏：高空狂奔、钢管倒立旋转闪避、通道正面冲刺与飞跃天台深渊，镜头无缝追踪，带真实金属脚步、呼吸与电影管弦打击乐音效。",
} as const;

type PresetStepSpec = {
    configId: string;
    outputId: string;
    mode: CanvasGenerationMode;
    model: string;
    prompt: string;
    upstreamIds: string[];
    size?: string;
    quality?: string;
    count?: number;
    textCount?: number;
    vquality?: string;
    seconds?: string;
    videoMode?: string;
};

export const PRESET_STEPS: Record<string, PresetStepSpec> = {
    [PRESET_NODE_IDS.cfgThreeView]: {
        configId: PRESET_NODE_IDS.cfgThreeView,
        outputId: PRESET_NODE_IDS.outThreeView,
        mode: "image",
        model: "gpt-image-2.6-flare",
        prompt: PRESET_PROMPTS.threeView,
        upstreamIds: [PRESET_NODE_IDS.inputPortrait, PRESET_NODE_IDS.inputStory],
        size: "16:9",
        quality: "high",
        count: 1,
    },
    [PRESET_NODE_IDS.cfgScene]: {
        configId: PRESET_NODE_IDS.cfgScene,
        outputId: PRESET_NODE_IDS.outScene,
        mode: "image",
        model: "banana-2.1",
        prompt: PRESET_PROMPTS.scene,
        upstreamIds: [PRESET_NODE_IDS.inputStory],
        size: "16:9",
        count: 1,
    },
    [PRESET_NODE_IDS.cfgScript]: {
        configId: PRESET_NODE_IDS.cfgScript,
        outputId: PRESET_NODE_IDS.outScript,
        mode: "text",
        model: "gpt-6-astra",
        prompt: PRESET_PROMPTS.script,
        upstreamIds: [PRESET_NODE_IDS.inputPortrait, PRESET_NODE_IDS.inputStory],
        textCount: 1,
    },
    [PRESET_NODE_IDS.cfgStoryboard]: {
        configId: PRESET_NODE_IDS.cfgStoryboard,
        outputId: PRESET_NODE_IDS.outStoryboard,
        mode: "image",
        model: "gpt-image-2.6-sunburst",
        prompt: PRESET_PROMPTS.storyboard,
        upstreamIds: [PRESET_NODE_IDS.outThreeView, PRESET_NODE_IDS.outScene, PRESET_NODE_IDS.outScript],
        size: "16:9",
        quality: "high",
        count: 1,
    },
    [PRESET_NODE_IDS.cfgVideo]: {
        configId: PRESET_NODE_IDS.cfgVideo,
        outputId: PRESET_NODE_IDS.outVideo,
        mode: "video",
        model: "Seedance-2.5-480p",
        prompt: PRESET_PROMPTS.video,
        upstreamIds: [PRESET_NODE_IDS.outThreeView, PRESET_NODE_IDS.outStoryboard, PRESET_NODE_IDS.outScript],
        size: "16:9",
        vquality: "480p",
        seconds: "30",
        videoMode: "reference",
    },
};

function presetImageSlot(id: string, asset: { url: string; width: number; height: number; bytes: number; mimeType: string }): CanvasNodeImage {
    return {
        id: `${id}-img`,
        status: "success",
        content: asset.url,
        naturalWidth: asset.width,
        naturalHeight: asset.height,
        bytes: asset.bytes,
        mimeType: asset.mimeType,
    };
}

export function buildPresetWorkflowGraph(): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
    const portraitImg = presetImageSlot(PRESET_NODE_IDS.inputPortrait, PRESET_ASSETS.portrait);
    const threeViewImg = presetImageSlot(PRESET_NODE_IDS.outThreeView, PRESET_ASSETS.threeView);
    const sceneImg = presetImageSlot(PRESET_NODE_IDS.outScene, PRESET_ASSETS.scene);
    const storyboardImg = presetImageSlot(PRESET_NODE_IDS.outStoryboard, PRESET_ASSETS.storyboard);

    const nodes: CanvasNodeData[] = [
        {
            id: PRESET_NODE_IDS.inputPortrait,
            type: CanvasNodeType.Image,
            title: "① 角色原画参考（可点上传换你的角色）",
            position: { x: 60, y: 70 },
            width: 255,
            height: 340,
            metadata: {
                content: PRESET_ASSETS.portrait.url,
                status: "success",
                naturalWidth: PRESET_ASSETS.portrait.width,
                naturalHeight: PRESET_ASSETS.portrait.height,
                bytes: PRESET_ASSETS.portrait.bytes,
                mimeType: PRESET_ASSETS.portrait.mimeType,
                images: [portraitImg],
                primaryImageId: portraitImg.id,
            },
        },
        {
            id: PRESET_NODE_IDS.inputStory,
            type: CanvasNodeType.Text,
            title: "② 故事创意与角色设定（双击可改字）",
            position: { x: 60, y: 460 },
            width: 332,
            height: 300,
            metadata: {
                content: PRESET_STORY_TEXT,
                prompt: PRESET_STORY_TEXT,
                status: "success",
                fontSize: 13,
            },
        },
        {
            id: PRESET_NODE_IDS.cfgThreeView,
            type: CanvasNodeType.Config,
            title: "生成配置 A · 角色三视图锁定",
            position: { x: 456, y: 40 },
            width: 340,
            height: 240,
            metadata: {
                generationMode: "image",
                model: "gpt-image-2.6-flare",
                size: "16:9",
                quality: "high",
                count: 1,
                prompt: PRESET_PROMPTS.threeView,
                status: "success",
            },
        },
        {
            id: PRESET_NODE_IDS.cfgScene,
            type: CanvasNodeType.Config,
            title: "生成配置 B · 场景气氛概念图",
            position: { x: 456, y: 330 },
            width: 340,
            height: 240,
            metadata: {
                generationMode: "image",
                model: "banana-2.1",
                size: "16:9",
                count: 1,
                prompt: PRESET_PROMPTS.scene,
                status: "success",
            },
        },
        {
            id: PRESET_NODE_IDS.cfgScript,
            type: CanvasNodeType.Config,
            title: "生成配置 C · AI 电影分镜拆解",
            position: { x: 456, y: 620 },
            width: 340,
            height: 240,
            metadata: {
                generationMode: "text",
                model: "gpt-6-astra",
                textCount: 1,
                prompt: PRESET_PROMPTS.script,
                status: "success",
            },
        },
        {
            id: PRESET_NODE_IDS.outThreeView,
            type: CanvasNodeType.Image,
            title: "角色标准三视图（正 / 侧 / 背）",
            position: { x: 860, y: 58 },
            width: 352,
            height: 198,
            metadata: {
                content: PRESET_ASSETS.threeView.url,
                prompt: PRESET_PROMPTS.threeView,
                model: "gpt-image-2.6-flare",
                size: "16:9",
                quality: "high",
                generationType: "edit",
                references: [PRESET_ASSETS.portrait.url],
                status: "success",
                naturalWidth: PRESET_ASSETS.threeView.width,
                naturalHeight: PRESET_ASSETS.threeView.height,
                bytes: PRESET_ASSETS.threeView.bytes,
                mimeType: PRESET_ASSETS.threeView.mimeType,
                images: [threeViewImg],
                primaryImageId: threeViewImg.id,
            },
        },
        {
            id: PRESET_NODE_IDS.outScene,
            type: CanvasNodeType.Image,
            title: "高空脚手架夜景设定图",
            position: { x: 860, y: 348 },
            width: 352,
            height: 198,
            metadata: {
                content: PRESET_ASSETS.scene.url,
                prompt: PRESET_PROMPTS.scene,
                model: "banana-2.1",
                size: "16:9",
                generationType: "generation",
                status: "success",
                naturalWidth: PRESET_ASSETS.scene.width,
                naturalHeight: PRESET_ASSETS.scene.height,
                bytes: PRESET_ASSETS.scene.bytes,
                mimeType: PRESET_ASSETS.scene.mimeType,
                images: [sceneImg],
                primaryImageId: sceneImg.id,
            },
        },
        {
            id: PRESET_NODE_IDS.outScript,
            type: CanvasNodeType.Text,
            title: "AI 拆解 4 镜动作分镜脚本",
            position: { x: 860, y: 600 },
            width: 352,
            height: 280,
            metadata: {
                content: PRESET_SCRIPT_TEXT,
                prompt: PRESET_PROMPTS.script,
                model: "gpt-6-astra",
                status: "success",
                fontSize: 13,
                textCount: 1,
                texts: [{ id: "preset-script-item", status: "success", content: PRESET_SCRIPT_TEXT }],
                primaryTextId: "preset-script-item",
            },
        },
        {
            id: PRESET_NODE_IDS.cfgStoryboard,
            type: CanvasNodeType.Config,
            title: "生成配置 D · 四宫格分镜关键帧",
            position: { x: 1276, y: 330 },
            width: 340,
            height: 240,
            metadata: {
                generationMode: "image",
                model: "gpt-image-2.6-sunburst",
                size: "16:9",
                quality: "high",
                count: 1,
                prompt: PRESET_PROMPTS.storyboard,
                status: "success",
            },
        },
        {
            id: PRESET_NODE_IDS.outStoryboard,
            type: CanvasNodeType.Image,
            title: "电影 2×2 四宫格分镜关键帧",
            position: { x: 1680, y: 348 },
            width: 352,
            height: 198,
            metadata: {
                content: PRESET_ASSETS.storyboard.url,
                prompt: PRESET_PROMPTS.storyboard,
                model: "gpt-image-2.6-sunburst",
                size: "16:9",
                quality: "high",
                generationType: "edit",
                references: [PRESET_ASSETS.threeView.url, PRESET_ASSETS.scene.url],
                status: "success",
                naturalWidth: PRESET_ASSETS.storyboard.width,
                naturalHeight: PRESET_ASSETS.storyboard.height,
                bytes: PRESET_ASSETS.storyboard.bytes,
                mimeType: PRESET_ASSETS.storyboard.mimeType,
                images: [storyboardImg],
                primaryImageId: storyboardImg.id,
            },
        },
        {
            id: PRESET_NODE_IDS.cfgVideo,
            type: CanvasNodeType.Config,
            title: "生成配置 E · 多镜有声动作短片",
            position: { x: 2096, y: 330 },
            width: 340,
            height: 240,
            metadata: {
                generationMode: "video",
                model: "Seedance-2.5-480p",
                size: "16:9",
                vquality: "480p",
                seconds: "30",
                videoMode: "reference",
                generateAudio: "true",
                prompt: PRESET_PROMPTS.video,
                status: "success",
            },
        },
        {
            id: PRESET_NODE_IDS.outVideo,
            type: CanvasNodeType.Video,
            title: "🎬 最终成片 · 天台追逐战（30s 有声）",
            position: { x: 2500, y: 338 },
            width: 400,
            height: 225,
            metadata: {
                content: PRESET_ASSETS.video.url,
                prompt: PRESET_PROMPTS.video,
                model: "Seedance-2.5-480p",
                size: "16:9",
                vquality: "480p",
                seconds: "30",
                videoMode: "reference",
                generateAudio: "true",
                status: "success",
                naturalWidth: PRESET_ASSETS.video.width,
                naturalHeight: PRESET_ASSETS.video.height,
                bytes: PRESET_ASSETS.video.bytes,
                mimeType: PRESET_ASSETS.video.mimeType,
                durationMs: PRESET_ASSETS.video.durationMs,
                references: [PRESET_ASSETS.threeView.url, PRESET_ASSETS.storyboard.url],
            },
        },
    ];

    const pairs: Array<[string, string]> = [
        [PRESET_NODE_IDS.inputPortrait, PRESET_NODE_IDS.cfgThreeView],
        [PRESET_NODE_IDS.inputStory, PRESET_NODE_IDS.cfgThreeView],
        [PRESET_NODE_IDS.inputStory, PRESET_NODE_IDS.cfgScene],
        [PRESET_NODE_IDS.inputPortrait, PRESET_NODE_IDS.cfgScript],
        [PRESET_NODE_IDS.inputStory, PRESET_NODE_IDS.cfgScript],
        [PRESET_NODE_IDS.cfgThreeView, PRESET_NODE_IDS.outThreeView],
        [PRESET_NODE_IDS.cfgScene, PRESET_NODE_IDS.outScene],
        [PRESET_NODE_IDS.cfgScript, PRESET_NODE_IDS.outScript],
        [PRESET_NODE_IDS.outThreeView, PRESET_NODE_IDS.cfgStoryboard],
        [PRESET_NODE_IDS.outScene, PRESET_NODE_IDS.cfgStoryboard],
        [PRESET_NODE_IDS.outScript, PRESET_NODE_IDS.cfgStoryboard],
        [PRESET_NODE_IDS.cfgStoryboard, PRESET_NODE_IDS.outStoryboard],
        [PRESET_NODE_IDS.outThreeView, PRESET_NODE_IDS.cfgVideo],
        [PRESET_NODE_IDS.outStoryboard, PRESET_NODE_IDS.cfgVideo],
        [PRESET_NODE_IDS.outScript, PRESET_NODE_IDS.cfgVideo],
        [PRESET_NODE_IDS.cfgVideo, PRESET_NODE_IDS.outVideo],
    ];

    const connections: CanvasConnection[] = pairs.map(([fromNodeId, toNodeId], index) => ({
        id: `preset-conn-${index + 1}`,
        fromNodeId,
        toNodeId,
    }));

    return { nodes, connections };
}

export function createPresetWorkflowProject(id = PRESET_WORKFLOW_PROJECT_ID, title = PRESET_WORKFLOW_TITLE): CanvasProject {
    const now = new Date().toISOString();
    const { nodes, connections } = buildPresetWorkflowGraph();
    return {
        id,
        title,
        createdAt: now,
        updatedAt: now,
        nodes,
        connections,
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { ...DEFAULT_PRESET_VIEWPORT },
    };
}

export function createPresetWorkflowCopyTitle(existingCount: number) {
    return existingCount <= 0 ? PRESET_WORKFLOW_TITLE : `${PRESET_WORKFLOW_TITLE} (${existingCount + 1})`;
}

function samePath(actual: string | undefined, expected: string): boolean {
    if (!actual) return false;
    try {
        const baseOrigin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "http://localhost";
        const a = new URL(actual, baseOrigin).pathname;
        const b = new URL(expected, baseOrigin).pathname;
        return a === b;
    } catch {
        return actual === expected;
    }
}

function stripChannelPrefix(model: string | undefined): string {
    if (!model) return "";
    const idx = model.indexOf("::");
    return idx >= 0 ? model.slice(idx + 2) : model;
}

function isPresetResourceNodeUnmodified(nodeId: string, nodesById: Map<string, CanvasNodeData>, allowEmptyOutput: boolean): boolean {
    const node = nodesById.get(nodeId);
    if (!node) return false;
    if (nodeId === PRESET_NODE_IDS.inputPortrait) {
        return node.type === CanvasNodeType.Image && !node.metadata?.storageKey && samePath(node.metadata?.content, PRESET_ASSETS.portrait.url);
    }
    if (nodeId === PRESET_NODE_IDS.inputStory) {
        return node.type === CanvasNodeType.Text && (node.metadata?.content || "").trim() === PRESET_STORY_TEXT.trim();
    }
    if (nodeId === PRESET_NODE_IDS.outThreeView) {
        if (allowEmptyOutput && !node.metadata?.content && !node.metadata?.storageKey) return true;
        return node.type === CanvasNodeType.Image && !node.metadata?.storageKey && samePath(node.metadata?.content, PRESET_ASSETS.threeView.url);
    }
    if (nodeId === PRESET_NODE_IDS.outScene) {
        if (allowEmptyOutput && !node.metadata?.content && !node.metadata?.storageKey) return true;
        return node.type === CanvasNodeType.Image && !node.metadata?.storageKey && samePath(node.metadata?.content, PRESET_ASSETS.scene.url);
    }
    if (nodeId === PRESET_NODE_IDS.outStoryboard) {
        if (allowEmptyOutput && !node.metadata?.content && !node.metadata?.storageKey) return true;
        return node.type === CanvasNodeType.Image && !node.metadata?.storageKey && samePath(node.metadata?.content, PRESET_ASSETS.storyboard.url);
    }
    if (nodeId === PRESET_NODE_IDS.outScript) {
        const text = (node.metadata?.content || "").trim();
        if (allowEmptyOutput && !text) return true;
        return node.type === CanvasNodeType.Text && text === PRESET_SCRIPT_TEXT.trim();
    }
    return false;
}

/**
 * Check whether a preset Config node and its entire upstream chain remain unmodified.
 * When `allowEmptyIntermediate` is true (full-workflow run), cleared intermediate output slots
 * still qualify as unmodified as long as their upstream Config + root inputs are unmodified.
 */
export function isPresetConfigStepUnmodified(
    configNodeId: string,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    allowEmptyIntermediate = false,
    memo = new Map<string, boolean>(),
    ancestors = new Set<string>(),
): boolean {
    const cached = memo.get(configNodeId);
    if (cached !== undefined) return cached;
    if (ancestors.has(configNodeId)) return false;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(configNodeId);

    const finish = (ok: boolean) => {
        memo.set(configNodeId, ok);
        return ok;
    };

    const spec = PRESET_STEPS[configNodeId];
    if (!spec) return finish(false);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const configNode = nodesById.get(configNodeId);
    const outputNode = nodesById.get(spec.outputId);
    if (!configNode || configNode.type !== CanvasNodeType.Config || !outputNode) return finish(false);

    const mode = configNode.metadata?.generationMode || "image";
    if (mode !== spec.mode) return finish(false);
    const actualModel = stripChannelPrefix(configNode.metadata?.model);
    if (actualModel && actualModel !== spec.model) return finish(false);
    if (spec.size && configNode.metadata?.size && configNode.metadata.size !== spec.size) return finish(false);
    if (spec.quality && configNode.metadata?.quality && configNode.metadata.quality !== spec.quality) return finish(false);
    if (spec.count && (configNode.metadata?.count || 1) !== spec.count) return finish(false);
    if (spec.textCount && (configNode.metadata?.textCount || 1) !== spec.textCount) return finish(false);
    if (spec.vquality && configNode.metadata?.vquality && configNode.metadata.vquality !== spec.vquality) return finish(false);
    if (spec.seconds && configNode.metadata?.seconds && configNode.metadata.seconds !== spec.seconds) return finish(false);
    if (spec.videoMode && configNode.metadata?.videoMode && configNode.metadata.videoMode !== spec.videoMode) return finish(false);
    if (configNode.metadata?.reasoningEffort && configNode.metadata.reasoningEffort !== "auto") return finish(false);

    const currentPrompt = (configNode.metadata?.composerContent ?? configNode.metadata?.prompt ?? "").trim();
    if (currentPrompt !== spec.prompt.trim()) return finish(false);

    const hasOutputConn = connections.some((c) => c.fromNodeId === configNodeId && c.toNodeId === spec.outputId);
    if (!hasOutputConn) return finish(false);

    const actualUpstream = connections.filter((c) => c.toNodeId === configNodeId).map((c) => c.fromNodeId).sort();
    const expectedUpstream = [...spec.upstreamIds].sort();
    if (actualUpstream.length !== expectedUpstream.length || actualUpstream.some((id, idx) => id !== expectedUpstream[idx])) {
        return finish(false);
    }

    for (const upId of spec.upstreamIds) {
        if (!isPresetResourceNodeUnmodified(upId, nodesById, allowEmptyIntermediate)) return finish(false);
        const producerStep = Object.values(PRESET_STEPS).find((item) => item.outputId === upId);
        if (producerStep && !isPresetConfigStepUnmodified(producerStep.configId, nodes, connections, allowEmptyIntermediate, memo, nextAncestors)) {
            return finish(false);
        }
    }
    return finish(true);
}

export function hasPresetWorkflowNodes(nodes: CanvasNodeData[]) {
    return nodes.some((node) => node.id in PRESET_STEPS || node.id === PRESET_NODE_IDS.inputPortrait || node.id === PRESET_NODE_IDS.inputStory);
}

export function isEntireWorkflowUnmodifiedPreset(nodes: CanvasNodeData[], connections: CanvasConnection[]): boolean {
    const configNodes = nodes.filter((node) => node.type === CanvasNodeType.Config);
    if (configNodes.length !== Object.keys(PRESET_STEPS).length) return false;
    return configNodes.every((node) => isPresetConfigStepUnmodified(node.id, nodes, connections, true));
}

export function targetNodeTypeForMode(mode: CanvasGenerationMode): CanvasNodeType {
    if (mode === "video") return CanvasNodeType.Video;
    if (mode === "audio") return CanvasNodeType.Audio;
    if (mode === "text") return CanvasNodeType.Text;
    return CanvasNodeType.Image;
}

export function findConfigOutputSlotNode(configNodeId: string, mode: CanvasGenerationMode, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData | undefined {
    const wantedType = targetNodeTypeForMode(mode);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    for (const conn of connections) {
        if (conn.fromNodeId !== configNodeId) continue;
        const candidate = nodesById.get(conn.toNodeId);
        if (candidate?.type === wantedType) return candidate;
    }
    return undefined;
}

export function buildWorkflowStages(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[][] {
    const configNodes = nodes.filter((node) => node.type === CanvasNodeType.Config);
    if (!configNodes.length) return [];

    const producerByOutputId = new Map<string, string>();
    for (const cfg of configNodes) {
        const mode = cfg.metadata?.generationMode || "image";
        const out = findConfigOutputSlotNode(cfg.id, mode, nodes, connections);
        if (out) producerByOutputId.set(out.id, cfg.id);
    }

    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const depsByConfigId = new Map<string, Set<string>>();
    for (const cfg of configNodes) {
        const deps = new Set<string>();
        for (const conn of connections) {
            if (conn.toNodeId !== cfg.id) continue;
            const source = nodesById.get(conn.fromNodeId);
            if (!source) continue;
            const expanded = source.type === CanvasNodeType.Group ? getGroupResourceNodes(source.id, nodes) : [source];
            for (const item of expanded) {
                const producerId = producerByOutputId.get(item.id);
                if (producerId && producerId !== cfg.id) deps.add(producerId);
            }
        }
        depsByConfigId.set(cfg.id, deps);
    }

    const remaining = new Map(configNodes.map((cfg) => [cfg.id, cfg]));
    const stages: CanvasNodeData[][] = [];
    while (remaining.size > 0) {
        const ready = Array.from(remaining.values())
            .filter((cfg) => {
                const deps = depsByConfigId.get(cfg.id);
                return !deps || Array.from(deps).every((depId) => !remaining.has(depId));
            })
            .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);

        if (!ready.length) {
            const fallback = Array.from(remaining.values()).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)[0];
            stages.push([fallback]);
            remaining.delete(fallback.id);
            continue;
        }
        stages.push(ready);
        ready.forEach((cfg) => remaining.delete(cfg.id));
    }
    return stages;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = window.setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

export function prepareOutputNodeForDemoReset(node: CanvasNodeData): CanvasNodeData {
    if (node.type === CanvasNodeType.Image) {
        const loadingSlotId = node.metadata?.primaryImageId || `${node.id}-img`;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                content: "",
                status: "loading",
                progressLabel: "等待上游就绪…",
                errorDetails: undefined,
                images: [{ id: loadingSlotId, status: "loading", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }],
                primaryImageId: loadingSlotId,
            },
        };
    }
    if (node.type === CanvasNodeType.Text) {
        const textSlotId = node.metadata?.primaryTextId || `${node.id}-txt`;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                content: "",
                status: "loading",
                progressLabel: "等待上游就绪…",
                errorDetails: undefined,
                texts: [{ id: textSlotId, status: "loading", content: "" }],
                primaryTextId: textSlotId,
            },
        };
    }
    return {
        ...node,
        metadata: {
            ...node.metadata,
            content: "",
            status: "loading",
            progressLabel: "等待上游关键帧就绪…",
            errorDetails: undefined,
        },
    };
}

export async function simulatePresetConfigStep(
    configNodeId: string,
    setNodes: React.Dispatch<React.SetStateAction<CanvasNodeData[]>>,
    signal: AbortSignal,
): Promise<void> {
    const spec = PRESET_STEPS[configNodeId];
    if (!spec) return;

    const setStatus = (cfgLabel: string | undefined, outPatch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id === spec.configId) {
                    return { ...node, metadata: { ...node.metadata, status: "loading", progressLabel: cfgLabel, errorDetails: undefined } };
                }
                if (node.id === spec.outputId) {
                    return { ...node, metadata: { ...node.metadata, ...outPatch, errorDetails: undefined } };
                }
                return node;
            }),
        );
    };

    if (configNodeId === PRESET_NODE_IDS.cfgScript) {
        const itemId = "preset-script-item";
        setStatus("AI 推理中…", {
            content: "",
            status: "loading",
            progressLabel: "gpt-6-astra 思考分镜结构…",
            texts: [{ id: itemId, status: "loading", content: "" }],
            primaryTextId: itemId,
        });
        await abortableSleep(900, signal);
        let cursor = 0;
        const full = PRESET_SCRIPT_TEXT;
        while (cursor < full.length) {
            const step = full[cursor] === "\n" ? 2 : 9;
            cursor = Math.min(full.length, cursor + step);
            const partial = full.slice(0, cursor);
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === spec.outputId
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  content: partial,
                                  status: "loading",
                                  progressLabel: undefined,
                                  texts: [{ id: itemId, status: "loading", content: partial }],
                                  primaryTextId: itemId,
                              },
                          }
                        : node,
                ),
            );
            await abortableSleep(full[cursor - 1] === "\n" ? 130 : 58, signal);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id === spec.configId) return { ...node, metadata: { ...node.metadata, status: "success", progressLabel: undefined } };
                if (node.id === spec.outputId) {
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            content: full,
                            status: "success",
                            progressLabel: undefined,
                            texts: [{ id: itemId, status: "success", content: full }],
                            primaryTextId: itemId,
                        },
                    };
                }
                return node;
            }),
        );
        return;
    }

    if (configNodeId === PRESET_NODE_IDS.cfgThreeView || configNodeId === PRESET_NODE_IDS.cfgScene || configNodeId === PRESET_NODE_IDS.cfgStoryboard) {
        const asset =
            configNodeId === PRESET_NODE_IDS.cfgThreeView
                ? PRESET_ASSETS.threeView
                : configNodeId === PRESET_NODE_IDS.cfgScene
                  ? PRESET_ASSETS.scene
                  : PRESET_ASSETS.storyboard;
        const phases =
            configNodeId === PRESET_NODE_IDS.cfgThreeView
                ? [
                      { ms: 1850, text: "锁定角色五官与发色 · 24%" },
                      { ms: 2200, text: "绘制正 / 侧 / 背三视图 · 63%" },
                      { ms: 1950, text: "校准战术服细节一致性 · 91%" },
                  ]
                : configNodeId === PRESET_NODE_IDS.cfgScene
                  ? [
                        { ms: 1650, text: "构建高空脚手架透视 · 28%" },
                        { ms: 1850, text: "渲染夜景月光与火光 · 67%" },
                        { ms: 1550, text: "细化混凝土与金属质感 · 92%" },
                    ]
                  : [
                        { ms: 1950, text: "融合角色三视图与夜景设定 · 22%" },
                        { ms: 2350, text: "绘制 2×2 四宫格动作分镜 · 61%" },
                        { ms: 1950, text: "统一电影光影与景深 · 89%" },
                    ];
        const slotId = `${spec.outputId}-${nanoid(6)}`;
        setStatus(phases[0].text, {
            content: "",
            status: "loading",
            progressLabel: phases[0].text,
            images: [{ id: slotId, status: "loading", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }],
            primaryImageId: slotId,
        });
        for (let i = 0; i < phases.length; i += 1) {
            if (i > 0) setStatus(phases[i].text, { progressLabel: phases[i].text });
            await abortableSleep(phases[i].ms, signal);
        }
        const doneSlot: CanvasNodeImage = {
            id: slotId,
            status: "success",
            content: asset.url,
            naturalWidth: asset.width,
            naturalHeight: asset.height,
            bytes: asset.bytes,
            mimeType: asset.mimeType,
        };
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id === spec.configId) return { ...node, metadata: { ...node.metadata, status: "success", progressLabel: undefined } };
                if (node.id === spec.outputId) {
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            content: asset.url,
                            status: "success",
                            progressLabel: undefined,
                            naturalWidth: asset.width,
                            naturalHeight: asset.height,
                            bytes: asset.bytes,
                            mimeType: asset.mimeType,
                            images: [doneSlot],
                            primaryImageId: doneSlot.id,
                        },
                    };
                }
                return node;
            }),
        );
        return;
    }

    if (configNodeId === PRESET_NODE_IDS.cfgVideo) {
        const phases = [
            { ms: 1500, text: "Seedance 任务排队受理 · 8%" },
            { ms: 1850, text: "锁定角色外观与分镜连续性 · 24%" },
            { ms: 2100, text: "生成脚手架狂奔与倒立翻转 · 47%" },
            { ms: 2100, text: "渲染通道冲刺与天台飞跃 · 72%" },
            { ms: 1750, text: "合成脚步声与电影打击乐 · 89%" },
            { ms: 1200, text: "封装 720P 有声成片 · 96%" },
        ];
        setStatus(phases[0].text, {
            content: "",
            status: "loading",
            progressLabel: phases[0].text,
        });
        for (let i = 0; i < phases.length; i += 1) {
            if (i > 0) setStatus(phases[i].text, { progressLabel: phases[i].text });
            await abortableSleep(phases[i].ms, signal);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id === spec.configId) return { ...node, metadata: { ...node.metadata, status: "success", progressLabel: undefined } };
                if (node.id === spec.outputId) {
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            content: PRESET_ASSETS.video.url,
                            status: "success",
                            progressLabel: undefined,
                            naturalWidth: PRESET_ASSETS.video.width,
                            naturalHeight: PRESET_ASSETS.video.height,
                            bytes: PRESET_ASSETS.video.bytes,
                            mimeType: PRESET_ASSETS.video.mimeType,
                            durationMs: PRESET_ASSETS.video.durationMs,
                        },
                    };
                }
                return node;
            }),
        );
    }
}
