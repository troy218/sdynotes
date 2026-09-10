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


# ══════════════════════════════════════════════════════════════════════
#  14.46 · 행렬 표본 (matrix fixtures)
# ══════════════════════════════════════════════════════════════════════
#  물리·컴퓨터구조 논문의 행렬은 두 가지 형태로 PDF 에 들어온다.
#
#   · 글리프를 세로로 늘린 큰 괄호 — unicode-math(xelatex/lualatex)·Word.
#     확장 글꼴(CMEX/txex)이 아니라서 '큰 수식' 씨앗이 되지 못했다.
#   · CMEX/txex 확장 글꼴의 큰 괄호 — 고전 pdflatex. 글자 코드가 그대로
#     나오므로 /Differences 없이도 글리프 이름표로 되돌아간다.
#
#  실제 저작물 PDF 를 넣지 않기 위해 두 형태를 좌표로 직접 조판한다.
#  글자 추출 상자는 '글꼴 메트릭 상자'(ascender~descender)로 나오므로,
#  큰 구분자도 같은 기준으로 놓아야 실제 PDF 와 같은 기하가 된다.


class MatrixLay:
    """행렬 조판 도우미 — 칸 좌표와 늘린 구분자를 직접 찍는다."""

    def __init__(self, page):
        self.page = page
        self._fonts = {}

    def font(self, name):
        if name not in self._fonts:
            self._fonts[name] = pymupdf.Font(name)
        return self._fonts[name]

    def width(self, s, font="tiro", size=11):
        return self.font(font).text_length(s, fontsize=size)

    def text(self, x, base, s, font="tiro", size=11):
        self.page.insert_text((x, base), s, fontname=font, fontsize=size)
        return x + self.width(s, font, size)

    def pieces(self, x, base, pieces):
        """pieces: [(글자, 글꼴, 크기, dy)] 또는 […, dx] — a_{11} 처럼 섞인 칸."""
        cx = x
        for p in pieces:
            s, font, size, dy = p[0], p[1], p[2], p[3]
            self.page.insert_text((cx, base + dy), s, fontname=font, fontsize=size)
            cx += self.width(s, font, size) + (p[4] if len(p) > 4 else 0.0)
        return cx

    def cell_width(self, e, entry="tiit", size=11):
        if isinstance(e, str):
            return self.width(e, entry, size)
        return sum(self.width(t, f, s) + (p[4] if len(p) > 4 else 0.0)
                   for p in e for t, f, s in [(p[0], p[1], p[2])])

    @staticmethod
    def sub(base, digits, size=10):
        """a → a_{11} 모양의 조각 목록."""
        return [(base, "tiit", size, 0.0),
                ("".join(str(d) for d in digits), "tiro", round(size * 0.7, 2),
                 round(size * 0.22, 2))]

    @staticmethod
    def dots(kind, size=10, gap=None):
        """TeX 은 줄임표를 마침표 세 개로 조판한다 — 그대로 흉내낸다.

        h: \\cdots (가로) · v: \\vdots (세로) · d: \\ddots (왼쪽 위→오른쪽 아래).
        조각은 왼쪽→오른쪽으로 놓이므로 세로 줄임표는 전진 폭을 되돌린다.
        """
        gap = size * 0.32 if gap is None else gap
        adv = size * 0.25                      # Times '.' 의 전진 폭 (대략)
        out = []
        for i in (-1, 0, 1):
            if kind == "h":
                out.append((".", "tiro", size, -size * 0.26, gap))
            elif kind == "v":
                out.append((".", "tiro", size, -size * (0.26 + i * 0.42), -adv))
            else:                                    # 대각선 \ddots
                out.append((".", "tiro", size, -size * (0.26 - i * 0.42), gap))
        return out

    def big_delim(self, x, top, height, ch, font="tiro"):
        """세로로 늘린 구분자 하나 (unicode-math 가 큰 괄호를 그리는 방식).

        추출 상자의 왼쪽이 x, 위·아래가 [top, top+height] 가 되도록 놓는다.
        실제 PDF 에서는 늘린 글리프의 추출 상자가 잉크 상자라서 오른쪽
        구분자도 '내용 바로 뒤'에서 시작한다 — 그 순서를 그대로 재현한다.
        """
        f = self.font(font)
        span = max(0.05, f.ascender - f.descender)
        size = height / span
        self.page.insert_text((x, top + height + f.descender * size), ch,
                              fontname=font, fontsize=size)
        return size

    def matrix(self, x, base0, rows, delims=("[", "]"), size=11, rowgap=21.0,
               colsep=13.0, entry="tiit", delim_font="tiro", gap=5.0):
        """rows: [[칸, …], …] — 칸은 문자열, 조각 목록, 또는 "|"(세로 막대)."""
        bar = [e == "|" for r in rows for e in r]
        colw = [0.0] * max(len(r) for r in rows)
        for row in rows:
            for j, e in enumerate(row):
                colw[j] = max(colw[j], self.cell_width(e, entry, size))
        total = sum(colw) + colsep * (len(colw) - 1)
        bases = [base0 + i * rowgap for i in range(len(rows))]
        f = self.font(entry)
        # 칸 글자의 '추출 상자' 윗선·아랫선 — 실제 PDF 도 이만큼이 잉크다.
        top = bases[0] - f.ascender * size
        bot = bases[-1] - f.descender * size
        pad = 0.05 * (bot - top)
        top, bot = top - pad, bot + pad
        for i, row in enumerate(rows):
            cx = x
            for j, e in enumerate(row):
                if e == "|":                       # 첨가 행렬의 세로 막대
                    self.big_delim(cx + (colw[j] - size * 0.35) / 2.0, top,
                                   bot - top, "|", delim_font)
                else:
                    w = self.cell_width(e, entry, size)
                    at = cx + (colw[j] - w) / 2.0
                    if isinstance(e, str):
                        self.text(at, bases[i], e, entry, size)
                    else:
                        self.pieces(at, bases[i], e)
                cx += colw[j] + colsep
        del bar
        if delims and delims[0]:
            self.big_delim(x - gap, top, bot - top, delims[0], delim_font)
        if delims and delims[1]:
            self.big_delim(x + total + gap, top, bot - top, delims[1], delim_font)
        return x + total, bot


