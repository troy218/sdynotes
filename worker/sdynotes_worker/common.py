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
APP_VERSION = "14.22.0"
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


# ── 임시 파일 정리 ─────────────────────────────────────────────
# 주의(14.18.1): 이 함수는 '진짜 임시 파일'만 지워야 한다. oracle 전환(14.12)
# 이후 IMG_DIR(imported/) 은 ① 노트에 붙인 사진(img_*.webp, /api/img/)과
# ② 문서 가져오기가 만든 배경(<hex>.png|jpg|svg, /api/import/img/)의
# **영구 저장소**이고, DOCS_DIR(imported_docs/) 도 대용량 문서 본문
# ({jid}.*)의 영구 저장소다. 예전처럼 "디렉터리 안 파일을 mtime 으로 통째로
# 지우면" 올린 지 한 시간쯤 지난 노트 사진이 서버 디스크에서 사라져 모든
# 기기에서 깨지는 치명적 버그가 된다(음악 백필 스레드가 15분마다 이 함수를
# 호출하므로 사실상 매번 재발). 그래서 여기서는 이름으로 확실히 임시인
# 파일만 정리한다 — 영구 데이터는 절대 건드리지 않는다.
#
#   UPLOAD_DIR(import_uploads/)  : 클라이언트 청크 업로드 조립소. *.part 는
#                                  미완성 찌꺼기, *.bin 은 완성 후 변환에 쓰인
#                                  원본. 1시간 안에 변환으로 넘어가므로 그보다
#                                  오래 남은 것은 죽은 업로드다.
#   IMG_DIR(imported/)           : chunk_*.json(문서 변환 자식 프로세스 결과,
#                                  정상 종료 시 곧바로 삭제됨 — 비정상 종료
#                                  찌꺼기만 남는다) + *.tmp(원자 저장 찌꺼기)
#                                  만 정리. img_*.webp / <hex>.png|jpg|svg 는
#                                  영구 데이터 → 절대 삭제 금지.
#   DOCS_DIR(imported_docs/)     : *.tmp(원자 저장 중단 찌꺼기) 만 정리.
#                                  {jid}.* 은 영구 문서 데이터 → 절대 삭제 금지.
#                                  ({jid}.src 는 가져오기 완료 시점에 자체 GC 로
#                                   하루 지난 것만 정리된다.)
def _cleanup_old_temp_files(upload_older_than=3600.0, bin_older_than=24 * 3600.0):
    try:
        now = time.time()
        # 영구 저장 디렉터리: 이름 패턴으로 확실한 임시 파일만 정리
        patterns = {
            IMG_DIR: lambda fn: (fn.startswith("chunk_") and fn.endswith(".json")) or fn.endswith(".tmp"),
            DOCS_DIR: lambda fn: fn.endswith(".tmp"),
        }
        for d, is_tmp in patterns.items():
            if not os.path.isdir(d):
                continue
            for fn in os.listdir(d):
                if not is_tmp(fn):
                    continue
                fp = os.path.join(d, fn)
                try:
                    if os.path.isfile(fp) and now - os.path.getmtime(fp) > upload_older_than:
                        os.unlink(fp)
                except Exception:
                    pass
        # 업로드 조립 디렉터리: 전부 임시 데이터라 전체 mtime 스윕이 안전하다.
        #   .bin 은 변환이 끝나면 moved 되므로 더 넉넉한 임계값을 준다.
        if os.path.isdir(UPLOAD_DIR):
            for fn in os.listdir(UPLOAD_DIR):
                fp = os.path.join(UPLOAD_DIR, fn)
                try:
                    if not os.path.isfile(fp):
                        continue
                    threshold = bin_older_than if fn.endswith(".bin") else upload_older_than
                    if now - os.path.getmtime(fp) > threshold:
                        os.unlink(fp)
                except Exception:
                    pass
    except Exception:
        pass
