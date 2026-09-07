#!/usr/bin/env python3
"""음원 인식 '중복 자동 정리'가 **소리가 같은 파일만** 지우는지 고정하는 계약 테스트.

회귀 배경(14.37.1): 노래를 올리면 AcoustID 인식 → 같은 녹음 id(mbid) 또는 같은
제목+가수+앨범이 붙은 곡이 있으면 **그 자리에서 파일을 지웠다**. 그런데 AcoustID 는
같은 곡의 다른 판본(라디오 편집·리마스터·다른 언어판·inst.)이나 앞부분이 닮은 다른 곡,
잘못 등록된 지문에도 같은 id 를 돌려준다. "태그만 같이 붙였을 뿐인" 다른 곡이
중복으로 몰려 삭제되던 문제다.

이제 인식 키는 후보를 고를 뿐이고, 실제 삭제는 두 파일의 소리를 대조(`_same_audio`:
바이트 해시 → 길이 → raw 지문 비트 일치율)해 같다고 확인된 것만 한다. 여기서는
가짜 fpcalc 로 지문을 주입해 다음을 고정한다.

  · 같은 mbid + 소리 다름                → 둘 다 남는다 (본 버그)
  · 같은 mbid + 길이가 크게 다름           → 둘 다 남는다 (다른 판본)
  · 같은 제목·가수·앨범(mbid 없음) + 소리 다름 → 둘 다 남는다
  · fpcalc 가 없어 비교할 수 없음          → 지우지 않는다
  · 바이트가 같은 파일                    → 하나로 합친다
  · 다른 인코딩(지문 비트 약간 다름·앞머리 밀림) → 하나로 합친다, 많이 들은 곡을 남긴다
"""
from __future__ import annotations

import json
import os
import random
import shutil
import stat
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "worker"))

from sdynotes_worker import music  # noqa: E402

# 모듈 import 시 시작되는 배경 스레드(부팅 점검·백필)가 테스트 디렉터리를 건드리거나
# 네트워크로 나가지 않게 무력화한다 (이름으로 찾으므로 덮어쓰면 그대로 먹는다).
music._music_rebuild = lambda: (0, 0)
music._music_autotag = lambda *a, **k: None
music._music_lyrics = lambda *a, **k: None
music._music_cover_search = lambda *a, **k: None
music._yt_cookies_restore_if_needed = lambda: None
music._cleanup_old_temp_files = lambda *a, **k: None

FAKE_FPCALC = r'''#!/usr/bin/env python3
# 가짜 fpcalc — 음원 파일 내용이 곧 JSON {"duration":…, "fingerprint":[…]} 이다.
import json, sys
args = sys.argv[1:]
path = args[-1]
raw = "-raw" in args
with open(path, encoding="utf-8") as fp:
    d = json.load(fp)
fpv = d["fingerprint"]
if not raw:
    fpv = "AQAA" + str(len(fpv))      # 압축 지문 흉내
print(json.dumps({"duration": d["duration"], "fingerprint": fpv}))
'''


def _fp_random(n, seed):
    rnd = random.Random(seed)
    return [rnd.getrandbits(32) for _ in range(n)]


def _fp_jitter(fp, flips_per_frame, seed):
    """같은 녹음을 다른 코덱으로 담았을 때처럼 프레임마다 비트 몇 개만 뒤집는다."""
    rnd = random.Random(seed)
    out = []
    for x in fp:
        for _ in range(flips_per_frame):
            x ^= 1 << rnd.randrange(32)
        out.append(x)
    return out