def make_matrix_paper(path):
    """물리 논문 표본 — 늘린 글리프로 그린 행렬 다섯 개.

    파울리 행렬(2×2 대괄호) · 회전 행렬(2×2 소괄호) · 줄임표 있는 3×3 ·
    열 벡터(3×1) · 식 번호가 붙은 4×4. 행렬을 못 잡으면 칸 숫자가 본문
    글자로 흩어지고 닫는 괄호가 마지막 줄에 붙는다('1 0[ ]').
    """
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    lay = MatrixLay(page)
    lay.text(60, 70, "Matrix methods for lattice spin systems", "tibo", 14)
    for i, line in enumerate([
        "The spin algebra is generated by the Pauli matrices below.",
        "Rotations of the lattice frame keep the two by two form.",
    ]):
        lay.text(60, 100 + i * 15, line, "tiro", 10)

    # ① S_1 = [[0, 1], [1, 0]] — 파울리 행렬 (대괄호)
    lay.text(90, 180, "S", "tiit", 12)
    lay.text(97, 183, "1", "tiro", 8)
    lay.text(108, 180, "=", "tiro", 12)
    lay.matrix(140, 168, [["0", "1"], ["1", "0"]], ("[", "]"), size=12, rowgap=22)

    # ② R = [[c, -s], [s, c]] — 회전 행렬 (소괄호)
    lay.text(90, 300, "R", "tiit", 12)
    lay.text(108, 300, "=", "tiro", 12)
    lay.matrix(140, 288, [["c", "-s"], ["s", "c"]], ("(", ")"), size=12, rowgap=22, colsep=16)

    # ③ 3×3 — TeX 처럼 줄임표를 마침표 세 개로 조판한다
    lay.text(90, 425, "M", "tiit", 12)
    lay.text(112, 425, "=", "tiro", 12)
    rows = [["1", MatrixLay.dots("h"), "0"],
            [MatrixLay.dots("v"), MatrixLay.dots("d"), MatrixLay.dots("v")],
            ["0", MatrixLay.dots("h"), "1"]]
    lay.matrix(150, 405, rows, ("[", "]"), size=11, rowgap=21, colsep=14)

    # ④ 열 벡터 (3×1, 소괄호)
    lay.text(90, 545, "v", "tiit", 12)
    lay.text(108, 545, "=", "tiro", 12)
    lay.matrix(140, 530, [["x"], ["y"], ["z"]], ("(", ")"), size=11, rowgap=19, colsep=8)

    # ⑤ 4×4 + 식 번호 — 번호는 수식이 아니라 편집 가능한 글자로 남는다
    lay.text(70, 660, "H", "tiit", 12)
    lay.text(92, 660, "=", "tiro", 12)
    rows = [[MatrixLay.sub("h", [i + 1, j + 1], 10) for j in range(4)] for i in range(4)]
    end, _ = lay.matrix(110, 645, rows, ("[", "]"), size=10, rowgap=17, colsep=11)
    lay.text(end + 45, 690, "(3.7)", "tiro", 11)
    lay.text(60, 760, "Every row above keeps its own baseline.", "tiro", 10)
    doc.save(path)
    doc.close()
    return Path(path)


