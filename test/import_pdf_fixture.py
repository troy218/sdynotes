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


if __name__ == "__main__":
    import sys
    make_paper(sys.argv[1])
