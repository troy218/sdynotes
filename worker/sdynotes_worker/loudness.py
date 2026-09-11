"""14.65 · 곡마다 다른 음량을 백엔드에서 한 크기로 맞춘다 (송출용 정규화).

왜 여기서 하나
--------------
"노래마다 소리가 크고 작다"는 문제는 **듣는 사람이 고르는 옵션이 아니라**
백엔드가 송출할 때 맞춰 줘야 한다. 그래서 이 모듈은 곡이 들어올 때(업로드·
유튜브)와 백필에서 한 번 재고, 곡 기록(_index.json)에 보정값(gain_db)을
남긴 뒤 **정규화 사본**을 만들어 둔다.

송출은 서버(Node)가 한다
------------------------
* 로컬 모드 — `/api/music/file/:mid` 가 music_norm/<id>.<ext> 사본을
  Range 로 흘려보낸다. 사본이 아직 없으면 원본을 그대로 보내고, 백그라운드
  분석이 끝나는 대로 다음 재생부터 정규화된 소리가 나간다.
* 클라우드 모드 — 같은 gain_db 를 Cloudinary 변환(e_volume:<gain>dB)으로
  넘겨 준다. 서버가 만든 값이라 기기·사람과 무관하게 항상 같다.

어떻게 재나
-----------
ffmpeg 의 ebur128 필터(EBU R128 · 방송 표준)로 **통합 음량(integrated
loudness, LUFS)** 과 **트루피크**를 잰다. 목표는 -14 LUFS(스포티파이·유튜브
와 같은 체감 기준)이고, 올릴 때는 트루피크가 -1 dBFS 를 넘지 않게 제한한다.
ffmpeg 가 없으면 아무것도 하지 않고 norm_state='unavailable' 만 남긴다 —
재생은 예전 그대로 되고, 서버에 ffmpeg 를 깔면 다음 백필부터 자동으로 켜진다.

ffmpeg 는 어디서 구하나
-----------------------
① 환경변수 SDY_FFMPEG  ② PATH 의 ffmpeg  ③ pip 패키지 imageio-ffmpeg
(requirements.txt 에 들어 있어 apply.sh 가 같이 설치한다 · 바이너리 동봉).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading

from .common import MUSIC_DIR, MUSIC_NORM_DIR

# ── 기준값 ────────────────────────────────────────────────────────────
TARGET_LUFS = -14.0        # 목표 체감 음량 (스트리밍 서비스 표준)
MAX_GAIN_DB = 9.0          # 너무 조용한 곡을 억지로 끌어올리지 않는다
MIN_GAIN_DB = -12.0        # 너무 큰 곡도 -12dB 까지만 내린다
PEAK_CEIL_DB = -1.0        # 트루피크 상한 (클리핑 방지 헤드룸)
SILENT_LUFS = -70.0        # 이보다 조용하면 '무음'으로 본다

_AUDIO_EXTS = ("mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "webm")

# 코덱 선택 — 원본 컨테이너를 유지해서 브라우저가 그대로 재생하게 한다.
#   flac·wav 는 무손실이라 재인코딩 손실이 아예 없다.
_ENCODERS = {
    "mp3": ["-c:a", "libmp3lame", "-q:a", "2"],
    "flac": ["-c:a", "flac"],
    "wav": ["-c:a", "pcm_s16le"],
    "m4a": ["-c:a", "aac", "-b:a", "192k"],
    "aac": ["-c:a", "aac", "-b:a", "192k"],
    "ogg": ["-c:a", "libvorbis", "-q:a", "5"],
    "opus": ["-c:a", "libopus", "-b:a", "128k"],
    "webm": ["-c:a", "libopus", "-b:a", "128k"],
}
# libopus/libvorbis 가 없는 ffmpeg 빌드도 있다 → 실패하면 AAC(m4a)로 한 번 더.
_FALLBACK_ENCODERS = [["-c:a", "aac", "-b:a", "192k"]]

_FF_LOCK = threading.Lock()
_FF_CACHE = {"path": None, "checked": False}
_FF_ARGS = ["-hide_banner", "-nostdin", "-loglevel", "info"]


def ffmpeg_bin():
    """ffmpeg 실행 파일 경로. 없으면 None (한 번만 찾고 기억한다)."""
    with _FF_LOCK:
        if _FF_CACHE["checked"]:
            return _FF_CACHE["path"]
        cand = os.environ.get("SDY_FFMPEG") or ""
        path = cand if cand and os.path.isfile(cand) else None
        if not path:
            path = shutil.which("ffmpeg")
        if not path:
            try:                       # pip 로 깔린 동봉 바이너리
                import imageio_ffmpeg
                path = imageio_ffmpeg.get_ffmpeg_exe()
            except Exception:
                path = None
        if path and not os.path.isfile(path):
            path = None
        _FF_CACHE["path"] = path
        _FF_CACHE["checked"] = True
        return path


def available():
    return bool(ffmpeg_bin())


def norm_path(mid, ext):
    """정규화 사본 경로 — 서버(music.js)와 같은 규칙: music_norm/<id>.<ext>."""
    ext = str(ext or "").lstrip(".").lower()
    if not mid or ext not in _AUDIO_EXTS:
        return None
    return os.path.join(MUSIC_NORM_DIR, "%s.%s" % (mid, ext))


def _run(args, timeout=900):
    """ffmpeg 한 번 실행. 반환: (returncode, stderr 텍스트)"""
    try:
        p = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                           timeout=timeout)
        return p.returncode, (p.stderr or b"").decode("utf-8", "ignore")
    except Exception as e:                                     # noqa: BLE001
        return -1, str(e)


# ── 측정 ──────────────────────────────────────────────────────────────
_I_RE = re.compile(r"\bI:\s*(-?[\d.]+|inf|-inf)\s*LUFS", re.I)
_PEAK_RE = re.compile(r"\bPeak:\s*(-?[\d.]+|inf|-inf)\s*dBFS", re.I)


def parse_ebur128(text):
    """ebur128 요약 출력에서 (통합 음량, 트루피크) 를 뽑는다. 못 읽으면 (None, None).

    ffmpeg 는 요약을 여러 줄로 찍는다::

        Integrated loudness:
          I:         -23.0 LUFS
        True peak:
          Peak:       -6.2 dBFS
    """
    lufs = peak = None
    m = None
    for m in _I_RE.finditer(text or ""):
        pass
    if m:
        v = m.group(1).lower()
        lufs = None if "inf" in v else float(v)
    m = None
    for m in _PEAK_RE.finditer(text or ""):
        pass
    if m:
        v = m.group(1).lower()
        peak = None if "inf" in v else float(v)
    return lufs, peak


def measure(src, timeout=900):
    """곡의 통합 음량·트루피크를 잰다. 반환 {lufs, peak_db, ok, error}."""
    ff = ffmpeg_bin()
    if not ff:
        return {"ok": False, "error": "ffmpeg 없음", "lufs": None, "peak_db": None}
    if not src:
        return {"ok": False, "error": "음원 없음", "lufs": None, "peak_db": None}
    args = [ff] + _FF_ARGS + ["-i", src, "-map", "a:0", "-af", "ebur128=peak=true",
                              "-f", "null", "-"]
    rc, err = _run(args, timeout=timeout)
    lufs, peak = parse_ebur128(err)
    if lufs is None:
        tail = (err or "").strip().splitlines()[-1:] or [""]
        return {"ok": False, "error": "음량을 재지 못했습니다: " + tail[0][:160],
                "lufs": None, "peak_db": None}
    return {"ok": True, "lufs": round(lufs, 1),
            "peak_db": (round(peak, 1) if peak is not None else None), "error": ""}


# ── 보정값 ────────────────────────────────────────────────────────────
def gain_from(lufs, peak_db=None):
    """목표 음량까지의 보정값(dB).

    · 무음/측정불가 → 0
    · 올릴 때는 트루피크가 PEAK_CEIL_DB 를 넘지 않을 만큼만 올린다
    · 내릴 때는 MIN_GAIN_DB 까지 (너무 작아지지 않게)
    """
    if lufs is None:
        return 0.0
    try:
        lufs = float(lufs)
    except Exception:                                          # noqa: BLE001
        return 0.0
    if lufs <= SILENT_LUFS:
        return 0.0
    gain = TARGET_LUFS - lufs
    if peak_db is not None:
        try:
            head = PEAK_CEIL_DB - float(peak_db)
        except Exception:                                      # noqa: BLE001
            head = None
        if head is not None and head < gain:
            gain = head
    gain = max(MIN_GAIN_DB, min(MAX_GAIN_DB, gain))
    return round(gain, 1)


def denoise_gain(gain):
    """0.1dB 미만은 손댈 필요가 없다 (재인코딩 손실만 늘어난다)."""
    try:
        g = float(gain)
    except Exception:                                          # noqa: BLE001
        return 0.0
    return 0.0 if abs(g) < 0.1 else round(g, 1)


def volume_filter(gain_db):
    """ffmpeg -af 문자열. 보정 뒤 트루피크가 넘지 않게 리미터를 안전망으로 건다.

    ⚠ alimiter 의 기본값 `level`(오토 레벨)은 소리를 limit 까지 **끌어올린다** —
    그대로 두면 +1 LU 만큼 더 커져서(실측 -14.0 → -13.0) 곡마다 목표가 흔들린다.
    `level=0` 으로 꺼야 보정값이 그대로 나간다.
    """
    g = float(gain_db)
    limiter = "alimiter=limit=%.4f:level=0" % (10 ** (PEAK_CEIL_DB / 20.0))
    return "volume=%.1fdB,%s" % (g, limiter)


def normalize(src, dst, gain_db, ext=None):
    """보정값을 적용한 사본을 만든다 (원본 컨테이너 유지).

    임시 파일도 **올바른 확장자**로 만들어야 한다 — ffmpeg 는 확장자로
    먹서를 고르기 때문에 `<dst>.part` 같은 이름은 열지 못한다(.part.m4a).
    """
    ff = ffmpeg_bin()
    if not ff:
        return {"ok": False, "error": "ffmpeg 없음"}
    ext = str(ext or os.path.splitext(dst)[1].lstrip(".")).lower()
    base = os.path.splitext(dst)[0]
    dst = base + "." + ext
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
    except Exception:                                          # noqa: BLE001
        pass
    tries = [(ext, _ENCODERS.get(ext, ["-c:a", "aac", "-b:a", "192k"]))]
    if ext not in ("m4a", "aac"):
        for fb in _FALLBACK_ENCODERS:
            tries.append(("m4a", fb))
    last = ""
    for out_ext, codec in tries:
        out = base + ".part." + out_ext
        target = base + "." + out_ext
        args = ([ff] + _FF_ARGS + ["-y", "-i", src, "-map", "a:0", "-vn",
                                   "-af", volume_filter(gain_db)] + codec + [out])
        rc, err = _run(args)
        if rc == 0 and os.path.isfile(out) and os.path.getsize(out) > 1024:
            try:
                os.replace(out, target)
            except Exception as e:                             # noqa: BLE001
                return {"ok": False, "error": str(e)}
            if target != dst:                    # 폴백 컨테이너로 만들었다
                try:
                    if os.path.exists(dst):
                        os.remove(dst)
                except Exception:                              # noqa: BLE001
                    pass
                return {"ok": True, "path": target, "fallback": True}
            return {"ok": True, "path": target, "fallback": False}
        lines = [l for l in (err or "").strip().splitlines() if l.strip()]
        last = lines[-1] if lines else ""
        try:
            if os.path.exists(out):
                os.remove(out)
        except Exception:                                      # noqa: BLE001
            pass
    return {"ok": False, "error": "정규화 실패: " + last[:160]}


# ── 곡 하나 처리 (분석 → 사본 → 기록할 값) ─────────────────────────────
def process(mid, src, ext=None, force=False):
    """곡 하나를 재고 사본을 만든다.

    반환: 곡 기록에 그대로 합쳐 넣을 dict
      norm_state : done | silent | unavailable | error
      gain_db    : 송출 때 적용할 보정값
      norm_lufs / norm_peak_db / norm_at / norm_ext
    """
    ext = str(ext or (os.path.splitext(src)[1].lstrip(".") if src else "")).lower()
    if not mid:
        return {"norm_state": "error", "norm_error": "곡 id 없음"}
    if not src:
        return {"norm_state": "error", "norm_error": "음원 없음"}
    if not available():
        return {"norm_state": "unavailable", "norm_error": "ffmpeg 없음"}
    m = measure(src)
    if not m.get("ok"):
        return {"norm_state": "error", "norm_error": (m.get("error") or "")[:160]}
    gain = denoise_gain(gain_from(m.get("lufs"), m.get("peak_db")))
    patch = {
        "norm_lufs": m.get("lufs"),
        "norm_peak_db": m.get("peak_db"),
        "gain_db": gain,
        "norm_at": _now(),
        "norm_error": "",          # 지난 실패 메시지는 지운다
    }
    if gain == 0.0:
        patch["norm_state"] = "silent" if (m.get("lufs") is None or m["lufs"] <= SILENT_LUFS) else "done"
        # 보정이 필요 없으면 사본을 만들지 않는다 (원본이 곧 정답 — 용량·품질 손실 0)
        old = norm_path(mid, ext)
        if old and os.path.exists(old) and not force:
            try:
                os.remove(old)
            except Exception:                                  # noqa: BLE001
                pass
        return patch
    dst = norm_path(mid, ext)
    if not dst:
        patch["norm_state"] = "error"
        patch["norm_error"] = "지원하지 않는 형식: " + (ext or "?")
        return patch
    res = normalize(src, dst, gain, ext=ext)
    if not res.get("ok"):
        patch["norm_state"] = "error"
        patch["norm_error"] = (res.get("error") or "")[:160]
        return patch
    patch["norm_state"] = "done"
    patch["norm_ext"] = os.path.splitext(res["path"])[1].lstrip(".")
    return patch


def _now():
    import time
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ── 여러 곡 상태 (관리 화면·계약 검사용) ───────────────────────────────
def status(records):
    """곡 기록 dict → {total, done, pending, ffmpeg} 요약."""
    rows = list((records or {}).values()) if isinstance(records, dict) else list(records or [])
    done = sum(1 for r in rows if isinstance(r, dict) and r.get("norm_state") == "done")
    return {
        "ffmpeg": available(),
        "ffmpeg_bin": ffmpeg_bin() or "",
        "total": len(rows),
        "done": done,
        "pending": max(0, len(rows) - done),
        "target_lufs": TARGET_LUFS,
    }


def json_dump(obj):                                            # pragma: no cover
    return json.dumps(obj, ensure_ascii=False)
