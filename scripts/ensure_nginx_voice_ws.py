#!/usr/bin/env python3
"""기존 nginx site 에 /api/chat/voice-ws Upgrade 경로를 보강한다.

apply.sh 는 예전에는 /etc/nginx/sites-available/memo 가 없을 때만
location 을 썼다. 이미 떠 있는 서버에서 재실행하면 파일이 있어
timeout/buffering 만 고치고 음성 경로는 영영 빠졌다.

사용: python3 ensure_nginx_voice_ws.py <nginx-conf> [backend-port]
종료: 0 = 이미 있음 또는 삽입 성공, 1 = 오류
표준출력: already | inserted N | unchanged
"""
from __future__ import annotations

import re
import sys

DEFAULT_PORT = "5000"
LOCATION_MARK = "location /api/chat/voice-ws"
ROOT_LOCATION = re.compile(r"(^[ \t]*location[ \t]+/[ \t]*\{)", re.M)
SERVER_HEAD = re.compile(r"\bserver\s*\{")


def voice_block(port: str) -> str:
    return (
        "    location /api/chat/voice-ws {\n"
        "        proxy_pass http://127.0.0.1:%s;\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_set_header Upgrade $http_upgrade;\n"
        '        proxy_set_header Connection "upgrade";\n'
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_read_timeout 3600s;\n"
        "        proxy_send_timeout 3600s;\n"
        "        proxy_buffering off;\n"
        "    }\n"
    ) % port


def server_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    i = 0
    while True:
        m = SERVER_HEAD.search(text, i)
        if not m:
            break
        brace = m.end() - 1
        depth = 0
        j = brace
        while j < len(text):
            ch = text[j]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    spans.append((m.start(), j + 1))
                    i = j + 1
                    break
            j += 1
        else:
            break
    return spans


def patch_text(text: str, port: str) -> tuple[str, int]:
    """각 server 블록의 location / 앞에 voice-ws 를 넣는다. 이미 있으면 건너뛴다."""
    block = voice_block(port)
    inserted = 0
    pieces: list[str] = []
    last = 0
    for start, end in server_spans(text):
        pieces.append(text[last:start])
        body = text[start:end]
        if LOCATION_MARK in body:
            pieces.append(body)
        else:
            m = ROOT_LOCATION.search(body)
            if m:
                body = body[: m.start()] + block + body[m.start() :]
                inserted += 1
            pieces.append(body)
        last = end
    pieces.append(text[last:])
    return "".join(pieces), inserted


def patch_file(path: str, port: str) -> str:
    with open(path, encoding="utf-8") as f:
        original = f.read()
    updated, n = patch_text(original, port)
    if n == 0:
        if LOCATION_MARK in original:
            return "already"
        return "unchanged"
    with open(path, "w", encoding="utf-8") as f:
        f.write(updated)
    return "inserted %d" % n


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write("usage: ensure_nginx_voice_ws.py <nginx-conf> [port]\n")
        return 1
    path = argv[1]
    port = argv[2] if len(argv) > 2 else DEFAULT_PORT
    if not re.fullmatch(r"\d{2,5}", port):
        sys.stderr.write("invalid port: %s\n" % port)
        return 1
    try:
        print(patch_file(path, port))
    except OSError as e:
        sys.stderr.write("%s\n" % e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
