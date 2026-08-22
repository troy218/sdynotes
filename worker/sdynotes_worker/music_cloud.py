"""Worker 클라우드 음악(변이) 라우트 — cloud_routes.py 의 음악 부분 원본 보존.

로컬 모드는 music.py 구현을 그대로 쓰고(폴백), Supabase/Cloudinary 가 켜지면
이 모듈이 upload/youtube/meta/cover/reset/synced-lyrics/lookup/rescan/recognize
라우트를 교체한다. 목록/재생/삭제/가사/표지(읽기)는 Node 가 담당한다.
"""
import io
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid

import cloudinary
import cloudinary.uploader
import cloudinary.utils
import requests
from flask import jsonify, redirect, request
from PIL import Image

from .admin import _require_admin
from .cloud import (MUSIC_TABLE, SYNC_TABLE, _publish_live, _sb_delete,
                    _sb_enabled, _sb_error_text, _sb_get, _sb_put, _sb_rows)
from .common import (CLOUD_READY, MUSIC_DIR, _cleanup_old_temp_files,
                     _music_lock, is_server_idle)
from .core import app
from .music import (MUSIC_EXTS, MUSIC_MAX_MB, TAG_ALGO, _TAG_UA, _aco_key,
                    _acoustid_lookup, _fetch_cover, _fetch_lyrics, _fp_bin,
                    _music_autotag, _music_cover_search, _music_load,
                    _music_lyrics, _music_public, _music_rebuild,
                    _music_save, _parse_filename, _tag_collect, _tag_rank,
                    _yt_fetch_audio, _yt_tools, _yt_url_id)

# 로컬 구현 캡처 (music.py 가 먼저 import 되어 라우트가 등록된 상태여야 한다)
_LOCAL_MUSIC_UPLOAD = app.view_functions.get("music_upload")
_LOCAL_MUSIC_LIST = app.view_functions.get("music_list")
_LOCAL_MUSIC_FILE = app.view_functions.get("music_file")
_LOCAL_MUSIC_DELETE = app.view_functions.get("music_delete")
_LOCAL_MUSIC_META = app.view_functions.get("music_meta")
_LOCAL_MUSIC_YOUTUBE = app.view_functions.get("music_youtube")
_LOCAL_MUSIC_COVER = app.view_functions.get("music_cover_set")
_LOCAL_MUSIC_COVER_GET = app.view_functions.get("music_cover")
_LOCAL_MUSIC_LOOKUP = app.view_functions.get("music_lookup")
_LOCAL_MUSIC_LYRICS = app.view_functions.get("music_lyrics_one")
_LOCAL_MUSIC_RESET = app.view_functions.get("music_reset_meta")
_LOCAL_MUSIC_SYNC_LRC = app.view_functions.get("music_synced_lyrics")
_LOCAL_MUSIC_RECOGNIZE = app.view_functions.get("music_recognize_api")
_LOCAL_MUSIC_RESCAN = app.view_functions.get("music_rescan")


# ------------------------------ 음악 ------------------------------
MUSIC_CLOUD_FOLDER = "sdynotes_music"
MUSIC_MAX_CLOUD_MB = MUSIC_MAX_MB


def _music_id(value):
    return re.sub(r"[^0-9A-Za-z_\-]", "", str(value or ""))[:80]


def _music_ext(filename, default="m4a"):
    ext = str(filename or "").rsplit(".", 1)[-1].lower() if "." in str(filename or "") else default
    return ext if ext in MUSIC_EXTS else default


def _cloud_music_upload(raw, mid, ext):
    if not CLOUD_READY:
        raise RuntimeError("Cloudinary API 키가 없습니다")
    return cloudinary.uploader.upload(
        io.BytesIO(raw), resource_type="video",
        public_id=f"{MUSIC_CLOUD_FOLDER}/{mid}",
        format=ext, overwrite=True, use_filename=False, unique_filename=False,
    )


def _cloud_cover_upload(raw, mid):
    if not CLOUD_READY:
        raise RuntimeError("Cloudinary API 키가 없습니다")
    return cloudinary.uploader.upload(
        io.BytesIO(raw), resource_type="image",
        public_id=f"{MUSIC_CLOUD_FOLDER}/{mid}_cover",
        format="jpg", overwrite=True, use_filename=False, unique_filename=False,
    )


def _cloud_cover_delete(rec):
    pid = rec.get("cover_public_id") or f"{MUSIC_CLOUD_FOLDER}/{rec.get('id')}_cover"
    if CLOUD_READY:
        try:
            cloudinary.uploader.destroy(pid, resource_type="image", invalidate=True)
        except Exception:
            pass


def _remote_track(mid):
    if not _sb_enabled():
        return None
    try:
        d = _sb_get(MUSIC_TABLE, _music_id(mid))
        return d if isinstance(d, dict) else None
    except Exception:
        return None


_REMOTE_MUSIC_CACHE = {"at": 0.0, "items": []}
_REMOTE_MUSIC_CACHE_LOCK = threading.Lock()


def _remote_tracks():
    if not _sb_enabled():
        return []
    now = time.time()
    with _REMOTE_MUSIC_CACHE_LOCK:
        if now - _REMOTE_MUSIC_CACHE["at"] < 5:
            return [dict(x) for x in _REMOTE_MUSIC_CACHE["items"]]
    rows = _sb_rows(MUSIC_TABLE)
    items = [r.get("data") for r in rows if isinstance(r.get("data"), dict)]
    with _REMOTE_MUSIC_CACHE_LOCK:
        _REMOTE_MUSIC_CACHE.update({"at": now, "items": [dict(x) for x in items]})
    return items