class DedupeOnlyRemovesSameAudio(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sdy_dedupe_")
        self.music_dir = os.path.join(self.tmp, "music")
        os.makedirs(self.music_dir)
        fake = os.path.join(self.tmp, "fpcalc")
        with open(fake, "w", encoding="utf-8") as fp:
            fp.write(FAKE_FPCALC)
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)
        self.fake = fake
        self._orig = {k: getattr(music, k) for k in ("MUSIC_DIR", "MUSIC_META", "MUSIC_BAK", "_fp_bin")}
        music.MUSIC_DIR = self.music_dir
        music.MUSIC_META = os.path.join(self.music_dir, "_index.json")
        music.MUSIC_BAK = music.MUSIC_META + ".bak"
        music._fp_bin = lambda: self.fake
        with music._music_cache_lock:
            music._music_cache["key"] = None
            music._music_cache["data"] = None
        music._last_saved.clear()

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(music, k, v)
        with music._music_cache_lock:
            music._music_cache["key"] = None
            music._music_cache["data"] = None
        music._last_saved.clear()
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ── 도우미 ──────────────────────────────────────────────
    def _track(self, mid, fp, duration=200.0, mbid="mb-1", title="Song", artist="Artist",
               album="Album", play=0, raw_bytes=None, created="2024-01-01T00:00:00Z"):
        path = os.path.join(self.music_dir, mid + ".mp3")
        with open(path, "wb") as f:
            f.write(raw_bytes if raw_bytes is not None
                    else json.dumps({"duration": duration, "fingerprint": fp}).encode("utf-8"))
        rec = {"id": mid, "title": title, "artist": artist, "album": album, "ext": "mp3",
               "bytes": os.path.getsize(path), "tag_state": "done", "tag_src": "소리 인식(AcoustID)",
               "tag_algo": music.TAG_ALGO, "lyrics": "la", "cover": True, "genre": "pop",
               "recog_state": "done", "recog_score": 0.97, "recog_mbid": mbid,
               "recog_title": title, "recog_artist": artist, "recog_album": album,
               "play_count": play, "created_at": created}
        with music._music_lock:
            m = music._music_load()
            m[mid] = rec
            music._music_save(m)
        return rec

    def _ids(self):
        with music._music_lock:
            return sorted(music._music_load().keys())

    def _files(self):
        return sorted(fn for fn in os.listdir(self.music_dir) if fn.endswith(".mp3"))

    # ── 본 버그: 인식 결과는 같지만 소리가 다른 두 곡 ────────────
    def test_same_mbid_different_audio_keeps_both(self):
        self._track("aaa000000001", _fp_random(2400, 1), mbid="mb-same")
        self._track("bbb000000002", _fp_random(2400, 2), mbid="mb-same")
        res = music._music_dedupe_recognized("bbb000000002")
        self.assertFalse(res["duplicate_removed"])
        self.assertEqual(res["removed"], [])
        self.assertEqual(res.get("kept_apart"), ["aaa000000001"])
        self.assertEqual(self._ids(), ["aaa000000001", "bbb000000002"])
        self.assertEqual(self._files(), ["aaa000000001.mp3", "bbb000000002.mp3"])

    def test_same_mbid_but_duration_differs_keeps_both(self):
        base = _fp_random(2400, 3)
        self._track("aaa000000001", base, duration=200.0, mbid="mb-same")
        # 라디오 편집처럼 30초 짧은 판본 — 앞부분 지문은 거의 같아도 다른 판본이다
        self._track("bbb000000002", _fp_jitter(base, 1, 9), duration=170.0, mbid="mb-same")
        res = music._music_dedupe_recognized("bbb000000002")
        self.assertEqual(res["removed"], [])
        self.assertEqual(res.get("kept_apart"), ["aaa000000001"])
        self.assertEqual(self._ids(), ["aaa000000001", "bbb000000002"])

    def test_same_title_artist_album_without_mbid_keeps_different_audio(self):
        self._track("aaa000000001", _fp_random(2400, 4), mbid="")
        self._track("bbb000000002", _fp_random(2400, 5), mbid="")
        res = music._music_dedupe_recognized("bbb000000002")
        self.assertEqual(res["removed"], [])
        self.assertEqual(self._ids(), ["aaa000000001", "bbb000000002"])

    def test_without_fpcalc_nothing_is_deleted(self):
        music._fp_bin = lambda: None
        self._track("aaa000000001", _fp_random(2400, 6), mbid="mb-same")
        self._track("bbb000000002", _fp_random(2400, 7), mbid="mb-same")
        res = music._music_dedupe_recognized("bbb000000002")
        self.assertEqual(res["removed"], [])
        self.assertEqual(self._ids(), ["aaa000000001", "bbb000000002"])
        self.assertEqual(self._files(), ["aaa000000001.mp3", "bbb000000002.mp3"])

    def test_unrelated_mbid_is_not_even_a_candidate(self):
        fp = _fp_random(2400, 8)
        self._track("aaa000000001", fp, mbid="mb-1")
        self._track("bbb000000002", fp, mbid="mb-2")      # 소리는 같아도 인식이 다르면 손대지 않음
        res = music._music_dedupe_recognized("bbb000000002")
        self.assertEqual(res["removed"], [])
        self.assertNotIn("kept_apart", res)
        self.assertEqual(self._ids(), ["aaa000000001", "bbb000000002"])

    # ── 진짜 중복은 그대로 하나로 합쳐진다 ──────────────────────
    def test_byte_identical_file_is_merged(self):
        raw = json.dumps({"duration": 200.0, "fingerprint": _fp_random(2400, 10)}).encode("utf-8")
        self._track("aaa000000001", None, raw_bytes=raw, mbid="mb-same", play=3)
        self._track("bbb000000002", None, raw_bytes=raw, mbid="mb-same")
        res = music._music_dedupe_recognized("bbb000000002")
        self.assertTrue(res["duplicate_removed"])
        self.assertEqual(res["removed"], ["bbb000000002"])
        self.assertEqual(res["kept"]["id"], "aaa000000001")
        self.assertEqual(res["kept"]["play_count"], 3)
        self.assertEqual(self._ids(), ["aaa000000001"])
        self.assertEqual(self._files(), ["aaa000000001.mp3"])

    def test_same_recording_other_encoding_is_merged_and_keeps_most_played(self):
        base = _fp_random(2400, 11)
        self._track("aaa000000001", base, duration=200.4, mbid="mb-same", play=1)
        # 다른 비트레이트·앞머리 무음 5프레임 → 비트 몇 개 뒤집힘 + 밀림
        other = [0] * 5 + _fp_jitter(base, 1, 12)
        self._track("bbb000000002", other, duration=201.0, mbid="mb-same", play=9)
        res = music._music_dedupe_recognized("bbb000000002")
        self.assertEqual(res["removed"], ["aaa000000001"])
        self.assertFalse(res["duplicate_removed"])          # 많이 들은 새 곡이 남는다
        self.assertEqual(res["kept"]["id"], "bbb000000002")
        self.assertEqual(res["kept"]["play_count"], 10)
        self.assertEqual(self._ids(), ["bbb000000002"])
        self.assertEqual(self._files(), ["bbb000000002.mp3"])

    def test_mixed_group_only_removes_confirmed_copies(self):
        base = _fp_random(2400, 13)
        self._track("aaa000000001", base, mbid="mb-same", play=5)
        self._track("ccc000000003", _fp_random(2400, 14), mbid="mb-same")      # 다른 곡
        self._track("bbb000000002", _fp_jitter(base, 1, 15), mbid="mb-same")   # 진짜 사본
        res = music._music_dedupe_recognized("bbb000000002")
        self.assertEqual(res["removed"], ["bbb000000002"])
        self.assertEqual(res["kept"]["id"], "aaa000000001")
        self.assertEqual(res.get("kept_apart"), ["ccc000000003"])
        self.assertEqual(self._ids(), ["aaa000000001", "ccc000000003"])


