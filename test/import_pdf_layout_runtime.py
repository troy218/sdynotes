#!/usr/bin/env python3
"""Actual PDFs, actual MuPDF SVG/raster output. No network or browser required."""
import copy
import gzip
import html
import json
import re
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
import pymupdf
from PIL import Image
from sdynotes_worker import importer
from sdynotes_worker.pdf_layout import font_map, text_elements, overlap, detect_regions
from sdynotes_worker.pdf_paint import filter_glyphs, SVG, _transform, _compose
from import_pdf_fixture import make_math_paper, make_paper


def plain(page):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", e.get("html", "")))
                    for e in page["els"] if e["type"] == "text")


def glyph_text(svg):
    root = ET.fromstring(svg)
    return "".join(n.get("data-text", "") for n in root.iter() if n.tag == f"{{{SVG}}}use")


class PdfLayoutRuntime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="sdy-pdf-layout-")
        cls.dir = Path(cls.temp.name)
        cls.pdf = make_paper(cls.dir / "paper.pdf")
        cls.math_pdf = make_math_paper(cls.dir / "math-paper.pdf")
        cls.img_patch = patch.object(importer, "IMG_DIR", str(cls.dir))
        cls.docs_patch = patch.object(importer, "DOCS_DIR", str(cls.dir))
        cls.img_patch.start(); cls.docs_patch.start()
        with pymupdf.open(cls.pdf) as doc:
            cls.pages = [importer._pdf_one_page(doc, i, None) for i in range(len(doc))]
        with pymupdf.open(cls.math_pdf) as doc:
            cls.math_page = importer._pdf_one_page(doc, 0, None)

    @classmethod
    def tearDownClass(cls):
        cls.img_patch.stop(); cls.docs_patch.stop(); cls.temp.cleanup()

    def image_path(self, url):
        return self.dir / url.rsplit("/", 1)[-1]

    def test_ligatures_are_searchable_without_mutating_source_identity(self):
        with pymupdf.open() as doc:
            p = doc.new_page(); p.insert_text((40, 60), "first", fontname="tiro", fontsize=12)
            lines, _ = importer._pdf_page_lines(p)
        chars = lines[0]["words"][0]["chars"]
        chars[0]["c"] = "ﬁ"
        chars[0]["b"] = (*chars[0]["b"][:2], chars[1]["b"][2], chars[0]["b"][3])
        chars.pop(1)
        els = text_elements(lines, 1, 0, lambda _: "text-ligature")
        self.assertIn("first", plain({"els": els}))
        self.assertEqual(chars[0]["c"], "ﬁ")

    def test_font_names_and_flags(self):
        cases = {"ABCDEF+NimbusRomNo9L-Regu": "times", "TimesNewRomanPS-BoldItalicMT": "times",
                 "CMR10": "cmroman", "CMUSerif-Roman": "cmroman", "CMBX12": "cmroman", "LMRoman10-Regular": "cmroman",
                 "STIXGeneral-Regular": "times", "HelveticaNeue": "arial", "ArialMT": "arial",
                 "NimbusSanL-Regu": "arial", "CourierNewPSMT": "mono"}
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(font_map(name), expected)
        self.assertEqual(font_map("TT94o00", 4), "times")
        self.assertEqual(font_map("Opaque", 8), "mono")
        self.assertNotEqual(font_map("Unknown"), "noto")

    def test_table_and_figure_do_not_merge(self):
        with pymupdf.open(self.pdf) as doc:
            figures, tables, avoid = detect_regions(doc[0], 612, 792)
        self.assertTrue(figures); self.assertTrue(tables)
        self.assertFalse(any(overlap(f["rect"], t["rect"]) > 0 for f in figures for t in tables))
        self.assertLess(max(t["rect"].y1 for t in tables), 150)
        self.assertGreater(min(f["rect"].y0 for f in figures), 180)
        # Caption and adjacent body remain editable, exactly once.
        text = plain(self.pages[0])
        for value in ("Table 1. Accuracy", "Figure 1.", "neighbouring paragraph", "Nearby body stays editable."):
            self.assertEqual(text.count(value), 1, value)
        self.assertNotIn("Validation accuracy", text, "plot labels belong to the plot, not a second text layer")

    def test_shaded_table_is_editable_without_invented_grid(self):
        page = self.pages[0]
        self.assertIn("Baseline", plain(page)); self.assertIn("21.7", plain(page))
        self.assertEqual(page["tables"], [])
        self.assertFalse(any(e.get("tbl") for e in page["els"]))
        bg = next(e for e in page["els"] if e.get("isBg"))
        self.assertTrue(bg["url"].endswith(".svg"))
        svg = self.image_path(bg["url"]).read_text()
        self.assertIn("stroke-width", svg)
        # No blanket rule wiping or white text-redaction rectangles in cells.
        url = importer._render_hi_bg(str(self.pdf), 0, page["pdfBg"])
        im = Image.open(self.image_path(url)).convert("RGB")
        px = im.getpixel((round(43*300/72), round(90*300/72)))
        self.assertLess(px[0], 240); self.assertGreater(px[2], px[0])

    def test_merged_table_uses_lossless_source_snapshot(self):
        page = self.pages[1]
        tables = [e for e in page["els"] if e.get("pdfRole") == "table"]
        self.assertEqual(len(tables), 1)
        self.assertTrue(tables[0]["url"].endswith(".png"))
        self.assertNotIn("One merged heading", plain(page))
        self.assertIn("Table II:", plain(page))
        self.assertIn("caption and the body", plain(page))

    def test_glyph_duplicates_and_invisible_ocr(self):
        text = plain(self.pages[0])
        self.assertEqual(text.count("A real duplicate layer must appear only once."), 1)
        self.assertNotIn("Invisible OCR", text)
        bg = next(e for e in self.pages[0]["els"] if e.get("isBg"))
        self.assertNotIn("Fractional", glyph_text(self.image_path(bg["url"]).read_text()))

    def test_rotated_label_and_small_image_are_not_lost(self):
        page = self.pages[1]
        self.assertIn("Horizontal text survives", plain(page))
        bg = next(e for e in page["els"] if e.get("isBg"))
        self.assertIn("ROTATED LABEL".replace(" ", ""), glyph_text(self.image_path(bg["url"]).read_text()).replace(" ", ""))
        self.assertTrue(any(e.get("pdfRole") == "figure" for e in page["els"]))

    def test_baselines_widths_and_per_run_style(self):
        texts = [e for e in self.pages[0]["els"] if e["type"] == "text"]
        self.assertTrue(all(e.get("pdfText") for e in texts))
        markup = "".join(e["html"] for e in texts)
        self.assertIn('data-pdf-base=', markup); self.assertIn('data-pdf-w=', markup)
        self.assertNotIn('data-j=', markup, "do not re-justify PDF positions")
        self.assertIn('font-style:italic', markup); self.assertIn('font-weight:700', markup)
        self.assertIn('color:#b30d0d', markup)
        self.assertTrue(any(e["x"] % 1 for e in texts), "subpixel source coordinates must survive")

    def test_simple_equation_still_has_editable_latex(self):
        equations = [e for e in self.pages[0]["els"] if e["type"] == "latex"]
        self.assertTrue(equations)
        self.assertTrue(any("mc" in e["latex"].replace(" ", "") for e in equations))

    def test_display_equation_label_is_not_inside_the_editable_formula(self):
        def ch(c, x):
            return {"c": c, "origin": (x, 10), "bbox": (x, 2, x + 5, 12)}
        chars = []
        x = 0
        for c in "E = mc":
            chars.append(ch(c, x)); x += 7 if c != " " else 6
        # TeX's hfill equation number can share a raw span without a space glyph.
        x += 50
        for c in "(2.14)":
            chars.append(ch(c, x)); x += 7
        line = {"spans": [{"font": "CMR10", "size": 10, "chars": chars}]}
        reg = importer._display_region_of_line(line)
        self.assertIsNotNone(reg)
        self.assertLess(reg[2], 80)
        self.assertNotIn("2.14", reg[4])

    def test_vector_math_fixture_preserves_nested_fraction_rows_and_label(self):
        formulas = [e["latex"] for e in self.math_page["els"] if e["type"] == "latex"]
        self.assertIn(r"\frac{1 + \frac{a}{b}}{2}", formulas)
        self.assertIn("A = B + C", formulas)
        self.assertIn("D = E + F", formulas)
        text = plain(self.math_page)
        self.assertIn("(2.14)", text)
        self.assertIn("nearby sentence stays editable", text)
        self.assertTrue(all("(2.14)" not in formula for formula in formulas))

    def test_accent_operator_and_label_do_not_break_the_formula(self):
        r"""The reported breakage: ``v \hat _{i}``, ``\mathrm{e}\mathrm{x}\mathrm{p}``
        and ``( 5 . 4 4 )`` appearing inside a display equation."""
        formulas = [e["latex"] for e in self.math_page["els"] if e["type"] == "latex"]
        target = [f for f in formulas if r"\frac" in f and "b" in f and "d" in f]
        self.assertTrue(target, formulas)
        tex = max(target, key=len)
        # The accent owns its base letter instead of dangling before a script.
        self.assertIn(r"\hat{v}", tex)
        self.assertNotRegex(tex, r"\\hat(?![A-Za-z{])")
        # A function name stays one operator, not one \mathrm per letter.
        self.assertIn(r"\exp", tex)
        self.assertNotIn(r"\mathrm{e}", tex)
        # The equation number is editable text, never part of the math.
        self.assertNotIn("5", tex)
        self.assertIn("(5.44)", plain(self.math_page))
        # Every imported formula must be parseable, or KaTeX renders a red
        # error string in place of the equation.
        for f in formulas:
            self.assertTrue(importer._latex_is_sane(f), f)
            self.assertNotRegex(f, r"\\(?:hat|widetilde|bar|mathcal|frac|sqrt)(?![A-Za-z{])")

    def test_dangling_commands_are_repaired_or_rejected(self):
        # Accent before OR after its base; both orders occur in real PDFs.
        self.assertEqual(importer._tidy_latex(r"v \hat _{i}"), r"\hat{v} _{i}")
        self.assertEqual(importer._tidy_latex(r"\hat v"), r"\hat{v}")
        self.assertEqual(importer._tidy_latex(r"\mathcal{N} \widetilde"), r"\widetilde{\mathcal{N}}")
        # A subscript that already belongs to a base is not stolen by an accent.
        self.assertEqual(importer._tidy_latex(r"\bar{g}_{\mu\nu}"), r"\bar{g}_{\mu\nu}")
        # Nothing to attach to → the command goes, the equation survives.
        self.assertFalse(importer._latex_is_sane(r"\widetilde ^{a}"))
        self.assertFalse(importer._latex_is_sane(r"\mathcal _{x}"))
        self.assertTrue(importer._latex_is_sane(r"\hat{s} = \frac{1}{2}"))
        # Digits are upright already; \mathrm{1} only makes the source unreadable.
        self.assertEqual(importer._style_latex_atom("1", "rm"), "1")
        self.assertEqual(importer._style_latex_atom("AdS", "rm"), r"\mathrm{AdS}")
        for label in ("(5.44)", "(3)", "[12]", "(A.2)"):
            self.assertTrue(importer._is_equation_label(label), label)
        for not_label in ("(x)", "(a + b)", "(5.44) = 2"):
            self.assertFalse(importer._is_equation_label(not_label), not_label)

    def test_tex_math_font_styles_and_accents_survive_reconstruction(self):
        def span(font, text):
            chars = []
            x = 0
            for c in text:
                chars.append({"c": c, "origin": (x, 10), "bbox": (x, 2, x + 5, 12)})
                x += 6
            return {"font": font, "size": 10, "chars": chars}
        tex = importer._spans_to_clean_latex([
            span("CMSY10", "O"), span("MSBM10", "R"), span("RSFS10", "I"),
            span("CMMIB10", "x"), span("CMR10", "AdS"),
        ])
        self.assertIn(r"\mathcal{O}", tex)
        self.assertIn(r"\mathbb{R}", tex)
        self.assertIn(r"\mathscr{I}", tex)
        self.assertIn(r"\boldsymbol{x}", tex)
        self.assertIn(r"\mathrm{AdS}", tex)
        self.assertEqual(importer._pdf_text_to_latex("ˆs"), r"\hat{s}")
        self.assertEqual(importer._pdf_text_to_latex("˜u"), r"\widetilde{u}")
        self.assertEqual(importer.classify_glyph("circumflex"), ("accent", r"\hat"))
        self.assertEqual(importer.classify_glyph("integraldisplay"), ("op", r"\int"))

    def test_original_pdf_is_not_mutated_by_conversion(self):
        with pymupdf.open(self.pdf) as doc:
            before = doc[0].get_pixmap().samples
            importer._pdf_one_page(doc, 0, None)
            after = doc[0].get_pixmap().samples
            self.assertEqual(before, after)

    def test_failed_snapshot_stays_in_background(self):
        with pymupdf.open(self.pdf) as doc, patch.object(importer, "_pdf_save_snapshot", return_value=None):
            page = importer._pdf_one_page(doc, 0, None)
        self.assertFalse(any(e.get("pdfRole") == "figure" for e in page["els"]))
        self.assertNotIn("Validation accuracy", plain(page))
        bg = next(e for e in page["els"] if e.get("isBg"))
        self.assertIn("Validationaccuracy", glyph_text(self.image_path(bg["url"]).read_text()).replace(" ", ""))

    def test_paint_failure_is_one_original_page_not_doubled_or_empty(self):
        with pymupdf.open(self.pdf) as doc, patch.object(importer, "_pdf_save_background", side_effect=ValueError("forced paint failure")):
            page = importer._pdf_one_page(doc, 0, None)
        self.assertEqual(page.get("importMode"), "snapshot-fallback")
        self.assertEqual(len(page["els"]), 1)
        self.assertEqual(page["els"][0]["type"], "image")

    def test_hi_resolution_reuses_immutable_plan_after_edit(self):
        pages = copy.deepcopy(self.pages)
        importer._store_pdf_bg_plans(pages, "review-test")
        self.assertNotIn("pdfBg", pages[0], "the large plan must not be sent to DOM/sync")
        plan = importer._load_pdf_bg_plan("review-test", 0)
        self.assertEqual(plan, self.pages[0]["pdfBg"])
        (self.dir / "review-test.src").write_bytes(self.pdf.read_bytes())
        # This is intentionally impossible to re-detect. Upgrade must still work.
        with patch.object(importer, "detect_page_figures_and_tables", side_effect=AssertionError("must not re-segment")):
            response = importer.app.test_client().get("/api/import/bg/review-test/0")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["ok"])
        self.assertTrue(self.image_path(response.json["url"]).exists())
        self.assertIsNone(importer._render_hi_bg(str(self.pdf), 0), "legacy background must be left alone")

    def test_repeated_text_different_graphics_does_not_hit_text_only_cache(self):
        with pymupdf.open() as doc:
            for color in [(1, 0, 0), (0, 0, 1)]:
                p = doc.new_page(); p.insert_text((40, 40), "Exactly the same page text")
                p.draw_rect((60, 80, 160, 140), color=None, fill=color)
            cache = {}
            first = importer._pdf_one_page(doc, 0, None, cache)
            second = importer._pdf_one_page(doc, 1, None, cache)
        a = self.image_path(next(e["url"] for e in first["els"] if e.get("isBg"))).read_text()
        b = self.image_path(next(e["url"] for e in second["els"] if e.get("isBg"))).read_text()
        self.assertNotEqual(a, b)

    def test_svg_identity_subtraction_preserves_overlapping_math_and_graphics(self):
        source = f'''<svg xmlns="{SVG}" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100">
          <defs><path id="font_1_1" d="M0 0h1v1z"/><path id="font_1_2" d="M0 0h3v4z"/></defs>
          <rect x="0" y="0" width="100" height="100" fill="#aaccee"/>
          <g transform="translate(10,20)"><use data-text="a" xlink:href="#font_1_1" transform="matrix(10,0,0,-10,2,3)"/>
          <use data-text="√" xlink:href="#font_1_2" transform="matrix(10,0,0,-10,2,3)"/></g>
          <path d="M0 50H100" stroke="black"/></svg>'''
        result, count = filter_glyphs(source, [(12, 23, "a")])
        self.assertEqual(glyph_text(result), "√")
        self.assertEqual(count, 1)
        self.assertNotIn('id="font_1_1"', result)
        self.assertIn("#aaccee", result); self.assertIn('stroke="black"', result)
        self.assertEqual(_compose(_transform("translate(10 20)"), _transform("scale(2)")), (2, 0, 0, 2, 10, 20))

    def test_crop_boundary_glyph_is_live_and_absent_from_snapshot(self):
        with pymupdf.open() as doc:
            p = doc.new_page(); p.insert_text((40, 60), "abcd", fontname="tiro", fontsize=14)
            ch = p.get_text("rawdict")["blocks"][0]["lines"][0]["spans"][0]["chars"][0]
            bb = ch["bbox"]
            rect = pymupdf.Rect(bb[0]-.1, bb[1]-.1, (bb[0]+bb[2])/2, bb[3]+.1)
            lines, _ = importer._pdf_page_lines(p, avoid=[rect])
            text = "".join(c["c"] for l in lines for w in l["words"] for c in w["chars"])
            self.assertEqual(text, "abcd", "half a glyph in a crop is NOT crop ownership")
            url = importer._pdf_save_snapshot(p, rect)
        im = Image.open(self.image_path(url)).convert("L")
        self.assertEqual(im.getextrema(), (255, 255), "cropped half-glyph would double the live text")

    def test_rotated_page_uses_display_coordinates_and_one_progress_callback(self):
        path = self.dir / "rotated.pdf"
        with pymupdf.open() as doc:
            p = doc.new_page(width=300, height=500)
            p.insert_text((40, 70), "Source text before rotation", fontname="tiro", fontsize=11)
            p.draw_rect((100, 130, 200, 200), color=None, fill=(.1, .2, .9))
            p.set_rotation(90)
            original = p.get_pixmap().samples
            doc.save(path)
            ticks = []
            converted = importer._pdf_one_page(doc, 0, lambda: ticks.append(1), target_w=1100, target_h=800)
            self.assertEqual(ticks, [1]); self.assertEqual(p.get_pixmap().samples, original)
            center = pymupdf.Point(150, 160) * p.rotation_matrix
        url = importer._render_hi_bg(str(path), 0, converted["pdfBg"])
        im = Image.open(self.image_path(url)).convert("RGB")
        r, _, b = im.getpixel((round(center.x*300/72), round(center.y*300/72)))
        self.assertGreater(b, 200); self.assertLess(r, 40)
        self.assertNotEqual(converted.get("importMode"), "snapshot-fallback")

    def test_dense_vector_page_skips_quadratic_segmentation(self):
        from unittest.mock import Mock
        p = Mock()
        p.get_text.return_value = {"blocks": []}
        p.get_image_info.return_value = []
        p.get_drawings.return_value = [{"rect": pymupdf.Rect(10, 10, 12, 12)} for _ in range(4001)]
        with patch("sdynotes_worker.pdf_layout._clusters", side_effect=AssertionError("quadratic work")):
            self.assertEqual(detect_regions(p, 612, 792), ([], [], []))

    def test_plan_save_failure_does_not_discard_a_good_import(self):
        pages = copy.deepcopy(self.pages)
        with patch("gzip.open", side_effect=OSError("disk unavailable")):
            importer._store_pdf_bg_plans(pages, "failed-plan")
        self.assertNotIn("pdfBg", pages[0])
        self.assertTrue(plain(pages[0]))
        self.assertTrue(any(e.get("isBg") for e in pages[0]["els"]))
        self.assertFalse(any(e.get("pdfBg") for e in pages[0]["els"]), "do not repeatedly request an unsaved plan")

    def test_subprocess_safe_mode_preserves_figures_instead_of_text_only(self):
        with pymupdf.open(self.pdf) as doc:
            page = importer._pdf_one_page_safe(doc, 0)
        self.assertEqual(page["importMode"], "snapshot-fallback")
        self.assertEqual(len(page["els"]), 1)
        self.assertTrue(self.image_path(page["els"][0]["url"]).exists())

    def test_background_is_painted_before_snapshots_in_exports(self):
        for page in self.pages:
            images = [e for e in page["els"] if e["type"] == "image"]
            self.assertTrue(images[0].get("isBg"), "a later white background must not overwrite figure snapshots")

    def test_crossing_math_glyph_stays_in_crop_when_not_live_text(self):
        with pymupdf.open() as doc:
            p = doc.new_page(); p.insert_text((40, 60), "a", fontname="symb", fontsize=20)
            span = p.get_text("rawdict")["blocks"][0]["lines"][0]["spans"][0]
            self.assertEqual(span["font"], "Symbol")
            bb = span["chars"][0]["bbox"]
            rect = pymupdf.Rect(bb[0]-.1, bb[1]-.1, (bb[0]+bb[2])/2, bb[3]+.1)
            lines, regs = importer._pdf_page_lines(p, avoid=[rect], preserve_math_glyphs=True)
            self.assertFalse(lines); self.assertFalse(regs)
            url = importer._pdf_save_snapshot(p, rect)
        self.assertLess(Image.open(self.image_path(url)).convert("L").getextrema()[0], 200,
                        "a native-only math glyph must not vanish from the crop's covered half")

    def test_upside_down_text_is_not_replaced_with_upright_letters(self):
        with pymupdf.open() as doc:
            p = doc.new_page(); p.insert_text((40, 70), "This text is upside down", fontname="tiro", fontsize=12)
            p.set_rotation(180)
            converted = importer._pdf_one_page(doc, 0, None)
        self.assertFalse(any(e["type"] == "text" for e in converted["els"]))
        self.assertTrue(any(e.get("isBg") for e in converted["els"]))
        self.assertNotEqual(converted.get("importMode"), "snapshot-fallback")


if __name__ == "__main__":
    unittest.main(verbosity=2)
