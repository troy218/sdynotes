"""PDF/Word import engine + import endpoints.

Formula reconstruction is kept separate from the geometry/typography layer.
Import and high-resolution backgrounds share an immutable per-page paint plan.
"""
import base64
import hashlib
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

import pymupdf
from flask import Response, jsonify, request, send_from_directory
from PIL import Image

from .cloud import _publish_live
from .common import BASE_DIR, DOCS_DIR, IMG_DIR, JOBS_DIR, UPLOAD_DIR
from .core import app
from .notify import _notify_add
from .pdf_paint import filter_glyphs as _pdf_filter_glyphs
from .pdf_layout import (contained as _pdf_contained, intersects as _pdf_intersects,
                         font_map as _pdf_font_map, detect_regions,
                         text_elements as _pdf_text_elements)


# ============ 문서 가져오기 (PDF / Word → 편집 가능한 요소) ============
# PDF 와 Word 를 읽어서 프런트의 문서 형식(pages[].els[])으로 변환한다.
#  · 글자 → type:'text'   (띄어쓰기 단위 단어별 상자, 정확한 위치)
#  · 그림 → type:'image'  (배경: 원본 그대로)
# 프런트 A4 용지 방향에 맞춰 세로 800 x 1100 또는 가로 1100 x 800
# 좌표계로 환산한다. 한 문서 안에 방향이 섞이면 더 많은 쪽의 방향을 따른다.

PAGE_W, PAGE_H = 800, 1100
PAGE_PRESETS = {
    "a4_portrait": (800, 1100),
    "a4_landscape": (1100, 800),
}


def _preset_dims(size_preset):
    return PAGE_PRESETS.get(size_preset, PAGE_PRESETS["a4_portrait"])


def _pdf_size_preset(src):
    """PDF 쪽 비율의 다수결로 노트의 세로/가로 용지를 고른다."""
    doc = None
    try:
        doc = pymupdf.open(src)
        portrait = landscape = 0
        for pno in range(min(doc.page_count, IMPORT_MAX_PAGES)):
            rect = doc[pno].rect
            if rect.width > rect.height:
                landscape += 1
            else:
                portrait += 1
        return "a4_landscape" if landscape > portrait else "a4_portrait"
    except Exception as e:
        print(f"[import] PDF 방향 판별 실패, 세로로 처리: {e}")
        return "a4_portrait"
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass


def _docx_size_preset(data):
    """Word 구역(section) 용지 비율의 다수결로 세로/가로를 고른다."""
    try:
        from docx import Document
        from docx.enum.section import WD_ORIENT
        word_doc = Document(io.BytesIO(data))
        portrait = landscape = 0
        for section in word_doc.sections:
            is_landscape = section.orientation == WD_ORIENT.LANDSCAPE
            if is_landscape or int(section.page_width or 0) > int(section.page_height or 0):
                landscape += 1
            else:
                portrait += 1
        return "a4_landscape" if landscape > portrait else "a4_portrait"
    except Exception as e:
        print(f"[import] Word 방향 판별 실패, 세로로 처리: {e}")
        return "a4_portrait"


IMPORT_MAX_MB = 120
IMPORT_MAX_PAGES = 1200    # 500쪽+ 원서 대응
IMPORT_BG_DPI = 300       # 배경 래스터 해상도 (SVG 실패/사진 쪽 예비값)
IMPORT_BG_MAX_PX = 9_000_000   # 배경 래스터 픽셀 상한 (고화질 사진 대응)
# 쪽 수가 많으면 디스크/변환 시간을 위해 화질을 자동 조절 (자식 프로세스별 적용)
BG_DPI_CUR = IMPORT_BG_DPI
BG_PX_CUR = IMPORT_BG_MAX_PX


BG_JPEG_Q = 62      # 배경 JPEG 품질 (글자는 텍스트 상자로 분리돼 있어 넉넉함)


def _bg_tier(total):
    if total >= 400:
        return 150, 2_500_000
    if total >= 200:
        return 170, 3_000_000
    return 200, 4_000_000


def _save_import_svg(svg_text):
    """배경 SVG 를 파일로 저장하고 주소를 돌려준다."""
    try:
        # 공백을 줄여 크기를 아낀다 (내용은 그대로)
        s = re.sub(r">\s+<", "><", svg_text)
        s = re.sub(r"[ \t]{2,}", " ", s)
        name = f"{uuid.uuid4().hex[:16]}.svg"
        with open(os.path.join(IMG_DIR, name), "w", encoding="utf-8") as fp:
            fp.write(s)
        return f"/api/import/img/{name}"
    except Exception:
        return None


class _NoBackground(Exception):
    """이 쪽은 배경(그림·선)이 없어 굽지 않는다는 내부 신호."""


def _save_pixmap_bg(pm):
    """픽스맵을 곧바로 파일로 굽는다 (base64/Pillow 왕복 없음).

    옛 경로: pixmap → PNG bytes → Pillow 열기 → 재인코딩 → base64 →
             다시 디코드 → 파일. 쪽당 0.5초 이상을 여기서 태웠다.
    새 경로: pixmap → (JPEG|PNG) → 파일. 같은 화질에 수십 배 빠르다.
    글자는 이미 텍스트 상자로 분리돼 배경엔 그림·선만 남으므로
    JPEG 로 구워도 눈에 보이는 손해가 없다.
    """
    try:
        # 배경은 두 부류다.
        #  · 선화(그래프·표·도형): 색이 몇 가지뿐 → PNG 가 몇 배 작고 선명
        #  · 사진: 색이 많음 → JPEG 가 몇 배 작다
        # 픽셀을 성기게 훑어 색 가짓수로 판별한다 (수 ms).
        photo = False
        try:
            s = pm.samples
            nch = pm.n
            npx = pm.width * pm.height
            if nch >= 3 and npx > 0:
                step = max(1, npx // 20000)
                cols = set()
                for i in range(0, npx, step):
                    o = i * nch
                    cols.add(s[o:o + 3])
                    if len(cols) > 700:
                        photo = True
                        break
        except Exception:
            photo = pm.n >= 3

        if photo:
            name = f"{uuid.uuid4().hex[:16]}.jpg"
            pm.save(os.path.join(IMG_DIR, name), jpg_quality=BG_JPEG_Q)
        else:
            name = f"{uuid.uuid4().hex[:16]}.png"
            pm.save(os.path.join(IMG_DIR, name))
        return f"/api/import/img/{name}"
    except Exception as e:
        print(f"[import] 배경 저장 실패: {e}")
        return None


def _save_import_img(data_url):
    """data URL 을 파일로 저장하고 짧은 주소를 돌려준다.

    문서에 그림을 통째로 넣으면 브라우저 저장 한도를 넘겨
    노트가 통째로 사라진다. 주소만 넣으면 수십 배 가볍다.
    """
    try:
        head, b64data = data_url.split(",", 1)
        ext = "png" if "png" in head else "jpg"
        raw = base64.b64decode(b64data)
        name = f"{uuid.uuid4().hex[:16]}.{ext}"
        with open(os.path.join(IMG_DIR, name), "wb") as fp:
            fp.write(raw)
        return f"/api/import/img/{name}"
    except Exception:
        return data_url          # 실패하면 원래대로


@app.route("/api/import/img/<path:name>", methods=["GET"])
def import_img(name):
    """가져오기로 만들어진 배경(벡터 SVG 또는 그림)"""
    if not re.fullmatch(r"[0-9a-f]{8,32}\.(png|jpg|svg)", name or ""):
        return jsonify({"error": "잘못된 이름"}), 400
    path = os.path.join(IMG_DIR, name)
    if not os.path.exists(path):
        return jsonify({"error": "없는 파일"}), 404

    if name.endswith(".svg"):
        with open(path, "rb") as fp:
            raw = fp.read()
        # 벡터는 글자 정보가 많아 압축 효과가 크다 (약 1/8)
        if "gzip" in (request.headers.get("Accept-Encoding") or "").lower():
            import gzip as _gz
            body = _gz.compress(raw, 6)
            resp = Response(body, mimetype="image/svg+xml")
            resp.headers["Content-Encoding"] = "gzip"
        else:
            resp = Response(raw, mimetype="image/svg+xml")
        resp.headers["Content-Length"] = str(len(resp.get_data()))
        resp.headers["Cache-Control"] = "public, max-age=31536000"
        return resp

    resp = send_from_directory(IMG_DIR, name)
    resp.headers["Cache-Control"] = "public, max-age=31536000"
    return resp


# ── 슬라이스 메모리 캐시 ────────────────────────────────────────────────
# 이미 만들어 둔 노트를 여는 경로(GET .s{n}.gz)는 읽기 전용 gzip 파일을 그대로
# 흘려보낸다. 같은 파일을 열 때마다 디스크를 때리지 않도록 최근 것만 담아 둔다.
# 키에 ETag(수정시각+크기)를 넣으므로, 저장으로 파일이 바뀌면 캐시는 자동으로
# 빗나가고 새 내용을 읽는다 — 오래된 본문이 나갈 수 없다.
try:                       # (_imp_env_int 는 이 파일 아래쪽에서 정의된다)
    _SLICE_CACHE_MAX = max(16, int(os.environ.get("SDY_SLICE_CACHE_MAX", "512")))
except (TypeError, ValueError):
    _SLICE_CACHE_MAX = 512                                    # 슬라이스 개수
_slice_cache = {}
_slice_cache_lock = threading.Lock()


def _slice_cache_get(path, etag):
    key = (path, etag)
    with _slice_cache_lock:
        hit = _slice_cache.get(key)
        if hit is not None:
            _slice_cache.pop(key, None)     # LRU: 최근 쓴 것을 뒤로
            _slice_cache[key] = hit
            return hit
    with open(path, "rb") as fp:
        body = fp.read()
    with _slice_cache_lock:
        _slice_cache[key] = body
        while len(_slice_cache) > _SLICE_CACHE_MAX:
            _slice_cache.pop(next(iter(_slice_cache)), None)
    return body


@app.route("/api/import/docfile/<jid>", methods=["GET", "POST"])
def import_docfile(jid):
    """대용량 문서 본문 서버 보관소.

    브라우저 localStorage(약 5MB) 를 넘기는 문서는 기기 대신 여기에 두고,
    프런트는 참조 번호만 기억한다. 편집분도 여기로 저장된다.
    """
    import gzip as _gz
    if not re.fullmatch(r"[0-9a-zA-Z_\-]{4,40}", jid or ""):
        return jsonify({"error": "잘못된 이름"}), 400
    path = os.path.join(DOCS_DIR, f"{jid}.json.gz")
    if request.method == "POST":
        d = request.get_json(silent=True) or {}
        pages = d.get("pages")
        if not isinstance(pages, list):
            return jsonify({"ok": False, "error": "pages 없음"}), 400
        # 14.4 · 슬라이스만 갱신 (번역/편집분을 원본 문서에 저장).
        # 전체 pages 를 다시 올리면 대용량 문서에서 타임아웃·유실이 난다.
        s0_in = d.get("from")
        if s0_in is not None:
            try:
                s0 = int(s0_in)
            except Exception:
                return jsonify({"ok": False, "error": "from 오류"}), 400
            if s0 < 0 or (s0 % IMP_SLICE) != 0:
                return jsonify({"ok": False, "error": "from 오류"}), 400
            try:
                total_n = int(d.get("total") or (s0 + len(pages)))
                chunk = pages[:IMP_SLICE]
                sp = os.path.join(DOCS_DIR, f"{jid}.s{s0}.gz.tmp")
                with _gz.open(sp, "wt", encoding="utf-8") as fp:
                    json.dump({"ok": True, "pages": chunk, "total": total_n},
                              fp, ensure_ascii=False)
                os.replace(sp, os.path.join(DOCS_DIR, f"{jid}.s{s0}.gz"))
                if os.path.exists(path):
                    try:
                        with _gz.open(path, "rt", encoding="utf-8") as fp:
                            data_ = json.load(fp)
                        allp = data_.get("pages") if isinstance(data_, dict) else None
                        if isinstance(allp, list):
                            for i, pg in enumerate(chunk):
                                idx = s0 + i
                                if idx < len(allp):
                                    allp[idx] = pg
                                elif idx == len(allp):
                                    allp.append(pg)
                            tmpf = "%s.tmp.%s" % (path, uuid.uuid4().hex[:8])
                            with _gz.open(tmpf, "wt", encoding="utf-8") as fp:
                                json.dump({"pages": allp,
                                           "sizePreset": d.get("sizePreset")
                                           or data_.get("sizePreset", "a4_portrait")},
                                          fp, ensure_ascii=False)
                            os.replace(tmpf, path)
                    except Exception:
                        pass
                mp = os.path.join(DOCS_DIR, f"{jid}.meta.json.tmp")
                with open(mp, "w", encoding="utf-8") as fp:
                    json.dump({"total": total_n,
                               "sizePreset": d.get("sizePreset", "a4_portrait"),
                               "version": time.time()}, fp)
                os.replace(mp, os.path.join(DOCS_DIR, f"{jid}.meta.json"))
                try:
                    _publish_live("notes", "")
                except Exception:
                    pass
                return jsonify({"ok": True, "slice": s0, "version": time.time()})
            except Exception as e:
                return jsonify({"ok": False, "error": str(e)}), 500
        try:
            total_n = len(pages)
            for s0 in range(0, total_n, IMP_SLICE):
                sp = os.path.join(DOCS_DIR, f"{jid}.s{s0}.gz.tmp")
                with _gz.open(sp, "wt", encoding="utf-8") as fp:
                    json.dump({"ok": True, "pages": pages[s0:s0 + IMP_SLICE],
                               "total": total_n}, fp, ensure_ascii=False)
                os.replace(sp, os.path.join(DOCS_DIR, f"{jid}.s{s0}.gz"))
            for s0 in range(((total_n // IMP_SLICE) + 1) * IMP_SLICE,
                            ((total_n // IMP_SLICE) + 5) * IMP_SLICE, IMP_SLICE):
                oldp = os.path.join(DOCS_DIR, f"{jid}.s{s0}.gz")
                if os.path.exists(oldp):
                    os.remove(oldp)
            mp = os.path.join(DOCS_DIR, f"{jid}.meta.json.tmp")
            with open(mp, "w", encoding="utf-8") as fp:
                json.dump({"total": total_n,
                           "sizePreset": d.get("sizePreset", "a4_portrait"),
                           "version": time.time()}, fp)
            os.replace(mp, os.path.join(DOCS_DIR, f"{jid}.meta.json"))
            tmp = "%s.tmp.%s" % (path, uuid.uuid4().hex[:8])
            with _gz.open(tmp, "wt", encoding="utf-8") as fp:
                json.dump({"pages": pages,
                           "sizePreset": d.get("sizePreset", "a4_portrait")},
                          fp, ensure_ascii=False)
            os.replace(tmp, path)
            return jsonify({"ok": True})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    meta_path = os.path.join(DOCS_DIR, f"{jid}.meta.json")
    slice0 = os.path.join(DOCS_DIR, f"{jid}.s0.gz")
    if not (os.path.exists(path) or os.path.exists(meta_path)
            or os.path.exists(slice0)):
        return jsonify({"ok": False, "error": "없는 문서"}), 404
    if request.args.get("meta") == "1":
        try:
            with open(meta_path, encoding="utf-8") as fp:
                m = json.load(fp)
            return jsonify({"ok": True, "version": m.get("version", 0),
                            "total": m.get("total", 0)})
        except Exception:
            pass
        try:   # 옛 단일 파일 폴백
            st = os.stat(path)
            with _gz.open(path, "rt", encoding="utf-8") as fp:
                total = len(json.load(fp).get("pages", []))
            return jsonify({"ok": True, "version": st.st_mtime, "total": total})
        except Exception:
            return jsonify({"ok": False, "error": "읽기 실패"}), 500
    fr = request.args.get("from", type=int)
    to = request.args.get("to", type=int)
    if fr is not None:
        fr = max(0, fr)
        to = fr + IMP_SLICE if to is None else max(fr, min(fr + IMP_SLICE, to))
        # 정렬된 슬라이스면 파싱 없이 압축 그대로 스트리밍 (메모리 최소화)
        if fr % IMP_SLICE == 0 and (to - fr) <= IMP_SLICE:
            sp = os.path.join(DOCS_DIR, f"{jid}.s{fr}.gz")
            if os.path.exists(sp):
                # 14.29.4 · 노트 여는 속도.
                #   같은 슬라이스를 열 때마다 디스크에서 다시 읽었다. 이제
                #   ① 조건부 요청(ETag) → 안 바뀌었으면 304 만 보내고 본문 0바이트
                #   ② 최근 슬라이스는 메모리에 캐시 → 디스크 I/O 자체를 건너뜀
                #   ETag 는 (수정시각, 크기) 라 저장(POST)하면 즉시 달라진다.
                st = os.stat(sp)
                etag = '"%x-%x"' % (int(st.st_mtime_ns), st.st_size)
                inm = request.headers.get("If-None-Match") or ""
                if etag in [t.strip() for t in inm.split(",")]:
                    resp = Response(status=304)
                    resp.headers["ETag"] = etag
                    resp.headers["Cache-Control"] = "private, max-age=0, must-revalidate"
                    return resp
                body = _slice_cache_get(sp, etag)
                resp = Response(body, mimetype="application/json")
                resp.headers["Content-Encoding"] = "gzip"
                resp.headers["ETag"] = etag
                resp.headers["Cache-Control"] = "private, max-age=0, must-revalidate"
                return resp
        # 폴백: 옛 단일 파일 또는 비정렬 범위
        if os.path.exists(path):
            with _gz.open(path, "rt", encoding="utf-8") as fp:
                data_ = json.load(fp)
            pages_all = data_.get("pages", [])
            total = len(pages_all)
            fr2 = max(0, min(fr, total))
            to2 = max(fr2, min(total, to))
            resp = jsonify({"ok": True, "pages": pages_all[fr2:to2],
                            "total": total,
                            "sizePreset": data_.get("sizePreset", "a4_portrait")})
            resp.headers["Cache-Control"] = "no-store"
            return resp
        return jsonify({"ok": False, "error": "없는 문서"}), 404
    # 디스크에 이미 gzip → 지원하면 압축 상태 그대로 스트리밍(대용량 절약)
    if "gzip" in (request.headers.get("Accept-Encoding") or "").lower():
        with open(path, "rb") as fp:
            body = fp.read()
        resp = Response(body, mimetype="application/json")
        resp.headers["Content-Encoding"] = "gzip"
    else:
        with _gz.open(path, "rt", encoding="utf-8") as fp:
            data_ = json.load(fp)
        resp = jsonify({"ok": True, "pages": data_.get("pages", []),
                        "sizePreset": data_.get("sizePreset", "a4_portrait")})
    resp.headers["Cache-Control"] = "no-store"
    return resp


# 수식 전용 글꼴. 이 목록은 의도적으로 보수적이다.
#
# Computer Modern Roman(cmr), STIXGeneral, XITS 같은 글꼴은 논문에서
# 본문에도 쓰인다. 예전에는 이름에 그 문자열이 있다는 이유만으로 span 전체를
# 수식 사진으로 잘라, 식 옆의 "where", "for" 같은 설명까지 이미지가 됐다.
# 전용 기호/수학 글꼴만 즉시 수식으로 인정하고, 겸용 글꼴은 아래의 기호·문맥
# 점수를 통과할 때만 수식으로 처리한다.
MATH_FONTS = (
    "cmmi", "cmsy", "cmex", "cmbsy", "cmssym", "msam", "msbm", "mathjax",
    "cambriamath", "lmmath", "rsfs", "eufm", "wasy", "symbol", "stmary", "esint",
    "bbm", "dsfont",
    # 10.1 · pdflatex txfonts/newtx (rtxmi·rtxbmi·txsy·txex 계열)
    "txmi", "txbmi", "txsy", "txex",
)
MATH_AMBIG_FONTS = (
    "cmr", "stixgeneral", "stix", "xits", "euclid", "texgyre",
)

# Short identifiers which are printed in roman/math fonts inside equations.
# Treating ``AdS`` or ``CFT`` as prose makes an otherwise valid display equation
# fail the all-or-nothing test and leaves a hole in the original PDF.  This list
# is deliberately restricted to notation used by mathematical/physics papers;
# ordinary English words (where, for, with, ...) remain hard boundaries.
_MATH_DOMAIN_WORDS = {
    "ads", "ds", "cft", "sym", "iib", "kk", "bps", "lsz", "qft", "ir", "uv",
    "minkowski", "feynman", "carrollian", "flat", "bulk", "boundary", "null",
    "vol", "dvol", "dd", "dmu", "measure", "delta", "mellin", "witten",
}


def _is_math_identifier(text):
    """Whether a word-shaped token is notation rather than prose.

    PDF extraction loses ``\\mathrm``/``\\text`` boundaries, so a few domain
    identifiers need a small amount of context-free help.  The acronym list is
    intentionally explicit so ordinary all-caps prose is not reclassified.
    """
    t = (text or "").strip()
    if not t:
        return False
    low = t.lower()
    if low in _MATH_WORDS or low in _MATH_DOMAIN_WORDS:
        return True
    # Keep this explicit: treating every all-caps English word as notation
    # would make headings and prose around a display equation look mathematical.
    return bool(re.fullmatch(r"(?:AdS|dS|CFT|SYM|IIB|KK|BPS|LSZ|QFT|Minkowski)[0-9]*", t))


def _math_font_style(font):
    """Return a KaTeX style implied by a TeX math font, if it is known."""
    n = re.sub(r"[^a-z0-9]", "", (font or "").split("+")[-1].lower())
    if any(k in n for k in ("msbm", "bbm", "dsfont", "blackboard", "dsss")):
        return "bb"
    if any(k in n for k in ("rsfs", "mathrsfs", "eusm")):
        return "scr"
    if any(k in n for k in ("eufm", "eufb", "mathfrak", "fraktur")):
        return "frak"
    if any(k in n for k in ("cmmib", "cmbmi", "cmbsy", "cmbx", "boldmath", "boldsymbol")):
        return "bold"
    if "cmss" in n or "sansmath" in n:
        return "sf"
    if "cmtt" in n or "typewriter" in n:
        return "tt"
    # CMSY is where Computer Modern stores uppercase calligraphic letters.
    if "cmsy" in n and not any(k in n for k in ("cmex", "cmssym")):
        return "cal"
    if ("cmr" in n or "ecrm" in n or "txr" in n or "termes" in n) and "math" not in n:
        return "rm"
    return None


def _style_latex_atom(text, style):
    """Wrap a plain math atom in the style carried by its source font."""
    if not style or not text or not text.strip():
        return text
    atom = text.strip()
    # Do not wrap operators, relation signs, or a pre-existing command.  The
    # bold Greek case is intentionally allowed: KaTeX supports
    # ``\\boldsymbol{\\xi}``, while blackboard/calligraphic operators do not
    # have useful semantics for a relation glyph.
    if atom.startswith("\\"):
        if style != "bold" or re.fullmatch(
                r"\\(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega)", atom) is None:
            return text
    elif re.fullmatch(r"(?:[A-Za-z0-9])+(?:[']*)", atom) is None:
        return text
    # Digits are already upright in math mode. Wrapping them turned every
    # exponent and index of an imported paper into \mathrm{1}/\mathrm{2},
    # which renders identically but makes the LaTeX unreadable to edit.
    if style == "rm" and atom.isdigit():
        return text
    command = {"bb": r"\mathbb", "scr": r"\mathscr", "cal": r"\mathcal",
               "frak": r"\mathfrak", "bold": r"\boldsymbol", "rm": r"\mathrm",
               "sf": r"\mathsf", "tt": r"\mathtt"}.get(style)
    return (command + "{" + atom + "}") if command else text


def _span_text(sp):
    """rawdict/dict 양쪽에서 span 글자를 안전하게 얻는다."""
    if sp.get("chars") is not None:
        return "".join(ch.get("c", "") for ch in sp.get("chars", []))
    return sp.get("text") or ""


def _fix_radical_quads(rd):
    """CMSY 루트(√) 글리프의 rawdict bbox 를 실제 잉크 위치로 옮긴다. (14.71)

    이 문서군의 CMSY10/7 '√' 는 폰트가 선언한 문자 상자가 실제 잉크보다
    약 0.75em 위에 있다(잉크 검증: sz10 에 +7.4~8.1pt, sz7 에 +5.25pt).
    유령 bbox 때문에 √ 만 있는 rawdict 줄이 제 산문 행과 묶이지 못해
    (p39 'K₀=√2I' · p76 '=√kV') 밴드 씨앗이 되거나 디스플레이 밴드가
    산문 행까지 자라났고, 분수 조립에서 √ 가 분자로 새어 `\sqrt{}` 가
    사라지기도 했다. bbox 를 아래로 0.75×size 옮기고 해당 span/줄 상자를
    다시 계산한다.
    """
    try:
        for blk in rd.get("blocks", []):
            if blk.get("type") != 0:
                continue
            for ln in blk.get("lines", []):
                ln_dirty = False
                for sp in ln.get("spans", []):
                    fname = (sp.get("font") or "").split("+")[-1].upper()
                    if "CMSY" not in fname and "CMBSY" not in fname:
                        continue
                    size = float(sp.get("size") or 10)
                    moved = False
                    for ch in (sp.get("chars") or []):
                        if ch.get("c") == "√" and ch.get("bbox"):
                            bb = ch["bbox"]
                            dy = 0.75 * size
                            ch["bbox"] = [bb[0], bb[1] + dy, bb[2], bb[3] + dy]
                            moved = True
                    if moved:
                        bxs = [c["bbox"] for c in (sp.get("chars") or [])
                               if c.get("bbox")]
                        if bxs:
                            sp["bbox"] = [min(b[0] for b in bxs),
                                          min(b[1] for b in bxs),
                                          max(b[2] for b in bxs),
                                          max(b[3] for b in bxs)]
                        ln_dirty = True
                if ln_dirty:
                    lb = [sp.get("bbox") for sp in ln.get("spans", [])
                          if sp.get("bbox")]
                    if lb:
                        ln["bbox"] = [min(b[0] for b in lb),
                                      min(b[1] for b in lb),
                                      max(b[2] for b in lb),
                                      max(b[3] for b in lb)]
    except Exception:
        pass
    return rd


def _page_rawdict(page):
    """√ bbox 가 보정된 rawdict. rawdict 를 읽는 모든 경로는 이걸 쓴다."""
    return _fix_radical_quads(page.get_text("rawdict"))

# 물리·수학 논문은 일반 Times/Arial 글꼴로 식을 심는 경우가 많다.
# 글꼴 이름만 믿지 않고, 기호 밀도·첨자·관계식 패턴도 함께 본다.
_MATH_SIGNS = set("=≠≈≃≅≤≥±∓×÷·⋅∂∇∫∮∑∏√∞∝∈∉⊂⊃∪∩→←↔↦⇒⇔∀∃∇∆∥⊥∼∘ℝℂℤℕℚ〈〉⟨⟩")
_GREEK_RE = re.compile(r"[αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]")


def _formula_score(text):
    t = (text or "").strip()
    if not t:
        return 0
    signs = sum(ch in _MATH_SIGNS for ch in t)
    greek = len(_GREEK_RE.findall(t))
    # e.g. E = mc², Ĥψ = Eψ, d²x/dt², k_B T
    score = signs * 2 + greek * 2
    if re.search(r"[A-Za-zα-ωΑ-Ω]\s*[=≈≃≠≤≥]\s*", t): score += 4
    if re.search(r"(?:d|∂)\s*[A-Za-zα-ω]|[A-Za-zα-ω]\s*/\s*(?:d|∂)", t): score += 3
    if re.search(r"[A-Za-zα-ω]\s*[_^]\s*[A-Za-z0-9α-ω]", t): score += 2
    if re.search(r"\b(?:sin|cos|tan|exp|log|lim|det|Tr|curl|grad|div)\b", t): score += 2
    return score


_MATH_WORDS = {
    "sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh", "coth",
    "arcsin", "arccos", "arctan", "arg", "exp", "log", "ln", "lg",
    "lim", "limsup", "liminf", "det", "tr", "trace", "curl", "grad", "div",
    "max", "min", "sup", "inf", "mod", "rank", "diag", "eff", "tot", "ext", "avg", "rms", "rmsnorm",
    "ric", "scal", "vol", "diam", "inj", "hess", "deg", "sgn", "sign", "span", "ker", "im", "re",
    "hom", "aut", "gl", "sl", "so", "su", "dim", "codim", "supp", "const", "var", "cov",
    "erf", "sinc", "pr", "opt", "attn", "top", "topk", "mlp", "ffn", "gelu", "relu",
    "softmax", "proj", "qkv", "mqa", "gqa", "kv", "hbm", "hbf", "gpu", "sram", "tsv", "ecc",
    "base", "out", "gate", "route", "gcd", "lcm"
}

_COMMON_PROSE = {
    "in", "if", "as", "to", "then", "where", "let", "we", "have", "and", "for", "with", "by", "is", "are",
    "of", "that", "this", "such", "each", "there", "from", "which", "also", "shows", "under", "above",
    "below", "given", "thus", "hence", "so", "holds", "true", "equal", "obtain", "proves", "note", "finally",
    "define", "using", "proof", "theorem", "lemma", "corollary", "proposition", "remark", "assume", "assuming",
    "suppose", "follows", "particular", "section", "recall", "fact", "indeed", "clearly", "similarly",
    "furthermore", "moreover", "therefore", "because", "since", "seen", "easily", "integrating", "integrate",
    "consider", "taking", "definition", "identity", "satisfies", "denote", "denotes", "denoting", "satisfy",
}


# ─────────────────────────────────────────────────────────────
#  9.0 · 인용 번호는 '언제나 텍스트'
# ─────────────────────────────────────────────────────────────
#  논문 본문의 [12] · [3–5] · [1, 4, 9] · (2024) · 위첨자 12,13 은
#  참고문헌 번호지 수식이 아니다. 예전에는 글꼴·크기·베이스라인에 따라
#  어떤 것은 LaTeX 로, 어떤 것은 텍스트로 갈렸다(= 사용자가 말한 '들쭉날쭉').
#  판정을 이 한 곳에 모아 두고, 수식 판정기 전부가 여기를 먼저 통과하게 해서
#  인용 번호는 예외 없이 일반 글자 상자로 남긴다.
_CITE_BRACKET = re.compile(
    r"^[\[\(]\s*\d{1,4}(?:\s*[-–—,;]\s*\d{1,4})*\s*[\]\)][.,;:]?$")
_CITE_BARE = re.compile(r"^\d{1,3}(?:\s*[-–—,]\s*\d{1,3})*[.,;:]?$")
_CITE_SUPCHARS = set("⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁼⁽⁾,-–—")
_SUP_DIGITSET = set("⁰¹²³⁴⁵⁶⁷⁸⁹")


def _is_citation_token(text, superscript=False):
    """이 토막이 참고문헌/각주 번호인가?  (수식이면 안 되는 것들)"""
    t = (text or "").strip()
    if not t or len(t) > 24:
        return False
    if _CITE_BRACKET.match(t):
        return True
    # 유니코드 위첨자만으로 이뤄진 것 → ¹²·⁵⁻⁷
    if t and all(ch in _CITE_SUPCHARS for ch in t) and any(ch in _SUP_DIGITSET for ch in t):
        return True
    # 위첨자로 조판된 맨숫자 → 12, 3–5, 1,2
    if superscript and _CITE_BARE.match(t):
        return True
    return False


def _line_is_citation_only(text):
    """줄 전체가 인용 번호 뭉치인지 (예: '[12, 15–18]')"""
    t = (text or "").strip()
    if not t:
        return False
    parts = [p for p in re.split(r"\s+", t) if p]
    return bool(parts) and all(_is_citation_token(p) for p in parts)


def _is_formula_only(text):
    """수식 자체인지 판정한다.

    물리 논문의 설명문까지 그림으로 굳어 버리지 않도록, 기호 점수만 보지 않고
    일반 단어(prose)가 섞였는지 확인한다. 예: 'where E is energy'는 제외하고
    'E = mc²', 'iℏ∂ψ/∂t = Hψ'만 통과시킨다.
    """
    t=(text or "").strip()
    if not t or _formula_score(t) < 5 or len(t) > 180:
        return False
    words=re.findall(r"[A-Za-z]{2,}", t)
    prose=[w for w in words if not _is_math_identifier(w)]
    # 2글자 이상 일반 단어가 둘 이상이면 문장으로 간주한다.
    return len(prose) <= 1


def _is_math_span(sp):
    """span 하나가 정말 '수식만' 담고 있는지 보수적으로 판정한다.

    수식 전용 글꼴은 그대로 인정한다. 본문과 수식 양쪽에 쓰이는 CMR/STIX/XITS
    계열은 글꼴 이름만으로 인정하지 않고, span 자체가 수식 모양일 때만 인정한다.
    일반 글꼴 역시 강한 수식 패턴이 있을 때만 이미지화한다.
    """
    name = (sp.get("font") or "").lower().replace("-", "").replace(" ", "")
    text = _span_text(sp)
    # [12], [3–5], (2024), ¹² 같은 인용/각주 표시는 절대 수식이 되지 않는다. (9.0)
    if _is_citation_token(text, superscript=bool(sp.get("_sup"))):
        return False
    if any(k in name for k in MATH_FONTS):
        # 전용 글꼴이어도 긴 일반 단어(where, energy...)는 본문으로 남긴다.
        # 짧은 변수(E, mc, kB)와 함수(sin 등)는 수식 조각으로 인정한다.
        words = [w for w in re.findall(r"[A-Za-z]{2,}", text)
                 if w.lower() not in _MATH_WORDS]
        if len(words) > 1 or any(len(w) >= 4 for w in words):
            return False
        return bool(text.strip())
    if any(k in name for k in MATH_AMBIG_FONTS):
        return _is_formula_only(text) and _formula_score(text) >= 5
    if _is_formula_only(text):
        return True
    # '='·'≤' 같은 연산자가 별도 span으로 분리된 PDF. 그 조각도 수식 영역에
    # 포함해야 좌우의 변수 span과 병합되어 식 한 장이 된다.
    compact=(text or "").strip()
    return bool(compact and not re.search(r"[A-Za-z가-힣]", compact)
                and _formula_score(compact) >= 2)


def _spans_to_clean_latex(spans):
    """PDF spans → 고품질 LaTeX 수식 문자열 (13.4 · 위첨자/아래첨자/연산자/기호 정밀 보존)."""
    szs = [float(sp.get("size") or 10) for sp in spans if any((ch.get("c") or "").strip() for ch in sp.get("chars", []))]
    if not szs:
        szs = [float(sp.get("size") or 10) for sp in spans if sp.get("text", "").strip()]
    if not szs:
        return ""
    base_sz = sorted(szs)[len(szs) // 2]

    origins = []
    for sp in spans:
        for ch in sp.get("chars", []):
            if (ch.get("c") or "").strip():
                if ch.get("origin"):
                    origins.append(ch["origin"][1])
                elif ch.get("bbox"):
                    origins.append(ch["bbox"][3])
    base_y = sorted(origins)[len(origins) // 2] if origins else 0

    tokens = []
    for sp in spans:
        sz = float(sp.get("size") or 10)
        font = (sp.get("font") or "").lower()
        chars = sp.get("chars", [])
        if not chars:
            t = sp.get("text", "")
            if t:
                tokens.append({"t": t, "sz": sz, "y": base_y, "font": font,
                               "style": _math_font_style(font), "mode": "normal"})
            continue
        for ch in chars:
            c = ch.get("c", "")
            if not c:
                continue
            oy = ch["origin"][1] if ch.get("origin") else ch["bbox"][3]
            mode = "normal"
            if sz < base_sz * 0.88 or abs(oy - base_y) >= base_sz * 0.14:
                if oy < base_y - base_sz * 0.10:
                    mode = "sup"
                elif oy > base_y + base_sz * 0.10:
                    mode = "sub"
            tokens.append({"t": c, "sz": sz, "y": oy, "font": font,
                           "style": _math_font_style(font), "mode": mode})

    groups = []
    for tok in tokens:
        same_style = groups and groups[-1].get("style") == tok.get("style")
        if groups and same_style and groups[-1]["mode"] == tok["mode"] and tok["mode"] in ("sub", "sup"):
            groups[-1]["t"] += tok["t"]
        elif (groups and same_style and groups[-1]["mode"] == tok["mode"] == "normal"
              and tok["t"].isalnum() and groups[-1]["t"].isalnum()):
            groups[-1]["t"] += tok["t"]
        else:
            groups.append(dict(tok))

    res = []
    for g in groups:
        t = g["t"]
        mode = g["mode"]
        style = g.get("style")
        for ch, sym in _LATEX_GREEK.items():
            t = t.replace(ch, f" \\{sym} ")
        for ch, sym in _LATEX_SYMBOLS.items():
            t = t.replace(ch, f" {sym} ")
        t = t.replace("−", "-").replace("¯g", r"\bar{g}").replace("¯", r"\bar")

        if mode == "sub":
            clean_sub = t.strip()
            if clean_sub.lower() in _MATH_WORDS:
                res.append(r"_{\text{" + clean_sub + r"}}")
            else:
                res.append("_{" + _style_latex_atom(clean_sub, style) + "}")
        elif mode == "sup":
            res.append("^{" + _style_latex_atom(t.strip(), style) + "}")
        else:
            if t.strip().lower() in _MATH_WORDS and len(t.strip()) >= 2:
                word = t.strip()
                if word.lower() in {"sin", "cos", "tan", "exp", "log", "ln", "lim", "det", "dim", "min", "max", "sup", "inf"}:
                    res.append(f"\\{word.lower()} ")
                else:
                    res.append(r"\text{" + word + r"} ")
            else:
                res.append(_style_latex_atom(t, style))

    out = "".join(res)
    out = re.sub(r"\s+", " ", out).strip()
    return _bind_accents(out)


def _bind_accents(t):
    r"""Give each accent command a base atom, whichever side it was emitted on.

    PDF extraction hands back the accent and its letter as two independent
    glyphs, and their order depends on the producer.  Both ``\hat v`` and
    ``v \hat`` must become ``\hat{v}``; a trailing ``\hat`` that then meets a
    subscript is the ``v \hat _{i}`` parse error users reported.
    """
    if not t or "\\" not in t:
        return t
    # 14.46 · 끝에 \b 가 없으면 \ddot 이 \ddots 를 잡아먹는다
    #   ('\\ddot' + 's' → \ddot{s}). 줄임표(\dots \ddots)가 매번 \dot{s} 로
    #   깨졌다 — 행렬에서 줄임표는 가장 흔한 칸 내용이다.
    acc = r"\\(?:" + _ACCENT_NAMES + r")\b"
    atom = r"\\[A-Za-z]+(?:\{[^{}]*\})?|\{[^{}]*\}|[A-Za-z0-9]"
    for _ in range(4):
        prev = t
        # accent BEFORE its base — the common TeX order.
        t = re.sub(r"(" + acc + r")\s*(" + atom + r")(?![A-Za-z])",
                   lambda m: m[1] + "{" + m[2].strip("{}") + "}", t)
        # accent AFTER its base. A bare ``{...}`` group is NOT eligible: it
        # usually belongs to a preceding _/^, and adopting it would silently
        # move a subscript inside the accent.
        t = re.sub(r"(?<![A-Za-z{_^\\])([A-Za-z0-9]|\\[A-Za-z]+(?:\{[^{}]*\})?)\s*("
                   + acc + r")(?![A-Za-z{])",
                   lambda m: m[2] + "{" + m[1] + "}", t)
        if t == prev:
            break
    # Anything still bare would be a KaTeX parse error; an accent on nothing
    # carries no information, so drop the command instead of the equation.
    t = re.sub(r"(" + acc + r")(?![A-Za-z{])", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _is_display_formula_line(ln):
    """한 줄 전체를 LaTeX로 쓸지, 전체를 텍스트로 쓸지 결정한다. (13.4)

    부분 변환은 하지 않는다. 설명 문장이 섞인 줄은 수식이 있어도 전부 텍스트,
    독립된 식으로 확실한 줄만 전부 LaTeX가 된다.
    """
    spans = ln.get("spans", [])
    text = "".join(_span_text(sp) for sp in spans).strip()
    if not text or len(text) > 240:
        return False
    # 9.0 · 인용 번호 줄은 언제나 텍스트
    if _line_is_citation_only(text):
        return False
    # 9.0 · 식 번호만 떼어낸 조각([12] 처럼 보이는 (3))도 텍스트로
    if _CITE_BRACKET.match(text):
        return False
    # 설명 단어가 하나라도 있으면 수식 일부가 있어도 줄 전체를 텍스트로 유지
    # 14.3 · if/of/in 같은 2글자 산문도 수식 줄로 만들지 않는다.
    # 14.71 · 산문 낱말 판정은 _span_prose_words (첨자 크기 로만 라벨
    # 'typ'·'diag' 는 산문이 아니므로 식 줄이 텍스트로 둔갑하지 않는다).
    prose_hits, prose_nonmath = _span_prose_words(spans)
    if prose_hits or prose_nonmath:
        return False
    score = _formula_score(text)
    if score >= 4:
        return True
    total = math_n = 0
    for sp in spans:
        t = _span_text(sp).strip()
        if not t: continue
        total += len(t)
        name = (sp.get("font") or "").lower().replace("-", "").replace(" ", "")
        if any(k in name for k in MATH_FONTS): math_n += len(t)
    ratio = (math_n / total) if total else 0
    return ratio >= 0.35 or any(sym in text for sym in ["≥", "≤", "=", "→", "∈", "λ", "ϵ", "α", "δ", "η", "γ", "θ"])


def _display_region_of_line(ln, page=None, gtables=None, rules=None,
                             vlines=None):
    """디스플레이 수식 줄에서 '식 본체'만의 영역을 돌려준다. (13.4)

    논문 수식 줄은 대개  ─  ψ(x) = A e^{ikx}          (3)  ─  처럼
    오른쪽 끝(가끔 왼쪽 끝)에 식 번호가 멀찍이 떨어져 붙어 있다.
    여기서 식 번호를 떼어내고, 식 본체는 고품질 KaTeX 수식으로 보존한다.

    반환: (x0, y0, x1, y1, text, size) 또는 None
    """
    spans = ln.get("spans", [])
    if not spans:
        return None
    toks = []
    for sp in spans:
        chars = sp.get("chars") or []
        size = float(sp.get("size") or 10)
        if not chars:
            t = _span_text(sp).strip()
            bb = sp.get("bbox")
            if t and bb:
                toks.append({"t": t, "b": list(bb), "sz": size})
            continue
        cur = []

        def _flush():
            if not cur:
                return
            txt = "".join(c.get("c") or "" for c in cur).strip()
            bxs = [c.get("bbox") for c in cur if c.get("bbox")]
            if txt and bxs:
                toks.append({"t": txt, "sz": size,
                             "b": [min(b[0] for b in bxs), min(b[1] for b in bxs),
                                   max(b[2] for b in bxs), max(b[3] for b in bxs)]})
            cur.clear()

        previous = None
        for ch in chars:
            if not (ch.get("c") or "").strip():
                _flush()
                previous = None
                continue
            bb = ch.get("bbox")
            # Equation labels produced by \hfill/eqnarray frequently share a
            # span with the formula but contain no literal space glyph.  A large
            # advance is a token boundary for label detection; normal kerning is
            # far below this threshold.
            if (cur and previous and bb
                    and bb[0] - previous[2] > max(6.0, size * 1.6)):
                _flush()
            cur.append(ch)
            previous = bb
        _flush()
    if not toks:
        return None
    toks.sort(key=lambda u: u["b"][0])

    heights = sorted(max(1.0, u["b"][3] - u["b"][1]) for u in toks)
    hmed = heights[len(heights) // 2]

    def _eqnum(u):
        return bool(_CITE_BRACKET.match(u["t"]) or re.fullmatch(r"[\[\(]\s*[\dA-Za-z.\-]{1,8}\s*[\]\)]", u["t"]))

    # 오른쪽 끝: 큰 공백 뒤에 오는 (3) 꼴을 떼어낸다
    while len(toks) >= 2 and _eqnum(toks[-1]):
        gap = toks[-1]["b"][0] - toks[-2]["b"][2]
        if gap < max(6.0, hmed * 1.6):
            break
        toks.pop()
    # 왼쪽 끝도 같은 규칙
    while len(toks) >= 2 and _eqnum(toks[0]):
        gap = toks[1]["b"][0] - toks[0]["b"][2]
        if gap < max(6.0, hmed * 1.6):
            break
        toks.pop(0)
    if not toks:
        return None

    szs = sorted(u["sz"] for u in toks)
    x0 = min(u["b"][0] for u in toks); y0 = min(u["b"][1] for u in toks)
    x1 = max(u["b"][2] for u in toks); y1 = max(u["b"][3] for u in toks)

    # The equation number is often in the same raw PDF span as the formula
    # (especially with Type 1 Computer Modern).  Passing the original span list
    # to the 1-D fallback therefore reintroduced ``(2.14)`` into a box whose
    # geometry stopped before the number.  Keep only glyphs belonging to the
    # body rectangle before reconstructing text.  The 2-D path below already
    # clips by the same rectangle, but using the filtered list keeps both paths
    # identical when a fraction/radical cannot be assembled.
    body_spans = []
    for sp in spans:
        chars = sp.get("chars") or []
        if chars:
            kept = []
            for ch in chars:
                bb = ch.get("bbox")
                if not bb or (bb[2] >= x0 - .5 and bb[0] <= x1 + .5):
                    kept.append(ch)
            if kept:
                cp = dict(sp)
                cp["chars"] = kept
                body_spans.append(cp)
        else:
            bb = sp.get("bbox")
            if not bb or (bb[2] >= x0 - .5 and bb[0] <= x1 + .5):
                body_spans.append(sp)

    tex = _spans_to_clean_latex(body_spans)
    if not tex:
        tex = " ".join(u["t"] for u in toks).strip()
    if not tex:
        return None
    # 14.0 · 줄 단위 1D 조립은 중첩 분수를 못 살린다. 2D 복원기가 되면 그걸 쓴다.
    if page is not None:
        try:
            tex2 = region_to_latex(page.parent, page, (x0, y0, x1, y1), gtables,
                                    rules, vlines)
            if tex2 and _latex_is_sane(tex2) and not _tex_is_figure_junk(tex2):
                tex = tex2
        except Exception:
            pass
    return (x0, y0, x1, y1, tex, szs[len(szs) // 2])


def _line_math_regions(ln):
    """한 줄을 토큰 단위로 나눠 수식 덩어리를 찾는다.

    PDF는 한 식 안에서도 변수는 CMMI, 등호는 CMR, 숫자는 Times처럼 여러
    span으로 쪼갠다. 예전에는 일부 span만 수식으로 빠지고 나머지가 글상자로
    남아 두 겹이 됐다. 이제 '='·그리스문자·수식 글꼴을 앵커로 삼고, 좌우의
    짧은 변수/숫자/첨자를 함께 한 LaTeX 영역으로 묶는다.
    """
    spans=ln.get("spans", [])
    all_sizes=[float(sp.get("size") or 10) for sp in spans if _span_text(sp).strip()]
    if not all_sizes: return [], set()
    ss=sorted(all_sizes); base_size=ss[len(ss)//2]
    origins=[]
    for sp in spans:
        for ch in sp.get("chars", []):
            if (ch.get("c") or "").strip():
                origins.append((ch.get("origin") or (0,ch.get("bbox",[0,0,0,0])[3]))[1])
    origins.sort(); base_y=origins[len(origins)//2] if origins else 0

    units=[]
    for sp in spans:
        chars=sp.get("chars") or []
        if not chars:
            txt=_span_text(sp).strip(); bb=sp.get("bbox")
            if txt and bb: units.append({"text":txt,"bbox":bb,"sp":sp,"chars":[]})
            continue
        cur=[]
        def flush():
            if not cur: return
            txt="".join(c.get("c") or "" for c in cur).strip()
            boxes=[c.get("bbox") for c in cur if c.get("bbox")]
            if txt and boxes:
                units.append({"text":txt,
                    "bbox":[min(b[0] for b in boxes),min(b[1] for b in boxes),
                            max(b[2] for b in boxes),max(b[3] for b in boxes)],
                    "sp":sp,"chars":list(cur)})
            cur.clear()
        for ch in chars:
            if not (ch.get("c") or "").strip(): flush()
            else: cur.append(ch)
        flush()
    if not units: return [],set()
    units.sort(key=lambda u:(u["bbox"][0],u["bbox"][1]))

    def _is_sup(u):
        """이 토막이 위첨자로 조판됐는가 (인용 번호 판정용)"""
        sz=float(u["sp"].get("size") or base_size)
        if sz>=base_size*0.9: return False
        oy=[(c.get("origin") or (0,c.get("bbox",[0,0,0,0])[3]))[1] for c in u["chars"]]
        if not oy: return False
        return (sum(oy)/len(oy)) < base_y-base_size*0.12

    def citation(t,u=None):
        return _is_citation_token(t, superscript=bool(u and _is_sup(u)))
    prose_short={"is","in","of","to","as","or","and","the","for","by","at","on","if","we","a","an"}
    def attrs(u):
        t=u["text"].strip(); sp=u["sp"]
        pseudo=dict(sp); pseudo["text"]=t
        pseudo["_sup"]=_is_sup(u)
        if u["chars"]: pseudo["chars"]=u["chars"]
        if t.lower() in prose_short: return False,False
        # 9.0 · 인용 번호는 앵커도 이웃도 될 수 없다 → 수식에 절대 안 딸려간다
        if citation(t,u): return False,False
        anchor=_is_math_span(pseudo) or _formula_score(t)>=2
        words=re.findall(r"[A-Za-z]{2,}",t)
        short_word=all((len(w)<=3 or w.lower() in _MATH_WORDS) and w.lower() not in prose_short for w in words)
        simple=bool(re.fullmatch(r"[A-Za-z0-9α-ωΑ-Ω.,+\-*/=<>:;()_^{}\\|]+",t))
        neighbor=(anchor or (simple and short_word and len(t)<=20)
                   or t.lower() in _MATH_WORDS)
        return anchor,neighbor
    flags=[attrs(u) for u in units]
    ranges=[]
    for i,(anchor,_) in enumerate(flags):
        if not anchor: continue
        a=b=i
        while a>0 and flags[a-1][1]:
            gap=units[a]["bbox"][0]-units[a-1]["bbox"][2]
            h=max(units[a]["bbox"][3]-units[a]["bbox"][1],units[a-1]["bbox"][3]-units[a-1]["bbox"][1],1)
            if gap>max(4.0,h*1.15): break
            a-=1
        while b+1<len(units) and flags[b+1][1]:
            gap=units[b+1]["bbox"][0]-units[b]["bbox"][2]
            h=max(units[b]["bbox"][3]-units[b]["bbox"][1],units[b+1]["bbox"][3]-units[b+1]["bbox"][1],1)
            if gap>max(4.0,h*1.15): break
            b+=1
        if ranges and a<=ranges[-1][1]+1: ranges[-1]=(ranges[-1][0],max(ranges[-1][1],b))
        else: ranges.append((a,b))

    regs=[]; skip=set()
    for a,b in ranges:
        part=units[a:b+1]
        raw=" ".join(u["text"] for u in part).strip()
        # 기호 하나뿐인 오탐은 버리되 변수 하나(CMMI)는 허용
        if not raw: continue
        pieces=[]
        for u in part:
            txt=u["text"]
            sp=u["sp"]; sz=float(sp.get("size") or base_size)
            oy=[]
            for ch in u["chars"]:
                oy.append((ch.get("origin") or (0,ch.get("bbox",[0,0,0,0])[3]))[1])
                skip.add(id(ch))
            y=sum(oy)/len(oy) if oy else base_y
            if sz<base_size*.84 or (sp.get("flags",0)&1):
                if y<base_y-base_size*.12: txt="^{"+txt+"}"
                elif y>base_y+base_size*.12: txt="_{"+txt+"}"
            pieces.append(txt)
        boxes=[u["bbox"] for u in part]
        regs.append({"x0":min(x[0] for x in boxes),"y0":min(x[1] for x in boxes),
                     "x1":max(x[2] for x in boxes),"y1":max(x[3] for x in boxes),
                     "display":False,"text":" ".join(pieces),"size":base_size})
    return regs,skip


def _math_ratio(blk):
    """블록에서 수식 글꼴이 차지하는 글자 비율 (dict/rawdict 공용)"""
    tot = mat = 0
    for ln in blk.get("lines", []):
        for sp in ln.get("spans", []):
            if sp.get("chars") is not None:                 # rawdict
                t = "".join(ch.get("c", "") for ch in sp["chars"]).strip()
            else:                                           # dict
                t = (sp.get("text") or "").strip()
            if not t:
                continue
            tot += len(t)
            if _is_math_span(sp):
                mat += len(t)
    return (mat / tot) if tot else 0.0


def _imp_uid(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:9]}"


def _px(v):
    return int(round(v))


def _img_data_url(raw, ext="png", keep_big=False):
    """이미지 바이트 → data URL.

    keep_big=True 면 그림(도표·사진)을 또렷하게 보이도록
    큰 해상도를 유지하고 무손실(PNG)로 담는다.
    """
    try:
        im = Image.open(io.BytesIO(raw))
        if im.mode in ("P", "LA", "CMYK"):
            im = im.convert("RGBA" if "A" in im.mode else "RGB")
        limit = 3200 if keep_big else 1600
        if max(im.size) > limit:
            r = limit / max(im.size)
            im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))),
                           Image.LANCZOS)
        out = io.BytesIO()
        if keep_big and im.mode != "RGBA":
            # 색이 적은 도표는 PNG 가 작고 선명하다.
            # 사진처럼 색이 많으면 PNG 가 지나치게 커지므로 고품질 JPEG.
            try:
                colors = im.convert("RGB").getcolors(4096)
            except Exception:
                colors = None
            if colors is not None:            # 색이 4096 가지 이하 = 도표
                rgb = im.convert("RGB")
                n = len(colors)
                if n > 256:
                    # 색을 256 가지로 정리 → 크기가 크게 줄고 선은 그대로 또렷
                    rgb = rgb.quantize(colors=256, method=Image.MEDIANCUT,
                                       dither=Image.Dither.NONE)
                rgb.save(out, "PNG", optimize=True)
                mime = "image/png"
            else:
                im.convert("RGB").save(out, "JPEG", quality=88, optimize=True,
                                       subsampling=0)
                mime = "image/jpeg"
        elif keep_big:
            im.save(out, "PNG", optimize=True)
            mime = "image/png"
        elif im.mode == "RGBA":
            im.save(out, "PNG", optimize=True)
            mime = "image/png"
        else:
            im.convert("RGB").save(out, "JPEG", quality=82, optimize=True)
            mime = "image/jpeg"
        b = base64.b64encode(out.getvalue()).decode()
        return f"data:{mime};base64,{b}"
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────
#  PDF 단어 단위 추출
#
#  핵심 원칙:
#   · 배경(그래프·도형·표 테두리·색·선 굵기) = SVG/래스터로 원본 그대로 유지
#   · 글자 = 띄어쓰기 단위 '단어별' 상자를 만들어 정확한 절대 위치에 배치
#     (문단으로 묶을 때 생기던 "Core Core Core Core" 간격 오류 해결)
#   · 단어끼리 절대 겹치지 않게 패딩을 인접 단어/줄 간격 안으로 제한
#   · 원본 정렬(왼쪽/가운데/오른쪽)을 판별해 그대로 적용
#   · 표: 테두리는 배경에 남기고, 안쪽 글자만 단어 단위로 추출 → 중복 없음
# ─────────────────────────────────────────────────────────────

WORD_GAP_RATIO = 0.18   # 글자 사이 간격이 글자 크기의 이 비율을 넘으면 띄어쓰기
SUP_SUB_DY = 0.6        # 베이스라인이 이 비율(글자 크기 대비) 이상 다르면 다른 단어


# ═══════════════════════════════════════════════════════════
#  9.3 · 큰 수식 복원기 (oversized math reconstruction)
# ═══════════════════════════════════════════════════════════
#  물리 논문에서 '큰' 구조 — 키 큰 적분/시그마, 분자·분모가 큰 분수,
#  그리고 대입 기호(evaluation bar, \right|) — 는 지금까지 사진으로
#  굳어 버렸다. 이유는 두 가지였다.
#
#   ① 큰 기호는 CMEX/txex 같은 '확장 글꼴'로 조판된다. 이 글꼴의
#      글자를 그대로 읽으면 ∫ 는 'Z', ∑ 는 'P', 큰 괄호는 \x00 처럼
#      엉뚱한 값이 나온다. 그래서 수식 점수가 0점이 되어 텍스트로도,
#      LaTeX 로도 못 가고 배경 그림에 남았다.
#      → PDF 안에 들어 있는 글꼴 /Differences 인코딩을 읽어
#        'integraldisplay', 'radicalbig', 'braceleftbigg' 같은
#        진짜 글리프 이름을 얻고, 그것을 LaTeX 로 되돌린다.
#
#   ② 분수선은 벡터 선이 아니다. TeX(dvips)는 1x1 인라인 이미지를
#      납작하게 늘려 그린다. page.get_drawings() 로는 하나도 안 잡혀서
#      분자/분모를 나눌 수가 없었다.
#      → 콘텐츠 스트림에서 'cm ... BI' 패턴을 직접 읽어 분수선을 찾는다.
#
#  이 둘을 얻으면 글자들의 (x, y, 크기) 배치만으로 2차원 수식을
#  1차원 LaTeX 로 되돌릴 수 있다. 아래가 그 복원기다.


# ── TeX 확장 글꼴(CMEX/txex) 글리프 이름 → 의미 ──────────────
_OPEN  = {"parenleft":"(", "bracketleft":"[", "braceleft":r"\{",
          "angbracketleft":r"\langle", "floorleft":r"\lfloor", "ceilingleft":r"\lceil"}
_CLOSE = {"parenright":")", "bracketright":"]", "braceright":r"\}",
          "angbracketright":r"\rangle", "floorright":r"\rfloor", "ceilingright":r"\rceil"}
_BIGOP = {"integral":r"\int", "summation":r"\sum", "product":r"\prod",
          "union":r"\bigcup", "intersection":r"\bigcap", "coproduct":r"\coprod",
          "contintegral":r"\oint", "circlemultiply":r"\bigotimes", "circleplus":r"\bigoplus",
          "acute":r"\acute", "grave":r"\grave", "circumflex":r"\hat",
          "tilde":r"\widetilde", "macron":r"\bar", "breve":r"\breve",
          "caron":r"\check", "dieresis":r"\ddot", "ring":r"\mathring",
          "dotaccent":r"\dot", "ffl":r"\oint",
          "int":r"\int", "iint":r"\iint", "iiint":r"\iiint", "oint":r"\oint",
          "sum":r"\sum", "prod":r"\prod", "coprod":r"\coprod"}
# 크기 접미사 (big / Big / bigg / Bigg / text / display / tp / bt / ex ...)
_SIZE_SUFFIX = re.compile(r"(big{1,2}|Big{1,2}|text|display|tp|bt|ex|mid)$", re.I)

# 14.0 · TeX CMEX 기본 인코딩. /Differences 와 글꼴 프로그램 표가 비어 있어도
# 제어문자(\x12=parenleftbigg 등)를 큰 괄호·적분으로 되돌린다.
_CMEX_STD = {
    0: "parenleft", 1: "parenright", 2: "bracketleft", 3: "bracketright",
    4: "floorleft", 5: "floorright", 6: "ceilingleft", 7: "ceilingright",
    8: "braceleft", 9: "braceright", 10: "angbracketleft", 11: "angbracketright",
    12: "vextendsingle", 13: "vextenddouble", 14: "slash", 15: "backslash",
    16: "parenleftbig", 17: "parenrightbig",
    18: "parenleftbigg", 19: "parenrightbigg",
    20: "parenleftBigg", 21: "parenrightBigg",
    22: "bracketleftbigg", 23: "bracketrightbigg",
    24: "braceleftbigg", 25: "bracerightbigg",
    26: "angbracketleftbigg", 27: "angbracketrightbigg",
    32: "integral", 33: "integraldisplay", 34: "contintegral",
    80: "summation", 81: "product", 86: "coproduct",
    112: "radical", 113: "radicalbig",
}


# ── 14.47 · Symbol 글꼴 PUA 디코딩 ──────────────────────────────
#  Word/수식 편집기로 만든 PDF(Revision Questions …)는 Monotype SymbolMT 를
#  Identity-H 로 심고 ToUnicode 를 'F000 + Symbol 바이트' 로 적는다.
#  base-14 Symbol 을 쓰는 PDF(fpure …)는 MuPDF 가 큰 괄호 '조각'을 F8xx PUA 로
#  내놓는다. 디코딩 없이는 행렬 구분자가 씨앗도 못 되고, LaTeX 에는 梁 같은
#  깨진 글자만 남는다.
#
#  값 표기: 유니코드 한 글자(낱기호) | ("piece", 쪽, 종류, 위치) |
#           None(그리기 토막·미지정 → 버림)
#  표에 없는 코드는 False 취급(모름 → 손대지 않고 예전 동작 유지).
#
#  Monotype 배치는 0x20-0x7F = Adobe Symbol, 0xA0-0xDF = Adobe 0x80-0xBF 를
#  +0x20 옮긴 것이다. ′ ∞ → ° × ∈ ⇔ 와 조각 13종은 렌더·문맥으로 직접 검증했고,
#  나머지는 같은 규칙의 best-effort 다(검증점은 코드 옆 ✓).
def _pc(side, kind, pos):
    return ("piece", side, kind, pos)


_MS_SYMBOL_LOW = {
    0x20: " ", 0x21: "!", 0x22: "∀", 0x23: "#",
    0x24: "∃", 0x25: "%", 0x26: "&", 0x27: "∋",
    0x28: "(", 0x29: ")", 0x2A: "∗", 0x2B: "+",
    0x2C: ",", 0x2D: "−", 0x2E: ".", 0x2F: "/",
    0x30: "0", 0x31: "1", 0x32: "2", 0x33: "3",
    0x34: "4", 0x35: "5", 0x36: "6", 0x37: "7",
    0x38: "8", 0x39: "9", 0x3A: ":", 0x3B: ";",
    0x3C: "<", 0x3D: "=", 0x3E: ">", 0x3F: "?",
    0x40: "≅", 0x41: "Α", 0x42: "Β", 0x43: "Χ",
    0x44: "Δ", 0x45: "Ε", 0x46: "Φ", 0x47: "Γ",
    0x48: "Η", 0x49: "Ι", 0x4A: "ϑ", 0x4B: "Κ",
    0x4C: "Λ", 0x4D: "Μ", 0x4E: "Ν", 0x4F: "Ο",
    0x50: "Π", 0x51: "Θ", 0x52: "Ρ", 0x53: "Σ",
    0x54: "Τ", 0x55: "Υ", 0x56: "ς", 0x57: "Ω",
    0x58: "Ξ", 0x59: "Ψ", 0x5A: "Ζ", 0x5B: "[",
    0x5C: "∴", 0x5D: "]", 0x5E: "⊥", 0x5F: "_",
    0x60: None,  # radicalex — 루트 윗줄 토막이라 낱자로 쓸 수 없다
    0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ",  # ✓ α π θ
    0x65: "ε", 0x66: "φ", 0x67: "γ", 0x68: "η",
    0x69: "ι", 0x6A: "ϕ", 0x6B: "κ", 0x6C: "λ",
    0x6D: "μ", 0x6E: "ν", 0x6F: "ο", 0x70: "π",
    0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ",
    0x75: "υ", 0x76: "ϖ", 0x77: "ω", 0x78: "ξ",
    0x79: "ψ", 0x7A: "ζ", 0x7B: "{", 0x7C: "|",
    0x7D: "}", 0x7E: "∼", 0x7F: None,
    # 0x80-0x9F: Adobe 위치 그대로(best-effort, 두 표본 PDF 에선 미사용)
    0x80: "€", 0x81: "ϒ", 0x82: "′", 0x83: "≤",
    0x84: "⁄", 0x85: "∞", 0x86: "ƒ", 0x87: "♣",
    0x88: "♦", 0x89: "♥", 0x8A: "♠", 0x8B: "↔",
    0x8C: "←", 0x8D: "↑", 0x8E: "→", 0x8F: "↓",
    0x90: "°", 0x91: "±", 0x92: "″", 0x93: "≥",
    0x94: "×", 0x95: "∝", 0x96: "∂", 0x97: "•",
    0x98: "÷", 0x99: "≠", 0x9A: "≡", 0x9B: "≈",
    0x9C: "…", 0x9D: None, 0x9E: None, 0x9F: "⏎",
    # 0xA0-0xBF = Adobe 0x80-0x9F
    0xA0: "€", 0xA1: "ϒ", 0xA2: "′", 0xA3: "≤",  # ✓ A2 프라임
    0xA4: "⁄", 0xA5: "∞", 0xA6: "ƒ", 0xA7: "♣",  # ✓ A5 무한대
    0xA8: "♦", 0xA9: "♥", 0xAA: "♠", 0xAB: "↔",
    0xAC: "←", 0xAD: "↑", 0xAE: "→", 0xAF: "↓",  # ✓ AE 화살표
    0xB0: "°", 0xB1: "±", 0xB2: "″", 0xB3: "≥",  # ✓ B0 도(°)
    0xB4: "×", 0xB5: "∝", 0xB6: "∂", 0xB7: "•",  # ✓ B4 곱셈
    0xB8: "÷", 0xB9: "≠", 0xBA: "≡", 0xBB: "≈",
    0xBC: "…", 0xBD: None, 0xBE: None, 0xBF: "⏎",
    # 0xC0-0xDF = Adobe 0xA0-0xBF
    0xC0: "ℵ", 0xC1: "ℑ", 0xC2: "ℜ", 0xC3: "℘",
    0xC4: "⊗", 0xC5: "⊕", 0xC6: "∅", 0xC7: "∩",
    0xC8: "∪", 0xC9: "⊃", 0xCA: "⊇", 0xCB: "⊄",
    0xCC: "⊂", 0xCD: "⊆", 0xCE: "∈", 0xCF: "∉",  # ✓ CE 원소
    0xD0: "∠", 0xD1: "∇", 0xD2: "®", 0xD3: "©",
    0xD4: "™", 0xD5: "∏", 0xD6: "√", 0xD7: "⋅",
    0xD8: "¬", 0xD9: "∧", 0xDA: "∨", 0xDB: "⇔",  # ✓ DB iff
    0xDC: "⇐", 0xDD: "⇑", 0xDE: "⇒", 0xDF: "⇓",
    # 0xE0-0xFF: 검증된 조각 + ∑ ⟩ 만 인정, 나머지는 버린다
    0xE0: None, 0xE1: None, 0xE2: None, 0xE3: None,
    0xE4: None, 0xE5: "∑",
    0xE6: _pc("open", "paren", "tp"), 0xE7: _pc("open", "paren", "ex"),  # ✓
    0xE8: _pc("open", "paren", "bt"), 0xE9: _pc("open", "bracket", "tp"),  # ✓
    0xEA: _pc("open", "bracket", "ex"), 0xEB: _pc("open", "bracket", "bt"),  # ✓
    0xEC: _pc("open", "brace", "tp"), 0xED: _pc("open", "brace", "mid"),  # ✓
    0xEE: _pc("open", "brace", "bt"), 0xEF: _pc(None, "braceex", "ex"),
    0xF0: None, 0xF1: "⟩", 0xF2: None, 0xF3: None,
    0xF4: None, 0xF5: None,
    0xF6: _pc("close", "paren", "tp"), 0xF7: _pc("close", "paren", "ex"),  # ✓
    0xF8: _pc("close", "paren", "bt"), 0xF9: _pc("close", "bracket", "tp"),  # ✓
    0xFA: _pc("close", "bracket", "ex"), 0xFB: _pc("close", "bracket", "bt"),  # ✓
    0xFC: _pc("close", "brace", "tp"), 0xFD: _pc("close", "brace", "mid"),
    0xFE: _pc("close", "brace", "bt"), 0xFF: None,
}
_MS_SYMBOL = {0xF000 + k: v for k, v in _MS_SYMBOL_LOW.items()}

# base-14 Symbol 조각(MuPDF 가 F8xx PUA 로 내놓는 것). 19종 전부 렌더·기하 검증.
_F800_SYMBOL = {
    0xF8EB: _pc("open", "paren", "tp"), 0xF8EC: _pc("open", "paren", "ex"),
    0xF8ED: _pc("open", "paren", "bt"),
    0xF8EE: _pc("open", "bracket", "tp"), 0xF8EF: _pc("open", "bracket", "ex"),
    0xF8F0: _pc("open", "bracket", "bt"),
    0xF8F1: _pc("open", "brace", "tp"), 0xF8F2: _pc("open", "brace", "mid"),
    0xF8F3: _pc("open", "brace", "bt"), 0xF8F4: _pc(None, "braceex", "ex"),
    0xF8F6: _pc("close", "paren", "tp"), 0xF8F7: _pc("close", "paren", "ex"),
    0xF8F8: _pc("close", "paren", "bt"),
    0xF8F9: _pc("close", "bracket", "tp"), 0xF8FA: _pc("close", "bracket", "ex"),
    0xF8FB: _pc("close", "bracket", "bt"),
    0xF8FC: _pc("close", "brace", "tp"), 0xF8FD: _pc("close", "brace", "mid"),
    0xF8FE: _pc("close", "brace", "bt"),
}

# 조각 (쪽, 종류) → LaTeX 구분자 / 텍스트 경로 낱글자
_PIECE_TEX = {("open", "paren"): "(", ("close", "paren"): ")",
              ("open", "bracket"): "[", ("close", "bracket"): "]",
              ("open", "brace"): r"\{", ("close", "brace"): r"\}"}
_PIECE_TEXT = {("open", "paren"): "(", ("close", "paren"): ")",
               ("open", "bracket"): "[", ("close", "bracket"): "]",
               ("open", "brace"): "{", ("close", "brace"): "}"}


def _is_symbol_font(fname):
    """Symbol 계열 글꼴인가 (PUA 디코딩 게이트).

    'Symbol'·'SymbolMT' 와 서브셋(ABCDEF+Symbol)만 통과한다.
    비례형 SymbolProp 계열은 배치가 다를 수 있어 제외한다.
    """
    n = re.sub(r"[^a-z0-9]", "", (fname or "").split("+")[-1].lower())
    return n.startswith("symbol") and "prop" not in n


def _symbol_pua_lookup(code):
    """Symbol 글꼴 PUA 코드 → 디코딩 값.

    유니코드 한 글자 | ("piece", 쪽, 종류, 위치) | None(버림) |
    False(표에 없음 → 손대지 않음).
    """
    if 0xF000 <= code <= 0xF0FF:
        return _MS_SYMBOL.get(code, False)
    return _F800_SYMBOL.get(code, False)


def classify_glyph(name):
    """CMEX 글리프 이름 → (역할, LaTeX 토막)

    역할: 'open' | 'close' | 'op' | 'radical' | 'vbar' | 'ext' | None
    """
    if not name:
        return (None, None)
    n = name.strip()
    if n in ("acute", "grave", "circumflex", "tilde", "macron", "breve",
             "caron", "dieresis", "ring", "dotaccent"):
        return ("accent", {"acute": r"\acute", "grave": r"\grave",
                             "circumflex": r"\hat", "tilde": r"\widetilde",
                             "macron": r"\bar", "breve": r"\breve",
                             "caron": r"\check", "dieresis": r"\ddot",
                             "ring": r"\mathring", "dotaccent": r"\dot"}[n])
    if n.startswith("integral") or n in ("int", "iint", "iiint", "smallint"):
        return ("op", r"\int")
    if n in ("ffl", "oint", "oiint") or n.startswith("contintegral"):
        return ("op", r"\oint")
    if n.startswith("summation") or n in ("sum",):
        return ("op", r"\sum")
    if n.startswith("product") or n in ("prod",):
        return ("op", r"\prod")
    if n.startswith("coproduct") or n in ("coprod",):
        return ("op", r"\coprod")
    # 세로로 늘어나는 대입 기호 |  (\right| 로 쓰는 그것)
    if n.startswith("vextendsingle") or n in ("bar", "verticalbar"):
        return ("vbar", "|")
    if n.startswith("vextenddouble") or n == "arrowvert":
        return ("vbar", r"\|")
    if n.startswith("radical"):
        # radicalbt/vertex/tp 는 큰 루트의 조각들
        return ("radical", r"\sqrt")
    base = _SIZE_SUFFIX.sub("", n)
    if base in _OPEN:
        return ("open", _OPEN[base])
    if base in _CLOSE:
        return ("close", _CLOSE[base])
    if base in _BIGOP:
        accent_names = {"acute", "grave", "circumflex", "tilde", "macron", "breve",
                        "caron", "dieresis", "ring", "dotaccent"}
        return ("accent" if base in accent_names else "op", _BIGOP[base])
    # 큰 괄호의 위/중간/아래 조각 (parenlefttp, parenleftex ...)
    for k, v in _OPEN.items():
        if n.startswith(k):
            return ("open", v)
    for k, v in _CLOSE.items():
        if n.startswith(k):
            return ("close", v)
    for k, v in _BIGOP.items():
        if n.startswith(k):
            return ("accent" if k in {"acute", "grave", "circumflex", "tilde", "macron",
                                      "breve", "caron", "dieresis", "ring", "dotaccent"}
                    else "op", v)
    return (None, None)


def font_glyph_tables(doc, page):
    """이 페이지 글꼴들의 /Differences 인코딩 표: {basefont: {code: glyphname}}"""
    out = {}
    try:
        fonts = page.get_fonts(full=True)
    except Exception:
        return out
    for f in fonts:
        xref = f[0]
        base = f[3] or ""
        try:
            obj = doc.xref_object(xref)
        except Exception:
            continue
        m = re.search(r"/Encoding\s+(\d+)\s+0\s+R", obj)
        if not m:
            continue
        try:
            enc = doc.xref_object(int(m.group(1)))
        except Exception:
            continue
        dm = re.search(r"/Differences\s*\[(.*?)\]", enc, re.S)
        if not dm:
            continue
        table, cur = {}, 0
        for tok in dm.group(1).split():
            if tok.startswith("/"):
                table[cur] = tok[1:]
                cur += 1
            else:
                try:
                    cur = int(tok)
                except ValueError:
                    pass
        if table:
            out[base] = table
            out[base.split("+")[-1]] = table
    return out


def _font_program_encoding(doc, xref):
    """10.1 · 임베디드 Type1(PFA/PFB) 글꼴 '파일 안'의 /Encoding 배열을 읽는다.

    pdflatex(txfonts 등) 글꼴은 PDF쪽 /Differences 가 비어 있어도 글꼴
    프로그램 헤더에 'dup 88 /summationdisplay put' 같은 진짜 글리프
    이름표를 갖고 있다. 이게 없으면 txex 의 Σ·∏·큰괄호가 'X','Y','!'
    같은 쓰레기 글자로 읽혀 수식이 박살난다.
    """
    try:
        buf = doc.extract_font(xref)[3]
        if not buf or len(buf) > 2_000_000:
            return {}
        txt = buf.decode("latin-1", "replace")
        m = re.search(r"/Encoding\s+256\s+array", txt)
        if not m:
            return {}
        seg = txt[m.end():m.end() + 16000]
        table = {}
        for a, b in re.findall(r"dup\s+(\d+)\s+/([A-Za-z0-9_.\-]+)\s+put", seg):
            table[int(a)] = b
        # 14.0 · 서브셋 CMEX(괄호 2개만 임베드)도 살려야 큰 괄호가 안 사라진다.
        if len(table) < 2:
            for a, b in re.findall(r"dup\s+(\d+)\s+/([A-Za-z0-9_.\-]+)\s+put", txt):
                table[int(a)] = b
        return table if table else {}
    except Exception:
        return {}


def glyph_tables_full(doc, page):
    """/Differences 와 글꼴 프로그램 인코딩을 합친 전체 글리프 이름표."""
    out = font_glyph_tables(doc, page)
    try:
        fonts = page.get_fonts(full=True)
    except Exception:
        return out
    for f in fonts:
        xref, base = f[0], (f[3] or "")
        short = base.split("+")[-1]
        t = _font_program_encoding(doc, xref)
        if t:
            if short in out:
                out[short].update(t)
            else:
                out[short] = t
            if base in out:
                out[base].update(t)
            else:
                out[base] = t
        if "ESINT" in base.upper() or "ESINT" in short.upper():
            es_map = {1: "integral", 2: "integral", 31: "contintegral", 94: "integral", 710: "integral"}
            if short not in out: out[short] = {}
            if base not in out: out[base] = {}
            out[short].update(es_map)
            out[base].update(es_map)
    return out


_NUM = r"[-+]?[\d.]+"
_CM_BI = re.compile(
    r"q\s+(" + _NUM + r")\s+(" + _NUM + r")\s+(" + _NUM + r")\s+(" + _NUM + r")\s+("
    + _NUM + r")\s+(" + _NUM + r")\s+cm\s+BI\b", re.S)


def _match_vector_sqrt(segs, px0, py1, pw, ph):
    # 한 path 의 직선 조각들에서 벡터 sqrt 를 찾는다. (14.48)
    # p21/p29/p37 의 sqrt 는 글리프가 아니라 '고리+빗변+윗변' 벡터 path 다.
    # 윗변(가로 3~48pt)이 path 맨 위에 있고, 그 왼쪽 끝에서 가파른 빗변이
    # 왼쪽-아래로 내려가며, 발밑에 왼쪽으로 뻗은 고리가 있으면 sqrt 다.
    # 되면 (몸통상자, 윗변) = (bx0,by0,bx1,by1,rx0,ry,rx1) 을, 아니면
    # None 을 돌려준다. 곡선·큰 도형(다이어그램 호·축)은 크기와 고리
    # 조건에서 걸러진다.
    if pw > 55.0 or ph > 32.0 or pw < 4.0 or ph < 5.0:
        return None
    for (x0, y0, x1, y1) in segs:
        w = abs(x1 - x0)
        if not (3.0 <= w <= 48.0 and abs(y1 - y0) <= 0.6):
            continue
        bx0, bx1 = min(x0, x1), max(x0, x1)
        by = (y0 + y1) / 2.0
        if any(min(v0, v1) < by - 1.0 for (_u0, v0, _u1, v1) in segs):
            continue                    # 윗변이 맨 위가 아니다
        foot = None
        _di = -1
        for _i, (u0, v0, u1, v1) in enumerate(segs):
            for (sx, sy, ex, ey) in ((u0, v0, u1, v1), (u1, v1, u0, v0)):
                if abs(sx - bx0) > 0.8 or abs(sy - by) > 0.8:
                    continue
                dx, dy = ex - sx, ey - sy
                if -5.0 <= dx <= -0.8 and 5.0 <= dy <= 30.0:
                    foot = (ex, ey)
                    _di = _i
        if foot is None:
            continue
        if px0 >= foot[0] - 1.0:
            continue                    # 왼쪽으로 뻗은 고리가 없다
        if not any(_i != _di and (
                (abs(u0 - foot[0]) <= 1.2 and abs(v0 - foot[1]) <= 1.2)
                or (abs(u1 - foot[0]) <= 1.2 and abs(v1 - foot[1]) <= 1.2))
                for _i, (u0, v0, u1, v1) in enumerate(segs)):
            continue                    # 발밑에 맞닿은 조각이 없다
        return (px0, by, bx0, py1, bx0, by, bx1)
    return None


def _vector_sqrts(page):
    # 페이지의 벡터 sqrt 목록 [(몸통상자, 윗변)]. (14.48 · 글리프 없는 루트)
    out = []
    try:
        drawings = page.get_drawings()
    except Exception:
        return out
    for d in drawings:
        try:
            items = d.get("items", ())
        except Exception:
            continue
        segs = []
        ok = True
        for it in items:
            if it[0] != "l":
                ok = False
                break
            try:
                segs.append((float(it[1][0]), float(it[1][1]),
                             float(it[2][0]), float(it[2][1])))
            except Exception:
                ok = False
                break
        if not ok or len(segs) < 3:
            continue
        r = d.get("rect")
        try:
            pw = float(r.x1 - r.x0); ph = float(r.y1 - r.y0)
            px0 = float(r.x0); py1 = float(r.y1)
        except Exception:
            continue
        m = _match_vector_sqrt(segs, px0, py1, pw, ph)
        if m is not None:
            out.append(m)
    return out


def page_rules(page):
    """가로 규칙선 = 분수선·루트 윗줄. (분수선을 못 찾으면 \\frac 복원이 불가능하다)

    TeX(dvips) 는 분수선을 벡터가 아니라 1x1 인라인 이미지를 납작하게
    늘려서 그린다. 그래서 get_drawings() 로는 하나도 안 잡힌다.
    """
    out = []
    ph = page.rect.height
    try:
        for d in page.get_drawings():
            r = d.get("rect")
            if r and r.width >= 3 and r.height <= 2.6:
                out.append([float(r.x0), float(r.y0), float(r.x1), float(r.y1)])
            else:
                # 14.48 · 복합 path 속 가로 조각도 건진다: p26의 det 막대는
                # 양쪽 세로 막대와 (2,2)칸 분수선을 한 path에 합쳐 그려서
                # rect(32×6.7)가 탈락해 9/5 분수가 깨졌다. 표 격자(긴 가로선)가
                # 분수선으로 둔갑하지 않게 폭 60pt 이하 조각만 받는다(넓은
                # 진짜 분수선은 단일 path라 위 rect 경로로 이미 잡힌다).
                # 대각선·세로선과 끝점이 맞닿은 가로는 벡터 √의 윗변이지
                # 분수선이 아니다(p29 회귀) → 그런 조각은 건드리지 않는다.
                try:
                    _segs = []
                    for it in d.get("items", ()):
                        if it[0] != "l":
                            continue
                        _segs.append((float(it[1][0]), float(it[1][1]),
                                      float(it[2][0]), float(it[2][1])))
                except Exception:
                    _segs = []
                # 14.48 · 벡터 sqrt 면 윗변을 규칙선으로 낸다(뒤에서 근호
                # 윗줄(radbar)로 짝지어진다. 몸통은 region_boxes 가 합성).
                try:
                    _m = _match_vector_sqrt(
                        _segs, float(r.x0), float(r.y1),
                        float(r.x1 - r.x0), float(r.y1 - r.y0)) \
                        if r is not None else None
                except Exception:
                    _m = None
                if _m is not None:
                    out.append([_m[4], _m[5], _m[6], _m[5]])
                    continue
                for (x0, y0, x1, y1) in _segs:
                    w = abs(x1 - x0)
                    if not (3.0 <= w <= 60.0 and abs(y1 - y0) <= 0.6):
                        continue
                    _conn = False
                    for (u0, v0, u1, v1) in _segs:
                        if abs(v1 - v0) <= 0.6:
                            continue
                        for (px, py) in ((x0, y0), (x1, y1)):
                            if (min(abs(px - u0), abs(px - u1)) <= 0.8
                                    and min(abs(py - v0), abs(py - v1)) <= 0.8):
                                _conn = True
                                break
                        if _conn:
                            break
                    if _conn:
                        continue
                    out.append([min(x0, x1), min(y0, y1),
                                max(x0, x1), max(y0, y1)])
    except Exception:
        pass
    try:
        cs = page.read_contents().decode("latin-1", "replace")
    except Exception:
        cs = ""
    if cs:
        gs = re.search(r"q\s+(" + _NUM + r")\s+0\s+0\s+(" + _NUM + r")\s+0\s+0\s+cm", cs)
        sx = float(gs.group(1)) if gs else 1.0
        sy = float(gs.group(2)) if gs else 1.0
        for m in _CM_BI.finditer(cs):
            a, _b, _c, dd, e, f = [float(x) for x in m.groups()]
            w = abs(a) * sx
            h = abs(dd) * sy
            if w < 3 or h > 2.6:
                continue
            x0 = e * sx
            y0 = ph - (f * sy)
            out.append([x0, y0, x0 + w, y0 + h])
    ded = []
    for r in out:
        if not any(abs(r[0] - q[0]) < 0.6 and abs(r[1] - q[1]) < 0.6
                   and abs(r[2] - q[2]) < 0.6 for q in ded):
            ded.append(r)
    ded.sort(key=lambda r: (r[1], r[0]))
    return ded


def page_vlines(page):
    """키 큰 세로 벡터선 목록. (14.48 · 글리프 없는 행렬식 막대)

    det A = |a b; c d| 처럼 행렬식 막대를 벡터 선으로 그린 PDF 가 있다.
    글리프가 없어 구분자 씨앗이 못 되므로, 곧고(기울기 ≤ 0.6pt) 길게
    (≥ 18pt — 한 줄짜리 절댓값 |x| 는 제외) 그은 세로선을 모아 둔다.
    가로 규칙선(분수선)은 page_rules 가 따로 모으므로 여기서 뺀다.
    """
    out = []
    try:
        drawings = page.get_drawings()
    except Exception:
        return out
    for d in drawings:
        for it in d.get("items", ()):
            try:
                if it[0] == "l":
                    x0, y0 = float(it[1][0]), float(it[1][1])
                    x1, y1 = float(it[2][0]), float(it[2][1])
                    if abs(x1 - x0) <= 0.6 and abs(y1 - y0) >= 18.0:
                        out.append([min(x0, x1) - 0.3, min(y0, y1),
                                    max(x0, x1) + 0.3, max(y0, y1)])
                elif it[0] == "re":
                    r = it[1]
                    rx0, ry0, rx1, ry1 = (float(r[0]), float(r[1]),
                                          float(r[2]), float(r[3]))
                    if rx1 - rx0 <= 2.0 and ry1 - ry0 >= 18.0:
                        out.append([rx0, ry0, rx1, ry1])
            except Exception:
                continue
    ded = []
    for v in out:
        if not any(abs(v[0] - q[0]) < 0.6 and abs(v[1] - q[1]) < 0.6
                   and abs(v[3] - q[3]) < 0.6 for q in ded):
            ded.append(v)
    ded.sort(key=lambda v: (v[0], v[1]))
    return ded


# ═══════════════════════════════════════════════════════════
#  2차원 배치 → 1차원 LaTeX
# ═══════════════════════════════════════════════════════════
#  PDF 는 글자마다 (x, y, 크기) 만 준다. 분수는 '선 위/아래', 지수는
#  '작고 위', 큰 적분은 '아주 키 큰 글리프'로만 구분된다. 그래서
#  ① 분수선을 먼저 찾아 위/아래를 재귀로 나누고
#  ② 남은 글자들을 x 순서로 읽으며 첨자/큰 연산자/큰 괄호를 붙인다.

_GREEK = {
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta",
    "ε": r"\epsilon", "ζ": r"\zeta", "η": r"\eta", "θ": r"\theta",
    "ι": r"\iota", "κ": r"\kappa", "λ": r"\lambda", "μ": r"\mu", "µ": r"\mu",
    "ν": r"\nu", "ξ": r"\xi", "π": r"\pi", "ρ": r"\rho", "σ": r"\sigma",
    "τ": r"\tau", "υ": r"\upsilon", "φ": r"\phi", "ϕ": r"\phi", "χ": r"\chi",
    "ψ": r"\psi", "ω": r"\omega", "Γ": r"\Gamma", "Δ": r"\Delta",
    "Θ": r"\Theta", "Λ": r"\Lambda", "Ξ": r"\Xi", "Π": r"\Pi",
    "Σ": r"\Sigma", "Φ": r"\Phi", "Ψ": r"\Psi", "Ω": r"\Omega",
    # 14.70 · var 계열(ϑ ϖ ϱ ϰ ϵ ς) — CMMI/Symbol 에서 실제 글리프로 쓰인다.
    "ϑ": r"\vartheta", "ϖ": r"\varpi", "ϱ": r"\varrho", "ϰ": r"\varkappa",
    "ϵ": r"\epsilon", "ς": r"\varsigma",
}
# 14.48 · 낱토큰 분수 junk 판정용 그리스 명령어 집합 (var 계열 포함).
_GREEK_FRAC_CMDS = frozenset(
    list(_GREEK.values())
    + [r"\varepsilon", r"\vartheta", r"\varpi", r"\varrho",
       r"\varsigma", r"\varphi"])
_SYM = {
    "∞": r"\infty", "∂": r"\partial", "∇": r"\nabla", "∫": r"\int",
    "∮": r"\oint", "∑": r"\sum", "∏": r"\prod", "√": r"\sqrt",
    "≈": r"\approx", "≃": r"\simeq", "≅": r"\cong", "≠": r"\ne",
    "≤": r"\le", "≥": r"\ge", "±": r"\pm", "∓": r"\mp", "×": r"\times",
    "÷": r"\div", "·": r"\cdot", "⋅": r"\cdot", "∝": r"\propto", "∈": r"\in",
    "∉": r"\notin", "⊂": r"\subset", "⊃": r"\supset", "∪": r"\cup",
    "∩": r"\cap", "→": r"\to", "←": r"\leftarrow", "↔": r"\leftrightarrow",
    "↦": r"\mapsto", "⇒": r"\Rightarrow", "⇔": r"\Leftrightarrow", "∀": r"\forall",
    # 14.70 · CMSY 의 ∥(U+2225)는 이 문서들에서 전부 ‖x‖ 노름 막대다.
    # \parallel 은 관계기호 간격(넓게 벌어짐)으로 조판돼 시각적으로 PDF 와
    # 다르다 — 노름 \| 가 원본과 같다.
    "∃": r"\exists", "∥": r"\|", "⊥": r"\perp", "ℏ": r"\hbar",
    "ℓ": r"\ell", "ℝ": r"\mathbb{R}", "ℂ": r"\mathbb{C}", "ℤ": r"\mathbb{Z}",
    "ℕ": r"\mathbb{N}", "ℚ": r"\mathbb{Q}", "−": "-", "≡": r"\equiv",
    "≫": r"\gg", "≪": r"\ll", "∼": r"\sim", "∘": r"\circ",
    # 14.71 · CMSY 순서 기호(≥ 의 곡선형) — p4 R(ρ→ρ′)=sup{…⪰r…} 누수.
    "⪰": r"\succeq", "⪯": r"\preceq", "≽": r"\succeq", "≼": r"\preceq",
    "≻": r"\succ", "≺": r"\prec", "⊑": r"\sqsubseteq", "⊒": r"\sqsupseteq",
    "⊗": r"\otimes", "⊕": r"\oplus", "′": "'", "″": "''", "…": r"\dots",
    # 14.46 · 행렬의 줄임표. KaTeX 는 ⋯ ⋮ ⋱ 를 그대로 받지 못한다.
    "⋯": r"\cdots", "⋮": r"\vdots", "⋱": r"\ddots", "‖": r"\|",
    "⟨": r"\langle", "⟩": r"\rangle", "∧": r"\wedge", "∨": r"\vee",
    # TeX accent glyphs are extracted as standalone Unicode characters.  The
    # old mapping of circumflex to \int was especially damaging for \hat{s}.
    "ˆ": r"\hat", "˜": r"\widetilde", "~": r"\widetilde", "¯": r"\bar",
    "ˉ": r"\bar", "´": r"\acute", "`": r"\grave", "˘": r"\breve",
    "ˇ": r"\check", "˙": r"\dot", "¨": r"\ddot", "˚": r"\mathring",
    "◦": r"\circ", "□": r"\square",
    # 14.47 · Symbol PUA 디코딩으로 들어오는 낱기호들 (KaTeX 지원 명령만)
    "°": r"\degree", "•": r"\bullet", "⁄": "/", "€": r"\text{€}",
    "ϒ": r"\Upsilon", "″": "''", "ℵ": r"\aleph", "ℑ": r"\Im", "ℜ": r"\Re",
    "℘": r"\wp", "∅": r"\emptyset", "⊇": r"\supseteq", "⊄": r"\not\subset",
    "⊆": r"\subseteq", "∠": r"\angle", "®": r"\text{®}", "©": r"\text{©}",
    "™": r"\text{™}", "¬": r"\neg", "⇐": r"\Leftarrow", "⇑": r"\Uparrow",
    "⇓": r"\Downarrow", "◊": r"\diamond", "↑": r"\uparrow", "↓": r"\downarrow",
    "♣": r"\clubsuit", "♦": r"\diamondsuit", "♥": r"\heartsuit",
    "♠": r"\spadesuit", "ƒ": r"\text{ƒ}", "⏎": r"\text{⏎}",
    "∗": r"\ast", "∴": r"\therefore", "∋": r"\ni",
    # 14.70 · 물리 논문(양자정보) 수식에서 실제로 새던 낱기호들.
    #   † (케트/수반), ⊤ (전치), ⌊⌋⌈⌉ (바닥/천장), ⊢ (턴스타일),
    #   ⟶ ⟹ (긴 화살표), ⇄ (좌우 이중 화살표, MSAM 글꼴), ↘↗↙↖ (대각선).
    "†": r"\dagger", "‡": r"\ddagger",
    "⊤": r"\top", "⊢": r"\vdash", "⊣": r"\dashv", "⊨": r"\models",
    "⌊": r"\lfloor", "⌋": r"\rfloor", "⌈": r"\lceil", "⌉": r"\rceil",
    "⟶": r"\longrightarrow", "⟵": r"\longleftarrow",
    "⟷": r"\longleftrightarrow", "⟹": r"\Longrightarrow",
    "⟸": r"\Longleftarrow", "⟺": r"\Longleftrightarrow",
    "⟼": r"\longmapsto",
    "⇄": r"\rightleftarrows", "⇌": r"\rightleftharpoons",
    "⇋": r"\leftrightharpoons", "⇉": r"\rightrightarrows",
    "⇇": r"\leftleftarrows",
    "↘": r"\searrow", "↗": r"\nearrow", "↙": r"\swarrow", "↖": r"\nwarrow",
    "⊸": r"\multimap", "⋎": r"\curlyvee", "⋏": r"\curlywedge",
    "⊲": r"\vartriangleleft", "⊳": r"\vartriangleright",
}

_MATHOP = re.compile(r"^(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|"
                     r"exp|log|ln|lim|det|dim|ker|deg|gcd|max|min|sup|inf|arg|Tr|tr)$")

# TeX accents. They are separate glyphs in the PDF and MUST end up owning a
# base atom: a bare ``\hat`` followed by ``_{i}`` is a KaTeX parse error
# ("Expected group after '_'"), which is exactly how ``v \hat _{i}`` broke.
_ACCENT_TEX = (r"\acute", r"\grave", r"\hat", r"\widetilde", r"\bar", r"\breve",
               r"\check", r"\dot", r"\ddot", r"\mathring", r"\vec", r"\tilde")
_ACCENT_NAMES = "|".join(t[1:] for t in _ACCENT_TEX)
# Commands that are meaningless without an argument. A dangling one is a parse
# error, so it is both repaired in _tidy_latex and rejected by _latex_is_sane.
_NEEDS_GROUP = (_ACCENT_NAMES + r"|frac|sqrt|text|mathcal|mathbb|mathscr|mathfrak"
                r"|mathrm|mathsf|mathtt|boldsymbol|overline|underline")


# 같은 모양 다른 코드포인트 정규화 (Ω 옴 기호 U+2126, µ 마이크로 U+00B5 등)
_LOOKALIKE = {
    "\u2126": "\u03a9",   # OHM SIGN      → GREEK CAPITAL OMEGA
    "\u00b5": "\u03bc",   # MICRO SIGN    → GREEK SMALL MU
    "\u2206": "\u0394",   # INCREMENT     → GREEK CAPITAL DELTA
    "\u220f": "\u03a0", "\u2211": "\u03a3",
    "\u2212": "-", "\u2010": "-", "\u2011": "-", "\u2013": "-", "\u2014": "-",
    "\u02b9": "'", "\u2032": "'",
}


_LIGATURES = {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
              "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st"}


def _tok_tex(t):
    """한 글자를 LaTeX 로."""
    t = _LOOKALIKE.get(t, t)
    if t in _LIGATURES:
        return r"\mathrm{" + _LIGATURES[t] + "}"
    if t and ord(t[0]) < 0x20:
        return ""          # 인코딩을 못 얻은 제어문자는 버린다
    if t in _GREEK: return _GREEK[t]
    if t in _SYM:   return _SYM[t]
    if t in "%#&_{}$": return "\\" + t
    return t


class Box:
    """한 글자 또는 이미 조립된 덩어리."""
    __slots__ = ("x0", "y0", "x1", "y1", "tex", "size", "role", "atomic", "style")

    def __init__(self, x0, y0, x1, y1, tex, size, role=None, atomic=False, style=None):
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1
        self.tex = tex
        self.size = size
        self.role = role          # 'open'|'close'|'op'|'radical'|'vbar'|'accent'|None
        self.atomic = atomic      # 이미 완성된 덩어리(재귀 결과)
        # 글꼴이 뜻하는 수학 스타일('rm'·'cal'·'bb'…). 글자를 낱말로 합친 뒤에
        # 한 번만 씌운다 — 글자마다 미리 씌우면 exp 가 \mathrm{e}\mathrm{x}\mathrm{p}
        # 로 굳어 낱말 병합·연산자 인식이 모두 막힌다.
        self.style = style

    @property
    def cy(self): return (self.y0 + self.y1) / 2.0
    @property
    def h(self):  return self.y1 - self.y0
    @property
    def w(self):  return self.x1 - self.x0

    def __repr__(self):
        return f"Box({self.tex!r} x={self.x0:.0f}..{self.x1:.0f} y={self.y0:.0f}..{self.y1:.0f})"


def _median(v, d=10.0):
    v = sorted(v)
    return v[len(v) // 2] if v else d


def _covered(b, rx0, rx1):
    """상자가 분수선 폭 안에 '대부분' 들어가는가.

    느슨하게 보면 분수선 왼쪽의 '=' 나 오른쪽의 다음 항까지 분자로
    빨려 들어간다(U_0^4 = 2^7/3 ... 가 \\frac{=2^7 \\pi}{3} 로 깨지던 원인).
    """
    w = max(1e-6, b.x1 - b.x0)
    ov = min(b.x1, rx1 + 1.0) - max(b.x0, rx0 - 1.0)
    return ov > 0 and (ov / w) >= 0.6


def _classify_rules(boxes, rules):
    """규칙선을 '분수선'과 '근호 윗줄'로 나눈다.

    근호 윗줄은 왼쪽 끝에 루트 글리프가 딱 붙어 있다. 이걸 먼저 갈라놓지
    않으면 분수 분자까지 근호 안으로 빨려 들어간다(√(U²/4πgN) 오인).
    """
    rads = [b for b in boxes if b.role == "radical"]
    frac, radbar = [], {}
    for r in rules:
        owner = None
        for b in rads:
            if abs(r[0] - b.x1) <= 4.5 and (b.y0 - 4.5) <= (r[1] + r[3]) / 2.0 <= (b.y1 + 4.5):
                owner = b
                break
        if owner is not None:
            radbar[id(owner)] = r
            continue
        # 14.48 · 미리 조립된 근호 원자(-√3)의 윗변도 근호선이다. 병합으로
        # 주인 몸통이 사라지면 분수선으로 둔갑해, (√3)² 꼴의 위첨자가
        # 분자로 빨려 들어간다. 몸통('\sqrt', 역할 radical)은 진짜
        # 주인이므로 제외 — 원자 조립품('\sqrt{…')만 본다. 윗변은 원자
        # '위쪽'에서 '몸통 오른쪽'(x0+2pt — 부호·몸통 너비분 안쪽)에
        # 시작해 피제곱수 끝(x1) 안에 끝나야 한다 — '−√3/2' 의 바깥
        # 분수선(한가운데)이나 'X/−√3' 의 분수선(왼쪽부터)은 살려야
        # 한다(p21). 더미 키로 넣어 분수에서만 빼고, 누구의 막대로도
        # 쓰이지 않는다.
        rcy = (r[1] + r[3]) / 2.0
        orphan = False
        for b in boxes:
            if not b.atomic or r"\sqrt{" not in (b.tex or ""):
                continue
            if (r[0] >= b.x0 + 2.0 and r[2] <= b.x1 + 2.5
                    and b.y0 - 4.5 <= rcy
                    <= b.y0 + 0.45 * max(b.h, 1.0)):
                orphan = True
                break
        if orphan:
            radbar[("consumed", id(r))] = r
        else:
            frac.append(r)
    return frac, radbar


def _row_split(boxes, rules):
    """여러 줄로 조판된 수식을 '줄' 단위로 가른다.

    기준은 '본문 크기 글자의 베이스라인'이다. 분수의 분자·분모나 첨자는
    베이스라인이 없고 큰 글자 주위에 딸려 있을 뿐이라, 본문 글자의
    아랫선만 모으면 진짜 줄이 몇 개인지 깔끔하게 드러난다.
    """
    real = [b for b in boxes if not b.atomic and b.role is None]
    if len(real) < 6:
        return None
    top = max(b.size for b in real)
    mains = [b for b in real if b.size >= top * 0.9]
    if len(mains) < 6:
        return None
    hh = _median([b.h for b in mains]) or 10.0

    bl = sorted(b.y1 for b in mains)
    groups = [[bl[0]]]
    for v in bl[1:]:
        if v - groups[-1][-1] > hh * 0.85:
            groups.append([v])
        else:
            groups[-1].append(v)
    # 글자가 몇 개 안 되는 무리는 첨자 잔재다 → 줄로 치지 않는다
    groups = [g for g in groups if len(g) >= 3]
    if len(groups) < 2:
        return None
    centers = [_median(g) for g in groups]

    # 넓은 분수선이 줄 경계를 넘으면 그건 줄바꿈이 아니라 분수다
    x0 = min(b.x0 for b in boxes); x1 = max(b.x1 for b in boxes)
    width = max(1e-6, x1 - x0)
    for rl in rules:
        rcy = (rl[1] + rl[3]) / 2.0
        # 10.0 · '분수선 폭 ≥ 전체 60%' 조건만으로는 부족했다.
        #  식 앞에 'F =' 나 식 번호 '(3)' 이 붙으면 분수선은 전체 폭의 60%가
        #  못 되고, 큰 분수가 두 '줄'로 쪼개져 \\begin{aligned} 로 뒤집혔다.
        #  폭 대신 '그 선 위·아래에 실제로 글자가 있는가'로 판정한다.
        span = [b for b in boxes if _covered(b, rl[0], rl[2])]
        up = [b for b in span if b.cy < rcy - 0.5]
        dn = [b for b in span if b.cy > rcy + 0.5]
        if not up or not dn:
            continue
        if (rl[2] - rl[0]) < width * 0.6 and len(up) < 3 and len(dn) < 3:
            continue
        for a, b2 in zip(centers, centers[1:]):
            if a < rcy < b2:
                return None

    # 분수는 분자가 윗줄 베이스라인에 가깝게 놓이는 일이 흔하다.
    # 분수선이 속한 줄을 먼저 정하고, 그 분수선이 덮는 글자는 전부
    # 같은 줄로 못박아 분자/분모가 두 줄로 찢어지지 않게 한다.
    rows = [[] for _ in centers]
    pinned = {}
    gaps = [abs(a - b2) for a, b2 in zip(centers, centers[1:])] or [hh * 2.0]
    reach = max(hh * 0.9, min(gaps) * 0.45)   # 이웃 줄까지 넘어가지 않는 거리
    # 14.70 · 근호(√)의 윗변은 '제 행의 베이스라인 바로 위'에 있다. 두 줄
    # 식(K.4·K.5)에서 아랫줄 √ 의 윗변이 윗줄에 더 가까워 윗줄로 못박히면
    # 아랫줄 글자(k)까지 윗줄로 끌려가 \sqrt{k+1}→\sqrt{+1}rac{k}{k} 로
    # 깨진다. 근호 윗변은 이미 주인(√)이 제 행에 있으므로 못박기에서 뺀다.
    _rads2 = [b for b in boxes if b.role == "radical"]
    _radbars2 = set()
    for rl in rules:
        for _rb in _rads2:
            if (abs(rl[0] - _rb.x1) <= 4.5
                    and (_rb.y0 - 4.5) <= (rl[1] + rl[3]) / 2.0 <= (_rb.y1 + 4.5)):
                _radbars2.add(id(rl))
    rules = [rl for rl in rules if id(rl) not in _radbars2]
    for rl in rules:
        rcy = (rl[1] + rl[3]) / 2.0
        k = min(range(len(centers)), key=lambda j: abs(rcy - centers[j]))
        for b in boxes:
            if _covered(b, rl[0], rl[2]) and abs(b.cy - rcy) <= reach:
                pinned[id(b)] = k
    for b in boxes:
        k = pinned.get(id(b))
        if k is None:
            k = min(range(len(centers)), key=lambda j: abs(b.y1 - centers[j]))
        rows[k].append(b)
    rows = [r for r in rows if r]
    if len(rows) < 2:
        return None
    for r in rows:
        if (max(z.x1 for z in r) - min(z.x0 for z in r)) < width * 0.25:
            return None
    return rows


def assemble(boxes, rules, depth=0):
    """상자들 + 규칙선들 → LaTeX 문자열 (재귀)."""
    boxes = [b for b in boxes if (b.tex or "").strip() != "" or b.atomic]
    if not boxes:
        return ""
    if depth > 14:
        return " ".join(b.tex for b in sorted(boxes, key=lambda b: b.x0))

    if depth == 0:
        # 14.46 · 행렬이 먼저다. cases(왼쪽 중괄호만)와 달리 구분자가 좌우에
        # 짝으로 있으므로 \begin{bmatrix} 로 확정할 수 있고, 글자 수가 많아도
        # aligned 로 찢기 전에 행·열(&amp; \\)을 살려야 한다.
        mx = _try_matrix(boxes, rules, depth)
        if mx:
            return mx
        cased = _try_cases(boxes, rules, depth)
        if cased:
            return cased
        rws = _row_split(boxes, rules)
        if rws:
            # 14.70 · 각 행에는 '그 행의 y 범위 안' 규칙선만 준다. 전 페이지
            # 규칙선을 통째로 넘기면 다른 행(줄)의 √ 윗변이 이 행의 분수선으로
            # 둔갑해 \sqrt{k+1} 이 \sqrt{+1}rac{k}{k} 로 깨졌다(K.4).
            def _row_rules(row):
                _y0 = min(z.y0 for z in row) - 3.0
                _y1 = max(z.y1 for z in row) + 3.0
                return [rl for rl in rules
                        if _y0 <= (rl[1] + rl[3]) / 2.0 <= _y1]
            parts = [assemble(r, _row_rules(r), depth + 1) for r in rws]
            parts = [p for p in parts if p.strip()]
            if len(parts) > 1:
                return (r"\begin{aligned} " + r" \\ ".join(parts)
                        + r" \end{aligned}")

    fracs, radbar = _classify_rules(boxes, rules)

    # ── ① 가장 바깥(가장 넓은) 분수선으로 위/아래를 가른다 ──
    # 14.48 · 쌓음짝이 먼저 분수가 되면 원자 상자(fb)가 남는다. fb 는
    # x-span 이 같아 _covered 를 통과하고 분자·분모 행세를 한다 —
    # 같은 폭인데 막대와 떨어진(위/아래로 분리된) 원자는 남의 분수다.
    def _mate_frac(b, rx0, rx1, rcy):
        if not b.atomic:
            return False
        if abs(b.x0 - rx0) > 1.5 or abs(b.x1 - rx1) > 1.5:
            return False
        return b.y1 < rcy - 1.0 or b.y0 > rcy + 1.0
    # 14.48 · 행렬 도둑질 금지: 격자로 조립되는 구분자 쌍의 안쪽 상자들을
    # 미리 모아 둔다. 분수 규칙선이 그 안쪽 상자만으로 분자·분모를 삼으면
    # 건너뛴다 — [1/2, √3/2; √3/2, −1/2] 의 셀 규칙선이 이웃 셀의 '−' 를
    # 분모로 끌고 가 행렬이 \left[ mush 로 무너졌다(p29 ⑥). 격자가 안
    # 되는 괄호(진짜 분수 [(a+b)/(c+d)] 는 1행이라 격자 실패)는 예전 그대로다.
    _guarded = []
    if fracs and any(b.role in ("open", "close") for b in boxes):
        try:
            _gbs = sorted(boxes, key=lambda b: (b.x0, b.y0))
            for _gi in range(len(_gbs)):
                if _gbs[_gi].role != "open" and not _is_matrix_delim(_gbs[_gi]):
                    continue
                _gj = _matrix_delim_pair(_gbs, _gi)
                if _gj <= _gi + 1:
                    continue
                _go, _gc = _gbs[_gi], _gbs[_gj]
                _gcon = [b for b in _gbs[_gi + 1:_gj]
                         if (b.tex or "").strip() or b.atomic]
                if len(_gcon) < 2 or not _delims_wrap(_go, _gc, _gcon):
                    continue
                if any(b.role in ("open", "close") for b in _gcon):
                    continue
                _y0 = min(_go.y0, _gc.y0); _y1 = max(_go.y1, _gc.y1)
                _tol = (_y1 - _y0) * 0.10 + 2.0
                _gcon = [b for b in _gcon if _y0 - _tol <= b.cy <= _y1 + _tol]
                if len(_gcon) >= 2 and _matrix_grid(_gcon, rules) is not None:
                    _guarded.append(set(map(id, _gcon)))
        except Exception:
            _guarded = []
    best = None
    for r in fracs:
        rx0, ry0, rx1, ry1 = r
        rcy = (ry0 + ry1) / 2.0
        # 14.48 · 세로로 쌓인 분수(한 칸에 1/4 over 3/4): x-span 이 같은
        # 규칙선들은 '쌓음짝' — 짝 사이 중간점으로 상자를 나눠 각 선이
        # 제 분자·분모만 갖는다. 그냥 두면 먼저 뽑힌 선이 아래 분수까지
        # 삼켜 \frac{\frac{1}{34}}{4} 꼴이 됐다. 중첩 분수는 바깥 선이
        # 넓으므로(폭 차 ≥ 2pt) 짝이 안 돼 예전 경로 그대로다.
        lo, hi = -1e9, 1e9
        for m in fracs:
            if m is r:
                continue
            if abs(m[0] - rx0) > 1.0 or abs(m[2] - rx1) > 1.0:
                continue
            mcy = (m[1] + m[3]) / 2.0
            if abs(mcy - rcy) < 1.0:
                continue
            mid = (mcy + rcy) / 2.0
            if mcy < rcy:
                lo = max(lo, mid)
            else:
                hi = min(hi, mid)
        span = [b for b in boxes
                if _covered(b, rx0, rx1) and lo < b.cy < hi
                and not _mate_frac(b, rx0, rx1, rcy)]
        above = [b for b in span if b.cy < rcy - 0.5]
        below = [b for b in span if b.cy > rcy + 0.5]
        if not above or not below:
            continue
        # 분수선은 분자·분모를 '거의' 덮어야 한다.
        # 10.0 · 큰 분수는 큰 괄호·적분 기호가 분수선 끝보다 살짝 더 나오는
        #  일이 흔하다. 분수선이 클수록 여유를 함께 늘린다(작은 분수는
        #  여전히 2.5pt 엄격 — 옆 글자가 분자로 빨려 들어가는 일은 그대로 방지).
        slack = max(2.5, 0.045 * (rx1 - rx0))
        if any(b.x0 < rx0 - slack or b.x1 > rx1 + slack for b in above + below):
            continue
        # 14.48 · 행렬 도둑질 금지 (위 _guarded): 안쪽 상자만으로 분자·분모를
        # 삼는 규칙선은 건너뛴다 — _linear 의 _delim_group 이 격자로 조립한다.
        if _guarded and any(all(id(b) in _gs for b in above + below)
                            for _gs in _guarded):
            continue
        # 분자·분모가 둘 다 분수선 폭의 일부라도 실제로 차지해야 한다
        if not above or not below:
            continue
        w = rx1 - rx0
        if best is None or w > best[0]:
            best = (w, rcy, rx0, rx1, r, lo, hi)

    if best is not None:
        _w, rcy, rx0, rx1, used, blo, bhi = best
        num, den, rest = [], [], []
        for b in boxes:
            if (_covered(b, rx0, rx1) and blo < b.cy < bhi
                    and not _mate_frac(b, rx0, rx1, rcy)):
                bar = radbar.get(id(b))
                eff_cy = (bar[1] + bar[3]) / 2.0 if (b.role == "radical" and bar) else b.cy
                (num if eff_cy < rcy else den).append(b)
            else:
                rest.append(b)
        sub = [r for r in rules if r is not used]
        frac = (r"\frac{" + assemble(num, sub, depth + 1) + "}{"
                + assemble(den, sub, depth + 1) + "}")
        if rest:
            # 이 덩어리의 '글자 크기' 는 분자·분모 내용의 크기다. 영역 전체
            # 중앙값을 쓰면 지수로 올라간 작은 분수를 본문 크기로 착각한다.
            fb = Box(rx0, min(b.y0 for b in num), rx1, max(b.y1 for b in den),
                     frac, _median([b.size for b in (num + den)]), atomic=True)
            return assemble(rest + [fb], sub, depth + 1)
        return frac

    # ── ② 분수선이 없다 → x 순서로 읽으며 첨자·큰 연산자를 붙인다 ──
    return _linear(boxes, rules, depth)


# 14.70 · 한계(limits)를 갖는 디스플레이 연산자 — 글자 사이에 한계 첨자가
# 끼어드는 모양만 여기서 조립한다. 나머지(ker, exp, …)는 기존 낱말 병합이 처리.
_OP_LIMIT_WORDS = {"lim", "max", "min", "sup", "inf", "limsup", "liminf",
                   "argmax", "argmin", "gcd"}


def _try_operator_word(bs, i, b, taken, out):
    """b 에서 시작하는 글자 런이 연산자(lim…)면 (명령, 아래한계, 위한계,
    다음 위치, 회수한 앞 글자) 를 돌려준다. 아니면 (None, …, i, [])."""
    try:
        n = len(bs)
        op_h = max(b.h, b.size * 0.72)
        letters = [b]
        scripts = []
        j = i
        last_l = b
        while j < n:
            c = bs[j]
            if (not c.atomic and c.role is None
                    and len(c.tex) == 1 and c.tex.isascii() and c.tex.isalpha()
                    and c.style == b.style
                    and abs(c.size - b.size) < 0.4
                    and abs(c.cy - b.cy) < op_h * 0.30
                    and c.x0 - last_l.x1 < op_h * 0.45):
                letters.append(c)
                last_l = c
                j += 1
                continue
            if (not c.atomic and c.role is None
                    and c.size < b.size * 0.95
                    and abs(c.cy - b.cy) >= op_h * 0.30
                    and c.x0 - last_l.x0 < op_h * 2.4):
                scripts.append(c)
                j += 1
                continue
            break
        word = "".join(l.tex for l in letters)
        if word not in _OP_LIMIT_WORDS or len(letters) < 2:
            return None, None, None, i, []
        # 앞에서 이미 뽑힌 '왼쪽 아래·위 한계'(\lim 의 n)를 회수한다
        w = max(1.0, letters[-1].x1 - letters[0].x0)
        span0 = letters[0].x0 - w * 0.9 - 2.0
        span1 = letters[-1].x1 + w * 0.9 + 2.0
        used = []
        # 최근에 발행된 것부터 회수해야 out 끝에서 차례로 pop 된다.
        # (앞쪽 것부터 pop 하면 out[-1] 이 안 맞아 회수가 실패한다.)
        for c in reversed(list(taken)):
            if (c.size < b.size * 0.95
                    and abs(c.cy - b.cy) >= op_h * 0.30
                    and span0 <= (c.x0 + c.x1) / 2 <= span1):
                scripts.append(c)
                used.append(c)
        lo = [c for c in scripts if c.cy > b.cy]
        hi = [c for c in scripts if c.cy < b.cy]
        lo.sort(key=lambda z: z.x0)
        hi.sort(key=lambda z: z.x0)
        return "\\" + word, lo, hi, j, used
    except Exception:
        return None, None, None, i, []


# 14.70 · 한계(limits) 첨자를 조립한다. 두 줄로 쌓인 아래첨자
# (\sum_{k,l;\\(1-q)μ_l+qμ_k>0} 의 substack)는 한 줄로 뭉개면 글자가
# 뒤섞인다 — 행으로 갈라 \substack{…\\…} 로 내보낸다.
def _limits_group(boxes, rules, depth):
    try:
        if len(boxes) < 3:
            return assemble(boxes, rules, depth + 1)
        szs = [b.size for b in boxes]
        tol = max(3.0, 0.5 * _median(szs))
        order = sorted(boxes, key=lambda z: z.cy)
        rows = [[order[0]]]
        for c in order[1:]:
            if abs(c.cy - rows[-1][-1].cy) > tol:
                rows.append([c])
            else:
                rows[-1].append(c)
        rows = [r for r in rows if r]
        if len(rows) < 2:
            return assemble(boxes, rules, depth + 1)
        # 두 행이 세로로 '쌓여' 있어야 substack 이다. 좌우로 어긋난 흩어진
        # 첨자(폭이 넓은 한 줄 첨자의 흩어짐)는 그대로 한 줄로 읽는다.
        if max(min(z.y0 for z in r) for r in rows) \
                <= min(max(z.y1 for z in r) for r in rows) - tol:
            return assemble(boxes, rules, depth + 1)
        parts = []
        for r in rows:
            r = sorted(r, key=lambda z: z.x0)
            parts.append(assemble(r, rules, depth + 1))
        return r"\substack{" + r" \\ ".join(p for p in parts if p) + "}"
    except Exception:
        return assemble(boxes, rules, depth + 1)


def _linear(boxes, rules, depth):
    r"""분수선이 없는 영역: 왼쪽→오른쪽으로 읽는다.

    · 큰 적분/시그마  → \int_{아래}^{위}
    · 큰 여는 괄호    → \left( ... \right)  (짝을 찾아 재귀)
    · 큰 세로 막대 |  → \right| _{아래}^{위}   ← 대입 기호(evaluation bar)
    · 큰 루트         → \sqrt{ 윗줄이 덮는 범위 }
    · 작고 위/아래    → ^{ } / _{ }
    """
    bs = sorted(boxes, key=lambda b: (b.x0, b.y0))
    _fr, radbar = _classify_rules(bs, rules)
    base_sz = _median([b.size for b in bs if not b.atomic] or [10.0])
    # 본문 글자 높이(첨자 판정 기준): 큰 글리프를 뺀 중앙값
    norm_h = _median([b.h for b in bs if not b.atomic and b.role is None] or [base_sz])
    # 본문 글자 크기(구분자 첨자 수집의 상한): 역할 없는 글자만의 중앙값
    body_sz = _median([b.size for b in bs if not b.atomic and b.role is None]
                      or [base_sz])
    # 14.70 · 위 중앙값은 첨자(size 7/5)가 많은 식에서 7 로 내려앉는다.
    # 그 상한을 그대로 쓰면 (ρ) 뒤의 ⊗n(7pt, 위첨자)이 '본문 크기'로
    # 보여 ^{⊗n} 조립이 불가능했다. '가장 크면서 3개 이상 있는 크기' =
    # 본문 줄의 크기를 따로 계산해 구분자 첨자 판정에만 쓴다.
    _szc = {}
    for b in bs:
        if b.atomic or b.role is not None:
            continue
        k = round(b.size, 1)
        _szc[k] = _szc.get(k, 0) + 1
    if _szc:
        _tot = sum(_szc.values())
        main_sz = next((s for s in sorted(_szc, reverse=True)
                        if _szc[s] >= 3 or _szc[s] >= _tot * 0.2), base_sz)
    else:
        main_sz = base_sz
    # 중앙값이 첨자에 끌려 내려갔을 때만 본문 크기로 올린다(내려가는 일은 없다).
    body_sz = max(body_sz, main_sz)
    # 14.70 · '첨자 안의 연산자'는 디스플레이 연산자가 아니다.
    # E_λ = ∑_{w∈U(⊕_{b≠a}L(V_b))v_λ} M_w 에서 ⊕(size 7)은 ∑(size 10)의
    # 아래첨자 안에 들어있다. x 순서로는 ∑보다 앞이라 ⊕이 먼저 처리되어
    # ∑의 첨자 조각을 가로채고 있었다. 본문 크기보다 작은 op 상자는
    # 평범한 글자 상자로 강등해, 바깥 연산자의 첨자 수집·재귀 조립에
    # 맡긴다(재귀 assemble 안에서는 다시 op 로 조립된다).
    _opmax = max([b.size for b in bs if b.role == "op"] or [0.0])
    if _opmax:
        for b in bs:
            if b.role == "op" and b.size < main_sz * 0.85 and b.size < _opmax * 0.85:
                b.role = None
    out = []
    out_src = []        # 14.71 · out 항목별 '근원 상자' — 한계 회수가 값을
                        # 비교해 pop 하던 시절(p79·p89 '=' 소실)과 달리
                        # 상자 단위로 정확히 되돌린다.
    taken = []          # 방금 평범하게 찍은 글자들 (큰 연산자 한계로 회수될 수 있다)

    def _emit(piece, src):
        out.append(piece)
        out_src.append(src)

    def _unemit(ids_gone):
        """근원 상자가 전부 ids_gone 에 드는 out 항목을 지운다."""
        for _k in range(len(out) - 1, -1, -1):
            _src = out_src[_k]
            if _src and all(id(_b) in ids_gone for _b in _src):
                del out[_k]
                del out_src[_k]

    i = 0
    n = len(bs)
    while i < n:
        b = bs[i]

        # ── 큰 괄호: 짝을 찾아 그 안을 통째로 재귀 ──
        # 14.46 · 일반 글리프를 세로로 늘려 그린 큰 괄호(unicode-math·Word 계열)도
        #         같은 경로로 본다. 단 그 경우는 '행렬로 조립될 때만' 바꾼다 —
        #         _delim_group 이 None 을 주면 평범한 글자로 읽어 예전 출력이 그대로
        #         나오므로 어떤 수식도 새로 깨지 않는다.
        if b.role == "open" or (_is_matrix_delim(b) and b.h >= norm_h * 1.45):
            grp = _delim_group(bs, i, rules, depth, norm_h)
            if grp is not None:
                _emit(grp[0], None)
                i = grp[1]
                continue

        if b.role == "close":
            _emit(r"\left. \right" + b.tex, None)
            i += 1
            continue

        # ── 대입 기호(큰 세로 막대) + 위/아래 한계 ──
        if b.role == "vbar" and b.h <= norm_h * 1.35:
            # 키가 크지 않은 세로 막대는 일반 기호로 처리 (첨자 수집 허용)
            b.role = None

        if b.role == "vbar":
            # 대입 기호: 오른쪽에 붙은 작은 글자들이 아래/위 한계다 (|_{cut})
            # 기준선: 막대 자체의 한가운데가 아니라 '옆 본문 글자'의 중심.
            # 막대는 위아래로 길어서 그 중심을 쓰면 아래첨자가 위첨자로 뒤집힌다.
            neigh = [c for c in bs if c.role is None and not c.atomic
                     and c.size >= b.size * 0.95]
            ref_cy = _median([c.cy for c in neigh] or [b.cy])
            # 14.70 · 바로 오른쪽 큰 연산자(∑)의 한계 첨자를 훔치지 않는다.
            # |∑_{i∈I_a}(θ_j)_i| 에서 막대가 먼저 처리되며 ∑ 의 아래첨자
            # 'i' 를 \Biggr|_{i} 로 삼켜버렸다. 후보가 어떤 op 상자 '아래'
            # 에 있는면 그것은 그 연산자의 한계다.
            _ops_ahead = [o for o in bs
                          if o.role == "op" and o.x0 >= b.x0 - 0.5]
            lo, hi = [], []
            j = i + 1
            while j < n:
                c = bs[j]
                if c.atomic or c.role is not None:
                    break
                if c.size >= b.size * 0.95:
                    break
                if any(abs((c.x0 + c.x1) / 2 - (o.x0 + o.x1) / 2)
                       <= max(o.w * 0.85, 6.0)
                       and abs(c.cy - o.cy) >= 0.4 * max(o.h, o.size)
                       for o in _ops_ahead):
                    break
                prev = max([x.x1 for x in (lo + hi)] or [b.x1])
                if c.x0 - prev > b.size * 0.6:
                    break
                (lo if c.cy > ref_cy else hi).append(c)
                j += 1
            # 대입 기호의 '키'를 원본만큼 살린다. \left.\right| 만 쓰면
            # 내용이 없어 막대가 한 줄 높이로 쪼그라든다. 원본 막대가
            # 본문보다 몇 배 큰지 재서 \middle| 대신 크기 명령을 붙인다.
            # 14.70 · vextenddouble(‖ 노름 막대)는 b.tex 가 r"\|" 다 —
            # 크기 접두사를 붙인 뒤에도 반드시 이중 막대로 내보낸다.
            ratio = b.h / max(1e-6, norm_h)
            stem = (b.tex or "|") if (b.tex or "").strip() in ("|", r"\|") else "|"
            if   ratio >= 3.2: bar = r"\Biggr" + stem
            elif ratio >= 2.5: bar = r"\biggr" + stem
            elif ratio >= 1.9: bar = r"\Bigr" + stem
            else:              bar = r"\bigr" + stem
            piece = bar
            if lo: piece += "_{" + assemble(lo, rules, depth + 1) + "}"
            if hi: piece += "^{" + assemble(hi, rules, depth + 1) + "}"
            _emit(piece, None)
            i = j
            continue

        # ── 큰 루트: 윗줄(rule)이 덮는 x 범위가 근호 안이다 ──
        if b.role == "radical":
            bar = radbar.get(id(b))
            if bar:
                bar_cy = (bar[1] + bar[3]) / 2.0
                inside = [c for c in bs[i + 1:]
                          if c.x0 >= bar[0] - 2.5 and c.x1 <= bar[2] + 2.5 and abs(c.cy - bar_cy) <= 14.0]
                sub = [r for r in rules if r is not bar]
                _emit(r"\sqrt{" + assemble(inside, sub, depth + 1) + "}", None)
                keep = [c for c in bs[i + 1:] if c not in inside]
                bs = bs[:i] + keep
                n = len(bs)
                continue
            # 윗줄이 없으면 바로 뒤 한 덩어리를 근호 안으로
            if i + 1 < n:
                nxt = bs[i + 1]
                _emit(r"\sqrt{" + nxt.tex + "}", None)
                bs = bs[:i] + bs[i + 2:]
                n = len(bs)
                continue
            _emit(r"\sqrt{}", None)
            i += 1
            continue
            # 윗줄이 없으면 바로 뒤 한 덩어리를 근호 안으로
            if i + 1 < n:
                nxt = bs[i + 1]
                _emit(r"\sqrt{" + nxt.tex + "}", None)
                bs = bs[:i] + bs[i + 2:]
                n = len(bs)
                continue
            _emit(r"\sqrt{}", None)
            i += 1
            continue

        # ── 큰 연산자(∫ ∑ ∏): 위/아래 한계를 모은다 ──
        if b.role == "op" or (b.tex in (r"\int", r"\sum", r"\prod", r"\oint")
                              and b.h > norm_h * 1.5):
            # 큰 연산자의 한계는 연산자보다 살짝 왼쪽에서 시작하기도 한다
            # (\sum_{states} 의 s 가 ∑ 왼쪽에 걸침) → 이미 처리한 앞 글자도 회수한다
            lo, hi = [], []
            reach = b.x1 + max(3.0, b.w * 0.35)
            # 14.70 · span0 를 연산자 폭보다 넓게: \sup_{\|u\|\le n} 처럼
            # 한계 첨자가 연산자 왼쪽으로 삐져나오는 경우도 회수한다.
            span0 = b.x0 - max(b.w * 0.55, b.h * 0.9)
            # 14.70 · \substack 아래첨자는 연산자 폭보다 훨씬 넓게 좌우로
            # 펼쳐진다((1-q)μ_l+qμ_k>0). 다만 '본문 줄에 붙은 보통 첨자'
            # (x_i ∑_j 의 i, x²∑ 의 ²)까지 훔치면 안 된다 — 보통 첨자는
            # 베이스라인에서 3~5pt 벗어나는 데 반해 디스플레이 한계는
            # 연산자 키의 65% 이상 떨어져 있다. 그 차이로 가른다.
            span_far = b.x0 - max(b.w * 2.5, 24.0)
            far_drop = 0.65 * max(b.h, b.size)

            # 14.70 · 회수는 '발행 묶음'(글자+첨자) 단위로, 뒤에서부터
            # 연속적으로만 되돌린다. 묶음 하나라도 조건에 걸리면 그 앞은
            # 건드리지 않는다(이웃 토큰의 첨자를 훔치는 일 방지).
            def _reclaim_ok(c):
                if c.size >= b.size * 0.95 or c.atomic:
                    return False
                if c.x0 < span_far:
                    return False
                if c.x0 < span0 and abs(c.cy - b.cy) < far_drop:
                    return False
                return True

            # 14.71 · 발행 항목을 뒤에서부터 상자 단위로 되돌린다. 값으로
            # pop 하던 예전 코드는 같은 글자('Z_F =' 의 '=' 과 첨자 '=')를
            # 잘못 지워 \sum 앞의 '=' 이 사라지는 사고를 냈다(p79·p89).
            reclaimed = []
            _k = len(out) - 1
            while _k >= 0:
                _src = out_src[_k]
                if not _src or not all(_reclaim_ok(c) for c in _src):
                    break
                reclaimed = _src + reclaimed
                _k -= 1
            if _k + 1 < len(out):
                del out[_k + 1:]
                del out_src[_k + 1:]
            for c in reclaimed:
                if c in taken:
                    taken.remove(c)
                (lo if c.cy > b.cy else hi).append(c)
            # 낱낱 글자(taken 에만 남은)의 잔여 회수 — 항목 삭제도 근원 상자로
            _extra = [c for c in list(taken) if _reclaim_ok(c)]
            if _extra:
                _gone = set(id(c) for c in reclaimed + _extra)
                for c in _extra:
                    taken.remove(c)
                    (lo if c.cy > b.cy else hi).append(c)
                _unemit(_gone)
            # 14.70 · 한계 글자는 연산자 폭을 조금 넘어가기도 한다(\sum_{states}).
            # 작은 글자가 끊기지 않고 이어지는 동안 계속 받아들인다.
            # 단, 다른 큰 연산자 아래·위에 놓인 글자는 그 연산자의 한계다
            # (\sum_{j=1}^{m}\sum_{i∈I_a} 의 두 번째 i 를 첫 ∑ 이 삼키는 방지).
            _ops_others = [o for o in bs
                           if o.role == "op" and o is not b]
            k = i + 1
            while k < n:
                c = bs[k]
                if c.atomic or c.role is not None:
                    break
                small = (c.size < b.size * 0.95) or (c.h < norm_h * 0.95)
                if not small:
                    break
                # 14.70 · 후보가 이 연산자 폭 안이면 내 것이다. 폭 밖이고
                # 다른 연산자 폭 안이면 그쪽 한계 첨자다
                # (\sum_{j=1}^{m}\sum_{i∈I_a} — '1' 은 첫 ∑ 폭 안, 'i' 는
                # 두 번째 ∑ 폭 안).
                _ccx = (c.x0 + c.x1) / 2
                if not (b.x0 - 2.0 <= _ccx <= b.x1 + 2.0):
                    if any(o.x0 - 2.0 <= _ccx <= o.x1 + 2.0
                           and abs(c.cy - o.cy) >= 0.4 * max(o.h, o.size)
                           for o in _ops_others):
                        break
                prev = max([z.x1 for z in (lo + hi)] or [b.x0])
                if c.x0 > reach and c.x0 - prev > b.size * 0.28:
                    break
                (lo if c.cy > b.cy else hi).append(c)
                k += 1
            lo.sort(key=lambda z: z.x0); hi.sort(key=lambda z: z.x0)
            piece = b.tex
            if lo: piece += "_{" + _limits_group(lo, rules, depth) + "}"
            if hi: piece += "^{" + _limits_group(hi, rules, depth) + "}"
            _emit(piece, None)
            i = k
            continue

        # ── 보통 글자 (+ 뒤따르는 첨자) ──
        word = b.tex
        last = b               # 낱말로 합친 마지막 글자 (첨자 위치 기준)
        taken.append(b)
        _word_src = [b]        # 14.71 · 이 낱말을 만든 상자들 (되돌리기용)
        i += 1

        # 14.70 · 디스플레이 연산자(lim·max·min·sup·inf …)는 한계 첨자가
        # 글자 사이·아래에 끼어 들어온다(\lim_{n\to\infty} 의 'n' 은 l 왼쪽,
        # '→' 는 l·i 사이에 놓인다). 낱낱의 글자 병합으로는 절대 'lim' 이
        # 되지 않아 \mathrm{l}_{\to}\mathrm{im}_{\infty} 로 부서졌다.
        # 글자 런을 만들되 '작고 위/아래에 떠 있는' 상자는 한계로 따로 모아,
        # 완성된 낱말이 연산자면 \lim_{…}^{…} 하나로 내보낸다.
        op_done = False
        if (len(word) == 1 and word.isascii() and word.isalpha()
                and not b.atomic and b.role is None):
            opw, oplo, ophi, op_end, op_used = _try_operator_word(
                bs, i, b, taken, out)
            if opw is not None:
                # 14.71 · 회수한 앞 글자의 발행분도 근원 상자 단위로 지운다.
                # 값 비교 pop 은 합쳐진 낱말('\mathrm{sp}')을 못 지워
                # t∈sp 가 이중 발행됐다(p87 sup·spec 교차).
                for c in op_used:
                    if c in taken:
                        taken.remove(c)
                _unemit(set(id(c) for c in op_used))
                piece = opw
                if oplo:
                    piece += "_{" + assemble(oplo, rules, depth + 1) + "}"
                if ophi:
                    piece += "^{" + assemble(ophi, rules, depth + 1) + "}"
                _emit(piece, None)
                word = opw
                last = b
                i = op_end
                op_done = True
        if not op_done:
            # 여러 글자로 된 함수 이름 묶기 (sin, exp, lim …)
            # 스타일(글꼴)은 여기서 합친 뒤 낱말 하나에만 씌운다. 글자마다 미리
            # 씌우면 'exp' 가 \mathrm{e}\mathrm{x}\mathrm{p} 로 굳어 이 병합이
            # 아예 돌지 않고, \exp 연산자도 영영 복원되지 않는다.
            while (i < n and not bs[i].atomic and bs[i].role is None
                   and len(bs[i].tex) == 1 and bs[i].tex.isascii() and bs[i].tex.isalpha()
                   and word.isascii() and word.isalpha()
                   and bs[i].style == b.style
                   and abs(bs[i].cy - b.cy) < norm_h * 0.3
                   and bs[i].x0 - bs[i - 1].x1 < norm_h * 0.18
                   and abs(bs[i].size - b.size) < 0.4):
                word += bs[i].tex
                last = bs[i]
                taken.append(bs[i])       # 14.71 · 한계 회수가 낱낱 글자도 보게
                _word_src.append(bs[i])
                i += 1
            # 14.48 · 숫자 런 합치기: 분자 '21'이 '2 1'로 흩어지면 분수가 깨진다
            # (p26의 21/5 네 군데). 숫자+소수점만 합치고, '3x'의 띄어쓰기
            # 관례(숫자+문자)는 건드리지 않는다. 위/아래로 어긋난 숫자는
            # 다른 줄(분자·분모)이므로 합치지 않는다.
            while (i < n and not bs[i].atomic and bs[i].role is None
                   and len(bs[i].tex) == 1 and bs[i].tex in "0123456789."
                   and len(word) >= 1
                   and all(c in "0123456789." for c in word)
                   and bs[i].style == b.style
                   and abs(bs[i].cy - b.cy) < norm_h * 0.3
                   and bs[i].x0 - bs[i - 1].x1 < norm_h * 0.18
                   and abs(bs[i].size - b.size) < 0.4):
                word += bs[i].tex
                last = bs[i]
                taken.append(bs[i])       # 14.71 · 숫자 런도 회수 대상
                _word_src.append(bs[i])
                i += 1
            if _MATHOP.match(word):
                _emit("\\" + word if word not in ("Tr", "tr") else r"\mathrm{Tr}",
                      _word_src)
            else:
                _emit(_style_latex_atom(word, b.style) if b.style else word,
                      _word_src)

        # 첨자 수집: 바로 오른쪽에 붙은 '작은' 글자들.
        #   기준은 전체 중앙값이 아니라 '지금 이 글자(b)' 다. 중앙값을 쓰면
        #   M^{tree}_{(1)} 처럼 작은 글자가 더 많은 식에서 기준이 작아져
        #   첨자를 하나도 못 잡는다.
        #   위/아래 첨자는 x 로 섞여 나오므로(t ( r 1 e ) e) 한 덩어리로
        #   모은 뒤 높이로 가른다.
        # 관계·연산 기호(= + - < >)에는 첨자가 붙지 않는다. 이걸 막지 않으면
        # '= \sum_{states}' 의 s 가 '=' 의 아래첨자로 붙어버린다.
        if word in ("=", "+", "-", r"\pm", r"\mp", r"\to", r"\approx",
                    r"\equiv", r"\le", r"\ge", "<", ">", r"\ne", r"\simeq"):
            continue
        ref_sz = b.size
        # 14.48 · 키 큰 괄호((A−λI)의 '(' — sz 12.1, 본문 10.5)가 본문 크기
        # 이웃을 '작다'고 착각해 위·아래첨자로 삼켰다((^{A−λI})·) ^{…}_{…}).
        # 구분자 베이스는 본문 크기(body_sz)를 상한으로 삼아 진짜 작은
        # 글자(위첨자 ⁻¹ 등)만 수집한다. 글자 베이스(X⁻¹ 등)는 그대로 둔다.
        if (b.tex or "") in _MAT_DELIM_TEX:
            ref_sz = min(ref_sz, body_sz)
        # 기준 높이는 글자마다 들쭉날쭉하다('-' 는 낮고 'l' 은 높다).
        # 글꼴 크기를 1차 기준으로 쓰고, 높이는 보조로만 본다.
        ref_h = max(ref_sz * 0.72, b.h)
        base_cy = b.cy
        cluster = []
        pend = []          # 크기는 첨자인데 위/아래가 애매한 글자 (판단 보류)
        while i < n:
            c = bs[i]
            # 이미 조립된 덩어리(분수 등)도 작고 위로 떠 있으면 지수다.
            #   (V/(4/3)π)^{1/3} 의 1/3 이 이 경우.
            if c.atomic:
                if (c.size < ref_sz * 0.9
                        and (last.y1 - c.y1) >= ref_h * 0.30
                        and c.x0 - max([z.x1 for z in (cluster + pend)] or [last.x1]) <= ref_h * 0.5):
                    cluster.extend(pend); pend = []
                    cluster.append(c)
                    i += 1
                    continue
                break
            if c.role is not None:
                break
            prev_x1 = max([z.x1 for z in (cluster + pend)] or [last.x1])
            if c.x0 - prev_x1 > ref_h * 0.5:
                break
            small = c.size < ref_sz * 0.95
            same_run = bool(cluster) and abs(c.cy - cluster[-1].cy) < ref_h * 0.25
            if not (small or same_run):
                break
            bl_off = abs(c.y1 - last.y1)
            off = abs(c.cy - base_cy)
            # 14.70 · 본문 크기 글리프(연산자·기호)는 축 중심이라 중심(cy)이
            # 글자와 2pt 남짓 어긋나는 게 정상이다(⇄ ⊗ …). 그런 것까지
            # 첨자로 모으면 (ρ)^{⊗n⇄} 처럼 이웃 연산자가 삼켜진다.
            # 첨자 크기(≈0.7×)는 0.12·ref_h, 본문 크기는 0.35·ref_h 만큼
            # 떠 있어야 첨자로 본다.
            clear_off = off >= (ref_h * 0.12 if small else ref_h * 0.35)
            if clear_off or (small and bl_off >= ref_h * 0.05) or (small and c.size < ref_sz * 0.82):
                # 위/아래가 분명하다 → 보류분까지 함께 확정
                cluster.extend(pend); pend = []
                cluster.append(c)
                i += 1
                continue
            # 크기는 첨자인데 중심이 애매한 글자(σ^{⊗n} 의 ⊗ 처럼 글리프 상자가
            # 위아래로 긴 기호). 뒤에 확실한 첨자가 이어지면 그때 함께 넣는다.
            if small and c.size < ref_sz * 0.9:
                pend.append(c)
                i += 1
                continue
            break
        # 끝까지 확정되지 않은 보류분은 첨자가 아니다 → 되돌린다
        if pend:
            i -= len(pend)
        # 14.0 · 첨자 판정은 글자 상자 중심(cy)보다 베이스라인(y1)이 정확하다.
        #   칠판체 S^n 처럼 본문 글리프가 커서 cy 가 거의 같아도 n 은 위첨자다.
        ref_bl = last.y1
        subs, sups, rest = [], [], []
        for c in cluster:
            if c.y1 > ref_bl + max(0.25, ref_h * 0.06):
                subs.append(c)
            elif c.y1 < ref_bl - max(0.25, ref_h * 0.06):
                sups.append(c)
            else:
                rest.append(c)
        for c in rest:
            (subs if c.cy > last.cy else sups).append(c)
        if sups and out and out[-1].rstrip().endswith("'"):
            out[-1] = "{" + out[-1].strip() + "}"
        if sups: _emit("^{" + assemble(sups, rules, depth + 1) + "}", list(sups))
        if subs: _emit("_{" + assemble(subs, rules, depth + 1) + "}", list(subs))


    return " ".join(x for x in out if x).strip()


def region_boxes(doc, page, rect, gtables=None, rd=None, vlines=None):
    """페이지의 한 영역에서 Box 목록을 만든다 (CMEX 글리프 해석 포함).

    rd 를 넘기면 페이지 rawdict 를 다시 읽지 않는다 — 행렬 후보를 여러 개
    확인할 때 같은 쪽을 수십 번 다시 파싱하지 않게.
    vlines(page_vlines 결과)를 넘기면 짝을 이룬 세로 벡터선을 | 구분자로
    합성한다 — 글리프 없는 행렬식 막대(det A = |a b; c d|)를 살리려고.
    짝 없이 홀로 선 것은 건드리지 않는다(표 테두리·장식선 오인 방지).
    """
    if gtables is None:
        gtables = font_glyph_tables(doc, page)
    x0, y0, x1, y1 = rect
    out = []
    if rd is None:
        try:
            rd = _page_rawdict(page)
        except Exception:
            return out
    for blk in rd.get("blocks", []):
        if blk.get("type") != 0:
            continue
        for ln in blk.get("lines", []):
            for sp in ln.get("spans", []):
                fname = (sp.get("font") or "")
                size = float(sp.get("size") or 10)
                short = fname.split("+")[-1]
                table = gtables.get(fname) or gtables.get(short) or {}
                ext = ("CMEX" in short.upper() or "TXEX" in short.upper()
                       or "EXTRA" in short.upper() or "LMEX" in short.upper()
                       or "ESINT" in short.upper())
                for ch in (sp.get("chars") or []):
                    c = ch.get("c") or ""
                    bb = ch.get("bbox")
                    if not bb:
                        continue
                    cx = (bb[0] + bb[2]) / 2.0
                    cy = (bb[1] + bb[3]) / 2.0
                    if not (x0 - 1 <= cx <= x1 + 1 and y0 - 1 <= cy <= y1 + 1):
                        continue
                    role = None
                    tex = None
                    if ext and (not c or c.isspace()):
                        # 14.46 · MuPDF 는 멀리 떨어진 두 글리프 사이에 '가짜
                        # 빈칸'을 넣는다. 확장 글꼴 빈칸을 글리프로 읽으면
                        # CMEX 코드 32 = integral 이 되어 식 한가운데 ∫ 가 생긴다.
                        #
                        # 14.70 · 하지만 RévéTeX/dvips 계열 PDF 의 확장 글꼴은
                        # ToUnicode 가 비어 있어 '진짜 글리프'가 제어 문자로 읽힌다:
                        #   \r(0x0D)=vextenddouble(‖ 노름 막대 조각),
                        #   \x0c(0x0C)=vextendsingle(| 막대 조각),
                        #   \t(0x09)=bracerightbig, ' '(0x20)=parenleftBigg.
                        # 이들을 통째로 버리면 ‖·| 가 사라지고 큰 괄호 짝이 깨져
                        # ‖E(ρ)−ρ′‖₁ 노름식이 ρ^{…}1 로 뭉개졌다.
                        # 가짜 빈칸의 bbox 폭은 '글자 사이 틈'(측정값 ≤5.2pt)이고
                        # 진짜 글리프는 '글꼴 설계 폭'(≥5.5pt, 잉크 있음)이다.
                        # 0x20 만 폭으로 가리고, 그 외 제어 문자는 글꼴
                        # /Differences 표가 이름을 주면 믿는다.
                        if not c:
                            continue
                        gname_ws = table.get(ord(c))
                        if not gname_ws:
                            continue
                        if c == " " and (bb[2] - bb[0]) < 5.5:
                            continue
                        role, tex = classify_glyph(gname_ws)
                        if tex is not None:
                            style = None
                            out.append(Box(bb[0], bb[1], bb[2], bb[3], tex, size,
                                           role, style=style))
                        continue
                    if ext:
                        gname = table.get(ord(c)) if c else None
                        if not gname and c:
                            gname = _CMEX_STD.get(ord(c))
                        role, tex = classify_glyph(gname)
                        if tex is None:
                            # 이름을 못 얻었으면 이 글리프는 버린다.
                            # (그대로 두면 'Z','p' 같은 쓰레기 글자가 식에 박힌다)
                            # 단 PUA(F8xx) 조각(큰 괄호를 세로로 쌓은 조각)은
                            # 나중에 한 덩어리로 조립한다(cases 큰중괄호 등).
                            if c and 0xE000 <= ord(c) <= 0xF8FF:
                                out.append(Box(bb[0], bb[1], bb[2], bb[3],
                                               "\ue000", size, "pua"))
                            continue
                    else:
                        if not c.strip():
                            continue
                        if c and _is_symbol_font(fname):
                            # 14.47 · Symbol PUA(F0xx/F8xx) 디코딩. 낱기호는
                            # 유니코드로, 큰 괄호 조각은 role 'pua' 로 둔다.
                            dec = _symbol_pua_lookup(ord(c))
                            if dec is None:
                                continue      # 그리기 토막·미지정 코드
                            if isinstance(dec, tuple):
                                out.append(Box(bb[0], bb[1], bb[2], bb[3],
                                               c, size, "pua"))
                                continue
                            if dec is not False:
                                c = dec
                        tex = _tok_tex(c)
                        if c in ("|",):
                            role = "vbar"
                        elif c == "√":
                            role = "radical"
                        elif c in ("∫", "∑", "∏", "∮"):
                            role = "op"
                        elif tex in _ACCENT_TEX:
                            # A standalone TeX accent glyph (ˆ ˜ ¯ …). It is a
                            # command, not an atom: it must adopt the letter it
                            # sits over, or KaTeX fails on the next _/^.
                            role = "accent"
                    style = None if ext else _math_font_style(fname)
                    out.append(Box(bb[0], bb[1], bb[2], bb[3], tex, size, role,
                                   style=style))
    if vlines:
        # 14.48 · 짝 이룬 세로 벡터선 → | 구분자 합성 (행렬식 막대).
        try:
            _vl = [v for v in vlines
                   if x0 - 1 <= (v[0] + v[2]) / 2 <= x1 + 1
                   and y0 - 1 <= (v[1] + v[3]) / 2 <= y1 + 1]
            _vl.sort(key=lambda v: (v[0] + v[2]) / 2)
            _paired = set()
            for _i, _a in enumerate(_vl):
                if _i in _paired:
                    continue
                _acx = (_a[0] + _a[2]) / 2
                _ah = _a[3] - _a[1]
                for _j in range(_i + 1, len(_vl)):
                    _b = _vl[_j]
                    _bcx = (_b[0] + _b[2]) / 2
                    _bh = _b[3] - _b[1]
                    if _bcx - _acx > 520.0:
                        break
                    if max(_ah, _bh) > 1.35 * min(_ah, _bh):
                        continue
                    if (min(_a[3], _b[3]) - max(_a[1], _b[1])
                            < 0.65 * min(_ah, _bh)):
                        continue
                    if not any(_acx < (bb.x0 + bb.x1) / 2 < _bcx
                               and max(_a[1], _b[1]) - 2
                               <= (bb.y0 + bb.y1) / 2
                               <= min(_a[3], _b[3]) + 2
                               for bb in out if bb.role != "vbar"):
                        continue           # 사이에 글자 없이 — 빈 칸 쌍이다
                    _paired.add(_i)
                    _paired.add(_j)
                    break
            if _paired:
                _sz = _median([b.size for b in out] or [10.0])
                for _i in sorted(_paired):
                    _v = _vl[_i]
                    _vcx = (_v[0] + _v[2]) / 2
                    _vcy = (_v[1] + _v[3]) / 2
                    if any(b.role == "vbar"
                           and abs((b.x0 + b.x1) / 2 - _vcx) <= 1.5
                           and b.y0 - 2 <= _vcy <= b.y1 + 2 for b in out):
                        continue           # 글리프 막대가 이미 있다
                    out.append(Box(_v[0], _v[1], _v[2], _v[3],
                                   "|", _sz, "vbar"))
        except Exception:
            pass
    # 14.48 · 벡터 sqrt 몸통 합성 (글리프 없는 루트: p21/p29/p37).
    # 윗변 규칙선은 page_rules 가 이미 냈다 — 여기서 몸통 상자를 얹으면
    # 기존 근호 조립(짝짓기+내용 선택)이 그대로 돈다. 윗변 아래에 글자가
    # 없으면 장식이므로 합성하지 않는다. 페이지당 한 번만 계산한다.
    try:
        _vs = gtables.get("_vsqrt", None)
        if _vs is None:
            _vs = _vector_sqrts(page)
            try:
                gtables["_vsqrt"] = _vs
            except Exception:
                pass
        if _vs:
            _sz2 = _median([b.size for b in out] or [10.0])
            for (_bx0, _by0, _bx1, _by1, _rx0, _ry, _rx1) in _vs:
                _ccx = (_bx0 + _bx1) / 2.0
                _ccy = (_by0 + _by1) / 2.0
                if not (x0 - 1 <= _ccx <= x1 + 1
                        and y0 - 1 <= _ccy <= y1 + 1):
                    continue
                _inside = [b for b in out
                           if b.x0 >= _rx0 - 2.5 and b.x1 <= _rx1 + 2.5
                           and abs(b.cy - _ry) <= 14.0]
                if not _inside:
                    continue
                if any(b.role == "radical"
                       and abs((b.x0 + b.x1) / 2 - _ccx) <= 2.0
                       and abs((b.y0 + b.y1) / 2 - _ccy) <= 3.0
                       for b in out):
                    continue
                # 몸통 크기는 피제곱수 크기를 따른다. 영역 중앙값(괄호·부호의
                # 9pt)을 쓰면 대분수 탈출(_mixed)의 분수 기준 크기(_fm)가
                # 부풀어 격자가 통째로 버려졌다(p22 (c)).
                _bsz = _median([b.size for b in _inside
                                if not b.atomic] or [_sz2])
                out.append(Box(_bx0, _by0, _bx1, _by1,
                               r"\sqrt", _bsz, "radical"))
    except Exception:
        pass
    out.sort(key=lambda b: (b.x0, b.y0))
    out = _merge_negation_slash(out)
    out = _merge_vbars(out)
    out = _merge_stacked_delims(out)
    out = _assemble_pua_pieces(out)
    out = _attach_accents(out)
    return out


def _attach_accents(boxes):
    r"""Give every accent glyph the base letter it is drawn over.

    TeX draws ``\hat v`` as two glyphs: the letter, and a circumflex positioned
    above it.  Extraction returns them as independent characters, so the naive
    reading order produced ``v \hat _{i}`` — ``\hat`` then swallowed the
    subscript brace and KaTeX rejected the whole formula ("Expected group
    after '_'"), which is why entire equations came out broken.

    The base is chosen by geometry: the nearest non-accent glyph whose
    horizontal centre sits under the accent and whose top is below it.  An
    accent with no plausible base is dropped rather than left dangling.
    """
    try:
        accents = [b for b in boxes if b.role == "accent"]
        if not accents:
            return boxes
        rest = [b for b in boxes if b.role != "accent"]
        for acc in accents:
            acx = (acc.x0 + acc.x1) / 2.0
            width = max(1.0, acc.x1 - acc.x0)
            best, best_key = None, None
            for b in rest:
                if b.role in ("open", "close", "op", "vbar", "radical") or b.atomic:
                    continue
                if not (b.tex or "").strip():
                    continue
                # The base sits below the accent and overlaps it horizontally.
                if b.y0 < acc.y0 - 0.5:
                    continue
                bcx = (b.x0 + b.x1) / 2.0
                if not (b.x0 - width * 0.8 <= acx <= b.x1 + width * 0.8):
                    continue
                dy = b.y0 - acc.y1
                if dy > max(2.5, acc.size * 0.55):
                    continue
                key = (abs(bcx - acx), max(0.0, dy))
                if best is None or key < best_key:
                    best, best_key = b, key
            if best is None:
                continue        # no base → drop it, never emit a bare command
            base = (best.tex or "").strip()
            if not base:
                continue
            if best.style:
                base = _style_latex_atom(base, best.style)
                best.style = None
            if len(base) > 1 and not re.fullmatch(r"\\[A-Za-z]+", base):
                base = "{" + base + "}"
            best.tex = acc.tex + "{" + base + "}"
            best.y0 = min(best.y0, acc.y0)
        rest.sort(key=lambda b: (b.x0, b.y0))
        return rest
    except Exception:
        return boxes


def _merge_piece_columns(pieces):
    """Symbol PUA 조각 상자들을 큰 구분자로 합친다. (14.47)

    조각 상자는 tex 에 원본 PUA 문자 한 글자를 들고 있다. 같은 x-기둥에
    잇달아 쌓인 조각들 = 큰 구분자 하나. 2조각 쌓기(위+아래)가 가장 흔하다.
    종류가 섞인 기둥은 깨진 PDF 이므로 버린다. 홀로 남는 조각은 구분자
    (곧은 토막은 세로 막대)로 살린다 — PUA 가 LaTeX 로 새는 것보다 낫다.

    14.48 · 같은 x-기둥에 여러 행렬이 나란히 놓이면(교과서 들여쓰기) 서로
    다른 줄의 괄호가 하나의 기둥으로 합쳐지는 일이 있었다. 줄 사이가
    1pt 로 달라붙으면 간격 검사로는 절대 못 가른다 — 조각 순서로 가른다.
    1단계에서 x-기둥으로 묶고(순서 무관), 2단계에서 y순으로 읽으며
    tp(위)가 오면 새 괄호를 시작하고 bt(아래)가 오면 괄호를 닫는다.
    ex/mid(가운데)는 이어 붙인다. 쪽·종류가 바뀌어도 새 괄호다.
    """
    try:
        dec = []
        for b in pieces:
            t = (b.tex or "")
            if len(t) != 1:
                continue
            v = _symbol_pua_lookup(ord(t))
            if not isinstance(v, tuple):
                continue
            dec.append((b, v))
        if not dec:
            return []
        dec.sort(key=lambda z: (round(z[0].x0, 1), z[0].y0))
        # 1단계: x-기둥으로 묶는다 (대표 x0 기준, 드리프트 없음)
        xgroups = []
        for b, v in dec:
            for g in xgroups:
                if abs(b.x0 - g[0]) <= 2.5:
                    g[1].append((b, v))
                    break
            else:
                xgroups.append([b.x0, [(b, v)]])
        # 2단계: 기둥 안에서 y순으로 괄호를 가른다
        # 기둥: [조각 목록, x0, y0, y1, (쪽, 종류) 또는 None]
        cols = []
        for _, items in xgroups:
            items.sort(key=lambda z: z[0].y0)
            cur = None    # [조각, x0, y0, y1, 종류, 맨아래 조각, 닫힘]
            for b, v in items:
                part = v[3]
                kind = (v[1], v[2]) if v[1] in ("open", "close") else None
                if cur is None:
                    cur = [[(b, v)], b.x0, b.y0, b.y1, kind,
                           part, part == "bt"]
                    continue
                # 14.71 · 조각 bbox 는 명목 크기라 잉크가 이어져도
                # 8pt 가까운 틈이 벌어진다(11926 p12 (A.6) 4행 cases 의
                # mid→ex 사이 7.9pt). 틈이 크다고 기둥을 가르면 중괄호가
                # 둘로 쪼개져 cases 조립이 통째로 무너졌다. tp/bt 순서
                # 규칙이 줄 경계를 가려주므로 틈 허용치를 키워도 안전하다.
                tol = max(6.0, b.h * 0.85)
                gap = b.y0 - cur[3]
                ovl = min(b.y1, cur[3]) - max(b.y0, cur[2])
                dup = (part == cur[5] and ovl > 0.5 * max(b.h, 0.5))
                keep_kind = (kind is None or cur[4] is None
                             or kind == cur[4])
                go_on = ((dup or (cur[5] != "bt" and part != "tp"))
                         and keep_kind and (dup or gap <= tol))
                if go_on:
                    cur[0].append((b, v))
                    cur[1] = min(cur[1], b.x0)
                    cur[2] = min(cur[2], b.y0)
                    cur[3] = max(cur[3], b.y1)
                    if kind is not None:
                        cur[4] = kind
                    if not dup:
                        cur[5] = part
                        cur[6] = (part == "bt")
                else:
                    cols.append(cur[:5])
                    cur = [[(b, v)], b.x0, b.y0, b.y1, kind,
                           part, part == "bt"]
            if cur is not None:
                cols.append(cur[:5])
        out = []
        for c in cols:
            c[0].sort(key=lambda z: z[0].y0)
            ps = [b for b, _ in c[0]]
            x0 = min(b.x0 for b in ps); x1 = max(b.x1 for b in ps)
            y0 = min(b.y0 for b in ps); y1 = max(b.y1 for b in ps)
            sz = max(b.size for b in ps)
            sided = [v for _, v in c[0] if v[1] in ("open", "close")]
            if not sided:
                # 곧은 토막(braceex 등)만 쌓인 기둥 = 키 큰 세로 막대
                out.append(Box(x0, y0, x1, y1, "|", sz, "vbar"))
                continue
            kinds = {(v[1], v[2]) for v in sided}
            if len(kinds) != 1:
                continue
            (side, kind), = kinds
            if len(ps) >= 2:
                out.append(Box(x0, y0, x1, y1, _PIECE_TEX[(side, kind)], sz, side))
            elif c[0][0][1][3] == "ex":
                out.append(Box(x0, y0, x1, y1, "|", sz, "vbar"))
            else:
                out.append(Box(x0, y0, x1, y1, _PIECE_TEX[(side, kind)], sz, side))
        return out
    except Exception:
        return []


# 구 경로(CMEX 등) PUA 표시 — region_boxes 가 조각 Box 의 tex 에 남기는
# 마커 문자(단일 U+E000). 원본 조각 문자(\uf8f1 등)는 버리고 이 마커만
# 싣는다. Symbol 경로는 원본 PUA 문자를 그대로 들고 온다(디코딩용).
# 14.71 · 예전엔 6글자 리터럴 "\ue000" 과 비교해 절대 같아지지 않았다 —
# CMEX 조각이 전부 coded 경로로 흘러 decode 실패로 사라졌다(p12 cases).
_PUA_LEGACY_TEX = "\ue000"


def _assemble_pua_pieces(boxes):
    """세로로 쌓인 큰-괄호 조각(PUA)들을 한 덩어리(기둥)로 조립한다.

    PDF에 따라 큰 괄호 조각이 ToUnicode 없이 읽혀 U+F8F1 같은 PUA 문자로
    나온다. 한 x-기둥에 잇달아 쌓인 조각들 = 큰 괄호 하나. 기둥이 내용의
    왼쪽 끝이면 여는 괄호, 오른쪽 끝이면 닫는 괄호로 쓴다(cases 중괄호 등).

    14.47 · Symbol 글꼴 조각(원본 PUA 문자를 들고 있는 것)은 종류·쪽을
    디코딩해 합친다. 구 경로(CMEX 등, "\\ue000" 표시)는 예전 규칙 그대로 둔다.
    """
    try:
        pieces = [b for b in boxes if b.role == "pua"]
        if not pieces:
            return boxes
        legacy = [b for b in pieces if (b.tex or "") == _PUA_LEGACY_TEX]
        coded = [b for b in pieces if (b.tex or "") != _PUA_LEGACY_TEX]
        keep = [b for b in boxes if b.role != "pua"]
        if coded:
            keep.extend(_merge_piece_columns(coded))
        if len(legacy) >= 2:
            legacy.sort(key=lambda b: (b.x0, b.y0))
            cols = []
            for p in legacy:
                # 14.71 · 세로로 늘어난 cases 중괄호는 mid 아래 조각이
                # 조각 하나 높이의 ~0.8배(≈7.9pt@sz10)만큼 띄어진 채 놓인다.
                # 조각 높이 이내의 틈까지 같은 기둥으로 잇는다.
                gap = max(3.0, 0.85 * p.size)
                for c in cols:
                    cy0 = min(u[1].y0 for u in c)
                    cy1 = max(u[1].y1 for u in c)
                    if (abs(c[0][1].x0 - p.x0) <= 1.5
                            and p.y0 <= cy1 + gap and p.y1 >= cy0 - gap):
                        c.append((p.y0, p))
                        c.sort(key=lambda u: u[0])
                        break
                else:
                    cols.append([(p.y0, p)])
            for c in cols:
                ps = [u[1] for u in c]
                if len(ps) < 3:
                    continue                  # 3조각 미만은 확실한 괄호가 아니다
                span = max(b.y1 for b in ps) - min(b.y0 for b in ps)
                tallest = max(b.y1 - b.y0 for b in ps)
                if span < tallest * 1.7:
                    continue   # 세로로 '쌓인' 모양이 아니다(underbrace 좌우 절반 등)
                x0 = min(b.x0 for b in ps); x1 = max(b.x1 for b in ps)
                y0 = min(b.y0 for b in ps); y1 = max(b.y1 for b in ps)
                lo = min([b.x0 for b in keep] + [x0])
                hi = max([b.x1 for b in keep] + [x1])
                fracL = (x0 - lo) / max(1e-6, hi - lo)
                if fracL >= 0.65:
                    keep.append(Box(x0, y0, x1, y1, r"\}", ps[0].size, "close"))
                else:
                    keep.append(Box(x0, y0, x1, y1, r"\{", ps[0].size, "open"))
        keep.sort(key=lambda b: (b.x0, b.y0))
        return keep
    except Exception:
        return boxes



# 14.70 · CMSY 부정 슬래시(̸ U+0338/U+0337) 박스 → 이웃 관계기호에 합친다.
# 슬래시는 폭 0 짜리 박스로 읽혀 왼쪽 글자의 아래첨자 클러스터에 흡수되어
# 그냥 사라지는 일이 있었다(≠ 가 = 로 굳음). 여기서 미리 관계기호를
# \\neq 계열로 바꿔 두면 _linear 는 평범한 관계기호 하나만 본다.
_NEG_BOX_REL = {
    "=": r"\neq", r"\le": r"\nleq", r"\ge": r"\ngeq",
    r"\in": r"\notin", r"\sim": r"\nsim", r"\approx": r"\napprox",
    r"\equiv": r"\nequiv", r"\subset": r"\nsubset",
    r"\subseteq": r"\nsubseteq", r"\supset": r"\nsupset",
    r"\supseteq": r"\nsupseteq", r"\to": r"\nrightarrow",
    r"\leftarrow": r"\nleftarrow", r"\rightarrow": r"\nrightarrow",
    "<": r"\not<", ">": r"\not>",
}


def _merge_negation_slash(boxes):
    try:
        slashes = [b for b in boxes if (b.tex or "").strip() in ("\u0338", "\u0337")]
        if not slashes:
            return boxes
        keep = [b for b in boxes if (b.tex or "").strip() not in ("\u0338", "\u0337")]
        for s in slashes:
            best, best_d = None, None
            for b in keep:
                t = (b.tex or "").strip()
                if t not in _NEG_BOX_REL:
                    continue
                if min(b.y1, s.y1) - max(b.y0, s.y0) < 0.4 * min(b.h, s.h):
                    continue     # 다른 줄의 관계기호다
                d = min(abs(s.x0 - b.x1), abs(b.x0 - s.x1),
                        abs((s.x0 + s.x1) / 2 - (b.x0 + b.x1) / 2))
                if d <= 4.5 and (best_d is None or d < best_d):
                    best, best_d = b, d
            if best is not None:
                best.tex = _NEG_BOX_REL[(best.tex or "").strip()]
        return keep
    except Exception:
        return boxes

def _merge_vbars(boxes):
    """세로 막대(대입 기호)는 조각을 여러 개 쌓아 그린다 → 하나로 합친다."""
    bars = [b for b in boxes if b.role == "vbar"]
    rest = [b for b in boxes if b.role != "vbar"]
    used, merged = set(), []
    for i, b in enumerate(bars):
        if i in used:
            continue
        y0, y1 = b.y0, b.y1
        for j in range(i + 1, len(bars)):
            if j in used:
                continue
            c = bars[j]
            if abs(c.x0 - b.x0) <= 1.2 and c.y0 <= y1 + 2.0 and c.y1 >= y0 - 2.0:
                y0 = min(y0, c.y0); y1 = max(y1, c.y1)
                used.add(j)
        merged.append(Box(b.x0, y0, b.x1, y1, b.tex, b.size, "vbar"))
    out = rest + merged
    out.sort(key=lambda b: (b.x0, b.y0))
    return out


def _merge_stacked_delims(boxes):
    """14.3 · 세로로 쌓인 큰 괄호({ } ( ))를 하나로 합친다.

    cases 중괄호는 위·아래 조각 두 개로 조판되는 일이 많다. 합치지 않으면
    \\left\\{ \\right. 가 두 번 나오고, 그 안의 분수가 한 덩어리로 뭉개진다.

    14.48 · 같은 x의 다른 줄 괄호까지 합쳐지지 않게 양쪽 범위를 본다
    (_merge_piece_columns 와 같은 추락 방지 — 정렬이 뒤집히면 위 조각이
    아래 기둥에 흡수돼 수백 pt짜리 가짜 구분자가 됐다).
    """
    kinds = ("open", "close")
    special = [b for b in boxes if b.role in kinds]
    rest = [b for b in boxes if b.role not in kinds]
    if len(special) < 2:
        return boxes
    used, merged = set(), []
    special.sort(key=lambda b: (round(b.x0, 1), b.y0))
    for i, b in enumerate(special):
        if i in used:
            continue
        y0, y1 = b.y0, b.y1
        x0, x1 = b.x0, b.x1
        for j in range(i + 1, len(special)):
            if j in used:
                continue
            c = special[j]
            if c.role != b.role or (c.tex or "") != (b.tex or ""):
                continue
            if abs(c.x0 - x0) <= 2.8 and c.y0 <= y1 + 6.0 and c.y1 >= y0 - 6.0:
                y0 = min(y0, c.y0); y1 = max(y1, c.y1)
                x0 = min(x0, c.x0); x1 = max(x1, c.x1)
                used.add(j)
        merged.append(Box(x0, y0, x1, y1, b.tex, b.size, b.role))
    out = rest + merged
    out.sort(key=lambda b: (b.x0, b.y0))
    return out


def _cases_rows(boxes):
    """cases 오른쪽 글자를 조건식(k>0 등) 앵커 기준으로 줄 가른다."""
    if not boxes:
        return []
    rel = [b for b in boxes if (b.tex or "") in (
        ">", "<", "=", r"\ge", r"\le", r"\neq", r"\ne", r"\gt", r"\lt")]
    if len(rel) >= 2:
        rel = sorted(rel, key=lambda b: b.cy)
        # 너무 가까운 관계기호는 같은 줄
        hh = _median([b.h for b in boxes if b.role is None] or [10.0]) or 10.0
        anchors = [rel[0].cy]
        for b in rel[1:]:
            if abs(b.cy - anchors[-1]) > hh * 0.7:
                anchors.append(b.cy)
        if len(anchors) >= 2:
            rows = [[] for _ in anchors]
            for b in boxes:
                k = min(range(len(anchors)), key=lambda j: abs(b.cy - anchors[j]))
                rows[k].append(b)
            return [r for r in rows if r]
    real = [b for b in boxes if not b.atomic]
    if not real:
        return [boxes]
    hh = _median([b.h for b in real if b.role is None] or [10.0]) or 10.0
    items = sorted(real, key=lambda b: b.y1)
    groups = [[items[0]]]
    for b in items[1:]:
        prev = groups[-1]
        cy = _median([z.y1 for z in prev])
        if abs(b.y1 - cy) > hh * 0.72:
            groups.append([b])
        else:
            prev.append(b)
    rows = []
    for g in groups:
        ids = {id(z) for z in g}
        extra = [b for b in boxes if id(b) not in ids and any(
            abs(b.cy - z.cy) < hh * 0.6 for z in g)]
        rows.append(g + extra)
    return [r for r in rows if r]


def _try_cases(boxes, rules, depth):
    r"""큰 왼쪽 중괄호 + 여러 줄 → \begin{cases} … \end{cases}."""
    try:
        opens = [b for b in boxes if b.role == "open" and (
            (b.tex or "").endswith("{") or (b.tex or "") in ("{", r"\{"))]
        if not opens:
            return None
        body_h = _median([b.h for b in boxes if b.role is None and not b.atomic] or [10.0]) or 10.0
        tall = [b for b in opens if b.h >= max(22.0, body_h * 2.15)]
        if not tall:
            # 14.70 · CMEX 큰 중괄호의 bbox는 '명목 1em'(≈10pt)로만 보고된다.
            # 실제 잉크는 두 줄 cases 를 덮는 29pt 라서, 높이 검사만 믿으면
            # cases 가 아예 조립되지 않고 두 줄이 x순서로 뒤섞였다
            # (\mathcal{A}\mathcal{A}^{+}_{+}ker… 의 원인).
            # 오른쪽 내용이 (a) 22pt 이상로 퍼져 있고 (b) 서로 다른 줄에
            # 관계기호가 2개 이상이면(= 진짜 cases 조건식 모양) 큰 괄호로 본다.
            # 분수 한 줄(\{\frac{a}{b}\})은 관계기호가 없어 걸러진다.
            for b in opens:
                right = [z for z in boxes if id(z) != id(b)
                         and z.x0 >= b.x1 - 2.5]
                if len(right) < 3:
                    continue
                span = max(z.y1 for z in right) - min(z.y0 for z in right)
                rels = [z for z in right if (z.tex or "").strip() in (
                    ">", "<", "=", r"\ge", r"\le", r"\neq", r"\ne", r"\gt",
                    r"\lt", r"\in")]
                if (span >= max(22.0, body_h * 2.15) and span >= b.h * 1.6
                        and len(rels) >= 2):
                    tall.append(b)
        if not tall:
            return None
        brace = min(tall, key=lambda b: (b.x0, -b.h))
        # 14.48 · 닫는 짝이 있으면 cases 가 아니라 중괄호 묶음이다.
        # T₂{T₁[x;y]}=(T₂T₁)[x;y] 처럼 한 줄 식을 {...} 로 묶으면
        # 여는 쪽만 보고 cases 로 둔갑해 [x;y] 행렬이 갈려 버렸다.
        # 진짜 cases 에는 닫는 중괄호가 없다.
        for m in boxes:
            if id(m) == id(brace):
                continue
            if m.role != "close" or (m.tex or "") not in ("}", r"\}"):
                continue
            if m.x0 < brace.x1:
                continue
            if max(brace.h, m.h) > 1.35 * min(brace.h, m.h):
                continue
            if min(brace.y1, m.y1) - max(brace.y0, m.y0) < 0.6 * brace.h:
                continue
            return None
        prefix = [b for b in boxes if id(b) != id(brace) and b.x1 <= brace.x0 + 1.2]
        right = [b for b in boxes if id(b) != id(brace) and b.x0 >= brace.x1 - 2.5]
        if len(right) < 3:
            return None
        right.sort(key=lambda b: b.x0)
        # 14.71 · cases 뒤의 끝 구두점(,\ ;)은 수학축(중괄호 세로 중심)
        # 줄에 놓인다. 짝수행 cases 에서는 어느 행에도 온전히 걸치지 않는데,
        # 그대로 두면 행 나누기가 이웃 행 끝에 붙여 (x=0\wedge y>0), 처럼
        # 원본에 없는 위치의 콤마를 만든다(11926 p12 (A.6)). 축에 있고 모든
        # 행과 60% 미만으로만 겹치며 가장 오른쪽인 구두점은 식 전체의 끝
        # 구두점이므로 \end{cases} 뒤로 뺀다.
        axis = (brace.y0 + brace.y1) / 2.0
        bands = []
        for row in _cases_rows(right):
            ys = [z for z in row
                  if (z.tex or "").strip() not in (",", ";", ".")]
            if ys:
                bands.append((min(z.y0 for z in ys), max(z.y1 for z in ys)))
        tail_punct = []
        if bands:
            for b in right:
                if (b.tex or "").strip() not in (",", ";", "."):
                    continue
                if abs(b.cy - axis) > 3.5:
                    continue
                if any(min(b.y1, y1) - max(b.y0, y0) >= 0.6 * max(b.h, 1e-6)
                       for (y0, y1) in bands):
                    continue
                others_x1 = max((z.x1 for z in right if z is not b),
                                default=0.0)
                if b.x0 < others_x1 - 2.0:
                    continue
                tail_punct.append(b)
        if tail_punct:
            drop = {id(b) for b in tail_punct}
            right = [b for b in right if id(b) not in drop]
        cut = None
        for i in range(len(right) - 1):
            gap = right[i + 1].x0 - right[i].x1
            if gap >= 18.0:
                left_n = i + 1
                body_part = right[:left_n]
                if len(_cases_rows(body_part)) >= 2:
                    # 14.70 · 진짜 suffix(", (i \neq j)" 따위)는 세로로 한 줄을
                    # 이룬다. 두 cases 줄이 x 순서로 섞여 '값|조건' 경계에서 18pt
                    # 벌어져 보이는 것은 suffix 가 아니므로 잘라선 안 된다.
                    if len(_cases_rows(right[left_n:])) >= 2:
                        continue
                    cut = left_n
                    break
        suffix = []
        if cut is not None:
            suffix = right[cut:]
            right = right[:cut]
        if tail_punct:
            suffix = sorted(tail_punct + suffix, key=lambda b: b.x0)
        rows = _cases_rows(right)
        if len(rows) < 2:
            return None
        parts = []
        # 14.70 · cases 의 각 행에도 그 행 y-범위의 규칙선만.
        def _row_rules(row):
            _y0 = min(z.y0 for z in row) - 3.0
            _y1 = max(z.y1 for z in row) + 3.0
            return [rl for rl in rules
                    if _y0 <= (rl[1] + rl[3]) / 2.0 <= _y1]
        for row in rows:
            row = sorted(row, key=lambda b: b.x0)
            rrules = _row_rules(row)
            piece = None
            if len(row) >= 3:
                gaps = [(row[i + 1].x0 - row[i].x1, i) for i in range(len(row) - 1)]
                gap, gi = max(gaps)
                med = _median([b.w for b in row]) or 8.0
                if gap > max(8.0, med * 1.4):
                    expr = assemble(row[:gi + 1], rrules, depth + 1)
                    cond = assemble(row[gi + 1:], rrules, depth + 1)
                    piece = (expr or "") + " & " + (cond or "")
            if piece is None:
                piece = assemble(row, rrules, depth + 1)
            if (piece or "").strip():
                parts.append(piece.strip())
        if len(parts) < 2:
            return None
        body = r"\begin{cases} " + r" \\ ".join(parts) + r" \end{cases}"
        out = []
        if prefix:
            px = assemble(prefix, rules, depth + 1)
            if px:
                out.append(px)
        out.append(body)
        if suffix:
            sx = assemble(suffix, rules, depth + 1)
            if sx:
                out.append(sx)
        return " ".join(out).strip()
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════
#  14.46 · 행렬 복원기 (matrix reconstruction)
# ═══════════════════════════════════════════════════════════
#  물리(파울리 행렬·회전 행렬·해밀토니안)와 컴퓨터 구조(의존 행렬·상태
#  전이 행렬·블록 행렬) 논문의 행렬은 '큰 구분자 두 개 + 그 사이 격자' 다.
#
#  그런데 이 구조를 그동안 전혀 살리지 못했다.
#
#   ① 조립: 큰 괄호를 찾아도 안쪽을 x 순서로만 읽었다. 2×2 행렬이
#      \\left[ a_{11} a_{12} a_{21} a_{22} \\right] 처럼 한 줄로 뭉개져
#      행·열이 사라졌다. 칸이 여섯 개를 넘으면 \begin{aligned} 로 찢겨
#      열 구분(&)조차 없이 세로로만 늘어놓았다.
#   ② 인식: 확장 글꼴(CMEX/txex) 괄호가 아니면 '큰 수식' 씨앗이 되지
#      못했다. unicode-math·Word 처럼 일반 글리프를 세로로 늘려 큰 괄호를
#      그리는 PDF에서는 행렬이 수식으로 아예 잡히지 않아, 칸 숫자가
#      본문 글자로 흩어지고 닫는 괄호는 마지막 줄에 '1 0[ ]' 처럼 덧붙었다.
#
#  이 복원기는 ① 글자 격자(행·열)를 기하로 복원해 KaTeX 행렬 환경으로
#  조립하고, ② 조립까지 되는 후보만 '큰 수식 밴드' 씨앗으로 올린다.
#  격자로 확정되지 않으면 예전 경로(큰 괄호/aligned/분수)를 그대로 쓴다.

# 구분자: 열림 → 닫힘.  | 와 \| 는 양쪽 모두(행렬식·노름).
_MAT_PAIR = {"(": ")", "[": "]", r"\{": r"\}", "|": "|", r"\|": r"\|",
             r"\langle": r"\rangle", r"\lfloor": r"\rfloor", r"\lceil": r"\rceil"}
_MAT_CLOSE_OK = set(_MAT_PAIR.values())
_MAT_DELIM_TEX = set(_MAT_PAIR) | _MAT_CLOSE_OK
# KaTeX 행렬 환경이 있는 구분자. 나머지(⟨ ⌊ ⌈) 는 \left…\begin{matrix} 로 감싼다.
_MAT_ENV = {"(": "pmatrix", "[": "bmatrix", r"\{": "Bmatrix",
            "|": "vmatrix", r"\|": "Vmatrix"}
_MAT_ENV_RE = re.compile(r"\\begin\{(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|array)\}")
# TeX 은 \cdots \vdots \ddots 를 '마침표 세 개'로 조판한다 → 한 칸으로 모은다.
_MAT_DOTS = {".", "·", "⋅", "⋯", "⋮", "⋱", "…", "•"}

# 칸 안 미세 병합에서 부호로 인정하는 글자 (_tok_tex 적용 뒤 모양)
_MICRO_SIGNS = {"-", "+"}
# 칸 안 미세 병합에서 프라임으로 인정하는 글자 (x' → 한 칸)
_MICRO_PRIMES = {"'", "′", "’", "″"}


def _micro_merge_signed_sqrt(rr, i, cur, rules):
    """[부호, 근호몸통, 피제곱수…] → 원자 '- \\sqrt{…}' 상자. (14.48)

    '−√3' 의 부호·몸통·피제곱수를 미리 조립해 한 상자로 합친다. 합치지
    않으면 부호가 별도 열로 갈라져 2열 행렬이 4열이 됐다(p29 B/C/T).
    피제곱수에 구분자·중괄호·근호가 또 있으면(중첩) 손대지 않는다 —
    미리 조립하면 바깥 재귀와 어긋난다. 근호 막대는 rules 에 남는다
    (피제곱수 조립에서만 제외) — _classify_rules 의 고아 막대 방벽이
    분수선 둔갑을 막는다.
    """
    try:
        n = len(rr)
        if i >= n:
            return None
        body = rr[i]
        if body.atomic or body.role != "radical":
            return None
        # 14.48 · 부호는 크기 관대(50%): '−√3/2' 의 부호(10.5pt 본문
        # 크기)가 피제곱수(7pt)보다 크다. 빡빡하면(12%) 병합이 안 돼
        # 부호가 별도 열로 갈라지고 열 점프가 무너져 격자 자체가
        # 실패했다(p21 인라인 행렬 통째 누락). 위/아래첨자 오합병은
        # 아래 세로겹침(vov)이 막는다 — 첨자는 본줄과 겹치지 않는다.
        if abs(body.size - cur.size) > 0.5 * max(cur.size, body.size):
            return None
        gap = body.x0 - cur.x1
        if gap > 5.0 or gap < -0.5:
            return None
        if (min(cur.y1, body.y1) - max(cur.y0, body.y0)
                <= 0.35 * min(max(cur.h, 0.5), max(body.h, 0.5))):
            return None
        bar = None
        for r in rules or []:
            rcy = (r[1] + r[3]) / 2.0
            if (abs(r[0] - body.x1) <= 4.5
                    and body.y0 - 4.5 <= rcy <= body.y1 + 4.5):
                bar = r
                break
        if bar is None:
            return None
        bcy = (bar[1] + bar[3]) / 2.0
        # 14.48 · 윗변 '위'에 글자가 있으면 부호의 근호가 아니다.
        # '−1/√5' 에서 분자 '1'이 창 안에 들어와 √(1/5) 로 둔갑했다
        # (p22) — 윗변은 근호 맨 위이므로 진짜 피제곱수는 아래에만 있다.
        for k in range(i + 1, n):
            c = rr[k]
            if c.atomic or c.role is not None:
                break
            if c.x0 > bar[2] + 2.5:
                break
            if not (c.x0 >= bar[0] - 2.5 and c.x1 <= bar[2] + 2.5):
                continue
            if c.cy < bcy - 2.5:
                return None
        # 14.48 · 바깥 분수선 아래는 피제곱수가 아니다. '−√3/2' 에서
        # 분모 '2'는 근호 윗변 아래·분수선 아래에 있어 창(±14pt)엔
        # 들어오지만 분모지 피제곱수가 아니다 — 그냥 두면 √(3/2) 로
        # 둔갑했다(p21). 근호 안에 통째로 든 규칙선(√(1/2) 꼴)은
        # 바깥선이 아니므로 제외하지 않는다.
        outer_rcy = None
        for r in rules or []:
            if r is bar:
                continue
            rcy = (r[1] + r[3]) / 2.0
            if rcy <= bcy:
                continue
            if r[0] >= bar[2] + 2.5 or r[2] <= body.x0 - 2.5:
                continue
            if r[0] >= body.x1 - 1.0 and r[2] <= bar[2] + 2.5:
                continue          # 근호 안 규칙선(√(1/2)의 분수선)
            paired = False
            for m in rr:
                if m.role != "radical":
                    continue
                if (abs(r[0] - m.x1) <= 4.5
                        and m.y0 - 4.5 <= rcy <= m.y1 + 4.5):
                    paired = True
                    break
            if paired:
                continue          # 이웃 근호의 윗변
            if outer_rcy is None or rcy < outer_rcy:
                outer_rcy = rcy
        rad = []
        skipped = []
        j = i + 1
        while j < n:
            c = rr[j]
            if c.atomic or c.role is not None:
                break
            if outer_rcy is not None and c.cy >= outer_rcy:
                skipped.append(c)
                j += 1
                continue          # 바깥 분수선 아래(분모)는 피제곱수에서
                                  # 빼지만 행에는 남긴다(아래서 반환)
            if not (c.x0 >= bar[0] - 2.5 and c.x1 <= bar[2] + 2.5
                    and abs(c.cy - bcy) <= 14.0):
                break
            if c.x0 - (rad[-1].x1 if rad else body.x1) > 5.0:
                break
            rad.append(c)
            j += 1
        if not rad:
            return None
        if any((c.tex or "").strip() in _MAT_DELIM_TEX for c in rad):
            return None
        try:
            sub = [r for r in rules if r is not bar]
            rtex = _tidy_latex(assemble(rad, sub, 2))
        except Exception:
            return None
        if not rtex:
            return None
        tex = (cur.tex or "") + r" \sqrt{" + rtex + "}"
        # 14.48 · 상자 범위는 몸통+피제곱수(분수 부분)까지만 — 부호는
        # 앞에 삐죽 나온 접두어다. 부호까지 품으면 '−√3/2' 의 분수선이
        # 여유(slack) 검사에 걸려 분수가 안 됐다(p21 /2 증발).
        return (Box(body.x0, min(body.y0, min(b.y0 for b in rad)),
                    max(b.x1 for b in rad),
                    max(body.y1, max(b.y1 for b in rad)),
                    tex, max(cur.size, body.size), None, True), j, skipped)
    except Exception:
        return None


def _micro_merge_row(row, rules=None):
    """한 줄 안에서 숫자 조각(부호·자릿수·소수점)을 한 상자로 합친다. (14.47)

    '−1' 의 부호는 왼쪽으로 삐죽 나와 앞 칸과의 간격을 갉아먹는다. 합치지
    않으면 열 경계 점프가 안 잡혀 멀쩡한 행렬을 놓친다. 구분자·첨자·점열은
    건드리지 않는다 — 괄호 짝·중괄호·줄임표 판정이 그대로 돌게.
    크기가 12% 넘게 다르면(위/아래 첨자) 합치지 않는다. 자릿수 임계값은
    빡빡하게(1.0pt) 둔다 — 열 간격이 좁은 행렬에서 진짜 열 경계를
    삼켜 버리면 칸이 뭉개지기 때문이다. 부호는 자폭을 품어 2.5pt 로 둔다.

    14.48 · 부호+글자 병합은 '−1'(부호+숫자)과 '−x'(부호+한 글자)까지만이다.
    '−sinθ' 의 '−s' 를 합쳐 버리면 sin 이 낱말로 묶이지 않아 칸이
    '-s in \\theta' 로 깨졌다 → 뒤에 글자가 또 오면(연산자 이름) 합치지
    않는다. 'x'' 의 프라임도 앞 글자와 합친다 — 합치지 않으면 프라임이
    별도 열로 갈라져 [x';y'] 가 2열 행렬이 됐다.
    14.48 · 분수선은 병합 금지선이다. 분자·분모가 한 줄(row)에 들어와도
    (분수 다리) 서로 합치면 안 되고, 부호가 분자를 뺏어서도 안 된다
    (−3/5 → '−3'+5). 막대가 두 상자 사이에 있거나 다음 상자가
    분자(바로 아래 막대)면 합치지 않는다. 세로로 안 겹치는 이웃도
    같은 줄 글자가 아니므로 합치지 않는다.
    """
    try:
        rr = sorted(row, key=lambda b: b.x0)
        out = []
        i, n = 0, len(rr)
        while i < n:
            cur = rr[i]
            i += 1
            if cur.atomic or cur.role is not None:
                out.append(cur)
                continue
            # 14.48 · 부호+근호 병합: '−√3' 을 한 상자로 합친다(위 함수).
            if not cur.atomic and (cur.tex or "") in _MICRO_SIGNS and rules:
                _mg = _micro_merge_signed_sqrt(rr, i, cur, rules)
                if _mg is not None:
                    out.append(_mg[0])
                    out.extend(_mg[2])
                    i = _mg[1]
                    continue
            while i < n:
                nxt = rr[i]
                if (nxt.atomic or nxt.role is not None
                        or abs(nxt.size - cur.size)
                        > 0.12 * max(cur.size, nxt.size)):
                    break
                if len((nxt.tex or "").strip()) != 1:
                    break            # 명령(\alpha 등)은 합치지 않는다
                gap = nxt.x0 - cur.x1
                la = (cur.tex or "")[-1:]
                rb = (nxt.tex or "")[:1]
                # 같은 시각 줄(세로로 겹침)이 아니면 이웃이 아니다
                if (min(cur.y1, nxt.y1) - max(cur.y0, nxt.y0)
                        <= 0.35 * min(max(cur.h, 0.5), max(nxt.h, 0.5))):
                    break
                if rules:
                    ccx = (cur.x0 + cur.x1) / 2.0
                    ncx = (nxt.x0 + nxt.x1) / 2.0
                    ccy = (cur.y0 + cur.y1) / 2.0
                    ncy = (nxt.y0 + nxt.y1) / 2.0
                    fenced = False
                    num_next = False
                    for r in rules:
                        rcy = (r[1] + r[3]) / 2.0
                        cok = r[0] - 1.0 <= ccx <= r[2] + 1.0
                        nok = r[0] - 1.0 <= ncx <= r[2] + 1.0
                        if cok and nok and (ccy - rcy) * (ncy - rcy) < 0:
                            fenced = True      # 막대 사이에 낀 분자·분모
                            break
                        if nok and (nxt.y0 <= rcy <= nxt.y1
                                    or 0 < rcy - nxt.y1 <= 4.0):
                            num_next = True    # 다음 상자가 분자다
                    if fenced:
                        break
                    if num_next and rb not in _MICRO_PRIMES:
                        break                  # 부호·자릿수가 분자를 뺏지 못한다
                join = False
                if la in _MICRO_SIGNS and rb.isalnum() and gap <= 2.5:
                    if rb.isalpha():
                        # −sin · −cos: 연산자 이름의 첫 글자를 삼키면 안 된다.
                        # 뒤에 같은 크기 글자가 바로 오면 낱말이므로 둔다.
                        fol = rr[i + 1] if i + 1 < n else None
                        wordy = (fol is not None and not fol.atomic
                                 and fol.role is None
                                 and len((fol.tex or "").strip()) == 1
                                 and (fol.tex or "").strip().isalnum()
                                 and abs(fol.size - cur.size)
                                 <= 0.12 * max(cur.size, fol.size)
                                 and fol.x0 - nxt.x1 <= 2.5)
                        if not wordy:
                            join = True      # −x (한 글자 기호)
                    else:
                        join = True          # −1
                elif la.isdigit() and rb.isdigit() and gap <= 1.0:
                    join = True      # 12
                elif gap <= 1.0 and ((la.isdigit() and rb in ".,")
                                     or (la in ".," and rb.isdigit())):
                    join = True      # 3.5 · 1,000
                elif (rb in _MICRO_PRIMES and gap <= 2.5
                        and (la.isalnum() or la in (")", "]", "'", "′"))):
                    join = True      # x' · y'' (프라임은 앞 글자에 붙는다)
                if not join or gap < -0.5:
                    break
                cur = Box(cur.x0, min(cur.y0, nxt.y0), nxt.x1,
                          max(cur.y1, nxt.y1),
                          (cur.tex or "") + (nxt.tex or ""),
                          max(cur.size, nxt.size))
                i += 1
            out.append(cur)
        return out
    except Exception:
        return row


def _is_matrix_delim(b):
    """이 상자가 행렬을 감쌀 수 있는 큰 구분자인가.

    확장 글꼴 글리프(role open/close/vbar)와, 일반 글꼴을 세로로 늘려 그린
    괄호(unicode-math·Word 계열 PDF)를 모두 인정한다.
    """
    if b is None or b.atomic:
        return False
    if b.role is not None and b.role not in ("open", "close", "vbar"):
        return False
    return (b.tex or "").strip() in _MAT_DELIM_TEX


def _matrix_delim_pair(bs, i):
    """bs[i] 의 구분자와 짝이 맞는 닫는 구분자의 위치 (없으면 -1).

    안쪽의 같은 종류 괄호는 깊이로 센다 — (a + (b)) 의 짝은 마지막 ) 다.
    | 처럼 열고 닫는 모양이 같은 구분자는 '깊이가 1일 때 같은 글자'를 짝으로 본다.
    """
    n = len(bs)
    if i < 0 or i >= n or not _is_matrix_delim(bs[i]):
        return -1
    ot = (bs[i].tex or "").strip()
    if ot not in _MAT_PAIR:          # 닫는 구분자로는 행렬을 열 수 없다
        return -1
    want = _MAT_PAIR[ot]
    depth = 1
    sym = []          # 안에서 열린 '양쪽 다 되는' 구분자(| \|)의 종류
    for k in range(i + 1, n):
        c = bs[k]
        if not _is_matrix_delim(c):
            continue
        ct = (c.tex or "").strip()
        opens, closes = ct in _MAT_PAIR, ct in _MAT_CLOSE_OK
        if opens and closes:
            # | · \| : 짝이 맞는 것이 먼저 열려 있으면 닫고, 아니면 연다.
            # (첨가 행렬 [A | b] 의 가운데 막대가 바깥 괄호의 짝을 뺏지 않게)
            if sym and sym[-1] == ct:
                sym.pop()
            elif not sym and ct == ot and ct == want:
                return k
            else:
                sym.append(ct)
            continue
        if opens:
            depth += 1
            continue
        depth -= 1
        if depth <= 0:
            return k if ct == want else -1
    return -1


def _delims_wrap(o, c, content):
    """두 구분자가 내용을 좌우·세로로 품고, 내용 글자보다 훨씬 큰가."""
    if not content or (c.x0 + c.x1) <= (o.x0 + o.x1):
        return False
    # 큰 괄호 글리프의 bbox 는 좌우 여백까지 품어 폭이 20pt 를 넘는다(60pt '(').
    # x1 으로 비교하면 열 벡터의 ')' 가 '(' 안에 들어와 짝을 잃는다 → 중심으로 본다.
    if min(b.x0 for b in content) < o.x0 - 0.6 or max(b.x1 for b in content) > c.x1 + 0.6:
        return False
    hs = [b.h for b in content if not b.atomic] or [b.h for b in content]
    hb = _median(hs) or 10.0
    y0 = min(b.y0 for b in content)
    y1 = max(b.y1 for b in content)
    span = max(1e-6, y1 - y0)
    for d in (o, c):
        if d.h < hb * 1.45:                      # 본문 글자보다 키가 커야 큰 괄호다
            return False
        if d.y0 > y0 + span * 0.20 or d.y1 < y1 - span * 0.20:
            return False                          # 내용을 위아래로 품지 못했다
    return True


def _matrix_grid(boxes, rules=None, braces=False):
    """구분자 안쪽 상자들이 (행 × 열) 격자인가.

    되면 {rows, grid, ncol, hb} 를, 아니면 None 을 돌려준다.
    분수(\\frac) 처럼 '가로 규칙선이 두 줄 사이를 지나는' 배치는 행렬이
    아니다 — 이 판정이 없으면 (a+b)/(c+d) 가 3열 행렬로 둔갑한다.
    """
    try:
        bs = [b for b in boxes if (b.tex or "").strip() or b.atomic]
        if len(bs) < 2:
            return None
        plain = [b for b in bs if not b.atomic and b.role is None]
        hb = _median([b.h for b in plain] or [b.h for b in bs]) or 10.0
        if hb <= 0.5:
            return None

        # ── 첨가 행렬의 세로 막대([A | b])는 '칸'이 아니라 열 구분선이다 ──
        #   키가 크면 칸 위아래를 모두 걸쳐서 줄 가르기를 망친다(한 줄로 뭉개짐).
        #   따로 빼 두고 나중에 열 하나로 되돌린다.
        sep = [b for b in bs if (b.role == "vbar" or (b.tex or "").strip() in ("|", r"\|"))
               and b.h >= hb * 1.4]
        if sep:
            keep = {id(b) for b in sep}
            inner = [b for b in bs if id(b) not in keep]
        else:
            inner = bs

        # ── 행: 세로로 실제로 겹치는 글자들이 같은 줄 ──
        order = sorted(inner, key=lambda b: (b.cy, b.x0))
        rows = [[order[0]]]
        ry0, ry1 = order[0].y0, order[0].y1
        for b in order[1:]:
            ov = min(ry1, b.y1) - max(ry0, b.y0)
            joined = ov > 0.35 * min(max(ry1 - ry0, 0.5), max(b.h, 0.5))
            if not joined:
                # 칸이 높이만 다르고 중심이 같으면 같은 줄(예: 'a' 와 '∫')
                if abs(b.cy - (ry0 + ry1) / 2.0) <= max(1.6, hb * 0.34):
                    joined = True
            if not joined and rules:
                # 14.48 · 분수 다리: 분수선 위·아래에 맞닿은 분자·분모는
                # 같은 줄이다. 순수 분수 칸(3/5)은 분자·분모가 세로로
                # 겹치지 않아 줄이 갈라져 행렬 행 수가 뻥튀기됐다.
                # (다리 상대는 막대 반대편·맞닿은 글자로 한정 — 아래칸
                # 분자가 윗줄에 붙는 일은 막대 거리(>3pt)가 막는다)
                bcy = (b.y0 + b.y1) / 2.0
                bcx = (b.x0 + b.x1) / 2.0
                for r in rules:
                    rcy = (r[1] + r[3]) / 2.0
                    # 14.48 · 근호 윗줄은 분수 다리가 아니다. 아랫줄 근호
                    # 윗변이 윗줄 분모와 아랫줄 분자를 이어 행을 합쳐
                    # 격자를 깨뜨렸다(p22 (c)).
                    if any(o.role == "radical"
                           and abs(r[0] - o.x1) <= 4.5
                           and o.y0 - 4.5 <= rcy <= o.y1 + 4.5
                           for o in bs):
                        continue
                    if not (r[0] - 1.0 <= bcx <= r[2] + 1.0):
                        continue
                    if min(abs(b.y0 - rcy), abs(b.y1 - rcy)) > 3.0:
                        continue
                    for bb in rows[-1]:
                        if not (r[0] - 1.0
                                <= (bb.x0 + bb.x1) / 2.0 <= r[2] + 1.0):
                            continue
                        bbcy = (bb.y0 + bb.y1) / 2.0
                        if (bbcy - rcy) * (bcy - rcy) >= 0:
                            continue
                        if min(abs(bb.y0 - rcy), abs(bb.y1 - rcy)) > 3.0:
                            continue
                        joined = True
                        break
                    if joined:
                        break
            if joined:
                rows[-1].append(b)
                ry0 = min(ry0, b.y0); ry1 = max(ry1, b.y1)
            else:
                rows.append([b]); ry0, ry1 = b.y0, b.y1
        if len(rows) < 2:
            return None

        # ── 분수선이 줄 사이를 가로지르면 분수다 ──
        if rules:
            _crs = sorted((_median([b.cy for b in r]), _i)
                          for _i, r in enumerate(rows))
            cx0 = min(b.x0 for b in bs); cx1 = max(b.x1 for b in bs)
            cw = max(1e-6, cx1 - cx0)
            for r in rules:
                rcy = (r[1] + r[3]) / 2.0
                # 14.48 · 근호 윗줄은 분수선이 아니다 (벡터 sqrt 합성).
                if any(b.role == "radical"
                       and abs(r[0] - b.x1) <= 4.5
                       and b.y0 - 4.5 <= rcy <= b.y1 + 4.5 for b in bs):
                    continue
                for k in range(len(_crs) - 1):
                    if not (_crs[k][0] < rcy < _crs[k + 1][0]):
                        continue
                    if min(r[2], cx1) - max(r[0], cx0) <= 0.35 * cw:
                        continue
                    # 14.48 · 대분수(1½) 탈출. 막대 양옆 줄 안에, 분수 조각보다
                    # 확실히 크고(10.5pt vs 7pt) 막대 밖으로 삐져나온 숫자가
                    # 있으면 순수 분수가 아니라 대분수 칸이다 — 격자로 살린다.
                    # 크기가 같으면(x + 분수) 예전대로 분수로 보고 버린다.
                    _adj = rows[_crs[k][1]] + rows[_crs[k + 1][1]]
                    _fsz = [b.size for b in _adj if not b.atomic
                            and r[0] - 1.5 <= (b.x0 + b.x1) / 2.0 <= r[2] + 1.5
                            and (b.y0 <= rcy <= b.y1
                                 or 0 < rcy - b.y1 <= 4.0
                                 or 0 < b.y0 - rcy <= 4.0)]
                    _fm = max(_fsz) if _fsz else 0.0
                    _mixed = (_fm > 0 and any(
                        not b.atomic and b.size > _fm * 1.25
                        and (b.x0 < r[0] - 1.0 or b.x1 > r[2] + 1.0)
                        for b in _adj))
                    if not _mixed:
                        return None

        # ── 14.47 · 칸 안 숫자 조각(−1·12·3.5)을 먼저 합친다 ──
        rows = [_micro_merge_row(r, rules) for r in rows]
        inner = [b for r in rows for b in r]

        # ── 열: '칸 안쪽 간격'과 '칸 사이 간격'의 도약으로 가른다 ──
        #   닿아 있는 글자(커닝·아래첨자)의 0~1pt 간격은 칸을 가르는 간격이
        #   될 수 없다. 그걸 그대로 넣으면 '점 세 개'(\cdots) 사이의 3pt 가
        #   칸 간격으로 잘못 뽑혀 줄임표가 세 칸으로 쪼개졌다.
        #   도약이 여러 개면 '모든 줄의 칸 수가 같은' 것부터 고른다 —
        #   [a a | b] 처럼 칸 간격이 고르지 않은 행렬이 두 칸으로 뭉개지지 않게.
        gaps = []
        for r in rows:
            # 14.48 · 근호 몸통은 열을 가르는 글자가 아니다. 피제곱수 왼쪽에
            # 붙은 몸통이 1pt 미만 간격을 만들면 열 후보가 사라져 격자가
            # 깨졌다([1;-√3]). 몸통은 칸 배치(_fill)에서 겹침으로 제 칸을
            # 찾아간다.
            rr = sorted([b for b in r if b.role != "radical"],
                        key=lambda b: b.x0)
            for a, b in zip(rr, rr[1:]):
                gaps.append(b.x0 - a.x1)
        gs = sorted(g for g in gaps if g >= 1.0)
        cands = []
        for i in range(len(gs) - 1):
            lo, hi = gs[i], gs[i + 1]
            if hi - lo < 3.0 or lo <= 0:
                continue
            if hi / lo >= 3.0:
                cands.append((hi / lo, (lo + hi) / 2.0))
        cands.sort(key=lambda z: -z[0])
        if not cands and gs:
            # 14.47 · 도약이 하나도 없으면(열 간격이 거의 균일하면) 최소
            # 간격의 절반을 후보로 둔다. 최소 간격 '바로 아래'는 줄마다
            # 1pt 안팎으로 흔들리는 지터에 열이 뭉개져 버린다(Bmatrix 회귀).
            # 절반이면 진짜 열 간격은 반드시 갈라지고(2배 여유) 칸 안
            # 커닝만 합쳐진다.
            # 14.48 · 단, 간격이 '균일하게 작으면' 그건 열 간격이 아니라
            # 식 안쪽 간격(x − a)이다 — 가르면 [x-a;y-b] 가 2열이 됐다.
            # 진짜 열 간격은 글자 높이의 1/3 이상은 벌려 조판한다.
            if min(gs) >= max(3.0, hb * 0.32):
                cands.append((0.0, min(gs) * 0.5))
        # 14.48 · '전부 합치기' 후보: 간격이 균일하게 작으면 그건 열 간격이
        # 아니라 식 안쪽 간격(x − a)이므로 한 열이다. 0.0(글자별 분리)은
        # [x-a;y-b] 를 2열로 가르던 함정이므로 그보다 먼저 둔다.
        # (위 절반 후보와 상호배타: 절반은 min ≥ 기준일 때만 있다)
        if gs and max(gs) < max(3.0, hb * 0.32):
            cands.append((0.0, max(gs)))
        # 마지막 후보: 칸을 가를 간격이 없다 → 글자 하나가 한 칸. 같은 열의
        # 다른 줄 글자는 서로 겹치므로(gap ≤ 0) 여전히 한 칸으로 모인다.
        cands.append((0.0, 0.0))

        def _split(thr):
            cols = []
            _norad = [z for z in inner if z.role != "radical"]
            for b in sorted(_norad if _norad else inner, key=lambda z: z.x0):
                if cols and b.x0 - cols[-1][1] <= thr:
                    cols[-1][1] = max(cols[-1][1], b.x1)
                    cols[-1][2].append(b)
                else:
                    cols.append([b.x0, b.x1, [b]])
            # 세로 막대를 열 하나로 되돌린다 (막대가 놓인 자리 = 열 구분선)
            for off, b in enumerate(sorted(sep, key=lambda z: z.x0)):
                k = 0
                for ci in range(len(cols)):
                    if b.x0 >= cols[ci][1]:
                        k = ci + 1
                    elif b.x1 <= cols[ci][0]:
                        break
                    else:
                        k = ci + 1
                        break
                cols.insert(min(k + off, len(cols)), [b.x0, b.x1, [b]])
            return cols

        def _fill(cols):
            ncol = len(cols)
            grid = [[[] for _ in range(ncol)] for _ in rows]
            for ri, r in enumerate(rows):
                for b in r:
                    best_k, best_ov = 0, -1e9
                    for k in range(ncol):
                        ov = min(b.x1, cols[k][1]) - max(b.x0, cols[k][0])
                        if ov > best_ov:
                            best_ov, best_k = ov, k
                    grid[ri][best_k].append(b)
            for b in sep:                   # 막대는 모든 줄의 같은 칸에 놓인다
                best_k, best_ov = 0, -1e9
                for k in range(ncol):
                    ov = min(b.x1, cols[k][1]) - max(b.x0, cols[k][0])
                    if ov > best_ov:
                        best_ov, best_k = ov, k
                for ri in range(len(rows)):
                    grid[ri][best_k].append(b)
            return ncol, grid

        def _rowsplit(thr):
            # 14.48 · 행별로 먼저 가르고 x-겹침으로 열을 합친다.
            # 전역 x-묶음(_split)은 엇갈린 열에서 행을 넘나드는 유령
            # 간격을 만들어 점프 후보를 1열로 붕괴시켰다(p35 행렬식:
            # 유령 8.6 < thr 8.62). 행별 간격은 gs 그 자체라 점프가
            # 정확히 열 경계다. 전부 같은 칸 수(≥2)로 갈려야 격자.
            try:
                if sep or braces:
                    return None
                _rc = []
                for r in rows:
                    rr = sorted([b for b in r if b.role != "radical"],
                                key=lambda b: b.x0)
                    if not rr:
                        return None
                    _cur, _cs = [rr[0]], []
                    for a, b in zip(rr, rr[1:]):
                        if b.x0 - a.x1 > thr:
                            _cs.append(_cur)
                            _cur = []
                        _cur.append(b)
                    _cs.append(_cur)
                    _rc.append(_cs)
                _n = len(_rc[0])
                if _n < 2 or any(len(c) != _n for c in _rc):
                    return None
                # 같은 순서 칸끼리 겹쳐야 같은 열이다
                for k in range(_n):
                    _ks = sorted((c[k] for c in _rc),
                                  key=lambda c: min(b.x0 for b in c))
                    for _p, _q in zip(_ks, _ks[1:]):
                        _ov = min(max(b.x1 for b in _p),
                                  max(b.x1 for b in _q)) \
                            - max(min(b.x0 for b in _p),
                                  min(b.x0 for b in _q))
                        if _ov < -0.5:
                            return None
                _cc = []
                for k in range(_n):
                    _cb = [b for c in _rc for b in c[k]]
                    _cc.append([min(b.x0 for b in _cb),
                                max(b.x1 for b in _cb), _cb])
                for k in range(_n - 1):
                    if min(_cc[k][1], _cc[k + 1][1]) \
                            - max(_cc[k][0], _cc[k + 1][0]) > 0:
                        return None
                for b in inner:
                    if b.atomic:
                        continue
                    _hits = sum(1 for cx0, cx1, _cb in _cc
                                if min(b.x1, cx1) - max(b.x0, cx0)
                                > 0.35 * max(0.5, b.w))
                    if _hits > 1:
                        return None
                _nc, _gg = _fill(_cc)
                _cts = [sum(1 for cell in row if cell) for row in _gg]
                if len(set(_cts)) > 1 or not _cts or _cts[0] < 2 \
                        or _nc < 2:
                    return None
                return _cc, _gg
            except Exception:
                return None

        cols = grid = None
        _vec = None
        for _r, thr in cands:
            if _r == 0 and _vec is not None:
                # 14.48 · 보류된 벡터가 있으면 글자별 분리(0.0)는 볼 것도
                # 없다 — 낱글자 열은 어떤 벡터든 일관된 다열로 둔갑시킨다.
                continue
            cc = _split(thr)
            nc, gg = _fill(cc)
            # ── 한 글자가 두 열에 걸치면 칸 나누기가 틀렸다 ──
            bad = False
            for b in inner:
                if b.atomic:
                    continue
                hits = sum(1 for cx0, cx1, _cb in cc
                           if min(b.x1, cx1) - max(b.x0, cx0) > 0.35 * max(0.5, b.w))
                if hits > 1:
                    bad = True
                    break
            if bad:
                continue
            counts = [sum(1 for cell in row if cell) for row in gg]
            if len(set(counts)) > 1:          # 줄마다 칸 수가 다르면 격자가 아니다
                continue
            if counts and counts[0] >= 2 and nc >= 2:
                cols, grid = cc, gg
                break
            if nc < 2 and len(rows) >= 2 and counts and counts[0] >= 1:
                # 열 벡터(3×1) — 칸이 하나뿐이어도 격자다
                if _r > 0:
                    # 14.48 · 점프 후보가 1열로 붕괴했으면 행-우선으로
                    # 재시도한다. 이 지경이면 기존 동작은 보류(None행)
                    # 뿐이라 격자가 나오면 무조건 이득이다.
                    _rw = _rowsplit(thr)
                    if _rw is not None:
                        cols, grid = _rw
                        break
                    # 14.48 · 점프 후보의 벡터는 '보류'하고 낮은 점프를
                    # 계속 본다. 높은 점프의 1열이 진짜 다열을 가리면
                    # 울퉁불퉁 행렬이 통째로 None 이 됐다(27pt 벡터가
                    # 5pt 2열을 가림). 비율 0 후보(전부 합치기·낱글자)는
                    # 예전대로 즉시 확정 — [x-a;y-b] 가 낱글자로 갈라지면
                    # 안 되므로 순서를 손대지 않는다.
                    if _vec is None:
                        _vec = (cc, gg)
                    continue
                cols, grid = cc, gg
                break
        if cols is None and not braces and not sep:
            # 14.48 · 최후 수단: 줄마다 따로 가른다(울퉁불퉁 행렬).
            # 칸 폭이 들쭉날쭉하면(윗줄 열 간격 46pt·아랫줄 8pt) 전역
            # x-묶음이 어긋나 유령 열이 생겨 None 이 됐다. 줄별 점프가
            # 전부 같은 칸 수로 갈리고 왼쪽이 정렬되면 격자로 인정한다.
            # (중괄호는 cases 일 수 있어 제외 — Bmatrix 로 둔갑 방지)
            try:
                _rcells = []
                for r in rows:
                    rr = sorted(r, key=lambda b: b.x0)
                    _gaps = sorted(g for g in
                                   (rr[k + 1].x0 - rr[k].x1
                                    for k in range(len(rr) - 1)) if g >= 1.0)
                    _thr = None
                    _best = 0.0
                    for k in range(len(_gaps) - 1):
                        _lo, _hi = _gaps[k], _gaps[k + 1]
                        if _hi - _lo >= 3.0 and _lo > 0 \
                                and _hi / _lo >= 3.0 \
                                and _hi / _lo > _best:
                            _best = _hi / _lo
                            _thr = (_lo + _hi) / 2.0
                    if _thr is not None:
                        _cells, _cur = [], [rr[0]]
                        for k in range(len(rr) - 1):
                            if rr[k + 1].x0 - rr[k].x1 > _thr:
                                _cells.append(_cur)
                                _cur = []
                            _cur.append(rr[k + 1])
                        _cells.append(_cur)
                    else:
                        _cells = [list(rr)]
                    _rcells.append(_cells)
                _ncell = len(_rcells[0])
                _same = (_ncell >= 2 and all(len(c) == _ncell
                                             for c in _rcells))
                _align = _same and all(
                    max(min(b.x0 for b in c[k]) for c in _rcells)
                    - min(min(b.x0 for b in c[k]) for c in _rcells) <= 4.0
                    for k in range(_ncell))
                if _align:
                    _cc = []
                    for k in range(_ncell):
                        _cb = [b for c in _rcells for b in c[k]]
                        _cc.append([min(b.x0 for b in _cb),
                                    max(b.x1 for b in _cb), _cb])
                    _bad = False
                    for b in inner:
                        if b.atomic:
                            continue
                        _hits = sum(1 for cx0, cx1, _cb in _cc
                                    if min(b.x1, cx1) - max(b.x0, cx0)
                                    > 0.35 * max(0.5, b.w))
                        if _hits > 1:
                            _bad = True
                            break
                    if not _bad:
                        cols, grid = _cc, _rcells
            except Exception:
                pass
        if cols is None and _vec is not None:
            # 보류했던 열 벡터 (낮은 점프·울퉁불퉁 폴백이 다 실패했을 때만)
            cols, grid = _vec
        if cols is None:
            return None
        ncol = len(cols)
        filled = sum(1 for r in grid for cell in r if cell)
        if filled < max(len(rows), ncol) or filled < 0.5 * len(rows) * ncol:
            return None
        if ncol < 2:
            # 한 줄짜리 '열 벡터'는 칸이 반듯하게 정렬돼야 한다.
            # (X^{a}_{b} 처럼 첨자가 위아래로 붙은 덩어리를 열 벡터로 오인하지 않게)
            sizes = [b.size for b in inner if not b.atomic]
            # 14.48 · 분수 조각(규칙선 위/아래에 닿은 작은 글자)은 크기 검사에서
            # 뺀다. 칸에 분수가 있으면 10.5pt/7pt 가 섞여 격자가 통째로
            # 버려졌다([x'-1/4; y'-3/4]이 \left[ \right] 쓰레기가 됨).
            # 규칙선 없는 위/아래첨자(X^a_b)는 여전히 걸러진다.
            if rules and sizes:
                def _frac_part(b):
                    cx = (b.x0 + b.x1) / 2.0
                    for r in rules:
                        if not (r[0] - 1.5 <= cx <= r[2] + 1.5):
                            continue
                        rcy = (r[1] + r[3]) / 2.0
                        if b.y0 <= rcy <= b.y1:
                            return True
                        if 0 < rcy - b.y1 <= 4.0 or 0 < b.y0 - rcy <= 4.0:
                            return True
                    return False
                big = [b.size for b in inner
                       if not b.atomic and not _frac_part(b)]
                if big:
                    sizes = big
            if sizes and max(sizes) > min(sizes) * 1.25:
                return None
            cxs = [_median([b.x0 + b.x1 for b in r]) / 2.0 for r in rows]
            if max(cxs) - min(cxs) > max(1.6, hb * 0.4):
                # 14.48 · 가운데가 어긋나도 양쪽 끝이 맞으면 열 벡터다.
                # 칸 폭이 다른 벡터([x; y−1]·[−y+1; −x])는 왼쪽 끝이
                # 맞아떨어진다. X^a_b 처럼 첨자가 오른쪽으로 삐져나온
                # 것은 양쪽 끝도 어긋나므로 여전히 걸러진다.
                _lx = [min(b.x0 for b in r) for r in rows]
                _rx = [max(b.x1 for b in r) for r in rows]
                if (max(_lx) - min(_lx) > 2.5
                        and max(_rx) - min(_rx) > 2.5):
                    return None
        return {"rows": rows, "grid": grid, "cols": cols, "ncol": ncol,
                "hb": hb, "sep": sep}
    except Exception:
        return None


def _dots_tex(cell):
    """점만 있는 칸 → \\cdots / \\vdots / \\ddots (TeX 은 점 세 개로 조판한다)."""
    if not (2 <= len(cell) <= 6):
        return None
    if any(b.atomic or b.role is not None for b in cell):
        return None
    if any((b.tex or "").strip() not in _MAT_DOTS for b in cell):
        return None
    xs = sorted((b.x0 + b.x1) / 2.0 for b in cell)
    ys = sorted((b.y0 + b.y1) / 2.0 for b in cell)
    dx, dy = xs[-1] - xs[0], ys[-1] - ys[0]
    if dy > dx * 1.8:
        return r"\vdots"
    if dx > dy * 1.8:
        return r"\cdots"
    if dx > 0.5 and dy > 0.5:
        return r"\ddots"
    return r"\cdots"


def _matrix_bar_columns(g):
    """첨가 행렬([A | b])의 세로 막대가 선 열 번호들."""
    rows, grid, ncol = g["rows"], g["grid"], g["ncol"]
    if ncol < 3:
        return set()
    y0 = min(b.y0 for r in rows for b in r)
    y1 = max(b.y1 for r in rows for b in r)
    span = max(1e-6, y1 - y0)
    out = set()
    for k in range(1, ncol - 1):
        bs = [b for i in range(len(rows)) for b in grid[i][k]]
        if not bs:
            continue
        if not all(b.role == "vbar" or (b.tex or "").strip() in ("|", r"\|") for b in bs):
            continue
        if (max(b.y1 for b in bs) - min(b.y0 for b in bs)) < span * 0.5:
            continue
        out.add(k)
    return out


def _matrix_piece(g, o, c, rules, depth):
    """격자 + 구분자 → KaTeX 행렬 문자열."""
    grid, ncol, rows = g["grid"], g["ncol"], g["rows"]
    ot = (o.tex or "").strip()
    ct = (c.tex or "").strip()
    bars = _matrix_bar_columns(g)
    body_rows = []
    for ri in range(len(rows)):
        cells = []
        for k in range(ncol):
            if k in bars:
                continue
            cell = grid[ri][k]
            dots = _dots_tex(cell)
            cells.append(dots if dots else assemble(sorted(cell, key=lambda b: (b.x0, b.y0)),
                                                    rules, depth + 1))
        body_rows.append(" & ".join(cells))
    body = r" \\ ".join(body_rows)
    if bars:
        # 첨가 행렬: 열 구분선이 있는 array 를 큰 괄호로 감싼다.
        spec = "".join("|" if k in bars else "c" for k in range(ncol)).strip("|")
        return (r"\left" + ot + r" \begin{array}{" + spec + "} " + body
                + r" \end{array} \right" + ct)
    env = _MAT_ENV.get(ot)
    if env and _MAT_PAIR.get(ot) == ct:
        return r"\begin{" + env + "} " + body + r" \end{" + env + "}"
    return (r"\left" + ot + r" \begin{matrix} " + body
            + r" \end{matrix} \right" + ct)


def _try_matrix(boxes, rules, depth, opener=None, closer=None):
    r"""큰 구분자 + 격자 → \begin{bmatrix} … \end{bmatrix}.

    opener/closer 를 주면 그 두 구분자 사이만 본다(_linear 의 큰 괄호 짝).
    없으면 상자들 안에서 짝을 직접 찾고, 앞/뒤에 붙은 조각(A = , ^{-1})은
    assemble 로 다시 조립해 붙인다.
    """
    try:
        bs = sorted([b for b in boxes if (b.tex or "").strip() or b.atomic],
                    key=lambda b: (b.x0, b.y0))
        if opener is None and len(bs) < 4:
            # 14.47 · 이 검사는 '구분자+내용' 자동 탐색용이다. opener/closer
            # 경로(boxes = 내용물만)까지 막으면 [x;y] 같은 글자 두 개짜리
            # 열 벡터가 전부 \left[ 로 떨어졌다.
            return None

        def _vspan(o, c, content):
            """14.47 · 구분자 세로 범위 밖의 글자(행·열 이름표)는 칸이 아니다."""
            y0 = min(o.y0, c.y0); y1 = max(o.y1, c.y1)
            tol = (y1 - y0) * 0.10 + 2.0
            return [b for b in content if y0 - tol <= b.cy <= y1 + tol]

        cands = []
        if opener is not None and closer is not None:
            # 큰 괄호 글리프의 bbox 는 잉크보다 훨씬 넓어(83pt '[' 의 박스 폭
            # 28pt) 첫 칸을 덮는다. x 로 자르지 말고 호출자가 준 안쪽 목록을 믿는다.
            content = [b for b in boxes if b is not opener and b is not closer]
            content = [b for b in content if (b.tex or "").strip() or b.atomic]
            content = _vspan(opener, closer, content)
            if len(content) >= 2 and _delims_wrap(opener, closer, content):
                cands.append((opener, closer, content))
        else:
            for i in range(len(bs)):
                j = _matrix_delim_pair(bs, i)
                if j <= i + 1:
                    continue
                o, c = bs[i], bs[j]
                content = _vspan(o, c, bs[i + 1:j])
                if len(content) < 2 or not _delims_wrap(o, c, content):
                    continue
                # 14.47 · 내용물 안에 또 다른 큰 괄호가 있으면 두 행렬에
                # 걸친 엉터리 쌍이다(닫는 괄호를 잃은 이웃 탓) → 건너뛴다.
                # 첨가 행렬의 세로 막대(vbar)는 구분선이므로 제외하지 않는다.
                if any(b.role in ("open", "close") for b in content):
                    continue
                # 닫는 구분자 바로 뒤에 '작은' 글자(위/아래 첨자)가 붙으면
                # 여기서 붙이지 않는다 — _linear 가 첨자까지 처리하는 편이 낫다.
                # 14.47 · '바로 뒤'만 본다. 줄 끝까지 다 보면 옆 행렬의 윗줄이
                # 중심에서 4pt만 벗어나도 이 쌍이 죽어 버렸다(B 행렬 추락).
                rest = [b for b in bs
                        if c.x0 - 0.5 <= b.x0 <= c.x1 + max(5.0, o.size * 0.4)]
                ref_h = max(o.size * 0.72, o.h, 1.0)
                if any(b.size < o.size * 0.95 or abs(b.cy - c.cy) > ref_h * 0.15
                       for b in rest):
                    continue
                cands.append((o, c, content))
        if not cands:
            return None
        # 글자를 가장 많이 품은 쌍이 행렬 본체일 확률이 가장 높다
        o, c, content = max(cands, key=lambda z: len(z[2]))
        # 14.48 · 중괄호는 울퉁불퉁 폴백 대상이 아니다(cases 보호)
        g = _matrix_grid(content, rules,
                         braces=(o.tex or "").strip() in ("\\{", "\\}"))
        if not g:
            return None
        piece = _matrix_piece(g, o, c, rules, depth)
        if not piece:
            return None
        if opener is not None and closer is not None:
            return piece
        keep = {id(z) for z in content} | {id(o), id(c)}
        left = [b for b in bs if id(b) not in keep and b.x0 < o.x0]
        right = [b for b in bs if id(b) not in keep and b.x0 > c.x0]
        out = []
        if left:
            t = assemble(left, rules, depth + 1)
            if t:
                out.append(t)
        out.append(piece)
        if right:
            t = assemble(right, rules, depth + 1)
            if t:
                out.append(t)
        return " ".join(out).strip()
    except Exception:
        return None


def _delim_group(bs, i, rules, depth, norm_h):
    """bs[i] 의 큰 구분자 + 짝 → (LaTeX, 다음 위치).

    확장 글꼴(role 'open') 큰 괄호는 예전대로 \left…\right 로 감싼다.
    안쪽이 행렬 격자면 행렬 환경으로 바꾼다(&amp; 와 \\\\ 는 괄호 밖에서 쓸 수 없다).
    일반 글꼴을 늘려 그린 큰 괄호는 '행렬로 조립될 때만' 바꾼다 — 조립이
    안 되면(None) 예전처럼 평범한 글자로 읽어 어떤 출력도 바뀌지 않는다.
    """
    b = bs[i]
    native = b.role == "open"
    if not native and not _is_matrix_delim(b):
        return None
    if not native and b.h < norm_h * 1.45:
        return None
    n = len(bs)
    if native:
        # 확장 글꼴 큰 괄호 — 예전대로 role 로 짝을 센다 (출력이 바뀌지 않는다)
        depthc = 0
        j = -1
        for k in range(i, n):
            if bs[k].role == "open":
                depthc += 1
            elif bs[k].role == "close":
                depthc -= 1
                if depthc == 0:
                    j = k
                    break
    else:
        j = _matrix_delim_pair(bs, i)
    if j <= i:
        if native:
            return (r"\left" + (b.tex or "") + r" \right.", i + 1)
        return None
    mtx = _try_matrix(bs[i + 1:j], rules, depth + 1, opener=b, closer=bs[j])
    if mtx is None and not native:
        return None
    last = bs[j]
    ref_sz = last.size
    ref_h = max(ref_sz * 0.72, last.h, norm_h)
    base_cy = last.cy
    cluster, pend = [], []
    m_idx = j + 1
    while m_idx < n:
        c = bs[m_idx]
        if c.atomic:
            if (c.size < ref_sz * 0.95 and (last.y1 - c.y1) >= ref_h * 0.25
                    and c.x0 - max([z.x1 for z in (cluster + pend)] or [last.x1]) <= ref_h * 0.5):
                cluster.extend(pend); pend = []
                cluster.append(c)
                m_idx += 1
                continue
            break
        if c.role is not None:
            break
        prev_x1 = max([z.x1 for z in (cluster + pend)] or [last.x1])
        if c.x0 - prev_x1 > ref_h * 0.5:
            break
        small = c.size < ref_sz * 0.95
        same_run = bool(cluster) and abs(c.cy - cluster[-1].cy) < ref_h * 0.25
        if not (small or same_run):
            break
        off = abs(c.cy - base_cy)
        if off >= ref_h * 0.12:
            cluster.extend(pend); pend = []
            cluster.append(c)
            m_idx += 1
            continue
        if small and c.size < ref_sz * 0.9:
            pend.append(c)
            m_idx += 1
            continue
        break
    if pend:
        m_idx -= len(pend)
    subs = [c for c in cluster if c.cy > base_cy]
    sups = [c for c in cluster if c.cy < base_cy]
    if mtx is not None:
        grp = mtx
    else:
        # 14.70 · 이항계수: 괄호 안 내용이 '위·아래로 한 줄씩'(칸 수 합쳐
        # 2~5)이고 아랫줄이 괄호 몸통보다 한 칸 아래로 처져 있으면
        # \binom{윗줄}{아랫줄} 이다. CMEX 큰 괄호의 bbox 는 명목 1em 이라
        # 괄호 높이로는 가릴 수 없고, 내용 배치(세로 두 줄 + 가로 포개짐)로
        # 판정한다. 분수(규칙선 있음)와는 규칙선 유무로 가른다.
        grp = None
        inner = bs[i + 1:j]
        if 2 <= len(inner) <= 5 and not any(
                r[0] < bs[j].x1 + 1 and r[2] > bs[i].x0 - 1
                and bs[i].y0 - 3 < (r[1] + r[3]) / 2.0 < bs[j].y1 + 14
                for r in rules):
            _tcy = (b.y0 + b.y1) / 2.0
            _rh = max(6.0, b.size * 0.72)
            tops = [c for c in inner if c.cy < _tcy + _rh * 0.35]
            bots = [c for c in inner if c.cy > _tcy + _rh * 0.75]
            if tops and bots and len(tops) + len(bots) == len(inner):
                _tx = (min(c.x0 for c in tops), max(c.x1 for c in tops))
                _bx = (min(c.x0 for c in bots), max(c.x1 for c in bots))
                if min(_tx[1], _bx[1]) - max(_tx[0], _bx[0]) > 0:
                    grp = (r"\binom{"
                           + assemble(tops, rules, depth + 1) + "}{"
                           + assemble(bots, rules, depth + 1) + "}")
        if grp is None:
            grp = (r"\left" + (b.tex or "") + " "
                   + assemble(bs[i + 1:j], rules, depth + 1)
                   + r" \right" + (last.tex or ""))
    if sups:
        grp += "^{" + assemble(sups, rules, depth + 1) + "}"
    if subs:
        grp += "_{" + assemble(subs, rules, depth + 1) + "}"
    return (grp, m_idx)


_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")



# 부정 슬래시가 붙을 수 있는 관계기호 → KaTeX 부정 명령. (14.70)
_NEG_REL = {
    "=": r"\neq", r"\le": r"\nleq", r"\ge": r"\ngeq",
    r"\in": r"\notin", r"\sim": r"\nsim", r"\approx": r"\napprox",
    r"\equiv": r"\nequiv", r"\subset": r"\nsubset",
    r"\subseteq": r"\nsubseteq", r"\supset": r"\nsupset",
    r"\supseteq": r"\nsupseteq", r"\to": r"\nrightarrow",
    r"\leftarrow": r"\nleftarrow", r"\rightarrow": r"\nrightarrow",
    "<": r"\not<", ">": r"\not>",
}
_NEG_REL_ALT = re.compile(
    r"([=<>]|\\(?:le|ge|in|sim|approx|equiv|subset|subseteq|supset|supseteq|"
    r"to|leftarrow|rightarrow))(?![A-Za-z])\s*[\u0338\u0337]")
_NEG_REL_PRE = re.compile(
    r"[\u0338\u0337]\s*([=<>]|\\(?:le|ge|in|sim|approx|equiv|subset|subseteq|"
    r"supset|supseteq|to|leftarrow|rightarrow))(?![A-Za-z])")


def _NEGATE_SLASH(t):
    """'̸ =' · '= ̸' → \\neq 계열 명령으로 합친다."""
    if "\u0338" not in t and "\u0337" not in t:
        return t
    t = _NEG_REL_ALT.sub(lambda m: _NEG_REL.get(m.group(1), r"\not " + m.group(1)), t)
    t = _NEG_REL_PRE.sub(lambda m: _NEG_REL.get(m.group(1), r"\not " + m.group(1)), t)
    # 짝을 못 찾고 남은 부정 슬래시는 잉크 없는 조각일 뿐이다.
    return t.replace("\u0338", " ").replace("\u0337", " ")


def _tidy_latex(t):
    """복원 결과를 KaTeX 가 반드시 읽을 수 있는 모양으로 다듬는다.

    KaTeX 는 x^{a}^{b} (이중 위첨자) 를 오류로 낸다. 조판상 첨자가 여러
    번 붙는 경우가 실제로 있으므로(∫Ldt = 4.8 fb^-1) 하나로 합친다.
    """
    if not t:
        return ""
    t = _CTRL_RE.sub("", t)
    # 14.70 · CMSY 의 부정 슬래시(̸ U+0338/U+0337)는 낱글리프로 읽혀
    # 관계기호와 따로 노는 경우가 많다('̸ =' · '= ̸'). KaTeX 는 이 문자를
    # 만나는 순간 파스 오류로 식 전체를 죽이므로, 앞뒤 관계기호에 붙여
    # 부정 명령(\neq, \nleq, \notin …)으로 바꾸고 짝 없는 것은 지운다.
    t = _NEGATE_SLASH(t)
    # 14.3 · 유니코드 프라임/바는 KaTeX 가 빨간 오류 또는 빈 글리프로 낸다.
    t = (t.replace("\u2032", "'").replace("\u2033", "''").replace("\u2034", "'''")
           .replace("\u00b4", "'").replace("\u2019", "'").replace("\u2018", "'")
           .replace("\u2212", "-"))
    t = re.sub(r"([A-Za-z])\s*[\u00af\u02c9]", r"\\bar{\1}", t)
    t = t.replace("\u00af", r"\bar{}").replace("\u02c9", r"\bar{}")
    # 이계도함수: j ^{' '} / z ' '  →  j'' / z''   (이중 위첨자 오류 원천 차단)
    t = re.sub(r"\^\{\s*'\s*'\s*\}", "''", t)
    t = re.sub(r"\^\{\s*'\s*\}", "'", t)
    t = re.sub(r"(\\[A-Za-z]+|[A-Za-z])\s+'\s+'(?![A-Za-z])", r"\1''", t)
    # ^{a}^{b} 와 _{a}_{b} 를 각각 하나로. 두 종류가 번갈아 나오는 경우
    # (_{=}^{fb}_{4.8}) 도 있으므로 더 이상 줄지 않을 때까지 반복한다.
    for _ in range(8):
        prev = t
        # 14.71 · 지수 안에 인자 있는 명령(\mathrm{i})이 들면 예전 패턴
        # ([^{}]*) 이 매치를 못 해 e^{\mathrm{i}}^{tH} 이 그대로 남아
        # KaTeX 이중 위첨자 오류로 죽었다(11930 p17). 한 겹의 중첩 중괄호
        # 까지 허용한다.
        _grp = r"((?:[^{}]|\{[^{}]*\})*)"
        _ng = r"(?:[^{}]|\{[^{}]*\})*"
        t = re.sub(r"\^\{" + _grp + r"}((?:\s*_\{" + _ng + r"})*)\s*\^\{" + _grp + r"}",
                   r"^{\1 \3}\2", t)
        t = re.sub(r"_\{" + _grp + r"}((?:\s*\^\{" + _ng + r"})*)\s*_\{" + _grp + r"}",
                   r"_{\1 \3}\2", t)
        if t == prev:
            break
    # 깨진 분수 지수 결합: e.g. ) ^{-} \frac{1}{2} -> )^{- \frac{1}{2}}
    t = re.sub(r"(\)|\]|\}|[a-zA-Z0-9\|])\s*\^\{([^{}]*)\}\s*\\frac\{([^{}]*)\}\{([^{}]*)\}",
               r"\1^{\2 \\frac{\3}{\4}}", t)
    t = re.sub(r"(\)|\]|\}|[a-zA-Z0-9\|])\s*_\{([^{}]*)\}\s*\\frac\{([^{}]*)\}\{([^{}]*)\}",
               r"\1_{\2 \\frac{\3}{\4}}", t)
    t = re.sub(r"\\bigr\|\s*([A-Za-z0-9]+)\s*\\bigr\|", r"| \1 |", t)
    t = re.sub(r"\\biggr\|\s*([A-Za-z0-9]+)\s*\\biggr\|", r"| \1 |", t)
    t = re.sub(r"\\Bigr\|\s*([A-Za-z0-9]+)\s*\\Bigr\|", r"| \1 |", t)
    # 14.70 · '|s| |f(s)|'(절댓값의 곱)에서 인접한 두 막대를 \parallel 로
    # 합치던 규칙을 뺐다 — 곱 절댓값이 훨씬 흔하고, 진짜 ∥ 기호는
    # _SYM/_LATEX_SYMBOLS 의 U+2225 매핑이 이미 잡는다.
    # 인수 없는 \sqrt 는 파스 오류다
    t = re.sub(r"\\sqrt(?!\s*[{\[])", r"\\sqrt{}", t)
    t = re.sub(r"\\sqrt\{\}", "", t)
    t = _bind_accents(t)
    # A command that still has no group is a hard KaTeX parse error and takes
    # the whole equation down with it (\mathcal _{x}, \widetilde ^{a}, …).
    # Steal the following script's group as the argument — that is what the
    # source glyph order meant — and drop it only if there is nothing at all.
    for _ in range(4):
        prev = t
        t = re.sub(r"\\(" + _NEEDS_GROUP + r")\s*([_^])\s*\{", r"\\\1{}\2{", t)
        if t == prev:
            break
    t = re.sub(r"\\(" + _NEEDS_GROUP + r")\{\}", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    # 14.70 · r"\left"/r"\right" 부분문자열 개수로 세면 \rightarrow,
    # \rightleftarrows 같은 명령의 접두사까지 세어, 전혀 짝이 안 어긋난
    # 식에 \\left. 를 덧붙이고 있었다. 명령 경계(다음 글자가 아닌 곳)로만 센다.
    n_l = len(re.findall(r"\\left(?![A-Za-z])", t))
    n_r = len(re.findall(r"\\right(?![A-Za-z])", t))
    while n_l > n_r:
        t += r" \right."
        n_r += 1
    while n_r > n_l:
        t = r"\left. " + t
        n_l += 1
    return t


def _latex_is_sane(t):
    """분명히 깨진 결과는 버린다 (그 자리는 기존 경로가 처리한다)."""
    if not t:
        return False
    if _CTRL_RE.search(t):
        return False
    # 10.1 · 이스케이프된 \{ \} 는 braces 짝에서 제외한다
    #   (cases 큰중괄호 = \left\{ … \right. 처럼 짝이 없는 정상적인 경우가 있다)
    if (len(re.findall(r"(?<!\\)\{", t)) != len(re.findall(r"(?<!\\)\}", t))):
        return False
    if t.count(r"\left") != t.count(r"\right"):
        return False
    # A command with no argument is a KaTeX parse error, so the element would
    # render as a red error string instead of an equation. _tidy_latex repairs
    # the known shapes; anything still dangling means we misread the source and
    # the original vector math must be preserved instead.
    if re.search(r"\\(?:" + _NEEDS_GROUP + r")(?![A-Za-z{])", t):
        return False
    # A script with no base ('^{2}' at the very start) is also a parse error.
    if re.match(r"^\s*[_^]", t):
        return False
    # 알맹이가 거의 없는 것 (\sqrt 하나 등)
    if len(re.sub(r"[\s\\{}^_]|left|right|begin|end|aligned", "", t)) < 2:
        return False
    return True


def region_to_latex(doc, page, rect, gtables=None, rules=None, vlines=None):
    """PDF 영역 → LaTeX 한 줄."""
    boxes = region_boxes(doc, page, rect, gtables, vlines=vlines)
    if not boxes:
        return ""
    if rules is None:
        rules = page_rules(page)
    x0, y0, x1, y1 = rect
    # 10.0 · 분수선은 분자·분모 중 '넓은 쪽' 폭이라 밴드보다 더 넓은 경우가
    #  흔하다. 통째로 들어오는 선만 쓰면 그런 분수선이 전부 버려져 \frac 이
    #  만들어지지 않았다 → 밴드와 가로로 겹치는 선은 모두 포함한다.
    # 14.48 · 삐져나온 선을 여기서 거르면 안 된다. 바깥 분수선(여백 넓음)과
    #  삼각형 밑변(p21 가짜 θ/1)은 삐져나옴만으로 구분 불가(19pt<32pt) —
    #  다리 검증까지 깨져 중첩 분수가 통째로 사라졌다. 가짜 분수는
    #  _tex_is_figure_junk(낱글자 분수 규칙)에서 텍스트로 돌린다.
    rs = [r for r in rules
          if r[0] < x1 + 3 and r[2] > x0 - 3 and y0 - 3 <= (r[1] + r[3]) / 2 <= y1 + 3]
    return _tidy_latex(assemble(boxes, rs))


# (3) · (5.44) · [12] · (A.2) · (2.14a) — an optional appendix letter, then a
# number. A parenthesised expression such as (x) or (a + b) is NOT a label.
_EQ_LABEL = re.compile(
    r"^[\[\(]\s*(?:[A-Za-z][.\-])?[0-9]{1,3}(?:[.\-–][0-9A-Za-z]{1,4})*\s*[\]\)]$")


def _is_equation_label(text):
    """(3) · (5.46) · (A.2) — the number printed beside a display equation.

    It is typeset on the same baseline as the formula but is not part of it, so
    it must stay an ordinary editable text box.
    """
    t = (text or "").strip()
    if not t or len(t) > 12:
        return False
    return bool(_EQ_LABEL.match(t))


def _trim_band_labels(rd, bands):
    """Shrink a band that swallowed the equation number at its right edge.

    The band grows by geometry, so a label close to a wide display equation can
    land inside it. Cutting the band (rather than the LaTeX string) keeps the
    number as editable text and stops it being painted out of the background.

    14.70 · 가로 자르기는 '잘린 폭 안에 다른 글리프가 없을 때만' 한다.
    f_{1/2} 의 '2'(x 280.7..284.1) 와 식 번호 (25)(x 281.4..) 가 나란히
    놓인 식에서 번호 왼쪽으로 자르면 '2' 까지 잘려 \\frac{...^{f_{1/}}...
    처럼 첨자가 유실됐다. 가로가 안 되면 세로로 — 번호 줄 y 에 다른
    글리프가 없을 때 밴드 아래변을 번호 위로 올린다.
    """
    # 페이지의 '번호 아닌' 글리프(산문 제외 개념 없이 전부)
    _glyphs = []
    for _blk in rd.get("blocks", []):
        if _blk.get("type") != 0:
            continue
        for _ln in _blk.get("lines", []):
            _lb = _ln.get("bbox")
            if not _lb:
                continue
            _txt = "".join(_span_text(_sp) for _sp in _ln.get("spans", [])).strip()
            if _is_equation_label(_txt):
                continue
            for _sp in _ln.get("spans", []):
                for _ch in (_sp.get("chars") or []):
                    _cb = _ch.get("bbox")
                    _c = (_ch.get("c") or "").strip()
                    if _cb and _c:
                        _glyphs.append(_cb)
    out = []
    for m in bands:
        m = list(m)
        for blk in rd.get("blocks", []):
            if blk.get("type") != 0:
                continue
            for ln in blk.get("lines", []):
                bb = ln.get("bbox")
                if not bb:
                    continue
                txt = "".join(_span_text(sp) for sp in ln.get("spans", [])).strip()
                if not _is_equation_label(txt):
                    continue
                # Only a label sitting at the band's right (or left) edge.
                if not (bb[1] >= m[1] - 2 and bb[3] <= m[3] + 2):
                    continue
                if bb[0] >= m[0] and bb[2] <= m[2] + 2 and bb[2] >= m[2] - 2:
                    _nx = bb[0] - 0.5
                    # 잘려나갈 오른쪽 폭 안에 번호가 아닌 글리프가 있으면
                    # 가로로 자르지 않는다 — 대신 번호 줄의 y 가 비어 있으면
                    # 밴드 아래변을 올려 번호를 밴드 밖으로 뺀다.
                    _blocked = any(
                        _g[0] < m[2] and _g[2] > _nx and _g[1] < m[3] + 1
                        and _g[3] > m[1] - 1 for _g in _glyphs)
                    if _blocked:
                        _yfree = not any(
                            _g[1] < m[3] + 1 and _g[3] > bb[1] - 0.5
                            and _g[0] < m[2] + 1 and _g[2] > m[0] - 1
                            for _g in _glyphs)
                        if _yfree and bb[1] - 0.5 > m[1] + 6:
                            m[3] = bb[1] - 0.5
                        continue
                    m[2] = min(m[2], _nx)
                elif bb[0] <= m[0] + 2 and bb[2] <= m[2] and bb[0] >= m[0] - 2:
                    m[0] = max(m[0], bb[2] + 0.5)
        if m[2] - m[0] > 4:
            out.append(m)
    return out


def _expand_math_bands(rd, bands, row_prose=None):
    """cases처럼 키 큰 밴드만, 짧은 이웃 수식 토큰을 좌우로 끌어들인다.

    아무 밴드나 키우면 본문 문장이 수식에 빨려 들어가므로
    높이가 큰(중괄호/분수 여러 줄) 밴드에만 적용한다.
    """
    if not bands:
        return bands
    # 14.47 · 행 단위 산문 판정(쪼개진 줄 조각이 산문 행에 딸려 들어가지 않게)
    if row_prose is None:
        row_prose = _row_prose_flags(rd)
    glyphs = []
    for blk in rd.get("blocks", []):
        if blk.get("type") != 0:
            continue
        for ln in blk.get("lines", []):
            bb = ln.get("bbox")
            if not bb:
                continue
            if (bb[2] - bb[0]) > 120:
                continue
            if row_prose.get(id(ln), False):
                continue
            txt = "".join(_span_text(sp) for sp in ln.get("spans", []))
            # (5.46)/(3) is the equation NUMBER, never part of the formula.
            # Absorbing it put literal '( 5 . 4 6 )' inside the rendered math.
            if _is_equation_label(txt):
                continue
            glyphs.append(bb)
    out = [list(m) for m in bands]
    for m in out:
        if (m[3] - m[1]) < 40:
            continue
        for _ in range(3):
            grew = False
            for bb in glyphs:
                vov = min(bb[3], m[3]) - max(bb[1], m[1])
                if vov <= 2.0:
                    continue
                hgap = max(0.0, max(bb[0] - m[2], m[0] - bb[2]))
                if hgap > 40.0:
                    continue
                nx0, ny0 = min(m[0], bb[0]), min(m[1], bb[1])
                nx1, ny1 = max(m[2], bb[2]), max(m[3], bb[3])
                if ny1 - ny0 > (m[3] - m[1]) + 12:
                    continue
                if nx1 - nx0 > (m[2] - m[0]) + 90:
                    continue
                # 14.48 · 이웃 밴드를 덮치는 팽창은 건너뛴다 (성장 가드와
                # 같은 이유 — 겹친 둘 다 preserve 에서 죽는다).
                _hit = False
                for _o in out:
                    if _o is m:
                        continue
                    if (min(nx1, _o[2]) - max(nx0, _o[0]) > 0.5
                            and min(ny1, _o[3]) - max(ny0, _o[1]) > 0.5):
                        _hit = True
                        break
                if _hit:
                    continue
                if (nx0, ny0, nx1, ny1) != (m[0], m[1], m[2], m[3]):
                    m[0], m[1], m[2], m[3] = nx0, ny0, nx1, ny1
                    grew = True
            if not grew:
                break
    return [m[:4] for m in out]


def _drop_contained_math(regs):
    """다른 수식 상자 안에 들어 있는 조각(첨자·프라임)을 버린다. 겹침 방지."""
    if not regs:
        return []
    ordered = sorted(regs, key=lambda r: -max(1.0, (r["x1"] - r["x0"]) * (r["y1"] - r["y0"])))
    keep = []
    for r in ordered:
        ra = max(1e-6, (r["x1"] - r["x0"]) * (r["y1"] - r["y0"]))
        contained = False
        for o in keep:
            ox = min(o["x1"], r["x1"]) - max(o["x0"], r["x0"])
            oy = min(o["y1"], r["y1"]) - max(o["y0"], r["y0"])
            if ox > 0 and oy > 0 and (ox * oy) / ra >= 0.72:
                contained = True
                break
            if (o["x0"] - 1.2 <= r["x0"] and o["y0"] - 1.2 <= r["y0"]
                    and o["x1"] + 1.2 >= r["x1"] and o["y1"] + 1.2 >= r["y1"]):
                contained = True
                break
        if not contained:
            keep.append(r)
    keep.sort(key=lambda r: (r["y0"], r["x0"]))
    return keep


def _matrix_band_seeds(page, rd, doc, gtables, rules, is_prose=None, limit=60,
                        vlines=None):
    """큰 구분자가 감싼 '글자 격자'를 행렬 밴드 후보로 찾는다. (14.46)

    씨앗 조건이 확장 글꼴(CMEX/txex)이거나 분수선 근처인 줄뿐이면, 일반
    글리프를 세로로 늘려 큰 괄호를 그리는 PDF(unicode-math·Word 계열)의
    행렬은 수식으로 아예 잡히지 않는다. 칸 숫자는 본문 글자로 흩어지고
    닫는 괄호는 마지막 줄에 덧붙는다('1 0[ ]').

    여기서는 글자 배치만으로 후보를 만들고, **실제로 행렬로 조립되는지
    assemble 로 확인한 것만** 씨앗으로 올린다 — 조립 결과가 행렬이 아니면
    아무것도 바뀌지 않는다.
    """
    try:
        cands, heights = [], []
        _seed_pieces = []     # 14.47 · Symbol 큰 괄호 조각(산문 줄에서도 수집)
        for blk in rd.get("blocks", []):
            if blk.get("type") != 0:
                continue
            for ln in blk.get("lines", []):
                skip = bool(is_prose and is_prose(ln))
                for sp in ln.get("spans", []):
                    fname = sp.get("font") or ""
                    short = fname.split("+")[-1]
                    up = short.upper()
                    ext = any(k in up for k in ("CMEX", "TXEX", "EXTRA", "LMEX",
                                                "MSAM", "MSBM", "ESINT"))
                    table = gtables.get(fname) or gtables.get(short) or {}
                    size = float(sp.get("size") or 10)
                    for ch in (sp.get("chars") or []):
                        c = ch.get("c") or ""
                        bb = ch.get("bbox")
                        if not bb or not c or c.isspace():
                            continue
                        if ext:
                            if skip:
                                continue
                            gname = table.get(ord(c)) if c else None
                            if not gname and c:
                                gname = _CMEX_STD.get(ord(c))
                            role, tex = classify_glyph(gname)
                            if role not in ("open", "close", "vbar"):
                                if bb[3] > bb[1]:
                                    heights.append(bb[3] - bb[1])
                                continue
                        else:
                            if c and _is_symbol_font(fname):
                                dec = _symbol_pua_lookup(ord(c))
                                if dec is None:
                                    continue
                                if isinstance(dec, tuple):
                                    _seed_pieces.append(Box(
                                        bb[0], bb[1], bb[2], bb[3], c, size, "pua"))
                                    continue
                                if dec is not False:
                                    c = dec
                            if skip:
                                continue
                            tex = _tok_tex(c)
                            if (tex or "").strip() not in _MAT_DELIM_TEX:
                                if c.strip() and bb[3] > bb[1]:
                                    heights.append(bb[3] - bb[1])
                                continue
                            role = "vbar" if c == "|" else None
                        cands.append(Box(bb[0], bb[1], bb[2], bb[3], tex, size, role))
        if _seed_pieces:
            # 조각 기둥을 큰 구분자로 합쳐 후보에 올린다. 조립 검증(아래)이
            # 행렬이 아닐 걸 걸러주므로 씨앗 단계에선 관대해도 된다.
            cands.extend(_merge_piece_columns(_seed_pieces))
        if vlines:
            # 14.48 · 벡터 세로선도 | 후보로 올린다 (글리프 없는 행렬식).
            # 짝·높이·조립 검증이 가짜를 걸러준다.
            for _v in vlines:
                cands.append(Box(_v[0], _v[1], _v[2], _v[3], "|", 10.0, "vbar"))
        if len(cands) < 2:
            return []
        body_h = _median(heights) or 10.0
        # 본문 글자보다 훨씬 큰 구분자만 ('(' 처럼 보통 크기 괄호는 제외)
        cands = [b for b in cands if b.h >= max(11.0, body_h * 1.55)]
        if len(cands) < 2:
            return []
        cands.sort(key=lambda b: b.x0)
        out = []
        for i, o in enumerate(cands):
            if len(out) >= limit:
                break
            ot = (o.tex or "").strip()
            for k in range(i + 1, len(cands)):
                c = cands[k]
                if (c.x0 + c.x1) <= (o.x0 + o.x1):
                    continue
                if c.x0 - o.x1 > 520.0:
                    break
                if _MAT_PAIR.get(ot) != (c.tex or "").strip():
                    continue
                if min(o.y1, c.y1) - max(o.y0, c.y0) < 0.65 * min(o.h, c.h):
                    continue
                # 14.48 · 짝 괄호 높이가 다르면(1.35배↑) 다른 줄끼리 엮인
                # 것이다. 높이 2배짜리 가짜 쌍이 쓰레기 bmatrix 로 씨앗
                # 검증까지 통과해 두 식을 한 밴드로 합쳐 버렸다(p10 붕괴).
                if max(o.h, c.h) > 1.35 * min(o.h, c.h):
                    continue
                x0, x1 = o.x0 - 0.6, c.x1 + 0.6
                y0, y1 = min(o.y0, c.y0) - 0.6, max(o.y1, c.y1) + 0.6
                sub = [r for r in (rules or [])
                       if r[0] < x1 and r[2] > x0 and y0 - 3 <= (r[1] + r[3]) / 2.0 <= y1 + 3]
                boxes = region_boxes(doc, page, (x0, y0, x1, y1), gtables, rd=rd,
                                       vlines=vlines)
                if len(boxes) < 4:
                    continue
                try:
                    tex = _tidy_latex(assemble(boxes, sub))
                except Exception:
                    continue
                if tex and _MAT_ENV_RE.search(tex) and _latex_is_sane(tex):
                    out.append([x0, y0, x1, y1])
                    break
        return out
    except Exception as e:
        print(f"[import] 행렬 후보 탐색 건너뜀: {e}")
        return []


def _span_prose_words(spans, main_sz=None):
    """'본문 산문 낱말'만 골라낸다 (prose_hits, non_math). (14.71)

    수식 표기의 낱말은 산문이 아니다:
      · 수학 글꼴(CMMI·CMSY·CMEX·CMSS·MSBM…) 낱말
      · 첨자 크기 로만 라벨 — C_gen·B^diag·C_typ 의 'gen'·'diag'·'typ'
        (본문 크기의 80% 미만)
    이 둘을 산문으로 세는 바람에 디스플레이 식 줄이 산문 줄로 둔갑해
    밴드가 못 생기고(p81 ‖B^diag‖ 줄), 줄 이어붙기가 거부돼 식 꼬리가
    잘렸다(p101 'λ∥₁ ≤ C_typ δ_n' 줄). 낱말은 span 단위로 글꼴·크기를
    함께 본다.
    """
    try:
        if not spans:
            return [], []
        if main_sz is None:
            main_sz = 0.0
            for sp in spans:
                main_sz = max(main_sz, float(sp.get("size") or 0))
            if main_sz <= 0:
                main_sz = 10.0
        hits, nonmath = [], []
        for sp in spans:
            name = (sp.get("font") or "").lower().replace("-", "").replace(" ", "")
            if any(k in name for k in MATH_FONTS) or "cmss" in name:
                continue
            if float(sp.get("size") or 10) < main_sz * 0.8:
                continue          # 첨자 크기 로만 라벨 — 표기법이다
            for w in re.findall(r"[A-Za-z]+", _span_text(sp)):
                if w.lower() in _COMMON_PROSE:
                    hits.append(w)
                elif len(w) >= 3 and not _is_math_identifier(w):
                    nonmath.append(w)
        return hits, nonmath
    except Exception:
        return [], []


def _row_prose_flags(rd):
    """같은 행(row)에 놓인 줄들을 묶어 산문 여부를 판정한다. (14.47)

    MuPDF 는 산문 속 Symbol 글자·첨자를 별개의 '줄'로 쪼갠다. 줄 단위로만
    보면 "{", "A =" 같은 조각이 산문 판정을 피하고, 밑줄 규칙선과 만나
    가짜 수식 밴드가 된다(Q36 행이 수식 수프로 굳던 원인).
    같은 행(세로로 60% 이상 겹치고 높이가 비슷하고 가로로 이웃한 줄)의
    글자를 합쳐 판정하면 조각도 제 행의 문맥을 따라간다.
    """
    try:
        lines = []
        for blk in rd.get("blocks", []):
            if blk.get("type") != 0:
                continue
            for ln in blk.get("lines", []):
                if ln.get("bbox"):
                    lines.append(ln)
        order = sorted(range(len(lines)), key=lambda i: lines[i]["bbox"][1])
        parent = list(range(len(lines)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for ii, i in enumerate(order):
            bi = lines[i]["bbox"]
            hi = max(1e-6, bi[3] - bi[1])
            for j in order[ii + 1:]:
                bj = lines[j]["bbox"]
                if bj[1] >= bi[3]:
                    break              # y0 순 정렬이므로 이후는 겹칠 수 없다
                ov = min(bi[3], bj[3]) - max(bi[1], bj[1])
                hj = max(1e-6, bj[3] - bj[1])
                if max(hi, hj) > 2.2 * min(hi, hj):
                    continue     # 키 큰 조각(구분자)은 다른 행까지 엮지 않는다
                hgap = max(0.0, max(bi[0] - bj[2], bj[0] - bi[2]))
                if hgap > 16.0:
                    continue     # 다른 단·멀리 떨어진 식은 같은 행이 아니다
                if ov > 0.6 * min(hi, hj):
                    ri, rj = find(i), find(j)
                    if ri != rj:
                        parent[rj] = ri
                    continue
        groups = {}
        for i, ln in enumerate(lines):
            groups.setdefault(find(i), []).append(ln)
        out = {}
        for members in groups.values():
            spans = [sp for ln in members for sp in ln.get("spans", [])]
            prose_hits, non_math = _span_prose_words(spans)
            prose = bool(prose_hits or len(non_math) >= 2)
            for ln in members:
                out[id(ln)] = prose
        return out
    except Exception:
        return {}


def _both_matrix_tex(doc, page, a, b, gtables, rules, rd):
    """두 밴드가 '각각' 행렬로 조립되는가. (14.48 · 10.4 쌓임 방지)

    줄바꿈된 한 등식의 조각은 행렬로 안 되지만, 위아래로 쌓인 별개
    식(Thus 3단 유도)은 양쪽 다 행렬로 된다. 후자를 합치면 aligned
    쓰레기가 되므로, 10.4 병합 전에 검사해 합치지 않는다.
    조립 검증(씨앗 검사와 같은 코드)이라 거짓 양성이 나올 수 없다.
    """
    try:
        for bb in (a, b):
            x0, y0, x1, y1 = bb[0], bb[1], bb[2], bb[3]
            sub = [r for r in (rules or [])
                   if r[0] < x1 and r[2] > x0
                   and y0 - 3 <= (r[1] + r[3]) / 2.0 <= y1 + 3]
            boxes = region_boxes(doc, page, (x0, y0, x1, y1), gtables, rd=rd)
            if len(boxes) < 4:
                return False
            tex = _tidy_latex(assemble(boxes, sub))
            if not tex or not _MAT_ENV_RE.search(tex):
                return False
        return True
    except Exception:
        return False


def _big_math_bands(page, avoid=None):
    """이 쪽에서 '큰 수식' 이 놓인 줄 영역(밴드)들을 찾는다. (9.3)

    큰 수식의 표시는 두 가지다.
      · 확장 글꼴(CMEX/txex) 글리프 — 키 큰 적분·시그마·괄호·근호·대입 막대
      · 분수선 — 위/아래에 글자를 거느린 가로 규칙선
    한 식이 여러 '줄'로 쪼개져 나오므로(분자/분모/첨자가 각각 줄이 된다)
    세로로 이어지는 것들을 하나의 밴드로 합친다.
    """
    try:
        rd = _page_rawdict(page)
    except Exception:
        return [], [], {}
    try:
        doc = page.parent
        gtables = glyph_tables_full(doc, page)   # 10.1 · 글꼴 프로그램 이름표 포함
    except Exception:
        doc, gtables = None, {}
    try:
        rules = page_rules(page)
    except Exception:
        rules = []
    try:
        _vlines = page_vlines(page)
    except Exception:
        _vlines = []

    # 10.4 · 표 안쪽의 가로선은 분수선이 아니다 (표→\frac 오인 방지)
    if avoid:
        def _rule_in_avoid(r):
            cx, cy = (r[0] + r[2]) / 2.0, (r[1] + r[3]) / 2.0
            return any(a[0] - 1 <= cx <= a[2] + 1 and a[1] - 1 <= cy <= a[3] + 1
                       for a in avoid)
        rules = [r for r in rules if not _rule_in_avoid(r)]

    # '본문 문장'은 절대 밴드 씨앗이 되지 못한다.
    # (본문 안에 복잡한 인라인 수식이 있어 확장글꼴이 섞여 있어도 마찬가지 —
    #  그런 줄이 씨앗이 되면 옆의 디스플레이 수식과 합쳐지고, 산문과 겹쳐
    #  밴드 전체가 버려지면서 진짜 수식까지 사라졌다)
    # 14.47 · 행 단위 판정: 쪼개진 줄 조각이 제 행의 문맥을 따라간다.
    _row_prose = _row_prose_flags(rd)

    def _is_prose(ln):
        flag = _row_prose.get(id(ln))
        if flag is not None:
            return flag
        prose_hits, non_math = _span_prose_words(ln.get("spans", []))
        return bool(prose_hits or len(non_math) >= 2)

    seeds = []
    for blk in rd.get("blocks", []):
        if blk.get("type") != 0:
            continue
        for ln in blk.get("lines", []):
            bb = ln.get("bbox")
            if not bb or _is_prose(ln) or _pdf_intersects(bb, avoid):
                continue
            has_ext = False
            for sp in ln.get("spans", []):
                fn = (sp.get("font") or "").split("+")[-1].upper()
                # 14.71 · MSAM/MSBM(ℝ·J 같은 blackboard/AMS 기호)은 본문
                # 크기 수학 글자다. 시드로 올리면 식의 한 조각만 담은
                # 불완전 밴드가 생겨(p19 (A.93) 꼬리), 줄 이어붙기를
                # 막아 식 머리가 잘렸다. 키 큰 확장 글꼴만 시드로 본다.
                if any(x in fn for x in ("CMEX", "TXEX", "EXTRA", "LMEX", "ESINT")):
                    has_ext = True
                    break
            # 10.0 · '큰 분수' 시드 조건 완화.
            #  예전 조건(분수선이 줄 bbox 안에 '통째로' 들어갈 것)은 분자·분모
            #  폭이 서로 다른 큰 분수에서는 한쪽이 항상 실패했다 — 분수선은 둘 중
            #  넓은 쪽 폭이므로, 좁은 쪽 줄보다 분수선이 길다. 그러면 그 줄은
            #  시드가 못 되고, 결국 분수가 분자/분모 둘로 쪼개져 버렸다.
            #  이제 ① 세로 여유를 줄 높이에 비례하고 ② 가로는 '분수선과 40% 이상
            #  겹치면' 통과시킨다.
            vtol = max(7.0, (bb[3] - bb[1]) * 0.35)
            near_rule = False
            for r in rules:
                rcy = (r[1] + r[3]) / 2.0
                if not (bb[1] - vtol <= rcy <= bb[3] + vtol):
                    continue
                hov = min(bb[2] + 4, r[2]) - max(bb[0] - 4, r[0])
                if (bb[0] - 4 <= r[0] and r[2] <= bb[2] + 4) \
                        or (bb[0] >= r[0] - 4 and bb[2] <= r[2] + 4) \
                        or hov >= 0.4 * max(1e-6, r[2] - r[0]):
                    near_rule = True
                    break
            if has_ext or near_rule:
                seeds.append([bb[0], bb[1], bb[2], bb[3], False])
    # 14.46 · 행렬: 확장 글꼴 괄호가 없는 PDF 에서도 '큰 구분자 + 격자'를
    #   씨앗으로 올린다. 실제로 행렬로 조립되는 후보만 들어온다.
    try:
        for _ms in _matrix_band_seeds(page, rd, doc, gtables, rules, _is_prose,
                                         vlines=_vlines):
            seeds.append([_ms[0], _ms[1], _ms[2], _ms[3], True])
    except Exception:
        pass

    # 14.71 · 분수선 자체를 씨앗으로 올린다. 분수의 분자·분모 줄이 산문
    # 행과 묶여 prose 로 묵살되면(C_gen·B^diag 같은 로만 첨자 낱말 때문)
    # 분모 조각만 홀로 씨앗이 되거나 아예 씨앗이 안 생겨, 분수가 부분
    # 조각으로 잘렸다(p84 Lemma I.33 의 ε(r)+ε(s)q²√N/|r−s|). 막대
    # 양옆 위·아래 글자 상자 전체를 하나의 씨앗 밴드로 만든다.
    try:
        _rd_chars = []
        for _blk in rd.get("blocks", []):
            if _blk.get("type") != 0:
                continue
            for _ln in _blk.get("lines", []):
                for _sp in _ln.get("spans", []):
                    _fn = (_sp.get("font") or "").lower().replace("-", "").replace(" ", "")
                    _mathish = (any(_x in _fn for _x in MATH_FONTS)
                                or "cmss" in _fn)
                    for _ch in (_sp.get("chars") or []):
                        _bb = _ch.get("bbox")
                        if not _bb:
                            continue
                        _rd_chars.append((_bb, _mathish,
                                          float(_sp.get("size") or 10),
                                          _ch.get("c") or ""))
        for r in rules:
            rw = r[2] - r[0]
            if rw < 4.0:
                continue
            rcy = (r[1] + r[3]) / 2.0
            _covered = False
            for s in seeds:
                if ((min(s[2], r[2]) - max(s[0], r[0])) >= 0.8 * rw
                        and s[1] - 12.0 <= rcy <= s[3] + 12.0):
                    _covered = True
                    break
            if _covered:
                continue
            # 막대 x 폭 안의 위·아래 글자 (분자·분모)
            # 14.71 · 세로 창은 ±12 로 제한한다. ±22 였을 때 다음 본문
            # 줄 글자까지 시드 상자에 들어와(p84 'Proof.' 줄·p87 'any h'
            # 줄) 분수가 이웃 산문을 삼켰다.
            # 14.71 · 막대 바로 오른/왼쪽의 문장 부호(.,;:)는 분수와 한
            # 덩어리다('rac{δ_*n}{2}.' · 'rac{4}{2},'). 요소 영역이
            # 부호를 걸치고 자르면 감사가 부호를 누락으로 센다(p7·p70·p92).
            _ccx = lambda c: (c[0][0] + c[0][2]) / 2.0
            _ccy = lambda c: (c[0][1] + c[0][3]) / 2.0
            _win = [c for c in _rd_chars
                    if (r[0] - 1.0 <= _ccx(c) <= r[2] + 1.0
                        and abs(_ccy(c) - rcy) <= 12.0)
                    or ((c[3] or "") in ".,;:"
                        and (r[2] < _ccx(c) <= r[2] + 4.5
                             or r[0] - 4.5 <= _ccx(c) < r[0])
                        and abs(_ccy(c) - rcy) <= 8.0)]
            _up = [c for c in _win if (c[0][1] + c[0][3]) / 2.0 < rcy - 1.5]
            _dn = [c for c in _win if (c[0][1] + c[0][3]) / 2.0 > rcy + 1.5]
            if not _up or not _dn:
                continue        # 분수가 아니다(근호 윗줄·장식선)
            _mx = 0.0
            for c in _win:
                _mx = max(_mx, c[2])
            # 본문 크기 로만 '알파벳' 글자가 위·아래에 있으면 분수가 아니라
            # 밑줄·장식선이다. 숫자·괄호·더하기는 분수에도 흔하므로 보지
            # 않는다(p87 |1−t|/|1+√t| 의 '1'·'+').
            _roman_main = [c for c in _win
                           if not c[1] and c[2] >= _mx * 0.85
                           and (c[3] or "").isalpha()]
            if len(_roman_main) >= 2:
                continue
            bxs = [c[0] for c in _win]
            seeds.append([min(b[0] for b in bxs), min(b[1] for b in bxs),
                          max(b[2] for b in bxs), max(b[3] for b in bxs), False])
    except Exception:
        pass
    if not seeds:
        return [], rules, gtables

    # 14.70 · 오른쪽 여백의 식 번호 '(28)' 줄의 y 중심. 서로 다른 번호의
    # 식이 한 밴드로 합쳐지면(p6의 식 (28)·(29)) 두 줄이 x 순서로 뒤섞여
    # 'v v ⟩ ⟩ : : = =' 처럼 글자가 쌍으로 굳는다. 번호를 하나씩 품은
    # 두 밴드는 절대 합치지 않는다.
    _eqnum_cy = []
    try:
        for _blk in rd.get("blocks", []):
            if _blk.get("type") != 0:
                continue
            for _ln in _blk.get("lines", []):
                _lb = _ln.get("bbox")
                if not _lb:
                    continue
                _txt = "".join(_span_text(_sp) for _sp in _ln.get("spans", [])).strip()
                # 14.71 · (I.209) 같은 부록 번호도 식 번호다. 아라비아만
                # 보던 예전 판별으론 부록 식들이 서로 합쳐질 수 있었다.
                if not (_is_equation_label(_txt) and _txt.startswith("(")):
                    continue
                if _lb[0] < page.rect.width - 90:
                    continue          # 오른쪽 여백이 아니다(본문 (a) 따위)
                _eqnum_cy.append((_lb[1] + _lb[3]) / 2.0)
    except Exception:
        _eqnum_cy = []

    def _eqnum_of(y0, y1):
        for _c in _eqnum_cy:
            if y0 - 1.0 <= _c <= y1 + 1.0:
                return _c
        return None

    def _eqnum_clash(a, b):
        """두 밴드가 서로 다른 식 번호를 각각 품고 있으면 True(합치면 안 됨)."""
        _ca, _cb = _eqnum_of(a[1], a[3]), _eqnum_of(b[1], b[3])
        return _ca is not None and _cb is not None and abs(_ca - _cb) > 2.0

    # 세로로 겹치거나 맞닿은 조각들을 한 식으로 합친다
    # 세로로 '실제로 겹치는' 조각만 한 식으로 본다. 단순히 맞닿았다고
    # 합치면 위아래로 나란한 별개의 식 두 개가 한 덩어리가 된다.
    seeds.sort(key=lambda r: (r[1], r[0]))
    # [x0,y0,x1,y1,capH,matrix_only,has_matrix] — capH: 자랄 수 있는
    # 최대 높이, matrix_only: 행렬 씨앗만으로 이뤄진 밴드(14.47 · 팽창·
    # 산문충돌 면제), has_matrix: 행렬 씨앗을 하나라도 품은 밴드(14.48 ·
    # 쌓인 별개 식 흡수 거부 조건).
    bands = []
    for r in seeds:
        placed = False
        for m in bands:
            vov = min(r[3], m[3]) - max(r[1], m[1])
            # 10.1 · 세로로 겹치더라도 가로로 아득히 떨어진 조각끼리 붙이면
            #   한 '줄'의 서로 다른 식이 통째로 합쳐져 밴드가 페이지 전체로
            #   자라나고, 결국 산문과 겹쳐 통째로 버려졌다. 가로 근접 필수.
            hgap = max(0.0, max(r[0] - m[2], m[0] - r[2]))
            if (vov > min(r[3] - r[1], m[3] - m[1]) * 0.28 and hgap <= 36.0
                    and not _eqnum_clash(m, r)):
                cap = max(m[4], max(46.0, (r[3] - r[1]) * 1.35))
                m[0] = min(m[0], r[0]); m[1] = min(m[1], r[1])
                m[2] = max(m[2], r[2]); m[3] = max(m[3], r[3])
                m[4] = max(cap, 46.0)
                m[5] = bool(m[5] and r[4])
                m[6] = bool(m[6] or r[4])
                placed = True
                break
        if not placed:
            bands.append([r[0], r[1], r[2], r[3],
                          max(46.0, (r[3] - r[1]) * 1.35), bool(r[4]),
                          bool(r[4])])

    # 10.0 · 분수선을 사이에 둔 두 밴드는 한 식이다.
    #   분자 밴드와 분모 밴드는 세로로 전혀 겹치지 않아, 위의 '세로 겹침'
    #   병합으로는 절대 합쳐지지 않는다. 그래서 (큰 수식)/(큰 수식) 분수가
    #   분자·분모 두 개의 서로 다른 수식으로 갈라져 버렸다.
    #   같은 분수선을 사이에 두고 마주 보는 밴드들을 하나로 묶는다.
    for r in rules:
        rcy = (r[1] + r[3]) / 2.0
        rw = max(1e-6, r[2] - r[0])
        grp = []
        for m in bands:
            vgap = max(0.0, max(m[1] - rcy, rcy - m[3]))   # 밴드가 분수선과 떨어진 거리
            hov = min(m[2], r[2]) - max(m[0], r[0])
            inside = (m[0] >= r[0] - 4 and m[2] <= r[2] + 4)   # 밴드가 분수선 폭 안에
            if vgap <= max(14.0, (m[3] - m[1]) * 0.8) and (inside or hov >= 0.4 * rw):
                grp.append(m)
        # 14.70 · 각자 다른 식 번호를 품은 밴드들이라면 별개의 식이다.
        _clash = False
        for _i in range(len(grp)):
            for _j in range(_i + 1, len(grp)):
                if _eqnum_clash(grp[_i], grp[_j]):
                    _clash = True
        if _clash:
            grp = grp[:1]
        if len(grp) >= 2:
            # 14.48 · 장식용 가로선(절 구분선·박스 테두리)이 분수선으로 둔갑해
            #   남의 밴드들을 합치던 사고 방지. 진짜 분수선은 분자·분모가
            #   폭을 메우지만, 장식선은 밴드 사이가 텅 비어 있다.
            #   단 100pt 이하 짧은 선은 면제한다 — 다리 시점의 밴드는
            #   자라기 전 씨앗이라 낱글자 분자(a/b)의 폭 메움이 50%에
            #   못 미쳐 진짜 분수 다리까지 끊겼다. 짧은 선+양면 밴드는
            #   분수다(절 구분선은 텍스트 폭 300pt+라 여전히 걸린다).
            if rw > 100.0:
                spans = sorted((max(m[0], r[0]), min(m[2], r[2])) for m in grp)
                covered, _cs, _ce = 0.0, spans[0][0], spans[0][1]
                for _s, _e in spans[1:]:
                    if _s <= _ce:
                        _ce = max(_ce, _e)
                    else:
                        covered += max(0.0, _ce - _cs)
                        _cs, _ce = _s, _e
                covered += max(0.0, _ce - _cs)
                if covered < 0.5 * rw:
                    continue
            # 14.48 · 검증된 행렬 밴드는 이웃과 합치지 않는다 — 합치는 순간
            #   matrix_only 가 깨져 산문 충돌 검사에 통째로 버려졌다.
            if any(m[5] for m in grp) and not all(m[5] for m in grp):
                continue
            # 14.48 · 막대가 밴드 안에 통째로 들었으면 분자·분모가 이미
            #   한 밴드다 — 다리를 놓을 이유가 없다. 놓으면 건너편의
            #   쌓인 별개 식까지 합쳐진다(Thus 3단 유도 붕괴).
            if any(m[1] < rcy < m[3] for m in grp):
                continue
            grp.sort(key=lambda m: m[1])
            # 분수선을 기준으로 위·아래가 마주 보는 쌍일 때만 합친다.
            # 14.48 · 양쪽 끝이 막대에서 8pt 안에 있어야 한다 — 멀리
            #   떨어진 쌓인 식이 중간 밴드에 묻어 통째로 합쳐졌다.
            #   단 속에 자기 규칙선을 품은 합성 분자·분모(중첩 분수!)는
            #   14pt까지 허용한다 — 안쪽 분수의 clearance 때문에 막대와
            #   멀어진다. (1+a/b)/2 분자가 11.2pt 벌어져 다리가 끊기고
            #   중첩 분수가 통째로 사라졌다.
            def _inner_rule(m):
                for _rr in rules:
                    _rc = (_rr[1] + _rr[3]) / 2.0
                    if abs(_rc - rcy) <= 1.0:
                        continue
                    if m[1] + 2.0 < _rc < m[3] - 2.0 \
                            and min(m[2], _rr[2]) - max(m[0], _rr[0]) > 0:
                        return True
                return False
            _cap0 = 14.0 if _inner_rule(grp[0]) else 8.0
            _cap1 = 14.0 if _inner_rule(grp[-1]) else 8.0
            if (grp[0][3] <= rcy + 3.0 and grp[-1][1] >= rcy - 3.0
                    and grp[0][3] >= rcy - _cap0 and grp[-1][1] <= rcy + _cap1):
                m0 = grp[0]
                for m in grp[1:]:
                    m0[0] = min(m0[0], m[0]); m0[1] = min(m0[1], m[1])
                    m0[2] = max(m0[2], m[2]); m0[3] = max(m0[3], m[3])
                    m0[4] = max(m0[4], m[4], 46.0)
                    m0[5] = bool(m0[5] and m[5])
                    m0[6] = bool(m0[6] or m[6])
                    bands.remove(m)

    for _ in range(4):
        grew = False
        # (a) 줄 조각 흡수 — 세로로 겹치거나 한 줄 높이 안쪽으로 붙고,
        #     가로로 겹치거나 바로 옆에 붙었으면 같은 식이다.
        for blk in rd.get("blocks", []):
            if blk.get("type") != 0:
                continue
            for ln in blk.get("lines", []):
                bb = ln.get("bbox")
                if not bb or _is_prose(ln):
                    continue
                # 14.71 · 식 번호 줄('(A.94)' 등)은 절대 흡수하지 않는다.
                # x 가 끝 줄과 겹쳐 흡수되곤 했는데, 번호 주변 여백이 좁으면
                # trim_band_labels 도 되돌리지 못해 번호가 식 안에 굳었다.
                _lt = "".join(_span_text(sp) for sp in ln.get("spans", [])).strip()
                if _is_equation_label(_lt):
                    continue
                lh = max(2.0, bb[3] - bb[1])
                # 14.48 · 검증된 행렬 밴드 안에 중심이 든 줄은 그 밴드 소유다.
                # 키 큰 괄호 조각 줄(lh*2.2 도달)은 옆 행렬까지 건너와 빨려
                # 들어가 두 행렬+산문이 한 밴드로 합쳐졌다(Q36 붕괴).
                _lcx = (bb[0] + bb[2]) / 2.0
                _lcy = (bb[1] + bb[3]) / 2.0
                _owner = None
                for _o in bands:
                    if (_o[5] and _o[0] <= _lcx <= _o[2]
                            and _o[1] <= _lcy <= _o[3]):
                        _owner = _o
                        break
                for m in bands:
                    if _owner is not None and m is not _owner:
                        continue
                    vov = min(bb[3], m[3]) - max(bb[1], m[1])
                    vgap = max(0.0, max(bb[1] - m[3], m[1] - bb[3]))
                    hov = min(bb[2], m[2]) - max(bb[0], m[0])
                    if not (vov > 0.5 or vgap <= 0.55 * lh):
                        continue
                    if lh > max(14.0, (m[3] - m[1]) * 2.6):
                        continue                      # 훨씬 큰 덩어리는 못 붙인다
                    hgap = max(0.0, max(bb[0] - m[2], m[0] - bb[2]))
                    ok = (hov >= (bb[2] - bb[0]) * 0.55
                          or hgap <= max(8.0, lh * 2.2)
                          or hov >= 0.4 * min(bb[2] - bb[0], m[2] - m[0]))
                    if not ok:
                        continue
                    # 14.48 · 행렬 밴드는 위·아래로 쌓인 별개 식을 빨지 않는다.
                    # 관계식(=·≤·≥·≈·≠)이 줄 중간에 있으면 다음 식이다(Q4의
                    # 3x+7y=9가 [3 7;1 6]⁻¹ 밴드에 붙어 죽던 mush). 관계식으로
                    # '시작'하는 줄(= 5x…·, y=…·⇒…)은 윗 식의 꼬리이므로
                    # 그대로 흡수한다. 같은 줄(vov 큼)은 나란한 식이 아니라
                    # 같은 식(Q2의 B = …)이므로 거부하지 않는다.
                    if m[6] and vov <= 0.5:
                        _lt = "".join(_span_text(sp)
                                      for sp in ln.get("spans", [])).strip()
                        if _lt and _lt[0] not in "=≈≃≠≤≥<>⇒⇔→,;:" \
                                and any(c in "=≈≃≠≤≥<>⇒⇔→" for c in _lt):
                            continue
                    nx0 = min(m[0], bb[0]); nx1 = max(m[2], bb[2])
                    ny0 = min(m[1], bb[1]); ny1 = max(m[3], bb[3])
                    # 14.71 · 식 번호 호위 — 흡수 후 밴드가 '새' 번호의 y
                    # 중심을 품게 되면 별개 식의 줄을 삼키는 것이다(p19 의
                    # (A.93)/(A.94) 줄이 0.5pt 겹쳐 한 밴드로 뭉개졌다).
                    # 번호가 늘어나는 흡수는 거부한다.
                    _nn = [c for c in _eqnum_cy if ny0 - 1.0 <= c <= ny1 + 1.0]
                    _on = [c for c in _eqnum_cy if m[1] - 1.0 <= c <= m[3] + 1.0]
                    if len(_nn) > len(_on):
                        continue
                    # 14.70 · 첨자 크기 줄(f_{1/2} 의 '2')은 분수 가장자리에서
                    # 밴드보다 6pt 남짓 더 내려간다. 키 제한을 그만큼만
                    # 늘려준다 — 다음 식의 본문 줄(lh≥10)은 여전히 막힌다.
                    _cap_extra = 10.0 if lh <= 8.0 else 0.0
                    if ny1 - ny0 > m[4] + _cap_extra:
                        continue          # 키 제한 초과 — 여기서 자라면 폭주다
                    # 14.48 · 자라면서 이웃 밴드를 덮치면 겹친 둘 다 죽는다
                    # (preserve 겹침 제거 → 식이 흔적도 없이 사라짐: Q2 A+B
                    # 밴드가 C 밴드를 덮쳐 셋 다 증발). 같은 줄(row)의
                    # 이웃이면 한 식이다 → 합친다(긴 식의 씨앗 잇기).
                    # 위·아래로 쌓인 밴드면 별개의 식이다 → 덮치지 않고
                    # 건너뛴다(그 줄은 제 밴드(다음 후보)가 가져간다).
                    _hit = None
                    for _o in bands:
                        if _o is m:
                            continue
                        if (min(nx1, _o[2]) - max(nx0, _o[0]) > 0.5
                                and min(ny1, _o[3]) - max(ny0, _o[1]) > 0.5):
                            _hit = _o
                            break
                    if _hit is not None:
                        _vv = min(m[3], _hit[3]) - max(m[1], _hit[1])
                        _mh = min(m[3] - m[1], _hit[3] - _hit[1])
                        _uh = max(ny1, _hit[3]) - min(ny0, _hit[1])
                        _nn2 = [c for c in _eqnum_cy
                                if min(ny0, _hit[1]) - 1.0 <= c <= max(ny1, _hit[3]) + 1.0]
                        _on2 = [c for c in _eqnum_cy
                                if m[1] - 1.0 <= c <= m[3] + 1.0]
                        if (_vv > 0.5 * _mh
                                and _uh <= max(m[4], _hit[4])
                                and len(_nn2) <= len(_on2)):
                            m[0] = min(nx0, _hit[0])
                            m[1] = min(ny0, _hit[1])
                            m[2] = max(nx1, _hit[2])
                            m[3] = max(ny1, _hit[3])
                            m[4] = max(m[4], _hit[4])
                            m[5] = bool(m[5] and _hit[5])
                            m[6] = bool(m[6] or _hit[6])
                            bands.remove(_hit)
                            grew = True
                            break
                        continue
                    if (nx0, ny0, nx1, ny1) != (m[0], m[1], m[2], m[3]):
                        m[0], m[1], m[2], m[3] = nx0, ny0, nx1, ny1
                        grew = True
                    break
        # (b) 작은 밴드(확장글꼴 글리프 하나짜리: ⟨ ⟩ ∏ …)끼리, 또는
        #     이웃 밴드에 붙여 합친다 — 분리돼 있으면 식이 조각난다.
        bands.sort(key=lambda m: (m[1], m[0]))
        i = 0
        while i < len(bands):
            a = bands[i]
            for j in range(len(bands)):
                if j == i:
                    continue
                b = bands[j]
                if a is b:
                    continue
                vgap = max(0.0, max(b[1] - a[3], a[1] - b[3]))
                hgap = max(0.0, max(b[0] - a[2], a[0] - b[2]))
                small = (a[2] - a[0] < 12.0 or b[2] - b[0] < 12.0)
                if (small and vgap <= 26.0
                        and hgap <= max(14.0, (a[2] - a[0] + b[2] - b[0]))
                        and max(a[3], b[3]) - min(a[1], b[1]) <= max(a[4], b[4])
                        and not _eqnum_clash(a, b)):
                    a[0] = min(a[0], b[0]); a[1] = min(a[1], b[1])
                    a[2] = max(a[2], b[2]); a[3] = max(a[3], b[3])
                    a[4] = max(a[4], b[4], 46.0)
                    a[5] = bool(a[5] and b[5])
                    a[6] = bool(a[6] or b[6])
                    bands.pop(j)
                    grew = True
                    if j < i:
                        i -= 1
                    # 14.48 · pop 뒤에는 인덱스가 어긋나므로 무조건 break
                    # (j≥i 병합이면 조건부 break가 안 걸려 IndexError로
                    # 죽고, 페이지 전체가 줄-경로로 떨어져 조각났다).
                    break
            else:
                i += 1
        if not grew:
            break

        # 10.4 · 한 등식이 여러 줄로 쪼개진 경우: 세로로 바로 붙은 두 밴드가
        #   가로로 많이 겹치면 한 식으로 합친다 (줄바꿈된 긴 등식).
        # 14.48 · 단, 양쪽이 각각 행렬로 조립되면 쌓인 별개 식이다(Thus
        #   3단 유도) — 합치면 aligned 쓰레기가 되므로 합치지 않는다.
        #   줄바꿈된 한 등식은 쪼개진 조각이 행렬로 안 되므로 그대로 합쳐진다.
        for _pass in range(2):
            hit = False
            for i in range(len(bands)):
                for j in range(i + 1, len(bands)):
                    a, b = bands[i], bands[j]
                    vgap = max(0.0, max(b[1] - a[3], a[1] - b[3]))
                    hov = min(a[2], b[2]) - max(a[0], b[0])
                    if (vgap <= 4.0 and hov >= 0.6 * min(a[2] - a[0], b[2] - b[0])
                            and max(a[3], b[3]) - min(a[1], b[1]) <= 55.0
                            and not _eqnum_clash(a, b)):
                        if _both_matrix_tex(doc, page, a, b, gtables, rules, rd):
                            continue
                        a[0] = min(a[0], b[0]); a[1] = min(a[1], b[1])
                        a[2] = max(a[2], b[2]); a[3] = max(a[3], b[3])
                        a[4] = max(a[4], b[4], 55.0)
                        a[6] = bool(a[6] or b[6])
                        bands.pop(j)
                        hit = True
                        break
                if hit:
                    break
            if not hit:
                break

    # 중복/포함된 내부 밴드 정리
    final_bands = []
    for b in bands:
        if any(b is not o and o[0] <= b[0] + 1 and o[1] <= b[1] + 1 and o[2] >= b[2] - 1 and o[3] >= b[3] - 1 for o in bands):
            continue
        final_bands.append(b)

    # 산문 줄과 세로로 겹쳐 버린 밴드는 신뢰할 수 없다 → 큰 수식 처리 포기
    # 14.47 · 행렬 씨앗 밴드는 검증된 구분자 상자 그대로라 줄-bbox 충돌 검사를
    # 면제한다. 산문 글자를 삼켰는지는 뒤의 글자 단위 검사(_touches_prose)가 본다.
    bands = final_bands
    good = []
    for m in bands:
        if m[5]:
            good.append(m[:4])
            continue
        clash = False
        for blk in rd.get("blocks", []):
            if blk.get("type") != 0:
                continue
            for ln in blk.get("lines", []):
                bb = ln.get("bbox")
                if not bb or not _is_prose(ln):
                    continue
                vov = min(bb[3], m[3]) - max(bb[1], m[1])
                if vov <= 7.0:
                    continue
                # 10.1 · 1~6pt 스치는 겹침(디센더 등)으로 식 전체를 버리던
                #   일이 있었다 → 산문 한 줄을 통째로 삼킬 때만 포기한다.
                # 14.71 · '통째로 삼킨다'의 기준은 줄 bbox 가 아니라 그 줄의
                # 본문 크기 로만 글자 잉크다. 수식 조각이 산문 행에 묶여
                # prose 플래그를 달아도(p84 Lemma I.33 의 분자 줄) 그 잉크가
                # 산문이 아니면 충돌이 아니다.
                _lmax = 0.0
                for _sp in ln.get("spans", []):
                    _lmax = max(_lmax, float(_sp.get("size") or 0))
                if _lmax <= 0:
                    _lmax = 10.0
                _ink = False
                for _sp in ln.get("spans", []):
                    _nm = (_sp.get("font") or "").lower().replace("-", "").replace(" ", "")
                    if any(_k in _nm for _k in MATH_FONTS) or "cmss" in _nm:
                        continue
                    if float(_sp.get("size") or 10) < _lmax * 0.8:
                        continue
                    if not re.search(r"[A-Za-z]", _span_text(_sp)):
                        continue
                    _sb = _sp.get("bbox")
                    if not _sb:
                        continue
                    if (min(_sb[2], m[2]) - max(_sb[0], m[0])) > 40.0:
                        _ink = True
                        break
                if _ink:
                    clash = True
                    break
            if clash:
                break
        if not clash:
            good.append(m[:4])
    bands = good

    # 14.3 · cases/큰 괄호 밴드는 좌우 이웃 수식 토큰(s_k(t)=, k>0, …)까지 포함한다.
    bands = _expand_math_bands(rd, bands, _row_prose)
    # 식 번호 '(5.46)' 이 밴드 안에 들어왔으면 잘라낸다 — 수식이 아니라 글자다.
    bands = _trim_band_labels(rd, bands)

    return bands, rules, gtables


def _pdf_page_lines(page, avoid=None, math_avoid=None, preserve_math_glyphs=False):
    """한 페이지에서 단어를 뽑는다 (rawdict, 문자 단위 좌표 기반).

    반환: (lines, math_regions)
      lines = [{x0,y0,x1,y1,base,words:[...]}]
      math_regions = [{x0,y0,x1,y1,display:bool,text:str}] — LaTeX로 바꿀 수식 영역
    수식은 일반 글자 상자에서 제외하고, 하나의 LaTeX 요소로 만들도록 영역과 원문을 모은다.
    """
    try:
        rd = _page_rawdict(page)
    except Exception:
        return [], []
    try:
        _pg_vlines = page_vlines(page)
    except Exception:
        _pg_vlines = []

    lines = []
    math_regions = []
    # 14.48 · 행 단위 산문 판정. MuPDF 는 산문+수식 한 줄을 글꼴·높이별로
    #   여러 '줄'로 쪼갠다. 조각만 보면 'Z = 0' 이 독립 수식처럼 보여
    #   행렬 한쪽만 걸치는 깨진 수식('\left[ \right.')을 만들었다.
    #   조각이 제 행의 문맥(산문)을 따라가면 이런 중복이 사라진다.
    try:
        _line_row_prose = _row_prose_flags(rd)
    except Exception:
        _line_row_prose = {}
    prose_glyphs = []
    for block in rd.get("blocks", []):
        for line in block.get("lines", []):
            # 14.70 · 밴드 폐기 판정(_touches_prose)은 '낱 span' 단위로 산문을
            # 가렸다. 그러다 \rho^{K^{\mathrm{hor}}} 의 'hor'(CMR5, 3글자) 처럼
            # 짧은 로만 첨자가 산문 단어로 둔갑해, 완벽하게 조립된 디스플레이
            # 밴드가 통째로 버려지고 식이 조각조각 나는 일이 벌어졌다.
            # 밴드 씨앗의 _is_prose 와 같은 기준(행 단위 묶음 + 산문 단어 or
            # 비수식 3글자 낱말 2개 이상)으로만 산문 글자로 인정한다.
            row_prose = _line_row_prose.get(id(line), False)
            # 14.71 · 산문 낱말은 _span_prose_words 기준으로만 본다(첨자
            # 크기 로만 라벨 'typ'·'gen' 은 산문이 아니다).
            _lspans = line.get("spans", [])
            _lmain = 0.0
            for _sp in _lspans:
                _lmain = max(_lmain, float(_sp.get("size") or 0))
            for span in _lspans:
                name = span.get("font", "").lower()
                if any(f in name for f in MATH_FONTS):
                    continue
                words = re.findall(r"[A-Za-z]{2,}", _span_text(span))
                if words and float(span.get("size") or 10) < _lmain * 0.8:
                    words = []          # 첨자 크기 로만 라벨
                prose_hits = [w for w in words if w.lower() in _COMMON_PROSE]
                non_math = [w for w in words
                            if len(w) >= 3 and w.lower() not in _MATH_WORDS]
                if not (row_prose or prose_hits or len(non_math) >= 2):
                    continue
                for ch in span.get("chars", []):
                    if ch.get("c", "").isalpha():
                        bb = ch["bbox"]
                        prose_glyphs.append(((bb[0]+bb[2])/2, (bb[1]+bb[3])/2))

    def _touches_prose(bb):
        # Small contaminated bands are not safe merely because they overlap
        # less than the old 40pt threshold. Even one swallowed body glyph can
        # produce a garbage equation and a hole in a paragraph.
        return any(bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3] for x, y in prose_glyphs)

# ── 9.3 · 큰 수식 먼저 ────────────────────────────────────
    # 키 큰 적분/시그마, 큰 분수, 대입 기호가 있는 영역은 일반 줄 판정에
    # 넘기지 않는다. 확장 글꼴 글자가 'Z','P' 같은 쓰레기로 읽혀서
    # 점수가 0점이 되고, 결국 배경 사진으로 굳어 버리기 때문이다.
    big_bands = []
    _gt = {}
    _rules = []
    try:
        bands, _rules, _gt = _big_math_bands(page, avoid=(avoid or []) + (math_avoid or []))
        doc = page.parent
        # 14.48 · 산문을 삼킨 밴드는 버리지 말고 산문 밖으로 오그린다.
        # 검증된 행렬 씨앗이 옆 한 단어('matrix')까지 삼켰다가 밴드째
        # 버려지면 진짜 행렬까지 사라졌다. 산문을 뺀 최소 상자로 다시
        # 감싸고, 가운데 박힌 산문(오그리기로 안 빠지면)은 포기한다.
        salvaged = []
        salvaged_full = set()
        for bb in bands:
            if _pdf_intersects(bb, (avoid or []) + (math_avoid or [])):
                continue
            if not _touches_prose(bb):
                salvaged.append(bb)
                continue
            try:
                _sboxes = region_boxes(doc, page, tuple(bb), _gt,
                                         vlines=_pg_vlines)
            except Exception:
                continue
            keep = [b for b in _sboxes
                    if not any(abs((b.x0 + b.x1) / 2 - px) <= 1.5
                               and abs((b.y0 + b.y1) / 2 - py) <= 1.5
                               for px, py in prose_glyphs)]
            if not keep:
                continue
            nbb = [min(b.x0 for b in keep), min(b.y0 for b in keep),
                   max(b.x1 for b in keep), max(b.y1 for b in keep)]
            # 14.48 · 오그리기가 행렬을 깨뜨리면(FULL은 온전한데 nbb가
            # aligned/insane) FULL을 살린다: p18 (ii)의 '(ii) find [⋯]⁻¹'은
            # 산문 접두어와 함께 조립돼야 여는 괄호가 제 행을 찾는다.
            # 오그리기가 깨끗하면(단일·정상) 그대로 nbb를 쓴다.
            _MAT_ENVS = (r"\begin{bmatrix}", r"\begin{vmatrix}",
                         r"\begin{pmatrix}", r"\begin{Bmatrix}")
            try:
                _nt = region_to_latex(doc, page, tuple(nbb), _gt,
                                      _rules, _pg_vlines)
            except Exception:
                _nt = ""
            if (not _touches_prose(nbb) and _nt and len(_nt) <= 1200
                    and _latex_is_sane(_nt)):
                salvaged.append(nbb)
                continue
            try:
                _ft = region_to_latex(doc, page, tuple(bb), _gt,
                                      _rules, _pg_vlines)
            except Exception:
                _ft = ""
            if (_ft and len(_ft) <= 1200 and _latex_is_sane(_ft)
                    and (any(e in _ft for e in _MAT_ENVS)
                         or (r"\begin{aligned}" in _ft
                             and _ft.count(r"\\") <= 3))):
                salvaged.append(bb)
                salvaged_full.add(id(bb))
                continue
            continue
        bands = salvaged
        for bi, bb in enumerate(bands):
            # Overlapping reconstructed bands can steal each other's limits or
            # subscripts. Keep those ambiguous equations in the original vector
            # layer; independently reconstructed, non-overlapping math is intact.
            if preserve_math_glyphs and any(i != bi and _pdf_intersects(bb, [other])
                                             for i, other in enumerate(bands)):
                avoid = list(avoid or []) + [bb]
                continue
            if _pdf_intersects(bb, (avoid or []) + (math_avoid or [])) \
                    or (_touches_prose(bb)
                        and id(bb) not in salvaged_full):
                continue
            if (bb[2] - bb[0]) < 6 or (bb[3] - bb[1]) < 6:
                continue
            try:
                tex = region_to_latex(doc, page, tuple(bb), _gt, _rules,
                                        _pg_vlines)
            except Exception:
                tex = ""
            if not tex or len(tex) > 1200 or not _latex_is_sane(tex):
                continue
            # 14.70 · aligned 밴드를 통째로 버리면 두 줄 디스플레이 식
            # (∥K∥ ≤ … \\ ≤ …) 이 아예 텍스트 조각으로 흩어졌다. 조립이
            # sane 하면 그대로 올린다 — 산문 혼입은 salvage 단계에서 걸렀다.
            if (preserve_math_glyphs and r"\begin{aligned}" in tex
                    and tex.count(r"\\") > 4):
                avoid = list(avoid or []) + [bb]
                continue
            # 10.4 · 그림 안 글자가 수식으로 오인된 쓰레기 버림
            if _tex_is_figure_junk(tex):
                continue
            # 14.70 · 내용 없이 막대(+첨자)만 남은 조각(\Biggr\|_{=} 따위)은
            # 조각난 밴드의 흔적이다 — LaTeX 상자로 내보내면 화면에 홀로
            # 선 막대가 그려진다. 원본 글리프(텍스트)로 돌린다.
            if re.fullmatch(r"\\[Bb]ig{1,2}r(?:\\\||\|)(?:\s*_\{[^{}]{1,12}\})?",
                            tex.strip()):
                continue
            # 글자가 거의 없는(그림에 가까운) 밴드는 건드리지 않는다
            if len(re.sub(r"[\s\\{}^_]", "", tex)) < 2:
                continue
            szs = []
            for blk in rd.get("blocks", []):
                if blk.get("type") != 0:
                    continue
                for ln in blk.get("lines", []):
                    lb = ln.get("bbox")
                    if not lb:
                        continue
                    if lb[1] >= bb[1] - 1 and lb[3] <= bb[3] + 1 \
                       and lb[0] >= bb[0] - 2 and lb[2] <= bb[2] + 2:
                        for sp in ln.get("spans", []):
                            if _span_text(sp).strip():
                                szs.append(float(sp.get("size") or 10))
            msz = max(szs) if szs else 10.0
            math_regions.append({"x0": bb[0], "y0": bb[1], "x1": bb[2], "y1": bb[3],
                                 "display": True, "text": tex, "size": msz,
                                 "big": True})
            big_bands.append(bb)
    except Exception as e:
        print(f"[import] 큰 수식 복원 건너뜀: {e}")

    def _in_big(bb):
        """이 줄이 이미 '큰 수식' 밴드에 들어갔는가."""
        if not bb:
            return False
        cx = (bb[0] + bb[2]) / 2.0
        cy = (bb[1] + bb[3]) / 2.0
        for m in big_bands:
            if m[0] - 2 <= cx <= m[2] + 2 and m[1] - 2 <= cy <= m[3] + 2:
                return True
        return False

    def _cuts_big_band(bb):
        """14.48 · 영역이 검증된 밴드를 '걸쳐서' 자르는가.

        밴드를 통째로 품은 영역(온전한 식)은 괜찮지만, 밴드 일부만 걸치는
        영역은 산문 줄 조각이 수식에 손을 뻗친 것이다 — 행렬의 여는 괄호만
        걸치면 '\\left[ \\right.' 깨짐이 된다. 그런 영역은 버리고 밴드
        수식(검증됨)만 살린다.
        """
        if not bb:
            return False
        for m in big_bands:
            ix0, iy0 = max(bb[0], m[0]), max(bb[1], m[1])
            ix1, iy1 = min(bb[2], m[2]), min(bb[3], m[3])
            if ix1 - ix0 > 2.0 and iy1 - iy0 > 2.0:
                ba = max(1e-6, (m[2] - m[0]) * (m[3] - m[1]))
                if ((ix1 - ix0) * (iy1 - iy0)) / ba < 0.8:
                    return True
        return False

    seen_chars = {}
    def _duplicate_char(c, bb, font, flags, color):
        # Deduplicate actual coincident glyphs, including PDFs with invisible
        # OCR/overprint copies. Do not delete real repeated words nearby.
        key = (c, font, flags, color, round(bb[0]), round(bb[1]))
        for old in seen_chars.get(key, []):
            if max(abs(bb[i] - old[i]) for i in range(4)) <= .25:
                return True
        seen_chars.setdefault(key, []).append(bb)
        return False

    # 14.48 · 슈퍼라인 병합용 전체 줄 목록(아래 디스플레이 분기에서 참조).
    try:
        _all_rd_lines = [ln for _b in rd.get("blocks", [])
                         if _b.get("type") == 0 for ln in _b.get("lines", [])]
    except Exception:
        _all_rd_lines = []
    for bi, blk in enumerate(rd.get("blocks", [])):
        if blk.get("type") != 0:
            continue
        blines = blk.get("lines", [])
        # 8.20: 블록 일부를 수식으로 잘라내지 않는다. 각 줄을 아래에서
        # "줄 전체 LaTeX" 또는 "줄 전체 텍스트" 중 하나로만 결정한다.
        for ln in blines:
            # 10.4 · 표 안 글자는 칸 텍스트로 옮겨지므로 줄 경로에서는 뺀다
            if (ln.get("dir") or (1, 0))[0] < .98:
                continue
            if _pdf_contained(ln.get("bbox") or [0, 0, 0, 0], avoid, tolerance=0):
                continue
            # 9.3 · 큰 수식 밴드에 이미 들어간 줄은 건너뛴다.
            # (같은 글자가 LaTeX 와 텍스트 두 겹으로 나오는 것을 막는다)
            if _in_big(ln.get("bbox")):
                continue
            _sanitize_line_glyphs(ln, _gt)   # 10.1 · 확장글꼴 글자 정리
            # 독립 수식으로 확실한 줄만 줄 전체를 LaTeX로 보존한다.
            # 14.48 · 산문 행의 조각(위 _line_row_prose)은 독립 수식이 아니다.
            if (not _pdf_intersects(ln.get("bbox", (0, 0, 0, 0)), (avoid or []) + (math_avoid or []))
                    and _is_display_formula_line(ln)
                    and not _line_row_prose.get(id(ln), False)
                    and not ln.get("_swallowed")):
                try:
                    # 9.0 · 줄 bbox 를 통째로 쓰지 않는다. 식 번호 '(3)' 을 떼고
                    #       식 본체 영역만 LaTeX 로 잡아야 폭이 부풀지 않아
                    #       옆·아래 글자와 겹치지 않는다.
                    reg = _display_region_of_line(ln, page, _gt, _rules,
                                                   _pg_vlines)
                    if reg:
                        x0, y0, x1, y1, mtext, msz = reg
                    else:
                        x0, y0, x1, y1 = ln.get("bbox", [0, 0, 0, 0])
                        ls=[float(s.get("size") or 10) for s in ln.get("spans",[]) if _span_text(s).strip()]
                        mtext="".join(_span_text(s) for s in ln.get("spans", [])).strip()
                        msz=sorted(ls)[len(ls)//2] if ls else 10
                    # 14.48 · 슈퍼라인: 디스플레이 줄이 MuPDF 에게 여러
                    # '줄'로 쪼개지면(분수 층·키 큰 괄호·글꼴 바뀜) 조각들을
                    # 합쳐 한 식으로 복원한다. 그냥 두면 식이 잘려
                    # "y' = 4/5" + 흩어진 글자(p37), ") − 1 = …" + "x'' = (…"
                    # (p28), ") = (7+24m" 따로(p12), "det X = …" 머리 증발(p8)이
                    # 됐다. 같은 베이스라인 + 가로로 겹치거나 맞닿은(≤2pt)
                    # 조각만 합치고, 산문·밴드 줄은 건드리지 않는다.
                    # 합친 영역이 정상(sane)이 아니면 원래대로 둔다.
                    try:
                        _ux0, _uy0, _ux1, _uy1 = x0, y0, x1, y1
                        _ucy = (y0 + y1) / 2.0
                        _swallow = []
                        for _pass in range(10):
                            _grew = False
                            for _ln2 in _all_rd_lines:
                                if _ln2 is ln or _ln2.get("_swallowed") \
                                        or _ln2.get("_math_cut"):
                                    continue
                                _bb2 = _ln2.get("bbox")
                                if not _bb2:
                                    continue
                                _c2 = (_bb2[1] + _bb2[3]) / 2.0
                                if abs(_c2 - _ucy) > 5.0:
                                    continue
                                if min(_bb2[3], _uy1) - max(_bb2[1], _uy0) <= 0:
                                    continue
                                _gap2 = max(0.0, max(_bb2[0] - _ux1,
                                                     _ux0 - _bb2[2]))
                                # 14.71 · 디스플레이 토큰 사이 공백은 2~3pt
                                # 벌어진다(L^{3/2}_n + n^{-1/2} 의 '+' 앞뒤).
                                # 2.0 이었을 때 같은 식이 두 조각으로 남았다
                                # (p94 I.346).
                                if _gap2 > 3.5:
                                    continue
                                if _in_big(_bb2):
                                    continue
                                if _line_row_prose.get(id(_ln2), False):
                                    continue
                                _t2 = "".join(_span_text(_sp)
                                              for _sp in _ln2.get("spans", []))
                                if not _t2.strip():
                                    continue
                                _ph2, _nm2 = _span_prose_words(
                                    _ln2.get("spans", []))
                                if _ph2 or _nm2:
                                    continue
                                _swallow.append(_ln2)
                                _ux0 = min(_ux0, _bb2[0]); _uy0 = min(_uy0, _bb2[1])
                                _ux1 = max(_ux1, _bb2[2]); _uy1 = max(_uy1, _bb2[3])
                                _grew = True
                            if not _grew:
                                break
                        if _swallow and (_ux1 - _ux0) <= 600.0:
                            _tex2 = region_to_latex(page.parent, page,
                                                    (_ux0, _uy0, _ux1, _uy1),
                                                    _gt, _rules, _pg_vlines)
                            if (_tex2 and len(_tex2) <= 1200
                                    and _latex_is_sane(_tex2)
                                    and not _tex_is_figure_junk(_tex2)
                                    and not _touches_prose((_ux0, _uy0, _ux1, _uy1))
                                    and not _cuts_big_band((_ux0, _uy0, _ux1, _uy1))):
                                x0, y0, x1, y1, mtext = _ux0, _uy0, _ux1, _uy1, _tex2
                                for _ln2 in _swallow:
                                    _ln2["_swallowed"] = True
                    except Exception:
                        pass
                    if (x1 > x0 and y1 > y0 and mtext and not _tex_is_figure_junk(mtext)
                            and not _touches_prose((x0, y0, x1, y1))
                            and not _cuts_big_band((x0, y0, x1, y1))
                            # 14.70 · 막대 하나짜리 조각(\Biggr\|_{op})은
                            # LaTeX 상자로 내보내면 홀로 선 막대가 된다.
                            and not re.fullmatch(
                                r"\\[Bb]ig{1,2}r(?:\\\||\|)(?:\s*_\{[^{}]{1,12}\})?",
                                (mtext or "").strip())):
                        math_regions.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1,
                                             "display": True, "text": mtext, "size": msz})
                        # 식 번호는 아래 일반 텍스트 경로가 알아서 상자로 만든다.
                        # (수식 영역 밖이므로 제거되지 않는다)
                        ln["_math_cut"] = (x0, y0, x1, y1)
                except Exception:
                    pass
            # LaTeX로 확정되지 않은 줄은 수식 글꼴이 섞여 있어도 전부 텍스트로 남긴다.
            chars = []
            fcount = {}
            # 9.0 · 이 줄에서 수식 본체를 이미 떼어냈으면 남은 글자(식 번호 등)는
            #       단어 단위로 정밀 redact 해야 배경에 잔상이 안 남는다.
            ln_has_math = [bool(ln.get("_math_cut"))]
            pending_space = False
            for sp in ln.get("spans", []):
                if sp.get("alpha", 255) == 0:
                    continue  # invisible OCR is not another visible text layer
                size = sp.get("size") or 10
                fname = (sp.get("font") or "").lower()
                if preserve_math_glyphs and any(f in fname for f in MATH_FONTS):
                    # A math-only font has a different encoding/shape from a
                    # browser text font. If not reconstructed above, leave its
                    # ORIGINAL glyph paths on the background; do not invent a
                    # replacement symbol or rasterize neighbouring prose.
                    pending_space = True
                    continue
                flags = sp.get("flags", 0)
                bold = bool(flags & 16) or "bold" in fname
                ital = bool(flags & 2) or "italic" in fname or "oblique" in fname
                col = sp.get("color", 0)
                for ch in sp.get("chars", []):
                    c = ch.get("c") or ""
                    bb = ch.get("bbox")
                    if not c.strip() or not bb:
                        pending_space = pending_space or bool(c and c.isspace())
                        continue
                    if _pdf_contained(bb, avoid, tolerance=0):
                        pending_space = True
                        continue
                    if _duplicate_char(c, bb, fname, flags, col):
                        continue
                    chars.append({
                        "c": c, "b": bb,
                        "o": ch.get("origin") or (bb[0], bb[3]),
                        "sz": size, "bold": bold, "ital": ital, "col": col,
                        "font": sp.get("font", ""), "flags": flags, "break": pending_space,
                    })
                    pending_space = False
                    fcount[fname] = fcount.get(fname, 0) + 1
            if not chars:
                continue
            oys = sorted(ch["o"][1] for ch in chars)
            base_y = oys[len(oys) // 2]          # 이 줄의 베이스라인

            # 띄어쓰기(간격) 기준으로 자른다
            words, cur, prev = [], [], None
            for ch in chars:
                if prev is not None:
                    gap = ch["b"][0] - prev["b"][2]
                    thr = max(prev["sz"], ch["sz"]) * WORD_GAP_RATIO
                    dy = abs(ch["o"][1] - prev["o"][1])
                    if ch.get("break") or gap > thr or dy > ch["sz"] * SUP_SUB_DY:
                        if cur:
                            words.append(cur)
                        cur = []
                cur.append(ch)
                prev = ch
            if cur:
                words.append(cur)

            lw = []
            for wd in words:
                x0 = min(ch["b"][0] for ch in wd); y0 = min(ch["b"][1] for ch in wd)
                x1 = max(ch["b"][2] for ch in wd); y1 = max(ch["b"][3] for ch in wd)
                # 위/아래 첨자를 뺀 기준 글자 크기
                bases = [ch["sz"] for ch in wd
                         if abs(ch["o"][1] - base_y) <= max(ch["sz"] * 0.25, 1)]
                size = sum(bases) / len(bases) if bases else wd[0]["sz"]
                lw.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1,
                           "size": size, "chars": wd})
            has_math = ln_has_math[0]
            if lw:
                lines.append({
                    "x0": min(w["x0"] for w in lw), "y0": min(w["y0"] for w in lw),
                    "x1": max(w["x1"] for w in lw), "y1": max(w["y1"] for w in lw),
                    "base": base_y, "words": lw, "blk": bi, "has_math": has_math,
                    "font": max(fcount, key=fcount.get) if fcount else "",
                })
    # 인접한 인라인 수식 영역을 병합 (한 수식이 여러 span 으로 쪼개진 경우)
    math_regions = _merge_math_regions(math_regions)
    math_regions = _drop_contained_math(math_regions)
    # 9.0 · 식에서 떨어져 나온 위/아래첨자 조각을 되찾아 온다.
    _absorb_orphan_scripts(lines, math_regions)
    lines = [ln for ln in lines if ln["words"]]
    for ln in lines:
        ln["x0"] = min(w["x0"] for w in ln["words"]); ln["y0"] = min(w["y0"] for w in ln["words"])
        ln["x1"] = max(w["x1"] for w in ln["words"]); ln["y1"] = max(w["y1"] for w in ln["words"])
    return lines, math_regions


def _tex_is_figure_junk(tex):
    """그림 라벨·underbrace 조각·엉켜든 글자가 '수식 밴드'로 오인된 결과인지."""
    try:
        raw = tex or ""
        # 14.46 · 행렬은 글자 하나가 한 칸이라 '두 줄이 엉킨 그림 라벨' 판정과
        #   그대로 겹친다. 2×2 짜리 \begin{bmatrix} a & b \\ c & d \end{bmatrix}
        #   는 '관계식 없음 + 낱글자' 로 걸려 밴드가 통째로 버려졌다.
        #   행·열 환경이 있으면 그림이 아니라 수식이다.
        if _MAT_ENV_RE.search(raw):
            return False
        # 14.48 · '기호 하나 + 숫자 하나'(θ 1)는 그림 라벨이다. 삼각형
        #   도형의 각 라벨 θ 와 변 라벨 1 이 한 밴드로 묶여 가짜 분수
        #   (θ/1)가 됐다가, 분수선 차단 뒤엔 'θ 1' 수식으로 남았다(p21).
        #   진짜 디스플레이 수식이 이렇게 짧을 수 없고, 텍스트로 두면
        #   글자가 제자리에 보존된다.
        if re.fullmatch(r"\\[a-zA-Z]+\s+[0-9]{1,3}", (raw or "").strip()):
            return True
        if re.fullmatch(r"[0-9]{1,3}\s+\\[a-zA-Z]+", (raw or "").strip()):
            return True
        # 14.48 · 낱토큰 분수(한쪽이 그리스문자)는 그림 라벨이다. 삼각형
        #   밑변(고립 가로선!)이 θ(위)+1(아래)과 만나 진짜 같은 가짜
        #   \frac{\theta}{1} 을 만들었다(p21). 분자·분모가 둘 다
        #   낱토큰(명령어 하나/글자 하나)이고 한쪽이 그리스문자면
        #   라벨이다 — 진짜 디스플레이 분수는 식이 딸려 통째로
        #   낱글자인 일이 없다. 텍스트로 두면 글자·밑변이 보존된다.
        _fm = re.fullmatch(r"\\frac\{([^{}]*)\}\{([^{}]*)\}",
                            (raw or "").strip())
        if _fm:
            _gs = [_g.strip() for _g in _fm.groups()]
            if all(re.fullmatch(r"\\[a-zA-Z]+|[0-9A-Za-z]", _g)
                   for _g in _gs) and any(
                       _g in _GREEK_FRAC_CMDS for _g in _gs):
                return True
        # \left. / \right. 의 베어 점은 도트 지도자(목차 점선)가 아니다
        raw = re.sub(r"\\(?:left|right)\s*\.", " ", raw)
        t = re.sub(r"\\[a-zA-Z]+", " ", raw)
        toks = [x for x in t.split() if x]
        if not toks:
            return True
        # 도트 지도자: 마침표/가운뎃점만 센다 (쉼표·마이너스는 수식에 흔하다)
        dots = sum(1 for x in toks if set(x) <= {".", "\u00b7"})
        if dots >= 3:
            return True
        # 관계식/연산자/첨자가 있어야 수식이다 ('|','⟨' 같은 기호만으론 부족)
        has_rel = bool(re.search(r"[=<>\u2264\u2265\u2248\u00b1\u00d7\u00f7\u2211\u222b\u220f\u221a^_\\]", raw))
        alnum = sum(len(x) for x in toks if any(ch.isalnum() for ch in x))
        singles = sum(1 for x in toks if len(x) == 1)
        digits = any(ch.isdigit() for ch in raw)
        if not has_rel:
            # 단어 1~2개짜리 그림 라벨('Interposer','MC')도 버린다
            if alnum < 4 or singles / len(toks) > 0.55 or len(toks) <= 2:
                return True
        else:
            # \frac 이 있어도: 관계식 없고 숫자 없고 낱글자 비율 높으면
            # 두 줄이 엉켜 들어간 쓰레기('Cond. o P n re ly…')다
            has_eq = bool(re.search(r"[=<>\u2264\u2265\u2248]", raw)) or digits
            if not has_eq and toks and singles / len(toks) > 0.6:
                return True
        return False
    except Exception:
        return False


_EXT_UNICODE = {
"(": "(", ")": ")", "[": "[", "]": "]", r"\{": "{", r"\}": "}",
r"\langle": "⟨", r"\rangle": "⟩", r"\lfloor": "⌊", r"\rfloor": "⌋",
r"\lceil": "⌈", r"\rceil": "⌉",
r"\int": "∫", r"\sum": "∑", r"\prod": "∏", r"\oint": "∮",
r"\bigcup": "⋃", r"\bigcap": "⋂", r"\coprod": "∐",
  r"\bigotimes": "⊗", r"\bigoplus": "⊕",
  r"\sqrt": "√", r"\hat": "ˆ", r"\widetilde": "˜", r"\bar": "¯",
  r"\acute": "´", r"\grave": "`", r"\breve": "˘", r"\check": "ˇ",
  r"\ddot": "¨", r"\mathring": "˚", r"\dot": "˙", "|": "|", r"\|": "‖",
}


def _sanitize_line_glyphs(ln, gtables):
    """10.1 · 확장글꼴(txex 등) 글자를 읽을 수 있는 기호로 바꾼다.

    줄(텍스트) 경로로 나가는 수식에서 'R','X','\x10', U+F8F1 같은
    글자몰漁垃圾 대신 ∫·∑·√·( 같은 진짜 기호가 보이게 한다.
    매핑에 실패한 조각(PUA/제어문자)은 지운다 — 깨진 글자로 남는 것보다 낫다.
    """
    try:
        for sp in ln.get("spans", []):
            fname = sp.get("font") or ""
            short = fname.split("+")[-1].upper()
            sym = _is_symbol_font(fname)
            if not (sym or "CMEX" in short or "TXEX" in short or "EXTRA" in short
                    or "LMEX" in short or "MSAM" in short or "MSBM" in short):
                continue
            table = {} if sym else (gtables.get(sp.get("font")) or gtables.get(
                (sp.get("font") or "").split("+")[-1]) or {})
            for ch in (sp.get("chars") or []):
                c = ch.get("c") or ""
                if not c:
                    continue
                if sym:
                    # 14.47 · 낱기호는 유니코드로, 조각은 위 토막만
                    # 구분자 한 글자로(아래 토막까지 살리면 괄호가 두 겹 된다).
                    dec = _symbol_pua_lookup(ord(c))
                    if dec is None:
                        ch["c"] = ""
                    elif isinstance(dec, tuple):
                        _side, _kind, _pos = dec[1], dec[2], dec[3]
                        ch["c"] = (_PIECE_TEXT.get((_side, _kind), "")
                                   if _pos == "tp" else "")
                    elif dec is not False:
                        ch["c"] = dec
                    continue
                gname = table.get(ord(c)) if c else None
                if not gname:
                    gname = _CMEX_STD.get(ord(c))
                if 0xE000 <= ord(c) <= 0xF8FF or ord(c) < 0x20:
                    role, tex = classify_glyph(gname)
                    ch["c"] = _EXT_UNICODE.get(tex, "") if tex else ""
                    continue
                role, tex = classify_glyph(gname)
                if tex is None:
                    continue
                ch["c"] = _EXT_UNICODE.get(tex, "")
    except Exception:
        pass





def _absorb_orphan_scripts(lines, math_regions):
    """수식 바로 옆에 홀로 남은 위/아래첨자 조각을 수식 안으로 흡수한다. (9.0)

    PDF 는 지수 'E = mc²' 의 ² 를 베이스라인이 다르다는 이유로 별개의 줄로
    떼어 놓는 경우가 많다. 그러면 식은 'E = mc' 로 잘리고 ² 만 덩그러니
    글상자로 남아, 수식 옆에 숫자가 떠다니는 것처럼 보였다.
    식 오른쪽에 딱 붙은 작은 조각만(인용 번호·식 번호는 제외) 되찾아 온다.
    """
    if not math_regions or not lines:
        return
    for r in math_regions:
        # 9.3 · 큰 수식은 첨자까지 이미 제자리에 복원돼 있다. 더 흡수하면
        #       식 뒤의 글자를 지수로 잘못 빨아들인다.
        if r.get("big"):
            continue
        rh = max(1.0, r["y1"] - r["y0"])
        rsz = float(r.get("size") or 10)
        rcy = (r["y0"] + r["y1"]) / 2
        again = True
        while again:
            again = False
            for ln in lines:
                for wd in list(ln["words"]):
                    txt = "".join(ch["c"] for ch in wd["chars"]).strip()
                    if not txt or len(txt) > 4:
                        continue
                    # [12]·(1) 같은 괄호 번호는 어떤 경우에도 흡수하지 않는다
                    if _CITE_BRACKET.match(txt):
                        continue
                    # 맨숫자 위첨자는 본문에서는 인용 번호다. 다만 '독립 수식(display)'
                    # 줄의 식 끝에 붙은 것은 인용이 아니라 지수(mc²)다.
                    if not r.get("display") and _is_citation_token(txt, superscript=True):
                        continue
                    # 14.48 · 산문 단어는 흡수하지 않는다. 키 큰 식(괄호)은
                    # 허용 간격이 넓어져(rh*0.62) 옆줄 산문까지 지수로
                    # 빨아들였다 — '(x′,y′)−…' 식이 '^{For}^{each}…' 를
                    # 달고 산문 쪽엔 구멍이 났다(p14).
                    _tw = re.sub(r"[^A-Za-z]", "", txt)
                    if _tw.lower() in _COMMON_PROSE or (len(_tw) >= 3 and not _is_math_identifier(_tw)):
                        continue
                    if not re.fullmatch(r"[0-9A-Za-zα-ωΑ-Ω+\-*/=,.]{1,4}", txt):
                        continue
                    # 첨자 크기여야 한다 (본문 글자는 건드리지 않음)
                    if wd["size"] >= rsz * 0.92:
                        continue
                    gap = wd["x0"] - r["x1"]
                    if not (-1.0 <= gap <= max(2.5, rh * 0.62)):
                        continue
                    cy = (wd["y0"] + wd["y1"]) / 2
                    # 14.71 · 세로 창을 0.6×rh 에서 0.2×rh 로 좁히고, 단어가
                    # 영역 y 범위와 30% 이상 겹쳐야 한다. 넓던 창이 다음 본문
                    # 줄의 인라인 첨자(A_{n-1} 의 '1' · W G^{1/2} 의 '1/2')까지
                    # 흡수해 `,_{1}` · `._{1 2}` 꼬리가 붙었다(11930 p14·p87).
                    _win = max(2.0, rh * 0.2)
                    _ov_w = (min(wd["y1"], r["y1"])
                             - max(wd["y0"], r["y0"]))
                    if not (r["y0"] - _win <= cy <= r["y1"] + _win
                            and _ov_w >= 0.3 * max(1.0, wd["y1"] - wd["y0"])):
                        continue
                    r["x1"] = max(r["x1"], wd["x1"])
                    r["y0"] = min(r["y0"], wd["y0"]); r["y1"] = max(r["y1"], wd["y1"])
                    r["text"] = (r.get("text") or "") + \
                        (("^{" + txt + "}") if cy < rcy else ("_{" + txt + "}"))
                    ln["words"].remove(wd)
                    again = True
                    break
                if again:
                    break


def _merge_math_regions(regions):
    """같은 줄에 붙어 있는 수식 조각들을 하나의 영역으로 합친다.

    인테그랄·분수처럼 여러 span(글꼴)이 이어붙어 하나의 수식을 이루는 경우
    조각조각 잘리지 않도록, 세로가 겹치고 가로가 인접한 것들을 병합한다.
    """
    if not regions:
        return []
    regs = sorted(regions, key=lambda r: (r["y0"], r["x0"]))
    merged = []
    for r in regs:
        if not merged:
            merged.append(dict(r))
            continue
        m = merged[-1]
        # 위첨자·아래첨자는 세로로 어긋난 span이므로 단순 overlap 대신
        # 중심 거리까지 본다. 인접 조각을 통째 수식 하나로 보존한다.
        v_overlap = min(m["y1"], r["y1"]) - max(m["y0"], r["y0"])
        h_gap = r["x0"] - m["x1"]
        mh = max(1.0, m["y1"] - m["y0"])
        rh = max(1.0, r["y1"] - r["y0"])
        v_close = abs((m["y0"] + m["y1"]) / 2 - (r["y0"] + r["y1"]) / 2) <= max(mh, rh) * 1.15
        # 수식 조각 사이의 실제 조판 간격만 합친다. 허용 폭이 글자 높이보다
        # 크던 예전 값은 식 뒤의 짧은 단어까지 한 이미지로 합칠 수 있었다.
        join_gap = max(2.2, max(mh, rh) * 0.68)
        if (v_overlap > -min(mh, rh) * 0.35 or v_close) and h_gap <= join_gap \
           and not m["display"] and not r["display"] \
           and not m.get("big") and not r.get("big"):
            m["x1"] = max(m["x1"], r["x1"])
            m["y0"] = min(m["y0"], r["y0"])
            m["y1"] = max(m["y1"], r["y1"])
            m["text"] = ((m.get("text") or "") + " " + (r.get("text") or "")).strip()
            m["size"] = max(float(m.get("size") or 0),float(r.get("size") or 0)) or 10
        else:
            merged.append(dict(r))

    # ── 9.0 · 수식끼리 겹치지 않게 마무리 ──────────────────────
    # 인라인 수식 두 개가 살짝 포개지면 KaTeX 상자 두 장이 겹쳐 글자가
    # 두 겹으로 보였다. 서로 크게 겹치면 하나로 합치고, 살짝 스치면
    # 경계를 가운데에서 잘라 절대 포개지지 않게 만든다.
    merged.sort(key=lambda r: (round(r["y0"], 1), r["x0"]))
    out = []
    for r in merged:
        if out:
            p = out[-1]
            ox = min(p["x1"], r["x1"]) - max(p["x0"], r["x0"])
            oy = min(p["y1"], r["y1"]) - max(p["y0"], r["y0"])
            if ox > 0 and oy > 0:
                ra = max(1e-6, (r["x1"] - r["x0"]) * (r["y1"] - r["y0"]))
                pa = max(1e-6, (p["x1"] - p["x0"]) * (p["y1"] - p["y0"]))
                if p.get("big") or r.get("big"):
                    # 9.3 · 큰 수식은 이미 완성된 하나의 식이다. 다른 조각과
                    #       합치거나 경계를 자르면 LaTeX 가 깨진다.
                    if (ox * oy) / min(ra, pa) > 0.5:
                        keep = p if p.get("big") else r
                        drop = r if keep is p else p
                        if keep is r:
                            out[-1] = r
                        continue
                    out.append(r)
                    continue
                if (ox * oy) / min(ra, pa) > 0.5:       # 사실상 같은 식 → 합친다
                    p["x0"] = min(p["x0"], r["x0"]); p["y0"] = min(p["y0"], r["y0"])
                    p["x1"] = max(p["x1"], r["x1"]); p["y1"] = max(p["y1"], r["y1"])
                    p["text"] = ((p.get("text") or "") + " " + (r.get("text") or "")).strip()
                    p["display"] = bool(p.get("display") or r.get("display"))
                    continue
                if p["x1"] > r["x0"]:                    # 가로로 살짝 겹침 → 반씩 양보
                    cut = (p["x1"] + r["x0"]) / 2.0
                    p["x1"] = min(p["x1"], cut); r = dict(r); r["x0"] = max(r["x0"], cut)
                    if r["x1"] - r["x0"] < 0.5:
                        continue
        out.append(r)
    return out


_SUP_MAP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾", "0123456789+-=()")
_SUB_MAP = str.maketrans("₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎", "0123456789+-=()")
_LATEX_SYMBOLS = {
    "∞": r"\infty", "∂": r"\partial", "∇": r"\nabla", "∆": r"\Delta",
    "∫": r"\int", "∮": r"\oint", "∑": r"\sum", "∏": r"\prod",
    "√": r"\sqrt", "≈": r"\approx", "≃": r"\simeq", "≅": r"\cong",
    "≠": r"\ne", "≤": r"\le", "≥": r"\ge", "±": r"\pm", "∓": r"\mp",
    "×": r"\times", "÷": r"\div", "·": r"\cdot", "⋅": r"\cdot", "∝": r"\propto",
    "∈": r"\in", "∉": r"\notin", "⊂": r"\subset", "⊃": r"\supset",
    "∪": r"\cup", "∩": r"\cap", "→": r"\to", "←": r"\leftarrow",
    "↔": r"\leftrightarrow", "↦": r"\mapsto", "⇒": r"\Rightarrow", "⇔": r"\Leftrightarrow",
    "∀": r"\forall", "∃": r"\exists", "∥": r"\|", "⊥": r"\perp",
    "⪰": r"\succeq", "⪯": r"\preceq", "≽": r"\succeq", "≼": r"\preceq",
    "≻": r"\succ", "≺": r"\prec", "⊑": r"\sqsubseteq", "⊒": r"\sqsupseteq",
    "ℏ": r"\hbar", "ℓ": r"\ell", "ℝ": r"\mathbb{R}", "ℂ": r"\mathbb{C}",
    "ℤ": r"\mathbb{Z}", "ℕ": r"\mathbb{N}", "ℚ": r"\mathbb{Q}",
    "ℜ": r"\Re", "ℑ": r"\Im", "∼": r"\sim", "∘": r"\circ",
    "ˆ": r"\hat", "˜": r"\widetilde", "~": r"\widetilde", "¯": r"\bar",
    "ˉ": r"\bar", "´": r"\acute", "`": r"\grave", "˘": r"\breve",
    "ˇ": r"\check", "˙": r"\dot", "¨": r"\ddot", "˚": r"\mathring",
    "◦": r"\circ", "□": r"\square",
    # 14.46 · 행렬 줄임표 (인라인 수식 경로도 같은 기호를 쓴다)
    "⋯": r"\cdots", "⋮": r"\vdots", "⋱": r"\ddots",
    # 14.47 · Symbol PUA 디코딩으로 들어오는 낱기호들 (_SYM 과 같은 값)
    "°": r"\degree", "•": r"\bullet", "⁄": "/", "€": r"\text{€}",
    "ϒ": r"\Upsilon", "″": "''", "ℵ": r"\aleph",
    "℘": r"\wp", "∅": r"\emptyset", "⊇": r"\supseteq", "⊄": r"\not\subset",
    "⊆": r"\subseteq", "∠": r"\angle", "®": r"\text{®}", "©": r"\text{©}",
    "™": r"\text{™}", "¬": r"\neg", "⇐": r"\Leftarrow", "⇑": r"\Uparrow",
    "⇓": r"\Downarrow", "◊": r"\diamond", "↑": r"\uparrow", "↓": r"\downarrow",
    "♣": r"\clubsuit", "♦": r"\diamondsuit", "♥": r"\heartsuit",
    "♠": r"\spadesuit", "ƒ": r"\text{ƒ}", "⏎": r"\text{⏎}",
    "∗": r"\ast", "∴": r"\therefore", "∋": r"\ni",
    # 14.70 · 줄 단위(인라인) 수식 경로에서도 같은 기호가 새지 않게 (_SYM 과 동일).
    "†": r"\dagger", "‡": r"\ddagger",
    "⊤": r"\top", "⊢": r"\vdash", "⊣": r"\dashv", "⊨": r"\models",
    "⌊": r"\lfloor", "⌋": r"\rfloor", "⌈": r"\lceil", "⌉": r"\rceil",
    "⟶": r"\longrightarrow", "⟵": r"\longleftarrow",
    "⟷": r"\longleftrightarrow", "⟹": r"\Longrightarrow",
    "⟸": r"\Longleftarrow", "⟺": r"\Longleftrightarrow",
    "⟼": r"\longmapsto",
    "⇄": r"\rightleftarrows", "⇌": r"\rightleftharpoons",
    "⇋": r"\leftrightharpoons", "⇉": r"\rightrightarrows",
    "⇇": r"\leftleftarrows",
    "↘": r"\searrow", "↗": r"\nearrow", "↙": r"\swarrow", "↖": r"\nwarrow",
    "⊗": r"\otimes", "⊕": r"\oplus", "∧": r"\wedge", "∨": r"\vee",
    "⟨": r"\langle", "⟩": r"\rangle",
    "∗": r"\ast",
}
_LATEX_GREEK = {
    # 같은 모양 다른 코드포인트도 함께 (µ MICRO SIGN, Ω OHM SIGN, ∆ INCREMENT)
    "\u00b5":"mu", "\u2126":"Omega", "\u2206":"Delta", "\u03d5":"phi", "\u03f5":"epsilon",
    # 14.70 · var 계열 글리프가 낱자로 들어올 때 새지 않게
    "\u03d1":"vartheta", "\u03d6":"varpi", "\u03f1":"varrho", "\u03f0":"varkappa", "\u03c2":"varsigma",
    "α":"alpha","β":"beta","γ":"gamma","δ":"delta","ε":"epsilon","ζ":"zeta",
    "η":"eta","θ":"theta","ι":"iota","κ":"kappa","λ":"lambda","μ":"mu","ν":"nu",
    "ξ":"xi","ο":"omicron","π":"pi","ρ":"rho","σ":"sigma","τ":"tau","υ":"upsilon",
    "φ":"phi","χ":"chi","ψ":"psi","ω":"omega","Γ":"Gamma","Δ":"Delta","Θ":"Theta",
    "Λ":"Lambda","Ξ":"Xi","Π":"Pi","Σ":"Sigma","Φ":"Phi","Ψ":"Psi","Ω":"Omega",
}


def _pdf_text_to_latex(text):
    """PDF에서 얻은 유니코드 수식을 KaTeX가 읽을 수 있는 LaTeX로 정리."""
    t = (text or "").replace("\u00a0", " ").replace("−", "-")
    t = re.sub(r"[\u200b-\u200f\u2060\ufeff]", "", t).strip()
    already = bool(re.search(r"\\(frac|left|right|begin|int|sum|sqrt|cases)", t))
    # 유니코드 위/아래첨자를 연속 묶음으로 변환
    t = re.sub(r"[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾]+", lambda m: "^{" + m.group().translate(_SUP_MAP) + "}", t)
    t = re.sub(r"[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+", lambda m: "_{" + m.group().translate(_SUB_MAP) + "}", t)
    for ch, name in _LATEX_GREEK.items():
        t = t.replace(ch, "\\" + name + " ")
    for ch, val in _LATEX_SYMBOLS.items():
        t = t.replace(ch, val + " ")
    t = t.replace("⟨", r"\langle ").replace("⟩", r"\rangle ")
    # 14.3 · 이미 조립된 cases 의 & 는 열 구분 문자이므로 이스케이프하지 않는다.
    if already:
        t = re.sub(r"(?<!\\)([%#])", r"\\\1", t)
    else:
        t = re.sub(r"(?<!\\)([%#&])", r"\\\1", t)
    if len(t)>1 and t.startswith("$") and t.endswith("$"): t=t[1:-1]
    t = re.sub(r"\s+", " ", t).strip()
    # 9.3 · 유니코드 첨자가 연달아 나오면 x^{a}^{b} 가 되어 KaTeX 가
    #       '이중 위첨자' 오류를 낸다(∫Ldt = 4.8 fb^-1 처럼). 하나로 합친다.
    return _tidy_latex(t)

def _mark_justify(lines, page_w):
    """양쪽 정렬(justify) 줄 판별 — 페이지·칼럼·문단 단위.

    PyMuPDF 가 문단을 줄별로 잘게 쪼개도 동작하도록 블록이 아닌
    페이지 전체의 칼럼(왼쪽/오른쪽/꽉찬) 기준으로 오른쪽 도달을 본다.
    문단 마지막 줄(다음 줄 들여쓰기/큰 세로 간격/없음)은 제외.
    """
    if not lines:
        return
    mid = page_w / 2.0
    cols = {"L": [], "R": [], "F": []}
    for ln in lines:
        cx = (ln["x0"] + ln["x1"]) / 2.0
        if ln["x1"] - ln["x0"] > page_w * 0.6:
            cols["F"].append(ln)
        elif cx < mid:
            cols["L"].append(ln)
        else:
            cols["R"].append(ln)
    all_sz = [w["size"] for ln in lines for w in ln["words"]]
    avg_sz = (sum(all_sz) / len(all_sz)) if all_sz else 10.0
    for col in cols.values():
        if len(col) < 2:
            continue
        col.sort(key=lambda l: l["y0"])
        c0 = min(l["x0"] for l in col)
        c1 = max(l["x1"] for l in col)
        cw = max(1e-6, c1 - c0)
        for i, ln in enumerate(col):
            reach = (ln["x1"] - c0) >= cw * 0.97
            nxt = col[i + 1] if i + 1 < len(col) else None
            if nxt is None:
                last = True
            else:
                gap_v = nxt["y0"] - ln["y1"]
                indent = (nxt["x0"] - c0) > max(2.0, avg_sz * 0.8)
                last = indent or gap_v > avg_sz * 0.9
            ln["just"] = bool(reach and not last)
            ln["j_right"] = c1


def _font_map(name, flags=0):
    return _pdf_font_map(name, flags)


def _line_aligns(lines, page_w):
    """줄 정렬 판별 — 논문 2단 레이아웃 대응.

    왼쪽/오른쪽 기둥(칼럼)을 나눠 각 칼럼 안에서 여백을 계산해야
    2단 논문의 가운데/오른쪽 정렬이 엉뚱하게 잡히지 않는다.
    """
    if not lines:
        return
    mid = page_w / 2.0
    groups = {}
    for ln in lines:
        cx = (ln["x0"] + ln["x1"]) / 2.0
        lw = ln["x1"] - ln["x0"]
        if lw > page_w * 0.6:
            g = "full"
        elif cx < mid:
            g = "L"
        else:
            g = "R"
        groups.setdefault(g, []).append(ln)
    for gl in groups.values():
        cx0 = min(l["x0"] for l in gl)
        cx1 = max(l["x1"] for l in gl)
        cw = max(1e-6, cx1 - cx0)
        tol = max(6.0, cw * 0.035)
        for ln in gl:
            lw = ln["x1"] - ln["x0"]
            lg = ln["x0"] - cx0
            rg = cx1 - ln["x1"]
            if lw >= cw * 0.92:
                ln["align"] = "left"          # 꽉 찬 줄
                continue
            mid_c = abs(lg - rg) <= max(4.0, cw * 0.05)
            mid_p = abs(ln["x0"] - (page_w - ln["x1"])) <= max(6.0, page_w * 0.035)
            if (mid_c or mid_p) and lw < page_w * 0.85:
                ln["align"] = "center"
            else:
                # 10.4 · '오른쪽 정렬' 표시는 내보내지 않는다.
                #   가져온 글자는 절대좌표로 배치되는데, 정렬 표시가 남으면
                #   편집할 때 글이 오른쪽으로 붙어 어색해진다.
                ln["align"] = "left"


def _word_html(wd, base_sz, base_y):
    """단어 문자열 → HTML. 같은 스타일의 연속 문자는 태그 하나로 묶는다. (13.4 · 첨자 역치 정밀화)"""
    groups = []
    for ch in wd["chars"]:
        mode = ""
        c = ch.get("c", "")
        if not c:
            continue
        oy = ch["o"][1] if "o" in ch else base_y
        sz = ch.get("sz", base_sz)
        if base_sz > 0:
            if sz < base_sz * 0.88 or abs(oy - base_y) >= base_sz * 0.14:
                if oy < base_y - base_sz * 0.10:
                    mode = "sup"
                elif oy > base_y + base_sz * 0.10:
                    mode = "sub"
        key = (ch["bold"], ch["ital"], mode, ch["col"] or 0)
        if groups and groups[-1][0] == key:
            groups[-1][1] += c
        else:
            groups.append([key, c])
    out = []
    for (bold, ital, mode, col), t in groups:
        esc = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        if col:
            esc = f'<span style="color:#{col & 0xFFFFFF:06x}">{esc}</span>'
        if mode:
            esc = f"<{mode}>{esc}</{mode}>"
        if bold:
            esc = f"<b>{esc}</b>"
        if ital:
            esc = f"<i>{esc}</i>"
        out.append(esc)
    return "".join(out)



def detect_page_figures_and_tables(page, pw, ph):
    return detect_regions(page, pw, ph)


def _pdf_raster_rect(rect, page_rect, dpi):
    # get_pixmap rounds the clip outwards to device pixels. Use those SAME
    # bounds for element placement/ownership so the crop is not rescaled/shifted.
    import math
    z = dpi / 72
    r = pymupdf.Rect(rect) & page_rect
    return pymupdf.Rect(math.floor(r.x0*z)/z, math.floor(r.y0*z)/z,
                        math.ceil(r.x1*z)/z, math.ceil(r.y1*z)/z) & page_rect


def _pdf_save_png(pm):
    # Antialiased plots can have >700 colors; that does not make them photos.
    # Tables/line art must never pass through the old quality=62 JPEG heuristic.
    name = f"{uuid.uuid4().hex[:16]}.png"
    pm.save(os.path.join(IMG_DIR, name))
    return f"/api/import/img/{name}"


def _pdf_save_snapshot(page, rect):
    # Remove crossing glyphs ONLY when the text builder can paint them live.
    # Rotated/math-only glyphs remain native: the crop holds the inside part,
    # the background holds the outside part. Erasing them here would lose ink
    # under the background's crop mask, with no live text to replace it.
    crossing = []
    for block in _page_rawdict(page).get("blocks", []):
        for line in block.get("lines", []):
            if (line.get("dir") or (1, 0))[0] < .98:
                continue
            for span in line.get("spans", []):
                if span.get("alpha", 255) == 0 or any(f in span.get("font", "").lower() for f in MATH_FONTS):
                    continue
                for ch in span.get("chars", []):
                    bb = ch["bbox"]
                    if _pdf_intersects(bb, [rect]) and not _pdf_contained(bb, [rect], tolerance=0):
                        crossing.append([*ch["origin"], ch["c"]])
    if not crossing:
        return _pdf_save_png(page.get_pixmap(clip=rect, dpi=300, alpha=False))
    svg, _ = _pdf_filter_glyphs(page.get_svg_image(text_as_path=True), crossing)
    with pymupdf.open(stream=svg.encode(), filetype="svg") as cropped:
        return _pdf_save_png(cropped[0].get_pixmap(clip=rect, dpi=300, alpha=False))


def _pdf_save_background(doc, pno, plan, dpi, max_pixels, prefer_vector=True):
    """Subtract exactly the emitted glyphs, preserving ALL other original paths.

    The same immutable glyph/region plan is used for low/high resolution. This
    also keeps unsupported inline math in its exact source shape without baking
    an adjacent paragraph into a picture or erasing radicals via bbox redaction.
    """
    page = doc[pno]
    svg, remaining = _pdf_filter_glyphs(page.get_svg_image(text_as_path=True),
                                       plan.get("glyphs", []), plan.get("regions", []))
    if not remaining and not page.get_images() and not page.get_drawings():
        return None
    if prefer_vector and len(svg) < 6 * 1024 * 1024:
        url = _save_import_svg(svg)
        if url:
            return url
    area = page.rect.width * page.rect.height / 72**2
    dpi = min(dpi, max(72, int((max_pixels / max(area, 1e-6))**.5)))
    with pymupdf.open(stream=svg.encode(), filetype="svg") as bgdoc:
        return _pdf_save_png(bgdoc[0].get_pixmap(dpi=dpi, alpha=False))


def _store_pdf_bg_plans(pages, ref):
    """Plans are immutable server-side data, not thousands of DOM/sync fields."""
    import gzip
    for page in pages:
        plan = page.pop("pdfBg", None)
        if not plan:
            continue
        name = os.path.join(DOCS_DIR, f"{ref}.bg{int(plan['sourcePage'])}.gz")
        tmp = name + ".tmp"
        try:
            with gzip.open(tmp, "wt", encoding="utf-8") as fp:
                json.dump(plan, fp, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, name)
            for el in page["els"]:
                if el.get("pdfBg") == 2:
                    el["pdfRef"] = ref
        except OSError as e:
            # High-res upgrades are optional. Do not fail a good import because
            # the additional plan cannot be saved; retain its existing pixels.
            print(f"[import] background upgrade disabled: {e}")
            for el in page["els"]:
                el.pop("pdfBg", None)
            try:
                os.remove(tmp)
            except OSError:
                pass


def _pdf_fallback_page(doc, pno, target_w, target_h):
    """Last resort: one faithful original page, never a blank or doubled page."""
    page = doc[pno]
    scale = min(target_w / page.rect.width, target_h / page.rect.height)
    area = page.rect.width * page.rect.height / 72**2
    dpi = min(150, max(24, int((10_000_000 / max(area, 1e-6))**.5)))
    url = _pdf_save_png(page.get_pixmap(dpi=dpi, alpha=False))
    return {"id": _imp_uid("p"), "tables": [], "importMode": "snapshot-fallback",
            "els": [{"type": "image", "id": _imp_uid("i"), "url": url,
                     "x": round((target_w-page.rect.width*scale)/2, 3), "y": 0,
                     "w": round(page.rect.width*scale, 3), "h": round(page.rect.height*scale, 3),
                     "isBg": 1, "locked": True}]}


def _pdf_one_page(doc, pno, on_page_done, cache=None,
                  target_w=PAGE_W, target_h=PAGE_H):
    """1쪽 변환: 추출 → 글자 제거 → 배경 저장 → 단어 상자. (13.4 고정밀 피규어/표/수식 분리)"""
    try:
        page = doc[pno]
        if page.rotation:
            # Bake /Rotate into a private page. Text extraction and SVG origins
            # then share the same displayed coordinate system, without mutating
            # the source. Retain the original page identity for later upgrades.
            with pymupdf.open() as normalized:
                normalized.insert_pdf(doc, from_page=pno, to_page=pno)
                normalized[0].remove_rotation()
                out = _pdf_one_page(normalized, 0, None, target_w=target_w, target_h=target_h)
            if out.get("pdfBg"):
                out["pdfBg"]["sourcePage"] = pno
            for el in out["els"]:
                if el.get("pdfBg") == 2:
                    el["pdfPage"] = pno
            return out
        pw, ph = page.rect.width, page.rect.height
        if pw <= 0 or ph <= 0:
            return {"id": _imp_uid("p"), "els": [], "tables": []}
        sc = min(target_w / pw, target_h / ph)
        offx = (target_w - pw * sc) / 2

        def X(v):
            return _px(v * sc + offx)

        def Y(v):
            return _px(v * sc)

        fig_table_els = []
        figure_boxes, table_boxes, _ = detect_page_figures_and_tables(page, pw, ph)
        avoid, removed_regions = [], []
        # Only successfully saved snapshots are removed from the background.
        # If a crop/save fails, its original pixels remain there, with no text
        # overlay. Never silently lose an entire figure on an I/O failure.
        for region, role in ([(f, "figure") for f in figure_boxes]
                             + [(t, "table") for t in table_boxes if t.get("snapshot")]):
            r = _pdf_raster_rect(region["rect"], page.rect, 300)
            avoid.append(list(r))
            try:
                url = _pdf_save_snapshot(page, r)
                if url:
                    removed_regions.append(list(r))
                    fig_table_els.append({
                        "type": "image", "id": _imp_uid("i"), "url": url,
                        "x": round(r.x0 * sc + offx, 3), "y": round(r.y0 * sc, 3),
                        "w": round(r.width * sc, 3), "h": round(r.height * sc, 3),
                        "imported": 1, "locked": True, "pdfRole": role,
                    })
            except Exception as e:
                print(f"[import] {role} snapshot kept in background: {e}")
        # Table glyphs use original positioned text over the original rules and
        # fills. Do not invent gray borders, padding, fonts or merged-cell grids.
        table_rects = [list(t["rect"]) for t in table_boxes]
        lines, math_regions = _pdf_page_lines(page, avoid=avoid, math_avoid=table_rects,
                                              preserve_math_glyphs=True)

        _line_aligns(lines, pw)
        # 수식 영역 안에 남은 일반 텍스트 조각을 한 번 더 제거
        if math_regions:
            for ln in lines:
                keep = []
                for wd in ln["words"]:
                    wa = max(1e-6, (wd["x1"] - wd["x0"]) * (wd["y1"] - wd["y0"]))
                    inside = False
                    for r in math_regions:
                        ox = min(wd["x1"], r["x1"] + 0.4) - max(wd["x0"], r["x0"] - 0.4)
                        oy = min(wd["y1"], r["y1"] + 0.6) - max(wd["y0"], r["y0"] - 0.6)
                        if ox > 0 and oy > 0 and (ox * oy) / wa >= 0.45:
                            inside = True
                            break
                    if not inside:
                        keep.append(wd)
                ln["words"] = keep
            lines = [ln for ln in lines if ln["words"]]
            for ln in lines:
                ln["x0"] = min(w["x0"] for w in ln["words"])
                ln["y0"] = min(w["y0"] for w in ln["words"])
                ln["x1"] = max(w["x1"] for w in ln["words"])
                ln["y1"] = max(w["y1"] for w in ln["words"])

        # ── ⓪ 수식은 LaTeX 요소 하나로 만든다 ──
        math_els = []
        rendered_math = []
        for mr in math_regions:
            try:
                rx0, ry0, rx1, ry1 = mr["x0"], mr["y0"], mr["x1"], mr["y1"]
                if rx1 <= rx0 or ry1 <= ry0:
                    continue
                latex = _pdf_text_to_latex(mr.get("text") or "")
                if not latex or not _latex_is_sane(latex):
                    continue
                display = bool(mr.get("display"))
                pad_x, pad_y = ((0.6, 0.8) if display else (0.0, 0.4))
                x0 = max(0.0, rx0 - pad_x); y0 = max(0.0, ry0 - pad_y)
                x1 = min(pw, rx1 + pad_x); y1 = min(ph, ry1 + pad_y)
                fs = round(max(6.0, min(52.0, float(mr.get("size") or 10) * sc)), 1)
                ink_h = _px((y1 - y0) * sc)
                hh = max(8, ink_h if ink_h >= _px(fs * 0.75) else _px(fs * (1.15 if display else 1.05)))
                rendered_math.append([x0, y0, x1, y1])
                math_els.append({
                    "type": "latex", "id": _imp_uid("m"), "latex": latex,
                    "x": X(x0), "y": Y(y0),
                    "w": max(8, _px((x1 - x0) * sc)), "h": hh,
                    "fontSize": fs,
                    "displayMath": 1 if display else 0,
                    "inkW": max(8, _px((x1 - x0) * sc)), "inkH": max(8, ink_h),
                    "imported": 1, "locked": True,
                })
            except Exception as e:
                print(f"[import] {pno+1}쪽 LaTeX 변환 실패: {e}")

        # Capture exact glyph identities for converted equations, including
        # large brackets whose INK extends beyond their nominal region bbox.
        math_glyphs = []
        for block in _page_rawdict(page).get("blocks", []):
            for ln in block.get("lines", []):
                for sp in ln.get("spans", []):
                    for ch in sp.get("chars", []):
                        bb = ch["bbox"]
                        cx, cy = (bb[0]+bb[2])/2, (bb[1]+bb[3])/2
                        if any(r[0]-.2 <= cx <= r[2]+.2 and r[1]-.2 <= cy <= r[3]+.2 for r in rendered_math):
                            math_glyphs.append([round(ch["origin"][0], 4), round(ch["origin"][1], 4), ch["c"]])
        # One immutable ownership plan is reused when upgrading the background.
        plan = {"v": 2, "sourcePage": pno,
                "glyphs": [[round(ch["o"][0], 4), round(ch["o"][1], 4), ch["c"]]
                           for ln in lines for wd in ln["words"] for ch in wd["chars"]] + math_glyphs,
                "regions": removed_regions + rendered_math}
        bg_els = []
        bg_url = _pdf_save_background(doc, pno, plan, BG_DPI_CUR, BG_PX_CUR)
        if bg_url:
            bg_els.append({"type": "image", "id": _imp_uid("i"), "url": bg_url,
                           "x": round(offx, 3), "y": 0,
                           "w": round(pw * sc, 3), "h": round(ph * sc, 3),
                           "isBg": 1, "locked": True, "pdfBg": 2, "pdfPage": pno})
        text_els = _pdf_text_elements(lines, sc, offx, _imp_uid)
        els = bg_els + fig_table_els + math_els + text_els
        return {"id": _imp_uid("p"), "els": els, "tables": [], "pdfBg": plan}
    except Exception as e:
        print(f"[import] {pno+1}쪽 원본 보존 폴백: {e}")
        return _pdf_fallback_page(doc, pno, target_w, target_h)
    finally:
        if on_page_done:
            try:
                on_page_done()
            except Exception:
                pass


def _pdf_to_pages(data, on_page=None, target_w=PAGE_W, target_h=PAGE_H):
    """PDF → 페이지 목록 (청크 스트리밍 방식).

    · 문서를 4쪽 단위 청크로 나눠 열고→변환→닫는다.
      → 메모리가 '전체 문서'가 아니라 '쪽 1개' 수준에서만 논다.
      → 저사양 서버에서도 큰 PDF 가 죽지 않는다.
    · 문서 사본을 두 개 열던 옛 방식을 버려 속도도 2배 가깝게 개선.
    · 쪽이 끝날 때마다 배경은 즉시 디스크 저장 + 진행 콜백 호출.
    """
    import pymupdf

    d0 = pymupdf.open(stream=data, filetype="pdf")
    total = min(d0.page_count, IMPORT_MAX_PAGES)
    d0.close()

    pages = []
    state = {"done": 0}

    def _bump():
        state["done"] += 1
        if on_page:
            try:
                on_page(state["done"], total)
            except Exception:
                pass

    CHUNK = 4
    for start in range(0, total, CHUNK):
        doc = pymupdf.open(stream=data, filetype="pdf")
        try:
            for pno in range(start, min(start + CHUNK, total)):
                pages.append(_pdf_one_page(doc, pno, _bump,
                                           target_w=target_w, target_h=target_h))
        finally:
            doc.close()          # 청크 끝나면 즉시 메모리 반납
    return pages


def _pdf_to_pages_safe(data, on_page=None, target_w=PAGE_W, target_h=PAGE_H):
    """한 페이지가 깨져도 문서 전체가 실패하지 않도록 감싼다."""
    try:
        return _pdf_to_pages(data, on_page=on_page,
                             target_w=target_w, target_h=target_h)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[import] 전체 변환 실패 → 글자만 뽑아 재시도: {e}")
    # 최후 수단: 글자만 단순하게 뽑는다
    import pymupdf
    doc = pymupdf.open(stream=data, filetype="pdf")
    pages = []
    try:
        for pno in range(min(doc.page_count, IMPORT_MAX_PAGES)):
            page = doc[pno]
            pw, ph = page.rect.width, page.rect.height
            if pw <= 0 or ph <= 0:
                continue
            sc = min(target_w / pw, target_h / ph)
            offx = (target_w - pw * sc) / 2
            els = []
            try:
                blocks = page.get_text("blocks")
            except Exception:
                blocks = []
            for bl in blocks:
                try:
                    x0, y0, x1, y1, txt = bl[0], bl[1], bl[2], bl[3], bl[4]
                    if not (txt or "").strip():
                        continue
                    html = (txt.replace("&", "&amp;").replace("<", "&lt;")
                               .replace(">", "&gt;").replace("\n", " "))
                    els.append({
                        "type": "text", "id": _imp_uid("t"), "html": html,
                        "x": _px(x0 * sc + offx) - 2, "y": _px(y0 * sc) - 2,
                        "w": max(24, _px((x1 - x0) * sc) + 5),
                        "h": max(16, _px((y1 - y0) * sc) + 5),
                        "fontSize": 14, "fit": 1,
                    })
                except Exception:
                    continue
            pages.append({"id": _imp_uid("p"), "els": els, "tables": []})
    finally:
        doc.close()
    return pages


def _pdf_one_page_safe(doc, pno, target_w=PAGE_W, target_h=PAGE_H):
    """Resource-failure retry: retain the original page before trying text only."""
    try:
        return _pdf_fallback_page(doc, pno, target_w, target_h)
    except Exception:
        pass
    try:
        page = doc[pno]
        pw, ph = page.rect.width, page.rect.height
        if pw <= 0 or ph <= 0:
            return {"id": _imp_uid("p"), "els": [], "tables": []}
        sc = min(target_w / pw, target_h / ph)
        offx = (target_w - pw * sc) / 2
        lines, math_regions = _pdf_page_lines(page)
        _line_aligns(lines, pw)
        _mark_justify(lines, pw)
        els = []
        for mr in math_regions:
            latex=_pdf_text_to_latex(mr.get("text") or "")
            if not latex: continue
            x=_px(mr["x0"]*sc+offx); y=_px(mr["y0"]*sc)
            fs=round(max(6.0,min(52.0,float(mr.get("size") or 10)*sc)),1)
            w=max(8,_px((mr["x1"]-mr["x0"])*sc))
            ink_h=_px((mr["y1"]-mr["y0"])*sc)
            h=max(8, ink_h if ink_h>=_px(fs*0.75) else _px(fs*1.1))
            els.append({"type":"latex","id":_imp_uid("m"),"latex":latex,
                        "x":x,"y":y,"w":w,"h":h,
                        "fontSize":fs,
                        "displayMath":1 if mr.get("display") else 0,
                        "inkW":w,"inkH":max(8,ink_h),
                        "imported":1,"locked":True})
        # 수식 영역과 겹친 텍스트는 안전 모드에서도 면적 기준으로 제거 (9.0)
        for ln in lines:
            keep=[]
            for wd in ln["words"]:
                wa=max(1e-6,(wd["x1"]-wd["x0"])*(wd["y1"]-wd["y0"]))
                hit=False
                for r in math_regions:
                    ox=min(wd["x1"],r["x1"])-max(wd["x0"],r["x0"])
                    oy=min(wd["y1"],r["y1"])-max(wd["y0"],r["y0"])
                    if ox>0 and oy>0 and (ox*oy)/wa>=0.45: hit=True; break
                if not hit: keep.append(wd)
            ln["words"]=keep
        lines=[ln for ln in lines if ln["words"]]
        for ln in lines:
            ln["x0"]=min(w_["x0"] for w_ in ln["words"]); ln["y0"]=min(w_["y0"] for w_ in ln["words"])
            ln["x1"]=max(w_["x1"] for w_ in ln["words"]); ln["y1"]=max(w_["y1"] for w_ in ln["words"])
        # 안전 모드에서도 겹친 인용/글자 레이어는 하나만 남긴다.
        seen_words={}
        for ln in lines:
            keep=[]
            for wd in ln["words"]:
                tx="".join(ch["c"] for ch in wd["chars"]).strip()
                bb=(wd["x0"],wd["y0"],wd["x1"],wd["y1"])
                if any(max(abs(bb[i]-o[i]) for i in range(4))<=1.25 for o in seen_words.get(tx,[])):
                    continue
                seen_words.setdefault(tx,[]).append(bb); keep.append(wd)
            ln["words"]=keep
        lines=[ln for ln in lines if ln["words"]]
        els.extend(_pdf_text_elements(lines, sc, offx, _imp_uid))
        return {"id": _imp_uid("p"), "els": els, "tables": []}
    except Exception as e:
        print(f"[import] {pno+1}쪽 최소 변환 실패: {e}")
        return {"id": _imp_uid("p"), "els": [], "tables": []}


# ── 격리 변환: 변환은 '별도 프로세스'에서 ────────────────────
# 자식이 세그폴트/OOM 으로 죽어도 메인 서버는 절대 죽지 않는다.
# 죽으면 안전 모드(원본 스냅샷 우선)로 해당 청크를 재시도하고,
# 그것도 죽으면 빈 쪽으로 채워 '무조건 끝까지' 완료한다.
# 메모리/동시성은 배포 시 RAM 에 맞춰 apply.sh 가 주입한다
# (SDY_IMP_MAX_CONCURRENT, SDY_IMP_CHILD_MEM_MB).
# 기본값은 저사양 박스 보호용으로 보수적으로 유지.
def _imp_env_int(name, default):
    try:
        v = int(os.environ.get(name, ""))
        return v if v >= 1 else default
    except (TypeError, ValueError):
        return default


IMP_CHILD_MEM_MB = _imp_env_int("SDY_IMP_CHILD_MEM_MB", 2000)   # 자식 메모리 상한
IMP_MAX_CONCURRENT = _imp_env_int("SDY_IMP_MAX_CONCURRENT", 2)  # 동시 변환 잡 상한
IMP_SLICE = int(os.environ.get("SDY_IMP_SLICE", "8") or 8)      # 보관 배치 크기
_imp_sem = threading.Semaphore(IMP_MAX_CONCURRENT)
# 전역 '자식 프로세스' 상한. 잡별 동시성(IMP_MAX_CONCURRENT)만으로는 여러 잡의
# 청크가 겹쳐(예: 잡 3 × 청크 3) 자식 총합이 RAM 을 넘었다. apply.sh 가 12GB
# 박스 기준 SDY_IMP_MAX_CHUNKS(=워커 예산 ÷ 자식 메모리, 예: 5×1GB)를 주입하고,
# 모든 잡의 청크가 이 세마포를 공유해 실제 동시 자식 수를 한 번에 잠근다.
IMP_MAX_CHUNKS = _imp_env_int("SDY_IMP_MAX_CHUNKS", max(2, IMP_MAX_CONCURRENT * 2))
_imp_chunk_sem = threading.BoundedSemaphore(IMP_MAX_CHUNKS)
# 현재 가져오기 잡을 몇 개나 처리 중인지(세마포가 잡혀 있는 수). 여러 잡이
# 동시에 청크를 띄울 때 자식 총합이 RAM 을 넘지 않도록 문서당 병렬을 줄인다.
_imp_active = 0
_imp_active_lock = threading.Lock()
IMP_CHUNK = 4
IMP_CHUNK_TIMEOUT = 240       # 청크 하나 당 허용 시간(초)


def _chunk_pages(src, pnos, out_path, safe, total=1,
                 target_w=PAGE_W, target_h=PAGE_H):
    """자식 프로세스 본문. 결과(쪽 목록)를 파일로 남기고 끝난다."""
    try:
        try:
            import resource
            lim = IMP_CHILD_MEM_MB * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (lim, lim))
        except Exception:
            pass
        global BG_DPI_CUR, BG_PX_CUR
        BG_DPI_CUR, BG_PX_CUR = _bg_tier(total)
        import pymupdf
        doc = pymupdf.open(src)          # 경로는 스트림 복사 없이 디스크에서 읽음
        pages = []
        try:
            cache = {}
            # 예전엔 큰 파일이면 '쪽마다' 문서를 새로 열었다.
            # 373쪽짜리 원서에선 이 재파싱이 변환 시간을 몇 배로 늘린다.
            # 자식 프로세스가 슬라이스(8쪽)마다 새로 뜨므로 메모리는 이미
            # 그 단위에서 반납된다 → 한 번만 열고 재사용해도 안전하다.
            for pno in pnos:
                pages.append(
                    _pdf_one_page_safe(doc, pno, target_w, target_h) if safe
                    else _pdf_one_page(doc, pno, None, cache, target_w, target_h)
                )
        finally:
            doc.close()
        with open(out_path, "w", encoding="utf-8") as fp:
            json.dump(pages, fp, ensure_ascii=False)
        os._exit(0)
    except BaseException as e:
        try:
            with open(out_path, "w", encoding="utf-8") as fp:
                json.dump({"error": f"{type(e).__name__}: {e}"}, fp)
        except Exception:
            pass
        os._exit(3)


def _run_chunk_start(src, pnos, safe, total=1,
                     target_w=PAGE_W, target_h=PAGE_H):
    """자식 프로세스 시작만 (병렬 실행용). 전역 청크 세마포로 자식 총합을 잠근다."""
    import multiprocessing
    out = os.path.join(IMG_DIR, f"chunk_{uuid.uuid4().hex}.json")
    ctx = multiprocessing.get_context("fork")
    _imp_chunk_sem.acquire()
    try:
        proc = ctx.Process(target=_chunk_pages,
                           args=(src, pnos, out, safe, total, target_w, target_h))
        proc.start()
    except BaseException:
        _imp_chunk_sem.release()
        raise
    return proc, out


def _run_chunk_collect(proc, out):
    """자식 수확. 죽으면 None (호출측이 재시도)."""
    try:
        proc.join(IMP_CHUNK_TIMEOUT)
        if proc.is_alive():
            proc.kill()
            proc.join()
        code = proc.exitcode
        try:
            if code == 0 and os.path.exists(out):
                with open(out, encoding="utf-8") as fp:
                    data_ = json.load(fp)
                if isinstance(data_, list):
                    return data_
        finally:
            try:
                os.remove(out)
            except Exception:
                pass
        return None
    finally:
        # 시작 시 잡은 전역 청크 세마포를 항상 여기서 반납한다(예외 포함).
        _imp_chunk_sem.release()


def _run_chunk(src, pnos, safe, total=1,
               target_w=PAGE_W, target_h=PAGE_H):
    return _run_chunk_collect(*_run_chunk_start(
        src, pnos, safe, total, target_w, target_h
    ))


def _imp_convert_pdf(src, jid, target_w=PAGE_W, target_h=PAGE_H):
    """PDF 전체를 청크 격리 변환으로. 서버는 절대 죽지 않는다."""
    import pymupdf
    d0 = pymupdf.open(src)
    total = min(d0.page_count, IMPORT_MAX_PAGES)
    d0.close()
    # 총 쪽수를 '시작하자마자' 알려 준다.
    # 예전엔 첫 묶음(8쪽)이 끝나야 total 이 잡혀서, 그전까지 진행률이
    # 엉뚱한 값(0/1 쪽)으로 계산돼 막대가 뒤로 튀어 보였다.
    _imp_job(jid, page=0, total=total)

    sz = os.path.getsize(src)
    # 단일 문서 안의 청크 병렬성. 동시에 여러 '문서' 잡이 돌 수 있으므로
    # (세마포 IMP_MAX_CONCURRENT), 지금 활성 잡 수에 비례해 문서당 상한을
    # 낮춰 자식 프로세스 총합이 RAM 을 넘지 않게 한다.
    with _imp_active_lock:
        active = _imp_active
    cpu = os.cpu_count() or 2
    # 활성 잡 1개 → 최대 3, 2개 → 2, 3개 → 1 (대/중형 파일은 더 낮춤)
    share = max(1, (IMP_MAX_CONCURRENT + 1) // max(1, active))
    cap = max(1, min(cpu, IMP_MAX_CONCURRENT, share, 3))
    if sz > 60 * 1024 * 1024:
        CONC = 1                      # 거대 파일: 직렬로 안정적으로
    elif sz > 25 * 1024 * 1024:
        CONC = min(2, cap)
    else:
        CONC = cap
    pending = list(range(0, total, IMP_SLICE))
    running = []
    by_start = {}
    done_n = 0

    def start_one(s0):
        pnos = list(range(s0, min(s0 + IMP_SLICE, total)))
        proc, out = _run_chunk_start(src, pnos, False, total,
                                     target_w, target_h)
        running.append([s0, pnos, proc, out])

    for k in range(min(CONC, len(pending))):
        start_one(pending[k])
    nxt = min(CONC, len(pending))
    import time as _t
    while running:
        while all(r[2].exitcode is None for r in running):
            _t.sleep(0.12)
        for r in list(running):
            if r[2].exitcode is None:
                continue
            running.remove(r)
            s0, pnos, proc, out = r
            got = _run_chunk_collect(proc, out)
            if got is None or len(got) != len(pnos):
                got = _run_chunk(src, pnos, True, total,
                                 target_w, target_h)
            if got is None or len(got) != len(pnos):
                got = [{"id": _imp_uid("p"), "els": [], "tables": []} for _ in pnos]
            by_start[s0] = got
            done_n += len(pnos)
            _imp_job(jid, page=done_n, total=total)
            if nxt < len(pending):
                start_one(pending[nxt])
                nxt += 1
    pages = []
    for s0 in sorted(by_start):
        pages.extend(by_start[s0])
    if not pages:
        pages = [{"id": _imp_uid("p"), "els": [], "tables": []}]
    return pages


def _emu_px(v):
    """EMU(914400 = 1inch) → 화면 픽셀 (96dpi 기준)"""
    try:
        return v / 914400.0 * 96.0
    except Exception:
        return 0


def _docx_to_pages(data, target_w=PAGE_W, target_h=PAGE_H):
    """Word(.docx) → 페이지 목록. 문단을 위에서 아래로 흘려 배치한다."""
    import docx
    from docx.shared import RGBColor

    f = docx.Document(io.BytesIO(data))
    margin_x, margin_y = 64, 60
    max_y = target_h - margin_y
    width = target_w - margin_x * 2

    pages, els = [], []
    y = margin_y

    def new_page():
        nonlocal els, y
        pages.append({"id": _imp_uid("p"), "els": els})
        els, y = [], margin_y

    # 문서에 들어있는 그림들 (문단 순서대로 꺼내 쓴다)
    images = []
    for rel in f.part.rels.values():
        if "image" in rel.reltype:
            try:
                images.append(rel.target_part.blob)
            except Exception:
                pass
    img_i = 0

    for para in f.paragraphs:
        text = (para.text or "").strip()
        style = (para.style.name or "").lower() if para.style is not None else ""

        # 그림이 들어있는 문단
        if "graphic" in para._p.xml or "<w:drawing" in para._p.xml:
            if img_i < len(images):
                url = _img_data_url(images[img_i]); img_i += 1
                if url:
                    try:
                        im = Image.open(io.BytesIO(images[img_i - 1]))
                        iw, ih = im.size
                    except Exception:
                        iw, ih = 400, 300
                    sc = min(width / iw, 1.0)
                    w, h = _px(iw * sc), _px(ih * sc)
                    if y + h > max_y:
                        new_page()
                    els.append({"type": "image", "id": _imp_uid("i"), "url": url,
                                "x": margin_x, "y": _px(y), "w": w, "h": h})
                    y += h + 12
            if not text:
                continue

        if not text:
            y += 14                      # 빈 줄
            continue

        # 제목 스타일이면 크게
        fs = 16
        if "heading 1" in style or "title" in style:
            fs = 28
        elif "heading 2" in style:
            fs = 23
        elif "heading 3" in style:
            fs = 20

        html = ""
        for run in para.runs:
            t = (run.text or "")
            if not t:
                continue
            t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            col = None
            try:
                if run.font.color is not None and run.font.color.rgb is not None:
                    col = str(run.font.color.rgb)
            except Exception:
                col = None
            if col and col != "000000":
                t = f'<span style="color:#{col}">{t}</span>'
            if run.bold:
                t = f"<b>{t}</b>"
            if run.italic:
                t = f"<i>{t}</i>"
            if run.underline:
                t = f"<u>{t}</u>"
            html += t
        if not html.strip():
            html = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        if "heading" in style or "title" in style:
            html = f"<b>{html}</b>" if "<b>" not in html else html

        # 글자 수에 따라 높이 추정 (한 줄에 들어가는 글자 수 기준)
        per_line = max(10, int(width / (fs * 0.62)))
        lines = max(1, (len(text) + per_line - 1) // per_line)
        h = _px(lines * fs * 1.55) + 14

        if y + h > max_y:
            new_page()

        els.append({"type": "text", "id": _imp_uid("t"), "html": html,
                    "x": margin_x, "y": _px(y), "w": width, "h": h,
                    "fontSize": fs})
        y += h + 4

    # 표는 줄글로 옮긴다
    for tb in f.tables:
        for row in tb.rows:
            cells = [c.text.strip().replace("&", "&amp;").replace("<", "&lt;") for c in row.cells]
            line = "  |  ".join([c for c in cells if c])
            if not line:
                continue
            h = 34
            if y + h > max_y:
                new_page()
            els.append({"type": "text", "id": _imp_uid("t"), "html": line,
                        "x": margin_x, "y": _px(y), "w": width, "h": h,
                        "fontSize": 15})
            y += h + 2

    if els or not pages:
        pages.append({"id": _imp_uid("p"), "els": els})
    return pages


# ── 가져오기 비동기 잡 (디스크 기반) ─────────────────────────
# 잡 상태를 메모리가 아닌 디스크에 저장한다.
# → 서버가 재시작되든, 프로세스가 여러 개이든, 어떤 경우에도
#   상태 조회가 일관되게 동작한다 ("없는 작업" 문제 원천 차단)
IMP_JOB_TTL = 900          # 잡 결과 보관 시간(초)


def _imp_job_path(jid):
    safe = re.sub(r"[^0-9a-zA-Z_\-]", "", jid or "")[:40]
    return os.path.join(JOBS_DIR, f"{safe}.json")


def _imp_job(jid, **kw):
    p = _imp_job_path(jid)
    try:
        cur = {}
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as fp:
                    cur = json.load(fp)
            except Exception:
                cur = {}
        cur.update(kw)
        cur["ts"] = time.time()
        tmp = "%s.tmp.%s" % (p, uuid.uuid4().hex[:8])
        with open(tmp, "w", encoding="utf-8") as fp:
            json.dump(cur, fp, ensure_ascii=False)
        os.replace(tmp, p)
    except Exception as e:
        print("[import] 잡 저장 실패:", e)


def _imp_job_load(jid):
    p = _imp_job_path(jid)
    try:
        if not os.path.exists(p):
            return None
        if time.time() - os.path.getmtime(p) > IMP_JOB_TTL:
            os.remove(p)
            return None
        with open(p, encoding="utf-8") as fp:
            return json.load(fp)
    except Exception:
        return None


def _imp_mark_stopped(p, why):
    try:
        with open(p, encoding="utf-8") as fp:
            j = json.load(fp)
        if j.get("status") == "working":
            j["status"] = "error"
            j["error"] = why
            tmp = "%s.tmp.%s" % (p, uuid.uuid4().hex[:8])
            with open(tmp, "w", encoding="utf-8") as fp:
                json.dump(j, fp, ensure_ascii=False)
            os.replace(tmp, p)
    except Exception:
        pass


def _imp_sweep_dead():
    """서버 시작 시점의 '변환 중' 잡은 전부 죽은 것(재시작으로 워커 소멸)."""
    try:
        for fn in os.listdir(JOBS_DIR):
            if fn.endswith(".json"):
                _imp_mark_stopped(os.path.join(JOBS_DIR, fn),
                                  "서버가 재시작되어 변환이 중단되었습니다. 다시 가져오기를 시도해 주세요")
    except Exception:
        pass


def _imp_detect_kind(raw, ext):
    """파일 내용(매직 바이트)으로 실제 형식을 판별해 정확한 안내를 준다."""
    if raw[:4] == b"%PDF":
        return "pdf", None
    if raw[:4] == b"PK\x03\x04":
        if ext in ("docx", "docm"):
            return "word", None
        return None, ("이 파일은 PDF 가 아닙니다(압축/Word 계열). "
                      "PDF 또는 .docx 로 저장해서 올려주세요")
    if raw[:4] == b"\xd0\xcf\x11\xe0":
        return None, ("HWP 또는 옛 .doc 형식은 지원하지 않습니다. "
                      "한글/워드에서 PDF 로 저장한 뒤 올려주세요")
    if raw[:8].startswith(b"\x89PNG") or raw[:3] == b"\xff\xd8\xff":
        return None, ("이미지 파일입니다. 사진 버튼으로 삽입하거나, "
                      "문서라면 PDF 로 저장해서 올려주세요")
    if ext in ("docx", "docm"):
        return "word", None
    if ext == "doc":
        return None, "옛 .doc 형식은 지원하지 않습니다. .docx 로 저장 후 올려주세요"
    if ext == "pdf":
        return "pdf", None
    return None, "PDF 또는 Word(.docx) 파일만 가져올 수 있습니다"


def _imp_worker(jid, src, name, kind):
    """백그라운드 변환. 본문은 디스크(docfile)에만 두고 잡엔 메타만.
    동시에 여러 잡이 메모리를 쌓지 않도록 세마포어로 제한한다."""
    global _imp_active
    import traceback
    _imp_sem.acquire()
    with _imp_active_lock:
        _imp_active += 1
    try:
        if kind == "pdf":
            size_preset = _pdf_size_preset(src)
            target_w, target_h = _preset_dims(size_preset)
            pages = _imp_convert_pdf(src, jid, target_w, target_h)
        else:
            _imp_job(jid, page=0, total=1)
            with open(src, "rb") as fp:
                word_data = fp.read()
            size_preset = _docx_size_preset(word_data)
            target_w, target_h = _preset_dims(size_preset)
            pages = _docx_to_pages(word_data, target_w, target_h)
            _imp_job(jid, page=1, total=1)

        if not pages:
            pages = [{"id": _imp_uid("p"), "els": [], "tables": []}]

        if kind == "pdf":
            _store_pdf_bg_plans(pages, jid)

        # 그림은 서버에 파일로 두고 문서에는 주소만 넣는다 (용량 문제 해결)
        for pg_ in pages:
            for el in pg_.get("els", []):
                u = el.get("url") or ""
                if el.get("type") == "image" and u.startswith("data:"):
                    el["url"] = _save_import_img(u)

        total_els = sum(len(p.get("els", [])) for p in pages)
        title = name.rsplit(".", 1)[0][:80] or "가져온 문서"

        # 대용량 문서: 브라우저 저장소 대신 서버에 본문 보관 (gzip)
        doc_ref = None
        try:
            import gzip as _gz
            total_n = len(pages)
            for s0 in range(0, total_n, IMP_SLICE):
                sp = os.path.join(DOCS_DIR, f"{jid}.s{s0}.gz.tmp")
                with _gz.open(sp, "wt", encoding="utf-8") as fp:
                    json.dump({"ok": True, "pages": pages[s0:s0 + IMP_SLICE],
                               "total": total_n}, fp, ensure_ascii=False)
                os.replace(sp, os.path.join(DOCS_DIR, f"{jid}.s{s0}.gz"))
            mp = os.path.join(DOCS_DIR, f"{jid}.meta.json.tmp")
            with open(mp, "w", encoding="utf-8") as fp:
                json.dump({"total": total_n, "sizePreset": size_preset,
                           "version": time.time()}, fp)
            os.replace(mp, os.path.join(DOCS_DIR, f"{jid}.meta.json"))
            doc_ref = jid
        except Exception as e:
            print("[import] docfile 저장 실패:", e)

        print(f"[import] {kind} '{name}' → {len(pages)}쪽 / 요소 {total_els}개")
        if doc_ref is None or len(pages) <= 60:
            # 작거나 디스크 보관 실패 시엔 잡에 본문도 태움(옛 프런트 호환)
            _imp_job(jid, status="done", kind=kind, title=title, pages=pages,
                     count=total_els, sizePreset=size_preset,
                     docRef=doc_ref, total=len(pages))
        else:
            _imp_job(jid, status="done", kind=kind, title=title,
                     count=total_els, sizePreset=size_preset,
                     docRef=doc_ref, total=len(pages))
        _notify_add("convert_done", "문서 변환이 끝났어요 ✓",
                    f"{title} · {len(pages)}쪽을 노트로 준비했습니다.",
                    dedupe=f"import-done:{jid}", meta={"job": jid, "pages": len(pages)})
    except MemoryError:
        traceback.print_exc()
        _imp_job(jid, status="error",
                 error="서버 메모리가 부족합니다. 쪽수가 적은 파일로 나눠서 올려주세요")
        _notify_add("error", "문서 변환을 마치지 못했어요",
                    f"{name} · 메모리가 부족합니다. 파일을 나눠 다시 시도해 주세요.",
                    dedupe=f"import-error:{jid}")
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[import] 변환 실패: {e}\n{tb}")
        msg = str(e) or e.__class__.__name__
        low = msg.lower()
        if "password" in low or "encrypt" in low:
            msg = "비밀번호로 잠긴 PDF 입니다. 잠금을 푼 뒤 다시 올려주세요"
        elif "find_tables" in low or "no attribute" in low:
            msg = ("서버 라이브러리가 오래되었습니다. apply.sh 를 다시 실행해 "
                   "pymupdf 를 갱신해 주세요 (" + msg + ")")
        _imp_job(jid, status="error", error=f"변환 실패: {msg}",
                 detail=tb[-800:])
        _notify_add("error", "문서 변환을 마치지 못했어요",
                    f"{name} · {msg}", dedupe=f"import-error:{jid}")
    finally:
        with _imp_active_lock:
            _imp_active = max(0, _imp_active - 1)
        try:
            _imp_sem.release()
        except Exception:
            pass
        try:
            # 원본은 재변환(자가치유)을 위해 보관, 하루 지난 것은 정리
            if src and os.path.exists(src):
                import shutil
                shutil.move(src, os.path.join(DOCS_DIR, f"{jid}.src"))
            now = time.time()
            for fn in os.listdir(DOCS_DIR):
                if fn.endswith(".src"):
                    p = os.path.join(DOCS_DIR, fn)
                    if now - os.path.getmtime(p) > 86400:
                        os.remove(p)
        except Exception:
            pass


@app.route("/api/import/upload", methods=["POST"])
def import_upload():
    """큰 파일을 청크로 나눠 받는 조립소. 크기 제한 없이 업로드 가능."""
    uid = re.sub(r"[^0-9a-zA-Z_\-]", "", (request.form.get("uploadId") or ""))[:40]
    if not uid:
        return jsonify({"ok": False, "error": "uploadId 없음"}), 400
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "청크 없음"}), 400
    try:
        chunk = int(request.form.get("chunk", "0"))
        total = max(1, int(request.form.get("total", "1")))
    except ValueError:
        return jsonify({"ok": False, "error": "청크 번호 오류"}), 400
    if chunk >= total or total > 20000:
        return jsonify({"ok": False, "error": "청크 범위 오류"}), 400
    # 1시간 넘은 찌꺼기 업로드 정리
    try:
        now = time.time()
        for fn in os.listdir(UPLOAD_DIR):
            p = os.path.join(UPLOAD_DIR, fn)
            if now - os.path.getmtime(p) > 3600:
                os.remove(p)
    except Exception:
        pass
    part = os.path.join(UPLOAD_DIR, f"{uid}.part")
    try:
        with open(part, "wb" if chunk == 0 else "ab") as fp:
            fp.write(f.read())
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    done = chunk + 1 >= total
    if done:
        os.replace(part, os.path.join(UPLOAD_DIR, f"{uid}.bin"))
    return jsonify({"ok": True, "done": done, "chunk": chunk, "total": total})


@app.route("/api/import/doc", methods=["POST"])
def import_doc():
    """PDF / Word → 편집 가능한 노트. 잡 번호를 바로 돌려준다(비동기).

    큰 파일은 /api/import/upload 으로 청크 조립 후 uploadId 로 요청하고,
    작은 파일은 예전처럼 file 로 바로 보내도 된다. 크기 제한 없음.
    """
    uid = re.sub(r"[^0-9a-zA-Z_\-]", "", (request.form.get("uploadId") or ""))[:40]
    if uid:
        src = os.path.join(UPLOAD_DIR, f"{uid}.bin")
        if not os.path.exists(src):
            return jsonify({"ok": False, "error": "업로드가 완성되지 않았습니다"}), 400
        name = request.form.get("name") or "document"
    elif "file" in request.files:
        f = request.files["file"]
        name = f.filename or "document"
        uid = uuid.uuid4().hex[:12]
        src = os.path.join(UPLOAD_DIR, f"{uid}.bin")
        f.save(src)
    else:
        return jsonify({"ok": False, "error": "파일이 없습니다"}), 400

    try:
        size = os.path.getsize(src)
    except OSError:
        size = 0
    if not size:
        try:
            os.remove(src)
        except Exception:
            pass
        return jsonify({"ok": False, "error": "빈 파일입니다"}), 400

    with open(src, "rb") as fp:
        head = fp.read(16)

    ext = (name.rsplit(".", 1)[-1] if "." in name else "").lower()
    kind, err = _imp_detect_kind(head, ext)
    if err:
        try:
            os.remove(src)
        except Exception:
            pass
        return jsonify({"ok": False, "error": err}), 400

    # PDF 는 시작 전에 미리 열어본다 — 죽은 파일이면 여기서 정확히 안내
    if kind == "pdf":
        import pymupdf
        try:
            d = pymupdf.open(src)
            locked = d.is_encrypted and not d.authenticate("")
            n_pages = d.page_count
            d.close()
            if locked:
                os.remove(src)
                return jsonify({"ok": False,
                                "error": "비밀번호로 잠긴 PDF 입니다. 잠금을 푼 뒤 다시 올려주세요"}), 400
            if n_pages <= 0:
                os.remove(src)
                return jsonify({"ok": False, "error": "페이지가 없는 PDF 입니다"}), 400
        except Exception as e:
            os.remove(src)
            return jsonify({"ok": False,
                            "error": ("PDF 를 열 수 없습니다. 파일이 깨졌거나 "
                                      "다른 형식일 수 있어요. PDF 로 다시 저장해서 "
                                      f"올려주세요 ({str(e) or e.__class__.__name__})")}), 400

    jid = uuid.uuid4().hex[:12]
    _imp_job(jid, status="working", page=0, total=0)
    _notify_add("convert", "문서 변환을 시작했어요", f"{name} 파일을 읽고 있습니다.",
                dedupe=f"import-start:{jid}", meta={"job": jid, "kind": kind})
    threading.Thread(target=_imp_worker, args=(jid, src, name, kind),
                     daemon=True).start()
    return jsonify({"ok": True, "job": jid})


@app.route("/api/import/reconv", methods=["POST"])
def import_reconv():
    """비어 있게 변환된 슬라이스를 안전 모드로 재변환해 덮어쓴다 (자가치유)."""
    d = request.get_json(silent=True) or {}
    ref = re.sub(r"[^0-9a-zA-Z_\-]", "", d.get("ref") or "")
    try:
        s0 = int(d.get("from") or 0)
        total = int(d.get("total") or 0)
    except ValueError:
        return jsonify({"ok": False, "error": "인자 오류"}), 400
    srcp = os.path.join(DOCS_DIR, f"{ref}.src")
    if not ref or not os.path.exists(srcp):
        return jsonify({"ok": False, "error": "원본 없음"}), 404
    size_preset = "a4_portrait"
    try:
        with open(os.path.join(DOCS_DIR, f"{ref}.meta.json"), encoding="utf-8") as fp:
            size_preset = json.load(fp).get("sizePreset", size_preset)
    except Exception:
        pass
    target_w, target_h = _preset_dims(size_preset)
    pnos = list(range(s0, min(s0 + IMP_SLICE, total or s0 + IMP_SLICE)))
    proc, out = _run_chunk_start(srcp, pnos, True,
                                 total or s0 + IMP_SLICE, target_w, target_h)
    got = _run_chunk_collect(proc, out)
    if got is None:
        return jsonify({"ok": False, "error": "재변환 실패"}), 500
    import gzip as _gz
    sp = os.path.join(DOCS_DIR, f"{ref}.s{s0}.gz")
    tmp = "%s.tmp.%s" % (sp, uuid.uuid4().hex[:8])
    with _gz.open(tmp, "wt", encoding="utf-8") as fp:
        json.dump({"ok": True, "pages": got, "total": total or len(got)},
                  fp, ensure_ascii=False)
    os.replace(tmp, sp)
    return jsonify({"ok": True, "pages": got})


@app.route("/api/import/status", methods=["GET"])
def import_status():
    """변환 잡 진행/결과 조회 (디스크 기반 — 재시작/다중프로세스 무관).
    완료된 잡은 한 번 조회하면 폐기한다."""
    jid = request.args.get("id", "")
    out = _imp_job_load(jid)
    if not out:
        return jsonify({"ok": False, "error": "없는 작업입니다", "status": "gone"}), 404
    if out.get("status") == "working":
        # 5분 동안 진행 업데이트가 없으면 워커가 죽은 것 → 멈춤으로 확정
        try:
            if time.time() - os.path.getmtime(_imp_job_path(jid)) > 300:
                _imp_mark_stopped(_imp_job_path(jid),
                                  "변환이 중단되었습니다. 다시 가져오기를 시도해 주세요")
                out = _imp_job_load(jid) or out
        except Exception:
            pass
    if out.get("status") == "done":
        try:
            os.remove(_imp_job_path(jid))
        except Exception:
            pass
        return jsonify({"ok": True, "status": "done",
                        "kind": out.get("kind"), "title": out.get("title"),
                        "pages": out.get("pages"), "count": out.get("count"),
                        "total": out.get("total"),
                        "sizePreset": out.get("sizePreset"),
                        "docRef": out.get("docRef")})
    if out.get("status") == "error":
        try:
            os.remove(_imp_job_path(jid))
        except Exception:
            pass
        return jsonify({"ok": False, "status": "error",
                        "error": out.get("error", "변환에 실패했습니다"),
                        "detail": out.get("detail", "")})
    return jsonify({"ok": True, "status": "working",
                    "page": out.get("page", 0), "total": out.get("total", 0)})


# ============ 읽는 동안 배경 고화질 업그레이드 ============
# 큰 문서는 배경을 낮은 DPI 로 저장해 용량/시간을 아낀다.
# 사용자가 실제로 보는 쪽은 원본(.src)에서 300dpi 로 다시 렌더해
# 점점 또렷해지게 한다. (글자는 개별 텍스트 상자로 이미 분리돼 있으므로
# 배경에서는 redact 로 지운 뒤 순수 배경만 렌더한다.)
_HIBG_CACHE = {}          # (ref, pno) -> url
_HIBG_LOCK = threading.Lock()


def _render_hi_bg(src, pno, plan=None):
    """Upgrade with the SAME ownership plan, never re-detect an edited page.

    Legacy documents have no plan. Keep their existing background rather than
    replacing it with differently segmented pixels (which can duplicate figures).
    """
    if not plan or plan.get("v") != 2:
        return None
    with pymupdf.open(src) as doc:
        source_page = int(plan.get("sourcePage", pno))
        if doc[source_page].rotation:
            with pymupdf.open() as normalized:
                normalized.insert_pdf(doc, from_page=source_page, to_page=source_page)
                normalized[0].remove_rotation()
                return _pdf_save_background(normalized, 0, plan, 300, 18_000_000, prefer_vector=False)
        return _pdf_save_background(doc, source_page, plan, 300, 18_000_000,
                                    prefer_vector=False)


def _load_pdf_bg_plan(ref, pno):
    import gzip
    try:
        with gzip.open(os.path.join(DOCS_DIR, f"{ref}.bg{pno}.gz"), "rt", encoding="utf-8") as fp:
            return json.load(fp)
    except (OSError, ValueError, TypeError):
        return None


# ============ 쪽 미리보기(래스터) — '어크로뱃처럼 즉시 보이기' ============
# 논문 한 쪽은 글상자 수백 개 + 단어 span 수천 개다. 편집 DOM 을 만들기 전에는
# 아무것도 보이지 않으므로, 읽기만 할 때조차 그 비용을 다 치러야 했다.
#
# 여기서는 원본 PDF(.src)의 쪽을 **그대로 한 장의 그림으로** 구워 준다.
#   · 브라우저는 <img> 하나만 붙이면 되므로 쪽당 DOM 비용이 노드 1개다.
#   · 편집 요소는 사용자가 그 쪽을 실제로 건드릴 때만 올린다(프런트 담당).
#   · redact 없이 원본 그대로 렌더한다 — 보이는 그림은 PDF 와 100% 같다.
#
# 파일 이름은 (ref, pno, 폭) 으로 결정되는 순수 함수라, 한 번 구우면 영구
# 캐시(max-age=1y)로 재사용된다. 같은 쪽에 요청이 겹쳐도 락으로 한 번만 굽는다.
PREVIEW_WIDTHS = (480, 900, 1600)     # 똥컴 모드 / 기본(읽기) / 확대했을 때
_PREVIEW_LOCKS = {}
_PREVIEW_LOCKS_GUARD = threading.Lock()


def _preview_name(ref, pno, width):
    key = f"{ref}:{pno}:{width}".encode("utf-8")
    return "pv_%s.jpg" % hashlib.sha1(key).hexdigest()[:20]


def _preview_lock(name):
    with _PREVIEW_LOCKS_GUARD:
        lk = _PREVIEW_LOCKS.get(name)
        if lk is None:
            lk = _PREVIEW_LOCKS[name] = threading.Lock()
        return lk


def _render_preview(src, pno, width, out_path):
    """원본 PDF 의 pno 쪽을 width 픽셀 폭 JPEG 로 굽는다 (원본 그대로)."""
    doc = pymupdf.open(src)
    try:
        if pno < 0 or pno >= doc.page_count:
            return False
        page = doc[pno]
        pw = page.rect.width or 1
        zoom = max(0.2, min(6.0, float(width) / pw))
        pm = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        # ★ 임시 이름도 반드시 .jpg 로 끝내야 한다 — Pixmap.save 는 '확장자'로
        #   저장 형식을 정하므로 (out_path 뒤에 붙인) .tmp.<난수> 꼬리가 붙으면
        #   "Image format ... not in (…'jpg'…)" 로 항상 실패했다. 그 덕에 쪽
        #   미리보기는 단 한 번도 성공한 적이 없었고, 클라이언트는 3쪽 실패
        #   (_pvFailed ≥3 → _pvUnsupported) 뒤 미리보기를 포기해 가져온 논문을
        #   전부 무거운 '요소 DOM 경로'(쪽당 수백 글상자 × 수천 span)로 그렸다.
        #   읽기 스크롤이 버벅이던 1순위 원인.
        tmp = "%s.tmp.%s.jpg" % (out_path, uuid.uuid4().hex[:8])
        # 글자가 포함된 전체 쪽이라 품질을 배경(62)보다 높게 잡는다.
        pm.save(tmp, jpg_quality=78)
        pm = None
        os.replace(tmp, out_path)
        return True
    finally:
        doc.close()


@app.route("/api/import/page/<ref>/<int:pno>", methods=["GET"])
def import_page_preview(ref, pno):
    """쪽 전체를 한 장의 그림으로 — 읽기 화면은 이것만으로 즉시 뜬다."""
    ref = re.sub(r"[^0-9a-zA-Z_\-]", "", ref or "")[:40]
    src = os.path.join(DOCS_DIR, f"{ref}.src")
    if not ref or not os.path.exists(src):
        return jsonify({"ok": False, "error": "원본 없음"}), 404
    try:
        width = int(request.args.get("w") or PREVIEW_WIDTHS[0])
    except (TypeError, ValueError):
        width = PREVIEW_WIDTHS[0]
    # 임의의 폭으로 무한히 굽지 않도록 미리 정한 단계로 스냅한다(캐시 적중률).
    width = min(PREVIEW_WIDTHS, key=lambda w: abs(w - width))

    name = _preview_name(ref, pno, width)
    path = os.path.join(IMG_DIR, name)
    if not os.path.exists(path):
        with _preview_lock(name):
            if not os.path.exists(path):     # 락 대기 중 다른 스레드가 구웠나
                try:
                    if not _render_preview(src, pno, width, path):
                        return jsonify({"ok": False, "error": "없는 쪽"}), 404
                except Exception as e:
                    print(f"[preview] {ref} {pno}쪽 실패: {e}")
                    return jsonify({"ok": False, "error": str(e)}), 500
    resp = send_from_directory(IMG_DIR, name)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@app.route("/api/import/bg/<ref>/<int:pno>", methods=["GET"])
def import_hibg(ref, pno):
    """특정 쪽 배경을 고해상도로 렌더해 URL 을 돌려준다 (읽는 중 점점 또렷해짐)."""
    ref = re.sub(r"[^0-9a-zA-Z_\-]", "", ref or "")[:40]
    src = os.path.join(DOCS_DIR, f"{ref}.src")
    if not ref or not os.path.exists(src):
        return jsonify({"ok": False, "error": "원본 없음"}), 404
    plan = _load_pdf_bg_plan(ref, pno)
    if not plan or plan.get("v") != 2:
        return jsonify({"ok": False, "error": "기존 배경 유지 (레이아웃 정보 없음)"}), 404
    digest = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()[:16]
    key = (ref, pno, digest)
    with _HIBG_LOCK:
        if key in _HIBG_CACHE:
            return jsonify({"ok": True, "url": _HIBG_CACHE[key]})
    try:
        url = _render_hi_bg(src, pno, plan)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    if not url:
        return jsonify({"ok": False, "error": "렌더 실패"}), 500
    with _HIBG_LOCK:
        _HIBG_CACHE[key] = url
        if len(_HIBG_CACHE) > 400:
            _HIBG_CACHE.pop(next(iter(_HIBG_CACHE)), None)
    return jsonify({"ok": True, "url": url})
