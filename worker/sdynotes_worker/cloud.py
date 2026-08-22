"""Worker Supabase client + _publish_live (SSE 는 Node 로 위임)."""
import os
import time
import urllib.parse

import requests

from . import common

SB_URL = (os.environ.get("SUPABASE_URL") or
          "https://xillsulrehkpuzyuhgcn.supabase.co").rstrip("/")
SB_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or
          os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or
          os.environ.get("SUPABASE_KEY") or "").strip()

SYNC_TABLE = "sdy_sync_states"
CARDS_TABLE = "sdy_card_decks"
MUSIC_TABLE = "sdy_music_tracks"
STICKER_TABLE = "sdy_stickers"
SB_TABLES = {SYNC_TABLE, CARDS_TABLE, MUSIC_TABLE, STICKER_TABLE}
SB_TIMEOUT = (8, 25)


def _sb_enabled():
    return bool(SB_URL and SB_KEY)


def _sb_headers(prefer=None):
    h = {
        "apikey": SB_KEY,
        "Authorization": "Bearer " + SB_KEY,
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


def _sb_get(table, ident):
    if not _sb_enabled() or table not in SB_TABLES:
        return None
    url = (f"{SB_URL}/rest/v1/{table}?id=eq.{urllib.parse.quote(str(ident), safe='')}"
           "&select=id,data,updated_at")
    r = requests.get(url, headers=_sb_headers(), timeout=SB_TIMEOUT)
    r.raise_for_status()
    rows = r.json() or []
    if not rows:
        return None
    data = rows[0].get("data")
    return data if isinstance(data, dict) else {}


def _sb_rows(table):
    if not _sb_enabled() or table not in SB_TABLES:
        return []
    out = []
    step = 1000
    for start in range(0, 10000, step):
        url = (f"{SB_URL}/rest/v1/{table}?select=id,data,updated_at"
               f"&order=updated_at.asc&limit={step}&offset={start}")
        r = requests.get(url, headers=_sb_headers(), timeout=SB_TIMEOUT)
        r.raise_for_status()
        page = r.json() or []
        out.extend(page)
        if len(page) < step:
            break
    return out


def _sb_delete(table, ident):
    if not _sb_enabled() or table not in SB_TABLES:
        raise RuntimeError("Supabase 서비스 키가 없습니다")
    r = requests.delete(
        f"{SB_URL}/rest/v1/{table}?id=eq.{urllib.parse.quote(str(ident), safe='')}",
        headers=_sb_headers("return=minimal"), timeout=SB_TIMEOUT,
    )
    r.raise_for_status()


def _sb_table_ok(table):
    return table in SB_TABLES


def _sb_error_text(exc):
    text = str(exc)
    resp = getattr(exc, "response", None)
    if resp is not None:
        try:
            body = resp.json()
            text = body.get("message") or body.get("details") or text
        except Exception:
            pass
    return text[:220]


def _sb_put(table, ident, data):
    if not _sb_enabled() or table not in SB_TABLES:
        raise RuntimeError("Supabase 서비스 키가 없습니다")
    row = {
        "id": str(ident),
        "data": data,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
    }
    r = requests.post(
        f"{SB_URL}/rest/v1/{table}?on_conflict=id",
        headers=_sb_headers("resolution=merge-duplicates,return=representation"),
        json=row, timeout=SB_TIMEOUT,
    )
    r.raise_for_status()
    body = r.json() if r.content else []
    return (body or [{}])[0] if isinstance(body, list) else {}


def _publish_live(topic, key=""):
    """SSE 는 Node 서버가 소유한다 — 내부 엔드포인트로 위임 (실패해도 무시)."""
    try:
        requests.post(f"{common.NODE_URL}/internal/publish",
                      json={"topic": str(topic), "key": str(key or "")},
                      timeout=2)
    except Exception:
        pass