def _music_public_cloud(rec):
    # 기존 _music_public이 가사 본문을 제외하고 cover_url을 그대로 보존한다.
    # 재생은 /api/music/file의 302를 한 번 더 거치지 않고 Cloudinary CDN으로
    # 바로 가야 한다. 예전 레코드처럼 stream_url이 비어 있어도 여기서 복구한다.
    out = _music_public(rec)
    if out.get("cover_url"):
        out["cover"] = True
    stream = str(out.get("stream_url") or "")
    if (not stream or stream.startswith("/api/")) and rec.get("cloud_public_id") and CLOUD_READY:
        try:
            stream, _ = cloudinary.utils.cloudinary_url(
                rec["cloud_public_id"], resource_type="video", secure=True,
                format=_music_ext(rec.get("ext")), version=rec.get("version"),
            )
            out["stream_url"] = stream
        except Exception:
            pass
    return out


def _music_track_save(rec, publish=True):
    mid = _music_id(rec.get("id"))
    if not mid:
        raise ValueError("음악 id 없음")
    rec = dict(rec)
    rec["id"] = mid
    rec["updated_at"] = time.time()
    if not _sb_enabled():
        with _music_lock:
            m = _music_load(); m[mid] = rec; _music_save(m)
        return rec
    _sb_put(MUSIC_TABLE, mid, rec)
    with _REMOTE_MUSIC_CACHE_LOCK:
        items = _REMOTE_MUSIC_CACHE["items"]
        hit = next((i for i, x in enumerate(items) if x.get("id") == mid), None)
        if hit is None:
            items.append(dict(rec))
        else:
            items[hit] = dict(rec)
        _REMOTE_MUSIC_CACHE["at"] = time.time()
    if publish:
        _publish_live("music", mid)
    return rec


def _music_cloud_or_local_list():
    if not _sb_enabled():
        # 키를 아직 넣지 않은 구버전 서버는 로컬 곡을 계속 보여 준다.
        with _music_lock:
            m = _music_load()
        return [_music_public(r) for r in sorted(m.values(), key=lambda x: str(x.get("created_at", "")))]
    return [_music_public_cloud(r) for r in
            sorted(_remote_tracks(), key=lambda x: str(x.get("created_at", "")))]


def _remote_music_record(raw, filename, title=None, artist="", album="", year="",
                         genre="", cover_raw=None, source="upload"):
    ext = _music_ext(filename)
    mid = uuid.uuid4().hex[:12]
    title0 = (title or os.path.splitext(os.path.basename(filename or ""))[0] or mid).strip()
    parsed_title, parsed_artist = _parse_filename(title0)
    rec = {
        "id": mid, "title": (parsed_title or title0)[:120],
        "artist": (artist or parsed_artist or "")[:80],
        "album": str(album or "")[:120], "year": str(year or "")[:4],
        "genre": str(genre or "")[:40], "ext": ext, "bytes": len(raw),
        "cover": False, "orig_title": title0[:120], "tag_state": "pending",
        "tag_src": source[:60], "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    up = _cloud_music_upload(raw, mid, ext)
    rec.update({"cloud_public_id": up.get("public_id"),
                "stream_url": up.get("secure_url") or "",
                "version": up.get("version")})
    try:
        if cover_raw:
            cu = _cloud_cover_upload(cover_raw, mid)
            rec.update({"cover": True, "cover_public_id": cu.get("public_id"),
                        "cover_url": cu.get("secure_url") or "",
                        "cover_v": int(time.time())})
        _music_track_save(rec)
    except Exception:
        # 메타데이터 저장에 실패하면 방금 올린 자산을 정리해 고아 파일을
        # 남기지 않는다. 원본 예외는 호출자에게 보여 준다.
        try:
            cloudinary.uploader.destroy(up.get("public_id"), resource_type="video", invalidate=True)
        except Exception:
            pass
        raise
    return rec


def music_upload_cloud():
    if not _sb_enabled():
        return _LOCAL_MUSIC_UPLOAD() if _LOCAL_MUSIC_UPLOAD else (jsonify({"ok": False}), 503)
    if not CLOUD_READY:
        return jsonify({"ok": False, "error": "Cloudinary API 키가 설정되지 않았습니다"}), 503
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "파일이 없습니다"}), 400
    ext = _music_ext(f.filename, "")
    if not ext or ext not in MUSIC_EXTS:
        return jsonify({"ok": False, "error": "지원 형식: mp3·flac·m4a·aac·ogg·opus·wav·webm"}), 400
    raw = f.read()
    if len(raw) > MUSIC_MAX_CLOUD_MB * 1024 * 1024:
        return jsonify({"ok": False, "error": "50MB 이하만 올릴 수 있어요"}), 400
    try:
        rec = _remote_music_record(raw, f.filename)
        # 14.9 · 업로드 직후: 소리 인식(AcoustID)으로 정보를 먼저 채우고,
        #  자동검색으로 표지·가사·나머지를 마저 채운다. 방금 올린 원본을
        #  그대로 쓰면 Cloudinary 에서 다시 내려받지 않아도 된다.
        tmp = None
        try:
            fd, tmp = tempfile.mkstemp(suffix="." + ext)
            with os.fdopen(fd, "wb") as fp:
                fp.write(raw)
        except Exception:
            if tmp:
                try: os.remove(tmp)
                except Exception: pass
            tmp = None
        threading.Thread(target=_cloud_music_pipeline, args=(rec["id"], tmp), daemon=True).start()
        return jsonify({"ok": True, **_music_public_cloud(rec)})
    except Exception as e:
        print("[music] cloud upload failed:", _sb_error_text(e))
        return jsonify({"ok": False, "error": "음악 클라우드 저장 실패: " + _sb_error_text(e)}), 502


def music_list_cloud():
    try:
        items = _music_cloud_or_local_list()
        return jsonify({"ok": True, "tracks": items, "tagging": False, "count": len(items)})
    except Exception as e:
        if not _sb_enabled():
            return _LOCAL_MUSIC_LIST() if _LOCAL_MUSIC_LIST else jsonify({"ok": True, "tracks": []})
        return jsonify({"ok": False, "error": "음악 목록 연결 실패: " + _sb_error_text(e)}), 502


