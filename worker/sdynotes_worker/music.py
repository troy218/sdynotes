"""Music library: upload/list/stream, auto-tagging, lyrics, AcoustID, YouTube."""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

import requests
import urllib.parse
from bs4 import BeautifulSoup
from flask import Response, jsonify, request, send_from_directory
from PIL import Image

from .admin import _require_admin, requests_post_internal
from .cloud import SYNC_TABLE, _sb_enabled, _sb_get, _sb_put
from .common import (ACOUSTID_FILE, BASE_DIR, MUSIC_BAK, MUSIC_DIR, MUSIC_META,
                     SYNC_DIR, YT_COOKIES_BAK, YT_COOKIES_FILE,
                     _cleanup_old_temp_files, _music_lock, is_server_idle)
from .core import app


# ============ 음악 플레이어 (기기별 재생 · 누구나 업로드) ============
MUSIC_MAX_MB = 50
MUSIC_EXTS = {"mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "webm", "weba"}




# mtime 기준 캐시. 주의: _music_load 는 호출측이 _music_lock 을 잡은 채로
# 불리는 경우가 많다(threading.Lock 은 재진입 불가) → 캐시는 전용 락으로만
# 보호하고 _music_lock 은 절대 건드리지 않는다.
_music_cache = {"key": None, "data": None}
_music_cache_lock = threading.Lock()


def _music_shallow(m):
    """목록 dict 를 '곡 단위' 얕은 복사로 돌려준다.

    JSON 파싱(수 MB~수십 MB 문자열 → 객체)보다 훨씬 싸고, 호출측이
    리턴받은 dict 를 수정해도 캐시가 오염되지 않는다.
    """
    return {k: (dict(v) if isinstance(v, dict) else v) for k, v in m.items()}


def _music_load():
    """목록 읽기 (mtime 기준 캐시 + 깨진 파일 백업 복구 11.4).

    목록 파일은 가사 본문까지 담고 있어 곡이 많으면 수 MB 가 넘는다.
    매 요청마다 json.load 를 하면 list/play/lookup/백필이 몰릴 때 CPU·GC
    부담이 커지므로, 파일이 안 바뀌었으면 캐시에서 '얕은 복사'만 돌려준다.
    """
    key = None
    try:
        st = os.stat(MUSIC_META)
        key = (st.st_mtime_ns, st.st_size)
    except Exception:
        key = None
    with _music_cache_lock:
        c = _music_cache
        if c["data"] is not None and c["key"] == key:
            return _music_shallow(c["data"])
    m = None
    try:
        with open(MUSIC_META, encoding="utf-8") as fp:
            _m = json.load(fp)
        if isinstance(_m, dict):
            m = _m
    except Exception:
        m = None
    if m is None:
        try:
            with open(MUSIC_BAK, encoding="utf-8") as fp:
                bm = json.load(fp)
            if isinstance(bm, dict) and bm:
                print(f"[music] 목록 파일이 깨져 백업본({len(bm)}곡)으로 되살립니다")
                try:
                    tmp = "%s.tmp.%s" % (MUSIC_META, uuid.uuid4().hex[:8])
                    with open(tmp, "w", encoding="utf-8") as fp:
                        json.dump(bm, fp, ensure_ascii=False)
                    os.replace(tmp, MUSIC_META)
                    st = os.stat(MUSIC_META)
                    key = (st.st_mtime_ns, st.st_size)
                except Exception:
                    pass
                m = bm
        except Exception:
            m = None
    if m is None:
        with _music_cache_lock:
            _music_cache["key"] = key
            _music_cache["data"] = {}
        return {}
    with _music_cache_lock:
        _music_cache["key"] = key
        _music_cache["data"] = m
    return _music_shallow(m)


_SIDE_KEYS = ("id", "title", "artist", "album", "year", "genre", "ext", "bytes",
              "orig_title", "tag_state", "tag_src", "tag_algo", "cover",
              "lyrics", "lyrics_plain", "lyrics_src", "lyrics_tries", "created_at",
              "recog_title", "recog_artist", "recog_album", "recog_mbid",
              "recog_score", "recog_state", "recog_tried",
              "uploader", "uploader_uid")
_last_saved = {}


def _music_sidecar(mid, rec):
    """11.5 · 곡 옆에 메타데이터 쪽지(<id>.meta.json)를 남긴다.

    목록 파일이 통째로 날아가도, 곡마다 붙어 있는 이 쪽지로 제목·가수·
    앨범·가사까지 그대로 되살릴 수 있다.
    """
    try:
        o = {k: rec.get(k) for k in _SIDE_KEYS if rec.get(k) not in (None, "")}
        pth = os.path.join(MUSIC_DIR, mid + ".meta.json")
        tmp = "%s.tmp.%s" % (pth, uuid.uuid4().hex[:8])
        with open(tmp, "w", encoding="utf-8") as fp:
            json.dump(o, fp, ensure_ascii=False)
        os.replace(tmp, pth)
    except Exception:
        pass


def _music_sidecar_read(mid):
    try:
        with open(os.path.join(MUSIC_DIR, mid + ".meta.json"), encoding="utf-8") as fp:
            o = json.load(fp)
        return o if isinstance(o, dict) else None
    except Exception:
        return None


def _upload_log(mid, ext, name):
    """11.5 · 올린 파일의 '원래 이름'을 한 줄씩 덧붙여 적어 둔다.

    목록도 쪽지도 없을 때, 이 원래 이름으로 웹 검색을 돌려 곡을 되찾는다.
    """
    try:
        with open(os.path.join(MUSIC_DIR, "_uploads.log"), "a", encoding="utf-8") as fp:
            fp.write("%s\t%s\t%s\t%s\n" % (
                mid, ext,
                str(name or "").replace("\t", " ").replace("\n", " ")[:200],
                time.strftime("%Y-%m-%dT%H:%M:%SZ")))
    except Exception:
        pass


def _upload_log_read():
    out = {}
    try:
        with open(os.path.join(MUSIC_DIR, "_uploads.log"), encoding="utf-8") as fp:
            for line in fp:
                z = line.rstrip("\n").split("\t")
                if len(z) >= 3 and z[0]:
                    out[z[0]] = z[2]
    except Exception:
        pass
    return out


def _music_save(m):
    """목록 저장 (원자적 교체 + 마지막 정상본 백업 + 곡별 쪽지).

    11.4 · 서버가 과부하로 갑자기 죽어도 목록이 통째로 사라지지 않게,
    곡 수가 줄지 않을 때만 백업을 갱신해 '마지막 정상 상태'를 남겨 둔다.
    """
    tmp = "%s.tmp.%s" % (MUSIC_META, uuid.uuid4().hex[:8])
    with open(tmp, "w", encoding="utf-8") as fp:
        json.dump(m, fp, ensure_ascii=False)
        try:
            fp.flush()
            os.fsync(fp.fileno())
        except Exception:
            pass
    os.replace(tmp, MUSIC_META)
    # 14.11 · 저장 즉시 캐시도 갱신한다. mtime/size 키만 믿으면 저장 직후
    # (특히 1초 단위 타임스탬프 파일시스템) 다음 _music_load 가 낡은 목록을
    # 돌려줄 수 있다. 같은 m 이 다시 뿌려져 곡 단위 사본도 일관된다.
    try:
        st2 = os.stat(MUSIC_META)
        key2 = (st2.st_mtime_ns, st2.st_size)
        with _music_cache_lock:
            # 사본을 넣는다 — 호출자가 m 을 저장 뒤에도 수정해도 캐시가 오염되지 않는다.
            _music_cache["key"] = key2
            _music_cache["data"] = _music_shallow(m)
    except Exception:
        pass
    # 11.5 · 바뀐 곡만 쪽지 갱신 (되살리기용 사본)
    try:
        for mid, rec in m.items():
            if not isinstance(rec, dict):
                continue
            sig = tuple(rec.get(k) for k in _SIDE_KEYS)
            if _last_saved.get(mid) != sig:
                _last_saved[mid] = sig
                _music_sidecar(mid, rec)
        for mid in [k for k in _last_saved if k not in m]:
            _last_saved.pop(mid, None)
            try:
                os.remove(os.path.join(MUSIC_DIR, mid + ".meta.json"))
            except Exception:
                pass
    except Exception:
        pass
    try:
        nbak = 0
        if os.path.exists(MUSIC_BAK):
            with open(MUSIC_BAK, encoding="utf-8") as fp:
                b = json.load(fp)
            nbak = len(b) if isinstance(b, dict) else 0
        if len(m) >= nbak:
            btmp = "%s.tmp.%s" % (MUSIC_BAK, uuid.uuid4().hex[:8])
            with open(btmp, "w", encoding="utf-8") as fp:
                json.dump(m, fp, ensure_ascii=False)
            os.replace(btmp, MUSIC_BAK)
    except Exception:
        pass


def _music_rebuild():
    """11.5 · 폴더에 남은 음원 파일로 목록을 되살린다.

    되살리는 순서 (앞쪽일수록 정보가 온전하다)
      ① _index.json.bak      — 마지막 정상 목록 (_music_load 가 자동 사용)
      ② <id>.meta.json 쪽지  — 곡마다 붙여 둔 사본 (제목·가수·앨범·가사까지)
      ③ _uploads.log 원래 이름 → 이름 분석 + 웹 검색(Apple Music·Deezer·MB)
      ④ 파일 안 태그(mutagen)
      ⑤ 그래도 모르면 자리표시 이름을 넣고 웹 검색 대기열에 올린다
    곡 id 가 파일 이름 그대로라 재생목록·대기열은 자동으로 다시 붙는다.
    반환: (되살린 수, 전체 수)
    """
    added, ids, from_side, from_name = 0, [], 0, 0
    try:
        names = _upload_log_read()
        with _music_lock:
            m = _music_load()
            try:
                files = os.listdir(MUSIC_DIR)
            except Exception:
                files = []
            for fn in sorted(files):
                if fn.startswith("_") or "." not in fn:
                    continue
                mid, _, ext = fn.rpartition(".")
                ext = ext.lower()
                if ext not in MUSIC_EXTS or not mid or mid in m:
                    continue
                path = os.path.join(MUSIC_DIR, fn)
                try:
                    size = os.path.getsize(path)
                except Exception:
                    size = 0
                try:
                    born = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                         time.gmtime(os.path.getmtime(path)))
                except Exception:
                    born = time.strftime("%Y-%m-%dT%H:%M:%SZ")
                has_cover = os.path.exists(os.path.join(MUSIC_DIR, mid + ".cover"))

                rec, how = None, ""
                side = _music_sidecar_read(mid)                 # ② 쪽지
                if side and (side.get("title") or side.get("artist")):
                    rec = dict(side)
                    rec["id"] = mid
                    rec.setdefault("tag_state", "done" if side.get("tag_src") else "none")
                    how = "meta"
                    from_side += 1
                if rec is None:
                    try:
                        emb = _read_embedded(path)              # ④ 파일 안 태그
                    except Exception:
                        emb = {}
                    orig = (names.get(mid) or "").strip()       # ③ 원래 올린 이름
                    title = (emb.get("title") or "").strip()
                    artist = (emb.get("artist") or "").strip()
                    if orig:
                        t2, a2 = _parse_filename(orig)
                        title = title or t2
                        artist = artist or a2
                        from_name += 1
                        how = "name"
                    elif emb.get("title"):
                        how = "tag"
                    rec = {
                        "id": mid,
                        "title": (title or ("복구된 곡 " + mid[:6]))[:120],
                        "artist": artist[:80],
                        "album": (emb.get("album") or "")[:120],
                        "year": emb.get("year") or "",
                        "genre": (emb.get("genre") or "")[:40],
                        "orig_title": (orig or title or mid)[:120],
                        "tag_state": "pending", "tag_src": "",
                    }
                rec.update({"ext": ext, "bytes": size, "cover": has_cover,
                            "created_at": rec.get("created_at") or born,
                            "restored": True, "restored_from": how})
                if not rec.get("orig_title"):
                    rec["orig_title"] = rec.get("title") or mid
                m[mid] = rec
                added += 1
                ids.append(mid)
            if added:
                _music_save(m)
            total = len(m)
        if added:
            print(f"[music] 목록 복구 {added}곡 (쪽지 {from_side} · 올린이름 {from_name}"
                  f" · 나머지 웹검색) — 전체 {total}곡")

            def _fixup():
                # 되살린 곡은 웹 검색 → 그래도 모르면 '소리 인식' 으로 찾는다
                for mid in ids[:150]:
                    try:
                        with _music_lock:
                            r = dict(_music_load().get(mid) or {})
                        if r.get("tag_state") != "done":
                            _music_autotag(mid, force=True, algo=TAG_ALGO)
                        with _music_lock:
                            r = dict(_music_load().get(mid) or {})
                        # 이름으로도 못 찾았고 인식 기능이 준비돼 있으면 소리로 찾는다
                        if (r.get("tag_state") != "done" and not r.get("recog_tried")
                                and _fp_bin() and _aco_key()):
                            _music_recognize(mid, apply_tags=True)
                        if not (r.get("lyrics") or r.get("lyrics_plain")):
                            _music_lyrics(mid)
                    except Exception:
                        pass
                    time.sleep(0.7)
            threading.Thread(target=_fixup, daemon=True).start()
        return added, total
    except Exception as e:
        print(f"[music] 목록 복구 실패: {e}")
        return 0, 0


# ═══════════════════════════════════════════════════════════
#  10.1 · 음악 자동 태깅 (제목·가수·앨범·연도·장르·표지 자동 정리)
#
#  올라온 파일에서 단서를 최대한 끌어낸 뒤(파일 이름 분석 + 파일 안의
#  태그(mutagen)) Apple Music(iTunes 검색) → Deezer → MusicBrainz
#  순서로 찾아보고, 후보와의 유사도로 점수를 매겨 가장 확실한 것만
#  적용한다. 못 찾거나 애매하면 원본을 그대로 둔다(수동 편집 가능).
#    · 파일 안에 이미 완전한 태그가 있으면 그걸 우선한다
#    · 한 번 찾은 검색어 결과는 캐시해 같은 곡을 반복 조회하지 않는다
#    · 웹 표지는 파일에 표지가 없을 때만 내려받는다
# ═══════════════════════════════════════════════════════════
import difflib
import unicodedata
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

# 태그/가사 검색은 I/O 바운드(외부 API). 출처·질의를 스레드풀로 병렬 호출해
# 예전처럼 iTunes→Deezer→MusicBrainz 를 직렬로(합 15~20초) 기다리지 않게 한다.
# 풀은 모듈 전역에서 단 하나만 만들어 데몬 스레드로 유지한다.
_TAG_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="tag")

# 수동 저장이 일어나면 해당 곡의 이전 자동 태깅 결과가 늦게 도착해 덮어쓰지
# 않도록 세대(generation)를 둔다. music_meta 가 태그를 저장할 때마다 증가.
_tag_generation = {}
_tag_generation_lock = threading.Lock()


def _tag_generation_bump(mid):
    with _tag_generation_lock:
        g = time.time_ns()
        _tag_generation[mid] = g
        return g


def _tag_generation_current(mid):
    with _tag_generation_lock:
        return _tag_generation.get(mid, 0)


_TAG_UA = {"User-Agent": "SDYnotes/10.6 (music tag&lyrics helper) "
                         "(https://sdynotes; admin@sdynotes.local)"}
_tag_cache = {}


def _cached(key, fn):
    if key in _tag_cache:
        return _tag_cache[key]
    v = fn()
    _tag_cache[key] = v
    if len(_tag_cache) > 400:
        _tag_cache.pop(next(iter(_tag_cache)))
    return v


_TAG_PUNCT = re.compile(r"[\s\u2000-\u200f_\-–—·.,!?\"'`“”‘’(){}\[\]【】<>|/\\:;~]+")


def _tag_norm(s):
    """비교용 정규화: NFKC → 소문자 → 문장부호 제거."""
    s = unicodedata.normalize("NFKC", str(s or "")).lower()
    return _TAG_PUNCT.sub(" ", s).strip()


def _sim(a, b):
    """두 문자열의 유사도 0~1 (문자열 유사 + 단어 겹침)."""
    a, b = _tag_norm(a), _tag_norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    r = difflib.SequenceMatcher(None, a, b).ratio()
    ta, tb = set(a.split()), set(b.split())
    tok = len(ta & tb) / max(1, len(ta | tb))
    return 0.6 * r + 0.4 * tok


# 파일 이름에서 지울 잡음 (MV, 가사, 320kbps, 해상도, 확장자 …)
_FN_JUNK = re.compile(
    r"(?i)\bofficial\s+(music\s+)?(video|audio)\b"
    r"|\bmusic\s+video\b|\bmv\b|가사|가사있음|노래모음|영상"
    r"|\bcolor\s*coded\b|\blyrics?\b|\baudio\s+only\b|\bfull\s+album\b"
    r"|\b(?:mp3|flac|m4a|aac|ogg|opus|wav|webm|weba)\b"
    r"|\d{2,3}\s*kbps|\b(?:720|1080)p\b|\b4k\b|\bhd\b|\buhd\b"
    r"|\byoutube\b|\btopic\b|\breaction\b|\bplaylist\b|\bbest\s+of\b"
    r"|\binst\b|\binstrumental\b|\bno\s+copyright\b|\bncs\b"
    r"|\bfree\s+download\b|\bdownload\b")


def _parse_filename(name):
    """파일 이름 → (제목 후보, 가수 후보).

    '아이유 - 좋아요', '01. BTS - Dynamite', '좋아요 - 아이유' 같은
    흔한 꼴을 최대한 맞춘다. 틀려도 웹 검색이 제목만으로 다시 찾아준다.
    """
    base = os.path.basename(str(name or ""))
    base = os.path.splitext(base)[0]
    # 짧은 [대괄호]는 보통 부가 정보('[가사]', '[MV]') → 지운다
    base = re.sub(r"\[[^\[\]]{0,42}\]", " ", base)
    base = base.replace("_", " ").replace("　", " ")
    base = _FN_JUNK.sub(" ", base)
    base = re.sub(r"\(\s*\)|\[\s*\]", " ", base)              # 빈 괄호 털기
    base = re.sub(r"^\s*\d{1,3}\s*[.\-)]+\s*", "", base)      # 앞 번호 '01.'
    base = re.sub(r"\s{2,}", " ", base).strip(" -–—.")
    parts = [p.strip() for p in re.split(r"\s+[-–—]+\s+", base) if p.strip()]
    artist, title = "", base
    if len(parts) >= 2:
        a, b = parts[0], " - ".join(parts[1:])
        # 보통은 '가수 - 제목'. 앞쪽이 유난히 길면 '제목 - 가수' 로 본다
        if len(a) > max(6, len(b) * 2.2):
            artist, title = b, a
        else:
            artist, title = a, b
    return (title or base).strip()[:120], (artist or "").strip()[:80]


