"""Local preview harness for the Ciyuan canvas.

This server is for UI review only. It fakes the Ciyuan login, wallet, model
catalog and generation endpoints so the built frontend can be opened without a
production account. Never deploy it or expose it outside the local network.
"""

import base64
import json
import os
import struct
import urllib.parse
import zlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "web", "dist"))
PORT = 4173
QUOTA_PER_UNIT = 500000


def make_preview_png(width=768, height=512):
    raw = bytearray()
    cx, cy = width // 2, height // 2
    for y in range(height):
        raw.append(0)
        for x in range(width):
            dx, dy = x - cx, y - cy
            distance = (dx * dx + dy * dy) ** 0.5
            ring = max(0.0, 1.0 - abs(distance - 150) / 34)
            r = int(30 + 180 * x / width + 40 * ring)
            g = int(55 + 100 * y / height + 120 * ring)
            b = int(120 + 110 * (1 - y / height) + 90 * ring)
            raw += bytes((min(255, r), min(255, g), min(255, b)))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


PREVIEW_STORAGE = {"used_bytes": 0, "quota_bytes": 1 << 30, "asset_count": 0, "retention_days": 7, "earliest_expiry": 0}
PREVIEW_PROJECTS = {}

PNG_BYTES = make_preview_png()
PNG_B64 = base64.b64encode(PNG_BYTES).decode("ascii")
# A placeholder container. It exercises upload/poll/store paths; it is not a
# playable video, so the result card may show a blank player.
MP4_BYTES = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 256

BOOTSTRAP = {
    "success": True,
    "message": "",
    "data": {
        "user": {
            "id": 1,
            "username": "preview-user",
            "display_name": "预览用户",
            "group": "default",
            "quota": 444000000,
            "used_quota": 0,
        },
        "quota_per_unit": QUOTA_PER_UNIT,
        "storage": {"used_bytes": 0, "quota_bytes": 1 << 30, "asset_count": 0, "retention_days": 7, "earliest_expiry": 0},
        "models": [
            {"id": "gpt-image-2.5-flare", "capability": "image"},
            {"id": "gpt-image-2.5-sunburst", "capability": "image"},
            {"id": "banana-2.1", "capability": "image"},
            {
                "id": "Wan-3.0-720p",
                "capability": "video",
                "video": {
                    "min_seconds": 4,
                    "max_seconds": 30,
                    "resolutions": ["720p"],
                    "default_resolution": "720p",
                    "max_images": 10,
                    "max_videos": 5,
                    "max_audios": 5,
                    "frames": False,
                },
            },
            {
                "id": "Wan-3.0-1080p",
                "capability": "video",
                "video": {
                    "min_seconds": 4,
                    "max_seconds": 30,
                    "resolutions": ["1080p"],
                    "default_resolution": "1080p",
                    "max_images": 10,
                    "max_videos": 5,
                    "max_audios": 5,
                    "frames": False,
                },
            },
            {
                "id": "Kling-4.0",
                "capability": "video",
                "video": {
                    "min_seconds": 3,
                    "max_seconds": 30,
                    "resolutions": ["720p", "1080p"],
                    "default_resolution": "720p",
                    "max_images": 10,
                    "max_videos": 5,
                    "max_audios": 3,
                    "max_total_refs": 15,
                    "needs_video_durations": True,
                    "frames": False,
                    "aspect_ratios": ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
                },
            },
            {
                "id": "Kling-4.0-fast",
                "capability": "video",
                "video": {
                    "min_seconds": 1,
                    "max_seconds": 30,
                    "resolutions": ["720p", "1080p"],
                    "default_resolution": "720p",
                    "max_images": 10,
                    "max_videos": 5,
                    "max_audios": 3,
                    "max_total_refs": 10,
                    "needs_video_durations": True,
                    "frames": False,
                    "aspect_ratios": ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
                },
            },
            {
                "id": "Seedance-2.5-480p",
                "capability": "video",
                "video": {
                    "min_seconds": 4,
                    "max_seconds": 30,
                    "resolutions": ["480p"],
                    "default_resolution": "480p",
                    "max_images": 30,
                    "max_videos": 10,
                    "max_audios": 10,
                    "frames": False,
                },
            },
            {
                "id": "Seedance-2.5-720p",
                "capability": "video",
                "video": {
                    "min_seconds": 4,
                    "max_seconds": 30,
                    "resolutions": ["720p"],
                    "default_resolution": "720p",
                    "max_images": 30,
                    "max_videos": 10,
                    "max_audios": 10,
                    "frames": False,
                },
            },
            {
                "id": "Seedance-2.0-720p",
                "capability": "video",
                "video": {
                    "min_seconds": 4,
                    "max_seconds": 15,
                    "resolutions": ["720p"],
                    "default_resolution": "720p",
                    "max_images": 9,
                    "max_videos": 3,
                    "max_audios": 3,
                    "frames": False,
                },
            },
            {
                "id": "Seedance-2.0-fast-720p",
                "capability": "video",
                "video": {
                    "min_seconds": 4,
                    "max_seconds": 15,
                    "resolutions": ["720p"],
                    "default_resolution": "720p",
                    "max_images": 9,
                    "max_videos": 3,
                    "max_audios": 3,
                    "frames": False,
                },
            },
            {
                "id": "MiniMax-H3",
                "capability": "video",
                "video": {
                    "min_seconds": 4,
                    "max_seconds": 15,
                    "resolutions": ["768P"],
                    "default_resolution": "768P",
                    "max_images": 9,
                    "max_videos": 3,
                    "max_audios": 3,
                    "frames": True,
                },
            },
            {"id": "gpt-6-astra", "capability": "text"},
            {"id": "glm-5.3", "capability": "text"},
            {"id": "Deepseek-v4.1-flash", "capability": "text"},
        ],
        "defaults": {"image": "gpt-image-2.5-flare", "video": "Wan-3.0-720p", "text": "gpt-6-astra"},
    },
}

