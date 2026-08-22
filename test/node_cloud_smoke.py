#!/usr/bin/env python3
"""Node 클라우드 모드 통합 스모크.

전제: mock_cloud.py(:5231) 가 떠 있고, Node(:5000) 가 다음 env 로 기동돼 있어야 한다.
  SUPABASE_URL=http://127.0.0.1:5231  SUPABASE_SERVICE_KEY=test-service-key
  CLOUDINARY_CLOUD_NAME=testcloud CLOUDINARY_API_KEY=k CLOUDINARY_API_SECRET=s
"""
import io
import json
import os
import uuid
import urllib.request
import urllib.error

BASE = os.environ.get("SDY_BASE", "http://127.0.0.1:5000")
PASS, FAIL = [], []


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def call(method, path, body=None, timeout=20, token=None, files=None, form=None):
    url = BASE + path
    h = {}
    if token:
        h["Authorization"] = "Bearer " + token
    data = None
    if files is not None or form is not None:
        b = "----sdy" + uuid.uuid4().hex
        buf = io.BytesIO()
        for k, v in (form or {}).items():
            buf.write(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
        for k, (fn, content, ct) in (files or {}).items():
            buf.write((f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fn}\"\r\nContent-Type: {ct}\r\n\r\n").encode())
            buf.write(content)
            buf.write(b"\r\n")
        buf.write(f"--{b}--\r\n".encode())
        data = buf.getvalue()
        h["Content-Type"] = f"multipart/form-data; boundary={b}"
    elif body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with _opener.open(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("  \033[32m✓\033[0m " if cond else "  \033[31m✗\033[0m ") + name + (f"  {extra}" if extra else ""))


def hget(hd, key):
    for k, v in hd.items():
        if k.lower() == key.lower():
            return v
    return None


print("== cloud/status ==")
st, hd, raw = call("GET", "/api/cloud/status")
d = json.loads(raw)
check("cloud/status 200 + supabase/cloudinary/schema", st == 200 and d.get("supabase") and d.get("cloudinary") and d.get("schema"), str(d)[:120])

print("== 음악 (클라우드 읽기) ==")
st, hd, raw = call("GET", "/api/music/list")
d = json.loads(raw)
check("music/list 200", st == 200 and d.get("ok"), f"st={st}")
check("music/list 1곡", len(d.get("tracks", [])) == 1, f"tracks={len(d.get('tracks', []))}")
t = (d.get("tracks") or [{}])[0]
check("곡 id m1", t.get("id") == "m1")
check("stream_url CDN", "/video/upload/" in (t.get("stream_url") or ""), str(t.get("stream_url"))[:60])

st, hd, raw = call("GET", "/api/music/file/m1")
check("music/file 302 리다이렉트", st == 302 and hget(hd, "Location"), f"st={st} loc={hd.get('Location','')[:50]}")

st, hd, raw = call("GET", "/api/music/cover/m1")
check("music/cover 302 리다이렉트", st == 302 and hget(hd, "Location"), f"st={st}")

st, hd, raw = call("GET", "/api/music/lyrics/m1")
d = json.loads(raw)
check("music/lyrics 200", st == 200 and d.get("ok") and d.get("id") == "m1", f"st={st} {raw[:80]}")

st, hd, raw = call("POST", "/api/music/play", body={"id": "m1"})
d = json.loads(raw)
check("music/play play_count 1", st == 200 and d.get("play_count") == 1, f"st={st} {raw[:80]}")

st, hd, raw = call("POST", "/api/music/play", body={"id": "m1"})
check("music/play play_count 2", json.loads(raw).get("play_count") == 2)

print("== 스티커 (클라우드) ==")
st, hd, raw = call("GET", "/api/stickers/list")
d = json.loads(raw)
check("stickers/list 200", st == 200 and d.get("ok"), f"st={st}")
check("stickers/list 1개", len(d.get("stickers", [])) == 1, f"n={len(d.get('stickers', []))}")