def _read_embedded(path):
    """파일 안의 태그(mutagen): title/artist/album/year/genre/길이."""
    out = {"title": "", "artist": "", "album": "", "year": "", "genre": "", "dur": None}
    try:
        from mutagen import File as MFile
        mf = MFile(path, easy=True)
        if mf is None:
            return out

        def g(k):
            try:
                v = mf.tags.get(k) if mf.tags else None
                return str(v[0]).strip() if v else ""
            except Exception:
                return ""
        out["title"] = g("title")[:120]
        out["artist"] = g("artist")[:80]
        out["album"] = g("album")[:120]
        out["genre"] = g("genre")[:40]
        y = g("date") or g("year")
        m = re.search(r"(19|20)\d{2}", y or "")
        out["year"] = m.group(0) if m else ""
        try:
            out["dur"] = round(float(mf.info.length))
        except Exception:
            pass
    except Exception:
        pass
    return out


def _src_itunes(q):
    """13.0 · Apple Music(iTunes Search) — KR/US/JP/GB 스토어 검색 및 인기곡 순위/고화질 표지."""
    def run():
        out, seen = [], set()

        def add(items):
            for rank_idx, it in enumerate(items):
                if not it.get("trackName"):
                    continue
                k = _tag_norm(it["trackName"]) + "|" + _tag_norm(it.get("artistName"))
                if k in seen:
                    continue
                seen.add(k)
                art = (it.get("artworkUrl100") or "").replace(
                    "100x100bb", "1000x1000bb").replace("100x100", "1000x1000")
                out.append({
                    "title": it["trackName"],
                    "artist": it.get("artistName") or "",
                    "album": it.get("collectionName") or "",
                    "year": (it.get("releaseDate") or "")[:4],
                    "genre": it.get("primaryGenreName") or "",
                    "dur": round(it["trackTimeMillis"] / 1000)
                           if it.get("trackTimeMillis") else None,
                    "art": art, "rank_pos": rank_idx, "src": "Apple Music"})
        for cc in ("KR", "US", "JP", "GB"):
            try:
                r = requests.get("https://itunes.apple.com/search",
                                 params={"term": q, "entity": "song",
                                         "limit": "15", "country": cc},
                                 headers=_TAG_UA, timeout=6)
                add((r.json() or {}).get("results", []))
            except Exception:
                continue
        return out
    return _cached("it:" + q, run)


def _src_deezer(q):
    """13.0 · Deezer Search API — rank 인기도 수치 및 고화질 커버."""
    def run():
        out = []
        try:
            r = requests.get("https://api.deezer.com/search",
                             params={"q": q, "limit": "20"},
                             headers=_TAG_UA, timeout=6)
            for it in (r.json() or {}).get("data", []):
                alb = it.get("album") or {}
                art = alb.get("cover_xl") or alb.get("cover_big") or alb.get("cover_medium") or ""
                out.append({
                    "title": it.get("title") or "",
                    "artist": ((it.get("artist") or {}).get("name")) or "",
                    "album": alb.get("title") or "",
                    "year": "", "genre": "",
                    "dur": int(it["duration"]) if it.get("duration") else None,
                    "art": art,
                    "rank": int(it.get("rank") or 0),
                    "src": "Deezer"})
        except Exception:
            pass
        return out
    return _cached("dz:" + q, run)


def _src_musicbrainz(q):
    def run():
        out = []
        try:
            r = requests.get("https://musicbrainz.org/ws/2/recording/",
                             params={"query": q, "fmt": "json", "limit": "12"},
                             headers=_TAG_UA, timeout=6)
            for it in (r.json() or {}).get("recordings", []):
                artist = ""
                try:
                    artist = " ".join(c.get("name", "") for c in it["artist-credit"]
                                      if isinstance(c, dict)).strip()
                except Exception:
                    pass
                album, year, art = "", "", ""
                try:
                    rel = (it.get("releases") or [{}])[0]
                    album = rel.get("title", "") or ""
                    y = re.search(r"(19|20)\d{2}", rel.get("date", "") or "")
                    year = y.group(0) if y else ""
                    # 10.3 · MusicBrainz 음반 표지 아카이브(CAA) — 표지 사각지대 해소
                    if rel.get("id"):
                        art = "https://coverartarchive.org/release/%s/front-500" % rel["id"]
                except Exception:
                    pass
                out.append({
                    "title": it.get("title") or "",
                    "artist": artist, "album": album, "year": year, "genre": "",
                    "dur": round(it["duration"] / 1000) if it.get("duration") else None,
                    "art": art, "src": "MusicBrainz"})
        except Exception:
            pass
        return out
    return _cached("mb:" + q, run)


def _fetch_cover(url):
    """웹 표지 내려받기 — http(s) 만, 8MB 이하, 이미지 시그니처 확인."""
    try:
        if not url or not str(url).startswith(("http://", "https://")):
            return None
        r = requests.get(url, headers=_TAG_UA, timeout=10)
        b = r.content
        if not b or len(b) > 8 * 1024 * 1024:
            return None
        if not (b[:3] == b"\xff\xd8\xff" or b[:8] == b"\x89PNG\r\n\x1a\n"
                or b[:4] == b"RIFF"):
            return None
        return b
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════
#  11.6 · 노래 인식 (소리 지문 → AcoustID → MusicBrainz)
#
#  파일 이름도 태그도 없는 곡을 '소리 자체'로 알아낸다.
#    fpcalc(Chromaprint) 로 지문을 뜨고 → AcoustID 에 물어보면
#    곡 제목·가수·앨범을 돌려준다. 그 이름으로 기존 검색(Apple Music·
#    Deezer·MusicBrainz)을 돌려 표지·연도·장르·가사까지 마저 채운다.
#
#  준비물 (apply.sh 가 자동으로 깔아 줍니다)
#    · fpcalc :  sudo apt install libchromaprint-tools
#    · AcoustID 키 : https://acoustid.org/new-application 에서 무료 발급
#         - 환경변수 ACOUSTID_KEY 로 넣거나
#         - 앱의 '음악 정보 편집 → 소리로 인식' 에서 관리자가 붙여넣기
# ═══════════════════════════════════════════════════════════
import shutil
import subprocess
import sys

_ACO = {"key": (os.environ.get("ACOUSTID_KEY") or "").strip(), "bin": None, "checked": False}


def _aco_key():
    if _ACO["key"]:
        return _ACO["key"]
    try:
        with open(ACOUSTID_FILE, encoding="utf-8") as fp:
            k = (json.load(fp).get("key") or "").strip()
        if k:
            _ACO["key"] = k
    except Exception:
        pass
    return _ACO["key"]


def _aco_key_save(k):
    k = re.sub(r"[^0-9A-Za-z_\-]", "", str(k or ""))[:60]
    _ACO["key"] = k
    try:
        with open(ACOUSTID_FILE, "w", encoding="utf-8") as fp:
            json.dump({"key": k}, fp)
    except Exception:
        pass
    return k


def _fp_bin():
    if not _ACO["checked"]:
        _ACO["checked"] = True
        _ACO["bin"] = shutil.which("fpcalc") or shutil.which("/usr/bin/fpcalc")
    return _ACO["bin"]


def _fingerprint(path, seconds=120):
    """음원 앞부분의 소리 지문을 뜬다 → (길이초, 지문문자열)"""
    exe = _fp_bin()
    if not exe or not os.path.exists(path):
        return None
    try:
        out = subprocess.run([exe, "-json", "-length", str(seconds), path],
                             capture_output=True, timeout=40)
        d = json.loads((out.stdout or b"{}").decode("utf-8", "ignore"))
        fp, dur = d.get("fingerprint"), d.get("duration")
        if fp and dur:
            return int(round(float(dur))), fp
    except Exception as e:
        print(f"[recog] 지문 실패: {e}")
    return None


def _acoustid_lookup(path):
    """소리 지문으로 곡을 알아낸다. 반환: {title, artist, album, year, score} | None"""
    key = _aco_key()
    if not key:
        return {"error": "nokey"}
    fp = _fingerprint(path)
    if not fp:
        return {"error": "nofp" if not _fp_bin() else "fpfail"}
    dur, code = fp
    try:
        r = requests.post("https://api.acoustid.org/v2/lookup",
                          data={"client": key, "duration": str(dur),
                                "fingerprint": code,
                                "meta": "recordings releasegroups compress"},
                          headers=_TAG_UA, timeout=15)
        d = r.json() or {}
    except Exception as e:
        return {"error": "net:" + str(e)[:60]}
    if d.get("status") != "ok":
        return {"error": str((d.get("error") or {}).get("message") or "acoustid")[:80]}
    best, bs = None, -1.0
    closest, cs = None, -1.0
    for res in (d.get("results") or []):
        score = float(res.get("score") or 0)
        for rec in (res.get("recordings") or []):
            title = (rec.get("title") or "").strip()
            if not title:
                continue
            artists = rec.get("artists") or []
            artist = " & ".join((a.get("name") or "").strip() for a in artists if a.get("name"))
            album, year = "", ""
            for g in (rec.get("releasegroups") or []):
                album = album or (g.get("title") or "")
                if not year:
                    y = re.search(r"(19|20)\d{2}", str(g.get("firstreleasedate") or ""))
                    year = y.group(0) if y else ""
            # 길이가 비슷하면 가산점 (다른 버전 오인식 방지)
            sc = score
            if rec.get("duration") and dur:
                gap = abs(float(rec["duration"]) - dur)
                sc += 0.15 if gap <= 4 else (-0.2 if gap > 25 else 0)
            # 12.2 · 소리 인식 정확도 상향. AcoustID 점수(0~1, 지문 일치율)가
            #   낮으면 다른 곡/커버/라이브에 걸릴 수 있어, 0.85 미만은 받아들이지 않는다.
            #   (사용자 보고: 다른 사람·다른 제목이 들어가던 문제)
            cand = {"title": title[:120], "artist": artist[:80],
                    "album": album[:120], "year": year,
                    "score": round(sc, 3), "mbid": rec.get("id") or "",
                    "duration": int(round(float(rec.get("duration") or dur or 0))) if (rec.get("duration") or dur) else 0}
            if sc > cs:
                cs, closest = sc, cand
            if sc >= 0.85 and sc > bs:
                bs, best = sc, cand
    if not best:
        out = {"error": "notfound"}
        if closest:
            out["near"] = closest
        return out
    best["ok"] = True
    return best


def _recog_norm_text(s):
    """음원 인식 중복 판정용 정규화 — 제목/가수/앨범이 완전히 같은지 비교."""
    s = str(s or "")
    try:
        import unicodedata
        s = unicodedata.normalize("NFKC", s)
    except Exception:
        pass
    return re.sub(r"[^0-9a-z가-힣]+", "", s.lower())


def _recog_dup_key(r):
    """AcoustID로 확정(recog_state=done)된 곡만 중복 키를 만든다.

    1순위는 MusicBrainz recording id(mbid)라 같은 녹음본만 같은 키가 된다.
    mbid가 없을 때는 인식 결과의 제목+가수+앨범이 모두 같은 경우만 사용해
    동명이곡/라이브/리마스터 오삭제를 피한다.
    """
    if not isinstance(r, dict) or r.get("recog_state") != "done":
        return ""
    try:
        if r.get("recog_score") and float(r.get("recog_score") or 0) < 0.85:
            return ""
    except Exception:
        return ""
    mbid = _recog_norm_text(r.get("recog_mbid"))
    if mbid:
        return "mbid:" + mbid
    title = _recog_norm_text(r.get("recog_title") or r.get("title"))
    artist = _recog_norm_text(r.get("recog_artist") or r.get("artist"))
    album = _recog_norm_text(r.get("recog_album") or r.get("album"))
    if title and artist and album:
        return "tag:%s|%s|%s" % (title, artist, album)
    return ""


def _recog_keep_sort(mid, r):
    """동일 음원 중 남길 레코드 우선순위: 많이 들은/정보 많은/오래된 곡."""
    try:
        play = int(r.get("play_count") or 0)
    except Exception:
        play = 0
    rich = 0
    if r.get("lyrics") or r.get("lyrics_plain"):
        rich += 2
    if r.get("cover") or r.get("cover_url"):
        rich += 1
    if r.get("genre"):
        rich += 1
    return (-play, -rich, str(r.get("created_at") or ""), str(mid))


def _music_delete_files(mid):
    try:
        for fn in os.listdir(MUSIC_DIR):
            if fn.startswith(mid + "."):
                try:
                    os.remove(os.path.join(MUSIC_DIR, fn))
                except Exception:
                    pass
    except Exception:
        pass


def _music_merge_duplicate_record(keep, drop, keep_mid, drop_mid):
    """삭제될 동일 음원의 유용한 정보는 남길 곡으로 흡수한다."""
    keep = dict(keep or {})
    drop = dict(drop or {})
    for fld in ("artist", "album", "year", "genre", "tag_src", "recog_title", "recog_artist",
                "recog_album", "recog_mbid", "recog_score", "recog_state", "recog_tried"):
        if not keep.get(fld) and drop.get(fld):
            keep[fld] = drop.get(fld)
    for fld in ("lyrics", "lyrics_plain", "lyrics_src"):
        if not keep.get(fld) and drop.get(fld):
            keep[fld] = drop.get(fld)
    try:
        keep["play_count"] = int(keep.get("play_count") or 0) + int(drop.get("play_count") or 0)
    except Exception:
        pass
    try:
        keep["last_played"] = max(float(keep.get("last_played") or 0), float(drop.get("last_played") or 0))
    except Exception:
        pass
    # 남길 곡에 표지가 없고 삭제될 곡에만 있으면 표지 파일을 옮긴 뒤 삭제한다.
    try:
        keep_cover = os.path.join(MUSIC_DIR, keep_mid + ".cover")
        drop_cover = os.path.join(MUSIC_DIR, drop_mid + ".cover")
        if not os.path.exists(keep_cover) and os.path.exists(drop_cover):
            shutil.copy2(drop_cover, keep_cover)
            keep["cover"] = True
            keep["cover_v"] = int(time.time())
    except Exception:
        pass
    keep["dedupe_updated"] = int(time.time())
    return keep


def _music_dedupe_recognized(mid):
    """인식 완료 곡 중 완전히 같은 곡은 자동으로 하나만 남긴다."""
    removed, kept = [], None
    with _music_lock:
        m = _music_load()
        rec = m.get(mid)
        key = _recog_dup_key(rec)
        if not key:
            return {"duplicate_removed": False, "removed": [], "kept": rec}
        same = [k for k, v in m.items() if _recog_dup_key(v) == key]
        if len(same) <= 1:
            return {"duplicate_removed": False, "removed": [], "kept": rec}
        keep_id = sorted(same, key=lambda k: _recog_keep_sort(k, m.get(k) or {}))[0]
        keep_rec = dict(m.get(keep_id) or {})
        for drop_id in same:
            if drop_id == keep_id:
                continue
            keep_rec = _music_merge_duplicate_record(keep_rec, m.get(drop_id) or {}, keep_id, drop_id)
            removed.append(drop_id)
        for drop_id in removed:
            m.pop(drop_id, None)
        m[keep_id] = keep_rec
        _music_save(m)
        kept = dict(keep_rec)
    for drop_id in removed:
        _music_delete_files(drop_id)
    if removed:
        print("[recog] 동일 음원 자동 정리: keep=%s removed=%s" % (keep_id, ",".join(removed)))
    return {"duplicate_removed": mid in removed, "removed": removed, "kept": kept}


def _music_recognize(mid, apply_tags=True, force=False):
    """한 곡을 '소리'로 인식하고 제목·가수만 반영한다 (가사·표지는 연쇄하지 않음).

    force=True — 사용자가 편집창에서 '소리 인식' 버튼을 직접 누른 경우.
      이미 제목이 붙어 있거나(tag_state=done) 수동 저장됐어도(manual)
      인식 결과(0.85 이상만 통과)를 제목·가수에 반영한다. 버튼을 누른
      것이 곧 '이 결과로 바꿔 달라'는 뜻이기 때문이다.
    force=False — 배경 백필. 보수적으로, 제목이 비었거나 아직 정리되지
      않은 곡에만 붙인다.
    """
    with _music_lock:
        rec = dict((_music_load().get(mid) or {}))
    if not rec:
        return {"ok": False, "error": "없는 곡입니다"}
    hits = [fn for fn in os.listdir(MUSIC_DIR)
            if fn.startswith(mid + ".") and not fn.endswith((".cover", ".meta.json"))]
    if not hits:
        return {"ok": False, "error": "음원 파일이 없습니다"}
    res = _acoustid_lookup(os.path.join(MUSIC_DIR, hits[0]))
    msg = {"nokey": "AcoustID 키가 없습니다 (관리자 설정 필요)",
           "nofp": "서버에 fpcalc 가 없습니다 (apply.sh 다시 실행)",
           "fpfail": "소리 지문을 만들지 못했습니다",
           "notfound": "소리로는 찾지 못했어요"}
    if not res or not res.get("ok"):
        err = (res or {}).get("error") or "인식 실패"
        with _music_lock:
            m = _music_load()
            if m.get(mid):
                m[mid]["recog_tried"] = int(time.time())
                if err in ("notfound",):
                    m[mid]["recog_state"] = "none"
                _music_save(m)
        em = msg.get(err, err)
        near = (res or {}).get("near")
        if err == "notfound" and near:
            parts = []
            if near.get("artist"):
                parts.append(near["artist"])
            if near.get("title"):
                parts.append(near["title"])
            if parts:
                sc = int(round(float(near.get("score") or 0) * 100))
                em = "소리로는 찾지 못했어요 · 가장 비슷한 곡: " + " · ".join(parts) + f" ({sc}점)"
        return {"ok": False, "error": em, "code": err}
    with _music_lock:
        m = _music_load()
        if m.get(mid):
            m[mid].update({"recog_title": res["title"], "recog_artist": res["artist"],
                           "recog_album": res.get("album") or "",
                           "recog_mbid": res.get("mbid") or "",
                           "recog_score": res["score"], "recog_state": "done",
                           "recog_tried": int(time.time())})
            _music_save(m)
    print(f"[recog] 소리 인식: {res['title']} / {res['artist']} (score {res['score']})")
    if apply_tags:
        # 인식 결과(제목·가수)만 반영한다. 가사·표지·연도·장르는 각자의 동작에서.
        # 14.11 — '소리 인식' 클릭 한 번에 다른 기능(가사 검색 등)이 연쇄로
        # 돌지 않도록 한다. (제목·가수는 인식 자체의 결과물이다)
        # 14.13 — 버튼으로 직접 인식했는데 반영이 안 되는 문제:
        #   예전 조건('제목 있음 + tag_state=done'이면 건너뛰기) 때문에,
        #   자동 태깅이 이미 (잘못된) 제목을 붙여 둔 곡에서는 인식에
        #   성공해도 결과가 목록·편집창에 전혀 반영되지 않았다.
        if force:
            _tag_generation_bump(mid)   # 돌고 있던 자동 태깅이 이 결과를 덮지 않게
        with _music_lock:
            m = _music_load()
            r2 = m.get(mid)
            if r2:
                if force or not (r2.get("title") or "").strip() or r2.get("tag_state") != "done":
                    r2["title"] = res["title"]
                    r2["artist"] = res["artist"] or r2.get("artist", "")
                    r2["album"] = r2.get("album") or res["album"]
                    r2["year"] = r2.get("year") or res["year"]
                    r2["tag_state"] = "done"
                    r2["tag_src"] = "소리 인식(AcoustID)"
                m[mid] = r2
                _music_save(m)
    dedupe = _music_dedupe_recognized(mid)
    with _music_lock:
        out = _music_load().get(mid) or dedupe.get("kept") or rec
    resp = {"ok": True, "track": out, "recog": res}
    if dedupe.get("removed"):
        resp.update({"duplicate_removed": bool(dedupe.get("duplicate_removed")),
                     "removed": dedupe.get("removed") or [],
                     "kept": dedupe.get("kept") or out})
    return resp


