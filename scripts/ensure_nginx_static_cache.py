#!/usr/bin/env python3
"""기존 nginx site 에 버전화된 프런트 에셋(sdynotes.js/css) 장기 캐시 경로를 보강한다.

14.13.5 · 2코어/12GB 박스 대응.
  ?v= 버전이 URL 에 박혀 있으므로 배포 시 URL 이 바뀐다 → 1년 immutable 캐시가
  안전하다. node 로 거쳐 갈 때마다 ETag 재확인 왕복이 사라지고, nginx 가
  직접 디스크에서 내보내면 node 이벤트 루프도 가벼워진다.

사용: python3 ensure_nginx_static_cache.py <nginx-conf> <app-dir>
종료: 0 = 이미 있음 또는 삽입 성공, 1 = 오류
표준출력: already | inserted N | unchanged
"""
from __future__ import annotations

import re
import sys

LOCATION_MARK = "location = /sdynotes.js"
ROOT_LOCATION = re.compile(r"(^[ \t]*location[ \t]+/[ \t]*\{)", re.M)
SERVER_HEAD = re.compile(r"\bserver\s*\{")


def asset_blocks(app_dir: str) -> str:
    return (
        "    # 14.13.5 · 버전화된 프런트 에셋 — nginx 가 디스크에서 직접 + 장기 캐시\n"
        "    location = /sdynotes.js {\n"
        "        root %s;\n"
        '        add_header Cache-Control "public, max-age=31536000, immutable";\n'
        "        access_log off;\n"
        "    }\n"
        "    location = /sdynotes.css {\n"
        "        root %s;\n"
        '        add_header Cache-Control "public, max-age=31536000, immutable";\n'
        "        access_log off;\n"
        "    }\n"
    ) % (app_dir, app_dir)


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


def patch_text(text: str, app_dir: str) -> tuple[str, int]:
    """각 server 블록의 location / 앞에 에셋 캐시 location 을 넣는다. 이미 있으면 건너뛴다."""
    block = asset_blocks(app_dir)
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
                body = body[: m.start()] + block + body[m.start():]
                inserted += 1
            pieces.append(body)
        last = end
    pieces.append(text[last:])
    return "".join(pieces), inserted


def patch_file(path: str, app_dir: str) -> str:
    with open(path, encoding="utf-8") as f:
        original = f.read()
    updated, n = patch_text(original, app_dir)
    if n == 0:
        if LOCATION_MARK in original:
            return "already"
        return "unchanged"
    with open(path, "w", encoding="utf-8") as f:
        f.write(updated)
    return "inserted %d" % n


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        sys.stderr.write("usage: ensure_nginx_static_cache.py <nginx-conf> <app-dir>\n")
        return 1
    path, app_dir = argv[1], argv[2]
    try:
        print(patch_file(path, app_dir))
    except OSError as e:
        sys.stderr.write("%s\n" % e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
