#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  SDYnotes 14.8.0 적용 스크립트 (Fastify + Python worker 개편판)
#  ★서버 안에서 실행★
#
#  구조:
#    Node(Fastify) 메인 서버  :5000  — 프런트 서빙 + 가벼운 API + SSE
#    Python worker           :5100  — 가져오기(PDF/Word) + 음악 태깅/유튜브/인식
#
#  zip 안에  apply.sh · package.json · sdynotes.html · server/ · worker/ 를
#  폴더 없이 넣어 보내고, 서버에서 이것만 실행하면 됩니다.
#      bash apply.sh
#
#  처음 실행 → Node/파이썬/서비스/nginx 까지 자동 설치
#  두번째부터 → 파일만 교체하고 재시작 (설치 과정 건너뜀)
#  구조·클라우드 저장소·운영/롤백 방법은 README.md 참조
#  보관함(vault) 파일은 절대 지우지 않습니다.
# ─────────────────────────────────────────────────────────────
set -e

APP_DIR=/var/www/memo
PORT=5000
WORKER_PORT=5100
TURN_PORT=3478
TURN_MIN_PORT=49160
TURN_MAX_PORT=49200
SVC=sdynotes
SVC_WORKER=sdynotes-worker
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say(){ echo -e "\n\033[1;36m▶ $*\033[0m"; }
ok(){  echo -e "  \033[1;32m✓\033[0m $*"; }
die(){ echo -e "\n\033[1;31m✗ $*\033[0m"; exit 1; }

[ -f "$SRC/sdynotes.html" ]      || die "sdynotes.html 이 없습니다 (현재 위치: $SRC)"
[ -f "$SRC/package.json" ]       || die "package.json 이 없습니다"
[ -f "$SRC/server/src/index.js" ] || die "server/src/index.js 가 없습니다 — zip에 server/ 폴더를 통째로 넣어 주세요"
[ -f "$SRC/worker/run.py" ]      || die "worker/run.py 가 없습니다 — zip에 worker/ 폴더를 통째로 넣어 주세요"

say "0/6  배포 파일 확인"
echo "  sdynotes.html  $(du -h "$SRC/sdynotes.html" | cut -f1)  ($(date -r "$SRC/sdynotes.html" '+%m-%d %H:%M'))"
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

sudo cp "$SRC/sdynotes.html" "$APP_DIR/sdynotes.html"
sudo cp "$SRC/package.json"  "$APP_DIR/package.json"
rm -rf "$APP_DIR/server" "$APP_DIR/worker"
cp -r "$SRC/server" "$APP_DIR/server"
cp -r "$SRC/worker" "$APP_DIR/worker"
sudo chown -R "$USER:$USER" "$APP_DIR"

ok "sdynotes.html ($(du -h "$APP_DIR/sdynotes.html" | cut -f1))"
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

# Supabase 영구 저장소 SQL (기존과 동일)
cat > "$APP_DIR/SUPABASE_SCHEMA.sql" <<'SQL'
-- SDYnotes 14.4 durable cloud state
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
ok "Supabase 테이블 SQL 생성: $APP_DIR/SUPABASE_SCHEMA.sql"

ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
for EK in SUPABASE_URL SUPABASE_SERVICE_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_KEY CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET ACOUSTID_KEY SDY_TURN_URL SDY_LOCAL_TURN_URL SDY_TURN_USER SDY_TURN_PASS SDY_TURN_SECRET SDY_TURN_PUBLIC_IP SDY_TURN_PRIVATE_IP SDY_SETUP_TURN; do
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

# 파이썬 워커 라이브러리
PKGS="flask flask-cors beautifulsoup4 cloudinary pillow-heif pymupdf python-docx deep-translator requests mutagen openpyxl yt-dlp bgutil-ytdlp-pot-provider==1.3.1"

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
    "$APP_DIR/venv/bin/pip" install -q $PKGS
    ok "워커 파이썬 설치 완료"
else
    "$APP_DIR/venv/bin/pip" install -q -U yt-dlp 2>/dev/null \
        && ok "yt-dlp 최신화" || echo "  (yt-dlp 갱신 실패 — 기존 버전으로 계속)"
    if ! "$APP_DIR/venv/bin/python" -c "import pymupdf, docx, requests, openpyxl" 2>/dev/null; then
        "$APP_DIR/venv/bin/pip" install -q pymupdf python-docx deep-translator requests openpyxl
        ok "추가 설치 완료"
    else
        ok "이미 설치됨 (건너뜀)"
    fi
