# AGENTS.md（词元画布 CiyuanCanvas）

本文件约束词元画布（`services/infinite-canvas`，`Moli806/CiyuanCanvas`）的前端开发与 UI 规范。用户当前指令、全局规则及父仓库根目录 `E:/Codex/newapi/AGENTS.md` 优先级高于本文件。

## 基本原则

- 先读现有代码，优先沿用项目已有结构和写法；不改无关文件，不顺手重构，不回滚或覆盖工作区已有改动。
- 保持代码短小直接，只实现当前明确需要的功能；不为推测场景写多余分支，不引入无必要的复杂抽象。
- 标准格式、协议、解析、压缩、加密、日期等通用能力优先使用成熟稳定的库，除非用户明确要求或必须沿用既有实现。
- 完成与变更直接相关的必要检查（如类型检查或相关验证）。生产打包必须使用 `npm run build:canvas`（即 `vite build --base=/canvas/`），禁止误用 `bun run build`（`base=/` 会导致线上 `/canvas/` 静态资源黑屏）。
- 涉及服务端同步数据结构（`canvas_projects`、`canvas-assets`）或 Agent 消息存储格式时，须保持兼容或按迁移规则先备份再升级；纯浏览器瞬态 UI 状态调整无需保留旧字段兜底，除非用户明确要求。
- 开发中若反复遇到同类问题或注意事项，应整理成明确、可执行的规则补充到本文件对应章节。

## 前端规范

- 技术栈：Vite、React、React Router、TypeScript、Ant Design、Tailwind、Zustand；图标优先用 `lucide-react` 或既有 Ant Design 图标，页面文案保持中文。编写 Ant Design 代码时结合项目当前版本与既有写法（可参考 https://ant.design/llms-full.txt）。
- 服务请求与同源接入：词元主站会话刷新、画布令牌、模型目录、媒体任务与项目/素材同步集中在 `web/src/services/ciyuan.ts`、`web/src/services/canvas-project-sync.ts`、`web/src/services/image-attempts.ts` 及 `web/src/services/api/`，通过同源接口与 New API 后端交互。
- 目录组织：路由页面放 `web/src/pages/`（单主业务组件直接写在页面入口如 `pages/image/index.tsx`，不拆无意义的 `Manager` 转发壳），布局放 `web/src/layouts/`，路由配置放 `web/src/router.tsx`；画布页面、组件、状态、工具分别放 `pages/canvas/`、`components/canvas/`、`stores/canvas/`、`lib/canvas/`。
- 状态与复用边界：跨页面共享状态放 `web/src/stores/`，不引入新的大型状态库；多页面复用的 UI 副作用（复制提示、下载提示、统一确认弹窗）抽为 `web/src/hooks/` 全局 hook，单页面私有 hook 和私有组件留在各自页面目录（如 `admin/assets/components/`）。
- 禁止无谓透传与空壳封装：全局 store、全局 hook、全局常量和全局组件在使用处直接引入，不要层层透传 props；禁止新增只做原样转发或改名的包装组件。复杂逻辑抽成同目录工具函数或小组件。
- 主题与样式：管理后台主题、卡片阴影、表格配色及 Dropdown/Menu/Select/Cascader/TreeSelect 等弹层颜色统一在 `web/src/lib/app-theme.ts`、`AppProviders` 或必要的全局 CSS 作用域配置，业务组件不自写 `dark ? ...` 分支或局部弹层配色覆盖。组件私有样式优先用 Tailwind `className` 或少量内联 `style`；`globals.css` 只放基础变量、重置、跨页面通用样式和必要的第三方覆盖。
- 浏览器本地持久化：业务缓存或大对象默认用 `localforage`；`localStorage` 仅存极小简单配置，不存业务列表、生成记录、图片、base64 或大 JSON。

## 画布 UI 规范

- 遵循当前画布主题，优先使用 `canvasThemes`、`useThemeStore` 或 Ant Design `ConfigProvider` token，禁止硬编码黑白、`stone`、`slate` 等颜色破坏深浅色一致性。
- 新增画布按钮、弹窗、浮层时复用已有工具栏、节点面板、Modal 的视觉风格；批量生成、多图展示、助手面板保持紧凑，少占画布空间。
- 画布顶部工具栏和状态信息采用极简扁平风格：无边框、无阴影、无胶囊背景，仅保留轻微 hover 反馈。
- 左侧面板等列表内的非图片类型节点缩略图（文本、配置、视频、音频等）不使用 `theme.node.fill`（`#e7e5df`/`#292524`）灰色底，图标直接无背景展示。
- 面板内常规操作按钮（如「添加」「导出」「选择」）默认用透明扁平样式（仅 `hover:bg-black/5 dark:hover:bg-white/10` 反馈），不用 `theme.toolbar.activeBg` 或 `theme.node.fill` 作填充底色；灰色 `activeBg` 仅用于表达「选中态」高亮。
- 图片节点尺寸逻辑尊重原始宽高比，除非功能明确要求自由变形。

## 文档、版本与 PR 审查

- 仓库提交与发布遵循父仓库 `E:/Codex/newapi/AGENTS.md`：未经 Nan 明确授权，禁止执行 `git commit`、`git push` 或 `git tag`；线上发布、产物哈希与回退归档同步至根仓库 `OPS-CHANGELOG.md`（S06）和 `FEATURE-MAP.md`（2.5）。仅在维护独立上游文档或用户明确要求时，才按上游约定更新 `docs/`、`CHANGELOG.md` 和 `VERSION`。
- 审查上游或外部 PR 时，将“需求价值”与“实现质量”分开判断：需求是否有价值结合产品场景评估，不确定的先问用户，不因代码差或 AI 批量改动直接否定需求；关闭 PR、合并进主分支或 force-push 前，均须向用户说明结论、风险与处理建议并取得明确同意。

## 项目注意事项

- 新增或调整超时、重试次数、大小限制、并发上限等改变实际行为的边界值前，必须先向用户说明适用环节、默认值和失败处理方式并取得确认，不得静默写入经验值。
- 词元画布已接入同源主站登录门禁（`ciyuan-gate.tsx` / `use-ciyuan-store.ts`），项目与生成素材同步至服务器 `/data/canvas-projects` 与 `/data/canvas-assets`（每用户 1 GiB 配额，保留期默认 7 天、1–30 天可配，永久归档引导导出 ZIP），契约以根仓库 `CUSTOMIZATIONS.md` C40 与 `OPS-CHANGELOG.md` S06 为准。
- Agent 对话消息必须同时按 `threadId`、`turnId` 和 `itemId` 归属；实时事件只用于补充未物化的 turn，历史快照成为权威后不得重复合并同一条消息。
- Agent 通信协议版本与消息存储版本独立管理；消息存储格式升级时必须先备份再迁移，遇到未知版本、损坏清单或冲突备份时拒绝覆盖原文件，不得按记录数量或文件大小静默裁剪历史元数据。
- 本地启动或浏览器验收时不要关闭用户已打开的浏览器窗口或标签页；自动化验证使用独立测试页面。
