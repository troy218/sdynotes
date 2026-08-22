#!/usr/bin/env python3
"""SDYnotes-fast 전면 스모크 테스트 (로컬 폴백 모드).

Node(:5000) + worker(:5100) 가 살아있는 상태에서 실행한다.
모든 엔드포인트의 상태코드/본문을 기록하고, 테스트 데이터는 정리한다.
외부 네트워크(번역/클라우드)는 설정돼 있지 않으므로 해당 결과는 참고용이다.
"""
import io
import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = os.environ.get("SDY_BASE", "http://127.0.0.1:5000")
PASS, FAIL, SKIP = [], [], []


def call(method, path, body=None, form=None, files=None, timeout=20, headers=None):
    url = BASE + path
    h = dict(headers or {})
    data = None
    if form is not None:
        # multipart
        import uuid
        boundary = "----sdy" + uuid.uuid4().hex
        buf = io.BytesIO()
        for k, v in form.items():
            buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
        for k, (fn, content, ctype) in (files or {}).items():
            buf.write((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fn}\"\r\n"
                       f"Content-Type: {ctype}\r\n\r\n").encode())
            buf.write(content)
            buf.write(b"\r\n")
        buf.write(f"--{boundary}--\r\n".encode())
        data = buf.getvalue()
        h["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()
    except Exception as e:
        return 0, {}, str(e).encode()


def check(name, method, path, body=None, expect=(200,), form=None, files=None,
          must_contain=None, must_not_contain=None, timeout=20):
    st, hd, raw = call(method, path, body=body, form=form, files=files, timeout=timeout)
    try:
        txt = raw.decode("utf-8", "replace")
    except Exception:
        txt = str(raw)
    short = txt[:160].replace("\n", " ")
    ok = st in expect
    if ok and must_contain:
        ok = must_contain in txt
    if ok and must_not_contain:
        ok = must_not_contain not in txt
    (PASS if ok else FAIL).append(f"{method:6s} {path:34s} -> {st} {short}")
    return st, txt


def section(t):
    print("\n\033[1;36m== %s ==\033[0m" % t)


PNG = (b"\x89PNG\r\n\x1a\n" + bytes.fromhex(
    "0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"))

print("BASE =", BASE)

# ── 페이지 / 기본 ──────────────────────────────────────────────
section("페이지 & 기본")
check("index", "GET", "/", expect=(200,), must_contain="SDYnotes")
check("health", "GET", "/api/health", expect=(200,), must_contain='"status":"ok"')
check("version", "GET", "/api/version", expect=(200,), must_contain='"ok":true')
check("storage(info)", "GET", "/api/storage/info", expect=(403,))
check("cloud/status", "GET", "/api/cloud/status", expect=(200,), must_contain='"ok":true')
check("server/stat", "GET", "/api/server/stat", expect=(200,))
check("404 라우트", "GET", "/api/nonexistent-xyz", expect=(404,))

# ── 관리자 ────────────────────────────────────────────────────
section("관리자 & 에스크로")
check("admin/status", "GET", "/api/admin/status", expect=(200,))
check("admin/login 실패", "POST", "/api/admin/login", body={"password": "wrongpw123"}, expect=(401, 403, 429))
st, txt = check("admin/status(차단 아님)", "GET", "/api/admin/status", expect=(200,))
check("escrow/wrap", "POST", "/api/escrow/wrap", body={"pw": "test123"}, expect=(200,), must_contain='"blob"')
check("escrow/unwrap(비관리자)", "POST", "/api/escrow/unwrap", body={"blob": "x"}, expect=(403,))

# ── 동기화 ────────────────────────────────────────────────────
section("동기화")
check("push 요소", "POST", "/api/sync/push",
      body={"nb": "smoke_note", "ops": [{"id": "el-a", "rev": 1, "data": {"v": "hi"}}]},
      expect=(200,), must_contain='"accepted"')
check("pull", "GET", "/api/sync/pull?nb=smoke_note&since=0", expect=(200,), must_contain="el-a")
check("push 구버전 거부", "POST", "/api/sync/push",
      body={"nb": "smoke_note", "ops": [{"id": "el-a", "rev": 1, "data": {"v": "old"}}]},
      expect=(200,), must_contain='"rejected"')
check("설정 오래된 스키마 409", "POST", "/api/sync/push",
      body={"nb": "__settings__", "schema": 1, "ops": [{"id": "bookmark:1", "rev": 1, "kind": "put"}]},
      expect=(409,))
check("설정 정상 저장", "POST", "/api/sync/push",
      body={"nb": "__settings__", "schema": 3, "ops": [{"id": "bookmark:1", "rev": 2, "kind": "put", "data": "x"}]},
      expect=(200,), must_contain='"accepted"')
check("대량삭제 방화벽", "POST", "/api/sync/push",
      body={"nb": "__settings__", "schema": 3,
            "ops": [{"id": "bookmark:%d" % i, "rev": 10 + i, "kind": "del"} for i in range(5)]},
      expect=(200,), must_contain='"blocked"')
check("pages kind", "POST", "/api/sync/push",
      body={"nb": "smoke_note", "ops": [{"id": "__pages__", "rev": 20, "kind": "pages", "ids": ["a", "b"]}]},
      expect=(200,))
check("pull pages", "GET", "/api/sync/pull?nb=smoke_note&since=0", expect=(200,), must_contain='"pages"')

# ── 카드 ──────────────────────────────────────────────────────
section("카드")
check("cards/list", "GET", "/api/cards/list", expect=(200,))
check("cards/stats(빈 덱)", "GET", "/api/cards/stats/nope", expect=(200, 404))
check("cards/deck(없음)", "GET", "/api/cards/deck/nope", expect=(200, 404))
check("cards/text(입력없음)", "POST", "/api/cards/text", body={}, expect=(400, 403))
check("cards/preview(입력없음)", "POST", "/api/cards/preview", body={}, expect=(400, 403))
check("cards/upload(텍스트전용,410)", "POST", "/api/cards/upload", form={}, expect=(410,))
check("cards/grade(없음)", "POST", "/api/cards/grade", body={"id": "nope", "score": 1}, expect=(400, 404))
check("cards/delete(없음)", "POST", "/api/cards/delete", body={"id": "nope"}, expect=(400, 404, 403))
check("cards/sample", "GET", "/api/cards/sample", expect=(200, 404))

# ── 스티커 ────────────────────────────────────────────────────
section("스티커")
check("stickers/list", "GET", "/api/stickers/list", expect=(200,), must_contain='"ok":true')
check("stickers/save(이미지아님)", "POST", "/api/stickers/save", body={"data": "notanimage"}, expect=(400,))
check("stickers/delete(없음)", "POST", "/api/stickers/delete", body={"id": "nope"}, expect=(404,))

# ── 배경화면 ──────────────────────────────────────────────────
section("배경화면")
check("wallpaper/upload(파일없음)", "POST", "/api/wallpaper/upload", form={}, expect=(400,))
st, txt = check("wallpaper/upload(정상)", "POST", "/api/wallpaper/upload",
                form={"x": "1"}, files={"file": ("bg.png", PNG, "image/png")},
                expect=(200,), must_contain='"url"')
wall_id = None
try:
    wall_id = json.loads(txt).get("id")
except Exception:
    pass
if wall_id:
    check("wallpaper/서빙", "GET", "/api/wallpaper/" + wall_id, expect=(200,))

# ── 번역 (외부 네트워크) ──────────────────────────────────────
section("번역 (외부 네트워크, 참고)")
check("translate(입력없음)", "POST", "/api/translate", body={}, expect=(400,))
st, txt = check("translate(ko->en)", "POST", "/api/translate", body={"text": "안녕하세요", "target": "en"},
                expect=(200, 502), timeout=25)
check("translate/gloss(입력없음)", "POST", "/api/translate/gloss", body={}, expect=(200, 400))

# ── 알림 & 프레즌스 ───────────────────────────────────────────
section("알림 & 프레즌스 & 라이브")
check("notifications", "GET", "/api/notifications", expect=(200,))
check("notifications/event", "POST", "/api/notifications/event", body={"kind": "ping"}, expect=(200, 400))
check("notifications/study", "POST", "/api/notifications/study", body={}, expect=(200, 400))
check("notifications/read", "POST", "/api/notifications/read", body={"id": "x"}, expect=(200, 400))
check("notifications/delete", "POST", "/api/notifications/delete", body={"id": "x"}, expect=(200, 400, 403))
check("presence/ping", "POST", "/api/presence/ping", body={"uid": "dev1"}, expect=(200,))
check("live/ping", "POST", "/api/live/ping", body={"note": "n1", "uid": "u1", "x": 1, "y": 2}, expect=(200,))
check("live/leave", "POST", "/api/live/leave", body={"note": "n1", "uid": "u1"}, expect=(200,))

# ── 보관함(vault) ─────────────────────────────────────────────
section("보관함(vault)")
check("files/list(관리자)", "GET", "/api/files/list", expect=(403,))
check("files/upload(관리자)", "POST", "/api/files/upload", form={}, expect=(403,))
check("files/raw(없음)", "GET", "/api/files/raw/nope", expect=(404, 403))
check("files/delete(없음)", "POST", "/api/files/delete", body={"id": "nope"}, expect=(400, 404, 403))

# ── 음악 (Node + worker 프록시) ───────────────────────────────
section("음악")
check("music/list", "GET", "/api/music/list", expect=(200,), must_contain='"tracks"')
check("music/file(없음)", "GET", "/api/music/file/nope", expect=(404,))
check("music/lyrics(없음)", "GET", "/api/music/lyrics/nope", expect=(404,))
check("music/cover(없음)", "GET", "/api/music/cover/nope", expect=(404,))
check("music/play(id없음)", "POST", "/api/music/play", body={}, expect=(400, 404))
check("music/upload(파일없음)", "POST", "/api/music/upload", form={}, expect=(400,))
check("music/youtube(url없음)", "POST", "/api/music/youtube", body={}, expect=(400, 404))
check("music/lookup(id없음)", "POST", "/api/music/lookup", body={}, expect=(400, 404))
check("music/recognize(id없음)", "POST", "/api/music/recognize", body={}, expect=(200, 400, 404))
check("music/recognize/key", "POST", "/api/music/recognize/key", body={"key": "test"}, expect=(200, 400, 403))
check("music/recognize/status", "GET", "/api/music/recognize/status", expect=(200,))
check("music/rescan", "POST", "/api/music/rescan", body={}, expect=(200,))
check("music/reset(id없음)", "POST", "/api/music/reset", body={}, expect=(400, 404))
check("music/synced-lyrics", "POST", "/api/music/synced-lyrics", body={}, expect=(400, 404))
check("music/meta", "POST", "/api/music/meta", body={}, expect=(400, 404))
check("music/cover(저장)", "POST", "/api/music/cover", body={}, expect=(400, 404))
check("music/from_url", "POST", "/api/music/from_url", body={}, expect=(400, 404))
check("music/background-work", "POST", "/api/music/background-work", body={"idle": True},
      expect=(200,), must_contain='"idle_burst_started"')
check("music/youtube/status", "GET", "/api/music/youtube/status", expect=(200,))
check("music/youtube/cookies(관리자)", "POST", "/api/music/youtube/cookies", body={"cookies": "x"}, expect=(403,))
check("music/youtube/cookies(삭제)", "DELETE", "/api/music/youtube/cookies", expect=(403,))

# ── 가져오기 (worker 프록시) ──────────────────────────────────
section("가져오기")
check("import/status(없음)", "GET", "/api/import/status?id=nope", expect=(200, 404))
check("import/doc(파일없음)", "POST", "/api/import/doc", form={}, expect=(400, 500))
check("import/upload(파일없음)", "POST", "/api/import/upload", form={}, expect=(400, 500))
check("import/docfile(없음)", "GET", "/api/import/docfile/nope", expect=(404, 400))
check("import/bg(없음)", "GET", "/api/import/bg/nope/1", expect=(404, 400))
check("import/reconv(입력없음)", "POST", "/api/import/reconv", body={}, expect=(400, 404))

# ── 테스트 데이터 정리 ────────────────────────────────────────
import glob as _glob
for p in _glob.glob(os.path.join(os.path.dirname(__file__), "..", "sync", "*")) + \
         _glob.glob(os.path.join(os.path.dirname(__file__), "..", "wallpaper", "*.jpg")):
    try:
        os.remove(p)
    except Exception:
        pass
try:
    os.rmdir(os.path.join(os.path.dirname(__file__), "..", "sync"))
except Exception:
    pass

# ── 결과 ──────────────────────────────────────────────────────
print("\n\033[1m결과: PASS %d / FAIL %d\033[0m" % (len(PASS), len(FAIL)))
for line in FAIL:
    print("  \033[31m✗\033[0m", line)
sys.exit(1 if FAIL else 0)
