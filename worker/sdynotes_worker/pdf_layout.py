"""Geometry and typography shared by PDF import and background upgrades.

Be conservative: uncertain artwork stays on the page background. A caption is
not permission to rasterize everything in the preceding half-page.
"""
import html
import math
import re
from collections import Counter

import pymupdf


# Standard text ligatures become searchable/copied letters. Their original
# glyph advance is retained; the paint plan still identifies the original glyph.
LIGATURES = str.maketrans({"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"})

# 실제 글꼴 이름을 먼저 두어 OS 에 그 글꼴이 있으면 진짜로 그린다(라벨과 일치).
# 번들 유사글꼴(SDY Times/Tinos · SDY Helvetica/Arimo)은 그 글꼴이 없을 때만 대체한다.
FONT_CSS = {
    "times": "'Times New Roman','Liberation Serif','SDY Times',serif",
    "cmroman": "'SDY Computer Modern','Latin Modern Roman','Times New Roman',serif",
    "arial": "'Arial','Helvetica','Liberation Sans','SDY Helvetica',sans-serif",
    "mono": "'Courier New','Liberation Mono',monospace",
    "myeongjo": "'Nanum Myeongjo',serif",
    "pretendard": "'Pretendard Variable','Pretendard',sans-serif",
}


def font_map(name, flags=0):
    n = re.sub(r"[^a-z0-9]", "", (name or "").split("+")[-1].lower())
    if any(k in n for k in ("courier", "nimbusmon", "mono", "consolas", "cmtt", "lmmono")):
        return "mono"
    if (re.match(r"(?:cm(?:r|bx|b|ti|mi|ss|sl|u|csc)\d|lmroman|lmr\d|cmun)", n)
            or "computermodern" in n or "cmuserif" in n):
        return "cmroman"
    if any(k in n for k in ("batang", "myeongjo", "myungjo")):
        return "myeongjo"
    if any(k in n for k in ("times", "nimbusrom", "termes", "tinos", "stix", "xits",
                            "minion", "palatino", "palladio", "bookantiqua", "garamond", "georgia")):
        return "times"
    if any(k in n for k in ("helv", "arial", "arimo", "nimbussan", "heros", "roboto", "sans")):
        return "arial"
    if any("\uac00" <= c <= "\ud7af" for c in (name or "")):
        return "myeongjo" if any(k in name for k in ("명조", "바탕")) else "pretendard"
    # PDF flags: fixed-pitch=8, serif=4. Opaque names such as TT94o00
    # still carry these descriptors. Never return the nonexistent 'noto' ID.
    return "mono" if flags & 8 else "times" if flags & 4 else "arial"


def rect_area(r):
    return max(0.0, r[2] - r[0]) * max(0.0, r[3] - r[1])


def overlap(a, b):
    return max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def contained(bb, regions, tolerance=0.35):
    """Whole glyph ownership, NOT 'half of a line overlaps the picture'."""
    return any(a[0] - tolerance <= bb[0] and a[1] - tolerance <= bb[1]
               and a[2] + tolerance >= bb[2] and a[3] + tolerance >= bb[3] for a in regions or [])


def intersects(bb, regions):
    return any(overlap(bb, a) > 0 for a in regions or [])


def _union(rects):
    return pymupdf.Rect(min(r[0] for r in rects), min(r[1] for r in rects),
                        max(r[2] for r in rects), max(r[3] for r in rects))


def _inflate(r, x, y=None):
    y = x if y is None else y
    return pymupdf.Rect(r[0] - x, r[1] - y, r[2] + x, r[3] + y)


def _gap(a, b):
    return max(0, a[0] - b[2], b[0] - a[2]), max(0, a[1] - b[3], b[1] - a[3])


_CAPTION = re.compile(r"^(figure|fig\.?|table|tab\.?)\s*(?:S?\d+|[IVXLCDM]+)(?=[\s.:\-–—]|$)", re.I)


