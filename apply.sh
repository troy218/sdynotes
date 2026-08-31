#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  SDYnotes 적용 스크립트 (Fastify + Python worker 개편판)
#  · 버전은 server/src/lib/config.js 의 APP_VERSION 이 기준이다 (이 숫자만 믿지 마라)
#  ★서버 안에서 실행★
#
#  구조:
#    Node(Fastify) 메인 서버  :5000  — 프런트 서빙 + 가벼운 API + SSE
#    Python worker           :5100  — 가져오기(PDF/Word) + 음악 태깅/유튜브/인식
#    저장소(기본=oracle)             — 모든 상태·파일을 이 Oracle VM 디스크에 저장
#                                      (Supabase/Cloudinary 사용 안 함)
#                                      예전 클라우드 모드: SDY_STORAGE=cloud
#
#  zip 안에  apply.sh · package.json · sdynotes.html · sdynotes.css · sdynotes.js ·
#  server/ · worker/ · scripts/ 를 폴더 없이 넣어 보내고, 서버에서 이것만 실행하면 됩니다.
#      bash apply.sh
#
#  처음 실행 → Node/파이썬/서비스/nginx 까지 자동 설치
#  두번째부터 → 파일만 교체하고 재시작 (설치 과정 건너뜀)
#  구조·저장소·운영/롤백 방법은 README.md / ORACLE_MIGRATION.md 참조
#  보관함(vault) 파일은 절대 지우지 않습니다.
#
#  기존 Supabase/Cloudinary 데이터가 있으면(키가 .env 에 있으면) 최초 1회,
#  서비스 정지 상태에서 scripts/migrate_to_oracle.mjs 로 자동 이전합니다.
# ─────────────────────────────────────────────────────────────
set -e

APP_DIR=/var/www/memo
PORT=5000
WORKER_PORT=5100
SVC=sdynotes
SVC_WORKER=sdynotes-worker
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say(){ echo -e "\n\033[1;36m▶ $*\033[0m"; }
ok(){  echo -e "  \033[1;32m✓\033[0m $*"; }
die(){ echo -e "\n\033[1;31m✗ $*\033[0m"; exit 1; }

[ -f "$SRC/sdynotes.html" ]      || die "sdynotes.html 이 없습니다 (현재 위치: $SRC)"
[ -f "$SRC/sdynotes.css" ]       || die "sdynotes.css 가 없습니다 — HTML이 참조하는 스타일 파일입니다 (현재 위치: $SRC)"
[ -f "$SRC/sdynotes.js" ]        || die "sdynotes.js 가 없습니다 — HTML이 참조하는 스크립트 파일입니다 (현재 위치: $SRC)"
[ -f "$SRC/package.json" ]       || die "package.json 이 없습니다"
[ -f "$SRC/server/src/index.js" ] || die "server/src/index.js 가 없습니다 — zip에 server/ 폴더를 통째로 넣어 주세요"
[ -f "$SRC/worker/run.py" ]      || die "worker/run.py 가 없습니다 — zip에 worker/ 폴더를 통째로 넣어 주세요"

# 실행 중인 서버에 잘린 JS가 노출되기 전에 문법부터 검사한다. Node가 아직 없는
# 최초 설치에서는 3단계 설치 후 서비스 기동 검사가 대신 맡는다.
if command -v node >/dev/null 2>&1; then
    node --check "$SRC/sdynotes.js" >/dev/null || die "sdynotes.js 문법 오류 — 배포를 중단합니다"
    node --check "$SRC/server/src/index.js" >/dev/null || die "server/src/index.js 문법 오류 — 배포를 중단합니다"
fi
# HTML과 서버 버전이 어긋나면 브라우저가 이전 JS/CSS를 계속 조합할 수 있다.
# (작업 후 버전을 올릴 때 함께 바꿔야 하는 5곳 = package.json · package-lock.json
#  · server/src/lib/config.js · worker/sdynotes_worker/common.py · sdynotes.html
#  — 자세한 규칙은 server/src/lib/config.js 상단 주석 참조)
HTML_VER=$(sed -n 's/.*application-version" content="\([^"]*\)".*/\1/p' "$SRC/sdynotes.html" | head -1)
SERVER_VER=$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" "$SRC/server/src/lib/config.js" | head -1)
[ -n "$HTML_VER" ] && [ "$HTML_VER" = "$SERVER_VER" ] \
    || die "프런트 버전($HTML_VER)과 서버 버전($SERVER_VER)이 다릅니다"
grep -q "sdynotes.js?v=$HTML_VER" "$SRC/sdynotes.html" \
    || die "sdynotes.js 캐시 버전이 HTML 버전과 다릅니다"
grep -q "sdynotes.css?v=$HTML_VER" "$SRC/sdynotes.html" \
    || die "sdynotes.css 캐시 버전이 HTML 버전과 다릅니다"

