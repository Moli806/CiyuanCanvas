import { PRESET_ASSETS, PRESET_PROMPTS } from "@/lib/canvas/canvas-preset-workflow";
import type { Prompt } from "./prompts";

export function getCiyuanPromptCatalog(language: string): Prompt[] {
    const text = (chinese: string, english: string) => language === "en-US" ? english : chinese;
    const image = text("图片创作", "Image creation");
    const video = text("视频与分镜", "Video and storyboards");
    const writing = text("文本写作", "Writing");
    const preset = text("官方预设", "Canvas preset");
    const entries = [
        {
            id: "character-turnaround", category: image, title: text("参考图转角色三视图", "Character turnaround from a reference"),
            description: text("来自画布官方预设。使用自己的参考图时，可以替换发色、服装和配饰。", "From the official canvas preset. For a different reference, replace the hair, outfit and accessory details."),
            prompt: text(PRESET_PROMPTS.threeView, "Use the reference portrait to draw full-length front, side and back views of the same character on a dark gray grid. Match the facial features, pastel pink bob and matte black vest. Keep the body proportions, fingerless gloves and boots consistent in all three views."),
            tags: [preset, text("角色设定", "Character design")], coverUrl: PRESET_ASSETS.threeView.url, references: [PRESET_ASSETS.portrait.url],
        },
        {
            id: "night-cityscape", category: image, title: text("电影夜景空镜", "Night cityscape establishing shot"),
            description: text("用冷暖光对比确定场景气氛，适合做短片的环境设定图。", "Set the mood for a short film by contrasting cool moonlight with warm light in the distance."),
            prompt: text(PRESET_PROMPTS.scene, "Create an unoccupied cinematic establishing shot of a silver scaffold bridge suspended between concrete apartment towers in a Korean city at night. Contrast cool blue-gray moonlight with the warm glow and smoke from distant buildings. Aim for realistic film lighting and textures."),
            tags: [preset, text("场景", "Environment")], coverUrl: PRESET_ASSETS.scene.url,
        },
        {
            id: "storyboard-four-shots", category: video, title: text("四格电影分镜", "Four-shot film storyboard"),
            description: text("用一张图规划四个镜头的位置和先后关系，可附上角色或场景参考图。", "Plan a sequence in a single sheet. Add a character or setting reference if you have one."),
            prompt: text("把[故事梗概]画成一张横向 16:9 的四格分镜。按从左到右、从上到下的顺序，先用全景建立地点，再用中景交代人物目标、特写呈现关键细节，最后用远景收束。保持人物外观、光线方向与场景陈设一致。画面之间留细白边，不加字幕。", "Draw a landscape 16:9 four-panel storyboard for [story outline]. Read left to right, top to bottom. Open with a wide establishing shot, show the character’s goal in a medium shot, cut to a close-up of a key detail, and end on a wide shot. Keep the character, light direction and set consistent. Use thin white gutters and no captions."),
            tags: [text("分镜", "Storyboard"), text("镜头语言", "Cinematography")], coverUrl: PRESET_ASSETS.storyboard.url,
        },
        {
            id: "product-studio", category: image, title: text("产品棚拍主图", "Studio product photograph"),
            description: text("替换商品名称和材质，或附上产品实拍图。", "Replace the product and material placeholders, or attach a product photograph."),
            prompt: text("为[商品]拍摄一张电商主图，准确呈现[材质]、外形和原有标识。商品置于浅灰无缝背景中央，以四分之三角度展示。左上方使用大面积柔光，保留自然接触阴影，背景干净，周围留白，不添加广告文字。", "Photograph [product] for an online shop. Preserve its shape, [material] and existing markings. Center it against a light gray seamless backdrop at a three-quarter angle. Use a large soft light from the upper left and retain a natural contact shadow. Leave clear space around the product without adding any advertising text."),
            tags: [text("电商", "Commerce"), text("摄影", "Photography")],
        },
        {
            id: "coffee-closeup", category: video, title: text("咖啡馆固定镜头", "Locked-off café shot"),
            description: text("让画面里的蒸汽和倒影产生运动，同时保持机位稳定。", "Give the steam and reflections motion while keeping the camera still."),
            prompt: text("咖啡馆清晨，一只白瓷杯放在靠窗的木桌上。固定机位拍摄杯沿近景，焦点保持在咖啡表面，蒸汽缓慢上升，一道行人的倒影从窗外掠过，最后回到安静的桌面。暖色自然光，柔和颗粒，全程单镜头。", "At dawn in a café, a white cup rests on a wooden table by the window. Frame a locked-off close-up of the rim and hold focus on the coffee. Steam rises slowly as a passerby’s reflection crosses the glass, then the table becomes still again. Use warm natural light and soft film grain in one continuous shot."),
            tags: [text("镜头语言", "Cinematography"), text("日常", "Everyday life")],
        },
        {
            id: "interview-outline", category: writing, title: text("把采访笔记整理成提纲", "Turn interview notes into an outline"),
            description: text("把笔记中的观点、原话和待核实问题分开，方便继续采访或写稿。", "Separate themes, quotations and open questions before drafting your article."),
            prompt: text("阅读以下采访笔记，围绕[文章主题]整理一份提纲。给出一个工作标题，按读者理解顺序列出三个段落，各用一句话说明重点。为每段选一句笔记中已有的原话作佐证，没有原话的地方标记为待补证。最后列出两个最值得追问的问题。\n\n采访笔记：[粘贴笔记]", "Read the interview notes below and outline an article about [topic]. Suggest a working title and three sections in the order a reader needs them. Give each section a one-sentence point and one supporting quotation taken from the notes. Mark any point that still needs evidence. End with two follow-up questions.\n\nInterview notes: [paste notes]"),
            tags: [text("提纲", "Outline"), text("采访", "Interview")],
        },
    ];
    return entries.map(({ references = [], coverUrl = "", ...item }) => ({
        ...item, sourceId: "ciyuan-gallery", coverUrl, referenceImageUrls: references,
        githubUrl: "", preview: "", createdAt: "", updatedAt: "",
    }));
}
