#!/usr/bin/env python3
"""쪽 미리보기 래스터(_render_preview)가 진짜 JPEG 로 굽는지 고정하는 계약 테스트.

회귀 배경(14.32.3): 임시 파일 이름을 "%s.tmp.%s" % (out_path, uuid) 로 지었더니
확장자가 .ab12cd34 같은 '난수'가 됐다. Pixmap.save 는 **확장자**로 저장 형식을
정하므로 "Image format ab12cd34 not in (…'jpg'…)" 로 항상 예외가 났고,

  · /api/import/page/<ref>/<pno> 는 단 한 번도 200 이 나온 적이 없었고,
  · 클라이언트(mountPagePreview)는 3쪽 실패(_pvFailed ≥3) 뒤 미리보기를 포기해
    (_pvUnsupported) 가져온 논문 전체를 '요소 DOM 경로'(쪽당 수백 글상자 ×
    수천 span)로 그렸다.
  · → 노트를 여는 건 빠르지만(보이는 쪽만 그려서) 열고 나서 스크롤할 때마다 쪽을
    통째로 다시 그려야 하니, 사양이 낮은 기기에서는 스크롤이 멈췄다.

이 테스트는 임시 이름이 .jpg 로 끝나는지(원인 고정)와, 실제로 JPEG 가 만들어지는지
(결과 고정)를 함께 본다.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "worker"))

from sdynotes_worker import importer  # noqa: E402  (SDY_BASE_DIR 기본값으로 충분 — 저장소를 건드리지 않게 여기서만 굽는다)


def _make_pdf(path: str, pages: int = 2) -> None:
    import pymupdf

    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)  # A4
        page.insert_text((50, 60), "미리보기 계약 테스트 %d" % (i + 1), fontsize=18)
        page.insert_text((50, 120), "The quick brown fox jumps over the lazy dog.", fontsize=11)
    doc.save(path)
    doc.close()


class PreviewRenderContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="sdy_pv_")
        cls.pdf = os.path.join(cls.tmp, "paper.pdf")
        _make_pdf(cls.pdf)

    @classmethod
    def tearDownClass(cls):
        for fn in os.listdir(cls.tmp):
            try:
                os.unlink(os.path.join(cls.tmp, fn))
            except OSError:
                pass
        os.rmdir(cls.tmp)

    def test_tmp_name_ends_with_jpeg_extension(self):
        """임시 이름은 반드시 .jpg 로 끝나야 한다 — Pixmap.save 는 확장자로 형식을 정한다."""
        src = os.path.join(ROOT, "worker", "sdynotes_worker", "importer.py")
        with open(src, "r", encoding="utf-8") as fp:
            text = fp.read()
        # 예전의 고장난 패턴이 돌아오면 잡는다: '%s.tmp.%s" % (…)' 꼬리가 확장자 없이 붙는다.
        self.assertNotIn(
            'tmp = "%s.tmp.%s" % (out_path',
            text,
            "미리보기 임시 파일 이름에서 .jpg 확장자가 다시 빠졌다 — 쪽 미리보기가 전멸한다",
        )
        self.assertIn('tmp = "%s.tmp.%s.jpg" % (out_path', text)

    def test_render_produces_jpeg(self):
        """_render_preview 가 실패 없이 진짜 JPEG 를 굽는다 (본 회귀의 결과 고정)."""
        out = os.path.join(self.tmp, "pv_test.jpg")
        ok = importer._render_preview(self.pdf, 0, 900, out)
        self.assertTrue(ok, "렌더가 False — 쪽 번호 오류 아니면 저장 실패")
        self.assertTrue(os.path.exists(out), "출력 파일이 없다")
        with open(out, "rb") as fp:
            head = fp.read(3)
        self.assertEqual(head, b"\xff\xd8\xff", "JPEG 매직(FFD8FF)이 아니다 — 브라우저 <img> 가 못 먹는다")
        self.assertGreater(os.path.getsize(out), 1000, "파일이 너무 작다 — 빈 그림일 수 있다")

    def test_both_preview_widths_render(self):
        """서버가 스냅하는 두 단계(900/1600) 모두 굽는다."""
        for w in importer.PREVIEW_WIDTHS:
            out = os.path.join(self.tmp, "pv_w%d.jpg" % w)
            self.assertTrue(importer._render_preview(self.pdf, 1, w, out), "width=%d 렌더 실패" % w)
            with open(out, "rb") as fp:
                self.assertEqual(fp.read(3), b"\xff\xd8\xff")

    def test_out_of_range_page_returns_false(self):
        out = os.path.join(self.tmp, "pv_none.jpg")
        self.assertFalse(importer._render_preview(self.pdf, 99, 900, out))
        self.assertFalse(os.path.exists(out))


if __name__ == "__main__":
    unittest.main(verbosity=2)