TAG_ALGO = "13.0"       # 상세 제목 분해·다중 질의 알고리즘 — 올리면 기존 곡을 재정리한다


def _strip_parens(s):
    """검색어에서 괄호 부가 설명을 뗀다 ('좋아요 (Live)' → '좋아요')."""
    return re.sub(r"\s*\([^)]{0,40}\)\s*", " ", s or "").strip()


# ─────────────────────────────────────────────────────────────
# 12.11 · 상세 음악 제목 분해 + 다중 질의 매칭
#
# 파일명은 검색어 하나가 아니다. 다음 단서들을 각각 분리해 보관한다.
#   · 트랙 번호/디스크 번호
#   · 가수 - 제목 / 제목 - 가수 / [가수] 제목 / 제목 (가수)
#   · feat./with/&, OST·앨범 힌트
#   · Live/Remix/Acoustic/Inst/Remaster 같은 버전 힌트
#   · 원본 제목과 잡음 제거 제목의 여러 variant
#
# 검색은 '한 번의 넓은 검색'이 아니라 artist+title → title+artist →
# title variant → album/title 순서의 짧은 질의 여러 개를 출처별로 돌린다.
# 후보 평가는 제목·가수·앨범·버전·재생시간을 따로 점수화하므로,
# 제목이 같은 다른 가수나 Live/Remix 버전이 잘못 붙는 일을 줄인다.
# ─────────────────────────────────────────────────────────────
_TAG_TRACK_NO = re.compile(
    r"(?i)^\s*(?:(?:cd|disc|disk)\s*\d{1,2}\s*[-._]?\s*)?\d{1,3}\s*[-._)]\s*")
_TAG_CD_TRACK = re.compile(
    r"(?i)^\s*(?:cd|disc|disk)\s*\d{1,2}\s*[-._]?\s*\d{1,3}\s*[-._)]\s*")
_TAG_DISC_NO = re.compile(r"(?i)\b(?:cd|disc|disk)\s*\d{1,2}\b")
_TAG_FEAT = re.compile(r"(?i)\b(?:feat\.?|ft\.?|featuring|with)\s+([^\[\](){}|]+)")
_TAG_VERSION = re.compile(
    r"(?i)\b(live|remix|remaster(?:ed)?|acoustic|unplugged|instrumental|inst\.?|"
    r"radio edit|edit|version|ver\.?|demo|cover|夜|karaoke|mr|official(?: music)? video|"
    r"audio|lyrics?|가사|라이브|리믹스|어쿠스틱|인스트)\b")
_TAG_OST = re.compile(r"(?i)\b(?:ost|original soundtrack|soundtrack|from the .+ soundtrack)\b")
_TAG_BAD_GROUP = re.compile(
    r"(?i)^(?:mv|music video|official|official audio|audio|lyrics?|가사|live video|"
    r"color coded|1080p|720p|4k|hd|uhd|topic|youtube|visualizer|full album)$")


def _tag_unique(values, limit=12):
    out, seen = [], set()
    for value in values or []:
        value = re.sub(r"\s+", " ", str(value or "")).strip(" -–—._")
        if not value:
            continue
        key = _tag_norm(value)
        if not key or key in seen:
            continue
        seen.add(key); out.append(value[:160])
        if len(out) >= limit:
            break
    return out


def _tag_group_is_noise(text):
    z = re.sub(r"\s+", " ", str(text or "")).strip()
    if not z:
        return True
    if _TAG_BAD_GROUP.match(z):
        return True
    if _FN_JUNK.search(z) and not re.search(r"[가-힣A-Za-z]{2,}", z):
        return True
    return bool(re.fullmatch(r"[\d\s._-]{1,10}", z))


def _tag_decompose(name):
    """13.0 · 파일명/사용자 입력을 한국어/외국어 특성에 맞게 상세 구조로 쪼갠다.

    - 한국어/영문 병기 가수(예: '아이유 (IU)', '뉴진스 (NewJeans)', 'BTS (방탄소년단)') 분해
    - 드라마/영화 OST 명칭(예: '[선재 업고 튀어 OST Part 4]')을 앨범 힌트로 분리
    - 유튜브/음원 특유의 잡음([MV], [가사], [교차편집], [킬링보이스], [4K], 1시간 연속듣기 등) 제거
    """
    raw = os.path.basename(str(name or ""))
    stem = os.path.splitext(raw)[0]
    stem = unicodedata.normalize("NFKC", stem).replace("　", " ")
    stem = re.sub(r"\s+", " ", stem).strip()
    original = stem

    # 01. / CD1-02. / 1) 같은 선행 번호는 검색어에서 제거한다.
    stem = _TAG_CD_TRACK.sub("", stem)
    stem = _TAG_TRACK_NO.sub("", stem)
    stem = _TAG_DISC_NO.sub(" ", stem)

    hints, album_hint, feat_artists, bilingual_artists = [], "", [], []

    # 한국어/영어 병기 패턴 추출: "아이유 (IU)", "뉴진스(NewJeans)", "BTS(방탄소년단)"
    for m in re.finditer(r'([가-힣\s]+)\s*\(([a-zA-Z0-9\s\.\-&]{1,40})\)|([a-zA-Z0-9\s\.\-&]{1,40})\s*\(([가-힣\s]{1,40})\)', stem):
        k1, e1, e2, k2 = m.groups()
        kor = (k1 or k2 or "").strip()
        eng = (e1 or e2 or "").strip()
        if kor and eng and not _TAG_VERSION.search(kor) and not _TAG_VERSION.search(eng) and not _TAG_OST.search(kor) and not _TAG_OST.search(eng):
            bilingual_artists.extend([kor, eng, f"{kor} ({eng})", f"{eng} ({kor})"])

    for fm in _TAG_FEAT.finditer(stem):
        if fm.group(1): feat_artists.append(fm.group(1).strip())
    groups = re.findall(r"\[([^\[\]]{1,100})\]|\(([^()]{1,100})\)", stem)
    for a, b in groups:
        g = (a or b).strip()
        gl = g.lower()
        if _TAG_FEAT.search(g):
            m = _TAG_FEAT.search(g)
            if m: feat_artists.append(m.group(1).strip())
            continue
        if _TAG_VERSION.search(g):
            hints.append(g)
            continue
        if _TAG_OST.search(g):
            album_hint = album_hint or g
            hints.append(g)
            continue
        # [BTS] 제목 / 제목 (BTS)처럼 짧고 이름다운 그룹은 가수 후보로 쓴다.
        if a and len(g) <= 64 and not _tag_group_is_noise(g):
            hints.append("artist:" + g)
        elif b and len(g) <= 64 and not _tag_group_is_noise(g):
            hints.append("artist:" + g)

    # 검색용 복사본: 대괄호/괄호 안의 부가 정보는 기본 제목에서 걷는다.
    clean = re.sub(r"\[[^\[\]]{1,100}\]|\([^()]{1,100}\)", " ", stem)
    clean = clean.replace("_", " ").replace("／", "/").replace("｜", "|")
    clean = _TAG_FEAT.sub(" ", clean)
    clean = _FN_JUNK.sub(" ", clean)
    clean = re.sub(r"[|~]+", " - ", clean)
    clean = re.sub(r"\s+", " ", clean).strip(" -–—._")

    # 하이픈 주변 공백이 없어도 분리한다.
    parts = [x.strip() for x in re.split(r"\s+[-–—]\s+", clean) if x.strip()]
    if len(parts) < 2:
        m = re.match(r"^(.{1,64}?)[-–—](.{2,140})$", clean)
        if m and not re.search(r"\b(?:part|pt|vol|version)\b", m.group(1), re.I):
            parts = [m.group(1).strip(), m.group(2).strip()]
    parts = [x for x in parts if x and _tag_norm(x) not in {"topic", "official audio", "official video", "killing voice", "df live"}]

    artist, title = "", ""
    if len(parts) >= 2:
        left, right = parts[0], " - ".join(parts[1:])
        if len(left) > max(8, len(right) * 2.25):
            artist, title = right, left
        else:
            artist, title = left, right
    else:
        title = clean or stem

    bracket_artists = [x[7:] for x in hints if x.startswith("artist:")]
    if not artist and bracket_artists:
        artist = bracket_artists[0]
    if bracket_artists and title:
        title = re.sub(r"\s*\([^()]{1,100}\)\s*", " ", title)
    title = re.sub(r"\s+", " ", title or stem).strip(" -–—._")
    artist = re.sub(r"\s+", " ", artist).strip(" -–—._")

    if feat_artists:
        feat = " & ".join(_tag_unique(feat_artists, 3))
        if artist:
            artist_variants = [artist, artist + " feat. " + feat, artist + " & " + feat]
        else:
            artist_variants = [feat]
    else:
        artist_variants = [artist]
    artist_variants += bracket_artists
    artist_variants += bilingual_artists

    # 버전 없는 제목과 원래 버전 제목을 둘 다 검색한다.
    title_base = re.sub(r"\s*\((?:[^()]*)\)\s*", " ", title)
    title_base = _TAG_VERSION.sub(" ", title_base)
    title_base = re.sub(r"\s+", " ", title_base).strip(" -–—._")
    title_variants = [title, title_base, clean, original]
    if artist and title:
        title_variants += [right for right in parts[1:]]
    if len(parts) >= 2:
        title_variants += parts
        artist_variants += parts

    hints_clean = [h[7:] if h.startswith("artist:") else h for h in hints]
    return {
        "raw": original[:180], "title": title[:160], "artist": artist[:100],
        "album": album_hint[:120], "hints": _tag_unique(hints_clean, 8),
        "title_variants": _tag_unique(title_variants, 12),
        "artist_variants": _tag_unique(artist_variants, 10),
    }


def _tag_tokens(value):
    # 영문/숫자와 한글·한자를 따로 토큰화해 artist/title 일부 일치를 잡는다.
    return set(re.findall(r"[a-z0-9]+|[가-힣]+|[一-龥]+", _tag_norm(value)))


def _tag_cover_ratio(a, b):
    ta, tb = _tag_tokens(a), _tag_tokens(b)
    if not tb:
        return 0.0
    return len(ta & tb) / len(tb)


def _tag_version_words(value):
    return set(x.lower() for x in _TAG_VERSION.findall(str(value or "")))


def _tag_candidate_score(c, title_variants, artist_variants, album, hints, dur):
    """13.0 · 후보 하나의 제목/가수/앨범/버전/길이 및 유명도(인기도)를 종합 평가한다."""
    ct, ca, cal = c.get("title") or "", c.get("artist") or "", c.get("album") or ""
    title_score = max([_sim(ct, x) for x in title_variants if x] or [0.0])
    title_cover = max([_tag_cover_ratio(ct, x) for x in title_variants if x] or [0.0])
    artist_score = max([_sim(ca, x) for x in artist_variants if x] or [0.0])
    artist_cover = max([_tag_cover_ratio(ca, x) for x in artist_variants if x] or [0.0])
    album_score = _sim(cal, album) if album else 0.0

    has_artist = bool(any(str(x).strip() for x in artist_variants))
    if has_artist:
        score = title_score * 0.56 + artist_score * 0.32 + album_score * 0.06
        score += title_cover * 0.04 + artist_cover * 0.02
    else:
        score = title_score * 0.76 + album_score * 0.08 + title_cover * 0.16

    # 유명도 / 인기도 보너스 (Deezer rank 및 iTunes 상위 결과 우선)
    if c.get("rank"):
        score += min(0.08, (float(c["rank"]) / 1000000.0) * 0.08)
    if "rank_pos" in c:
        pos = int(c["rank_pos"])
        if pos == 0: score += 0.06
        elif pos <= 2: score += 0.04
        elif pos <= 5: score += 0.02

    # 고화질 표지 및 메타데이터 풍부성 보너스
    if c.get("art"): score += 0.025
    if c.get("album"): score += 0.015
    if c.get("year"): score += 0.01

    cand_text = _tag_norm(ct + " " + cal)
    hint_words = set()
    for h in hints or []:
        hint_words |= _tag_version_words(h)
    if hint_words:
        cand_versions = _tag_version_words(ct)
        if hint_words & cand_versions:
            score += 0.075
        elif cand_versions and not (hint_words & cand_versions):
            score -= 0.075

    if dur and c.get("dur"):
        try:
            gap = abs(float(c["dur"]) - float(dur))
            if gap <= 3: score += 0.12
            elif gap <= 8: score += 0.06
            elif gap > 30: score -= 0.10
        except Exception:
            pass

    # 정확한 제목+가수 일치 보너스
    if any(_tag_norm(ct) == _tag_norm(x) for x in title_variants if x): score += 0.10
    if has_artist and any(_tag_norm(ca) == _tag_norm(x) for x in artist_variants if x): score += 0.10
    return max(0.0, min(1.0, score))


def _tag_query_plan(meta, title, artist, album):
    """중복을 제거한 검색 질의 순서. 최대 10개로 API 폭주를 막되 한국어/영어 변형을 포괄."""
    tv = _tag_unique([title] + meta.get("title_variants", []), 10)
    av = _tag_unique([artist] + meta.get("artist_variants", []), 8)
    forms = []
    main_t = tv[0] if tv else title
    main_a = av[0] if av else artist
    if main_a and main_t:
        forms += [main_a + " " + main_t, main_t + " " + main_a]
    for a in av[:4]:
        if main_t: forms.append(a + " " + main_t)
    for t in tv[:5]:
        forms.append(t + (" " + main_a if main_a and t != main_t else ""))
    if album and main_t:
        forms.append(main_t + " " + album)
    out=[]; seen=set()
    for q in forms:
        q=re.sub(r"\s+"," ",q).strip()
        k=_tag_norm(q)
        if not k or k in seen: continue
        seen.add(k); out.append(q)
        if len(out)>=10: break
    return out


def _tag_collect(rec, emb, qhint=None, deep=False):
    """상세 분해 질의와 후보 점수로 태그 후보 전체를 수집한다."""
    raw_name = rec.get("orig_title") or rec.get("title") or ""
    meta = _tag_decompose(raw_name)
    ftitle, fartist = meta["title"], meta["artist"]
    q_title = str((emb or {}).get("title") or ftitle or "").strip()
    q_artist = str((emb or {}).get("artist") or fartist or "").strip()
    q_album = str((emb or {}).get("album") or meta.get("album") or "").strip()
    if qhint:
        # 편집창의 값을 우선하되 '가수 - 제목'을 한 칸에 적은 경우도 분해한다.
        hint_meta = _tag_decompose(qhint[0] or "")
        q_title = str(qhint[0] or q_title).strip() or q_title
        q_artist = str(qhint[1] if qhint[1] is not None else q_artist).strip()
        if not q_artist and hint_meta.get("artist"):
            q_artist = hint_meta["artist"]
        meta["title_variants"] = _tag_unique([q_title] + hint_meta.get("title_variants", []) + meta.get("title_variants", []), 12)
        if q_artist:
            # 사용자가 편집창에 따로 적은 가수는 파일명에서 추측한 반대편
            # 토큰보다 우선한다. 그래야 '제목 - 가수' 파일명이 거꾸로
            # 해석돼도 수동 검색어가 정확히 이긴다.
            meta["artist_variants"] = _tag_unique([q_artist] + hint_meta.get("artist_variants", []), 8)
        else:
            meta["artist_variants"] = _tag_unique(meta.get("artist_variants", []) + hint_meta.get("artist_variants", []), 8)
        meta["hints"] = _tag_unique(meta.get("hints", []) + hint_meta.get("hints", []), 10)
    dur = (emb or {}).get("dur")

    title_variants = _tag_unique([q_title] + meta.get("title_variants", []), 12)
    artist_variants = _tag_unique([q_artist] + meta.get("artist_variants", []), 10)
    # feat. 이후를 잘라낸 주가수도 추가하되, feat 가수만 있는 후보를 놓치지 않는다.
    if q_artist:
        primary = re.split(r"(?i)\b(?:feat\.?|ft\.?|with|featuring)\b|&", q_artist)[0].strip()
        artist_variants = _tag_unique([primary] + artist_variants, 10)
    q_title_base = _tag_decompose(q_title).get("title") or q_title
    title_variants = _tag_unique([q_title_base] + title_variants, 12)
    queries = _tag_query_plan(meta, q_title_base, q_artist, q_album)

    scored=[]
    # 정확히 강한 후보가 있어도 최소한 title-only/다른 출처 하나는 확인한다.
    strong=False
    has_artist_hint=bool(artist_variants)
    # 14.10 · 출처×질의를 스레드풀로 동시에 호출한다. 직렬로는 세 출처를
    #  각각 최대 6초씩(국가 4번) 기다려 합 15초 이상 걸렸다. 병렬화로 가장
    #  느린 출처 한 개 시간만큼만 기다리면 된다. 예산도 15→7초로 단축.
    deadline = time.monotonic() + 7

    def _run_one(src, q):
        try:
            return src(q)
        except Exception:
            return []

    pending = set()
    qi_by_fut = {}
    for src in (_src_itunes, _src_deezer, _src_musicbrainz):
        for qi, q in enumerate(queries):
            fut = _TAG_POOL.submit(_run_one, src, q)
            pending.add(fut)
            qi_by_fut[fut] = qi

    while pending and time.monotonic() <= deadline:
        done, pending = wait(pending, timeout=0.35, return_when=FIRST_COMPLETED)
        if not done:
            if strong and not deep:
                break
            continue
        for fut in done:
            qi = qi_by_fut.get(fut, 99)
            try:
                cands = fut.result(timeout=0)
            except Exception:
                cands = []
            for c in cands:
                score = _tag_candidate_score(c, title_variants, artist_variants,
                                              q_album, meta.get("hints"), dur)
                scored.append((score, c))
                if has_artist_hint and score >= 0.995 and qi <= 1:
                    strong = True
        # 일반 자동 태깅은 강한 후보가 잡히면 나머지 질의를 기다리지 않는다.
        if strong and not deep:
            break
    for fut in pending:
        fut.cancel()

    scored.sort(key=lambda u: -u[0])
    return scored, q_title_base, q_artist, dur


