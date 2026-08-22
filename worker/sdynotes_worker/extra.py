"""Worker 전용 추가 라우트.

- /api/music/play (로컬 폴백) — music.py 에 없는 유일한 로컬 경로
  (클라우드 모드 재생은 Node 가 직접 처리하므로 worker 는 501 로 거절)
"""
import re
import time

from flask import jsonify, request

from .cloud import _sb_enabled
from .common import _music_lock
from .core import app
from .music import _music_load, _music_save


@app.route("/api/music/play", methods=["POST"])
def music_play_local():
    """로컬 폴백 재생 카운트 (클라우드일 땐 Node 가 직접 처리한다)."""
    if _sb_enabled():
        return jsonify({"ok": False, "error": "클라우드 재생은 Node 가 처리합니다"}), 501
    d = request.get_json(silent=True) or {}
    mid = re.sub(r"[^0-9a-zA-Z_\-]", "", str(d.get("id") or ""))[:80]
    if not mid:
        return jsonify({"ok": False, "error": "id 없음"}), 400
    with _music_lock:
        m = _music_load()
        rec = m.get(mid)
        if not rec:
            return jsonify({"ok": False, "error": "없는 곡입니다"}), 404
        rec["play_count"] = int(rec.get("play_count") or 0) + 1
        rec["last_played"] = time.time()
        _music_save(m)
    return jsonify({"ok": True, "play_count": rec["play_count"]})