def music_file_cloud(mid):
    mid = _music_id(mid)
    if not _sb_enabled():
        return _LOCAL_MUSIC_FILE() if _LOCAL_MUSIC_FILE else (jsonify({"error": "없는 곡입니다"}), 404)
    try:
        rec = _remote_track(mid)
        if not rec:
            return jsonify({"error": "없는 곡입니다"}), 404
        url = rec.get("stream_url") or ""
        if not url and rec.get("cloud_public_id"):
            url, _ = cloudinary.utils.cloudinary_url(
                rec["cloud_public_id"], resource_type="video", secure=True,
                format=_music_ext(rec.get("ext")), version=rec.get("version"),
            )
        if not url:
            return jsonify({"error": "음원 주소가 없습니다"}), 404
        return redirect(url, code=302)
    except Exception as e:
        return jsonify({"error": "음원 연결 실패: " + _sb_error_text(e)}), 502


def music_delete_cloud():
    if not _sb_enabled():
        return _LOCAL_MUSIC_DELETE() if _LOCAL_MUSIC_DELETE else (jsonify({"ok": False}), 503)
    if not _require_admin():
        return jsonify({"ok": False, "error": "관리자 인증이 필요합니다"}), 403
    d = request.get_json(silent=True) or {}
    mid = _music_id(d.get("id"))
    rec = _remote_track(mid)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    try:
        if CLOUD_READY and rec.get("cloud_public_id"):
            cloudinary.uploader.destroy(rec["cloud_public_id"], resource_type="video", invalidate=True)
        _cloud_cover_delete(rec)
        _sb_delete(MUSIC_TABLE, mid)
        _publish_live("music", mid)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": "음악 삭제 실패: " + _sb_error_text(e)}), 502


def _remote_music_update(mid, updates=None, remove_cover=False):
    rec = _remote_track(mid)
    if not rec:
        return None
    if updates:
        rec.update(updates)
    if remove_cover:
        _cloud_cover_delete(rec)
        for k in ("cover", "cover_url", "cover_public_id", "cover_v"):
            rec.pop(k, None)
    return _music_track_save(rec)


def _music_lyrics_cloud(mid):
    rec = _remote_track(mid)
    if not rec or not (rec.get("title") or "").strip():
        return rec
    sync, plain, src = _fetch_lyrics(rec.get("title"), rec.get("artist"), rec.get("duration"))
    if sync or plain:
        rec["lyrics"] = sync or rec.get("lyrics") or ""
        rec["lyrics_plain"] = plain or re.sub(r"\[[^\]]*\]", "", sync).strip()
        rec["lyrics_src"] = src
        rec["lyrics_tries"] = 9 if sync else int(rec.get("lyrics_tries") or 0) + 1
    else:
        rec["lyrics_tries"] = int(rec.get("lyrics_tries") or 0) + 1
    rec["lyrics_next"] = time.time() + min(86400, 1800 * (2 ** min(6, int(rec.get("lyrics_tries") or 1))))
    return _music_track_save(rec)


def _cloud_music_autotag(mid, force=True, qhint=None, alt=0, replace_cover=False, lyrics_only=False):
    """로컬 음원 없이 파일명/메타데이터로 '정보(제목·가수·앨범·연도·장르)'만 채운다.

    14.11 — 한 번의 사용자 동작 = 한 기능. 표지는 cover_only 경로
    (_cloud_cover_pick)가, 가사는 lyrics_only/synced-lyrics 가 전담하므로
    여기서 연쇄하지 않는다. (replace_cover/lyrics_only 인자는 하위 호환 유지)
    """
    try:
        rec = _remote_track(mid)
        if not rec:
            return None
        if lyrics_only:
            return _music_lyrics_cloud(mid)
        emb = {"title": rec.get("title") or "", "artist": rec.get("artist") or "",
               "album": rec.get("album") or "", "year": rec.get("year") or "",
               "genre": rec.get("genre") or "", "dur": rec.get("duration")}
        scored, q_title, q_artist, dur = _tag_collect(rec, emb, qhint, deep=bool(alt))
        ranked = _tag_rank(scored)
        best = ranked[max(0, int(alt or 0)) % len(ranked)] if ranked else None
        emb_full = bool(emb.get("title") and emb.get("artist"))
        if qhint and (qhint[0] or qhint[1]):
            threshold = 0.66 if emb_full else 0.70
        else:
            threshold = 0.72 if emb_full else 0.76
        if alt:
            threshold = 0.30
        if best and best[0] >= threshold:
            score, cand = best
            rec.update({"title": str(cand.get("title") or rec.get("title"))[:120],
                        "artist": str(cand.get("artist") or rec.get("artist"))[:80],
                        "album": str(cand.get("album") or rec.get("album") or "")[:120],
                        "year": str(cand.get("year") or rec.get("year") or "")[:4],
                        "genre": str(cand.get("genre") or rec.get("genre") or "")[:40],
                        "tag_state": "done", "tag_src": cand.get("src") or "",
                        "tag_score": round(float(score), 4), "tag_algo": TAG_ALGO,
                        "tag_tries": 0, "tag_next": 0})
        else:
            rec["tag_state"] = rec.get("tag_state") or "none"
            rec["tag_algo"] = TAG_ALGO
            rec["tag_tries"] = int(rec.get("tag_tries") or 0) + 1
            rec["tag_next"] = time.time() + min(86400, 1800 * (2 ** min(6, rec["tag_tries"] - 1)))
        return _music_track_save(rec)
    except Exception as e:
        print("[music] cloud autotag failed:", _sb_error_text(e))
        return None


def music_lyrics_cloud(mid):
    if not _sb_enabled():
        return _LOCAL_MUSIC_LYRICS() if _LOCAL_MUSIC_LYRICS else (jsonify({"ok": False}), 404)
    rec = _remote_track(_music_id(mid))
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡"}), 404
    return jsonify({"ok": True, "id": rec["id"], "lyrics": rec.get("lyrics") or "",
                    "lyrics_plain": rec.get("lyrics_plain") or "",
                    "lyrics_src": rec.get("lyrics_src") or "",
                    "lyrics_tries": rec.get("lyrics_tries") or 0})


