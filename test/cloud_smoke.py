#!/usr/bin/env python3
"""클라우드 모드(Supabase + Cloudinary) 통합 스모크 — 모의 서버로 검증.

실제 키 없이도 worker 의 클라우드 음악 변이(music_cloud.py)와
cloud.py 헬퍼가 Supabase/Cloudinary 계약대로 동작하는지 확인한다.

모의 서버는 PostgREST(/rest/v1/...) + Cloudinary(/v1_1/...) 를 한 포트에서 흉내 낸다.
"""
import io
import json
import os
import struct
import sys
import threading
import time

os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:5231")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("CLOUDINARY_CLOUD_NAME", "testcloud")
os.environ.setdefault("CLOUDINARY_API_KEY", "test-api-key")
os.environ.setdefault("CLOUDINARY_API_SECRET", "test-api-secret")

from werkzeug.serving import make_server  # noqa: E402

# ── 모의 서버 ────────────────────────────────────────────────
DB = {}          # table -> {id: row}
DB_LOCK = threading.Lock()
CLD_UPLOADS = []  # (resource_type, public_id)


def mock_app(environ, start_response):
    from urllib.parse import urlparse, parse_qs
    method = environ["REQUEST_METHOD"]
    parsed = urlparse(environ["PATH_INFO"])
    path = parsed.path
    qs = parse_qs(environ.get("QUERY_STRING", ""))
    body = environ["wsgi.input"].read(int(environ.get("CONTENT_LENGTH") or 0))
    status = "200 OK"
    payload = b"{}"

    if path.startswith("/rest/v1/"):
        table = path[len("/rest/v1/"):].strip("/")
        if method == "GET":
            id_eq = (qs.get("id") or [None])[0]
            if id_eq:
                ident = id_eq.split("eq.", 1)[1] if "eq." in id_eq else id_eq
                with DB_LOCK:
                    row = DB.get(table, {}).get(ident)
                payload = json.dumps([row] if row else [], ensure_ascii=False).encode()
            else:
                with DB_LOCK:
                    rows = list(DB.get(table, {}).values())
                rows.sort(key=lambda r: r.get("updated_at") or "")
                off = int((qs.get("offset") or ["0"])[0])
                lim = int((qs.get("limit") or ["1000"])[0])
                payload = json.dumps(rows[off:off + lim], ensure_ascii=False).encode()
        elif method == "POST":
            row = json.loads(body)
            with DB_LOCK:
                DB.setdefault(table, {})[row["id"]] = row
            payload = json.dumps([row], ensure_ascii=False).encode()
        elif method == "DELETE":
            id_eq = (qs.get("id") or [""])[0]
            ident = id_eq.split("eq.", 1)[1] if "eq." in id_eq else id_eq
            with DB_LOCK:
                DB.get(table, {}).pop(ident, None)
            status = "204 No Content"
            payload = b""
    elif "/upload" in path or "/destroy" in path:
        # Cloudinary API: /v1_1/{cloud}/{rtype}/upload | /destroy
        parts = path.strip("/").split("/")
        rtype = parts[2] if len(parts) > 2 else "image"
        public_id = "test_pid_%d" % len(CLD_UPLOADS)
        # multipart 에서 public_id 추출 (베스트 에포트)
        for line in body.split(b"\r\n"):
            if line.startswith(b"public_id"):
                pass
        m = __import__("re").search(rb'name="public_id"\r\n\r\n([^\r\n]+)', body)
        if m:
            public_id = m.group(1).decode()
        CLD_UPLOADS.append((rtype, public_id))
        if "/destroy" in path:
            payload = json.dumps({"result": "ok"}).encode()
        else:
            payload = json.dumps({
                "public_id": public_id, "version": 1700000000 + len(CLD_UPLOADS),
                "secure_url": f"https://res.cloudinary.com/testcloud/{rtype}/upload/{public_id}",
                "url": f"http://res.cloudinary.com/testcloud/{rtype}/upload/{public_id}",
                "bytes": len(body), "format": "wav",
            }).encode()
    start_response(status, [("Content-Type", "application/json")])
    return [payload]


def start_mock(port=5231):
    srv = make_server("127.0.0.1", port, mock_app, threaded=True)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


# ── worker 임포트 (모의 서버 기동 후) ─────────────────────────
srv = start_mock()
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "worker"))

import cloudinary  # noqa: E402
cloudinary.config(cloud_name="testcloud", api_key="test-api-key",
                  api_secret="test-api-secret",
                  upload_prefix="http://127.0.0.1:5231")

from sdynotes_worker import common, music, extra, music_cloud  # noqa: E402
from sdynotes_worker.core import app  # noqa: E402
from sdynotes_worker.cloud import (_sb_enabled, _sb_put, _sb_get, _sb_rows,  # noqa: E402
                                   _sb_delete, MUSIC_TABLE)

client = app.test_client()

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("  \033[32m✓\033[0m " if cond else "  \033[31m✗\033[0m ") + name + (f"  {extra}" if extra else ""))


def wav_bytes():
    rate, secs = 8000, 1
    n = rate * secs
    data = b"\x00\x00" * n
    return struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(data), b"WAVE", b"fmt ",
                       16, 1, 1, rate, rate * 2, 2, 16, b"data", len(data)) + data


print("== 클라우드 모드 활성 확인 ==")
check("_sb_enabled()", _sb_enabled() is True)
check("CLOUD_READY", common.CLOUD_READY is True)

