"""Local TAB editor and explicit, reviewable recognition jobs."""

import argparse
import json
import mimetypes
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import urlopen
import webbrowser
import socket
from recognition import RecognitionService
from pdf_import import PDFImporter
from library import ScoreLibrary, LibraryConflict


APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent
WEB = APP_DIR / "web"
PORT = 8765
RECOGNITION = RecognitionService(APP_DIR / '.runtime' / 'recognition')
PDF_IMPORTER = PDFImporter()
LIBRARY = ScoreLibrary(ROOT / '乐谱库')
SAMPLES = {
    "duvet": {
        "title": "Duvet", "subtitle": "第 1–2 小节 · 单音与两位品位", "image": "duvet.png",
        "file": "experiments/runs/20260928-202008-beccf0/note_positions_resolved.json",
        "crop": [115, 230, 980, 370], "width": 1462, "height": 1141,
    },
    "lullaby": {
        "title": "Lullaby", "subtitle": "第 2–3 小节 · 多弦同时弹", "image": "lullaby.jpg",
        "file": "experiments/runs/20260928-154822-e8652a/04_cells_review_prediction.json",
        "crop": [65, 550, 1375, 790], "width": 1440, "height": 1969,
    },
}


def available_samples():
    return {key: item for key, item in SAMPLES.items()
            if (ROOT / item['file']).is_file() and (ROOT / item['image']).is_file()}


def sample_score(key):
    config = SAMPLES[key]
    raw = json.loads((ROOT / config["file"]).read_text(encoding="utf-8"))
    raw["preview_source"] = {"id": "page-1", "name": config["image"],
        "url": f"/api/images/{key}", "width": config["width"], "height": config["height"],
        "cropBox": config["crop"]}
    raw["preview_title"] = config["title"]
    return raw


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        # On Windows SO_REUSEADDR can silently create several listening hosts.
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        origin = self.headers.get('Origin')
        allowed = {f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'}
        if origin and origin not in allowed:
            return self.json({'error': '仅允许本机应用提交请求'}, 403)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 60_000_000:
                raise ValueError('请求为空或文件超过大小限制')
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('请求格式需为JSON')
            value = json.loads(self.rfile.read(size))
            if not isinstance(value, dict): raise ValueError('请求格式无效')
            path = urlsplit(self.path).path
            if path == '/api/library/save': return self.json(LIBRARY.save(value))
            if path == '/api/library/delete': return self.json(LIBRARY.delete(value))
            if path == '/api/recognition/pdf/open': return self.json(PDF_IMPORTER.open(value))
            if path == '/api/recognition/pdf/render': return self.json(PDF_IMPORTER.render(value))
            if path == '/api/recognition/config': return self.json(RECOGNITION.configure(value))
            if path == '/api/recognition/prepare': return self.json(RECOGNITION.prepare(value))
            if path == '/api/recognition/manual-segment': return self.json(RECOGNITION.add_manual_segment(value))
            if path == '/api/recognition/start': return self.json(RECOGNITION.start(value))
            if path.startswith('/api/recognition/jobs/') and path.endswith('/cancel'):
                return self.json(RECOGNITION.cancel(path.split('/')[-2]))
            return self.json({'error': '接口不存在'}, 404)
        except LibraryConflict as error:
            return self.json({'error':str(error)},409)
        except ValueError as error:
            return self.json({'error': str(error)[:500]}, 400)
        except (OSError, KeyError, TypeError):
            # Configuration/API failures never echo HTTP bodies or credentials.
            message='乐谱库操作失败，请检查文件夹权限及磁盘空间' if urlsplit(self.path).path in ('/api/library/save','/api/library/delete') else '请求处理失败，请检查图片、框选或接口设置'
            return self.json({'error':message},400)

    def send(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'")
        self.end_headers()
        self.wfile.write(data)

    def json(self, value, status=200):
        self.send(json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", status)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/agent-template':
            return self.send((ROOT / 'AGENT_IMPORT_TEMPLATE.md').read_bytes(), 'text/markdown; charset=utf-8')
        if path == '/api/library': return self.json(LIBRARY.list())
        if path.startswith('/api/library/'):
            try: return self.json(LIBRARY.read(path.split('/')[-1]))
            except ValueError as error: return self.json({'error':str(error)},404)
        if path == '/api/recognition/config': return self.json(RECOGNITION.settings())
        if path.startswith('/api/recognition/jobs/'):
            try: return self.json(RECOGNITION.status(path.split('/')[-1]))
            except ValueError: return self.json({'error': '识别任务不存在'}, 404)
        if path.startswith('/api/recognition/images/'):
            identifier = path.split('/')[-1]
            if identifier not in RECOGNITION.prepared: return self.json({'error': '原图不存在'}, 404)
            return self.send((RECOGNITION.directory / identifier / 'source.png').read_bytes(), 'image/png')
        if path == "/api/health":
            return self.json({"app": "TabLens", "version": "0.1.0"})
        if path == "/api/samples":
            return self.json([{ "id": key, "title": item["title"], "subtitle": item["subtitle"] }
                              for key, item in available_samples().items()])
        if path.startswith("/api/samples/"):
            key = path.removeprefix("/api/samples/")
            if key not in available_samples():
                return self.json({"error": "谱例不存在"}, 404)
            try:
                return self.json(sample_score(key))
            except (OSError, ValueError):
                return self.json({"error": "已保存的识别结果无法读取"}, 500)
        if path.startswith("/api/images/"):
            key = path.removeprefix("/api/images/")
            if key not in available_samples():
                return self.json({"error": "原图不存在"}, 404)
            file = ROOT / SAMPLES[key]["image"]
        else:
            file = (WEB / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
            if not file.is_relative_to(WEB.resolve()):
                return self.json({"error": "路径不存在"}, 404)
        if not file.is_file():
            return self.json({"error": "文件不存在"}, 404)
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if file.suffix == ".js":
            mime = "text/javascript"
        self.send(file.read_bytes(), mime)

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()
    address = f"http://127.0.0.1:{PORT}"
    try:
        server = LocalServer(("127.0.0.1", PORT), Handler)
    except OSError:
        try:
            with urlopen(address + "/api/health", timeout=2) as response:
                if json.load(response).get("app") != "TabLens":
                    raise ValueError("端口已被其他应用占用")
        except Exception:
            raise RuntimeError("TabLens 启动失败：本机8765端口被其他应用占用") from None
        if args.open_browser:
            webbrowser.open(address)
        return
    if args.open_browser:
        webbrowser.open(address)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