def music_meta_cloud():
    if not _sb_enabled():
        return _LOCAL_MUSIC_META() if _LOCAL_MUSIC_META else (jsonify({"ok": False}), 503)
    d = request.get_json(silent=True) or {}
    mid = _music_id(d.get("id")); rec = _remote_track(mid)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    for k, n in (("title", 120), ("artist", 80), ("album", 120),
                 ("year", 4), ("genre", 40)):
        if k in d:
            rec[k] = str(d.get(k) or "").strip()[:n]
    if "lyrics" in d:
        lyr = str(d.get("lyrics") or "").strip()[:20000]
        if re.search(r"\[\d{1,2}:\d{1,2}", lyr):
            rec["lyrics"] = lyr
            rec["lyrics_plain"] = re.sub(r"\[[^\]]*\]", "", lyr).strip()
        else:
            rec["lyrics_plain"] = lyr
            rec["lyrics"] = rec.get("lyrics") or ""
        rec["lyrics_src"] = "직접 편집"; rec["lyrics_tries"] = 9
    rec["tag_state"] = "manual"; rec["tag_src"] = "직접 편집"
    rec = _music_track_save(rec)
    return jsonify({"ok": True, "track": _music_public_cloud(rec)})


def music_cover_cloud():
    if not _sb_enabled():
        return _LOCAL_MUSIC_COVER() if _LOCAL_MUSIC_COVER else (jsonify({"ok": False}), 503)
    body = request.get_json(silent=True) or {}
    mid = _music_id(request.form.get("id") or body.get("id"))
    rec = _remote_track(mid)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    if body.get("remove"):
        rec = _remote_music_update(mid, remove_cover=True)
        return jsonify({"ok": True, "track": _music_public_cloud(rec)})
    raw = None
    f = request.files.get("file")
    if f:
        raw = f.read()
        if len(raw) > 12 * 1024 * 1024:
            return jsonify({"ok": False, "error": "표지는 12MB 이하만 가능해요"}), 400
    elif body.get("url"):
        raw = _fetch_cover(body.get("url"))
    if not raw:
        return jsonify({"ok": False, "error": "이미지를 받아오지 못했어요"}), 400
    try:
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im.thumbnail((1200, 1200))
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=88, optimize=True)
        cu = _cloud_cover_upload(buf.getvalue(), mid)
        rec.update({"cover": True, "cover_public_id": cu.get("public_id"),
                    "cover_url": cu.get("secure_url") or "", "cover_v": int(time.time())})
        rec = _music_track_save(rec)
        return jsonify({"ok": True, "track": _music_public_cloud(rec)})
    except Exception as e:
        return jsonify({"ok": False, "error": "표지 저장 실패: " + _sb_error_text(e)}), 502


def music_cover_get_cloud(mid):
    if not _sb_enabled():
        return _LOCAL_MUSIC_COVER_GET() if _LOCAL_MUSIC_COVER_GET else (jsonify({"error": "없음"}), 404)
    rec = _remote_track(_music_id(mid))
    if not rec:
        return jsonify({"error": "없는 곡"}), 404
    url = rec.get("cover_url")
    if not url and rec.get("cover_public_id"):
        url, _ = cloudinary.utils.cloudinary_url(rec["cover_public_id"],
                                                   resource_type="image", secure=True)
    if not url:
        return jsonify({"error": "없음"}), 404
    return redirect(url, code=302)


def music_reset_cloud():
    if not _sb_enabled():
        return _LOCAL_MUSIC_RESET() if _LOCAL_MUSIC_RESET else (jsonify({"ok": False}), 503)
    d = request.get_json(silent=True) or {}; mid = _music_id(d.get("id")); rec = _remote_track(mid)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    title, artist = _parse_filename(rec.get("orig_title") or rec.get("title") or mid)
    rec.update({"title": title[:120], "artist": artist[:80], "album": "", "year": "", "genre": "",
                "tag_state": "pending", "tag_src": "", "tag_tries": 0, "tag_next": 0,
                "lyrics": "", "lyrics_plain": "", "lyrics_src": "", "lyrics_tries": 0,
                "recog_tried": 0})
    rec = _remote_music_update(mid, rec, remove_cover=True)
    # 14.11 — '초기화'는 초기화만 한다. 방금 지운 정보를 다시 자동 태깅으로
    # 채우면 초기화 의미가 없어지므로 연쇄하지 않는다.
    return jsonify({"ok": True, "track": _music_public_cloud(rec)})


def music_synced_lyrics_cloud():
    if not _sb_enabled():
        return _LOCAL_MUSIC_SYNC_LRC() if _LOCAL_MUSIC_SYNC_LRC else (jsonify({"ok": False}), 503)
    d = request.get_json(silent=True) or {}; mid = _music_id(d.get("id")); rec = _remote_track(mid)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    sync, plain, src = _fetch_lyrics(rec.get("title"), rec.get("artist"), rec.get("duration"))
    if not sync:
        return jsonify({"ok": False, "error": "싱크 가사를 찾지 못했어요"})
    rec.update({"lyrics": sync, "lyrics_plain": plain, "lyrics_src": src, "lyrics_tries": 9})
    _music_track_save(rec)
    return jsonify({"ok": True, "lyrics": sync, "src": src})


