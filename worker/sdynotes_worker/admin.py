"""Worker 관리자 인증 — 세션은 Node 가 단일 소유하므로 내부 검증으로 위임."""
from flask import request

from . import common


def _require_admin():
    tok = ""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        tok = auth[7:].strip()
    if not tok:
        tok = (request.headers.get("X-Admin-Token", "").strip()
               or request.headers.get("admin-token", "").strip())
    if not tok:
        tok = request.form.get("token") or request.args.get("token") or ""
    if not tok:
        data = request.get_json(silent=True) or {}
        tok = data.get("token", "")
    if not tok:
        tok = request.cookies.get("sdy_admin") or request.cookies.get("admin_token") or ""
    tok = str(tok).strip()
    if not tok:
        return False
    try:
        r = requests_post_internal("/internal/verify", {"token": tok})
        return bool(r.get("ok"))
    except Exception:
        return False


def requests_post_internal(path, payload):
    import requests
    r = requests.post(common.NODE_URL + path, json=payload, timeout=3)
    r.raise_for_status()
    return r.json() or {}