ICON_BY_ID = {
    "gpt-image-2.5-flare": "OpenAI",
    "gpt-image-2.5-sunburst": "OpenAI",
    "banana-2.1": "NanoBanana.Color",
    "Wan-3.0-720p": "Qwen.Color",
    "Wan-3.0-1080p": "Qwen.Color",
    "Kling-4.0": "Kling.Color",
    "Kling-4.0-fast": "Kling.Color",
    "Seedance-2.5-480p": "Doubao.Color",
    "Seedance-2.5-720p": "Doubao.Color",
    "Seedance-2.0-720p": "Doubao.Color",
    "Seedance-2.0-fast-720p": "Doubao.Color",
    "MiniMax-H3": "Minimax.Color",
    "gpt-6-astra": "OpenAI",
    "glm-5.3": "Zhipu.Color",
    "Deepseek-v4.1-flash": "DeepSeek.Color",
}
for _model in BOOTSTRAP["data"]["models"]:
    _model["icon"] = ICON_BY_ID.get(_model["id"], "")

IMAGE_SPECS = {
    "gpt-image-2.5-flare": {
        "qualities": ["auto", "low", "medium", "high", "xhigh", "max"],
        "resolutions": ["1k", "2k", "4k", "auto"],
        "ratios": ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "auto"],
        "max_count": 15,
        "supports_background": True,
    },
    "gpt-image-2.5-sunburst": {
        "qualities": ["auto", "low", "medium", "high", "xhigh", "max"],
        "resolutions": ["1k", "2k", "4k", "auto"],
        "ratios": ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "auto"],
        "max_count": 15,
        "supports_background": True,
    },
    "banana-2.1": {
        "resolutions": ["1k", "2k", "4k", "auto"],
        "ratios": ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16"],
        "max_count": 10,
        "supports_background": False,
    },
}
for _model in BOOTSTRAP["data"]["models"]:
    if _model["id"] in IMAGE_SPECS:
        _model["image"] = IMAGE_SPECS[_model["id"]]