fi

# ── 3.5. TURN 릴레이 (LTE ↔ Wi-Fi / 서로 다른 공유기 통화) ─────────
# WebRTC 의 STUN 만으로는 통신사 CGNAT·대칭 NAT 를 통과할 수 없다. Oracle 서버에
# coturn 을 함께 띄우고, 브라우저에는 1시간짜리 임시 자격 증명만 내려 준다.
TURN_SETUP="${SDY_SETUP_TURN:-$(env_get SDY_SETUP_TURN)}"
[ -n "$TURN_SETUP" ] || TURN_SETUP=1
if [ "$TURN_SETUP" != "0" ]; then
    say "3.5/6  통화용 TURN 릴레이"
    if ! command -v turnserver >/dev/null 2>&1; then
        echo "  coturn 설치 중..."
        sudo apt-get update -qq
        DEBIAN_FRONTEND=noninteractive sudo apt-get install -y -qq coturn >/dev/null 2>&1 \
            || echo "  ⚠️ coturn 설치 실패 — 아래 README의 TURN 설정을 확인하세요"
    fi

    if command -v turnserver >/dev/null 2>&1; then
        TURN_PUBLIC_IP="${SDY_TURN_PUBLIC_IP:-$(env_get SDY_TURN_PUBLIC_IP)}"
        [ -n "$TURN_PUBLIC_IP" ] || TURN_PUBLIC_IP=$(curl -4 -fsS --max-time 6 https://api.ipify.org 2>/dev/null || true)
        TURN_PRIVATE_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++)if($i=="src"){print $(i+1);exit}}')
        [ -n "$TURN_PRIVATE_IP" ] || TURN_PRIVATE_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
        TURN_SECRET="${SDY_TURN_SECRET:-$(env_get SDY_TURN_SECRET)}"
        if [ -z "$TURN_SECRET" ]; then
            if command -v openssl >/dev/null 2>&1; then TURN_SECRET=$(openssl rand -hex 32)
            else TURN_SECRET=$(python3 -c 'import secrets;print(secrets.token_hex(32))'); fi
        fi

        # Oracle 이미지에 따라 공인 IP 가 (a) VCN 1:1 NAT 로 사설 IP 뒤에 숨어 있거나
        # (b) NIC 에 직접 붙어 있을 수 있다. (b) 는 external-ip 가 오히려 릴레이를
        # 망가뜨리고 listening-ip 를 사설로 고정하면 외부 패킷이 coturn 에 안 닿는다.
        # NIC 에 공인 IP 가 있는지 실제로 확인해서 설정을 갈라 준다.
        ON_NIC=$(ip -4 addr show 2>/dev/null | grep -c "inet ${TURN_PUBLIC_IP}/" || true)
        if [ "$ON_NIC" -gt 0 ]; then
            echo "  공인 IP $TURN_PUBLIC_IP 가 NIC 에 직접 붙어 있음 → external-ip 생략, 전체 인터페이스 수신"
            LISTEN_LINE=""
            TURN_EXTERNAL=""
        else
            LISTEN_LINE="listening-ip=$TURN_PRIVATE_IP"
            TURN_EXTERNAL="external-ip=$TURN_PUBLIC_IP"
            [ "$TURN_PUBLIC_IP" = "$TURN_PRIVATE_IP" ] || TURN_EXTERNAL="external-ip=$TURN_PUBLIC_IP/$TURN_PRIVATE_IP"
        fi

        if [ -n "$TURN_PUBLIC_IP" ] && [ -n "$TURN_PRIVATE_IP" ] && [ -n "$TURN_SECRET" ]; then
            env_set SDY_TURN_SECRET "$TURN_SECRET"
            env_set SDY_TURN_PUBLIC_IP "$TURN_PUBLIC_IP"
            env_set SDY_TURN_PRIVATE_IP "$TURN_PRIVATE_IP"
            # 콤마로 묶지 않는다 — 브라우저는 urls 배열에 같은 호스트가 두 번 들어가면
            # ICE candidate 중복을 피하려고 한 쪽을 버리는 경우가 있다. UDP와 TCP를
            # 별도 iceServers 엔트리로 다루게 chat.js 에서 분리하므로 여기선 베이스
            # URL만 저장한다.
            env_set SDY_LOCAL_TURN_URL "turn:$TURN_PUBLIC_IP:$TURN_PORT"

            # 최초 한 번은 사용자가 만들었던 기존 설정을 백업한다.
            if [ -f /etc/turnserver.conf ] && [ ! -f /etc/turnserver.conf.sdy-before ]; then
                sudo cp /etc/turnserver.conf /etc/turnserver.conf.sdy-before
            fi
            # relay-ip 를 사설 IP 로 강제하면 VCN 의 source-NAT 가 외부 클라이언트로
            # 보낼 패킷을 10.0.0.0/16 으로 라우팅하다가 hairpin 함정에 빠져 일부
            # 클라이언트는 "srflx 는 잡히는데 relay 가 안 잡히는" 증상을 보인다.
            # external-ip 만 두면 coturn 이 OS 의 라우팅 테이블을 따라 자동으로
            # 릴레이 소스 IP 를 결정하므로 VCN/클라우드 환경에서 안정적이다.
            # (공인 IP 가 NIC 에 직접 붙은 이미지에서는 위에서 외부 설정을 비웠다.)
            sudo tee /etc/turnserver.conf >/dev/null <<EOF