say "0/6  배포 파일 확인"
echo "  sdynotes.html  $(du -h "$SRC/sdynotes.html" | cut -f1)  ($(date -r "$SRC/sdynotes.html" '+%m-%d %H:%M'))"
echo "  sdynotes.css   $(du -h "$SRC/sdynotes.css"  | cut -f1)  ($(date -r "$SRC/sdynotes.css"  '+%m-%d %H:%M'))"
echo "  sdynotes.js    $(du -h "$SRC/sdynotes.js"   | cut -f1)  ($(date -r "$SRC/sdynotes.js"   '+%m-%d %H:%M'))"
echo "  server/        $(find "$SRC/server" -name '*.js' | wc -l) 개 JS 모듈"
echo "  worker/        $(find "$SRC/worker" -name '*.py' | wc -l) 개 PY 모듈"

# ── 1. 폴더 준비 ────────────────────────────────────────────
say "1/6  폴더 준비"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER:$USER" "$APP_DIR"
ok "$APP_DIR"

# ── 2. 파일 복사 (데이터 폴더는 건드리지 않음) ─────────────────
say "2/6  파일 복사"
# 롤백용 백업
if [ -f "$APP_DIR/package.json" ]; then
    rm -rf "$APP_DIR/server.bak" "$APP_DIR/worker.bak"
    cp -r "$APP_DIR/server" "$APP_DIR/server.bak" 2>/dev/null || true
    cp -r "$APP_DIR/worker" "$APP_DIR/worker.bak" 2>/dev/null || true
fi

# 큰 프런트 파일을 제자리 cp 하면 복사 중 접속한 브라우저가 '절반짜리 JS'를
# 받을 수 있다. 같은 파일시스템의 임시 파일을 완성한 뒤 mv로 원자 교체하고,
# 새 HTML은 JS/CSS가 모두 준비된 마지막에 공개한다.
deploy_atomic(){
    local src="$1" dst="$2" tmp="${2}.deploy.$$"
    install -m 0644 "$src" "$tmp"
    mv -f "$tmp" "$dst"
}
deploy_atomic "$SRC/sdynotes.js"   "$APP_DIR/sdynotes.js"
deploy_atomic "$SRC/sdynotes.css"  "$APP_DIR/sdynotes.css"
deploy_atomic "$SRC/package.json"  "$APP_DIR/package.json"
[ -f "$SRC/package-lock.json" ] && deploy_atomic "$SRC/package-lock.json" "$APP_DIR/package-lock.json"
deploy_atomic "$SRC/sdynotes.html" "$APP_DIR/sdynotes.html"
rm -rf "$APP_DIR/server" "$APP_DIR/worker" "$APP_DIR/scripts"
cp -r "$SRC/server" "$APP_DIR/server"
cp -r "$SRC/worker" "$APP_DIR/worker"
[ -d "$SRC/scripts" ] && cp -r "$SRC/scripts" "$APP_DIR/scripts"
sudo chown -R "$USER:$USER" "$APP_DIR"

ok "sdynotes.html / .css / .js 배포됨 ($(du -h "$APP_DIR/sdynotes.html" | cut -f1), $(du -h "$APP_DIR/sdynotes.css" | cut -f1), $(du -h "$APP_DIR/sdynotes.js" | cut -f1))"
ok "server/ + worker/ + package.json"

# ── Node 의존성 설치 ────────────────────────────────────────
if [ -f "$APP_DIR/package.json" ] && [ ! -d "$APP_DIR/node_modules" ] || [ "$APP_DIR/package.json" -nt "$APP_DIR/node_modules/.sdy-deps" ]; then
    echo "  npm 의존성 설치 중... (1분 내외)"
    ( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) \
        && touch "$APP_DIR/node_modules/.sdy-deps" && ok "npm 설치 완료" \
        || echo "  ⚠️ npm 설치 실패 — 기존 node_modules 로 시도"
else
    ok "npm 의존성 이미 설치됨"
fi