def _tag_rank(scored):
    """같은 곡(제목·가수·앨범)이 여러 번 나온 것을 합쳐 점수순 목록으로."""
    out, seen = [], set()
    for s, c in scored:
        k = (_tag_norm(c.get("title")), _tag_norm(c.get("artist")),
             _tag_norm(c.get("album") or ""))
        if k in seen:
            # 같은 곡이면 표지가 있는 쪽 정보를 살려 둔다
            for i, (s0, c0) in enumerate(out):
                k0 = (_tag_norm(c0.get("title")), _tag_norm(c0.get("artist")),
                      _tag_norm(c0.get("album") or ""))
                if k0 == k and not c0.get("art") and c.get("art"):
                    c0["art"] = c["art"]
                    break
            continue
        seen.add(k)
        out.append((s, c))
    return out


def _music_autotag(mid, force=False, algo=None, qhint=None, alt=0,
                   replace_cover=False, fill_only=False):
    """한 곡의 '정보(제목·가수·앨범·연도·장르)'만 자동으로 정리한다.

    리턴: 갱신된 rec (또는 None).
    qhint=(title, artist) — 사용자가 편집창에 적어둔 값. 주어지면 그 값을
    검색어로 쓴다 (수정 뒤 '자동으로 찾기'를 누른 경우).
    alt — 0 이면 가장 잘 맞는 것, 1·2·3… 이면 그 다음 후보.
          (같은 제목·가수의 다른 곡을 눌러서 넘겨 볼 수 있게)
    fill_only — 15.0 · '자동 찾기' 새 동작: 이미 채워진 칸은 절대 덮지
          않고 비어 있는 칸만 채운다. 검색어(qhint·기존 제목/가수)는
          그대로 쓰므로 '기존 정보를 바탕으로' 빈칸을 채우게 된다.

    ＊ 14.11 — '한 번의 사용자 동작 = 한 기능' 원칙.
    표지는 전용 버튼('표지만 찾기' → cover_only)이, 가사는 전용 버튼
    ('가사/싱크 가사' → lyrics_only/synced-lyrics)이 따로 담당한다.
    여기서는 태그 정보만 채우고, 표지·가사·소리 인식·유튜브 등 다른 기능을
    연쇄로 끌어들이지 않는다. (replace_cover 인자는 하위 호환용으로만 유지)
    """
    try:
        with _music_lock:
            m = _music_load()
            rec = dict(m.get(mid) or {})
        if not rec or not rec.get("id"):
            return None
        if rec.get("tag_state") == "manual" and not force:
            return rec
        hits = [fn for fn in os.listdir(MUSIC_DIR)
                if fn.startswith(mid + ".")
                and not fn.endswith((".cover", ".meta.json"))
                and fn.rsplit(".", 1)[-1].lower() in MUSIC_EXTS]
        if not hits:
            # 10.3 · 음원 파일이 없는(사라진) 곡은 이번 알고리즘에서 할 일이 없다 —
            # 표시만 해 두고 넘긴다 (안 그럼 백필이 영원히 재시도한다)
            try:
                with _music_lock:
                    m2 = _music_load()
                    if m2.get(mid):
                        m2[mid]["tag_algo"] = algo or TAG_ALGO
                        _music_save(m2)
            except Exception:
                pass
            return rec
        path = os.path.join(MUSIC_DIR, hits[0])
        emb = _read_embedded(path)
        alt_n = max(0, int(alt or 0))
        gen = _tag_generation_current(mid)
        scored, q_title, q_artist, dur = _tag_collect(rec, emb, qhint,
                                                      deep=(alt_n > 0))
        # 긴 검색 도중 사용자가 저장했으면 이 자동 태깅은 포기한다.
        if gen != _tag_generation_current(mid):
            print(f"[music] 태그 찾기 중단: {mid} (저장 발생)")
            return rec
        ranked = _tag_rank(scored)
        best = ranked[alt_n % len(ranked)] if ranked else None

        # 12.2 · 파일 안 태그가 완전해도 너른 범위로 매칭되면 엉뚱한 곡이 붙던 문제.
        #   임계값을 크게 올려 (제목·가수가 거의 같을 때만 적용) 틀린 태그를 막는다.
        #   qhint(사용자가 편집창에 적어준 검색어)가 있으면 좀 더 너그럽게 본다.
        emb_full = bool(emb["title"] and emb["artist"])
        if qhint and (qhint[0] or qhint[1]):
            thr = 0.66 if emb_full else 0.70
        else:
            thr = 0.72 if emb_full else 0.76
        if alt_n > 0:
            # 사용자가 '다음 후보'를 직접 넘겨 보는 중 → 점수 문턱을 낮춘다
            thr = min(thr, 0.30)
        upd = {"tag_algo": algo or ""}
        if best and best[0] >= thr and best[1]["title"]:
            _, c = best
            if fill_only:
                # 15.0 · 빈칸만 채우기 — 이미 있는 값(편집창 값 qhint 우선)은
                #   그대로 두고, 비어 있는 칸에만 찾은 결과를 넣는다.
                cur_title = (qhint[0] if (qhint and qhint[0]) else "") or rec.get("title") or ""
                cur_artist = (qhint[1] if (qhint and qhint[1]) else "") or rec.get("artist") or ""
                upd.update({
                    "title": (cur_title or c["title"])[:120],
                    "artist": (cur_artist or c["artist"])[:80],
                    "album": (rec.get("album") or c.get("album") or emb["album"] or "")[:120],
                    "year": rec.get("year") or c.get("year") or emb["year"] or "",
                    "genre": (rec.get("genre") or c.get("genre") or emb["genre"] or "")[:40],
                    "tag_src": c.get("src") or "", "tag_state": "done",
                    "tag_tries": 0, "tag_next": 0})
            else:
                upd.update({"title": c["title"][:120], "artist": c["artist"][:80],
                            "album": (c.get("album") or emb["album"] or "")[:120],
                            "year": c.get("year") or emb["year"] or "",
                            "genre": (c.get("genre") or emb["genre"] or "")[:40],
                            "tag_src": c.get("src") or "", "tag_state": "done",
                            "tag_tries": 0, "tag_next": 0})
        else:
            # 못 찾았다: 웹 결과 대신 '파일 안 태그 + 이름 분석'만 반영하고
            # 제목은 함부로 바꾸지 않는다 (수동 편집으로 넘긴다)
            upd.update({"artist": (rec.get("artist") or emb["artist"] or q_artist)[:80],
                        "album": (rec.get("album") or emb["album"] or "")[:120],
                        "year": rec.get("year") or emb["year"] or "",
                        "genre": (rec.get("genre") or emb["genre"] or "")[:40],
                        "tag_src": "", "tag_state": "none"})
            # 11.5 · 못 찾은 곡은 점점 뜸하게 다시 찾는다.
            #  (예전엔 5초마다 영원히 재검색해서 서버가 계속 바빴다)
            _tries = int(rec.get("tag_tries") or 0) + 1
            upd["tag_tries"] = _tries
            upd["tag_next"] = time.time() + min(24 * 3600, 1800 * (2 ** (_tries - 1)))
            if emb["title"] and not (fill_only and (rec.get("title") or (qhint and qhint[0]))):
                # (fill_only 에서는 이미 있는 제목을 파일 태그로 덮지 않는다)
                upd["title"] = emb["title"][:120]
        if not rec.get("orig_title"):
            upd["orig_title"] = rec.get("title") or ""
        with _music_lock:
            m2 = _music_load()
            r2 = m2.get(mid)
            if not r2:
                return rec
            if r2.get("tag_state") == "manual" and not force:
                return r2                     # 그새 수동 편집이 들어왔다
            r2.update(upd)
            m2[mid] = r2
            _music_save(m2)
            rec = dict(r2)
        # 14.11 — 연쇄 제거: 표지(cover_only)·가사(lyrics_only)·소리 인식은
        # 각자의 사용자 동작에서만 실행된다. 여기서는 태그 정보만 남긴다.
        print(f"[music] 태그 정리: {rec.get('title')} / {rec.get('artist')} "
              f"({rec.get('tag_src') or '출처 없음'})")
        return rec
    except Exception as e:
        print(f"[music] 자동 태깅 실패 {mid}: {e}")
        return None