# SDYnotes managed coturn — apply.sh
listening-port=$TURN_PORT
$LISTEN_LINE
$TURN_EXTERNAL
min-port=$TURN_MIN_PORT
max-port=$TURN_MAX_PORT
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=sdynotes
stale-nonce=600
no-multicast-peers
no-loopback-peers
no-cli
no-tls
no-dtls
# 일부 브라우저/미들박스 가 long-term credential + STUN long-term
# 인증 메시지의 MESSAGE-INTEGRITY 검사를 엄격하게 한다. 명시적으로 켜두면
# "401 Unauthorized" 류 통화 실패가 사라진다.
lt-cred-mech
EOF
            if [ -f /etc/default/coturn ]; then
                sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
                grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' | sudo tee -a /etc/default/coturn >/dev/null
            fi
            sudo systemctl enable coturn -q 2>/dev/null || true
            sudo systemctl restart coturn 2>/dev/null || true

            # TURN 임시 인증(HMAC)은 서버 시계와 브라우저 시계 차이에 민감하다.
            # 시계가 틀어지면 401 로 통화가 안 되므로 chrony(NTP)를 미리 맞춰 둔다.
            if ! systemctl is-active --quiet chrony 2>/dev/null && ! systemctl is-active --quiet systemd-timesyncd 2>/dev/null; then
                DEBIAN_FRONTEND=noninteractive sudo apt-get install -y -qq chrony >/dev/null 2>&1 \
                    && sudo systemctl enable --now chrony -q 2>/dev/null || true
            fi
            sudo timedatectl set-ntp true 2>/dev/null || true

            # OS 방화벽도 연다. OCI Compute 이미지는 VCN/NSG와 별개로 iptables의
            # 마지막 REJECT 규칙을 기본 제공하는 경우가 있다. UFW가 inactive여도
            # 이 규칙 때문에 외부 패킷이 EHOSTUNREACH로 막힐 수 있으므로 현재
            # 방화벽 관리자를 감지해 필요한 포트만 허용한다 (전체 flush는 금지).
            if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q '^Status: active'; then
                sudo ufw allow "$TURN_PORT/udp" comment 'SDYnotes TURN' >/dev/null || true
                sudo ufw allow "$TURN_PORT/tcp" comment 'SDYnotes TURN' >/dev/null || true
                sudo ufw allow "$TURN_MIN_PORT:$TURN_MAX_PORT/udp" comment 'SDYnotes TURN relay' >/dev/null || true
                ok "UFW TURN 규칙 적용"
            elif command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then
                sudo firewall-cmd --permanent --add-port="$TURN_PORT/udp" >/dev/null || true
                sudo firewall-cmd --permanent --add-port="$TURN_PORT/tcp" >/dev/null || true
                sudo firewall-cmd --permanent --add-port="$TURN_MIN_PORT-$TURN_MAX_PORT/udp" >/dev/null || true
                sudo firewall-cmd --reload >/dev/null || true
                ok "firewalld TURN 규칙 적용"
            elif command -v iptables >/dev/null 2>&1; then
                ipt_allow(){
                    local proto="$1" ports="$2"
                    sudo iptables -w -C INPUT -p "$proto" -m "$proto" --dport "$ports" -m comment --comment 'SDYnotes TURN' -j ACCEPT 2>/dev/null \
                        || sudo iptables -w -I INPUT 1 -p "$proto" -m "$proto" --dport "$ports" -m comment --comment 'SDYnotes TURN' -j ACCEPT
                }
                ipt_allow udp "$TURN_PORT"
                ipt_allow tcp "$TURN_PORT"
                ipt_allow udp "$TURN_MIN_PORT:$TURN_MAX_PORT"
                # Oracle Ubuntu의 /etc/iptables/rules.v4 또는 netfilter-persistent가
                # 있으면 재부팅 뒤에도 유지한다. 둘 다 없으면 현재 부팅에는 즉시 적용.
                if command -v netfilter-persistent >/dev/null 2>&1; then
                    sudo netfilter-persistent save >/dev/null 2>&1 || true
                elif [ -d /etc/iptables ] && command -v iptables-save >/dev/null 2>&1; then
                    sudo sh -c 'iptables-save > /etc/iptables/rules.v4' || true
                fi
                ok "iptables TURN 규칙 적용 (기존 REJECT 규칙보다 우선)"
            fi
            if systemctl is-active --quiet coturn; then
                ok "TURN 실행 중 ($TURN_PUBLIC_IP:$TURN_PORT, 임시 인증)"
                # 실제로 3478(UDP/TCP) 이 떠 있는지 확인 — 켜져 있는데도 안 되면
                # Oracle VCN 인그레스 규칙을 의심할 수 있다.
                if command -v ss >/dev/null 2>&1; then
                    UDP_OK=$(ss -lun 2>/dev/null | grep -c ":$TURN_PORT " || true)
                    TCP_OK=$(ss -ltn 2>/dev/null | grep -c ":$TURN_PORT " || true)
                    [ "$UDP_OK" -gt 0 ] && [ "$TCP_OK" -gt 0 ] \
                        && ok "coturn 포트 확인: $TURN_PORT UDP+TCP 수신 중" \
                        || echo "  ⚠️ coturn 이 $TURN_PORT 를 못 열고 있을 수 있음: journalctl -u coturn -n 50"
                fi
            else
                echo "  ⚠️ coturn 이 시작되지 않았습니다: journalctl -u coturn -n 50"
            fi
            echo "  ★ Oracle Cloud 인그레스에 UDP/TCP $TURN_PORT 및 UDP $TURN_MIN_PORT-$TURN_MAX_PORT 를 열어야 외부망 통화가 됩니다."
            echo "  ★ 자기 공인 IP 로의 self-traffic 이 VCN 의 hairpin 차단으로 'No route to host' 가 나올 수 있으나"
            echo "    외부 클라이언트 → 공인 IP 경로는 정상이며 통화에는 영향이 없습니다."
            echo "  ★ 같은 호스트(SDY_TURN_URL = SDY_LOCAL_TURN_URL) 라면 외부용 정적 인증을 비워서 HMAC 임시 인증만 쓰는 것을 권장합니다."
        else
            echo "  ⚠️ 공인/사설 IP를 확인하지 못해 TURN 자동 설정을 건너뜁니다."
            echo "     .env 에 SDY_TURN_PUBLIC_IP=오라클_공인IP 를 넣고 다시 실행하세요."
        fi
    fi
