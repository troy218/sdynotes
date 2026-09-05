#!/usr/bin/env python3
"""Temporary upload receiver for the Google Drive fetch.

Runs locally in the sandbox. The GitHub Actions runner downloads the Drive
file and POSTs it here; this server stores it in the workspace.

usage: python3 scripts/upload_server.py [port]
"""
import http.server
import os
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
OUT = Path("/home/user/sdynotes/_incoming")  # inside repo, ignored by git
OUT.mkdir(parents=True, exist_ok=True)

print(f"[upload_server] listening on 0.0.0.0:{PORT} -> {OUT}", flush=True)


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "UploadServer/1.0"

    def do_GET(self):
        if self.path.rstrip("/") in ("/", "/health"):
            body = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path.startswith("/upload"):
            name = "implement-ai-real-time-editing.zip"
            qs = self.path.split("?", 1)[-1]
            for part in qs.split("&"):
                if part.startswith("name="):
                    from urllib.parse import unquote

                    name = unquote(part.split("=", 1)[1])
                if part.startswith("token="):
                    pass
            dest = OUT / name
            size = 0
            with dest.open("wb") as fh:
                while True:
                    chunk = self.rfile.read(1024 * 256)
                    if not chunk:
                        break
                    fh.write(chunk)
                    size += len(chunk)
            print(f"[upload_server] saved {dest} ({size} bytes)", flush=True)
            body = f"saved {size} bytes\n".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt, *args):
        print("[upload_server]", fmt % args, flush=True)


if __name__ == "__main__":
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
