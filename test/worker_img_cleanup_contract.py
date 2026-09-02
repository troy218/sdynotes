#!/usr/bin/env python3
"""워커 임시파일 정리가 '영구 이미지 저장소'를 지우지 않는지 검증하는 계약 테스트.

회귀 배경(14.18.1): _cleanup_old_temp_files() 가 IMG_DIR(imported/)/DOCS_DIR 을
'mtime 1시간' 기준으로 통째로 쓸던 시절, 노트에 올린 사진(img_*.webp, /api/img/)과
문서 가져오기 배경(<hex>.png|jpg|svg, /api/import/img/)이 **업로드 1시간 뒤
워커 음악 백필 스레드에 의해 서버 디스크에서 삭제**됐다. 올린 직후엔 파일이 있어
모든 기기에서 보이다가, 한 시간쯤 지나면 파일이 없어져 다른 기기(캐시 없는
브라우저)에서 404 로 깨지는 증상의 근본 원인이다.

여기서는 영구 데이터(노트 사진·가져오기 배경·대용량 문서)는 나이가 몇 시간이든
절대 삭제되지 않고, 이름으로 확실히 임시인 파일(chunk_*.json · *.tmp · *.part,
24시간 넘은 업로드 .bin)만 정리되는지 단위로 고정한다.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "worker"))

from sdynotes_worker import common  # noqa: E402


def _make(path: str, age_sec: float) -> None:
    with open(path, "wb") as fp:
        fp.write(b"x")
    old = time.time() - age_sec
    os.utime(path, (old, old))


class CleanupKeepsPermanentData(unittest.TestCase):
    """노트 이미지/문서 영구 데이터는 절대 삭제되면 안 된다 (본 버그의 회귀 방지)."""

    def setUp(self):
        self._orig = (common.IMG_DIR, common.DOCS_DIR, common.UPLOAD_DIR)
        self.tmp = tempfile.mkdtemp(prefix="sdy_cleanup_")
        common.IMG_DIR = os.path.join(self.tmp, "imported")
        common.DOCS_DIR = os.path.join(self.tmp, "imported_docs")
        common.UPLOAD_DIR = os.path.join(self.tmp, "import_uploads")
        for d in (common.IMG_DIR, common.DOCS_DIR, common.UPLOAD_DIR):
            os.makedirs(d)

    def tearDown(self):
        common.IMG_DIR, common.DOCS_DIR, common.UPLOAD_DIR = self._orig
        for name in os.listdir(self.tmp):
            p = os.path.join(self.tmp, name)
            if os.path.isdir(p):
                for fn in os.listdir(p):
                    try:
                        os.unlink(os.path.join(p, fn))
                    except OSError:
                        pass
                os.rmdir(p)
        os.rmdir(self.tmp)

    def test_old_note_images_survive_cleanup(self):
        """1시간보다 오래된 노트 사진(img_*.webp)도 반드시 남아야 한다 — 원래 버그."""
        _make(os.path.join(common.IMG_DIR, "img_abc123.webp"), 10 * 60)    # 방금 올림
        _make(os.path.join(common.IMG_DIR, "img_def456.webp"), 2 * 3600)   # 한참 전에 올림
        _make(os.path.join(common.IMG_DIR, "img_7890ab.webp"), 7 * 3600)   # 하루 전쯤
        common._cleanup_old_temp_files()
        self.assertEqual(
            sorted(os.listdir(common.IMG_DIR)),
            ["img_7890ab.webp", "img_abc123.webp", "img_def456.webp"],
        )

    def test_import_backgrounds_survive_cleanup(self):
        """문서 가져오기 배경(<hex>.png|jpg|svg)은 며칠이 지나도 남아야 한다."""
        for fn, age in [("a1b2c3d4e5f60718.png", 2 * 3600),
                        ("0011223344556677.jpg", 5 * 3600),
                        ("89abcdef01234567.svg", 72 * 3600)]:
            _make(os.path.join(common.IMG_DIR, fn), age)
        common._cleanup_old_temp_files()
        self.assertEqual(
            sorted(os.listdir(common.IMG_DIR)),
            ["0011223344556677.jpg", "89abcdef01234567.svg", "a1b2c3d4e5f60718.png"],
        )

    def test_doc_store_survives_cleanup(self):
        """대용량 문서 본문/조각/메타(.json.gz·.s*.gz·.meta.json·.src)는 남아야 한다."""
        for fn in ("doc1.json.gz", "doc1.s0.gz", "doc1.s3.gz", "doc1.meta.json", "doc1.src"):
            _make(os.path.join(common.DOCS_DIR, fn), 3 * 3600)
        common._cleanup_old_temp_files()
        self.assertEqual(
            sorted(os.listdir(common.DOCS_DIR)),
            ["doc1.json.gz", "doc1.meta.json", "doc1.s0.gz", "doc1.s3.gz", "doc1.src"],
        )


class CleanupRemovesOnlyTrueTemp(unittest.TestCase):
    """이름으로 확실히 임시인 찌꺼기만 정리되어야 한다."""

    def setUp(self):
        self._orig = (common.IMG_DIR, common.DOCS_DIR, common.UPLOAD_DIR)
        self.tmp = tempfile.mkdtemp(prefix="sdy_cleanup_")
        common.IMG_DIR = os.path.join(self.tmp, "imported")
        common.DOCS_DIR = os.path.join(self.tmp, "imported_docs")
        common.UPLOAD_DIR = os.path.join(self.tmp, "import_uploads")
        for d in (common.IMG_DIR, common.DOCS_DIR, common.UPLOAD_DIR):
            os.makedirs(d)

    def tearDown(self):
        common.IMG_DIR, common.DOCS_DIR, common.UPLOAD_DIR = self._orig
        for name in os.listdir(self.tmp):
            p = os.path.join(self.tmp, name)
            if os.path.isdir(p):
                for fn in os.listdir(p):
                    try:
                        os.unlink(os.path.join(p, fn))
                    except OSError:
                        pass
                os.rmdir(p)
        os.rmdir(self.tmp)

    def test_only_named_temp_patterns_removed(self):
        _make(os.path.join(common.IMG_DIR, "chunk_" + "ab" * 16 + ".json"), 2 * 3600)
        _make(os.path.join(common.IMG_DIR, "doc1.meta.json.tmp"), 2 * 3600)
        _make(os.path.join(common.DOCS_DIR, "doc1.meta.json.tmp"), 2 * 3600)
        _make(os.path.join(common.UPLOAD_DIR, "u1.part"), 2 * 3600)
        _make(os.path.join(common.UPLOAD_DIR, "u2.bin"), 2 * 3600)     # < 24h → 유지
        common._cleanup_old_temp_files()
        self.assertEqual(sorted(os.listdir(common.IMG_DIR)), [])
        self.assertEqual(sorted(os.listdir(common.DOCS_DIR)), [])
        self.assertEqual(sorted(os.listdir(common.UPLOAD_DIR)), ["u2.bin"])

    def test_stale_bin_older_than_a_day_removed(self):
        _make(os.path.join(common.UPLOAD_DIR, "dead.bin"), 30 * 3600)  # > 24h → 정리
        common._cleanup_old_temp_files()
        self.assertEqual(sorted(os.listdir(common.UPLOAD_DIR)), [])

    def test_fresh_files_never_touched(self):
        """신선한 파일(10분 전)은 어느 디렉터리에서도 지워지면 안 된다."""
        _make(os.path.join(common.IMG_DIR, "img_new.webp"), 10 * 60)
        _make(os.path.join(common.IMG_DIR, "chunk_" + "cd" * 16 + ".json"), 10 * 60)
        _make(os.path.join(common.DOCS_DIR, "doc1.meta.json.tmp"), 10 * 60)
        _make(os.path.join(common.UPLOAD_DIR, "u1.part"), 10 * 60)
        common._cleanup_old_temp_files()
        self.assertEqual(
            sorted(os.listdir(common.IMG_DIR)),
            ["chunk_" + "cd" * 16 + ".json", "img_new.webp"],
        )
        self.assertEqual(sorted(os.listdir(common.DOCS_DIR)), ["doc1.meta.json.tmp"])
        self.assertEqual(sorted(os.listdir(common.UPLOAD_DIR)), ["u1.part"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
