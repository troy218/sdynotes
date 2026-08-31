"""Worker shared paths/constants/locks.

BASE_DIR 는 Node 서버와 동일한 프로젝트 루트(가져오기/음악 폴더 공유)를 가리킨다.
"""
import os
import threading
import time

# oracle 모드(기본)에선 cloudinary SDK 가 필요 없다. 패키지가 없어도 워커가
# 기동하도록 가드한다(legacy cloud 롤백 시에만 실제로 쓴다).
try:
    import cloudinary
    import cloudinary.uploader
    import cloudinary.utils
    _HAS_CLD = True
except Exception:  # pragma: no cover - 패키지 미설치 환경
    cloudinary = None
    _HAS_CLD = False

if _HAS_CLD:
    cloudinary.config(
        cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME", "os8j8bnv"),
        api_key=os.environ.get("CLOUDINARY_API_KEY", ""),
        api_secret=os.environ.get("CLOUDINARY_API_SECRET", ""),
    )
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:
    pillow_heif = None

# worker/sdynotes_worker/common.py -> 프로젝트 루트(3단계 위)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

IMG_DIR = os.path.join(BASE_DIR, "imported")
DOCS_DIR = os.path.join(BASE_DIR, "imported_docs")
UPLOAD_DIR = os.path.join(BASE_DIR, "import_uploads")
JOBS_DIR = os.path.join(BASE_DIR, "import_jobs")

MUSIC_DIR = os.path.join(BASE_DIR, "music")
MUSIC_META = os.path.join(MUSIC_DIR, "_index.json")
MUSIC_BAK = MUSIC_META + ".bak"
ACOUSTID_FILE = os.path.join(MUSIC_DIR, "_acoustid.json")
YT_COOKIES_FILE = os.path.join(MUSIC_DIR, "_yt_cookies.txt")
YT_COOKIES_BAK = os.path.join(BASE_DIR, "_yt_cookies.txt.bak")

SYNC_DIR = os.path.join(BASE_DIR, "sync")

for _d in (IMG_DIR, DOCS_DIR, UPLOAD_DIR, JOBS_DIR, MUSIC_DIR, SYNC_DIR):
    try:
        os.makedirs(_d, exist_ok=True)
    except Exception:
        pass

# ── 버전 ──────────────────────────────────────────────────────────────
# server/src/lib/config.js 의 APP_VERSION 과 항상 같은 값이어야 한다.
# 작업마다 같이 올려라 — 함께 바꿔야 하는 5곳 전체 목록은
# server/src/lib/config.js 상단 주석에 있다.
APP_VERSION = "14.16.7"
SETTINGS_SCHEMA = 3

_STORAGE_MODE = (os.environ.get("SDY_STORAGE") or "oracle").strip().lower()

# oracle 모드에선 키가 남아 있어도 Cloudinary 로 나가는 트래픽이 없다.
CLOUD_READY = (_STORAGE_MODE == "cloud" and _HAS_CLD
               and bool(os.environ.get("CLOUDINARY_API_KEY")
                        and os.environ.get("CLOUDINARY_API_SECRET")))

_music_lock = threading.Lock()
_sync_lock = threading.Lock()
_last_user_activity = time.time()

NODE_URL = os.environ.get("SDY_NODE_URL", "http://127.0.0.1:5000").rstrip("/")


def is_server_idle(idle_sec=10.0):
    return (time.time() - _last_user_activity) > idle_sec


def _cleanup_old_temp_files():
    try:
        now = time.time()
        for d in (IMG_DIR, DOCS_DIR, UPLOAD_DIR):
            if os.path.exists(d):
                for fn in os.listdir(d):
                    fp = os.path.join(d, fn)
                    if os.path.isfile(fp) and (now - os.path.getmtime(fp) > 3600):
                        try:
                            os.unlink(fp)
                        except Exception:
                            pass
    except Exception:
        pass