def _cloud_cover_pick(mid, alt=0):
    """'표지만' 찾아 바꾼다. 정보·가사는 건드리지 않는다 (14.11 한 동작 = 한 기능).

    표지 후보는 같은 검색 결과를 점수순으로 돌려 alt 번째를 쓰고,
    최대 6개까지만 시도한다 (전부 실패해도 오래 걸리지 않게).
    """
    rec = _remote_track(mid)
    if not rec:
        return {"ok": False, "error": "없는 곡입니다", "count": 0}
    emb = {"title": rec.get("title") or "", "artist": rec.get("artist") or "",
           "album": rec.get("album") or "", "year": rec.get("year") or "",
           "genre": rec.get("genre") or "", "dur": rec.get("duration")}
    scored, _, _, _ = _tag_collect(rec, emb, (rec.get("title"), rec.get("artist")), deep=True)
    arts = []; seen = set()
    for score, cand in scored:
        art = (cand.get("art") or "").strip()
        key = art.split("?")[0]
        if art and key not in seen and score >= 0.30:
            seen.add(key); arts.append(art)
    if not arts:
        return {"ok": False, "error": "표지를 찾지 못했어요", "count": 0}
    for n in range(min(6, len(arts))):
        raw = _fetch_cover(arts[(int(alt or 0) + n) % len(arts)])
        if not raw:
            continue
        try:
            cu = _cloud_cover_upload(raw, mid)
            rec.update({"cover": True, "cover_public_id": cu.get("public_id"),
                        "cover_url": cu.get("secure_url") or "", "cover_v": int(time.time())})
            rec = _music_track_save(rec)
            return {"ok": True, "track": rec, "cover": True, "count": len(arts)}
        except Exception:
            pass
    return {"ok": False, "error": "표지를 받지 못했어요", "count": len(arts)}


def music_lookup_cloud():
    if not _sb_enabled():
        return _LOCAL_MUSIC_LOOKUP() if _LOCAL_MUSIC_LOOKUP else (jsonify({"ok": False}), 503)
    d = request.get_json(silent=True) or {}; mid = _music_id(d.get("id")); rec = _remote_track(mid)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    if d.get("lyrics_only"):
        out = _cloud_music_autotag(mid, lyrics_only=True) or rec
        return jsonify({"ok": True, "track": _music_public_cloud(out),
                        "changed": bool(out.get("lyrics") or out.get("lyrics_plain"))})
    qhint = None
    if d.get("q_title") or d.get("q_artist"):
        qhint = (d.get("q_title") or "", d.get("q_artist") or "")
    try:
        alt = max(0, min(30, int(d.get("alt") or 0)))
    except Exception:
        alt = 0
    if d.get("cover_only"):
        res = _cloud_cover_pick(mid, alt)
        if res.get("ok"):
            return jsonify({"ok": True, "track": _music_public_cloud(res["track"]),
                            "cover": True, "count": res.get("count") or 0})
        return jsonify({"ok": False, "error": res.get("error") or "표지를 찾지 못했어요",
                        "count": res.get("count") or 0}), 400
    out = _cloud_music_autotag(mid, qhint=qhint, alt=alt,
                               replace_cover=bool(d.get("replace_cover"))) or rec
    return jsonify({"ok": True, "track": _music_public_cloud(out),
                    "changed": out.get("tag_state") == "done", "alt": alt})


def _yt_cloud_add(url):
    """유튜브 음원을 임시 디스크에 받은 뒤 즉시 Cloudinary로 옮긴다."""
    if not _sb_enabled():
        # 설정 전에는 기존 로컬 구현을 사용한다.
        return None
    if not CLOUD_READY:
        return {"ok": False, "error": "Cloudinary API 키가 설정되지 않았습니다"}
    tools = _yt_tools()
    if not tools.get("ok"):
        return {"ok": False, "error": "서버에 yt-dlp가 없습니다. apply.sh를 다시 실행해 주세요"}
    tmpdir = tempfile.mkdtemp(prefix="sdyyt_cloud_")
    info_path = os.path.join(tmpdir, "info.json")
    try:
        audio, ext, err = _yt_fetch_audio(url, tmpdir, info_path=info_path)
        if not audio:
            return {"ok": False, "error": err or "음원을 받지 못했습니다"}
        info = {}
        try:
            with open(info_path, encoding="utf-8") as fp:
                info = json.load(fp)
        except Exception:
            pass
        vtitle = str(info.get("title") or "유튜브 곡").strip()
        artist = str(info.get("artist") or info.get("uploader") or info.get("channel") or "").strip()
        thumb = str(info.get("thumbnail") or "")
        cover_raw = _fetch_cover(thumb) if thumb.startswith("http") else None
        with open(audio, "rb") as fp:
            raw = fp.read()
        rec = _remote_music_record(raw, "download." + _music_ext(ext),
                                   title=vtitle, artist=artist,
                                   album=str(info.get("album") or ""),
                                   year=str(info.get("release_date") or "")[:4],
                                   genre=str(info.get("genre") or ""),
                                   cover_raw=cover_raw, source="YouTube")
        if info.get("duration"):
            rec["duration"] = info["duration"]
            _music_track_save(rec)
        # 14.11 — 유튜브 추가는 영상 메타(제목·가수·표지)를 이미 그대로 쓰므로
        # 그 뒤에 자동 태그 검색을 연쇄하지 않는다.
        return {"ok": True, "track": rec}
    except Exception as e:
        return {"ok": False, "error": "클라우드 저장 실패: " + _sb_error_text(e)}
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def music_youtube_cloud():
    d = request.get_json(silent=True) or {}; url = str(d.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "링크를 넣어 주세요"}), 400
    if not _sb_enabled():
        return _LOCAL_MUSIC_YOUTUBE() if _LOCAL_MUSIC_YOUTUBE else (jsonify({"ok": False}), 503)
    if not re.match(r"https?://", url, re.I) or not _yt_url_id(url):
        return jsonify({"ok": False, "error": "유튜브 링크가 아닌 것 같습니다"}), 400
    res = _yt_cloud_add(url)
    if not res or not res.get("ok"):
        return jsonify({"ok": False, "error": (res or {}).get("error") or "추출 실패"}), 400
    return jsonify({"ok": True, "from": "youtube", **_music_public_cloud(res["track"])})