else
    echo "  TURN 자동 설치 꺼짐 (SDY_SETUP_TURN=0)"
fi

# ── 4. 서비스 등록 (단일 프로세스 유지) ──────────────────────
say "4/6  자동 실행 서비스"
# 기존 Environment=(키 등) 보존
ENV_LINES=""
if [ -f "/etc/systemd/system/$SVC.service" ]; then
    ENV_LINES=$(grep -E '^[[:space:]]*Environment=' "/etc/systemd/system/$SVC.service" 2>/dev/null \
        | grep -vE 'Environment="PORT=' || true)
fi

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
$ENV_LINES
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
$ENV_LINES
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
        NGINX_CHANGED=0
        if ! grep -q "proxy_read_timeout" /etc/nginx/sites-available/memo; then
            sudo sed -i '/proxy_set_header X-Forwarded-For/a\        proxy_read_timeout 900s;\n        proxy_send_timeout 900s;' /etc/nginx/sites-available/memo
            NGINX_CHANGED=1
        fi
        # timeout 설정이 이미 있더라도 buffering이 남아 있으면 채팅/SSE가 묶여서
        # 늦게 도착할 수 있으므로 독립적으로 확인한다.
        if ! grep -qE '^[[:space:]]*proxy_buffering[[:space:]]+off;' /etc/nginx/sites-available/memo; then
            sudo sed -i '/proxy_set_header X-Forwarded-For/a\        proxy_buffering off;\n        proxy_cache off;' /etc/nginx/sites-available/memo
            NGINX_CHANGED=1
        fi
        if sudo nginx -t >/dev/null 2>&1; then
            sudo systemctl reload nginx
            [ "$NGINX_CHANGED" = 1 ] && ok "nginx 대기 시간/SSE 즉시 전송 설정 적용" || ok "nginx 설정 이미 적용됨"
        else
            echo "  nginx 설정 검사 실패 — /etc/nginx/sites-available/memo 를 확인하세요"
        fi
    fi
