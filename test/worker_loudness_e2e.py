#!/usr/bin/env python3
"""14.65 · 음량 정규화 end-to-end — 진짜 ffmpeg 로 재고, 보정하고, 다시 잰다.

사용자 지시: "노래마다 소리가 크고 작음 → 사용자가 고르는 옵션이 아니라 백엔드가
송출할 때 일관되게".

여기서는 실제로 음량이 다른 두 음원을 만들어 worker(loudness.py)에 넘기고,
  · 보정값이 목표(-14 LUFS)까지 정확히 계산되는지
  · 만들어진 정규화 사본을 다시 재면 두 곡이 같은 음량이 되는지
  · 클리핑(트루피크 -1 dBFS 초과)이 생기지 않는지
를 확인한다. ffmpeg 가 없으면(=이 서버에 도구가 없으면) 검사를 건너뛰고 그 사실을
알린다 — 정규화는 '있으면 좋은' 기능이라 서버가 멈추면 안 된다.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "worker"))

from sdynotes_worker import loudness  # noqa: E402


def _ff():
    return loudness.ffmpeg_bin()


class LoudnessMathTest(unittest.TestCase):
    """곡 기록에 남길 값 계산 (ffmpeg 없이도 검증 가능)."""

    def test_target_and_clamps(self):
        self.assertEqual(loudness.gain_from(-14.0, None), 0.0)
        self.assertEqual(loudness.gain_from(-19.8, None), 5.8)      # +5.8 → -14
        self.assertEqual(loudness.gain_from(-6.8, None), -7.2)      # -7.2 → -14
        self.assertEqual(loudness.gain_from(-40.0, None), loudness.MAX_GAIN_DB)
        self.assertEqual(loudness.gain_from(0.0, None), loudness.MIN_GAIN_DB)

    def test_peak_headroom(self):
        # 목표까지 올리려면 +10 이지만 피크가 -3 이라 상한(-1)까지는 +2 만
        self.assertEqual(loudness.gain_from(-24.0, -3.0), 2.0)
        # 목표보다 큰 곡은 피크와 무관하게 목표까지 내린다
        self.assertEqual(loudness.gain_from(-10.0, 0.5), -4.0)

    def test_silence_is_left_alone(self):
        self.assertEqual(loudness.gain_from(-80.0, None), 0.0)

    def test_tiny_gain_ignored(self):
        self.assertEqual(loudness.denoise_gain(0.04), 0.0)
        self.assertEqual(loudness.denoise_gain(-0.05), 0.0)
        self.assertEqual(loudness.denoise_gain(3.24), 3.2)

    def test_parse_ebur128_summary(self):
        text = """
[Parsed_ebur128_0 @ 0x55] Summary:

  Integrated loudness:
    I:         -19.8 LUFS
    Threshold: -29.9 LUFS

  Loudness range:
    LRA:         4.2 LU

  True peak:
    Peak:      -12.9 dBFS
"""
        self.assertEqual(loudness.parse_ebur128(text), (-19.8, -12.9))

    def test_parse_ebur128_inf(self):
        text = "  Integrated loudness:\n    I:         -inf LUFS\n  True peak:\n    Peak:      -inf dBFS\n"
        self.assertEqual(loudness.parse_ebur128(text), (None, None))

    def test_filter_string_keeps_limiter_auto_level_off(self):
        f = loudness.volume_filter(-3.4)
        self.assertIn("volume=-3.4dB", f)
        self.assertIn("level=0", f)          # 오토레벨을 켜면 +1 LU 밀린다


@unittest.skipUnless(_ff(), "ffmpeg 없음 — 이 서버는 음량 정규화를 건너뛴다(재생은 그대로)")
class LoudnessEndToEndTest(unittest.TestCase):
    """진짜 ffmpeg 로 두 곡을 같은 음량으로 맞춘다."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="sdyloud_")
        cls.saved_norm_dir = loudness.MUSIC_NORM_DIR
        loudness.MUSIC_NORM_DIR = os.path.join(cls.tmp, "music_norm")
        os.makedirs(loudness.MUSIC_NORM_DIR, exist_ok=True)
        ff = _ff()
        cls.src = {}
        for name, gain in (("quiet", "2dB"), ("loud", "15dB")):
            path = os.path.join(cls.tmp, name + ".m4a")
            subprocess.run(
                [ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                 "-i", "sine=frequency=440:duration=8:sample_rate=44100",
                 "-af", "volume=" + gain, "-c:a", "aac", "-b:a", "128k", path],
                check=True)
            cls.src[name] = path

    @classmethod
    def tearDownClass(cls):
        loudness.MUSIC_NORM_DIR = cls.saved_norm_dir
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _lufs(self, path):
        m = loudness.measure(path)
        self.assertTrue(m["ok"], m.get("error"))
        return m["lufs"], m.get("peak_db")

    def test_two_levels_become_one(self):
        before = {n: self._lufs(p)[0] for n, p in self.src.items()}
        self.assertGreater(abs(before["quiet"] - before["loud"]), 5.0,
                           "테스트 준비 실패 — 두 곡 음량 차이가 너무 작다: %s" % before)
        after = {}
        for i, (name, path) in enumerate(self.src.items()):
            mid = "e2e%02d" % i
            patch = loudness.process(mid, path, ext="m4a")
            self.assertEqual(patch.get("norm_state"), "done", patch)
            out = loudness.norm_path(mid, "m4a")
            self.assertTrue(os.path.isfile(out), "정규화 사본이 없다: %s" % out)
            after[name] = self._lufs(out)

        # 두 곡이 목표(-14) 근처에서 서로 1.5 LU 안쪽으로 모여야 한다
        for name, (lufs, peak) in after.items():
            self.assertAlmostEqual(lufs, loudness.TARGET_LUFS, delta=1.5,
                                   msg="%s 가 목표에서 벗어남: %s" % (name, lufs))
            if peak is not None:
                self.assertLessEqual(peak, loudness.PEAK_CEIL_DB + 0.5,
                                     "%s 클리핑 위험: %s dBFS" % (name, peak))
        self.assertLess(abs(after["quiet"][0] - after["loud"][0]), 1.5,
                        "두 곡이 아직 다르다: %s" % after)


if __name__ == "__main__":
    unittest.main(verbosity=2)