def _music_cover_search(mid, alt=0, qh=None):
    """11.2 · 노래 정보는 그대로 두고 '표지만' 다시 찾아 바꾼다.

    가사·제목·가수는 맞는데 표지만 다른 경우가 잦아서, 표지 후보를
    점수순으로 모아 alt 번째(누를 때마다 다음) 것을 내려받아 적용한다.
    qh=(title, artist) — 편집창에서 버튼을 누른 경우 지금 화면의 검색어.
    반환: {"ok":bool, "cover":bool, "count":int}
    """
    try:
        with _music_lock:
            rec = dict((_music_load().get(mid) or {}))
        if not rec or not rec.get("id"):
            return {"ok": False, "error": "없는 곡입니다"}
        hits = [fn for fn in os.listdir(MUSIC_DIR)
                if fn.startswith(mid + ".")
                and not fn.endswith((".cover", ".meta.json"))
                and fn.rsplit(".", 1)[-1].lower() in MUSIC_EXTS]
        emb = _read_embedded(os.path.join(MUSIC_DIR, hits[0])) if hits else {
            "title": "", "artist": "", "album": "", "year": "", "genre": "", "dur": None}
        # 편집창에 이미 정리된 제목·가수를 그대로 검색어로 (표지만 갈아끼우기)
        # 14.13 · 버튼에서 넘어온 편집창 값(qh)이 있으면 저장된 값보다 우선.
        if not qh:
            qh = (rec.get("title") or "", rec.get("artist") or "")
        scored, _qt, _qa, _dur = _tag_collect(rec, emb, qh, deep=True)
        arts, seen = [], set()
        for sc, c in scored:            # 이미 점수 내림차순
            u = (c.get("art") or "").strip()
            if not u or sc < 0.30:
                continue
            key = re.sub(r"/\d+x\d+", "/", u.split("?")[0])   # 크기만 다른 같은 그림 제거
            if key in seen:
                continue
            seen.add(key)
            arts.append(u)
        if not arts:
            return {"ok": False, "error": "표지를 찾지 못했어요", "count": 0}
        n = max(0, int(alt or 0)) % len(arts)
        # 내려받기 실패하면 다음 후보로 계속
        for k in range(len(arts)):
            b = _fetch_cover(arts[(n + k) % len(arts)])
            if not b:
                continue
            with open(os.path.join(MUSIC_DIR, mid + ".cover"), "wb") as fp:
                fp.write(b)
            with _music_lock:
                m = _music_load()
                if m.get(mid):
                    m[mid]["cover"] = True
                    m[mid]["cover_v"] = int(time.time())
                    _music_save(m)
            return {"ok": True, "cover": True, "count": len(arts)}
        return {"ok": False, "error": "표지를 받지 못했어요", "count": len(arts)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


_BACKFILL = {"active": False}


def _lyr_clean(s):
    """검색용으로 제목을 다듬는다: (Feat. ...) · [MV] · - Remaster 같은 꼬리 제거."""
    t = str(s or "")
    t = re.sub(r"(?i)\((?:[^()]*?)(feat|ft|with|prod|inst|remaster|live|ver|version|"
               r"remix|edit|cover|acoustic|mv|official|audio|한국어|번역|자막)"
               r"(?:[^()]*?)\)", " ", t)
    t = re.sub(r"(?i)\[[^\[\]]{0,42}\]", " ", t)
    t = re.sub(r"(?i)\s*[-–—]\s*(remaster(ed)?|single|album)\b.*$", " ", t)
    t = re.sub(r"(?i)\b(feat|ft)\.?\s+.*$", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip(" -–—·.")
    return t


def _lyrics_ovh(title, artist):
    """lyrics.ovh — 키 없이 쓰는 일반(싱크 없는) 가사 백업 저장소."""
    if not (title and artist):
        return ""
    try:
        r = requests.get("https://api.lyrics.ovh/v1/{}/{}".format(
            requests.utils.quote(str(artist)[:80], safe=""),
            requests.utils.quote(str(title)[:120], safe="")),
            headers=_TAG_UA, timeout=8)
        if r.status_code != 200:
            return ""
        txt = (r.json() or {}).get("lyrics") or ""
        txt = txt.replace("\r\n", "\n").strip()
        # 앞머리에 붙는 안내문 제거
        txt = re.sub(r"(?is)^paroles de la chanson.*?\n", "", txt).strip()
        return txt[:20000] if len(txt) > 12 else ""
    except Exception:
        return ""


def _fetch_lyrics(title, artist, dur=None):
    """13.0 · 가사를 찾는다 (LRCLIB exact get + fuzzy search + lyrics.ovh).

    순서:
      ① LRCLIB exact get (/api/get) — 정확한 제목·가수·길이로 싱크(LRC) 우선 조회
      ② LRCLIB search (/api/search) — 한국어/영어/정리된 제목 등 다양한 질의로 싱크(LRC) 탐색
      ③ 싱크가 없으면 LRCLIB 일반 가사(plain)라도 확보
      ④ 마지막 백업 — lyrics.ovh
    반환: (synced_lrc, plain, 출처) — 못 찾으면 ("", "", "")
    """
    title = (title or "").strip()
    artist = (artist or "").strip()
    if not title:
        return "", "", ""

    def _score(h):
        s = (_sim(h.get("trackName") or "", title) * 0.7
             + _sim(h.get("artistName") or "", artist or (h.get("artistName") or "")) * 0.3)
        if dur and h.get("duration"):
            try:
                diff = abs(float(h["duration"]) - float(dur))
                if diff <= 3: s += 0.22
                elif diff <= 8: s += 0.10
                elif diff > 25: s -= 0.15
            except Exception:
                pass
        return s

    ct = _lyr_clean(title)
    ca = _lyr_clean(artist)

    # 1. LRCLIB exact get 시도
    get_candidates = []
    if title and artist:
        get_candidates.append({"track_name": title, "artist_name": artist})
    if ct and ca and (ct != title or ca != artist):
        get_candidates.append({"track_name": ct, "artist_name": ca})
    if ct and artist and ct != title:
        get_candidates.append({"track_name": ct, "artist_name": artist})
    if title and ca and ca != artist:
        get_candidates.append({"track_name": title, "artist_name": ca})

    best_plain = None
    for p in get_candidates:
        try:
            params = dict(p)
            if dur:
                params["duration"] = str(round(float(dur)))
            r = requests.get("https://lrclib.net/api/get", params=params,
                             headers=_TAG_UA, timeout=6)
            if r.status_code == 200:
                h = r.json() or {}
                syn = (h.get("syncedLyrics") or "").strip()
                pln = (h.get("plainLyrics") or "").strip()
                if syn and "[" in syn:
                    return syn, pln or re.sub(r"\[[^\]]*\]", "", syn).strip(), "LRCLIB"
                elif pln and best_plain is None:
                    best_plain = h
        except Exception:
            pass

    # 2. LRCLIB search 시도
    def _q(params):
        try:
            r = requests.get("https://lrclib.net/api/search", params=params,
                             headers=_TAG_UA, timeout=7)
            hits = r.json() or []
        except Exception:
            return None, None
        bs, bss, bp, bps = None, -1.0, None, -1.0
        for h in hits:
            if not isinstance(h, dict):
                continue
            sc = _score(h)
            syn = (h.get("syncedLyrics") or "").strip()
            pln = (h.get("plainLyrics") or "").strip()
            if syn and "[" in syn and sc > bss:
                bss, bs = sc, h
            if (pln or syn) and sc > bps:
                bps, bp = sc, h
        return (bs if bss >= 0.42 else None), (bp if bps >= 0.42 else None)

    tries = []
    if title and artist:
        tries.append({"track_name": title, "artist_name": artist})
    if ct and ca and (ct != title or ca != artist):
        tries.append({"track_name": ct, "artist_name": ca})
    for sub_a in [re.split(r'\(|\)', artist)[0].strip(), re.split(r'\(|\)', ca)[0].strip()]:
        if sub_a and sub_a != artist and len(sub_a) >= 2:
            tries.append({"track_name": ct or title, "artist_name": sub_a})
    tries.append({"track_name": ct or title})
    tries.append({"q": ((ct or title) + (" " + ca if ca else "")).strip()})

    for params in tries:
        sync_hit, plain_hit = _q(params)
        if sync_hit:
            syn = (sync_hit.get("syncedLyrics") or "").strip()
            pln = (sync_hit.get("plainLyrics") or "").strip()
            return syn, pln or re.sub(r"\[[^\]]*\]", "", syn).strip(), "LRCLIB"
        if plain_hit and best_plain is None:
            best_plain = plain_hit

    if best_plain:
        pln = (best_plain.get("plainLyrics") or "").strip()
        syn = (best_plain.get("syncedLyrics") or "").strip()
        if not pln and syn:
            pln = re.sub(r"\[[^\]]*\]", "", syn).strip()
        if pln:
            return "", pln, "LRCLIB"

    # 3. lyrics.ovh fallback
    for a_, t_ in [(artist, title), (ca, ct), (artist, ct), (ca, title)]:
        if a_ and t_:
            plain = _lyrics_ovh(t_, a_)
            if plain:
                return "", plain, "lyrics.ovh"

    return "", "", ""


def _music_lyrics(mid):
    """한 곡의 가사를 찾아 저장한다 (없으면 시도 횟수만 늘린다)."""
    try:
        with _music_lock:
            rec = dict((_music_load().get(mid) or {}))
        if not rec or not (rec.get("title") or "").strip():
            return
        dur = None
        hits = [fn for fn in os.listdir(MUSIC_DIR)
                if fn.startswith(mid + ".")
                and not fn.endswith((".cover", ".meta.json"))
                and fn.rsplit(".", 1)[-1].lower() in MUSIC_EXTS]
        if hits:
            dur = _read_embedded(os.path.join(MUSIC_DIR, hits[0])).get("dur")
        sync, plain, src = _fetch_lyrics(rec.get("title"), rec.get("artist"), dur)
        with _music_lock:
            m = _music_load()
            r = m.get(mid)
            if not r:
                return
            r["lyrics_tries"] = (r.get("lyrics_tries") or 0) + 1
            r["lyrics_next"] = time.time() + min(24 * 3600,
                                                 1800 * (2 ** min(6, r["lyrics_tries"])))
            had_sync = "[" in (r.get("lyrics") or "")
            if sync:
                # 싱크 가사를 찾았다 — 완성. 더 찾지 않는다.
                r["lyrics"] = sync
                r["lyrics_plain"] = (plain
                                     or re.sub(r"\[[^\]]*\]", "", sync).strip())
                r["lyrics_src"] = src
                r["lyrics_tries"] = 9
            elif plain and not had_sync:
                # 10.9 · 싱크 가사가 없는 노래는 '그냥 가사'라도 찾아서 넣는다
                r["lyrics"] = r.get("lyrics") or ""
                if not (r.get("lyrics_plain") or "").strip():
                    r["lyrics_plain"] = plain
                    r["lyrics_src"] = src
            m[mid] = r
            _music_save(m)
    except Exception:
        pass


def _music_backfill():
    """13.0 · 로컬 음원 백그라운드 자동 정리.
    사용자가 유휴(Idle) 상태일 때 적극적으로 처리하여 태그·가사·표지·지문인식을 완벽히 수행한다.
    """
    time.sleep(8)
    _last_clean = 0
    while True:
        try:
            now = time.time()
            if now - _last_clean > 900:
                _cleanup_old_temp_files()
                _last_clean = now

            with _music_lock:
                m = _music_load()
                # 빈칸이 있는 곡 검사 (태그 빈칸, 미정리, 가사 없음, 표지 없음)
                retag = [mid for mid, r in m.items()
                         if r.get("tag_state") != "manual"
                         and (r.get("tag_algo") != TAG_ALGO
                              or not r.get("tag_state")
                              or r.get("tag_state") == "pending"
                              or not (r.get("artist") and r.get("album")))]
                retry = [mid for mid, r in m.items()
                         if mid not in retag and r.get("tag_state") == "none"
                         and float(r.get("tag_next") or 0) <= now
                         and int(r.get("tag_tries") or 0) < 8]
                nolyr = [mid for mid, r in m.items()
                         if mid not in retag and mid not in retry
                         and not ((r.get("lyrics") or "") or (r.get("lyrics_plain") or ""))
                         and (r.get("lyrics_tries") or 0) < 5
                         and float(r.get("lyrics_next") or 0) <= now]
                nosync = [mid for mid, r in m.items()
                          if mid not in retag and mid not in retry and mid not in nolyr
                          and "[" not in (r.get("lyrics") or "")
                          and (r.get("lyrics_plain") or "").strip()
                          and (r.get("lyrics_tries") or 0) < 4
                          and float(r.get("lyrics_next") or 0) <= now]
                nocov = [mid for mid, r in m.items()
                         if mid not in retag and mid not in retry and mid not in nolyr
                         and not r.get("cover") and not r.get("cover_url")]
            nolyr = nolyr + nosync
            todo = retag + retry + nolyr + nocov
            if not todo:
                _BACKFILL["active"] = False
                time.sleep(15 if is_server_idle() else 45)
                continue
            _BACKFILL["active"] = True

            idle = is_server_idle()
            batch_size = 12 if idle else 3
            sleep_gap = 0.9 if idle else 2.5

            print(f"[music] 로컬 백필 (idle={idle}): 재태깅 {len(retag)} · 재시도 {len(retry)} · 가사 {len(nolyr)} · 표지 {len(nocov)}")
            if _fp_bin() and _aco_key():
                try:
                    with _music_lock:
                        m2 = _music_load()
                        recog = [mid for mid, r in m2.items()
                                 if r.get("tag_state") == "none"
                                 and not r.get("recog_tried")][: (8 if idle else 2)]
                    for mid in recog:
                        _music_recognize(mid, apply_tags=True)
                        time.sleep(sleep_gap)
                except Exception:
                    pass
            # 기존 주어진 정보는 냅두고 빈칸만 딱 골라서 채운다 (fill_only=True)
            work_items = ([("tag", x) for x in retag + retry]
                          + [("lyr", x) for x in nolyr]
                          + [("cover", x) for x in nocov])[:batch_size]
            for kind, mid in work_items:
                try:
                    if kind == "tag":
                        _music_autotag(mid, force=False, algo=TAG_ALGO, fill_only=True)
                    elif kind == "cover":
                        _music_cover_search(mid)
                    else:
                        _music_lyrics(mid)
                except Exception:
                    pass
                time.sleep(sleep_gap)
            time.sleep(10 if idle else 45)
        except Exception as e:
            print(f"[music] 백필 오류: {e}")
            time.sleep(45)


threading.Thread(target=_music_backfill, daemon=True).start()


def _music_boot_check():
    """11.4 · 서버가 켜질 때 목록과 실제 파일, 유튜브 쿠키가 어긋나 있으면 조용히 맞춘다."""
    try:
        time.sleep(3)
        _yt_cookies_restore_if_needed()
        with _music_lock:
            n = len(_music_load())
        added, total = _music_rebuild()
        if added or not n:
            print(f"[music] 시작 점검: 목록 {n}곡 → {total}곡 (복구 {added})")
    except Exception:
        pass


threading.Thread(target=_music_boot_check, daemon=True).start()


# 16.2 · 로그인(이메일 OTP) 사용자 확인 — 곡에 "누가 올렸는지" 표시를 붙인다.
#   브라우저가 x-sdy-auth 헤더로 세션 토큰을 실어 보내면 Node 가 신원을
#   답해 준다(/internal/whoami, loopback 전용). 곡마다 물어보지 않게 5분 캐시.
_SDY_AUTH_TTL = 300
_sdy_auth_cache = {}


def _sdy_auth_user():
    """x-sdy-auth 토큰 → {"uid","nick"} 또는 None (비회원)."""
    tok = (request.headers.get("x-sdy-auth") or "").strip()
    if not tok:
        return None
    now = time.time()
    hit = _sdy_auth_cache.get(tok)
    if hit and hit[0] > now:
        return hit[1]
    user = None
    try:
        r = requests_post_internal("/internal/whoami", {"token": tok})
        user = r.get("user") if r.get("ok") else None
    except Exception:
        user = None
    _sdy_auth_cache[tok] = (now + _SDY_AUTH_TTL, user)
    return user


def _sdy_auth_fields():
    """곡 레코드에 심을 업로더 필드 (비회원이면 빈 딕셔너리)."""
    u = _sdy_auth_user()
    if not u:
        return {}
    return {"uploader": str(u.get("nick") or "")[:24],
            "uploader_uid": str(u.get("uid") or "")[:40]}


def _music_upload_pipeline(mid):
    """업로드 직후 정리 흐름 (로컬 모드):
    1) 소리(음성) 인식(AcoustID)을 먼저 수행
    2) 인식 성공 시 그 결과를 기반으로 태그 검색, 실패 시 처음 올린 주어진 제목을 바탕으로 태그 검색
    3) 태그 검색 후 라이브 가사 -> 앨범 표지를 순차적으로 검색"""
    recog_ok = False
    try:
        res = _music_recognize(mid, apply_tags=True)
        if (res or {}).get("duplicate_removed"):
            return
        recog_ok = bool((res or {}).get("ok"))
    except Exception as e:
        print("[music] 업로드 소리 인식 오류:", e)

    try:
        _music_autotag(mid, force=recog_ok, algo=TAG_ALGO)
    except Exception as e:
        print("[music] 업로드 태그 검색 오류:", e)

    try:
        _music_lyrics(mid)
    except Exception as e:
        print("[music] 업로드 가사 검색 오류:", e)

    try:
        _music_cover_search(mid)
    except Exception as e:
        print("[music] 업로드 표지 검색 오류:", e)


@app.route("/api/music/upload", methods=["POST"])
def music_upload():
    """누구나 올릴 수 있다. 파일당 50MB 이하."""
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "파일이 없습니다"}), 400
    ext = (f.filename.rsplit(".", 1)[-1] if "." in f.filename else "").lower()
    if ext not in MUSIC_EXTS:
        return jsonify({"ok": False,
                        "error": "지원 형식: mp3·flac·m4a·aac·ogg·opus·wav·webm"}), 400
    data = f.read()
    if len(data) > MUSIC_MAX_MB * 1024 * 1024:
        return jsonify({"ok": False, "error": "50MB 이하만 올릴 수 있어요"}), 400
    mid = uuid.uuid4().hex[:12]
    title = os.path.splitext(f.filename)[0].strip() or mid
    path = os.path.join(MUSIC_DIR, f"{mid}.{ext}")
    with open(path, "wb") as fp:
        fp.write(data)
    # 내장 커버 추출 (mutagen 있으면)
    has_cover = False
    try:
        from mutagen import File as MFile
        mf = MFile(path)
        pic = None
        if mf is not None:
            if getattr(mf, "pictures", None):
                pic = mf.pictures[0].data
            elif mf.tags is not None and getattr(mf.tags, "getall", None):
                ap = mf.tags.getall("APIC")
                if ap:
                    pic = ap[0].data
        if pic:
            with open(os.path.join(MUSIC_DIR, f"{mid}.cover"), "wb") as fp:
                fp.write(pic)
            has_cover = True
    except Exception:
        pass
    # 10.1 · 파일 안 태그를 초기값으로 심고, 웹 자동 태깅을 백그라운드로 돌린다.
    #   (제목·가수·앨범·연도·장르·표지를 찾아 정리 — 끝나면 목록에 자동 반영)
    try:
        emb = _read_embedded(path)
    except Exception:
        emb = {}
    rec = {"id": mid, "title": (emb.get("title") or title)[:120], "ext": ext,
           "bytes": len(data), "cover": has_cover,
           "artist": (emb.get("artist") or "")[:80],
           "album": (emb.get("album") or "")[:120],
           "year": emb.get("year") or "", "genre": (emb.get("genre") or "")[:40],
           "orig_title": title[:120],
           "tag_state": "pending", "tag_src": "",
           "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
           **_sdy_auth_fields()}
    with _music_lock:
        m = _music_load()
        m[mid] = rec
        _music_save(m)
    _upload_log(mid, ext, f.filename)      # 11.5 · 되살릴 때 쓸 '원래 파일 이름'
    # 14.9 · 소리 인식(AcoustID)을 먼저, 실패하면 자동검색 폴백
    threading.Thread(target=_music_upload_pipeline, args=(mid,), daemon=True).start()
    print(f"[music] 업로드 {title} ({len(data)/1024/1024:.1f}MB)")
    return jsonify({"ok": True, **rec})


# ============ 12.5 · 유튜브 링크 → 원본 음원 그대로 추가 (재인코딩 안 함) ============
#  유튜브(뮤직·Shorts·youtu.be 포함) 링크를 붙여넣으면 yt-dlp 가
#  원본 음원(m4a/webm)을 그대로 받아 음악 목록에 넣는다.
#  재인코딩을 안 해서 수 분 곡도 수 초~수십 초면 끝나고, 음질 손실도 없다.
#  제목·가수·표지는 info.json/썸네일로 자동 채운다.
#  준비물: yt-dlp (apply.sh 가 최신으로 깔아 줌). ffmpeg 는 이제 필요 없다.


def _convert_to_netscape_cookies(raw_text_or_bytes):
    """13.0 · JSON, Netscape, HTTP 헤더 등 어떤 쿠키 포맷이든 yt-dlp 표준 Netscape 로 변환하고
    유효기간 만료로 yt-dlp 가 쿠키를 버리지 않도록 1년 뒤로 갱신 보존한다.
    """
    if isinstance(raw_text_or_bytes, bytes):
        txt = raw_text_or_bytes.decode('utf-8', errors='ignore')
    else:
        txt = str(raw_text_or_bytes or '')
    txt = txt.strip()
    if not txt:
        return ""
    now = int(time.time())
    one_year = now + 365 * 24 * 3600

    # JSON 포맷 지원 (Cookie-Editor, EditThisCookie 등)
    if txt.startswith('[') and txt.endswith(']'):
        try:
            arr = json.loads(txt)
            if isinstance(arr, list):
                lines = ["# Netscape HTTP Cookie File", "# https://curl.haxx.se/rfc/cookie_spec.html", ""]
                for c in arr:
                    if not isinstance(c, dict): continue
                    domain = str(c.get("domain") or ".youtube.com").strip()
                    if not domain.startswith('.') and not domain.startswith('http'):
                        domain = '.' + domain
                    include_sub = "TRUE" if domain.startswith('.') else "FALSE"
                    path = str(c.get("path") or "/")
                    secure = "TRUE" if c.get("secure", True) else "FALSE"
                    exp = int(c.get("expirationDate") or c.get("expiry") or one_year)
                    if exp < now + 86400:
                        exp = one_year
                    name = str(c.get("name") or "").strip()
                    val = str(c.get("value") or "").strip()
                    if name:
                        lines.append(f"{domain}\t{include_sub}\t{path}\t{secure}\t{exp}\t{name}\t{val}")
                return "\n".join(lines)
        except Exception:
            pass

    # Netscape 또는 일반 텍스트 포맷
    lines = []
    has_header = False
    for line in txt.splitlines():
        line_s = line.strip()
        if not line_s: continue
        if line_s.startswith("# Netscape"):
            has_header = True
            lines.append(line_s)
            continue
        if line_s.startswith("#"):
            lines.append(line_s)
            continue
        parts = line.split("\t")
        if len(parts) >= 7:
            try:
                exp_val = int(parts[4])
                if exp_val < now + 86400:
                    parts[4] = str(one_year)
                lines.append("\t".join(parts))
            except Exception:
                lines.append(line)
        else:
            lines.append(line)

    if not has_header:
        lines.insert(0, "# Netscape HTTP Cookie File")
        lines.insert(1, "# https://curl.haxx.se/rfc/cookie_spec.html")
        lines.insert(2, "")
    return "\n".join(lines)


def _yt_cookies_restore_if_needed():
    """쿠키 파일이 비었거나 손상되었을 때 백업 또는 Supabase 에서 자동 복구."""
    try:
        cur_size = os.path.getsize(YT_COOKIES_FILE) if os.path.isfile(YT_COOKIES_FILE) else 0
        if cur_size < 50:
            if os.path.isfile(YT_COOKIES_BAK) and os.path.getsize(YT_COOKIES_BAK) >= 50:
                shutil.copyfile(YT_COOKIES_BAK, YT_COOKIES_FILE)
                print("[youtube] 쿠키 파일 백업본에서 자동 복구 완료")
            elif _sb_enabled():
                d = _sb_get(SYNC_TABLE, "yt_cookies")
                if isinstance(d, dict) and d.get("cookies"):
                    with open(YT_COOKIES_FILE, "w", encoding="utf-8") as fp:
                        fp.write(d["cookies"])
                    with open(YT_COOKIES_BAK, "w", encoding="utf-8") as fp:
                        fp.write(d["cookies"])
                    print("[youtube] 쿠키 파일 Supabase 클라우드에서 자동 복구 완료")
    except Exception as e:
        pass


def _find_ytdlp():
    """yt-dlp 실행 방법을 찾는다: (실행파일 경로) 또는 "module".

    apply.sh 가 yt-dlp 를 venv(=앱이 도는 파이썬) 안에 깔아 주기 때문에,
    systemd 서비스의 PATH 에 없어도 반드시 찾을 수 있어야 한다.
    순서: ① PATH(글로벌 설치) → ② 이 앱의 파이썬(venv) 옆 bin →
          ③ yt_dlp 파이썬 모듈(python -m yt_dlp).
    """
    p = shutil.which("yt-dlp")
    if p:
        return p
    venv_bin = os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "yt-dlp")
    if os.path.isfile(venv_bin) and os.access(venv_bin, os.X_OK):
        return venv_bin
    try:
        import importlib.util
        if importlib.util.find_spec("yt_dlp") is not None:
            return "module"
    except Exception:
        pass
    return None


def _ytdlp_cmd():
    """yt-dlp 를 실제로 부를 명령(리스트)로 만든다."""
    loc = _find_ytdlp()
    if loc == "module":
        return [sys.executable, "-m", "yt_dlp"]
    return [loc]


def _yt_tools():
    """yt-dlp 가 있는지. (12.5 부터 ffmpeg 재인코딩을 안 해서 ffmpeg 불필요)"""
    ytdl = _find_ytdlp()
    return {"ok": bool(ytdl), "ytdl": bool(ytdl),
            "missing": [] if ytdl else ["yt-dlp"]}


def _yt_err_line(stderr_bytes):
    """yt-dlp stderr 에서 사람이 읽을 수 있는 마지막 에러 한 줄을 뽑는다."""
    txt = (stderr_bytes or b"").decode("utf-8", "ignore")
    lines = [l.strip() for l in txt.splitlines() if l.strip()]
    for line in reversed(lines):
        if "ERROR" in line or "HTTP Error" in line:
            return line[:180]
    return lines[-1][:180] if lines else ""


def _yt_cookies_path():
    """유튜브 로그인 쿠키 파일이 있으면 경로를 돌려준다 (손실 시 자동 복구)."""
    _yt_cookies_restore_if_needed()
    if os.path.isfile(YT_COOKIES_FILE) and os.path.getsize(YT_COOKIES_FILE) > 50:
        return YT_COOKIES_FILE
    return None