def _page_text(page):
    rd = page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)
    lines, captions = [], []
    for bi, block in enumerate(rd.get("blocks", [])):
        if block.get("type") != 0:
            continue
        block_lines = []
        for ln in block.get("lines", []):
            text = "".join(s.get("text", "") for s in ln.get("spans", [])).strip()
            if text:
                block_lines.append({"rect": pymupdf.Rect(ln["bbox"]), "text": text,
                                    "spans": ln["spans"], "block": bi, "dir": ln.get("dir", (1, 0))})
        lines.extend(block_lines)
        # Captions can share a PDF block with adjacent body text. Only the
        # caption line and its following lines are candidates, never the block bbox.
        for i, line in enumerate(block_lines):
            m = _CAPTION.match(line["text"])
            if m:
                cap_lines = [line]
                for nxt in block_lines[i + 1:]:
                    prev = cap_lines[-1]["rect"]
                    if nxt["rect"].y0 - prev.y1 > 5 or abs(nxt["rect"].x0 - line["rect"].x0) > 16:
                        break
                    cap_lines.append(nxt)
                captions.append({"rect": _union([l["rect"] for l in cap_lines]),
                                 "text": " ".join(l["text"] for l in cap_lines),
                                 "kind": "table" if m[1].lower().startswith("ta") else "figure"})
    return lines, captions


def _is_prose(line):
    text = line["text"]
    words = re.findall(r"[A-Za-z]{2,}", text)
    return (len(text) >= 85 or len(words) >= 9
            or (len(words) >= 4 and text.endswith("."))
            or (len(words) >= 6 and text.endswith((",", ";"))))


def _clusters(rects, gap=6):
    """Small connected components; page-spanning rules are not giant unions."""
    out = []
    for rect in rects:
        r = pymupdf.Rect(rect)
        changed = True
        while changed:
            changed = False
            keep = []
            for o in out:
                gx, gy = _gap(r, o)
                if gx <= gap and gy <= gap:
                    r = _union([r, o]); changed = True
                else:
                    keep.append(o)
            out = keep
        out.append(r)
    return out


def _between(a, b):
    if a.y1 <= b.y0:
        return pymupdf.Rect(max(a.x0, b.x0), a.y1, min(a.x1, b.x1), b.y0)
    if b.y1 <= a.y0:
        return pymupdf.Rect(max(a.x0, b.x0), b.y1, min(a.x1, b.x1), a.y0)
    return pymupdf.Rect()