# Supabase 영구 저장소 SQL — 14.12 부터 기본 저장소는 이 서버 디스크(oracle)라
# 이 파일은 legacy(cloud) 모드로 롤백할 때만 필요합니다.
cat > "$APP_DIR/SUPABASE_SCHEMA.sql" <<'SQL'
-- SDYnotes 14.4 durable cloud state (legacy — SDY_STORAGE=cloud 롤백용)
create table if not exists public.sdy_sync_states (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.sdy_card_decks (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.sdy_music_tracks (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.sdy_stickers (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists sdy_sync_states_updated_at_idx on public.sdy_sync_states(updated_at);
create index if not exists sdy_card_decks_updated_at_idx on public.sdy_card_decks(updated_at);
create index if not exists sdy_music_tracks_updated_at_idx on public.sdy_music_tracks(updated_at);
create index if not exists sdy_stickers_updated_at_idx on public.sdy_stickers(updated_at);
alter table public.sdy_sync_states enable row level security;
alter table public.sdy_card_decks enable row level security;
alter table public.sdy_music_tracks enable row level security;
alter table public.sdy_stickers enable row level security;
SQL
sudo chown "$USER:$USER" "$APP_DIR/SUPABASE_SCHEMA.sql"
ok "legacy Supabase 스키마 SQL 생성(롤백용): $APP_DIR/SUPABASE_SCHEMA.sql"

ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
for EK in SUPABASE_URL SUPABASE_SERVICE_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_KEY CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET ACOUSTID_KEY; do
    EV="${!EK:-}"
    if [ -n "$EV" ] && ! grep -qE "^${EK}=" "$ENV_FILE"; then
        printf '%s=%s\n' "$EK" "$EV" >> "$ENV_FILE"
    fi
done
sudo chown "$USER:$USER" "$ENV_FILE"

env_get(){ awk -F= -v k="$1" '$1==k{v=substr($0,index($0,"=")+1)} END{print v}' "$ENV_FILE" 2>/dev/null; }
env_set(){
    local k="$1" v="$2" tmp
    tmp=$(mktemp)
    awk -F= -v k="$k" -v v="$v" 'BEGIN{done=0} $1==k{if(!done){print k"="v;done=1}next} {print} END{if(!done)print k"="v}' "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"; chmod 600 "$ENV_FILE"
}

# ── 저장소 모드: 기본 oracle (이 서버 디스크에 모두 저장) ──────────────
# 예전 동작(Supabase+Cloudinary)으로 돌아가려면 SDY_STORAGE=cloud 로 배포.
STORAGE_MODE="${SDY_STORAGE:-$(env_get SDY_STORAGE)}"
if [ "$STORAGE_MODE" != "cloud" ]; then
    STORAGE_MODE=oracle
    env_set SDY_STORAGE oracle
    ok "저장소 모드: oracle — 모든 데이터를 이 Oracle 서버에 저장 (Supabase/Cloudinary 미사용)"
else
    env_set SDY_STORAGE cloud
    echo "  ⚠️ legacy cloud 모드(Supabase+Cloudinary) — 쿼터 초과 주의"
fi

if [ -d "$APP_DIR/vault" ]; then
    VN=$(find "$APP_DIR/vault" -type f ! -name '_index.json' 2>/dev/null | wc -l)
    ok "보관함 파일 ${VN}개 그대로 유지"
fi

# ── 3. 런타임 준비 ──────────────────────────────────────────
say "3/6  런타임"
# Node.js 확인 (18+ 필요)
if command -v node >/dev/null 2>&1; then
    NODE_V=$(node -v | tr -d 'v')
    ok "node $(node -v)"
else
    echo "  Node.js 설치 중 (20.x)..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1 \
        && sudo apt-get install -y -qq nodejs >/dev/null 2>&1 \
        && ok "node $(node -v)" || die "Node.js 설치 실패 — 직접 설치 후 재실행해 주세요"
fi
# 최초 설치까지 포함해 실제로 복사된 프런트/서버 파일을 한 번 더 확인한다.
node --check "$APP_DIR/sdynotes.js" >/dev/null || die "배포된 sdynotes.js 문법 오류"
node --check "$APP_DIR/server/src/index.js" >/dev/null || die "배포된 서버 JS 문법 오류"

# 파이썬 워커 라이브러리 — worker/requirements.txt 로 버전 고정 (14.17).
# yt-dlp 만 아래쪽에서 매 배포 -U 로 갱신한다 (유튜브 대응).
REQ="$APP_DIR/worker/requirements.txt"

if ! command -v fpcalc > /dev/null; then
    echo "  노래 인식용 fpcalc 설치 중..."
    sudo apt-get install -y -qq libchromaprint-tools 2>/dev/null \
        && ok "fpcalc 설치 완료" || echo "  (fpcalc 설치 실패 — 소리 인식만 비활성화됩니다)"
else
    ok "fpcalc 준비됨 ($(fpcalc -version 2>&1 | head -1))"
fi

# deno (유튜브 봇검사 해결)
if [ ! -x "$HOME/.deno/bin/deno" ] && ! command -v deno > /dev/null; then
    echo "  유튜브 봇검사 해결용 deno 설치 중..."
    mkdir -p "$HOME/.deno/bin"
    # 14.10 · ARM(Ampere A1) 마이그레이션 지원: CPU 아키텍처에 맞는 바이너리를 받는다
    case "$(uname -m)" in
        aarch64|arm64) DENO_PKG="deno-aarch64-unknown-linux-gnu.zip" ;;
        *)             DENO_PKG="deno-x86_64-unknown-linux-gnu.zip" ;;
    esac
    curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/latest/download/$DENO_PKG" 2>/dev/null \
        && python3 - /tmp/deno.zip "$HOME/.deno/bin" <<'PYEOF'
import sys, zipfile
try:
    with zipfile.ZipFile(sys.argv[1]) as z:
        z.extractall(sys.argv[2])
except Exception as e:
    sys.stderr.write("deno unzip fail: %s\n" % e)
PYEOF
    rm -f /tmp/deno.zip
    chmod +x "$HOME/.deno/bin/deno" 2>/dev/null || true
fi
[ -x "$HOME/.deno/bin/deno" ] && ok "deno 준비됨 ($(uname -m))" || echo "  ⚠️ deno 없음 — 유튜브가 막히면 쿠키만으로 안 될 수 있어요"

# bgutil PO 토큰 공급기
if [ -x "$HOME/.deno/bin/deno" ] || command -v deno > /dev/null; then
    if [ ! -f "$HOME/bgutil-ytdlp-pot-provider/server/src/generate_once.ts" ]; then
        rm -rf "$HOME/bgutil-ytdlp-pot-provider"
        git clone --quiet --single-branch --branch 1.3.1 --depth 1 \
            https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
            "$HOME/bgutil-ytdlp-pot-provider" 2>/dev/null \
            && ok "PO 토큰 공급기 소스 준비" || echo "  (공급기 소스 실패 — deno 만으로 시도)"
    fi
    if [ -f "$HOME/bgutil-ytdlp-pot-provider/server/src/generate_once.ts" ]; then
        DENO_BIN="$HOME/.deno/bin/deno"; command -v deno >/dev/null && DENO_BIN="$(command -v deno)"
        ( cd "$HOME/bgutil-ytdlp-pot-provider/server" \
            && "$DENO_BIN" install --allow-scripts=npm:canvas --frozen >/dev/null 2>&1 ) \
            && ok "PO 토큰 공급기 준비" || echo "  (공급기 의존성 세팅 실패 — deno 만으로 시도)"
    fi
fi

# 워커 파이썬 가상환경
if [ ! -x "$APP_DIR/venv/bin/python" ]; then
    echo "  최초 설치 중... (2~3분 걸립니다)"
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3-venv python3-pip
    python3 -m venv "$APP_DIR/venv"
    "$APP_DIR/venv/bin/pip" install -q --upgrade pip
    "$APP_DIR/venv/bin/pip" install -q -r "$REQ"
    ok "워커 파이썬 설치 완료"
else
    # 기존 서버도 마이그레이션 후 음악 worker에 필요한 패키지를 빠짐없이
    # 확인한다. 예전에는 PDF 관련 모듈만 확인해서 cloudinary/pillow-heif/
    # mutagen이 빠진 기존 venv에서는 Node·채팅은 살아 있어도 음악 기능만
    # 조용히 실패할 수 있었다.
    if ! "$APP_DIR/venv/bin/python" -c "import flask, flask_cors, cloudinary, pillow_heif, fitz, docx, deep_translator, requests, mutagen, openpyxl" 2>/dev/null; then
        echo "  음악/worker 의존성 보강 설치 중..."
        "$APP_DIR/venv/bin/pip" install -q -r "$REQ"
        ok "worker 의존성 보강 완료"
    else
        "$APP_DIR/venv/bin/pip" install -q -U yt-dlp 2>/dev/null \
            && ok "yt-dlp 최신화" || echo "  (yt-dlp 갱신 실패 — 기존 버전으로 계속)"
        ok "worker 의존성 이미 설치됨 (건너뜀)"
    fi
fi

# ── 3.5. 음성은 서버 릴레이 (WebRTC/TURN 사용 안 함) ─────────
# 통화는 HTTPS 위의 WebSocket(/api/chat/voice-ws) 으로만 중계한다.
# coturn 을 새로 깔지 않는다. 이미 떠 있는 coturn 은 건드리지 않는다.
echo "  음성 통화: 서버 릴레이 (TURN/STUN 불필요)"

# ── 4. 서비스 등록 (단일 프로세스 유지) ──────────────────────
say "4/6  자동 실행 서비스"
# 설정은 항상 APP_DIR/.env 를 단일 기준으로 사용한다.
# 이전 버전은 기존 systemd Environment= 줄을 복사했는데, 그러면 마이그레이션
# 뒤 .env의 AcoustID 값을 바꿔도 오래된 값이 EnvironmentFile보다 우선되어
# 음악 인식이 계속 옛 설정으로 실행될 수 있다.
ENV_LINES=""

# 서버 메모리를 확인해 Node 힙·Python 워커 동시성·스레드풀을 한 번에 튜닝한다.
# Node(프런트/SSE)와 Python 워커(PDF/음악)가 같은 박스에서 돌고 워커는 자식
# 프로세스를 여러 개 띄우므로, RAM 전체를 Node에 몰아주지 않는다.
# 12GB 박스 배분 (RAM_MB ≈ 11700~12000):
#   OS+nginx 예약             ≈ 1.5GB
#   Node  (힙 2GB + 채팅 파일 버퍼/업로드/SSE) ≈ 4.5GB 이하
#   worker(본체 0.9GB + 변환 자식 전역 최대 4×1GB)   ≈ 5.0GB 이하
#   ─ 합계 약 11GB — 페이지 캐시/스왑 여유 1GB+
# 예전처럼 Node 힙을 62%(≈7.5GB)로 키우면 V8이 회수를 미뤄 RSS가 부풀고,
# 워커의 PyMuPDF 자식과 겹칠 때 스왑쓰래싱/OOM이 났다. 힙은 '실제로 필요한
# 만큼만' 주고, 오프힙 버퍼(채팅 파일)는 별도 예산으로 잠근다.
RAM_MB=$(awk '/MemTotal:/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 2048)
if   [ "$RAM_MB" -ge 10240 ]; then NODE_HEAP_MB=2048
elif [ "$RAM_MB" -ge 6144  ]; then NODE_HEAP_MB=1536
elif [ "$RAM_MB" -ge 3072  ]; then NODE_HEAP_MB=1024
else                                NODE_HEAP_MB=512
fi
NODE_MAX_MB=$((NODE_HEAP_MB + 2560))   # 힙 + 채팅파일/업로드/SSE 버퍼 오프힙 예산
if   [ "$RAM_MB" -ge 10240 ]; then WORKER_MAX_MB=$((RAM_MB - NODE_MAX_MB - 1536))
elif [ "$RAM_MB" -ge 6144  ]; then WORKER_MAX_MB=$((RAM_MB - NODE_MAX_MB - 1280))
else                                WORKER_MAX_MB=$((RAM_MB - NODE_MAX_MB - 900))
fi
[ "$WORKER_MAX_MB" -lt 2048 ] && WORKER_MAX_MB=2048
CHAT_FILE_MB=$((NODE_HEAP_MB / 4))      # 채팅 사진/파일 인메모리 총 예산(12GB→512MB)
[ "$CHAT_FILE_MB" -lt 128 ] && CHAT_FILE_MB=128

# Python 임포트 자식 프로세스 동시성. 한 잡이 내부에서 청크를 여러 개
# 병렬로 띄우고, 잡 자체도 IMP_CONC 개까지 동시에 돈다. 자식은 RLIMIT_AS 로
# 메모리 상한이 잡히지만, 잡 수 × 청크 수가 RAM 을 넘지 않도록 아래에서
# '전역 자식 상한(SDY_IMP_MAX_CHUNKS)'을 만들어 실제로 막는다.
if   [ "$RAM_MB" -ge 10240 ]; then IMP_CONC=2; IMP_CHILD_MEM_MB=1024
elif [ "$RAM_MB" -ge 6144  ]; then IMP_CONC=2; IMP_CHILD_MEM_MB=1024
elif [ "$RAM_MB" -ge 3072  ]; then IMP_CONC=1; IMP_CHILD_MEM_MB=1024
else                               IMP_CONC=1; IMP_CHILD_MEM_MB=768
fi
IMP_CHILD_BUDGET_MB=$((WORKER_MAX_MB - 900))   # 워커 본체+Flask 예약 후 남는 몫
[ "$IMP_CHILD_BUDGET_MB" -lt 2048 ] && IMP_CHILD_BUDGET_MB=2048
IMP_MAX_CHUNKS=$((IMP_CHILD_BUDGET_MB / IMP_CHILD_MEM_MB))
[ "$IMP_MAX_CHUNKS" -lt 2 ] && IMP_MAX_CHUNKS=2
[ "$IMP_MAX_CHUNKS" -gt $((IMP_CONC * 3)) ] && IMP_MAX_CHUNKS=$((IMP_CONC * 3))

# libuv 스레드풀(sharp·crypto·파일 I/O 백그라운드). CPU 수에 비례해 키운다.
CPU_N=$(nproc 2>/dev/null || echo 2)
UV_THREADS=$((CPU_N * 2))
[ "$UV_THREADS" -lt 8 ]  && UV_THREADS=8
[ "$UV_THREADS" -gt 24 ] && UV_THREADS=24

# 14.13.5 · 2코어/12GB 대응 — 메모리가 넉넉하면 동기화 상태 캐시를 더 크게.
# (협업 중 1초에 여러 번 도는 전체 상태 읽기의 반복 JSON.parse 를 줄인다)
if   [ "$RAM_MB" -ge 10240 ]; then SYNC_CACHE_MAX=3000
elif [ "$RAM_MB" -ge 6144  ]; then SYNC_CACHE_MAX=2000
else                                SYNC_CACHE_MAX=1500
fi

ok "메모리 튜닝: RAM ${RAM_MB}MB → Node 힙 ${NODE_HEAP_MB}MB(전체 예산 ${NODE_MAX_MB}MB, 채팅파일 ${CHAT_FILE_MB}MB, sync캐시 ${SYNC_CACHE_MAX}개) / 워커 예산 ${WORKER_MAX_MB}MB (자식 ${IMP_MAX_CHUNKS}×${IMP_CHILD_MEM_MB}MB, 동시잡 ${IMP_CONC}) / UV 스레드 ${UV_THREADS}"

sudo tee "/etc/systemd/system/$SVC.service" > /dev/null <<EOF
[Unit]
Description=SDYnotes backend (Fastify)
After=network.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env
Environment="PORT=$PORT"
Environment="HOME=$HOME"
Environment="NODE_OPTIONS=--max-old-space-size=$NODE_HEAP_MB"
Environment="UV_THREADPOOL_SIZE=$UV_THREADS"
Environment="SDY_CHAT_FILE_MB=$CHAT_FILE_MB"
Environment="SDY_SYNC_CACHE_MAX=$SYNC_CACHE_MAX"
$ENV_LINES
LimitNOFILE=65535
ExecStart=$(command -v node) $APP_DIR/server/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo tee "/etc/systemd/system/$SVC_WORKER.service" > /dev/null <<EOF
[Unit]
Description=SDYnotes worker (import/music)
After=network.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env
Environment="HOME=$HOME"
Environment="SDY_WORKER_PORT=$WORKER_PORT"
Environment="SDY_NODE_URL=http://127.0.0.1:$PORT"
Environment="PYTHONUNBUFFERED=1"
Environment="SDY_IMP_MAX_CONCURRENT=$IMP_CONC"
Environment="SDY_IMP_CHILD_MEM_MB=$IMP_CHILD_MEM_MB"
Environment="SDY_IMP_MAX_CHUNKS=$IMP_MAX_CHUNKS"
Environment="MALLOC_ARENA_MAX=2"
$ENV_LINES
LimitNOFILE=65535
ExecStart=$APP_DIR/venv/bin/python $APP_DIR/worker/run.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SVC" -q
sudo systemctl enable "$SVC_WORKER" -q
ok "단일 프로세스 서비스 적용 (node + worker)"

# ── 5. nginx ────────────────────────────────────────────────
say "5/6  웹서버 연결"
if command -v nginx > /dev/null; then
    if [ ! -f /etc/nginx/sites-available/memo ]; then
        sudo tee /etc/nginx/sites-available/memo > /dev/null <<EOF
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 100M;
    # 14.13.5 · 버전화된 프런트 에셋 — nginx 가 디스크에서 직접 내보내고 1년 캐시
    #   (URL 의 ?v= 가 배포마다 바뀐다 → stale 리스크 없음, 재확인 왕복 제로)
    location = /sdynotes.js {
        root $APP_DIR;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }
    location = /sdynotes.css {
        root $APP_DIR;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }
    location /api/chat/voice-ws {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
EOF
        sudo ln -sf /etc/nginx/sites-available/memo /etc/nginx/sites-enabled/memo
        sudo rm -f /etc/nginx/sites-enabled/default
        sudo nginx -t && sudo systemctl restart nginx
        ok "nginx 연결 완료 (SSE 버퍼링 해제)"
    else
        NGINX_CONF=/etc/nginx/sites-available/memo
        NGINX_CHANGED=0
        if ! grep -q "proxy_read_timeout" "$NGINX_CONF"; then
            sudo sed -i '/proxy_set_header X-Forwarded-For/a\        proxy_read_timeout 900s;\n        proxy_send_timeout 900s;' "$NGINX_CONF"
            NGINX_CHANGED=1
        fi
        # timeout 설정이 이미 있더라도 buffering이 남아 있으면 채팅/SSE가 묶여서
        # 늦게 도착할 수 있으므로 독립적으로 확인한다.
        if ! grep -qE '^[[:space:]]*proxy_buffering[[:space:]]+off;' "$NGINX_CONF"; then
            sudo sed -i '/proxy_set_header X-Forwarded-For/a\        proxy_buffering off;\n        proxy_cache off;' "$NGINX_CONF"
            NGINX_CHANGED=1
        fi
        # 14.13.5 · 버전화된 프런트 에셋 장기 캐시 location 보강 (idempotent)
        if ! grep -q 'location = /sdynotes.js' "$NGINX_CONF" 2>/dev/null; then
            STATIC_PY="$SRC/scripts/ensure_nginx_static_cache.py"
            [ -f "$STATIC_PY" ] || STATIC_PY="$APP_DIR/scripts/ensure_nginx_static_cache.py"
            if [ -f "$STATIC_PY" ]; then
                sudo cp "$NGINX_CONF" "$NGINX_CONF.bak.static"
                if sudo python3 "$STATIC_PY" "$NGINX_CONF" "$APP_DIR" | grep -q '^inserted'; then
                    NGINX_CHANGED=1
                    ok "nginx 프런트 에셋 장기 캐시 경로 추가"
                else
                    sudo mv "$NGINX_CONF.bak.static" "$NGINX_CONF"
                fi
                rm -f "$NGINX_CONF.bak.static"
            fi
        fi
        # 기존 site 파일(이전 배포)에는 location / 만 있다. Connection "" 가
        # WebSocket 핸드셰이크를 삼키므로, 파일 유무와 관계없이 Upgrade 경로를
        # 보강한다. (예전엔 파일이 없을 때만 써서 재실행해도 경고가 남았다)
        if ! sudo grep -q 'location /api/chat/voice-ws' "$NGINX_CONF" 2>/dev/null; then
            VOICE_PY="$SRC/scripts/ensure_nginx_voice_ws.py"
            [ -f "$VOICE_PY" ] || VOICE_PY="$APP_DIR/scripts/ensure_nginx_voice_ws.py"
            if [ -f "$VOICE_PY" ]; then
                sudo cp "$NGINX_CONF" "$NGINX_CONF.bak.voice"
                if sudo python3 "$VOICE_PY" "$NGINX_CONF" "$PORT"; then
                    NGINX_CHANGED=1
                    ok "nginx 음성 WebSocket 경로 추가"
                else
                    sudo mv "$NGINX_CONF.bak.voice" "$NGINX_CONF"
                    echo "  ⚠️ nginx 음성 경로 추가 실패 — 설정을 되돌렸습니다"
                fi
            else
                echo "  ⚠️ scripts/ensure_nginx_voice_ws.py 없음 — 음성 nginx 경로를 수동으로 넣어 주세요"
            fi
        fi
        if sudo nginx -t >/dev/null 2>&1; then
            sudo systemctl reload nginx
            sudo rm -f "$NGINX_CONF.bak.voice"
            [ "$NGINX_CHANGED" = 1 ] && ok "nginx 대기 시간/SSE/음성 WS 설정 적용" || ok "nginx 설정 이미 적용됨"
        else
            if [ -f "$NGINX_CONF.bak.voice" ]; then
                sudo mv "$NGINX_CONF.bak.voice" "$NGINX_CONF"
                echo "  nginx 설정 검사 실패 — 음성 경로 추가를 되돌렸습니다"
            else
                echo "  nginx 설정 검사 실패 — /etc/nginx/sites-available/memo 를 확인하세요"
            fi
        fi
    fi
else
    echo "  nginx 없음 → http://주소:$PORT 로 접속하세요"
fi

# swap (대용량 변환/스파이크 보호 — RAM 의 1/4, 최소 2GB, 최대 6GB)
if ! swapon --show 2>/dev/null | grep -q .; then
    say "5.5/6  swap 만들기"
    SWAP_GB=2
    [ "$RAM_MB" -ge 8192 ]  && SWAP_GB=4
    [ "$RAM_MB" -ge 16384 ] && SWAP_GB=6
    SWAP_MB=$((SWAP_GB * 1024))
    if sudo fallocate -l "${SWAP_GB}G" /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=$SWAP_MB status=none 2>/dev/null; then
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile || true
        grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
        # 서버형 워크로드: 캐시보다 스왑을 천천히, 페이지 캐시를 우선 유지
        sudo sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true
        grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness = 10' | sudo tee -a /etc/sysctl.conf > /dev/null
        ok "swap ${SWAP_GB}GB 활성화 (swappiness=10)"
    fi
else
    echo "  swap 이미 사용 중 (건너뜀)"
fi

# nginx 업로드 제한
if command -v nginx > /dev/null; then
    CONF=/etc/nginx/conf.d/sdy-upload.conf
    if [ ! -f "$CONF" ] || ! grep -q "client_max_body_size 512M" "$CONF"; then
        echo "client_max_body_size 512M;" | sudo tee "$CONF" > /dev/null
        if sudo nginx -t >/dev/null 2>&1; then sudo systemctl reload nginx; ok "업로드 제한 512M 적용"; else sudo rm -f "$CONF"; fi
    else
        ok "이미 적용됨"
    fi
fi

# ── 6. 재시작 + 확인 ────────────────────────────────────────
say "6/6  재시작"
sudo systemctl stop "$SVC" 2>/dev/null || true
sudo systemctl stop "$SVC_WORKER" 2>/dev/null || true
sudo pkill -f "python.*app\.py" 2>/dev/null || true
sudo pkill -f "worker/run.py" 2>/dev/null || true
sleep 1
sudo fuser -k "$PORT/tcp" 2>/dev/null || true
sleep 1

# ── 6.5 클라우드 → oracle 데이터 이전 (최초 1회, 서비스 정지 상태에서) ──
# Supabase/Cloudinary 키가 .env 에 남아 있고 아직 이전 마커가 없으면
# scripts/migrate_to_oracle.mjs 가 모든 행·파일·URL 을 이 서버로 옮긴다.
if [ "$STORAGE_MODE" != "cloud" ] && [ -f "$APP_DIR/scripts/migrate_to_oracle.mjs" ]; then
    MIG_KEY=$(env_get SUPABASE_SERVICE_KEY)
    [ -z "$MIG_KEY" ] && MIG_KEY=$(env_get SUPABASE_SERVICE_ROLE_KEY)
    [ -z "$MIG_KEY" ] && MIG_KEY=$(env_get SUPABASE_KEY)
    if [ -n "$MIG_KEY" ] && [ ! -f "$APP_DIR/.oracle_migrated" ]; then
        say "6.5/6  Supabase/Cloudinary → Oracle 서버 데이터 이전"
        ( cd "$APP_DIR" && node scripts/migrate_to_oracle.mjs --base "$APP_DIR" ) \
            && ok "데이터 이전 완료 (.oracle_migrated.report.json 참조)" \
            || echo "  ⚠️ 이전 중 일부 실패 — .oracle_migrated.report.json 확인 후 재실행하세요. 서비스는 계속 시작합니다."
    elif [ -f "$APP_DIR/.oracle_migrated" ]; then
        ok "데이터 이전 이미 완료(.oracle_migrated) — 건너뜀"
    else
        echo "  이전할 Supabase 키가 없어 클라우드 이전을 건너뜁니다 (로컬 데이터만 사용)"
    fi
fi

sudo systemctl start "$SVC_WORKER"
sudo systemctl start "$SVC"

# 서버가 실제로 응답할 때까지 대기한다. 첫 부팅은 모듈 로딩 등으로 4초보다
# 오래 걸릴 수 있어(느린 서버에선 8~17초), 고정 대기 후 즉시 curl 하면
# 'API 응답 이상'으로 오진하곤 했다. 응답할 때까지 폴링하고, 그 사이
# 프로세스가 죽으면 로그를 보여준다.
say "  서버 응답 대기 (최대 약 2분)…"
UP=""
for _i in $(seq 1 30); do
    if ! systemctl is-active --quiet "$SVC"; then
        journalctl -u "$SVC" -n 30 --no-pager
        die "서버가 시작되지 않았습니다 (위 에러 확인)"
    fi
    if [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)" = "200" ]; then
        UP=1
        break
    fi
    sleep 2
done
if [ -z "$UP" ]; then
    journalctl -u "$SVC" -n 30 --no-pager
    die "서버가 기동 후에도 응답하지 않습니다 (위 로그 확인)"
fi
ok "서비스 실행 중 (node + worker)"

H=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/health" || true)
A=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/admin/status" || true)
P=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)
JS=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/sdynotes.js?v=$HTML_VER" || true)
CSS=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/sdynotes.css?v=$HTML_VER" || true)
YT=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/music/youtube/status" || true)
RECOG=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/music/recognize/status" || true)
CLOUD=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/cloud/status" || true)
VOICE_CFG=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/chat/config?uid=deploy-check" || true)
VOICE_WS=$(sudo grep -c 'location /api/chat/voice-ws' /etc/nginx/sites-available/memo 2>/dev/null || true)
VOICE_WS=${VOICE_WS:-0}

echo
echo "  페이지        : $P"
echo "  프런트 JS/CSS : $JS / $CSS   $([ "$JS" = 200 ] && [ "$CSS" = 200 ] && echo '(정상)' || echo '(★실패)')"
echo "  관리자 API    : $A   $([ "$A" = 200 ] && echo '(정상)' || echo '(★실패)')"
echo "  health        : $H"
echo "  클라우드 상태  : $CLOUD"
echo "  유튜브(worker) : $YT"
echo "  소리 인식      : $RECOG"
if echo "$RECOG" | grep -q '"ready"[[:space:]]*:[[:space:]]*true'; then
    echo "  ✅ 소리 인식 준비됨 (fpcalc + AcoustID 키)"
else
    echo "  ⚠️  소리 인식 미준비 — fpcalc 또는 ACOUSTID_KEY/music/_acoustid.json 확인"
fi
if echo "$VOICE_CFG" | grep -q '"voice":"relay"'; then
    echo "  음성 릴레이    : 준비됨 (/api/chat/voice-ws)"
else
    echo "  음성 릴레이    : ⚠️ /api/chat/config 가 voice:relay 가 아님 — $VOICE_CFG"
fi
if [ "${VOICE_WS:-0}" -ge 1 ] 2>/dev/null; then
    echo "  음성 nginx     : WebSocket Upgrade 경로 있음"
elif command -v nginx >/dev/null; then
    echo "  음성 nginx     : ⚠️ /api/chat/voice-ws location 없음 — 기존 memo 파일 보강 실패, /etc/nginx/sites-available/memo 확인"
fi
if echo "$CLOUD" | grep -q '"supabase":true' && echo "$CLOUD" | grep -q '"cloudinary":true'; then
    echo "  ✅ 영구 저장소 준비됨 (legacy cloud 모드)"
elif echo "$CLOUD" | grep -q '"storage":"oracle"'; then
    echo "  ✅ 영구 저장소 준비됨 (oracle — 이 서버 디스크, Supabase/Cloudinary 미사용)"
else
    echo "  ⚠️  저장소 상태를 확인하지 못했습니다: $CLOUD"
fi
if echo "$YT" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'; then
    echo "  ✅ yt-dlp 준비 완료 — 유튜브 링크를 붙여넣으면 원본 음원 그대로 추가됩니다"
else
    echo "  ⚠️  yt-dlp 가 아직 안 보입니다 — 위 메시지 확인 후 이 스크립트를 한 번 더 실행해 주세요"
fi
echo

if [ "$A" = "200" ] && [ "$P" = "200" ] && [ "$JS" = "200" ] && [ "$CSS" = "200" ]; then
    IP=$(curl -s -m 5 ifconfig.me 2>/dev/null || echo "서버주소")
    echo -e "\033[1;32m✅ 배포 성공 →  http://$IP/\033[0m"
    rm -rf "$APP_DIR/server.bak" "$APP_DIR/worker.bak"
else
    die "API 응답 이상 —  journalctl -u $SVC -n 50 --no-pager  로 확인하세요"
fi
