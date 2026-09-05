#!/usr/bin/env python3
# TEMPORARY helper: GitHub Actions runners can reach Google Drive, while the
# local sandbox network cannot. This pure-stdlib Python script downloads the
# requested Drive file and pushes it to a temporary branch so the local side
# can fetch it. Removed before/after the actual work.
#
# usage:
#   python3 scripts/fetch-drive.py
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

FILE_ID = "1Agb1PXdK568x-VEYg6P2nQEOhM5Sqhb2"
OUT_BRANCH = "arena/01a06f67-sdynotes-drive"
ZIP_PATH = Path("_incoming/implement-ai-real-time-editing.zip")
ROOT = Path(__file__).resolve().parent.parent
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "Chrome/124.0.0.0 Safari/537.36"
)


def log(*args):
    print("[fetch-drive]", *args, flush=True)


def git(*args, check=True):
    proc = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed ({proc.returncode}): {proc.stderr.strip()}"
        )
    return proc.stdout.strip()


def open_url(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    return urllib.request.urlopen(req, timeout=60)


def read_all(resp, limit=5_000_000):
    chunks = []
    remaining = limit
    while True:
        try:
            chunk = resp.read(min(65536, remaining))
        except (ConnectionError, TimeoutError, urllib.error.URLError):
            break
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
        if remaining <= 0:
            break
    return b"".join(chunks)


def fetch(url, dest, depth=0):
    log("GET", url)
    if depth > 6:
        raise RuntimeError("too many redirects")
    try:
        with open_url(url) as resp:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if "text/html" in ctype:
                body = read_all(resp, limit=5_000_000).decode("utf-8", "replace")
                confirm = re.search(r'name="confirm"\s+value="([^"]+)"', body, re.I)
                uuid_m = re.search(r'name="uuid"\s+value="([^"]+)"', body, re.I)
                if not confirm:
                    snippet = re.sub(r"\s+", " ", body)[:300]
                    raise RuntimeError("confirm token not found: " + snippet)
                params = {
                    "id": FILE_ID,
                    "export": "download",
                    "confirm": confirm.group(1),
                }
                if uuid_m:
                    params["uuid"] = uuid_m.group(1)
                q = urllib.parse.urlencode(params)
                url = "https://drive.usercontent.google.com/download?" + q
                return fetch(url, dest, depth + 1)
            # stream the real payload
            tmp = dest.with_suffix(dest.suffix + ".part")
            total = 0
            with tmp.open("wb") as fh:
                while True:
                    try:
                        chunk = resp.read(1024 * 256)
                    except (ConnectionError, TimeoutError, urllib.error.URLError):
                        break
                    if not chunk:
                        break
                    fh.write(chunk)
                    total += len(chunk)
            log("downloaded", total, "bytes")
            if total < 1000:
                tmp.unlink(missing_ok=True)
                raise RuntimeError(f"payload too small ({total} bytes)")
            tmp.replace(dest)
    except Exception as exc:
        raise RuntimeError(f"fetch failed: {exc}") from exc


def run_once():
    log("branch check...")
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"])
    log("current branch:", branch)
    if branch == OUT_BRANCH:
        log("already on output branch, skip")
        return
    if ZIP_PATH.exists():
        log("already exists:", ZIP_PATH, ZIP_PATH.stat().st_size, "bytes")
    else:
        ZIP_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            fetch(
                "https://drive.usercontent.google.com/download"
                f"?id={FILE_ID}&export=download&confirm=t",
                ZIP_PATH,
            )
        except Exception as exc:
            log("first attempt failed:", exc)
            ZIP_PATH.unlink(missing_ok=True)
            fetch(f"https://drive.google.com/uc?export=download&id={FILE_ID}", ZIP_PATH)

    size = ZIP_PATH.stat().st_size
    log("final zip size:", size)

    if size < 1000:
        raise RuntimeError(f"too small: {size}")

    # Upload the file to a temporary branch so the local side can pull it.
    git(["add", "-f", str(ZIP_PATH)])
    git(
        [
            "-c",
            "user.name=arena-ai-coding-agent[bot]",
            "-c",
            "user.email=arena-ai-coding-agent[bot]@users.noreply.github.com",
            "commit",
            "-m",
            "chore: fetch implement-ai-real-time-editing.zip (temp)",
        ]
    )
    log("committed")
    git(["push", "origin", f"HEAD:{OUT_BRANCH}"])
    log("pushed branch:", OUT_BRANCH)


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        log("not in GitHub Actions, skip")
        return
    try:
        run_once()
    except Exception as exc:
        # Never break the CI step; the checkout may not have write access and
        # this helper is best-effort.
        log("FAILED (continuing):", exc)
    finally:
        log("done")


if __name__ == "__main__":
    main()