def detect_regions(page, pw, ph):
    """Return (figures, tables, snapshot rectangles).

    Tables are recognized before figures, captions stay editable, and unrelated
    components cannot bridge an intervening paragraph or another caption.
    Simple table text is editable over the ORIGINAL rules/fills. Complex tables
    (merged cells, extension glyphs) use a lossless snapshot instead of a fake grid.
    """
    lines, captions = _page_text(page)
    cap_rects = [c["rect"] for c in captions]
    prose = [l["rect"] for l in lines if _is_prose(l) and not contained(l["rect"], cap_rects)]
    drawings = page.get_drawings()
    images = [pymupdf.Rect(im["bbox"]) for im in page.get_image_info()]
    rects, rules = [], []
    for d in drawings:
        r = d.get("rect")
        if r is None or not all(math.isfinite(v) for v in r):
            continue
        # Include zero-height rules (cluster_drawings intentionally omits them).
        rr = _inflate(r, max(.15, float(d.get("width") or 0) / 2))
        if rr.width > pw * .96 or rr.height > ph * .96:
            continue  # page decoration, not a figure seed
        rects.append(rr)
        if r.width >= 40 and r.height <= 3:
            rules.append(rr)
    # Extremely dense CAD/vector pages are not a licence for quadratic
    # clustering. Keep them on the original vector background instead.
    if len(rects) > 4000:
        return [], [], []
    components = _clusters(rects)

    # Booktabs: match rule extents, then chain ONLY across clear gaps. Using a
    # fixed 400-point search window used to include the next table/paragraph.
    chains = []
    for r in sorted(rules, key=lambda r: r.y0):
        match = None
        for chain in reversed(chains):
            prev = chain[-1]
            bridge = _between(prev, r)
            if (abs(r.x0 - prev.x0) < 10 and abs(r.x1 - prev.x1) < 10
                    and 0 <= r.y0 - prev.y1 < 100
                    and not intersects(bridge, prose + cap_rects)):
                match = chain; break
        if match is None:
            chains.append([r])
        else:
            match.append(r)
    candidates = [r for r in components if r.width >= 40 and r.height >= 12]
    candidates.extend(_union(c) for c in chains if len(c) >= 2)
    tables = []
    for cap in [c for c in captions if c["kind"] == "table"]:
        cr = cap["rect"]
        eligible = []
        for r in candidates:
            gx, gy = _gap(cr, r)
            hov = min(cr.x1, r.x1) - max(cr.x0, r.x0)
            if gy > 45 or gx > 0 or hov < .4 * min(cr.width, r.width):
                continue
            if intersects(r, cap_rects) or intersects(_between(cr, r), prose):
                continue
            eligible.append((gy, -r.width, r))
        if eligible:
            r = min(eligible, key=lambda x: x[:2])[2]
            if not intersects(r, [t["rect"] for t in tables]):
                tables.append({"rect": _inflate(r, .8), "caption": cap["text"], "type": "original"})

    # Grid detection provides structure evidence only. It is not a typesetter.
    try:
        finder = page.find_tables(strategy="lines_strict", paths=drawings)
        for t in finder.tables:
            grid = t.extract() or []
            filled = sum(bool(str(c or "").strip()) for row in grid for c in row)
            if t.row_count < 2 or t.col_count < 2 or filled < 6 or filled < t.row_count * t.col_count * .45:
                continue  # plot grids and network diagrams are not tables
            r = pymupdf.Rect(t.bbox)
            owner = next((x for x in tables if overlap(x["rect"], r) >= rect_area(r) * .7), None)
            if owner is None and not intersects(r, cap_rects):
                owner = {"rect": _inflate(r, .8), "caption": "", "type": "original"}
                tables.append(owner)
            if owner is not None and any(c is None for row in t.rows for c in row.cells):
                owner["snapshot"] = True
    except Exception:
        pass
    for t in tables:
        for line in lines:
            if not contained(line["rect"], [t["rect"]]):
                continue
            if abs(line["dir"][0]) < .98 or any(
                re.search(r"(?:cmex|txex|lmex)", s.get("font", ""), re.I)
                or any(ord(c) < 32 or 0xe000 <= ord(c) <= 0xf8ff or c == "\ufffd" for c in s.get("text", ""))
                for s in line["spans"]
            ):
                t["snapshot"] = True

    table_rects = [t["rect"] for t in tables]
    # Build figure components AFTER removing tables. Include small raster
    # panels, not just images over the old arbitrary 120x90 point threshold.
    seeds = [r for r in rects if not intersects(r, table_rects)]
    seeds.extend(r for r in images if r.width >= 24 and r.height >= 24 and not intersects(r, table_rects))
    components = [r for r in _clusters(seeds, 8) if r.width >= 20 and r.height >= 20]
    figures = []
    for cap in [c for c in captions if c["kind"] == "figure"]:
        cr = cap["rect"]
        eligible = []
        for r in components:
            gx, gy = _gap(cr, r)
            hov = min(cr.x1, r.x1) - max(cr.x0, r.x0)
            if r.y1 > cr.y0 + 1 or gy > 70 or gx > 0 or hov < min(cr.width, r.width) * .3:
                continue
            if intersects(r, prose + cap_rects + table_rects) or intersects(_between(cr, r), prose + table_rects):
                continue
            eligible.append((gy, r))
        if not eligible:
            continue
        r = pymupdf.Rect(min(eligible, key=lambda x: x[0])[1])
        # Multi-panel figures: only neighbouring, vertically aligned components
        # associated with THIS caption. Never union everything 450pt above it.
        for _, o in sorted(eligible, key=lambda x: x[0]):
            gx, gy = _gap(r, o)
            union = _union([r, o])
            if gx <= 65 and gy <= 18 and not intersects(union, prose + cap_rects + table_rects):
                r = union
        # Labels may sit just outside axes. Expand by complete short lines, not
        # text blocks. A paragraph and the caption itself are hard boundaries.
        for _ in range(2):
            for line in lines:
                lr = line["rect"]
                if _is_prose(line) or intersects(lr, cap_rects + table_rects) or lr.y1 > cr.y0 - .5:
                    continue
                if intersects(lr, [_inflate(r, 18, 20)]):
                    union = _union([r, lr])
                    if not intersects(union, prose + cap_rects + table_rects):
                        r = union
        r = _inflate(r, 1) & page.rect
        if not intersects(r, prose + cap_rects + table_rects + [f["rect"] for f in figures]):
            figures.append({"rect": r, "caption": cap["text"]})
    # Uncaptioned raster artwork. A full-page scanned image remains the single
    # background; invisible OCR text must not be painted over it.
    for r in images:
        if r.width < 24 or r.height < 24 or rect_area(r) > pw * ph * .9:
            continue
        if not intersects(r, prose + cap_rects + table_rects + [f["rect"] for f in figures]):
            figures.append({"rect": r, "caption": "Image"})
    avoid = [list(f["rect"]) for f in figures] + [list(t["rect"]) for t in tables if t.get("snapshot")]
    return figures, tables, avoid


