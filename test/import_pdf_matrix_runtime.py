"""PDF 불러오기 — 행렬 복원 회귀 검사 (14.46).

표본 PDF 를 직접 조판해 행렬을 넣고, 실제로 행렬로 복원되는지 확인한다.
  · 물리 쪽(파울리·회전·줄임표·열 벡터) — 큰 괄호를 '늘린 글리프' 로 그린 PDF
  · 컴퓨터 구조 쪽(의존 행렬·첨가 행렬·블록 행렬)
  · pdflatex(CMEX) 확장 글꼴 큰 괄호
행렬이 아닌 것(분수, cases, \left( … \right) 한 줄)은 그대로 두는지도 본다.
"""
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "worker"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pymupdf                                             # noqa: E402
from sdynotes_worker import importer                        # noqa: E402
import import_pdf_fixture                                   # noqa: E402


# ── 상자 조립 검사용 도우미 ────────────────────────────────────────
def bx(x0, y0, x1, y1, tex, size=11.0, role=None):
    return importer.Box(x0, y0, x1, y1, tex, size, role)


def delims(left, right, top=100.0, bot=160.0, size=40.0):
    """큰 구분자 한 쌍 (CMEX 확장 글꼴 글리프와 같은 모양)."""
    o = bx(100.0, top, 112.0, bot, left, size, "open")
    c = bx(240.0, top, 252.0, bot, right, size, "close")
    return o, c


def grid(rows, x0=130.0, y0=100.0, cw=30.0, ch=22.0, size=11.0):
    """rows: [[칸 글자, …], …] → 상자 목록 (각 칸은 글자 하나)."""
    out = []
    for i, row in enumerate(rows):
        for j, e in enumerate(row):
            out.append(bx(x0 + j * cw, y0 + i * ch,
                          x0 + j * cw + 6.0, y0 + i * ch + 13.0, e, size))
    return out


def _asm(boxes, rules=None):
    return importer._tidy_latex(importer.assemble(boxes, rules or []))