def _yt_cookie_looks_valid(txt):
    """쿠키 파일에 유튜브 로그인 쿠키가 실제로 들어 있는지 확인한다.

    14.9 · 예전엔 파일 앞 8KB 만 훑어서, 큰 내보내기 파일은 로그인 쿠키가
    뒤쪽에 있으면 '이상한 파일'로 오인했다. 전체를 훑어 판정한다.
    """
    if not txt or "youtube.com" not in txt:
        return False
    for marker in ("\t__Secure-1PSID\t", "\t__Secure-3PSID\t", "\tSID\t",
                   "\tHSID\t", "\tSSID\t", "\tSAPISID\t",
                   "__Secure-1PSID=", "HSID=", "SID="):
        if marker in txt:
            return True
    return False


# 12.5 · 작동하는 조합 = 쿠키 + PO 토큰 공급기(bgutil/deno).
#   서버 IP가 클라우드(특히 Oracle)로 강하게 찍혀 있으면 쿠키만으로는
#   "Sign in to confirm you're not a bot" 을 못 뚫어서, deno PO 토큰도 함께 쓴다.
#   deno/bgutil 이 없으면 쿠키만으로 시도하고, 클라이언트는 3개만 순회한다.
# 13.0 · mweb, android, ios, tv 순서로 시도하여 구글의 웹 브라우저 지문 검사 및 쿠키 강제 만료(세션 파기)를 원천 방지
_YT_CLIENTS = ["mweb", "android", "ios", "tv", "web_creator", "web"]


def _js_runtime():
    """12.5 · 봇검사(JS 챌린지) 솔버용 deno 경로. 없으면 None."""
    home = os.path.expanduser("~")
    for p in (os.path.join(home, ".deno", "bin", "deno"), shutil.which("deno")):
        if p and os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def _pot_server_home():
    """12.5 · bgutil PO 토큰 공급기 서버 소스 경로 (apply.sh 가 깔아 둔 것)."""
    for base in (os.path.expanduser("~"), BASE_DIR):
        p = os.path.join(base, "bgutil-ytdlp-pot-provider", "server")
        if os.path.isfile(os.path.join(p, "src", "generate_once.ts")):
            return p
    return None


def _yt_env():
    """deno 가 '삭제된 cwd' 에서 죽지 않도록 HOME/PATH 보정."""
    env = os.environ.copy()
    env.setdefault("HOME", os.path.expanduser("~"))
    deno = _js_runtime()
    if deno:
        deno_dir = os.path.dirname(deno)
        env["PATH"] = env.get("PATH", "") + os.pathsep + deno_dir
        env.setdefault("DENO_DIR", os.path.join(env["HOME"], ".cache", "deno"))
    return env


def _yt_extractor_args(client):
    """12.5 · youtube 추출기 인자 (player_client 만 지정).

    14.10 · fetch_pot=always 를 강제하지 않는다. PO 토큰 공급기(bgutil/deno)가
    한 번만 삐끗해도 "Unable to fetch ... PO Token" 경고와 함께 토큰이 필요한
    포맷이 전부 빠져 "No video formats found!" 로 다운로드가 통째로 실패했다.
    기본(auto)은 유튜브가 정말 요구할 때만 토큰을 받으므로 훨씬 안전하다.
    """
    return "player_client=" + client


def _yt_client_args(client):
    return ["--extractor-args", "youtube:" + _yt_extractor_args(client)]


def _yt_base_args(ck_path=None, use_cookies=True):
    args = ["--no-playlist", "--no-warnings", "--no-progress",
            "--socket-timeout", "30", "--retries", "2",
            "--fragment-retries", "3"]
    # 12.5 · deno/PO 토큰 공급자가 있으면 함께 쓴다
    deno = _js_runtime()
    if deno:
        args += ["--js-runtimes", "deno:" + deno,
                 "--remote-components", "ejs:github"]
    pot = _pot_server_home()
    if pot and deno:
        args += ["--extractor-args",
                 "youtubepot-bgutilscript:server_home=" + pot]
    if use_cookies:
        ck = ck_path if ck_path is not None else _yt_cookies_path()
        if ck:
            args += ["--cookies", ck]
    return args


def _yt_common_args():
    """-J(메타데이터)용: 기본 클라이언트 + PO 토큰."""
    return _yt_base_args() + _yt_client_args("web")


_YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?[^#]*v=|shorts/|embed/|live/)|youtu\.be/|"
    r"music\.youtube\.com/watch\?[^#]*v=)([0-9A-Za-z_-]{11})")


def _yt_url_id(url):
    m = _YOUTUBE_ID_RE.search(url or "")
    return m.group(1) if m else None


def _yt_fetch_audio(url, tmpdir, info_path=None):
    """yt-dlp 로 유튜브 원본 음원을 그대로 받는다 (재인코딩 안 함 → 빠름).

    12.5 · 쿠키 + PO 토큰(deno/bgutil)로 봇검사를 뚫는다.
    클라이언트마다 지원하는 포맷이 달라서, 클라이언트를 바꿔가며
    m4a → webm → bestaudio 순으로 시도한다. info_path 가 주어지면
    메타데이터 JSON 도 함께 저장한다.
    반환: (audio경로, ext, None) / (None, None, 에러)
    """
    ytdl = _ytdlp_cmd()
    out_tpl = os.path.join(tmpdir, "%(id)s.%(ext)s")
    ck_master = _yt_cookies_path()
    ck_work = None
    if ck_master:
        ck_work = os.path.join(tmpdir, "work_cookies.txt")
        try:
            shutil.copyfile(ck_master, ck_work)
        except Exception:
            ck_work = ck_master

    cmd_base = ["-x", "--audio-multistreams",
                "--no-mtime", "--no-playlist", "--no-warnings", "--no-progress",
                "--no-part",
                "-o", out_tpl]
    if info_path:
        cmd_base += ["--write-info-json", "--no-write-playlist-metafiles"]

    # 클라이언트마다 포맷 가용성이 다르다. web 은 m4a(140)·webm(251),
    # android_vr 은 구 포맷만, ios 는 HLS 쪽이라 너그럽게 bestaudio 까지 폴백.
    # 14.10 · 최신 yt-dlp 는 클라이언트를 강제하지 않는 '기본 자동 선택'이
    #  가장 잘 붙는다(visionos 등). 강제 클라이언트(mweb/ios/tv 등)는 GVS
    #  PO 토큰 요구에 걸려 "Unable to fetch ... PO Token" → "No video formats
    #  found!" 로 전부 실패하기 쉬우므로, 기본 선택을 먼저 시도하고 실패하면
    #  명시 클라이언트로 폴백한다. (None = 기본 자동 선택)
    clients = [None] + list(_YT_CLIENTS)
    fmt_sets = [
        ["-f", "bestaudio[ext=m4a]/140/bestaudio[ext=webm]/251/bestaudio"],
        ["-f", "bestaudio/best"],
    ]

    last_err = "음원을 받지 못했습니다"
    dead = False

    def one_pass(use_cookies):
        nonlocal last_err, dead
        # 이전 시도의 찌꺼기(부분 다운로드)를 비워 성공 오판을 막는다
        for fn in list(os.listdir(tmpdir)):
            if fn.lower().endswith((".m4a", ".webm", ".mp3", ".opus", ".aac", ".info.json")):
                try:
                    os.remove(os.path.join(tmpdir, fn))
                except Exception:
                    pass
        for client in clients:
            if dead:
                return None
            for fmt in fmt_sets:
                client_args = _yt_client_args(client) if client else []
                try:
                    r = subprocess.run(
                        ytdl + cmd_base + fmt
                        + _yt_base_args(ck_path=ck_work, use_cookies=use_cookies)
                        + client_args + [url],
                        capture_output=True, timeout=600,
                        cwd=BASE_DIR, env=_yt_env())
                except subprocess.TimeoutExpired:
                    last_err = "시간이 너무 오래 걸렸습니다 (10분 초과)"
                    continue
                err = _yt_err_line(r.stderr)
                if err:
                    last_err = err
                if r.stderr and b"ERROR" in r.stderr:
                    print(f"[youtube] 시도 실패 ({client or 'default'}, cookies={use_cookies}): "
                          + (r.stderr or b"").decode("utf-8", "ignore").strip()[:800])
                audio = None
                for fn in os.listdir(tmpdir):
                    low = fn.lower()
                    if low.endswith((".m4a", ".webm", ".mp3", ".opus", ".aac")):
                        p = os.path.join(tmpdir, fn)
                        if audio is None or os.path.getsize(p) > os.path.getsize(audio):
                            audio = p
                if audio and os.path.getsize(audio) >= 4096:
                    ext = audio.rsplit(".", 1)[-1].lower()
                    if info_path:
                        for fn in os.listdir(tmpdir):
                            if fn.endswith(".info.json"):
                                try:
                                    src = os.path.join(tmpdir, fn)
                                    with open(src, "rb") as fr, open(info_path, "wb") as fw:
                                        fw.write(fr.read())
                                    os.remove(src)
                                except Exception:
                                    pass
                                break
                    print(f"[youtube] 성공 — 클라이언트={client or 'default'} cookies={use_cookies} ext={ext}")
                    return audio, ext
            # 이 영상 자체가 없는 경우엔 어떤 클라이언트도 소용없다 → 중단
            low = (last_err or "").lower()
            if any(s in low for s in ("video unavailable", "this video is unavailable",
                                     "video has been removed", "private video",
                                     "drm", "does not exist",
                                     "live stream recording is not available")):
                dead = True
                return None
        return None

    # 1차: 등록된 쿠키로 시도 (연령제한·멤버십 영상에 필요)
    if ck_master:
        got = one_pass(use_cookies=True)
        if got:
            return got[0], got[1], None
        # 14.9 · 유튜브가 세션을 태워 버려(쿠키 무효화) 쿠키로 막혔어도,
        #  일반 영상은 쿠키 없이도 받을 수 있다. 쿠키가 타버린 뒤에도
        #  다운로드가 완전히 멈추지 않게 쿠키 없이 한 번 더 전체를 돌린다.
        got = one_pass(use_cookies=False)
        if got:
            return got[0], got[1], None
    else:
        got = one_pass(use_cookies=False)
        if got:
            return got[0], got[1], None

    # 사람이 읽을 수 있는 최종 에러로 다듬는다
    low = (last_err or "").lower()
    if any(s in low for s in ("sign in to confirm", "confirm you're not a bot",
                              "sign in to confirm you’re not a bot")):
        last_err = ("유튜브가 이 서버를 봇으로 판단해 차단했습니다. "
                    "쿠키를 새로 내보내 다시 등록하면 잠시 풀리지만, "
                    "데이터센터 IP 에서는 시간이 지나면 다시 막힐 수 있습니다.")
    return None, None, last_err


def _yt_add(url):
    """유튜브 URL 하나를 mp3 320kbps 로 받아 음악 목록에 추가한다.

    반환: {"ok": True, "track": {...}} 또는 {"ok": False, "error": str}
    """
    url = (url or "").strip()
    if not re.match(r"https?://", url, re.I):
        return {"ok": False, "error": "http(s) 링크를 붙여넣어 주세요"}
    tools = _yt_tools()
    if not tools["ok"]:
        print(f"[youtube] 도구 없음: {', '.join(tools['missing'])}")
        return {"ok": False,
                "error": "서버에 음원 추출 도구(%s)가 없습니다. "
                         "apply.sh 를 다시 실행해 주세요" % ", ".join(tools["missing"])}

    vid = _yt_url_id(url)
    if not vid:
        return {"ok": False, "error": "유튜브 링크가 아닌 것 같습니다 — 링크를 확인해 주세요"}

    tmpdir = tempfile.mkdtemp(prefix="sdyyt_")
    info_path = os.path.join(tmpdir, "info.json")
    try:
        # 12.5 · 다운로드와 동시에 메타데이터를 파일로 받는다.
        #   원본 음원을 재인코딩 없이 그대로 받아 수 초~수십 초 단축.
        audio, ext, err = _yt_fetch_audio(url, tmpdir, info_path=info_path)
        info = {}
        try:
            if os.path.isfile(info_path) and os.path.getsize(info_path) > 50:
                with open(info_path, encoding="utf-8") as fp:
                    info = json.load(fp)
                if not isinstance(info, dict):
                    info = {}
        except Exception as e:
            print(f"[youtube] 메타데이터 읽기 실패: {e}")
        if not info.get("id"):
            info["id"] = vid
        if not audio:
            return {"ok": False, "error": err or "음원을 받지 못했습니다"}

        ext = (ext or "m4a").lower()
        if ext not in MUSIC_EXTS:
            ext = "m4a"
        mid = uuid.uuid4().hex[:12]
        final = os.path.join(MUSIC_DIR, f"{mid}.{ext}")
        shutil.move(audio, final)
        size = os.path.getsize(final)

        # 3) 제목·가수 정리 — "가수 - 제목" 꼴이면 분리, 없으면 업로더(채널)를 가수로
        # 12.0 · 메타데이터가 실패해도 곡은 저장한다 — 그때는 제목을 영상ID로 표시
        vtitle = str(info.get("title") or "").strip() or ("유튜브 곡 " + info.get("id", vid))
        t2, a2 = _parse_filename(vtitle)
        title = (t2 or vtitle)[:120]
        artist = (a2 or str(info.get("uploader") or info.get("channel") or "")).strip()[:80]

        # 4) 표지 — 썸네일을 받아 jpg 로 저장 (앱의 .cover 형식)
        has_cover = False
        thumb = str(info.get("thumbnail") or "").strip()
        if thumb.startswith("http"):
            try:
                r = requests.get(thumb, headers=_TAG_UA, timeout=12)
                if r.status_code == 200 and len(r.content) > 512:
                    im = Image.open(io.BytesIO(r.content))
                    im = im.convert("RGB")
                    im.thumbnail((1000, 1000))
                    buf = io.BytesIO()
                    im.save(buf, "JPEG", quality=88)
                    with open(os.path.join(MUSIC_DIR, f"{mid}.cover"), "wb") as fp:
                        fp.write(buf.getvalue())
                    has_cover = True
            except Exception:
                pass

        rec = {"id": mid, "title": title, "ext": ext,
               "bytes": size, "cover": has_cover,
               "artist": artist,
               "album": str(info.get("album") or "")[:120],
               "year": (str(info.get("release_date") or "")[:4]
                        if info.get("release_date") else ""),
               "genre": str(info.get("genre") or "")[:40],
               "orig_title": vtitle[:120],
               "tag_state": "done", "tag_src": "YouTube",
               "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
               **_sdy_auth_fields()}
        with _music_lock:
            m = _music_load()
            m[mid] = rec
            _music_save(m)
            m2 = _music_load()          # 저장이 정말 됐는지 되읽어 확인
        _upload_log(mid, "mp3", vtitle)
        if mid not in m2 or not os.path.exists(final):
            return {"ok": False, "error": "음원 저장을 확인하지 못했습니다 (다시 시도해 주세요)"}
        # 가사는 백그라운드에서 찾아 둔다 (백필이 자동으로 돌지만 바로 한 번)
        threading.Thread(target=_music_lyrics, args=(mid,), daemon=True).start()
        print(f"[youtube] 추가 {title} / {artist} ({size/1024/1024:.1f}MB · {ext})")
        return {"ok": True, "track": rec}
    finally:
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


@app.route("/api/music/youtube/status", methods=["GET"])
def music_youtube_status():
    """유튜브 음원 추출 준비 상태 (yt-dlp·쿠키·deno·PO토큰)."""
    st = _yt_tools()
    ck = _yt_cookies_path()
    st["cookies"] = bool(ck)
    if ck:
        try:
            # 쿠키 파일 안에 실제 인증 쿠키(SID/HSID)가 있는지 전체를 확인
            with open(ck, "r", encoding="utf-8", errors="ignore") as fp:
                head = fp.read()
            st["cookies_valid"] = _yt_cookie_looks_valid(head)
        except Exception:
            st["cookies_valid"] = False
    else:
        st["cookies_valid"] = False
    st["deno"] = bool(_js_runtime())
    st["pot"] = bool(_pot_server_home())
    return jsonify(st)


@app.route("/api/music/youtube/cookies", methods=["POST", "DELETE"])
def music_youtube_cookies():
    """13.0 · 유튜브 로그인 쿠키 업로드/삭제 (관리자).
    Netscape .txt 및 JSON 형식을 모두 지원하며, 만료시간 보정 및 Supabase 영구 백업을 적용합니다.
    """
    if not _require_admin():
        return jsonify({"ok": False, "error": "관리자 인증이 필요합니다"}), 403
    if request.method == "DELETE":
        try:
            if os.path.exists(YT_COOKIES_FILE):
                os.remove(YT_COOKIES_FILE)
            if os.path.exists(YT_COOKIES_BAK):
                os.remove(YT_COOKIES_BAK)
            if _sb_enabled():
                try: _sb_put(SYNC_TABLE, "yt_cookies", {"cookies": "", "deleted_at": time.time()})
                except Exception: pass
        except Exception:
            pass
        return jsonify({"ok": True, "cookies": False})
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "쿠키 파일(.txt/.json)이 없습니다"}), 400
    raw_data = f.read()
    if len(raw_data) > 1024 * 1024:
        return jsonify({"ok": False, "error": "쿠키 파일이 너무 큽니다"}), 400

    sanitized_txt = _convert_to_netscape_cookies(raw_data)
    if "youtube.com" not in sanitized_txt and "google.com" not in sanitized_txt:
        return jsonify({"ok": False,
                        "error": "유튜브 쿠키 파일 형식이 아닙니다 — youtube.com 에서 내보낸 "
                                 "쿠키(.txt 또는 .json)를 올려 주세요"}), 400

    with open(YT_COOKIES_FILE, "w", encoding="utf-8") as fp:
        fp.write(sanitized_txt)
    try:
        with open(YT_COOKIES_BAK, "w", encoding="utf-8") as fp:
            fp.write(sanitized_txt)
    except Exception:
        pass

    if _sb_enabled():
        try:
            _sb_put(SYNC_TABLE, "yt_cookies", {"cookies": sanitized_txt, "updated_at": time.time()})
        except Exception as e:
            print("[youtube] Supabase 쿠키 저장 실패:", e)

    print(f"[youtube] 쿠키 업로드 및 최적화 보존 완료 {len(sanitized_txt)}B")
    return jsonify({"ok": True, "cookies": True, "bytes": len(sanitized_txt)})