def music_rescan_cloud():
    if not _sb_enabled():
        return _LOCAL_MUSIC_RESCAN() if _LOCAL_MUSIC_RESCAN else jsonify({"ok": True, "added": 0, "tracks": []})
    # 배포 직후 기존 /var/www/memo/music에 남아 있는 파일을 한 번에 올리는
    # 작업은 백그라운드에서 진행한다. 목록 API는 클라우드의 현재 상태를 즉시 준다.
    threading.Thread(target=_migrate_local_music, daemon=True).start()
    items = _music_cloud_or_local_list()
    return jsonify({"ok": True, "added": 0, "count": len(items), "tracks": items,
                    "tagging": False, "playlist_ok": 0, "playlist_missing": 0})


def _migrate_local_music():
    """기존 로컬 음원을 한 번만 Cloudinary/Supabase로 옮긴다."""
    if not (_sb_enabled() and CLOUD_READY):
        return
    try:
        # 목록 파일이 비어 있어도 실제 음원 파일을 먼저 복구한다.
        try:
            _music_rebuild()
        except Exception:
            pass
        with _music_lock:
            local = _music_load()
        for mid, old in list(local.items()):
            mid = _music_id(mid)
            remote = _remote_track(mid)
            cp = os.path.join(MUSIC_DIR, mid + ".cover")
            # 이전 시도에서 음원만 올라가고 표지가 빠졌을 수 있다.
            # 그런 레코드는 원본을 다시 올리지 않고 표지만 보충한다.
            if remote:
                # 부분 이관으로 Cloudinary/Supabase 레코드만 먼저 생긴 경우,
                # 기존 로컬 메타데이터(특히 가사)가 누락될 수 있다. 예전에는
                # remote가 있으면 무조건 건너뛰어 '가사를 찾는 중'만 반복됐다.
                # 클라우드 전용 필드는 보존하고, 비어 있는 메타데이터만 로컬에서
                # 보충한다.
                merged = False
                for key in ("title", "artist", "album", "year", "genre", "lyrics",
                            "lyrics_plain", "lyrics_src", "lyrics_tries", "has_lyrics",
                            "has_sync", "tag_state", "tag_src", "tag_algo", "orig_title"):
                    old_value = old.get(key)
                    if old_value not in (None, "", [], {}) and remote.get(key) in (None, "", [], {}):
                        remote[key] = old_value
                        merged = True
                if merged:
                    try:
                        _music_track_save(remote)
                        print("[music] 기존 메타데이터 보충:", mid)
                    except Exception as e:
                        print("[music] 기존 메타데이터 보충 실패:", _sb_error_text(e))
                if (not remote.get("cover_url")) and os.path.exists(cp):
                    try:
                        with open(cp, "rb") as fp: cover = fp.read()
                        cu = _cloud_cover_upload(cover, mid)
                        remote.update({"cover": True, "cover_public_id": cu.get("public_id"),
                                       "cover_url": cu.get("secure_url") or "",
                                       "cover_v": int(time.time())})
                        _music_track_save(remote)
                    except Exception as e:
                        print("[music] 기존 표지 이관 실패:", _sb_error_text(e))
                continue
            hits = [fn for fn in os.listdir(MUSIC_DIR)
                    if fn.startswith(mid + ".") and fn.rsplit(".", 1)[-1].lower() in MUSIC_EXTS]
            if not hits:
                continue
            path = os.path.join(MUSIC_DIR, hits[0])
            with open(path, "rb") as fp:
                raw = fp.read()
            cover = None
            if os.path.exists(cp):
                with open(cp, "rb") as fp: cover = fp.read()
            rec = dict(old); rec["id"] = mid; rec["ext"] = _music_ext(hits[0])
            rec["bytes"] = len(raw); rec.setdefault("orig_title", rec.get("title") or mid)
            up = _cloud_music_upload(raw, mid, rec["ext"])
            rec.update({"cloud_public_id": up.get("public_id"), "stream_url": up.get("secure_url") or "",
                        "version": up.get("version")})
            if cover:
                try:
                    cu = _cloud_cover_upload(cover, mid)
                    rec.update({"cover": True, "cover_public_id": cu.get("public_id"),
                                "cover_url": cu.get("secure_url") or "", "cover_v": int(time.time())})
                except Exception: pass
            _music_track_save(rec)
            print("[music] 기존 곡 클라우드 이관:", rec.get("title") or mid)
    except Exception as e:
        print("[music] 기존 곡 이관 실패:", _sb_error_text(e))


def _recog_url(rec):
    """재생 주소 복구 — 구버전/이관 레코드는 stream_url 이 비어 있어도
    cloud_public_id 만으로 Cloudinary 주소를 되살린다."""
    url = rec.get("stream_url")
    if (not url or str(url).startswith("/api/")) and rec.get("cloud_public_id") and CLOUD_READY:
        try:
            url, _ = cloudinary.utils.cloudinary_url(
                rec["cloud_public_id"], resource_type="video", secure=True,
                format=_music_ext(rec.get("ext")), version=rec.get("version"),
            )
        except Exception:
            url = url or ""
    return url


def _recog_download(url, ext):
    """재생 주소를 임시 파일로 스트리밍 다운로드한다. 성공 시 path, 실패 시 None.

    14.9 · 음원 전체를 메모리에 올리지 않는다 (큰 파일에서 메모리 폭발 방지)."""
    path = None
    try:
        rr = requests.get(url, timeout=120, stream=True, headers=_TAG_UA)
        rr.raise_for_status()
        fd, path = tempfile.mkstemp(suffix="." + ext)
        with os.fdopen(fd, "wb") as fp:
            got = 0
            for chunk in rr.iter_content(1 << 16):
                if not chunk:
                    continue
                fp.write(chunk)
                got += len(chunk)
                if got > 60 * 1024 * 1024:   # 60MB 이상은 비정상 — 중단
                    raise RuntimeError("음원 파일이 너무 큽니다")
        return path
    except Exception:
        if path:
            try: os.remove(path)
            except Exception: pass
        return None


