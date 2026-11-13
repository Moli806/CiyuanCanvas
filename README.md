# 词元画布（infinite-canvas 托管版）

这是 `basketikun/infinite-canvas` 的托管分支，作为词元API 的 `/canvas/` 子页面运行。生产入口 <https://ciyuanweb.cn/canvas/>，部署版本以 CiyuanAPI-ops 的 `OPS-CHANGELOG.md` S06 与 Server Atlas 为准。源码仓库 `Moli806/CiyuanCanvas`，默认分支 `ciyuan`。上游基线：v0.20.0，commit `9cd3deacbcc598361807afc16c059a80dd18b6f9`，MIT License，原始 `LICENSE` 保留在本目录。

## 当前边界

- 用户只能使用词元API 后台返回的画布模型清单，不能添加渠道、Base URL、API Key 或自定义模型。
- 登录复用词元API 的会话：画布先用刷新 Cookie 调 `/api/user/auth/refresh` 换取短期 Bearer 令牌，再访问 `/api/canvas/bootstrap`；不能只带 Cookie，否则会被 New API 判定为未登录并与登录页反复互跳。钱包余额显示同一用户的站内额度。
- 画布不在用户 API 密钥里创建 Key：登录会话换取的短期 Bearer 由服务端 `SessionOrTokenAuth` 转成不落库、仅限画布模型的临时令牌，费用照常从用户钱包或订阅扣除。历史上自动创建的「词元画布（自动）」Key 会在下次加载画布时软删除。
- 图片支持 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`、`gpt-image-2.6-flare`、`gpt-image-2.6-sunburst`、`banana-2.1` 与 `grok-imagine-image-2.0`（共 6 款）；视频支持 Seedance 七档（即梦）、`Wan-3.0-720p/1080p`、`视频超分`、`MiniMax-H3`、Grok 2 个与 Omini 2 个（共 15 个可见视频 SKU），Kling 与 `MiniMax-H3-1080p` 已下架。反推提示词/图片问答按 `canvasModelCatalog` 登记 13 个读图文本模型（实际开放集合随后台启用模型过滤），走 `/pg/chat/completions` 流式会话通道。完整目录与参数以 `CUSTOMIZATIONS.md` C40 为准。
- 视频创作台按后端 spec 开放参考图/参考视频/参考音乐，数量上限由模型决定；外部插件、本地 Agent、配置页和提示词站外抓取仍关闭。参考素材按最终字节 SHA-256 前 128 位去重：图片 JPEG/PNG 超过 2MB 或 2560px 时缩到 2560px 并重编码（JPEG q85、PNG 无损），带非正常 EXIF 方向的 JPEG 保持原样，源图最长边超过 6000px 拒绝；视频 MP4/WebM/MOV 单个 ≤50MB，音乐 MP3/WAV/M4A/OGG 单个 ≤20MB。素材按用户配额和保留期清理，默认 7 天、可设 1–30 天，项目引用免于保留期删除。
- 画布项目、参考素材和生成素材同步到服务器：项目元数据存 PostgreSQL `canvas_projects`，载荷存 `/data/canvas-projects/<用户>/<项目>.json`，素材存 `/data/canvas-assets`（每用户 1 GiB 配额，保留期默认 7 天、可设 1–30 天）。IndexedDB 是本地缓存，新浏览器可从服务器恢复。顶栏提示服务器保留天数与项目同步，账户菜单显示服务器/本地用量并可在「存储与保留」里设置天数、立即清理、下载或删除素材；「我的资产」保留 `assets.json` + 图片/视频 Blob 的 ZIP 导入导出。契约见 `CUSTOMIZATIONS.md` C40。

## 构建

要求 Node.js 20.19+（本机已验证 Node 24）。

```bash
cd web
npm install --legacy-peer-deps
npm run typecheck
npm run build:canvas
```

## 上游同步

- `upstream` 指向只读的 `basketikun/infinite-canvas`。
- 基线为 `v0.20.0`；上游发版后执行：

```bash
git fetch upstream --tags
git log --oneline <new-tag> ^HEAD
git merge <new-tag>
# 解冲突后重新 typecheck 和 build:canvas，并回读验证产物
```

- 画布后端与部署记录不在本仓库，分别在 `Moli806/CiyuanAPI` 和 `Moli806/CiyuanAPI-ops`。

产物是 `web/dist/`，其中的资源路径以 `/canvas/` 为基址。上游依赖存在 antd 6 与 pro-components 的 peer 冲突，npm 安装需要 `--legacy-peer-deps`；bun 可用时也可以沿用上游的 `bun install`。不要在没有 Node 的 New API 服务器上构建。

## 部署

1. 把 `web/dist/` 上传到服务器 `/srv/ciyuan-canvas/`；保留上一版 dist 作为回滚副本。
2. 在现有 `ciyuanweb.cn` 的 Caddy 站点块中，在兜底反代之前加入：

```caddyfile
redir /canvas /canvas/ 308
handle_path /canvas/* {
    root * /srv/ciyuan-canvas
    @canvas_hashed {
        path /assets/*
        file {path}
    }
    header @canvas_hashed Cache-Control "public, max-age=31536000, immutable"
    @canvas_static path /brand/* /icons/*
    header @canvas_static Cache-Control "public, max-age=604800"
    @canvas_entry path / /index.html /config.js /plugins/index.json
    header @canvas_entry Cache-Control "no-cache"
    try_files {path} /index.html
    file_server
}
```

`handle_path` 会去掉 `/canvas` 前缀，因此 dist 内容直接放在 `/srv/ciyuan-canvas/` 根下。哈希资源用一年 immutable，入口文件不缓存；缺失的 `/assets/*` 不会命中 `file` 匹配，因此不会把回退的 index.html 长缓存。`/api/*` 和 `/v1/*` 继续走现有的 New API 反代；`/canvas-assets/*` 由 New API 提供，不会被上面的 `/canvas/*` 匹配。修改 Caddy 前先 `caddy adapt`，再原地写回、`caddy validate` 和 `caddy reload`。

3. New API 需要包含本目录对应的画布路由改动（`CUSTOMIZATIONS.md` C40），并按既有流程在本地构建镜像后发布。服务器不构建。
4. 参考素材和画布项目随 `/opt/new-api/data` 持久化：素材在 `/data/canvas-assets`（可用 `CANVAS_ASSET_DIR` 覆盖），项目载荷在 `/data/canvas-projects`。主节点每小时按保留期、配额和孤儿记录清理；保留期默认 7 天、可设 1–30 天。
5. 服务器变更同轮更新 `OPS-CHANGELOG.md`、`FEATURE-MAP.md` 和 Server Atlas 的 New API 记录，并运行 `validate`。

## 本地联调

画布依赖词元API 的登录会话和 `/api/canvas/*`，不能只静态打开 dist。联调时让 New API 和画布同源：本地启动 New API 后，把 dist 放到其静态目录，或在本机用 Caddy 按上面的规则转发。不要在生产环境用本地 Vite dev server 直接连接未配置的新 API 实例。

## 本地 UI 预览（模拟接口）

只想看界面时，可以启动模拟服务：

```bash
python preview/server.py
```

然后打开 `http://127.0.0.1:4173/canvas/`。它模拟登录、余额、模型和生成接口，不连接词元API，不产生真实费用；视频结果是占位文件，可能无法播放。仅限本机或内网使用，不要暴露到公网。

## 关键实现位置

- `web/src/components/layout/ciyuan-gate.tsx`：登录门禁、未登录跳 `/sign-in`、余额定期刷新。
- `web/src/stores/use-ciyuan-store.ts`：bootstrap、模型清单、单一渠道注入、退出登录。
- `web/src/services/ciyuan.ts`：刷新会话 Bearer、画布令牌调用、视频/香蕉图片任务、参考图上传。
- `web/src/services/api/video.ts`：原生 `ciyuan` provider 与 30 分钟轮询。
- `web/src/services/api/image.ts`：banana 任务式图片分支。
- `web/src/components/layout/ciyuan-user-actions.tsx`：账户、余额、充值、密钥、退出登录。
- `web/src/components/model-brand-icon.tsx`：按 bootstrap 下发的 LobeHub 图标键渲染厂商图标，未知键回退 CPU。
- `web/src/components/video-settings-panel.tsx`：按模型 `CanvasVideoSpec` 动态渲染清晰度、比例、秒数和模式。
- `web/src/components/image-settings-panel.tsx`：按模型 `CanvasImageSpec` 动态渲染质量、清晰度、比例、张数和透明背景。
- `web/src/components/layout/brand-logo.tsx`、`web/public/brand/`：词元 logo 透明底，浅色用黑标、深色用白标；浏览器 favicon 固定使用透明黑标，避免浅色标签栏不可见。
- `preview/server.py`：本地 UI 预览，模拟接口，不部署。

## 新增模型

1. 在 `rc41/controller/canvas.go` 的 `canvasModelCatalog` 增加公开模型 ID 和 capability；视频模型补 `CanvasVideoSpec`（分钟/最大秒数、固定或可选分辨率、比例、参考素材上限、是否支持首尾帧），图片模型补 `CanvasImageSpec`（质量档、清晰度、比例、张数上限、是否支持透明背景）。
2. 图标自动从词元API 的 `pricing`/`vendors` 读取 LobeHub 图标键；如果出现新的图标键，在 `web/src/components/model-brand-icon.tsx` 增加对应 LobeHub 模块映射，未知键会回退 CPU 图标。
3. 前端会按 spec 自动渲染视频和图片参数，不需要再改 `video-settings-panel.tsx` / `image-settings-panel.tsx` 的固定选项。

## 安全说明

- 画布不创建持久化 API Key；短期 Bearer 只保存在页面内存，服务端临时令牌不落库且仅允许画布模型。旧的「词元画布（自动）」Key 在下次加载画布时软删除，不会出现在密钥列表。
- 参考素材上传使用登录会话，不是画布令牌；文件公开可读，随机 128 位文件名是访问凭据。类型和大小按 C40 白名单：图片 PNG/JPEG/WebP/GIF ≤20MB，视频 MP4/WebM/MOV ≤50MB，音频 MP3/WAV/M4A/OGG ≤20MB。
- 远程节点插件、配置导入、本地 Agent 和站外提示词首页已关闭，避免第三方脚本读取用户令牌。
- 画布停止等待不会取消词元侧任务；任务仍会继续并按实际结算。画布轮询上限已提高到 30 分钟，超时后不要重复提交。
