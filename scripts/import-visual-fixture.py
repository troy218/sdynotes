#!/usr/bin/env python3
"""Make a local, private PDF → editor visual-review fixture (no external services).

Usage: python scripts/import-visual-fixture.py --out import_uploads/review paper.pdf:1,3,5
Page numbers are 1-based. PDFs, images and generated JSON stay OUT of Git.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
import pymupdf
from PIL import Image
from sdynotes_worker import importer


def make_fixture(specs, out):
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    cases = []
    for spec in specs:
        path, sep, selection = spec.rpartition(":")
        if not sep or not all(c.isdigit() or c == "," for c in selection):
            path, selection = spec, "1"
        source = Path(path).resolve()
        with pymupdf.open(source) as doc:
            for number in map(int, selection.split(",")):
                if not 1 <= number <= doc.page_count:
                    raise ValueError(f"{source}: page {number} outside 1..{doc.page_count}")
                pno = number - 1
                page = doc[pno]
                w, h = importer._preset_dims(importer._pdf_size_preset(str(source)))
                scale = min(w / page.rect.width, h / page.rect.height)
                pm = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
                original = Image.new("RGB", (w, h), "white")
                original.paste(Image.frombytes("RGB", (pm.width, pm.height), pm.samples),
                               (round((w - pm.width) / 2), 0))
                case_id = f"{source.stem}-{number}"
                original.save(out / f"{case_id}-original.png")
                # Record the untouched source BEFORE conversion. The high-res
                # path independently reloads it using the same immutable plan.
                converted = importer._pdf_one_page(doc, pno, None, target_w=w, target_h=h)
                hi = importer._render_hi_bg(str(source), pno, converted.get("pdfBg"))
                cases.append({"id": case_id, "source": str(source), "page": number,
                              "width": w, "height": h, "original": f"{case_id}-original.png",
                              "converted": converted, "hiBg": hi,
                              "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest()})
                print(f"{case_id}: {len(converted['els'])} elements", flush=True)
    manifest = out / "manifest.json"
    manifest.write_text(json.dumps({"cases": cases}, ensure_ascii=False), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", nargs="+")
    parser.add_argument("--out", default="import_uploads/review")
    args = parser.parse_args()
    print(make_fixture(args.pdf, args.out))
