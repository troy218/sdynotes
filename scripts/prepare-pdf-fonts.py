#!/usr/bin/env python3
"""Repackage upstream CMU Serif WOFFs for SDYnotes (optional maintainer tool).

pip install 'fonttools[woff]'
python scripts/prepare-pdf-fonts.py DIRECTORY_WITH_CMU_WOFF_FILES

The OFL reserves the upstream family name. Use a distinct internal family for
these format-converted derivatives; retain the original copyright/license and
all glyph outlines, character maps, advances and metrics.
"""
import argparse
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FACES = {"cmunrm": "Regular", "cmunbx": "Bold", "cmunti": "Italic", "cmunbi": "Bold Italic"}
FAMILY = "SDY Academic Serif"


def convert(source, destination):
    destination.mkdir(parents=True, exist_ok=True)
    for filename, style in FACES.items():
        font = TTFont(source / (filename + ".woff"), recalcTimestamp=False)
        ps_name = "SDYAcademicSerif-" + style.replace(" ", "")
        full_name = FAMILY + " " + style
        replacements = {1: FAMILY, 2: style, 3: ps_name + ";SDY-2026", 4: full_name,
                        6: ps_name, 16: FAMILY, 17: style}
        for name in font["name"].names:
            if name.nameID in replacements:
                name.string = replacements[name.nameID].encode(name.getEncoding())
        if "CFF " in font:
            cff = font["CFF "].cff
            cff.fontNames = [ps_name]
            cff.topDictIndex[0].FamilyName = FAMILY
            cff.topDictIndex[0].FullName = full_name
        font.flavor = "woff2"
        font.save(destination / (filename + ".woff2"))
        font.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, default=ROOT / "server/assets/fonts")
    args = parser.parse_args()
    convert(args.source, args.out)