@app.route("/api/music/youtube", methods=["POST"])
def music_youtube():
    """유튜브 링크를 원본 음원으로 받아 곡 추가 (누구나)."""
    d = request.get_json(silent=True) or {}
    url = str(d.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "링크를 넣어 주세요"}), 400
    res = _yt_add(url)
    if not res.get("ok"):
        return jsonify({"ok": False, "error": res.get("error") or "추출 실패",
                        "detail": res.get("detail") or ""}), 400
    return jsonify({"ok": True, "from": "youtube", **res["track"]})


@app.route("/api/music/delete", methods=["POST"])
def music_delete():
    # 관리자만 곡을 삭제할 수 있다.
    if not _require_admin():
        return jsonify({"ok": False, "error": "관리자 인증이 필요합니다"}), 403
    d = request.get_json(silent=True) or {}
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", d.get("id") or "")
    if not mid:
        return jsonify({"ok": False, "error": "id 없음"}), 400
    with _music_lock:
        m = _music_load()
        rec = m.pop(mid, None)
        if rec:
            _music_save(m)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    for fn in os.listdir(MUSIC_DIR):
        if fn.startswith(mid + "."):
            try:
                os.remove(os.path.join(MUSIC_DIR, fn))
            except Exception:
                pass
    print(f"[music] 삭제 {rec.get('title')}")
    return jsonify({"ok": True})


def _music_public(r):
    """11.4 · 목록 응답에는 가사 본문을 싣지 않는다.

    가사는 한 곡에 최대 2만 자라, 곡이 많아지면 목록 한 번에 수 MB가 오간다.
    여러 기기가 주기적으로 목록을 받으면 그것만으로 서버가 헐떡인다.
    → 목록엔 '가사 있음/싱크 있음' 표시만 넣고, 본문은 볼 때만 따로 받는다.
    """
    o = {k: v for k, v in r.items() if k not in ("lyrics", "lyrics_plain")}
    sync = (r.get("lyrics") or "")
    plain = (r.get("lyrics_plain") or "")
    o["has_sync"] = "[" in sync
    o["has_lyrics"] = bool(sync.strip() or plain.strip())
    return o


@app.route("/api/music/lyrics/<mid>", methods=["GET"])
def music_lyrics_one(mid):
    """한 곡의 가사 본문 (볼 때만 받아 간다)."""
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", mid or "")
    with _music_lock:
        r = (_music_load().get(mid) or {})
    if not r:
        return jsonify({"ok": False, "error": "없는 곡"}), 404
    resp = jsonify({"ok": True, "id": mid,
                    "lyrics": r.get("lyrics") or "",
                    "lyrics_plain": r.get("lyrics_plain") or "",
                    "lyrics_src": r.get("lyrics_src") or "",
                    "lyrics_tries": r.get("lyrics_tries") or 0})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/api/music/list", methods=["GET"])
def music_list():
    with _music_lock:
        m = _music_load()
    # 11.4 · 목록이 비었는데 음원 파일은 남아 있다 → 그 자리에서 되살린다.
    #   (서버가 과부하로 죽은 뒤 노래가 하나도 안 보이던 문제 자동 복구)
    if not m:
        try:
            has_audio = any("." in fn and fn.rsplit(".", 1)[-1].lower() in MUSIC_EXTS
                            for fn in os.listdir(MUSIC_DIR))
        except Exception:
            has_audio = False
        if has_audio:
            _music_rebuild()
            with _music_lock:
                m = _music_load()
    items = [_music_public(r) for r in
             sorted(m.values(), key=lambda r: r.get("created_at", ""))]
    # 10.3 · 백필(재태깅)이 돌고 있으면 알려준다 — 클라이언트가 주기적으로 다시 받음
    resp = jsonify({"ok": True, "tracks": items, "tagging": _BACKFILL["active"],
                    "count": len(items)})
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _playlist_health():
    """11.5 · 재생목록이 가리키는 곡이 실제로 다 있는지 세어 본다."""
    ok = miss = 0
    try:
        with _music_lock:
            have = set(_music_load().keys())
        base = SYNC_DIR if "SYNC_DIR" in globals() else os.path.join(BASE_DIR, "sync")
        for fn in os.listdir(base):
            if not fn.endswith(".json"):
                continue
            try:
                with open(os.path.join(base, fn), encoding="utf-8") as fp:
                    st = json.load(fp)
            except Exception:
                continue
            for k, v in (st.get("els") or {}).items():
                if not str(k).startswith("pltrack:") or (v or {}).get("del"):
                    continue
                tid = str(((v or {}).get("data") or {}).get("track") or "")
                if not tid:
                    continue
                if tid in have:
                    ok += 1
                else:
                    miss += 1
    except Exception:
        pass
    return ok, miss


@app.route("/api/music/recognize", methods=["POST"])
def music_recognize_api():
    """11.6 · 소리로 노래 인식 (AcoustID). id 를 주면 그 곡을 인식한다."""
    d = request.get_json(silent=True) or {}
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", d.get("id") or "")
    if not mid:
        return jsonify({"ok": False, "error": "id 없음"}), 400
    # 14.13 · 편집창 '소리 인식' 버튼 = 직접 누른 요청. 이미 제목이 있어도
    #   (자동 태깅이 잘못 붙인 제목이라도) 인식 결과를 반영한다.
    r = _music_recognize(mid, apply_tags=True, force=True)
    if r.get("ok"):
        with _music_lock:
            t = _music_load().get(mid) or r.get("kept") or r.get("track") or {}
        r["track"] = _music_public(t)
        if r.get("kept"):
            r["kept"] = _music_public(r.get("kept") or {})
    return jsonify(r)


@app.route("/api/music/recognize/status", methods=["GET"])
def music_recognize_status():
    """인식 기능이 쓸 수 있는 상태인지 (fpcalc 있음 / 키 있음)."""
    return jsonify({"ok": True, "fpcalc": bool(_fp_bin()),
                    "key": bool(_aco_key()),
                    "ready": bool(_fp_bin() and _aco_key())})


@app.route("/api/music/recognize/key", methods=["POST"])
def music_recognize_key():
    """AcoustID 키 저장 (관리자)."""
    if not _require_admin():
        return jsonify({"ok": False, "error": "관리자 인증이 필요합니다"}), 403
    d = request.get_json(silent=True) or {}
    k = _aco_key_save(d.get("key"))
    return jsonify({"ok": True, "key": bool(k), "ready": bool(k and _fp_bin())})


@app.route("/api/music/rescan", methods=["POST", "GET"])
def music_rescan():
    """11.4 · '새로고침(복구)' — 폴더의 음원 파일을 다시 훑어 목록을 맞춘다."""
    added, total = _music_rebuild()
    with _music_lock:
        m = _music_load()
    items = [_music_public(r) for r in
             sorted(m.values(), key=lambda r: r.get("created_at", ""))]
    pl_ok, pl_miss = _playlist_health()
    resp = jsonify({"ok": True, "added": added, "count": len(items),
                    "tracks": items, "tagging": _BACKFILL["active"],
                    "playlist_ok": pl_ok, "playlist_missing": pl_miss})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/api/music/reset", methods=["POST"])
def music_reset_meta():
    """12.2 · '원래 이름으로' — 태그를 완전히 초기 상태로 되돌린다 (누구나 가능).

    파일 이름/파일 안 내장 태그만으로 제목·가수·앨범·연도·장르를 다시 채우고,
    웹 검색으로 붙은 제목·가수·앨범·가사·표지를 모두 비운다.
    (파일 자체는 지우지 않는다)
    """
    d = request.get_json(silent=True) or {}
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", d.get("id") or "")
    if not mid:
        return jsonify({"ok": False, "error": "id 없음"}), 400
    with _music_lock:
        m = _music_load()
        rec = m.get(mid)
        if not rec:
            return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
        hits = [fn for fn in os.listdir(MUSIC_DIR)
                if fn.startswith(mid + ".")
                and not fn.endswith((".cover", ".meta.json"))
                and fn.rsplit(".", 1)[-1].lower() in MUSIC_EXTS]
        orig = rec.get("orig_title") or rec.get("title") or mid
        title, artist = _parse_filename(orig)
        emb = _read_embedded(os.path.join(MUSIC_DIR, hits[0])) if hits else {}
        title = (emb.get("title") or title or orig)[:120]
        artist = (emb.get("artist") or artist or "")[:80]
        rec.update({
            "title": title, "artist": artist,
            "album": (emb.get("album") or "")[:120],
            "year": emb.get("year") or "",
            "genre": (emb.get("genre") or "")[:40],
            "tag_state": "pending", "tag_src": "", "tag_tries": 0,
            "tag_next": 0, "tag_algo": "",
            "lyrics": "", "lyrics_plain": "", "lyrics_src": "",
            "lyrics_tries": 0, "lyrics_next": 0,
            "recog_tried": 0, "recog_state": "",
        })
        m[mid] = rec
        _music_save(m)
        # 웹에서 받아온 표지·가사도 지운다
        for ext in (".cover",):
            p = os.path.join(MUSIC_DIR, mid + ext)
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass
        out = dict(rec)
    print(f"[music] 초기화 {title} / {artist}")
    return jsonify({"ok": True, "track": _music_public(out)})


@app.route("/api/music/synced-lyrics", methods=["POST"])
def music_synced_lyrics():
    """12.2 · 싱크 가사만 다시 검색해 저장한다.

    몇 초짜리 영상 가사가 없을 때나, 싱크가 어긋난 가사를 교체하고 싶을 때 쓴다.
    본문(plain) 가사는 건드리지 않고, 싱크(LRC)를 찾았을 때만 교체한다.
    """
    d = request.get_json(silent=True) or {}
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", d.get("id") or "")
    if not mid:
        return jsonify({"ok": False, "error": "id 없음"}), 400
    force = bool(d.get("force"))
    with _music_lock:
        rec = dict((_music_load().get(mid) or {}))
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    # 14.13 · 편집창에 적어둔 제목/가수로 찾는다. 저장 전 상태(인식 결과를
    #   확인하는 중 등)에서 눌러도 방금 고른 이름으로 검색해야 반영이 된다.
    q_t = str(d.get("q_title") or "").strip()[:120]
    q_a = str(d.get("q_artist") or "").strip()[:80]
    title = q_t or (rec.get("title") or "").strip()
    artist = q_a if q_a else (rec.get("artist") or "").strip()
    if not title:
        return jsonify({"ok": False, "error": "제목이 없어 가사를 찾을 수 없어요"})
    hits = [fn for fn in os.listdir(MUSIC_DIR)
            if fn.startswith(mid + ".")
            and not fn.endswith((".cover", ".meta.json"))
            and fn.rsplit(".", 1)[-1].lower() in MUSIC_EXTS]
    dur = None
    if hits:
        dur = _read_embedded(os.path.join(MUSIC_DIR, hits[0])).get("dur")
    # 싱크 가사만 강제로 다시 찾는다 (LRCLIB 만 사용)
    sync, plain, src = _fetch_lyrics(title, artist, dur)
    if not sync:
        return jsonify({"ok": False, "error": "싱크 가사를 찾지 못했어요"})
    with _music_lock:
        m = _music_load()
        r = m.get(mid)
        if not r:
            return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
        r["lyrics"] = sync
        if plain:
            r["lyrics_plain"] = plain
        r["lyrics_src"] = src
        r["lyrics_tries"] = 9
        m[mid] = r
        _music_save(m)
    return jsonify({"ok": True, "lyrics": sync, "src": src})


@app.route("/api/music/meta", methods=["POST"])
def music_meta():
    """태그 수동 편집 (누구나 가능) — 제목·가수·앨범·연도·장르·가사."""
    d = request.get_json(silent=True) or {}
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", d.get("id") or "")
    if not mid:
        return jsonify({"ok": False, "error": "id 없음"}), 400

    def _s(k, n):
        return str(d.get(k) or "").strip()[:n]
    year = re.search(r"(19|20)\d{2}", _s("year", 6))
    _tag_generation_bump(mid)
    with _music_lock:
        m = _music_load()
        rec = m.get(mid)
        if not rec:
            return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
        if not rec.get("orig_title"):
            rec["orig_title"] = rec.get("title") or ""
        if _s("title", 120):
            rec["title"] = _s("title", 120)
        rec["artist"] = _s("artist", 80)
        rec["album"] = _s("album", 120)
        rec["year"] = year.group(0) if year else ""
        rec["genre"] = _s("genre", 40)
        # 10.6 · 가사 직접 입력: [mm:ss.xx] 태그가 있으면 싱크(LRC)로, 없으면 일반 가사로
        lyr = str(d.get("lyrics") or "").strip()[:20000]
        if lyr:
            if re.search(r"\[\d{1,2}:\d{1,2}", lyr):
                rec["lyrics"] = lyr
                rec["lyrics_plain"] = re.sub(r"\[[^\]]*\]", "", lyr).strip() or rec.get("lyrics_plain", "")
            else:
                rec["lyrics_plain"] = lyr
            rec["lyrics_src"] = "직접 편집"
            rec["lyrics_tries"] = 3          # 사용자가 넣었으니 백그라운드 재시도 안 함
        rec["tag_state"] = "manual"
        rec["tag_src"] = "직접 편집"
        m[mid] = rec
        _music_save(m)
    # 10.5 · 제목/가수가 바뀌었으면 가사도 다시 찾아 둔다
    threading.Thread(target=_music_lyrics, args=(mid,), daemon=True).start()
    return jsonify({"ok": True, "track": rec})


@app.route("/api/music/cover", methods=["POST"])
def music_cover_set():
    """표지 바꾸기(누구나 가능) — 이미지 파일 직접 또는 URL. remove:true 면 기본으로."""
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", (request.form.get("id")
                 or (request.get_json(silent=True) or {}).get("id") or ""))
    if not mid:
        return jsonify({"ok": False, "error": "id 없음"}), 400
    with _music_lock:
        m = _music_load()
        rec = m.get(mid)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    cover_path = os.path.join(MUSIC_DIR, f"{mid}.cover")

    # 표지 지우기
    if (request.get_json(silent=True) or {}).get("remove"):
        try:
            if os.path.exists(cover_path):
                os.remove(cover_path)
        except Exception:
            pass
        with _music_lock:
            m = _music_load()
            if m.get(mid):
                m[mid]["cover"] = False
                _music_save(m)
                rec = m[mid]
        return jsonify({"ok": True, "track": rec})

    raw = None
    f = request.files.get("file")
    if f is not None:
        raw = f.read()
        if len(raw) > 12 * 1024 * 1024:
            return jsonify({"ok": False, "error": "표지는 12MB 이하만 가능해요"}), 400
    else:
        url = (request.get_json(silent=True) or {}).get("url") or ""
        raw = _fetch_cover(url)
    if not raw:
        return jsonify({"ok": False, "error": "이미지를 받아오지 못했어요"}), 400
    # 이미지로 검증 + 적당한 크기의 JPEG 로 통일 (용량·렌더 안정)
    try:
        im = Image.open(io.BytesIO(raw))
        im = im.convert("RGB")
        im.thumbnail((1000, 1000))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=88)
        with open(cover_path, "wb") as fp:
            fp.write(buf.getvalue())
    except Exception:
        return jsonify({"ok": False, "error": "이미지 파일이 아닙니다"}), 400
    with _music_lock:
        m = _music_load()
        if m.get(mid):
            m[mid]["cover"] = True
            _music_save(m)
            rec = m[mid]
    return jsonify({"ok": True, "track": rec})