class SimilarityPrimitives(unittest.TestCase):
    def test_identical_and_random(self):
        a = _fp_random(1000, 21)
        self.assertAlmostEqual(music._fp_similarity(a, list(a)), 1.0)
        sim = music._fp_similarity(a, _fp_random(1000, 22))
        self.assertLess(sim, 0.6)
        self.assertGreater(sim, 0.4)

    def test_offset_alignment(self):
        a = _fp_random(1000, 23)
        b = [0] * 12 + a
        self.assertGreater(music._fp_similarity(a, b), 0.99)

    def test_too_short_is_not_trusted(self):
        a = _fp_random(30, 24)
        self.assertEqual(music._fp_similarity(a, list(a)), 0.0)

    def test_threshold_separates_versions(self):
        base = _fp_random(2400, 25)
        self.assertGreaterEqual(music._fp_similarity(base, _fp_jitter(base, 2, 26)), music.DUP_FP_SIMILARITY)
        # 같은 곡의 다른 연주(라이브)처럼 프레임마다 절반쯤 다르면 중복이 아니다
        self.assertLess(music._fp_similarity(base, _fp_jitter(base, 8, 27)), music.DUP_FP_SIMILARITY)


class StaticContract(unittest.TestCase):
    """소스 계약 — 두 저장 모드 모두 '소리 대조'를 거쳐야 지운다."""

    def test_both_modes_confirm_before_deleting(self):
        with open(os.path.join(ROOT, "worker", "sdynotes_worker", "music.py"), encoding="utf-8") as fp:
            local = fp.read()
        with open(os.path.join(ROOT, "worker", "sdynotes_worker", "music_cloud.py"), encoding="utf-8") as fp:
            cloud = fp.read()
        body = local.split("def _music_dedupe_recognized(mid):", 1)[1].split("\ndef ", 1)[0]
        self.assertIn("_recog_confirm_same(", body)
        self.assertIn("_recog_dup_candidates(", body)
        cbody = cloud.split("def _cloud_dedupe_recognized(", 1)[1].split("\ndef ", 1)[0]
        self.assertIn("_recog_confirm_same(", cbody)
        self.assertIn("_recog_dup_candidates(", cbody)
        self.assertIn("_recog_download(", cbody)
        # 응답에는 '다른 판본으로 남긴 곡'이 실린다
        self.assertIn('"kept_apart"', local)
        self.assertIn('"kept_apart"', cloud)


if __name__ == "__main__":
    unittest.main(verbosity=2)
