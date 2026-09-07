"""Small reproducible papers. No copyrighted test PDFs or network downloads."""
from pathlib import Path
import io

import pymupdf
from PIL import Image


def make_paper(path):
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((38.25, 55.4), "A paper with tables, plots and nearby prose", fontname="tibo", fontsize=15)
    # Original shaded table with thin rules and individually styled cells.
    xs, ys = [38.25, 135.75, 204.5, 277.25], [85.4, 104.4, 123.4, 142.4]
    page.draw_rect((xs[0], ys[0], xs[-1], ys[1]), color=None, fill=(.86, .91, .98))
    for y in ys:
        page.draw_line((xs[0], y), (xs[-1], y), color=(.1, .15, .25), width=.45)
    for x in xs:
        page.draw_line((x, ys[0]), (x, ys[-1]), color=(.1, .15, .25), width=.45)
    cells = [("Method", "Score", "Time"), ("Baseline", "19.5", "31.2"), ("Ours", "21.7", "22.4")]
    for ri, row in enumerate(cells):
        for ci, text in enumerate(row):
            page.insert_text((xs[ci]+5, ys[ri]+13), text, fontsize=9,
                             fontname="tibo" if ri == 0 else "tiit" if (ri, ci) == (2, 1) else "tiro",
                             color=(.7, .05, .05) if (ri, ci) == (2, 1) else (0, 0, 0))
    page.insert_text((38.25, 157.4), "Table 1. Accuracy and speed of the models.", fontname="tiro", fontsize=8.5)
    # A graph BELOW the table, not one combined table/figure snapshot.
    page.draw_rect((56, 209, 273, 323), color=(.2, .3, .5), width=.6)
    page.draw_polyline([(56, 306), (108, 258), (156, 275), (213, 229), (273, 218)], color=(.1, .4, .8), width=1.5)
    for y in (238, 266, 294):
        page.draw_line((56, y), (273, y), color=(.8, .8, .8), width=.3, dashes="[2 2]")
    page.insert_text((70, 225), "Validation accuracy", fontname="helv", fontsize=8)
    page.insert_text((52, 337), "0             20             40             60", fontname="tiro", fontsize=8)
    page.insert_text((38.25, 356), "Figure 1. The plot does not include Table 1.", fontname="tiro", fontsize=8.5)
    # The adjacent column MUST stay live text, not ride along in a plot crop.
    for i, line in enumerate([
        "The neighbouring paragraph remains editable.",
        "Its words should never be duplicated in a figure.",
        "Every line uses the original document baseline.",
        "A narrow fallback font must not change spacing.",
        "Bold and italic runs also keep their own metrics.",
    ]):
        page.insert_text((326.3, 97.15+i*14.25), line, fontname="tiro", fontsize=9.25)
    page.insert_text((285, 267), "Nearby body stays editable.", fontname="tiro", fontsize=9)
    page.insert_text((38.25, 394.4), "Fractional coordinates keep this line exactly in place.", fontname="tiro", fontsize=11.25)
    # Explicit spaces, mixed emphasis and a precisely positioned superscript.
    page.insert_text((38.25, 418.6), "Plain and", fontname="tiro", fontsize=11)
    page.insert_text((85.8, 418.6), "bold", fontname="tibo", fontsize=11)
    page.insert_text((110.2, 418.6), "italic", fontname="tiit", fontsize=11)
    page.insert_text((136.0, 414.0), "12", fontname="tiro", fontsize=7)
    page.insert_text((38.25, 451.6), "A real duplicate layer must appear only once.", fontname="tiro", fontsize=10)
    page.insert_text((38.25, 451.6), "A real duplicate layer must appear only once.", fontname="tiro", fontsize=10)
    page.insert_text((38.25, 486.2), "Invisible OCR must not be painted.", fontsize=12, render_mode=3)
    page.insert_text((290, 542.4), "E = mc", fontname="tiro", fontsize=13)
    page.insert_text((330.2, 537), "2", fontname="tiro", fontsize=8)
    page.insert_text((420, 542.4), "(1)", fontname="tiro", fontsize=11)
    page.insert_text((38, 765), "1", fontname="tiro", fontsize=10)

    page = doc.new_page(width=612, height=792)
    page.insert_text((40, 60), "Merged cells preserve their original appearance", fontname="tibo", fontsize=14)
    page.insert_text((40, 86), "Table II: Merged header, no invented interior border.", fontname="tiro", fontsize=9)
    page.draw_rect((42, 100, 382, 192), color=(.15, .15, .15), width=.8)
    page.draw_rect((42, 100, 382, 123), color=None, fill=(.91, .87, .76))
    for y in (123, 146, 169):
        page.draw_line((42, y), (382, y), color=(.15, .15, .15), width=.45)
    for x in (160, 276):
        page.draw_line((x, 123), (x, 192), color=(.15, .15, .15), width=.45)
    page.insert_text((128, 117), "One merged heading", fontname="tibo", fontsize=11)
    for r in range(3):
        for c in range(3):
            page.insert_text((50+c*114, 140+r*23), f"Value {r+1}.{c+1}", fontname="tiro", fontsize=10)
    page.insert_text((40, 224), "The caption and the body are separate editable text.", fontname="tiro", fontsize=10)
    page.insert_text((32, 415), "ROTATED LABEL", fontname="helv", fontsize=9, rotate=90)
    page.insert_text((48, 278), "Horizontal text survives a nearby rotated label.", fontname="tiro", fontsize=10)
    # Small raster panel with no caption (previously below the size threshold).
    image = Image.new("RGB", (100, 80), (91, 154, 186)); data = io.BytesIO(); image.save(data, "PNG")
    page.insert_image((420, 300, 470, 340), stream=data.getvalue())
    page.insert_text((48, 478.35), "Same words, different graphics: no page-cache collisions.", fontname="tiro", fontsize=10)
    page.insert_text((48, 515.35), "Helvetica body uses the matching sans serif.", fontname="helv", fontsize=10)
    doc.save(path)
    doc.close()
    return Path(path)


