"""Remove emitted PDF glyphs by identity/origin, NOT intersecting font bboxes.

A TeX radical's font bbox can cover several neighbouring body lines. PDF text
redaction deletes any intersecting glyph, so it can erase that radical even when
redacting just an ordinary word. MuPDF's outlined SVG has one data-text <use> per
glyph: subtract only the exact glyphs painted by the editor, preserving all other
paths, images, clipping, rules and fills. No SVG comes from user HTML.
"""
import math
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import defaultdict

SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XLINK)
IDENTITY = (1, 0, 0, 1, 0, 0)


def _compose(p, q):
    a, b, c, d, e, f = p
    g, h, i, j, k, l = q
    return (a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f)


def _transform(value):
    result = IDENTITY
    for name, values in re.findall(r"([A-Za-z]+)\s*\(([^)]*)\)", value or ""):
        v = [float(n) for n in re.findall(r"[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?", values)]
        if name == "matrix" and len(v) == 6:
            m = tuple(v)
        elif name == "translate" and len(v) in (1, 2):
            m = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif name == "scale" and len(v) in (1, 2):
            m = (v[0], 0, 0, v[-1], 0, 0)
        elif name == "rotate" and len(v) in (1, 3):
            angle = math.radians(v[0]); cs, sn = math.cos(angle), math.sin(angle)
            m = (cs, sn, -sn, cs, 0, 0)
            if len(v) == 3:
                m = _compose((1, 0, 0, 1, v[1], v[2]), _compose(m, (1, 0, 0, 1, -v[1], -v[2])))
        else:
            raise ValueError(f"Unsupported generated SVG transform: {name}")
        result = _compose(result, m)
    return result


def _normal(text):
    return unicodedata.normalize("NFKC", text or "")


def filter_glyphs(svg, glyphs, regions=()):
    """glyphs = [(PDF origin x, origin y, Unicode text), ...]."""
    root = ET.fromstring(svg)
    positions = defaultdict(list)
    for x, y, text in glyphs:
        positions[(round(x * 10), round(y * 10))].append((x, y, _normal(text)))
    remaining = 0

    def walk(parent, transform=IDENTITY):
        nonlocal remaining
        for node in list(parent):
            if node.tag == f"{{{SVG}}}defs":
                continue
            matrix = _compose(transform, _transform(node.get("transform")))
            if node.tag == f"{{{SVG}}}use" and node.get("data-text") is not None:
                xx, yy = float(node.get("x", 0)), float(node.get("y", 0))
                x = matrix[0]*xx + matrix[2]*yy + matrix[4]
                y = matrix[1]*xx + matrix[3]*yy + matrix[5]
                qx, qy = round(x*10), round(y*10)
                text = _normal(node.get("data-text"))
                owned = any(text == t and abs(x-ox) < .06 and abs(y-oy) < .06
                            for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                            for ox, oy, t in positions.get((qx+dx, qy+dy), ()))
                if owned:
                    parent.remove(node)
                    continue
                if text.strip():
                    remaining += 1
            walk(node, matrix)
    walk(root, _transform(root.get("transform")))
    # Remove unused font outlines; a text-only page needs no big font dictionary
    # after all its text has become editable. Keep all non-font definitions.
    used = {n.get(f"{{{XLINK}}}href", "")[1:] for n in root.iter() if n.tag == f"{{{SVG}}}use"}
    for defs in root.findall(f"{{{SVG}}}defs"):
        for node in list(defs):
            identifier = node.get("id", "")
            if identifier.startswith("font_") and identifier not in used:
                defs.remove(node)
    for x0, y0, x1, y1 in regions:
        ET.SubElement(root, f"{{{SVG}}}rect", {"x": str(x0), "y": str(y0),
                      "width": str(x1-x0), "height": str(y1-y0), "fill": "white"})
    return ET.tostring(root, encoding="unicode"), remaining