def _scrape_music_url(raw_url):
    """13.0 · 외부 링크(벅스, 멜론, 스포티파이, 지니어스, 애플뮤직, 유튜브, 바이브 등)에서
    곡명, 가수, 앨범, 연도, 장르, 표지 URL, 가사를 추출한다.
    """
    raw_url = str(raw_url or "").strip()
    if not raw_url.startswith(("http://", "https://")):
        return {"ok": False, "error": "올바른 http(s) 링크를 입력해 주세요"}

    parsed = urllib.parse.urlparse(raw_url)
    domain = parsed.netloc.lower()

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    def _c_txt(s):
        if not s: return ""
        return re.sub(r'\s+', ' ', str(s)).strip()

    def _c_lyr(html_or_text):
        if not html_or_text: return ""
        t = re.sub(r'(?i)<br\s*/?>', '\n', str(html_or_text))
        t = re.sub(r'(?i)</p>', '\n', t)
        t = re.sub(r'(?i)</div>', '\n', t)
        t = re.sub(r'(?i)</li>', '\n', t)
        soup = BeautifulSoup(t, 'html.parser')
        text = soup.get_text()
        text = re.sub(r'\r\n|\r', '\n', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    # 1. Spotify
    # oEmbed 는 {title:"곡명", author_name:"아티스트", thumbnail_url:...}
    # 형태로 온다. 예전엔 title 을 " by " 로만 갈랐는데 한국어/비영어 제목은
    # 구분자가 없어 아티스트가 비어 오는 경우가 많았다. author_name 을 우선
    # 쓰고, 모자란 필드만 og/HTML 로 보강한다.
    if "spotify.com" in domain:
        title = artist = album = year = genre = cover_url = lyrics = ""
        src = "Spotify"

        def _spotify_oembed(u):
            try:
                r = requests.get(u, headers=headers, timeout=6)
                if not r.ok:
                    return None
                oe = r.json() or {}
                t = _c_txt(oe.get("title") or "")
                a = _c_txt(oe.get("author_name") or "")
                if not a and " by " in t:
                    t, a = (_c_txt(x) for x in t.split(" by ", 1))
                return {"title": t, "artist": a,
                        "cover": oe.get("thumbnail_url") or ""}
            except Exception:
                return None

        oe = _spotify_oembed(
            "https://open.spotify.com/oembed?format=json&url="
            + urllib.parse.quote(raw_url, safe=""))
        if oe:
            title, artist, cover_url = oe["title"], oe["artist"], oe["cover"]

        if not (title and artist):
            try:
                r = requests.get(raw_url, headers=headers, timeout=6)
                if r.ok:
                    soup = BeautifulSoup(r.text, "html.parser")
                    og_title = soup.find("meta", property="og:title")
                    if og_title and og_title.get("content") and not title:
                        title = _c_txt(og_title["content"])
                    og_img = soup.find("meta", property="og:image")
                    if og_img and og_img.get("content"):
                        cover_url = og_img["content"] or cover_url
                    og_desc = soup.find("meta", property="og:description")
                    if og_desc and og_desc.get("content"):
                        parts = [_c_txt(x) for x in og_desc["content"].split("·")]
                        if parts and not artist:
                            artist = parts[0]
                        for pp in parts:
                            ym = re.search(r"(19|20)\d{2}", pp)
                            if ym and not year:
                                year = ym.group(0)
                    m_album = soup.find("meta", property="music:album")
                    if m_album and m_album.get("content"):
                        album = _c_txt(m_album["content"])
            except Exception:
                pass
        # Spotify oEmbed/og 는 앨범/연도를 잘 안 준다. 제목+가수가 있으면
        # Apple Music/Deezer 에서 한 번만 더 보강해 넣는다.
        if title and artist and not (album and year):
            try:
                q = (artist + " " + title).strip()
                for src_fn in (_src_itunes, _src_deezer):
                    for c in src_fn(q):
                        if _sim(c.get("title"), title) >= 0.82 and _sim(c.get("artist"), artist) >= 0.70:
                            album = album or c.get("album") or ""
                            year = year or c.get("year") or ""
                            genre = genre or c.get("genre") or ""
                            cover_url = cover_url or c.get("art") or ""
                            break
                    if album and year:
                        break
            except Exception:
                pass
        return {"ok": True, "title": title, "artist": artist, "album": album,
                "year": year, "genre": genre, "cover_url": cover_url,
                "lyrics": lyrics, "src": src}

    # 2. Melon
    if "melon.com" in domain:
        try:
            r = requests.get(raw_url, headers=headers, timeout=8)
            r.encoding = r.apparent_encoding or 'utf-8'
            soup = BeautifulSoup(r.text, 'html.parser')
            t_el = soup.select_one('.song_name')
            if t_el:
                for b in t_el.select('.title, .none'): b.decompose()
                title = _c_txt(t_el.get_text())
            else:
                og_t = soup.find('meta', property='og:title')
                title = _c_txt(og_t['content']) if og_t else ""
            a_el = soup.select_one('.artist_name')
            artist = _c_txt(a_el.get_text()) if a_el else ""
            album, year, genre = "", "", ""
            for dt in soup.select('dl.list dt'):
                dt_txt = _c_txt(dt.get_text())
                dd = dt.find_next_sibling('dd')
                if not dd: continue
                dd_txt = _c_txt(dd.get_text())
                if '앨범' in dt_txt: album = dd_txt
                elif '발매일' in dt_txt:
                    ym = re.search(r'(19|20)\d{2}', dd_txt)
                    if ym: year = ym.group(0)
                elif '장르' in dt_txt: genre = dd_txt
            lyr_el = soup.select_one('#d_video_summary') or soup.select_one('.lyric')
            lyrics = _c_lyr(lyr_el) if lyr_el else ""
            cover_url = ""
            img_el = soup.select_one('.thumb img') or soup.find('meta', property='og:image')
            if img_el:
                raw_img = img_el.get('src') or img_el.get('content') or ""
                cover_url = re.sub(r'/melon/resize/\d+', '/melon/resize/1000', raw_img)
            return {"ok": True, "title": title, "artist": artist, "album": album,
                    "year": year, "genre": genre, "cover_url": cover_url, "lyrics": lyrics, "src": "멜론"}
        except Exception as e:
            return {"ok": False, "error": f"멜론 페이지 분석 실패: {e}"}

    # 3. Bugs
    if "bugs.co.kr" in domain:
        try:
            r = requests.get(raw_url, headers=headers, timeout=8)
            soup = BeautifulSoup(r.text, 'html.parser')
            t_el = soup.select_one('.innerContainer h1') or soup.select_one('.trackInfo .title')
            title = _c_txt(t_el.get_text()) if t_el else ""
            if not title:
                og_t = soup.find('meta', property='og:title')
                title = _c_txt(og_t['content']) if og_t else ""
                if " - " in title: title = title.split(" - ")[0].strip()
            a_el = soup.select_one('.artist a') or soup.select_one('.info .artist')
            artist = _c_txt(a_el.get_text()) if a_el else ""
            album, year, genre = "", "", ""
            for tr in soup.select('.info table tr'):
                th = tr.select_one('th'); td = tr.select_one('td')
                if not th or not td: continue
                th_txt = _c_txt(th.get_text()); td_txt = _c_txt(td.get_text())
                if '아티스트' in th_txt and not artist: artist = td_txt
                elif '앨범' in th_txt: album = td_txt
                elif '발매일' in th_txt:
                    ym = re.search(r'(19|20)\d{2}', td_txt)
                    if ym: year = ym.group(0)
                elif '장르' in th_txt: genre = td_txt
            lyr_el = soup.select_one('.lyricsContainer xmp') or soup.select_one('.lyricsContainer p') or soup.select_one('.lyricsContainer')
            lyrics = _c_lyr(lyr_el) if lyr_el else ""
            cover_url = ""
            img_el = soup.select_one('.infoPhotos img') or soup.find('meta', property='og:image')
            if img_el:
                raw_img = img_el.get('src') or img_el.get('content') or ""
                cover_url = re.sub(r'/images/\d+/', '/images/1000/', raw_img)
            return {"ok": True, "title": title, "artist": artist, "album": album,
                    "year": year, "genre": genre, "cover_url": cover_url, "lyrics": lyrics, "src": "벅스"}
        except Exception as e:
            return {"ok": False, "error": f"벅스 페이지 분석 실패: {e}"}

    # 4. Genius
    if "genius.com" in domain:
        try:
            r = requests.get(raw_url, headers=headers, timeout=8)
            soup = BeautifulSoup(r.text, 'html.parser')
            raw_title = ""
            og_t = soup.find('meta', property='og:title')
            if og_t: raw_title = og_t.get('content') or ""
            if not raw_title:
                h1 = soup.select_one('h1')
                if h1: raw_title = h1.get_text()
            raw_title = re.sub(r'\s*\|\s*Genius\s*Lyrics.*', '', raw_title, flags=re.I)
            raw_title = re.sub(r'\s+Lyrics\s*$', '', raw_title, flags=re.I)
            title, artist = "", ""
            if "–" in raw_title or "—" in raw_title or "-" in raw_title:
                parts = re.split(r'\s+[–—-marked]\s+', raw_title, maxsplit=1)
                if len(parts) == 2:
                    artist, title = _c_txt(parts[0]), _c_txt(parts[1])
            if not title: title = _c_txt(raw_title)
            a_el = soup.select_one('a[class*="StyledArtist"]') or soup.select_one('a[href*="/artists/"]')
            if a_el and not artist: artist = _c_txt(a_el.get_text())
            album, year = "", ""
            alb_el = soup.select_one('a[href*="/albums/"]')
            if alb_el: album = _c_txt(alb_el.get_text())
            date_el = soup.select_one('span[class*="ReleaseDate"]')
            if date_el:
                ym = re.search(r'(19|20)\d{2}', date_el.get_text())
                if ym: year = ym.group(0)
            lyr_blocks = soup.select('div[data-lyrics-container="true"]') or soup.select('div[class*="Lyrics__Container"]')
            lyrics = "\n\n".join(_c_lyr(b) for b in lyr_blocks) if lyr_blocks else ""
            if not lyrics:
                root_lyr = soup.select_one('#lyrics-root')
                if root_lyr: lyrics = _c_lyr(root_lyr)
            cover_url = ""
            og_img = soup.find('meta', property='og:image')
            if og_img: cover_url = og_img.get('content') or ""
            return {"ok": True, "title": title, "artist": artist, "album": album,
                    "year": year, "genre": "", "cover_url": cover_url, "lyrics": lyrics, "src": "Genius"}
        except Exception as e:
            return {"ok": False, "error": f"Genius 페이지 분석 실패: {e}"}

    # 5. Apple Music
    if "apple.com" in domain:
        try:
            r = requests.get(raw_url, headers=headers, timeout=8)
            soup = BeautifulSoup(r.text, 'html.parser')
            og_t = soup.find('meta', property='og:title')
            raw_title = og_t.get('content') if og_t else ""
            title, artist = "", ""
            if " by " in raw_title:
                parts = raw_title.split(" by ", 1)
                title, artist = _c_txt(parts[0]), _c_txt(parts[1])
            else:
                title = _c_txt(raw_title)
            og_desc = soup.find('meta', property='og:description')
            album, year, genre = "", "", ""
            if og_desc and og_desc.get('content'):
                desc = og_desc['content']
                ym = re.search(r'(19|20)\d{2}', desc)
                if ym: year = ym.group(0)
            og_img = soup.find('meta', property='og:image')
            cover_url = og_img.get('content') if og_img else ""
            if cover_url:
                cover_url = re.sub(r'/\d+x\d+[^/]*\.', '/1000x1000bb.', cover_url)
            return {"ok": True, "title": title, "artist": artist, "album": album,
                    "year": year, "genre": genre, "cover_url": cover_url, "lyrics": "", "src": "Apple Music"}
        except Exception as e:
            return {"ok": False, "error": f"Apple Music 페이지 분석 실패: {e}"}

    # 6. YouTube / YouTube Music
    if "youtube.com" in domain or "youtu.be" in domain:
        try:
            r = requests.get(raw_url, headers=headers, timeout=8)
            soup = BeautifulSoup(r.text, 'html.parser')
            og_t = soup.find('meta', property='og:title')
            raw_title = og_t.get('content') if og_t else (soup.title.get_text() if soup.title else "")
            raw_title = re.sub(r'\s*-\s*YouTube.*', '', raw_title, flags=re.I).strip()
            title, artist = "", ""
            if " - " in raw_title:
                parts = raw_title.split(" - ", 1)
                artist, title = _c_txt(parts[0]), _c_txt(parts[1])
            else:
                title = _c_txt(raw_title)
            og_img = soup.find('meta', property='og:image')
            cover_url = og_img.get('content') if og_img else ""
            return {"ok": True, "title": title, "artist": artist, "album": "",
                    "year": "", "genre": "", "cover_url": cover_url, "lyrics": "", "src": "YouTube"}
        except Exception as e:
            return {"ok": False, "error": f"YouTube 페이지 분석 실패: {e}"}

    # 7. Generic Fallback (OpenGraph + JSON-LD + Lyrics containers)
    try:
        r = requests.get(raw_url, headers=headers, timeout=8)
        soup = BeautifulSoup(r.text, 'html.parser')
        title, artist, album, year, genre, cover_url, lyrics = "", "", "", "", "", "", ""
        for script in soup.select('script[type="application/ld+json"]'):
            try:
                data = json.loads(script.string or "{}")
                if isinstance(data, list): data = data[0] if data else {}
                if isinstance(data, dict):
                    if data.get('name') and not title: title = _c_txt(data['name'])
                    by = data.get('byArtist') or data.get('author')
                    if isinstance(by, dict) and by.get('name') and not artist:
                        artist = _c_txt(by['name'])
                    elif isinstance(by, list) and by and isinstance(by[0], dict) and not artist:
                        artist = _c_txt(by[0].get('name'))
                    elif isinstance(by, str) and not artist:
                        artist = _c_txt(by)
                    if data.get('inAlbum') and isinstance(data['inAlbum'], dict) and not album:
                        album = _c_txt(data['inAlbum'].get('name'))
                    if data.get('datePublished') and not year:
                        ym = re.search(r'(19|20)\d{2}', str(data['datePublished']))
                        if ym: year = ym.group(0)
                    if data.get('image') and not cover_url:
                        cover_url = str(data['image']) if isinstance(data['image'], str) else (data['image'].get('url') if isinstance(data['image'], dict) else "")
                    if data.get('lyrics') and not lyrics:
                        lyrics = _c_lyr(data['lyrics'] if isinstance(data['lyrics'], str) else data['lyrics'].get('text'))
            except Exception:
                pass
        if not title:
            og_t = soup.find('meta', property='og:title')
            title = _c_txt(og_t['content']) if og_t else (_c_txt(soup.title.get_text()) if soup.title else "")
            if " - " in title and not artist:
                parts = title.split(" - ", 1)
                artist, title = _c_txt(parts[0]), _c_txt(parts[1])
        if not cover_url:
            og_img = soup.find('meta', property='og:image')
            cover_url = og_img.get('content') if og_img else ""
        if not lyrics:
            lyr_el = soup.select_one('[class*="lyric"], [id*="lyric"]')
            if lyr_el: lyrics = _c_lyr(lyr_el)
        if not year:
            og_desc = soup.find('meta', property='og:description')
            if og_desc and og_desc.get('content'):
                ym = re.search(r'(19|20)\d{2}', og_desc['content'])
                if ym: year = ym.group(0)
        return {"ok": True, "title": title, "artist": artist, "album": album,
                "year": year, "genre": genre, "cover_url": cover_url, "lyrics": lyrics, "src": "웹 링크"}
    except Exception as e:
        return {"ok": False, "error": f"링크 분석 실패: {e}"}


@app.route("/api/music/from_url", methods=["POST"])
def music_from_url():
    """13.0 · 외부 링크(벅스, 멜론, 스포티파이, 지니어스, 유튜브 등)에서 곡 정보 추출 (누구나 가능)."""
    d = request.get_json(silent=True) or {}
    url = str(d.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "URL을 입력해 주세요"}), 400
    res = _scrape_music_url(url)
    if not res.get("ok"):
        return jsonify(res), 400
    return jsonify(res)


@app.route("/api/music/lookup", methods=["POST"])
def music_lookup():
    """지금 곡의 태그를 다시 자동으로 찾는다 (수동 편집은 덮지 않음)."""
    d = request.get_json(silent=True) or {}
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", d.get("id") or "")
    force = bool(d.get("force"))
    if not mid:
        return jsonify({"ok": False, "error": "id 없음"}), 400
    with _music_lock:
        m = _music_load()
        rec = m.get(mid)
    if not rec:
        return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
    if rec.get("tag_state") == "manual" and not force:
        return jsonify({"ok": True, "track": rec, "changed": False})
    # 10.8 · 편집창에서 보내온 제목/가수 → 검색어 힌트로 쓴다
    qh = None
    if d.get("q_title") or d.get("q_artist"):
        qh = (d.get("q_title") or "", d.get("q_artist") or "")
    # 10.6 · 가사만 찾는 모드 — 태그(수동 편집 포함)는 그대로 두고 가사만 채운다
    if d.get("lyrics_only"):
        try:
            _music_lyrics(mid)
        except Exception:
            pass
        with _music_lock:
            out = _music_load().get(mid) or rec
        changed = bool(out.get("lyrics") or out.get("lyrics_plain"))
        return jsonify({"ok": True, "track": out, "changed": changed})
    # 11.2 · 표지만 다시 찾기 (노래 정보는 건드리지 않는다)
    if d.get("cover_only"):
        # 14.13 · 편집창에 적어둔 제목/가수 힌트 → 저장된 값보다 우선한다.
        qh = None
        if str(d.get("q_title") or "").strip() or str(d.get("q_artist") or "").strip():
            qh = (str(d.get("q_title") or "").strip()[:120],
                  str(d.get("q_artist") or "").strip()[:80])
        r = _music_cover_search(mid, d.get("alt") or 0, qh)
        with _music_lock:
            out = _music_load().get(mid) or rec
        return jsonify({"ok": bool(r.get("ok")), "track": out,
                        "cover": bool(r.get("cover")), "count": r.get("count") or 0,
                        "error": r.get("error") or ""})
    # 11.2 · alt: 같은 검색을 다시 누르면 그 다음 후보를 보여 준다
    try:
        alt = max(0, min(30, int(d.get("alt") or 0)))
    except Exception:
        alt = 0
    # 15.0 · fill_only — 이미 채워진 칸은 그대로 두고 빈 칸만 채운다
    out = _music_autotag(mid, force=force, algo=TAG_ALGO, qhint=qh, alt=alt,
                         replace_cover=bool(d.get("replace_cover")),
                         fill_only=bool(d.get("fill_only")))
    changed = bool(out and out.get("tag_state") == "done")
    return jsonify({"ok": True, "track": out or rec, "changed": changed, "alt": alt})


@app.route("/api/music/cover/<mid>", methods=["GET"])
def music_cover(mid):
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", mid or "")
    p = os.path.join(MUSIC_DIR, f"{mid}.cover")
    if not os.path.exists(p):
        return jsonify({"error": "없음"}), 404
    resp = send_from_directory(MUSIC_DIR, f"{mid}.cover")
    resp.headers["Cache-Control"] = "public, max-age=31536000"
    return resp


@app.route("/api/music/file/<mid>", methods=["GET"])
def music_file(mid):
    """Range 지원 스트리밍 (탐색/시크 원활)."""
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", mid or "")
    # 12.0 · 실제 음원 확장자만 고른다. (.cover, .meta.json 쪽지를 음원으로 오인하지 않게)
    hits = [fn for fn in os.listdir(MUSIC_DIR)
            if fn.startswith(mid + ".")
            and not fn.endswith((".cover", ".meta.json"))
            and fn.rsplit(".", 1)[-1].lower() in MUSIC_EXTS]
    if not hits:
        return jsonify({"error": "없는 곡입니다"}), 404
    path = os.path.join(MUSIC_DIR, hits[0])
    size = os.path.getsize(path)
    ext = hits[0].rsplit(".", 1)[-1].lower()
    mime = {"mp3": "audio/mpeg", "flac": "audio/flac", "m4a": "audio/mp4",
            "aac": "audio/aac", "ogg": "audio/ogg", "opus": "audio/ogg",
            "wav": "audio/wav", "webm": "audio/webm",
            "weba": "audio/webm"}.get(ext, "application/octet-stream")
    rng = request.headers.get("Range")
    if rng:
        m2 = re.match(r"bytes=(\d*)-(\d*)", rng)
        if m2:
            start = int(m2.group(1)) if m2.group(1) else 0
            end = min(int(m2.group(2)) if m2.group(2) else size - 1, size - 1)
            if start >= size:
                return Response("", 416, {"Content-Range": f"bytes */{size}"})

            def gen():
                with open(path, "rb") as fp:
                    fp.seek(start)
                    left = end - start + 1
                    while left > 0:
                        chunk = fp.read(min(64 * 1024, left))
                        if not chunk:
                            break
                        left -= len(chunk)
                        yield chunk
            return Response(gen(), 206, {
                "Content-Range": f"bytes {start}-{end}/{size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(end - start + 1),
                "Content-Type": mime})

    def gen_all():
        with open(path, "rb") as fp:
            while True:
                chunk = fp.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
    return Response(gen_all(), 200, {
        "Accept-Ranges": "bytes", "Content-Length": str(size),
        "Content-Type": mime})
