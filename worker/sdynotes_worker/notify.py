"""Worker 알림 — notifications.json 의 단일 작성자는 Node 다 (내부 위임 + 파일 폴백)."""
import json
import os
import time
import uuid

import requests

from . import common

_NOTIFY_FILE = os.path.join(common.BASE_DIR, "notifications.json")


def _notify_add(kind, title, message="", dedupe=None, meta=None):
    try:
        r = requests.post(common.NODE_URL + "/internal/notify", json={
            "kind": str(kind or "info")[:24],
            "title": str(title or "알림")[:120],
            "message": str(message or "")[:500],
            "dedupe": str(dedupe)[:160] if dedupe else None,
            "meta": meta if isinstance(meta, dict) else None,
        }, timeout=3)
        r.raise_for_status()
        return (r.json() or {}).get("rec")
    except Exception:
        return _notify_add_local(kind, title, message, dedupe, meta)


def _notify_add_local(kind, title, message="", dedupe=None, meta=None):
    """Node 가 죽어 있어도 알림을 놓치지 않게 파일로 직접 쓴다 (원자적 교체)."""
    try:
        items = []
        try:
            with open(_NOTIFY_FILE, encoding="utf-8") as fp:
                d = json.load(fp)
            if isinstance(d, list):
                items = d
        except Exception:
            items = []
        if dedupe and any(x.get("dedupe") == dedupe for x in items):
            return None
        rec = {
            "id": "nt_" + uuid.uuid4().hex[:12],
            "kind": str(kind or "info")[:24],
            "title": str(title or "알림")[:120],
            "message": str(message or "")[:500],
            "ts": time.time(), "read": False,
        }
        if dedupe:
            rec["dedupe"] = str(dedupe)[:160]
        if isinstance(meta, dict):
            rec["meta"] = meta
        items.append(rec)
        tmp = "%s.tmp.%s" % (_NOTIFY_FILE, uuid.uuid4().hex[:8])
        with open(tmp, "w", encoding="utf-8") as fp:
            json.dump(items[-160:], fp, ensure_ascii=False)
        os.replace(tmp, _NOTIFY_FILE)
        return rec
    except Exception as e:
        print("[notify] 저장 실패:", e)
        return None