NOTICE = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地预览</title>
<body style="font-family:system-ui;padding:40px;line-height:1.7">
<h2>本地预览环境</h2>
<p>登录、余额、模型和生成接口都是本地模拟数据，不是词元API 生产环境。</p>
<p><a href="/canvas/">重新进入词元画布</a></p>
</body></html>"""

BADGE = """<script>
document.addEventListener("DOMContentLoaded", function () {
  var badge = document.createElement("div");
  badge.textContent = "本地预览 · 模拟词元接口";
  badge.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;padding:6px 10px;border-radius:8px;background:rgba(17,24,39,.82);color:#fff;font:12px/1.4 system-ui;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.2)";
  document.body.appendChild(badge);
});
</script>"""


def render_index():
    with open(os.path.join(ROOT, "index.html"), "r", encoding="utf-8") as handle:
        html = handle.read()
    return html.replace("</body>", f"{BADGE}</body>")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".mp4": "video/mp4",
    }

    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _html(self, html, status=200):
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, payload, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "public, max-age=60")
        self.end_headers()
        self.wfile.write(payload)

    def translate_path(self, path):
        parsed = urllib.parse.urlparse(path)
        url_path = parsed.path
        if url_path.startswith("/canvas/"):
            rel = url_path[len("/canvas/") :]
            if rel.startswith(("assets/", "icons/", "brand/")) or rel in ("config.js", "logo.svg", "plugins/index.json"):
                return os.path.join(ROOT, rel.replace("/", os.sep))
            return os.path.join(ROOT, "index.html")
        return os.path.join(ROOT, "index.html")

    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/canvas/")
            self.end_headers()
            return
        if self.path == "/canvas":
            self.send_response(302)
            self.send_header("Location", "/canvas/")
            self.end_headers()
            return
        if self.path.startswith("/api/canvas/bootstrap"):
            self._json(BOOTSTRAP)
            return
        if self.path.startswith("/api/canvas/storage"):
            self._json({"success": True, "message": "", "data": {"storage": PREVIEW_STORAGE, "assets": []}})
            return
        if self.path.startswith("/api/canvas/projects"):
            self._json({"success": True, "message": "", "data": {"projects": list(PREVIEW_PROJECTS.values())}})
            return
        if self.path.startswith("/api/canvas/image-results/"):
            request_id = self.path.rsplit("/", 1)[-1]
            if request_id.startswith("img_previewdone"):
                self._json({"success": True, "message": "", "data": {"request_id": request_id, "status": "completed", "created_at": 0, "expires_at": 0, "assets": [{"name": "0" * 32 + ".png", "url": "/canvas-assets/" + "0" * 32 + ".png"}]}})
                return
            self._json({"success": False, "message": "preview endpoint not implemented"}, 404)
            return
        if self.path.startswith("/v1/models"):
            self._json({"object": "list", "data": [{"id": item["id"], "object": "model"} for item in BOOTSTRAP["data"]["models"]]})
            return
        if self.path.startswith("/v1/media/status/"):
            self._json({"task_id": "preview-task", "state": "success", "is_final": True, "progress": 100, "billing_pending": False})
            return
        if self.path.startswith("/v1/tasks/") and self.path.endswith("/artifacts/video/content"):
            self._bytes(MP4_BYTES, "video/mp4")
            return
        if self.path.startswith("/v1/tasks/") and self.path.endswith("/artifacts/image/content"):
            self._bytes(PNG_BYTES, "image/png")
            return
        if self.path.startswith("/canvas-assets/"):
            self._bytes(PNG_BYTES, "image/png")
            return
        if self.path.startswith(("/sign-in", "/wallet", "/keys", "/docs")):
            self._html(NOTICE)
            return
        if self.path.startswith(("/api/", "/v1/")):
            self._json({"success": False, "message": "preview endpoint not implemented"}, 404)
            return
        if self.path.startswith("/canvas/"):
            parsed = urllib.parse.urlparse(self.path)
            rel = parsed.path[len("/canvas/") :]
            if not rel:
                self._html(render_index())
                return
            if rel.startswith(("assets/", "icons/", "brand/")) or rel in ("config.js", "logo.svg", "plugins/index.json"):
                super().do_GET()
                return
            self._html(render_index())
            return
        self._html(NOTICE if self.path in ("/sign-in",) else NOTICE)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if self.path.startswith("/api/user/auth/refresh"):
            self._json({"success": True, "message": "", "data": {"access_token": "preview-access", "access_expires_at": 4102444800}})
            return
        if self.path.startswith("/v1/media/generate"):
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                body = {}
            print("media generate:", json.dumps(body, ensure_ascii=False), flush=True)
            self._json({"code": 200, "msg": "success", "data": {"task_id": "preview-task"}})
            return
        if self.path.startswith("/v1/images/generations"):
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                body = {}
            count = int(body.get("n") or 1)
            print("image generate reqid=%s:" % (self.headers.get("X-Ciyuan-Request-Id") or "-"), json.dumps(body, ensure_ascii=False), flush=True)
            self._json({"created": 0, "data": [{"b64_json": PNG_B64} for _ in range(max(1, min(count, 10)))]})
            return
        if self.path.startswith("/v1/images/edits"):
            print("image edit:", self.headers.get("Content-Type", ""), flush=True)
            self._json({"created": 0, "data": [{"b64_json": PNG_B64}]})
            return
        if self.path.startswith("/api/canvas/assets/cleanup"):
            self._json({"success": True, "message": "", "data": {"deleted": 0, "freed": 0, "storage": PREVIEW_STORAGE}})
            return
        if self.path.startswith("/api/canvas/assets"):
            self._json({"success": True, "message": "", "data": {"path": "/canvas-assets/" + "0" * 32 + ".png"}})
            return
        if self.path.startswith("/api/user/auth/logout"):
            self._json({"success": True, "message": ""})
            return
        if self.path.startswith(("/api/", "/v1/")):
            self._json({"success": False, "message": "preview endpoint not implemented"}, 404)
            return
        self._json({"success": False, "message": "preview endpoint not implemented"}, 404)

    def do_PUT(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if self.path.startswith("/api/canvas/settings"):
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                body = {}
            PREVIEW_STORAGE["retention_days"] = int(body.get("retention_days") or 7)
            self._json({"success": True, "message": "", "data": PREVIEW_STORAGE})
            return
        if self.path.startswith("/api/canvas/projects/"):
            project_id = self.path.rsplit("/", 1)[-1]
            try:
                project = json.loads(raw.decode("utf-8"))
            except Exception:
                project = None
            if isinstance(project, dict):
                PREVIEW_PROJECTS[project_id] = {"id": project_id, "title": project.get("title", ""), "bytes": len(raw), "created_at": 0, "updated_at": 0, "data": project}
            self._json({"success": True, "message": "", "data": {"id": project_id, "bytes": len(raw), "saved_at": 0}})
            return
        self._json({"success": False, "message": "preview endpoint not implemented"}, 404)

    def do_DELETE(self):
        if self.path.startswith("/api/canvas/projects/"):
            PREVIEW_PROJECTS.pop(self.path.rsplit("/", 1)[-1], None)
            self._json({"success": True, "message": "", "data": None})
            return
        if self.path.startswith("/api/canvas/assets/"):
            self._json({"success": True, "message": "", "data": {"deleted": self.path.rsplit("/", 1)[-1]}})
            return
        self._json({"success": False, "message": "preview endpoint not implemented"}, 404)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"preview: http://127.0.0.1:{PORT}/canvas/", flush=True)
    server.serve_forever()
