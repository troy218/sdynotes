#!/usr/bin/env python3
"""Baseline + regression scan of the four uploaded papers. (14.70)

    python3 scripts/pdf-math-scan.py [filter-substr]

변환 엔진(importer)이 네 PDF에서 뽑아낸 LaTeX 수식을 전부 수집해
 · KaTeX 로 렌더링이 되는지 (throwOnError)
 · 원본 PDF 의 수식 글꼴 영역(CMMI/CMSY/CMEX/MSBM/EUFM/tx*)이
   LaTeX 요소로 덮이는지 (놓친 디스플레이 수식 탐지)
를 JSON 으로 /tmp/pdf_math_scan.json 에 남긴다.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "worker"))
import pymupdf  # noqa: E402
from sdynotes_worker import importer  # noqa: E402

PDFS = ["2609.07175v1", "2609.11922v1", "2609.11926v1", "2609.11930v1"]
MATH_FONT_RE = re.compile(
    r"(cmmi|cmsy|cmex|cmbsy|msam|msbm|eufm|rsfs|txmi|txsy|txex|bbm|wasy|stmary|esint)",
    re.I,
)
UNI_RE = re.compile(r"[^\x00-\x7F]")


def page_math_spans(doc, pno, sc, offx):
    """PDF 좌표 수식 글꼴 span → 요소 좌표계(x,y,w,h) 목록."""
    out = []
    d = doc[pno].get_text("dict")
    for blk in d["blocks"]:
        if blk.get("type") != 0:
            continue
        for ln in blk["lines"]:
            for sp in ln["spans"]:
                if not MATH_FONT_RE.search(sp["font"]):
                    continue
                x0, y0, x1, y1 = sp["bbox"]
                out.append({
                    "text": sp["text"], "font": sp["font"],
                    "x": int(round(x0 * sc + offx)), "y": int(round(y0 * sc)),
                    "x1": int(round(x1 * sc + offx)), "y1": int(round(y1 * sc)),
                })
    return out


def scan(name):
    res = {"file": name, "pages": {}, "latex_count": 0, "katex_fail": 0,
           "unicode_leak": 0}
    with pymupdf.open(ROOT / f"{name}.pdf") as doc:
        for pno in range(doc.page_count):
            page = doc[pno]
            pw, ph = page.rect.width, page.rect.height
            sc = min(800.0 / pw, 1100.0 / ph)
            offx = (800.0 - pw * sc) / 2
            try:
                out = importer._pdf_one_page(doc, pno, None)
            except Exception as e:
                res["pages"][pno] = {"error": repr(e)[:200]}
                continue
            lxs = []
            for el in out["els"]:
                if el.get("type") != "latex":
                    continue
                res["latex_count"] += 1
                tex = el.get("latex") or ""
                entry = {"latex": tex, "display": el.get("displayMath"),
                         "x": el["x"], "y": el["y"], "w": el["w"], "h": el["h"]}
                if UNI_RE.search(tex):
                    entry["unicode"] = sorted(set(UNI_RE.findall(tex)))
                    res["unicode_leak"] += 1
                lxs.append(entry)
            # 커버리지: 수식 글꼴 span 의 중심이 LaTeX 요소 안에 있는가
            uncovered = []
            for ms in page_math_spans(doc, pno, sc, offx):
                cx = (ms["x"] + ms["x1"]) // 2
                cy = (ms["y"] + ms["y1"]) // 2
                hit = False
                for e in lxs:
                    if e["x"] <= cx <= e["x"] + e["w"] and e["y"] <= cy <= e["y"] + e["h"]:
                        hit = True
                        break
                if not hit:
                    uncovered.append(ms)
            if lxs or uncovered:
                res["pages"][pno] = {"latex": lxs, "uncovered": uncovered}
    return res


if __name__ == "__main__":
    filt = sys.argv[1] if len(sys.argv) > 1 else ""
    allres = {}
    for name in PDFS:
        if filt and filt not in name:
            continue
        if not (ROOT / f"{name}.pdf").exists():
            print(f"{name}: .pdf 없음 — 건너뜀")
            continue
        r = scan(name)
        allres[name] = r
        print(f"{name}: latex={r['latex_count']} uni_leak={r['unicode_leak']} "
              f"pages_with_math={len(r['pages'])}")
    Path("/tmp/pdf_math_scan.json").write_text(json.dumps(allres, ensure_ascii=False))
    print("saved /tmp/pdf_math_scan.json")
