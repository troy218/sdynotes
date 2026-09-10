#!/usr/bin/env python3
"""Scan real PDFs and report how their matrices come back. (14.46)

    python3 scripts/import-pdf-matrix-scan.py paper1.pdf paper2.pdf
    python3 scripts/import-pdf-matrix-scan.py thesis.pdf --pages 1-12 --json out.json
    python3 scripts/import-pdf-matrix-scan.py *.pdf --quiet

물리·컴퓨터구조 논문 여러 편을 그대로 넣어 '행렬이 행·열로 복원되는지' 확인하는
도구다. PDF 는 저장소에 넣지 않는다(표본은 test/import_pdf_fixture.py 가 조판).

· 페이지마다 복원된 수식을 그대로 보여 주고, 행렬은 환경 이름으로 표시한다.
· KaTeX 가 거부할 모양(_latex_is_sane 통과 실패)은 경고로 알린다.
· 행렬이 미처 잡히지 못한 흔적(칸 숫자만 본문에 남은 줄)도 함께 알린다.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
import pymupdf  # noqa: E402
from sdynotes_worker import importer  # noqa: E402

_MAT_ENV = re.compile(r"\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|array)\}")
# 행렬이 통째로 놓친 자리에 남는 흔적: 한 줄이 낱글자/숫자로만 이루어진 글상자
_LOOSE = re.compile(r"(^|\s)(?:[0-9A-Za-z]\.?\s){3,}")


def parse_pages(spec, total):
    """'1-12', '1,3,5' → 0-based 쪽 번호 목록."""
    if not spec:
        return list(range(total))
    out = set()
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            out.update(range(max(0, int(a) - 1), min(total, int(b or total))))
        else:
            out.add(int(part) - 1)
    return sorted(i for i in out if 0 <= i < total)


def scan(path, pages=None, quiet=False):
    report = {"file": str(path), "pages": []}
    with pymupdf.open(path) as doc:
        for idx in parse_pages(pages, doc.page_count):
            try:
                page = importer._pdf_one_page(doc, idx, None)
            except Exception as e:
                report["pages"].append({"page": idx + 1, "error": str(e)})
                continue
            lx = [e["latex"] for e in page["els"] if e["type"] == "latex"]
            txt = []
            for e in page["els"]:
                if e["type"] != "text":
                    continue
                plain = re.sub(r"<[^>]+>", "", e.get("html", "")).strip()
                if plain:
                    txt.append(plain)
            mats = []
            for t in lx:
                for m in _MAT_ENV.finditer(t):
                    mats.append(m.group(1))
            entry = {
                "page": idx + 1,
                "matrices": sorted(mats),
                "formulas": lx,
                "warnings": [],
            }
            for t in lx:
                if not importer._latex_is_sane(t):
                    entry["warnings"].append(f"KaTeX 가 거부할 수식: {t}")
            for t in txt:
                if _LOOSE.search(t):
                    entry["warnings"].append(f"행렬 칸이 흩어진 것 같은 글상자: {t[:70]}")
            report["pages"].append(entry)
            if not quiet:
                head = (", ".join(sorted(set(mats))) or "-") if mats else "-"
                print(f"  p{idx + 1:<3} 행렬 {head:<24} 수식 {len(lx)}개")
                for w in entry["warnings"]:
                    print(f"       ⚠ {w}")
    return report


def main():
    ap = argparse.ArgumentParser(description="PDF 행렬 복원 점검")
    ap.add_argument("pdfs", nargs="+", help="PDF 파일 (여러 개 가능)")
    ap.add_argument("--pages", default="", help="쪽 범위 (예: 1-12 또는 1,3,5)")
    ap.add_argument("--json", default="", help="결과를 JSON 으로 저장")
    ap.add_argument("--quiet", action="store_true", help="경고만 출력")
    args = ap.parse_args()

    reports = []
    for p in args.pdfs:
        path = Path(p)
        if not path.exists():
            print(f"❌ 없는 파일: {p}")
            continue
        if not args.quiet:
            print(f"── {path.name}")
        reports.append(scan(path, args.pages, args.quiet))

    total = sum(len(r["pages"][0]["matrices"]) if False else
                sum(len(pg.get("matrices", [])) for pg in r["pages"]) for r in reports)
    warned = sum(1 for r in reports for pg in r["pages"] if pg.get("warnings"))
    print(f"\n행렬 {total}개 · 경고 있는 쪽 {warned}개 "
          f"(쪽 {sum(len(r['pages']) for r in reports)}개)")
    if args.json:
        Path(args.json).write_text(json.dumps(reports, ensure_ascii=False, indent=1))
        print(f"JSON 저장: {args.json}")


if __name__ == "__main__":
    main()