def _recog_try(mid, local_path=None):
    """업로드 직후 소리 인식(AcoustID)을 먼저 시도한다.

    성공하면 제목·가수·앨범을 채우고 True, 실패/도구 없음이면 False.
    local_path 를 주면 그 파일로 바로 지문을 뜨고, 없으면 Cloudinary 에서 받는다."""
    if not (_fp_bin() and _aco_key()):
        return False
    rec = _remote_track(mid)
    if not rec or rec.get("recog_tried"):
        return False
    tmp_owned = False
    try:
        if not local_path:
            url = _recog_url(rec)
            if not url:
                return False
            local_path = _recog_download(url, _music_ext(rec.get("ext")))
            tmp_owned = True
            if not local_path:
                return False
        result = _acoustid_lookup(local_path)
        if not result or not result.get("ok"):
            if result and result.get("error"):
                print("[recog] 업로드 자동 인식 실패 code=" + str(result.get("error")))
            return False
        rec.update({"title": result.get("title") or rec.get("title"),
                    "artist": result.get("artist") or rec.get("artist"),
                    "album": result.get("album") or rec.get("album"),
                    "tag_state": "done", "tag_src": "AcoustID",
                    "recog_score": result.get("score"), "recog_tried": int(time.time())})
        _music_track_save(rec)
        print("[recog] 업로드 자동 인식 성공:", result.get("artist"), "-", result.get("title"))
        return True
    except Exception as e:
        print("[recog] 업로드 자동 인식 오류:", _sb_error_text(e))
        return False
    finally:
        if tmp_owned and local_path:
            try: os.remove(local_path)
            except Exception: pass


def _cloud_music_pipeline(mid, tmp=None):
    """14.9 · 업로드 직후 정리 흐름:
    1) 소리 인식(음성인식·AcoustID)으로 제목·가수·앨범을 먼저 채우고
    2) 인식이 안 되면 자동검색으로 정보만 채운다.
    (14.11 — 표지·가사는 연쇄하지 않는다. 각자 전용 버튼/백필 담당)"""
    try:
        _recog_try(mid, tmp)
    finally:
        if tmp:
            try: os.remove(tmp)
            except Exception: pass
    _cloud_music_autotag(mid)


def music_recognize_cloud():
    if not _sb_enabled():
        return _LOCAL_MUSIC_RECOGNIZE() if _LOCAL_MUSIC_RECOGNIZE else (jsonify({"ok": False}), 503)
    d = request.get_json(silent=True) or {}; mid = _music_id(d.get("id")); rec = _remote_track(mid)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    if not (_fp_bin() and _aco_key()):
        return jsonify({"ok": False, "error": "fpcalc와 AcoustID 키가 필요합니다"}), 400
    url = _recog_url(rec)
    if not url:
        return jsonify({"ok": False, "error": "음원 주소가 없습니다"}), 400
    path = None
    try:
        # 14.9 · 음원 전체를 메모리에 올리지 않고 스트리밍으로 받는다.
        #  (큰 파일에서 60초 타임아웃/메모리 폭발로 "인식 실패" 나던 원인)
        path = _recog_download(url, _music_ext(rec.get("ext")))
        if not path:
            return jsonify({"ok": False, "error": "음원을 내려받지 못했습니다"}), 502
        result = _acoustid_lookup(path)
        if not result or not result.get("ok"):
            # 14.9 · 원인을 숨기지 않는다. 예전엔 무슨 실패든 전부
            #  "소리로는 찾지 못했어요"로 뭉개서, 키가 잘못됐는지·지문이
            #  실패했는지·정말 못 찾았는지 알 수가 없었다.
            err = (result or {}).get("error") or "notfound"
            msg = {"nokey": "AcoustID 키가 없습니다 (관리자 설정 필요)",
                   "nofp": "서버에 fpcalc 가 없습니다",
                   "fpfail": "소리 지문을 만들지 못했습니다",
                   "notfound": "소리로는 찾지 못했어요"}
            if err in msg:
                em = msg[err]
            elif str(err).startswith("net:"):
                em = "AcoustID 서버에 연결하지 못했습니다 (" + str(err)[4:120] + ")"
            else:
                em = "인식 오류: " + str(err)[:120]
            # notfound 인데 '가장 비슷한 후보'가 있으면 함께 보여준다.
            #  (곡 자체가 AcoustID 에 없거나, 확신도 0.85 미만이라 거른 것인지 구분)
            near = (result or {}).get("near")
            if err == "notfound" and near:
                parts = []
                if near.get("artist"):
                    parts.append(near["artist"])
                if near.get("title"):
                    parts.append(near["title"])
                if parts:
                    sc = int(round(float(near.get("score") or 0) * 100))
                    em = "소리로는 찾지 못했어요 · 가장 비슷한 곡: " + " · ".join(parts) + f" ({sc}점)"
            print("[recog] 실패 code=" + str(err))
            return jsonify({"ok": False, "error": em, "code": err}), 400
        rec.update({"title": result.get("title") or rec.get("title"),
                    "artist": result.get("artist") or rec.get("artist"),
                    "album": result.get("album") or rec.get("album"),
                    "tag_state": "done", "tag_src": "AcoustID",
                    "recog_score": result.get("score"), "recog_tried": int(time.time())})
        rec = _music_track_save(rec)
        # 14.11 — '소리 인식' 클릭에 표지/가사 되찾기를 연쇄하지 않는다.
        # 그 뒤에 태깅이 덧붙는 것도 없앴다(각 기능은 전용 버튼).
        return jsonify({"ok": True, "track": _music_public_cloud(rec), "recog": result})
    except Exception as e:
        return jsonify({"ok": False, "error": "인식 실패: " + _sb_error_text(e)}), 502
    finally:
        if path:
            try: os.remove(path)
            except Exception: pass


