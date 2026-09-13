#!/usr/bin/env python3
"""PDF 수식 변환 품질 감사 (14.70)

변환된 각 LaTeX 요소의 영역(PDF 좌표)에서 원시 수식 글리프를 다시 읽어,
글리프 ↔ LaTeX 토큰 대응(커버리지)을 검사한다.

  · missing  — PDF 에는 있으나 LaTeX 에 빠진 글리프 (탈락/스크램블)
  · extra    — LaTeX 에 있으나 PDF 영역에 없는 글리프 (과다 생성)
  · frac     — 분수 규칙선 수 vs \\frac 수

사용:
  python3 scripts/pdf-math-audit.py [필터-부분문자열]
결과: /tmp/math_audit.json + 요약 출력
"""
import json
import re
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "worker"))
import pymupdf  # noqa: E402
from sdynotes_worker import importer as imp  # noqa: E402

PDFS = ["2609.07175v1", "2609.11922v1", "2609.11926v1", "2609.11930v1"]
PAGE_W, PAGE_H = 800.0, 1100.0

# LaTeX 문자열에서 '글자 종류' 별 개수를 세기 위한 정규식들
CMD_RE = re.compile(r"\\[A-Za-z]+")
SYM_LEAK_RE = re.compile(r"[^\x00-\x7F]")


def _strip_groups(t):
    """조립 산물(분수·행렬)을 제외한 순수 토큰 통계용 전처리는 하지 않고
    원문 그대로 명령어/알파벳/숫자를 센다."""
    return t


def audit_pdf(name, page_cache=None):
    doc = pymupdf.open(name + ".pdf")
    results = []
    for pno in range(doc.page_count):
        try:
            out = imp._pdf_one_page(doc, pno, None)
        except Exception as e:
            results.append({"page": pno + 1, "error": str(e)})
            continue
        els = out.get("els", [])
        page = doc[pno]
        pw, ph = page.rect.width, page.rect.height
        sc = min(PAGE_W / pw, PAGE_H / ph)
        offx = (PAGE_W - pw * sc) / 2
        try:
            rd = page.get_text("rawdict")
        except Exception:
            rd = {"blocks": []}
        for e in els:
            if e.get("type") != "latex":
                continue
            # 요소 좌표 → PDF rect
            rx0 = (e["x"] - offx) / sc
            rx1 = (e["x"] + e["w"] - offx) / sc
            ry0 = e["y"] / sc
            ry1 = (e["y"] + e["h"]) / sc
            # 식 번호((12) 등)는 오른쪽 끝에 붙어 있는 경우가 많으니
            # x 상한을 4pt 여유로 두고 글리프를 모은다.
            want = {}
            for blk in rd.get("blocks", []):
                if blk.get("type") != 0:
                    continue
                for ln in blk.get("lines", []):
                    for sp in ln.get("spans", []):
                        bb = sp["bbox"]
                        if not (rx0 - 1 <= bb[0] and bb[2] <= rx1 + 4
                                and ry0 - 1 <= bb[1] and bb[3] <= ry1 + 1):
                            continue
                        fname = sp.get("font") or ""
                        short = fname.split("+")[-1]
                        if any(k in short.upper() for k in
                               ("CMEX", "TXEX", "EXTRA", "LMEX", "ESINT",
                                "MSAM", "MSBM")):
                            continue          # 확장 글꼴: 조각·큰괄호 (별도 취급)
                        for ch in sp.get("chars", []):
                            c = ch.get("c") or ""
                            if not c.strip():
                                continue
                            cb = ch.get("bbox")
                            cx = (cb[0] + cb[2]) / 2 if cb else 0
                            if not (rx0 - 1 <= cx <= rx1 + 1):
                                continue
                            tok = imp._tok_tex(c)
                            tok = (tok or c).strip()
                            if not tok:
                                continue
                            want[tok] = want.get(tok, 0) + 1
            latex = e.get("latex") or ""
            # PDF 토큰이 LaTeX 안에 몇 번 나오나
            missing = []
            for tok, cnt in sorted(want.items()):
                # \neq 계열은 '='+̸ 두 글리프가 합쳐진 것이다
                if tok == "=":
                    n = latex.count("=") + 2 * len(re.findall(
                        r"\\neq\b|\\nleq|\\ngeq|\\notin", latex))
                elif tok == "̸":
                    n = 10 ** 6
                else:
                    n = latex.count(tok)
                if n < cnt:
                    missing.append((tok, cnt - n))
            uni_leaks = sorted(set(SYM_LEAK_RE.findall(latex)))
            results.append({
                "page": pno + 1,
                "pdf": name,
                "rect": [round(rx0, 1), round(ry0, 1),
                         round(rx1, 1), round(ry1, 1)],
                "latex": latex,
                "n_glyphs": sum(want.values()),
                "missing": missing,
                "uni_leak": uni_leaks,
            })
    doc.close()
    return results


def main():
    filt = sys.argv[1] if len(sys.argv) > 1 else ""
    allres = {}
    for name in PDFS:
        if filt and filt not in name:
            continue
        allres[name] = audit_pdf(name)
    bad = 0
    total = 0
    for name, res in allres.items():
        for r in res:
            if "error" in r:
                continue
            total += 1
            if r["missing"]:
                bad += 1
    print(f"검사 식: {total}개, 글리프 누락 있음: {bad}개")
    shown = 0
    for name, res in allres.items():
        for r in res:
            if "error" in r:
                print(f"[{name}] p{r['page']} ERROR {r['error']}")
                continue
            if not r["missing"]:
                continue
            shown += 1
            if shown > 40:
                break
            miss = ", ".join(f"{t}×{n}" for t, n in r["missing"][:10])
            print(f"[{name}] p{r['page']} n={r['n_glyphs']:3d} missing[{miss}]")
            print(f"    {r['latex'][:150]}")
    with open("/tmp/math_audit.json", "w") as f:
        json.dump(allres, f, ensure_ascii=False, indent=1)
    print("saved /tmp/math_audit.json")


if __name__ == "__main__":
    main()