else
    echo "  nginx 없음 → http://주소:$PORT 로 접속하세요"
fi

# swap (저사양 서버 대용량 변환 보호)
if ! swapon --show 2>/dev/null | grep -q .; then
    say "5.5/6  swap 만들기"
    if sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none 2>/dev/null; then
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile || true
        grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
        ok "swap 2GB 활성화"
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
YT=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/music/youtube/status" || true)
CLOUD=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/cloud/status" || true)
TURN_CFG=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/chat/config?uid=deploy-check" || true)

echo
echo "  페이지        : $P"
echo "  관리자 API    : $A   $([ "$A" = 200 ] && echo '(정상)' || echo '(★실패)')"
echo "  health        : $H"
echo "  클라우드 상태  : $CLOUD"
echo "  유튜브(worker) : $YT"
if echo "$TURN_CFG" | grep -q '"turn":true'; then
    echo "  통화 TURN      : 준비됨 (Oracle 인그레스 규칙도 확인하세요)"
    TURN_DIAG=$(curl -s -m 15 "http://127.0.0.1:$PORT/api/chat/diag" || true)
    if echo "$TURN_DIAG" | grep -q '"localUdp":"ok"'; then
        echo "  TURN 진단      : 서버 안에서 STUN/TCP 응답 정상 — 외부 경로는 'curl :5000/api/chat/diag' 로 재확인"
    else
        echo "  TURN 진단      : ⚠️ 서버 안에서도 TURN 에 닿지 못함 — journalctl -u coturn -n 50 확인"
    fi
else
    echo "  통화 TURN      : ⚠️ 미설정 — 서로 다른 망 통화가 실패할 수 있습니다"
    echo "                  → $APP_DIR/.env 에 SDY_TURN_SECRET 이 있는지 확인 후 apply.sh 재실행"
fi
if echo "$CLOUD" | grep -q '"supabase":true' && echo "$CLOUD" | grep -q '"cloudinary":true'; then
    echo "  ✅ 영구 저장소 준비됨"
else
    echo "  ⚠️  아직 로컬 폴백입니다."
    echo "      1) Supabase SQL Editor에서 $APP_DIR/SUPABASE_SCHEMA.sql 실행"
    echo "      2) $APP_DIR/.env 에 SUPABASE_SERVICE_KEY 입력"
    echo "      3) .env 에 CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET 입력 후 apply.sh 재실행"
fi
if echo "$YT" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'; then
    echo "  ✅ yt-dlp 준비 완료 — 유튜브 링크를 붙여넣으면 원본 음원 그대로 추가됩니다"
else
    echo "  ⚠️  yt-dlp 가 아직 안 보입니다 — 위 메시지 확인 후 이 스크립트를 한 번 더 실행해 주세요"
fi
echo

if [ "$A" = "200" ] && [ "$P" = "200" ]; then
    IP=$(curl -s -m 5 ifconfig.me 2>/dev/null || echo "서버주소")
    echo -e "\033[1;32m✅ 배포 성공 →  http://$IP/\033[0m"
    rm -rf "$APP_DIR/server.bak" "$APP_DIR/worker.bak"
else
    die "API 응답 이상 —  journalctl -u $SVC -n 50 --no-pager  로 확인하세요"
fi
