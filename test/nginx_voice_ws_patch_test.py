#!/usr/bin/env python3
"""기존 nginx site 에 voice-ws 를 끼워 넣는 패처 단위 테스트."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import ensure_nginx_voice_ws as patch  # noqa: E402


OLD_HTTP = """server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 100M;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
"""

CERTBOT_HTTP_HTTPS = """server {
    listen 80;
    server_name notes.example.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name notes.example.com;
    ssl_certificate /etc/letsencrypt/live/notes.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/notes.example.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Connection "";
    }
}
"""

MIXED = """server {
    listen 80;
    server_name _;
    location /api/chat/voice-ws {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Connection "upgrade";
    }
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Connection "";
    }
}
server {
    listen 443 ssl;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Connection "";
    }
}
"""


class PatchText(unittest.TestCase):
    def test_old_http_only_inserts_once_before_root(self):
        out, n = patch.patch_text(OLD_HTTP, "5000")
        self.assertEqual(n, 1)
        self.assertIn("location /api/chat/voice-ws", out)
        self.assertLess(out.index("location /api/chat/voice-ws"), out.index("location / {"))
        self.assertIn('Connection "upgrade"', out)
        self.assertIn("proxy_read_timeout 3600s", out)
        self.assertIn("proxy_pass http://127.0.0.1:5000;", out)

    def test_certbot_skips_redirect_block_and_patches_443(self):
        out, n = patch.patch_text(CERTBOT_HTTP_HTTPS, "5000")
        self.assertEqual(n, 1)
        self.assertEqual(out.count("location /api/chat/voice-ws"), 1)
        https = out.split("listen 443")[1]
        self.assertIn("location /api/chat/voice-ws", https)
        http = out.split("listen 443")[0]
        self.assertNotIn("location /api/chat/voice-ws", http)

    def test_already_present_is_idempotent(self):
        once, n1 = patch.patch_text(OLD_HTTP, "5000")
        twice, n2 = patch.patch_text(once, "5000")
        self.assertEqual(n1, 1)
        self.assertEqual(n2, 0)
        self.assertEqual(once, twice)
        self.assertEqual(once.count("location /api/chat/voice-ws"), 1)

    def test_mixed_only_fills_missing_server_block(self):
        out, n = patch.patch_text(MIXED, "5000")
        self.assertEqual(n, 1)
        self.assertEqual(out.count("location /api/chat/voice-ws"), 2)
        http, https = out.split("listen 443")
        self.assertIn("location /api/chat/voice-ws", http)
        self.assertIn("location /api/chat/voice-ws", https)

    def test_custom_port(self):
        out, n = patch.patch_text(OLD_HTTP, "5001")
        self.assertEqual(n, 1)
        self.assertIn("proxy_pass http://127.0.0.1:5001;", out)
        self.assertNotIn("proxy_pass http://127.0.0.1:5000;\n        proxy_http_version 1.1;", out)

    def test_does_not_match_other_locations(self):
        src = (
            "server {\n"
            "    location /api/ {\n"
            "        proxy_pass http://127.0.0.1:5000;\n"
            "    }\n"
            "    location / {\n"
            "        proxy_pass http://127.0.0.1:5000;\n"
            "    }\n"
            "}\n"
        )
        out, n = patch.patch_text(src, "5000")
        self.assertEqual(n, 1)
        # location /api/ 는 건드리지 않고, 루트 location / 바로 앞에만 넣는다.
        self.assertIn("location /api/ {", out)
        self.assertLess(out.index("location /api/chat/voice-ws"), out.index("    location / {"))


class PatchFile(unittest.TestCase):
    def test_file_roundtrip_and_already(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "memo")
            with open(path, "w", encoding="utf-8") as f:
                f.write(OLD_HTTP)
            self.assertEqual(patch.patch_file(path, "5000"), "inserted 1")
            with open(path, encoding="utf-8") as f:
                body = f.read()
            self.assertIn("location /api/chat/voice-ws", body)
            self.assertEqual(patch.patch_file(path, "5000"), "already")

    def test_no_root_location(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "memo")
            with open(path, "w", encoding="utf-8") as f:
                f.write("server {\n    listen 80;\n    return 301 https://$host$request_uri;\n}\n")
            self.assertEqual(patch.patch_file(path, "5000"), "unchanged")


class ApplyShWiresPatcher(unittest.TestCase):
    def test_apply_calls_patcher_on_existing_site(self):
        with open(os.path.join(ROOT, "apply.sh"), encoding="utf-8") as f:
            apply = f.read()
        self.assertIn("ensure_nginx_voice_ws.py", apply)
        self.assertIn("location /api/chat/voice-ws", apply)
        # 파일이 이미 있을 때도 보강해야 한다 (재실행해도 경고가 남던 버그)
        else_idx = apply.index("nginx 대기 시간/SSE")
        self.assertLess(apply.index("ensure_nginx_voice_ws.py"), else_idx)
        self.assertIn("VOICE_WS=${VOICE_WS:-0}", apply)
        self.assertNotIn("|| echo 0)", apply.split("VOICE_WS=")[1].split("\n")[0])


if __name__ == "__main__":
    unittest.main()