class MatrixAssembleTest(unittest.TestCase):
    """구분자 종류별 조립 + '행렬이 아닌 것' 은 건드리지 않기."""

    def test_brackets_become_bmatrix(self):
        o, c = delims("[", "]")
        t = _asm([o] + grid([["a", "b"], ["c", "d"]], y0=110.0, ch=30.0) + [c])
        self.assertEqual(t, r"\begin{bmatrix} a & b \\ c & d \end{bmatrix}")

    def test_parens_become_pmatrix(self):
        o, c = delims("(", ")")
        t = _asm([o] + grid([["a", "b"], ["c", "d"]], y0=110.0, ch=30.0) + [c])
        self.assertEqual(t, r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}")

    def test_braces_become_Bmatrix(self):
        o, c = delims(r"\{", r"\}")
        t = _asm([o] + grid([["A", "0"], ["0", "C"]], y0=110.0, ch=30.0) + [c])
        self.assertEqual(t, r"\begin{Bmatrix} A & 0 \\ 0 & C \end{Bmatrix}")

    def test_bars_become_vmatrix(self):
        o, c = delims("|", "|", 100.0, 160.0)
        t = _asm([o] + grid([["a", "b"], ["c", "d"]], y0=110.0, ch=30.0) + [c])
        self.assertEqual(t, r"\begin{vmatrix} a & b \\ c & d \end{vmatrix}")

    def test_angle_brackets_fall_back_to_matrix_env(self):
        o, c = delims(r"\langle", r"\rangle")
        t = _asm([o] + grid([["a", "b"], ["c", "d"]], y0=110.0, ch=30.0) + [c])
        self.assertEqual(t, r"\left\langle \begin{matrix} a & b \\ c & d \end{matrix} \right\rangle")

    def test_three_by_three_keeps_every_cell(self):
        o, c = delims("[", "]", 90.0, 175.0)
        rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]]
        t = _asm([o] + grid(rows, y0=100.0, ch=25.0) + [c])
        self.assertEqual(
            t,
            r"\begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \\ 7 & 8 & 9 \end{bmatrix}")

    def test_column_vector(self):
        o, c = delims("(", ")", 90.0, 160.0)
        boxes = [o, bx(130, 100, 136, 113, "x"), bx(130, 125, 136, 138, "y"),
                 bx(130, 150, 136, 163, "z"), c]
        self.assertEqual(_asm(boxes), r"\begin{pmatrix} x \\ y \\ z \end{pmatrix}")

    def test_row_vector_stays_flat(self):
        """한 줄짜리(1×n)는 행렬로 바꾸지 않는다.

        \left[ x_1, x_2, x_3 \right] 처럼 '그냥 괄호로 묶인 나열'까지 행렬로
        만들면 본문 수식이 온통 bmatrix 가 된다 → 두 줄 이상일 때만 격자로 본다.
        """
        o, c = delims("[", "]")
        boxes = [o, bx(130, 110, 136, 123, "a"), bx(170, 110, 176, 123, "b"),
                 bx(210, 110, 216, 123, "c"), c]
        self.assertEqual(_asm(boxes), r"\left[ a b c \right]")

    def test_augmented_matrix_uses_array_bar(self):
        """[A | b] — 가운데 세로 막대는 array 의 열 구분선이 된다."""
        o, c = delims("[", "]", 90.0, 145.0)
        bar = bx(196.0, 100.0, 202.0, 135.0, "|", 30.0, "vbar")
        cells = grid([["a", "b"], ["c", "d"]], y0=100.0, ch=30.0)
        for b in cells:                       # 뒤쪽 두 칸을 막대 오른쪽으로 옮긴다
            if b.tex in ("b", "d"):
                b.x0 += 60.0; b.x1 += 60.0
        self.assertEqual(_asm([o] + cells + [bar, c]),
                         r"\left[ \begin{array}{c|c} a & b \\ c & d \end{array} \right]")

    def test_ellipsis_rows_become_dots_commands(self):
        o, c = delims("[", "]", 80.0, 175.0)
        # TeX 은 \cdots \vdots \ddots 를 마침표 세 개로 조판한다
        def dots(kind, cx, cy):
            if kind == "h":
                return [bx(cx + k * 6.0, cy, cx + k * 6.0 + 2.5, cy + 13.0, ".")
                        for k in range(3)]
            if kind == "v":
                return [bx(cx, cy + k * 7.0, cx + 2.5, cy + k * 7.0 + 13.0, ".")
                        for k in range(3)]
            return [bx(cx + k * 6.0, cy + k * 7.0, cx + k * 6.0 + 2.5,
                       cy + k * 7.0 + 13.0, ".") for k in range(3)]
        boxes = [o,
                 bx(130, 90, 136, 103, "1")]
        boxes += dots("h", 170, 90)
        boxes += [bx(210, 90, 216, 103, "0")]
        boxes += dots("v", 130, 125)
        boxes += dots("d", 170, 125)
        boxes += dots("v", 210, 125)
        boxes += [bx(130, 160, 136, 173, "0")]
        boxes += dots("h", 170, 160)
        boxes += [bx(210, 160, 216, 173, "1"), c]
        self.assertEqual(
            _asm(boxes),
            r"\begin{bmatrix} 1 & \cdots & 0 \\ \vdots & \ddots & \vdots "
            r"\\ 0 & \cdots & 1 \end{bmatrix}")

    def test_fraction_inside_big_parens_is_not_a_matrix(self):
        """(a+b)/(c+d) 처럼 분수선이 있는 2×2 배치는 행렬이 아니다."""
        o, c = delims("(", ")", 90.0, 150.0)
        boxes = [o,
                 bx(130, 100, 136, 113, "a"), bx(160, 100, 166, 113, "b"),
                 bx(130, 125, 136, 138, "c"), bx(160, 125, 166, 138, "d"),
                 c]
        rule = (128.0, 118.5, 168.0, 119.5)          # 두 줄 사이를 가로지르는 분수선
        t = _asm(boxes, [rule])
        self.assertNotIn("pmatrix", t)

    def test_single_row_group_stays_left_right(self):
        o, c = delims("(", ")")
        boxes = [o, bx(130, 110, 136, 123, "x"), bx(150, 110, 156, 123, "+"),
                 bx(170, 110, 176, 123, "y"), c]
        self.assertEqual(_asm(boxes), r"\left( x + y \right)")

    def test_superscript_on_matrix_is_kept(self):
        """M^{-1} — 닫는 괄호 뒤의 위첨자는 행렬에 붙어야 한다."""
        o, c = delims("[", "]")
        boxes = [bx(80, 110, 88, 125, "M"), bx(92, 110, 100, 125, "="), o]
        boxes += grid([["a", "b"], ["c", "d"]], y0=110.0, ch=30.0)
        boxes += [c, bx(252, 95, 258, 104, "-", 8.0), bx(258, 95, 264, 104, "1", 8.0)]
        t = _asm(boxes)
        self.assertTrue(t.startswith(r"M = \begin{bmatrix}"), t)
        self.assertRegex(t, re.compile(r"\\end\{bmatrix\}\^\{-\s*1\}$"), t)

    def test_scripts_are_not_a_column_vector(self):
        """X^{a}_{b} 처럼 첨자만 위아래로 붙은 덩어리는 열 벡터가 아니다."""
        o, c = delims("(", ")")
        boxes = [o,
                 bx(140, 110, 150, 125, "X"),
                 bx(152, 100, 158, 110, "a", 8.0),
                 bx(152, 122, 158, 132, "b", 8.0),
                 c]
        t = _asm(boxes)
        self.assertNotIn("pmatrix", t)

    def test_cases_block_is_untouched(self):
        """왼쪽 중괄호 하나(cases)는 행렬이 아니다."""
        brace = importer.Box(100.0, 90.0, 112.0, 160.0, r"\{", 40.0, "open")
        boxes = [brace,
                 bx(130, 100, 136, 113, "x"), bx(145, 100, 151, 113, "i"),
                 bx(160, 100, 166, 113, "f"),
                 bx(130, 140, 136, 153, "y"), bx(145, 140, 151, 153, "i"),
                 bx(160, 140, 166, 153, "f")]
        t = _asm(boxes)
        self.assertIn(r"\begin{cases}", t)
        self.assertNotIn("bmatrix", t)

    def test_matrix_output_is_katex_safe(self):
        o, c = delims("[", "]")
        t = _asm([o] + grid([["a", "b"], ["c", "d"]], y0=110.0, ch=30.0) + [c])
        self.assertTrue(importer._latex_is_sane(t))
        self.assertFalse(importer._tex_is_figure_junk(t))