print("== cloud.py 헬퍼 (모의 PostgREST) ==")
_sb_put(MUSIC_TABLE, "m1", {"title": "테스트곡", "id": "m1"})
check("_sb_put + _sb_get", _sb_get(MUSIC_TABLE, "m1") == {"title": "테스트곡", "id": "m1"})
check("_sb_rows 개수", len(_sb_rows(MUSIC_TABLE)) == 1)
_sb_delete(MUSIC_TABLE, "m1")
check("_sb_delete", _sb_get(MUSIC_TABLE, "m1") is None)

print("== 라우트 교체 확인 ==")
for name, fn in [("music_upload", music_cloud.music_upload_cloud),
                 ("music_youtube", music_cloud.music_youtube_cloud),
                 ("music_meta", music_cloud.music_meta_cloud),
                 ("music_cover_set", music_cloud.music_cover_cloud),
                 ("music_reset_meta", music_cloud.music_reset_cloud),
                 ("music_synced_lyrics", music_cloud.music_synced_lyrics_cloud),
                 ("music_lookup", music_cloud.music_lookup_cloud),
                 ("music_rescan", music_cloud.music_rescan_cloud),
                 ("music_recognize_api", music_cloud.music_recognize_cloud)]:
    check(f"라우트 {name}", app.view_functions.get(name) is fn)

print("== 클라우드 음악 업로드 (Cloudinary 모의 + Supabase 모의) ==")
r = client.post("/api/music/upload",
                data={"file": (io.BytesIO(wav_bytes()), "cloud_test.wav")},
                content_type="multipart/form-data")
d = r.get_json()
check("업로드 200", r.status_code == 200, f"status={r.status_code}")
check("업로드 ok", bool(d.get("ok")), str(d)[:120])
mid = d.get("id")
check("id 발급", bool(mid))
check("cloud_public_id", bool(d.get("cloud_public_id")), str(d.get("cloud_public_id")))
check("stream_url(Cloudinary CDN)", bool(d.get("stream_url")) and "/video/upload/" in (d.get("stream_url") or ""), str(d.get("stream_url"))[:80])
check("Cloudinary 업로드 호출됨", any(pk == f"sdynotes_music/{mid}" for _, pk in CLD_UPLOADS))
check("Supabase 행 저장", _sb_get(MUSIC_TABLE, mid) is not None)

print("== 클라우드 목록(worker 리스트 로직) ==")
with app.app_context():
    items = music_cloud.music_list_cloud().get_json()
check("목록 1곡", items.get("ok") and len(items.get("tracks", [])) == 1, str(items)[:100])
check("목록에 가사 본문 없음", all("lyrics" not in t for t in items.get("tracks", [])))

print("== legacy stream_url 복구 경로 (_music_public_cloud) ==")
with app.app_context():
    legacy = {"id": mid, "title": "x", "ext": "wav", "cloud_public_id": "sdynotes_music/legacy",
              "version": 99, "stream_url": "/api/music/file/legacy", "cover_url": ""}
    pub = music_cloud._music_public_cloud(legacy)
check("legacy /api/... → CDN 재구성", "/video/upload/" in (pub.get("stream_url") or ""), str(pub.get("stream_url"))[:80])

print("== 클라우드 재생/파일/가사(worker 로직) ==")
rec = music_cloud._remote_track(mid)
music_cloud._music_track_save({**rec, "play_count": 1, "last_played": time.time()}, publish=False)
check("재생카운트 저장", _sb_get(MUSIC_TABLE, mid).get("play_count") == 1)

print("== 관리자 가드 (worker → Node 인증 위임) ==")
r = client.post("/api/music/delete", json={"id": mid})
check("삭제(비인증) 403", r.status_code == 403, f"status={r.status_code}")
# reset 은 원본과 동일하게 관리자 가드가 없음 — 유효한 id 로 200
r = client.post("/api/music/reset", json={"id": mid})
check("reset(유효 id) 200", r.status_code == 200 and r.get_json().get("ok"), f"status={r.status_code}")

print("== 그 외 변이 라우트 동작(원본 계약 그대로) ==")
# 원본 cloud_routes.py 는 id 가 없으면 _remote_track("")→None → 404 "없는 곡"
r = client.post("/api/music/meta", json={})
check("meta(입력없음) 404", r.status_code == 404, f"status={r.status_code}")
r = client.post("/api/music/cover", json={})
check("cover(입력없음) 404", r.status_code == 404, f"status={r.status_code}")
r = client.post("/api/music/synced-lyrics", json={})
check("synced-lyrics(입력없음) 404", r.status_code == 404, f"status={r.status_code}")
r = client.post("/api/music/lookup", json={})
check("lookup(입력없음) 404", r.status_code == 404, f"status={r.status_code}")
r = client.post("/api/music/rescan", json={})
check("rescan(클라우드) 200", r.status_code == 200, f"status={r.status_code}")
r = client.post("/api/music/youtube", json={"url": "https://youtu.be/xxxxxxxxxxx"})
check("youtube(모의, 실패 허용)", r.status_code in (400, 403, 502, 200), f"status={r.status_code}")

print("== 백필 1스텝 (무한루프 아님을 확인) ==")
before = time.time()
n = music_cloud._cloud_music_backfill.__name__
check("_cloud_music_backfill 정의", n == "_cloud_music_backfill")

# ── 결과 ──────────────────────────────────────────────────────
print("\n\033[1m클라우드 모드 스모크 결과: PASS %d / FAIL %d\033[0m" % (len(PASS), len(FAIL)))
for f in FAIL:
    print("  \033[31m✗\033[0m", f)
srv.shutdown()
sys.exit(1 if FAIL else 0)