st, hd, raw = call("GET", "/api/stickers/raw/s1")
check("stickers/raw 302", st == 302 and hget(hd, "Location"), f"st={st}")

print("== 카드 (클라우드) ==")
st, hd, raw = call("GET", "/api/cards/list")
d = json.loads(raw)
check("cards/list 200", st == 200 and d.get("ok"), f"st={st}")
deck = (d.get("decks") or [{}])[0]
check("cards/list 덱 통계", deck.get("id") == "d1" and deck.get("count") == 2 and deck.get("learned") == 1 and deck.get("due") == 1, str(deck)[:140])
st, hd, raw = call("GET", "/api/cards/deck/d1")
check("cards/deck 200", st == 200 and json.loads(raw).get("deck", {}).get("id") == "d1", f"st={st}")

print("== 동기화 (클라우드 Supabase) ==")
st, hd, raw = call("POST", "/api/sync/push", body={"nb": "cloud_note", "ops": [{"id": "e1", "rev": 1, "data": {"v": "x"}}]})
check("sync/push 200", st == 200 and json.loads(raw).get("ok"), f"st={st} {raw[:80]}")
st, hd, raw = call("GET", "/api/sync/pull?nb=cloud_note&since=0")
d = json.loads(raw)
check("sync/pull 1 op", st == 200 and len(d.get("ops", [])) == 1, f"st={st} {raw[:80]}")

print("== 관리자 로그인 + 음악 삭제 ==")
st, hd, raw = call("POST", "/api/admin/login", body={"password": "818988"})
tok = json.loads(raw).get("token")
check("admin/login", st == 200 and tok, f"st={st}")
st, hd, raw = call("POST", "/api/music/delete", body={"id": "m1", "token": tok}, token=tok)
check("music/delete(관리자) 200", st == 200 and json.loads(raw).get("ok"), f"st={st} {raw[:80]}")
st, hd, raw = call("GET", "/api/music/list")
check("music/list 삭제 반영", json.loads(raw).get("count") == 0, raw[:80])

print("== 스티커 삭제 (클라우드, Cloudinary destroy 무시) ==")
st, hd, raw = call("POST", "/api/stickers/delete", body={"id": "s1"})
check("stickers/delete 200", st == 200 and json.loads(raw).get("ok"), f"st={st} {raw[:80]}")
st, hd, raw = call("GET", "/api/stickers/list")
check("stickers/list 0개", len(json.loads(raw).get("stickers", [])) == 0)

print("== Cloudinary 쓰기 경로 (모의) ==")
PNG = (b"\x89PNG\r\n\x1a\n" + bytes.fromhex(
    "0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"))
import base64 as b64

st, hd, raw = call("POST", "/api/stickers/save", body={"name": "뉴", "data": "data:image/png;base64," + b64.b64encode(PNG).decode()})
d = json.loads(raw)
check("stickers/save(클라우드) 200", st == 200 and d.get("ok") and d.get("storage") == "cloudinary" and "/image/upload/" in (d.get("url") or ""), f"st={st} {raw[:100]}")

st, hd, raw = call("POST", "/api/wallpaper/upload", files={"file": ("bg.png", PNG, "image/png")})
d = json.loads(raw)
check("wallpaper/upload(클라우드) 200", st == 200 and d.get("ok") and d.get("storage") == "cloudinary" and d.get("url"), f"st={st} {raw[:100]}")

st, hd, raw = call("POST", "/api/upload", files={"file": ("note.png", PNG, "image/png")})
d = json.loads(raw)
check("note image upload(클라우드) 200", st == 200 and d.get("public_id") and d.get("url"), f"st={st} {raw[:100]}")

print("\n\033[1mNode 클라우드 모드 결과: PASS %d / FAIL %d\033[0m" % (len(PASS), len(FAIL)))
for f in FAIL:
    print("  \033[31m✗\033[0m", f)
import sys
sys.exit(1 if FAIL else 0)