def make_math_paper(path):
    """A tiny vector-only math paper used for importer regression coverage.

    It intentionally uses ordinary Times text plus explicit fraction rules rather
    than a downloaded/copyrighted paper.  That exercises the same PDF geometry
    decisions as the target article: a label at the far right, nested fractions,
    and adjacent aligned rows that must not be swallowed by prose.
    """
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((38, 55), "Formula reconstruction fixture", fontname="tibo", fontsize=14)
    page.insert_text((38, 82), "The nearby sentence stays editable and is not part of the display.",
                     fontname="tiro", fontsize=9)

    # E = mc^2 with an equation number separated by hfill-like geometry.
    page.insert_text((60, 120), "E = mc", fontname="tiro", fontsize=16)
    page.insert_text((112, 114), "2", fontname="tiro", fontsize=10)
    page.insert_text((300, 120), "(2.14)", fontname="tiro", fontsize=12)

    # 1 + a/b over 2: two rules in one band, so the 2-D path must produce a
    # nested \frac instead of a flat reading-order string.
    page.insert_text((80, 170), "1 +", fontname="tiro", fontsize=14)
    page.insert_text((115, 162), "a", fontname="tiro", fontsize=10)
    page.draw_line((112, 168), (132, 168), color=(0, 0, 0), width=.8)
    page.insert_text((118, 183), "b", fontname="tiro", fontsize=10)
    page.draw_line((75, 197), (155, 197), color=(0, 0, 0), width=.8)
    page.insert_text((105, 218), "2", fontname="tiro", fontsize=14)

    # A two-row aligned-style display.  The rows remain separate editable math
    # elements rather than being merged with the fixture prose.
    page.insert_text((250, 280), "A = B + C", fontname="tiro", fontsize=14)
    page.insert_text((250, 305), "D = E + F", fontname="tiro", fontsize=14)

    # A positioned subscript/superscript pair for the text-vs-math classifier.
    page.insert_text((60, 365), "Q", fontname="tiro", fontsize=16)
    page.insert_text((69, 371), "i", fontname="tiro", fontsize=9)
    page.insert_text((96, 355), "2", fontname="tiro", fontsize=9)
    page.insert_text((112, 365), " = R", fontname="tiro", fontsize=16)

    _accent_display(page)

    doc.save(path)
    doc.close()
    return Path(path)


def _accent_display(page):
    r"""A physics-style display: a standalone accent glyph, an operator name and
    an equation label beside a tall nested fraction.

    This is the shape a user reported as broken.  TeX draws ``\hat v`` as two
    independent glyphs, ``exp`` as three roman letters, and puts ``(5.44)`` on
    the same baseline.  Reading them naively produced ``v \hat _{i}`` (a KaTeX
    parse error), ``\mathrm{e}\mathrm{x}\mathrm{p}`` and a literal
    ``( 5 . 4 4 )`` inside the formula.

    A TextWriter is used so the accent and the Greek letter keep their real
    Unicode code points, exactly as a LaTeX-produced PDF does.
    """
    roman, italic = pymupdf.Font("tiro"), pymupdf.Font("tiit")
    tw = pymupdf.TextWriter(page.rect)

    def put(pos, text, font=roman, size=11):
        tw.append(pos, text, font=font, fontsize=size)

    put((60, 470), "The correlator below follows from the standard integral representation.", size=10)
    put((150, 575), "C", italic, 13)
    put((162, 575), "=", roman, 13)
    put((185, 558), "exp", roman, 11)          # an operator name, not three atoms
    put((207, 558), "v", italic, 11)
    put((207.5, 551), "\u02c6", roman, 9)      # accent glyph drawn over the v
    put((214, 558), "\u03c9", italic, 11)
    page.draw_line((182, 563), (226, 563), width=.8)
    put((196, 576), "b", roman, 11)
    page.draw_line((180, 584), (230, 584), width=.9)
    put((196, 598), "c", roman, 11)
    page.draw_line((182, 604), (224, 604), width=.8)
    put((196, 618), "d", roman, 11)
    put((240, 585), "(5.44)", roman, 11)       # equation number, stays editable
    put((60, 700), "This concludes the derivation of the celestial amplitude formula.", roman, 10)
    tw.write_text(page)


if __name__ == "__main__":
    import sys
    make_paper(sys.argv[1])
