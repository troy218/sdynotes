#!/usr/bin/env python3
"""클라우드 모의 서버 (Node 클라우드 모드 통합 테스트용).

- http 127.0.0.1:5231  → PostgREST(/rest/v1/...)  (Node fetch 는 http OK)
- https 127.0.0.1:5232 → Cloudinary(/v1_1/...)     (cloudinary SDK 는 https 강제)

시작 시 음악/스티커/카드 행을 미리 심어 둔다.
"""
import json
import os
import re
import ssl
import subprocess
import tempfile
import threading
from urllib.parse import urlparse, parse_qs
from werkzeug.serving import make_server

REST_PORT = int(os.environ.get("REST_PORT", "5231"))
CLD_PORT = int(os.environ.get("CLD_PORT", "5232"))
DB = {}
DB_LOCK = threading.Lock()
UPLOADS = []


def seed():
    now = "2026-01-01T00:00:00Z"
    DB.setdefault("sdy_music_tracks", {})["m1"] = {
        "id": "m1", "updated_at": now, "data": {
            "id": "m1", "title": "Hello", "artist": "Adele", "album": "25", "year": "2015",
            "genre": "pop", "ext": "mp3", "bytes": 1000, "cover": True, "cover_url":
            "https://res.cloudinary.com/testcloud/image/upload/sdynotes_music/m1_cover",
            "cover_public_id": "sdynotes_music/m1_cover",
            "stream_url": "https://res.cloudinary.com/testcloud/video/upload/sdynotes_music/m1",
            "cloud_public_id": "sdynotes_music/m1", "version": 1700000000,
            "play_count": 0, "last_played": 0, "lyrics": "", "lyrics_plain": "",
            "lyrics_src": "", "lyrics_tries": 0, "created_at": now,
        },
    }
    DB.setdefault("sdy_stickers", {})["s1"] = {
        "id": "s1", "updated_at": now, "data": {
            "id": "s1", "name": "스티커", "bytes": 10,
            "url": "https://res.cloudinary.com/testcloud/image/upload/sdy_stickers/s1",
            "public_id": "sdy_stickers/s1", "storage": "cloudinary", "created_at": now,
        },
    }
    DB.setdefault("sdy_card_decks", {})["d1"] = {
        "id": "d1", "updated_at": now, "data": {
            "id": "d1", "title": "Deck", "updated_at": now,
            "cards": [{"id": "c1", "due": 0, "box": 5, "seen": 1},
                      {"id": "c2", "due": 9999999999, "box": 0, "seen": 0}],
        },
    }


def app_fn(environ, start_response):
    method = environ["REQUEST_METHOD"]
    parsed = urlparse(environ["PATH_INFO"])
    path = parsed.path
    qs = parse_qs(environ.get("QUERY_STRING", ""))
    body = environ["wsgi.input"].read(int(environ.get("CONTENT_LENGTH") or 0))
    status, payload = "200 OK", b"{}"

    if path.startswith("/rest/v1/"):
        table = path[len("/rest/v1/"):].strip("/")
        if method == "GET":
            id_eq = (qs.get("id") or [None])[0]
            if id_eq:
                ident = id_eq.split("eq.", 1)[1] if "eq." in id_eq else id_eq
                with DB_LOCK:
                    row = DB.get(table, {}).get(ident)
                payload = json.dumps([row] if row else []).encode()
            else:
                with DB_LOCK:
                    rows = list(DB.get(table, {}).values())
                rows.sort(key=lambda r: r.get("updated_at") or "")
                off = int((qs.get("offset") or ["0"])[0])
                lim = int((qs.get("limit") or ["1000"])[0])
                payload = json.dumps(rows[off:off + lim]).encode()
        elif method == "POST":
            row = json.loads(body)
            with DB_LOCK:
                DB.setdefault(table, {})[row["id"]] = row
            payload = json.dumps([row]).encode()
        elif method == "DELETE":
            id_eq = (qs.get("id") or [""])[0]
            ident = id_eq.split("eq.", 1)[1] if "eq." in id_eq else id_eq
            with DB_LOCK:
                DB.get(table, {}).pop(ident, None)
            status, payload = "204 No Content", b""
    elif "/upload" in path or "/destroy" in path:
        parts = path.strip("/").split("/")
        rtype = parts[2] if len(parts) > 2 else "image"
        m = re.search(rb'name="public_id"\r\n\r\n([^\r\n]+)', body)
        public_id = m.group(1).decode() if m else ("test_pid_%d" % len(UPLOADS))
        UPLOADS.append((rtype, public_id))
        if "/destroy" in path:
            payload = json.dumps({"result": "ok"}).encode()
        else:
            payload = json.dumps({
                "public_id": public_id, "version": 1700000000 + len(UPLOADS),
                "secure_url": f"https://res.cloudinary.com/testcloud/{rtype}/upload/{public_id}",
                "url": f"https://res.cloudinary.com/testcloud/{rtype}/upload/{public_id}",
                "bytes": len(body),
            }).encode()
    start_response(status, [("Content-Type", "application/json")])
    return [payload]


def make_tls_ctx():
    tmp = tempfile.mkdtemp()
    cert = os.path.join(tmp, "cert.pem")
    key = os.path.join(tmp, "key.pem")
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert,
         "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1"],
        check=True, capture_output=True,
    )
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    return ctx


def main():
    seed()
    rest = make_server("127.0.0.1", REST_PORT, app_fn, threaded=True)
    tls = make_server("127.0.0.1", CLD_PORT, app_fn, threaded=True, ssl_context=make_tls_ctx())
    threading.Thread(target=tls.serve_forever, daemon=True).start()
    print(f"mock REST   on http://127.0.0.1:{REST_PORT}", flush=True)
    print(f"mock CLD    on https://127.0.0.1:{CLD_PORT}", flush=True)
    rest.serve_forever()


if __name__ == "__main__":
    main()