def make_arch_matrix_paper(path):
    """컴퓨터 구조 논문 표본 — 첨자가 든 4×4 · 첨가 행렬 · 블록 행렬."""
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    lay = MatrixLay(page)
    lay.text(60, 70, "Dependence analysis for systolic array scheduling", "tibo", 13)
    for i, line in enumerate([
        "The iteration space is described by the dependence matrix D.",
        "A valid schedule exists whenever the system below is consistent.",
    ]):
        lay.text(60, 100 + i * 15, line, "tiro", 10)

    # ① 4×4 의존 행렬 (칸마다 아래첨자 두 개)
    lay.text(90, 180, "D", "tiit", 12)
    lay.text(112, 180, "=", "tiro", 12)
    rows = [[MatrixLay.sub("d", [i + 1, j + 1], 11) for j in range(4)] for i in range(4)]
    lay.matrix(145, 165, rows, ("[", "]"), size=11, rowgap=19, colsep=12)

    # ② 첨가 행렬 [A | b] — 가운데 세로 막대가 열을 가른다
    aug = [[MatrixLay.sub("a", [1, 1], 10), MatrixLay.sub("a", [1, 2], 10), "|",
            MatrixLay.sub("b", [1], 10)],
           [MatrixLay.sub("a", [2, 1], 10), MatrixLay.sub("a", [2, 2], 10), "|",
            MatrixLay.sub("b", [2], 10)]]
    lay.matrix(175, 410, aug, ("[", "]"), size=10, rowgap=20, colsep=12)

    # ③ 블록 행렬 (중괄호)
    lay.text(90, 530, "B", "tiit", 12)
    lay.text(112, 530, "=", "tiro", 12)
    lay.matrix(145, 515, [["A", "0"], ["0", "C"]], ("{", "}"), size=11, rowgap=22, colsep=15)

    lay.text(60, 620, "The blocks are independent by construction.", "tiro", 10)
    doc.save(path)
    doc.close()
    return Path(path)