app.view_functions["music_recognize_api"] = music_recognize_cloud
def _cloud_music_backfill():
    """13.0 · 클라우드 음원 백그라운드 태그·가사·표지 자동 정리.
    사용자가 유휴(Idle) 상태일 때 적극적으로 처리하여 전체 라이브러리에
    제목·가수·앨범·싱크가사·표지를 완벽히 채운다.
    """
    time.sleep(15)
    _last_clean = 0
    while True:
        if not _sb_enabled():
            time.sleep(120); continue
        try:
            now = time.time()
            if now - _last_clean > 900:
                _cleanup_old_temp_files()
                _last_clean = now

            tracks = _remote_tracks()
            retag, nolyr, nocov = [], [], []
            for r in tracks:
                if r.get("tag_state") == "manual":
                    continue
                # 1) 태그 재정리 대상
                if r.get("tag_algo") != TAG_ALGO:
                    retag.append(r.get("id"))
                elif r.get("tag_state") in ("pending", "none") and float(r.get("tag_next") or 0) <= now:
                    retag.append(r.get("id"))
                # 2) 가사 없는 곡
                elif not (r.get("lyrics") or r.get("lyrics_plain")) and int(r.get("lyrics_tries") or 0) < 6:
                    nolyr.append(r.get("id"))
                # 3) 싱크 가사가 없는 곡
                elif "[" not in (r.get("lyrics") or "") and (r.get("lyrics_plain") or "").strip() and int(r.get("lyrics_tries") or 0) < 4:
                    nolyr.append(r.get("id"))
                # 4) 표지 없는 곡
                elif not r.get("cover_url") and not r.get("cover"):
                    nocov.append(r.get("id"))

            retag = [x for x in retag if x]
            nolyr = [x for x in nolyr if x and x not in retag]
            nocov = [x for x in nocov if x and x not in retag and x not in nolyr]

            todo = retag + nolyr + nocov
            if not todo:
                time.sleep(15 if is_server_idle() else 60); continue

            idle = is_server_idle()
            batch_size = 12 if idle else 2
            sleep_gap = 1.0 if idle else 3.5

            print(f"[music] 클라우드 백필 (idle={idle}): 재태깅 {len(retag)} · 가사 {len(nolyr)} · 표지 {len(nocov)}")
            for mid in todo[:batch_size]:
                try:
                    if mid in retag:
                        _cloud_music_autotag(mid, force=True)
                    elif mid in nolyr:
                        _music_lyrics_cloud(mid)
                    elif mid in nocov:
                        _cloud_cover_pick(mid)
                except Exception as e:
                    print("[music] 클라우드 백필 항목 실패:", mid, _sb_error_text(e))
                time.sleep(sleep_gap)
            time.sleep(12 if idle else 45)
        except Exception as e:
            print("[music] 클라우드 태그 백필 오류:", _sb_error_text(e))
            time.sleep(60)
threading.Thread(target=_cloud_music_backfill, daemon=True).start()
@app.route("/api/music/background-work", methods=["POST"])
def music_background_work():
    """13.0 · 클라이언트 유휴(Idle) 상태 진입 시 백그라운드 태그/가사 작업 가속 트리거.

    14.11 — 곡마다 '한 가지 기능'만 수행한다 (태그 → 가사 → 표지 순서로
    필요 항목을 고르고, 자동 태그가 가사까지 끌어가지 않는다).
    """
    def _run():
        try:
            def _needs(r):
                if r.get("tag_state") == "manual":
                    return None
                if (r.get("tag_algo") != TAG_ALGO or not r.get("tag_state")
                        or r.get("tag_state") in ("pending", "none")) \
                        and float(r.get("tag_next") or 0) <= time.time():
                    return "tag"
                if not ((r.get("lyrics") or "") or (r.get("lyrics_plain") or "")) \
                        and int(r.get("lyrics_tries") or 0) < 5 \
                        and float(r.get("lyrics_next") or 0) <= time.time():
                    return "lyr"
                if not (r.get("cover") or r.get("cover_url")):
                    return "cover"
                return None
            if _sb_enabled():
                todo = []
                for r in _remote_tracks():
                    k = _needs(r)
                    if k:
                        todo.append((k, r.get("id")))
                for kind, mid in todo[:6]:
                    if kind == "tag":
                        _cloud_music_autotag(mid, force=True)
                    elif kind == "lyr":
                        _music_lyrics_cloud(mid)
                    else:
                        _cloud_cover_pick(mid)
                    time.sleep(1.0)
            else:
                with _music_lock:
                    todo = []
                    for mid, r in _music_load().items():
                        k = _needs(r)
                        if k:
                            todo.append((k, mid))
                for kind, mid in todo[:6]:
                    if kind == "tag":
                        _music_autotag(mid, force=True, algo=TAG_ALGO)
                    elif kind == "lyr":
                        _music_lyrics(mid)
                    else:
                        _music_cover_search(mid)
                    time.sleep(1.0)
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"ok": True, "status": "idle_burst_started"})


# ── 라우트 교체 (변이 경로만 — 읽기는 Node 담당) ──
app.view_functions["music_upload"] = music_upload_cloud
app.view_functions["music_youtube"] = music_youtube_cloud
app.view_functions["music_meta"] = music_meta_cloud
app.view_functions["music_cover_set"] = music_cover_cloud
app.view_functions["music_reset_meta"] = music_reset_cloud
app.view_functions["music_synced_lyrics"] = music_synced_lyrics_cloud
app.view_functions["music_lookup"] = music_lookup_cloud
app.view_functions["music_rescan"] = music_rescan_cloud
app.view_functions["music_recognize_api"] = music_recognize_cloud

# 서버가 켜진 뒤 이관 (백필 스레드는 위의 원본 코드가 이미 시작한다).
# 느린 음원 업로드가 앱 기동을 막지 않도록 daemon thread 로 실행한다.
threading.Thread(target=_migrate_local_music, daemon=True).start()
