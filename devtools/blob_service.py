"""Single-app local fixture; deployed apps use Rukie's Azure-backed storage API."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re

ROOT = Path("/data")
ROOT.mkdir(exist_ok=True)

class Handler(BaseHTTPRequestHandler):
    def handle_object(self):
        if self.headers.get("Authorization") != "Bearer local-development-only":
            self.send_error(401)
            return
        match = re.fullmatch(r"/blobs/([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})", self.path)
        if not match:
            self.send_error(404)
            return
        path = ROOT / match[1]
        if self.command == "PUT":
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 8 * 1024 * 1024:
                self.send_error(413)
                return
            path.write_bytes(self.rfile.read(size))
            self.send_response(204)
            self.end_headers()
        elif self.command == "DELETE":
            path.unlink(missing_ok=True)
            self.send_response(204)
            self.end_headers()
        elif not path.exists():
            self.send_error(404)
        else:
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    do_GET = do_PUT = do_DELETE = handle_object

ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