def _raw_pdf(path, ops, height=792):
    """글자 코드를 그대로 심는 최소 PDF — 확장 글꼴(CMEX) 표본용.

    pdflatex(Type1) 은 /Differences 없이 글꼴 자체 인코딩으로 큰 괄호를
    찍는다. CMEX 코드 22/23 은 bracketleftbigg/bracketrightbigg,
    18/19 는 parenleftbigg/parenrightbigg 다.
    """
    body = bytearray()
    for font, size, x, y, raw in ops:
        body += b"BT /%s %s Tf 1 0 0 1 %s %s Tm <%s> Tj ET\n" % (
            font.encode(), ("%.2f" % size).encode(), ("%.2f" % x).encode(),
            ("%.2f" % (height - y)).encode(), raw.hex().encode())
    content = bytes(body)
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 %d] /Contents 4 0 R "
         b"/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>" % height),
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /CMEX10 >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offs = []
    for i, o in enumerate(objs, start=1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objs) + 1, xref)
    Path(path).write_bytes(bytes(out))
    return Path(path)


def _cmex_metrics():
    """CMEX10 은 내장 글꼴이 아니라 MuPDF 가 대체 글꼴로 읽는다.

    큰 괄호 '추출 상자'가 글자 크기의 몇 배인지 한 번 재 두면, 표본의
    구분자를 내용 높이에 딱 맞춰 놓을 수 있다(환경마다 대체 글꼴이 달라도
    같은 결과가 나온다).
    """
    import tempfile
    with tempfile.TemporaryDirectory(prefix="sdy-cmex-") as tmp:
        probe = Path(tmp) / "probe.pdf"
        _raw_pdf(probe, [("F1", 100, 100, 400, bytes([22]))])
        with pymupdf.open(probe) as doc:
            for blk in doc[0].get_text("rawdict").get("blocks", []):
                for ln in blk.get("lines", []):
                    for sp in ln.get("spans", []):
                        bb = sp["bbox"]
                        return (400 - bb[1]) / 100.0, (bb[3] - 400) / 100.0
    return 1.05, 0.28


def make_tex_matrix_paper(path):
    """pdflatex(CMEX) 표본 — 확장 글꼴 큰 괄호로 조판한 행렬 두 개.

    이 경로는 예전에도 '큰 수식' 으로 잡혔지만, 안쪽을 x 순서로만 읽어
    \\left[ a b c d \\right] 처럼 행·열이 뭉개졌다.
    """
    asc, desc = _cmex_metrics()
    ops = [("F2", 12, 60, 70, b"Matrix delimiters drawn with CMEX"),
           ("F2", 10, 60, 100, b"The bracketed arrays keep rows and columns.")]

    def delim(x, top, bot, code):
        size = (bot - top) / max(0.05, asc + desc)
        ops.append(("F1", size, x, top + asc * size, bytes([code])))

    # ① 2×2 bmatrix: 코드 22 = bracketleftbigg, 23 = bracketrightbigg
    #    칸은 Times-Italic 11pt — asc .951 / desc .27 (추출 상자 기준)
    top, bot = 195 - 0.951 * 11, 225 + 0.27 * 11
    pad = 0.06 * (bot - top)
    delim(230, top - pad, bot + pad, 22)          # 실제 PDF 처럼 칸에 딱 붙인다
    delim(292, top - pad, bot + pad, 23)
    for i, row in enumerate([(b"a", b"b"), (b"c", b"d")]):
        for j, e in enumerate(row):
            ops.append(("F3", 11, 240 + j * 45, 195 + i * 30, e))
    # ② 3×1 pmatrix (열 벡터): 코드 18 = parenleftbigg, 19 = parenrightbigg
    top, bot = 370 - 0.951 * 11, 426 + 0.27 * 11
    pad = 0.06 * (bot - top)
    delim(218, top - pad, bot + pad, 18)
    delim(236, top - pad, bot + pad, 19)
    for i, e in enumerate((b"x", b"y", b"z")):
        ops.append(("F3", 11, 228, 370 + i * 28, e))
    return _raw_pdf(path, ops)


if __name__ == "__main__":
    import sys
    make_paper(sys.argv[1])
    if len(sys.argv) > 2:
        make_matrix_paper(sys.argv[2])
        make_arch_matrix_paper(sys.argv[3] if len(sys.argv) > 3 else "arch-matrix.pdf")
        make_tex_matrix_paper(sys.argv[4] if len(sys.argv) > 4 else "tex-matrix.pdf")