def text_elements(lines, scale, offx, uid):
    """Editable positioned style runs, retaining PDF baselines and advance widths.

    No re-justification, integer rounding or inferred HTML sup/sub offsets. PDF
    source coordinates already contain the desired kerning and justification.
    """
    groups = {}
    for ln in lines:
        groups.setdefault(ln.get("blk", id(ln)), []).append(ln)
    elements = []
    for glines in groups.values():
        if not any(l["words"] for l in glines):
            continue
        x0 = min(l["x0"] for l in glines); y0 = min(l["y0"] for l in glines)
        x1 = max(l["x1"] for l in glines); y1 = max(l["y1"] for l in glines)
        spans, fonts = [], Counter()
        for ln in glines:
            for word in ln["words"]:
                runs = []
                for ch in word["chars"]:
                    f = font_map(ch.get("font", ln.get("font", "")), ch.get("flags", 0))
                    key = (f, round(ch["sz"], 3), round(ch["o"][1], 3), ch["bold"], ch["ital"], ch.get("col", 0))
                    if runs and runs[-1][0] == key:
                        runs[-1][1].append(ch)
                    else:
                        runs.append((key, [ch]))
                for ri, (key, chars) in enumerate(runs):
                    f, sz, baseline, bold, italic, color = key
                    text = "".join(c["c"] for c in chars).translate(LIGATURES)
                    fonts[f] += len(text)
                    left = min(c["b"][0] for c in chars)
                    right = max(c["b"][2] for c in chars)
                    fs = round(max(1, sz * scale), 3)
                    base = round((baseline - y0) * scale, 3)
                    width = round(max(.1, (right - left) * scale), 3)
                    style = (f"position:absolute;left:{(left-x0)*scale:.3f}px;top:{base-fs*.8:.3f}px;"
                             f"line-height:{fs}px;font-size:{fs}px;white-space:nowrap;"
                             f"font-family:{FONT_CSS[f]};font-weight:{700 if bold else 400};"
                             f"font-style:{'italic' if italic else 'normal'};color:#{(color or 0)&0xffffff:06x}")
                    space = '<i class="zsp"> </i>' if ri == len(runs) - 1 else ''
                    spans.append(f'<span data-fs="{fs}" data-pdf-w="{width}" data-pdf-base="{base}" '
                                 f'style="{html.escape(style, quote=True)}">{html.escape(text)}{space}</span>')
        elements.append({"type": "text", "id": uid("t"), "html": "".join(spans),
                         "x": round(x0 * scale + offx, 3), "y": round(y0 * scale, 3),
                         "w": round(max(1, (x1 - x0) * scale), 3), "h": round(max(1, (y1 - y0) * scale), 3),
                         "fontSize": round(max(w["size"] for l in glines for w in l["words"]) * scale, 3),
                         "font": fonts.most_common(1)[0][0], "align": glines[0].get("align", "left"),
                         "tight": 1, "pdfText": 1})
    return elements