class MatrixPageTest(unittest.TestCase):
    """표본 PDF 한 쪽을 통째로 불러온 결과."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix="sdy-matrix-")
        d = cls._tmp.name
        cls.physics = import_pdf_fixture.make_matrix_paper(os.path.join(d, "physics.pdf"))
        cls.arch = import_pdf_fixture.make_arch_matrix_paper(os.path.join(d, "arch.pdf"))
        cls.tex = import_pdf_fixture.make_tex_matrix_paper(os.path.join(d, "tex.pdf"))
        cls.pages = {}
        for key, path in (("physics", cls.physics), ("arch", cls.arch), ("tex", cls.tex)):
            with pymupdf.open(path) as doc:
                cls.pages[key] = importer._pdf_one_page(doc, 0, None)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _latex(self, key):
        return [e["latex"] for e in self.pages[key]["els"] if e["type"] == "latex"]

    def _text(self, key):
        out = []
        for e in self.pages[key]["els"]:
            if e["type"] == "text":
                import re
                out.append(re.sub(r"<[^>]+>", "", e.get("html", "")))
        return out

    # ── 물리 쪽: 행렬 다섯 개 ──
    def test_physics_page_restores_all_matrices(self):
        got = self._latex("physics")
        want = [
            r"\begin{bmatrix} 0 & 1 \\ 1 & 0 \end{bmatrix}",                  # 파울리
            r"\begin{pmatrix} c & - s \\ s & c \end{pmatrix}",                # 회전
            r"\begin{bmatrix} 1 & \cdots & 0 \\ \vdots & \ddots & \vdots "
            r"\\ 0 & \cdots & 1 \end{bmatrix}",                               # 줄임표
            r"\begin{pmatrix} x \\ y \\ z \end{pmatrix}",                     # 열 벡터
            r"\begin{bmatrix} h _{1 1} & h _{1 2} & h _{1 3} & h _{1 4} "
            r"\\ h _{2 1} & h _{2 2} & h _{2 3} & h _{2 4} "
            r"\\ h _{3 1} & h _{3 2} & h _{3 3} & h _{3 4} "
            r"\\ h _{4 1} & h _{4 2} & h _{4 3} & h _{4 4} \end{bmatrix}",
        ]
        for w in want:
            self.assertTrue(any(w in g for g in got),
                            f"행렬이 복원되지 않았다: {w}\n  got={got}")

    def test_physics_page_leaves_no_loose_entries(self):
        """칸 숫자가 본문 글자로 흩어지면 안 된다 — 글 상자는 본문만 남는다."""
        got = " ".join(t.replace("\n", " ") for t in self._text("physics"))
        for phrase in ("Matrix methods for lattice spin systems",
                       "generated by the Pauli matrices",
                       "Rotations of the lattice frame",
                       "(3.7)",
                       "Every row above keeps its own baseline."):
            self.assertIn(phrase, got)
        for junk in ("0 1", "1 0", "x y z", "h 1 1"):
            self.assertNotIn(junk, got, got)

    def test_equation_number_stays_text(self):
        self.assertTrue(any("(3.7)" in t for t in self._text("physics")))

    # ── 컴퓨터 구조 쪽 ──
    def test_arch_page_restores_all_matrices(self):
        got = self._latex("arch")
        want = [
            r"\begin{bmatrix} d _{1 1} & d _{1 2} & d _{1 3} & d _{1 4} "
            r"\\ d _{2 1} & d _{2 2} & d _{2 3} & d _{2 4} "
            r"\\ d _{3 1} & d _{3 2} & d _{3 3} & d _{3 4} "
            r"\\ d _{4 1} & d _{4 2} & d _{4 3} & d _{4 4} \end{bmatrix}",
            r"\begin{array}{cc|c} a _{1 1} & a _{1 2} & b _{1} "
            r"\\ a _{2 1} & a _{2 2} & b _{2} \end{array}",       # 첨가 행렬
            r"\begin{Bmatrix} A & 0 \\ 0 & C \end{Bmatrix}",      # 블록 행렬
        ]
        for w in want:
            self.assertTrue(any(w in g for g in got),
                            f"행렬이 복원되지 않았다: {w}\n  got={got}")

    def test_arch_augmented_matrix_is_wrapped(self):
        got = " ".join(self._latex("arch"))
        self.assertIn(r"\left[ \begin{array}{cc|c}", got)

    # ── pdflatex(CMEX) 확장 글꼴 ──
    def test_cmx_page_restores_matrices(self):
        got = self._latex("tex")
        self.assertTrue(any(r"\begin{bmatrix} a & b \\ c & d \end{bmatrix}" in g
                            for g in got), got)
        self.assertTrue(any(r"\begin{pmatrix} x \\ y \\ z \end{pmatrix}" in g
                            for g in got), got)

    # ── 공통 ──
    def test_every_matrix_is_katex_safe(self):
        for key in ("physics", "arch", "tex"):
            for t in self._latex(key):
                self.assertTrue(importer._latex_is_sane(t), f"{key}: {t}")
                self.assertNotIn(r"\begin{aligned}", t)

    def test_matrix_element_covers_the_grid(self):
        """칸 전체를 덮는 상자여야 한다 — 덮지 못하면 배경 벡터와 겹쳐 보인다."""
        for key in ("physics", "arch", "tex"):
            for e in self.pages[key]["els"]:
                if e["type"] != "latex":
                    continue
                self.assertGreater(float(e.get("w") or 0), 8.0)
                self.assertGreater(float(e.get("h") or 0), 8.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
