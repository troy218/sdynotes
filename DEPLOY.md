# 토큰 한 줄 배포 (Oracle VM 안에서 실행)

> **주의**: GitHub 는 2021년부터 URL에 토큰을 박는 방식(`https://user:token@...`)을
> **deprecated** 처리하고 2025년 8월부터는 **Basic Auth 자격증명을 강제로 거부**할
> 예정이라, 가능하면 `https://x-access-token:$GH_TOKEN@github.com/...` 형태를
> 쓰세요. 둘 다 같은 동작이지만 GitHub 의 권장입니다.

## 사용자가 알려준 방식 그대로 (URL에 토큰 박기)

```bash
# ❗ 자리표시자 $TOKEN 을 본인 PAT 로 바꿔서 한 번만 실행
TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
rm -rf /tmp/newsite && git clone --depth 1 -b main \
  "https://x-access-token:${TOKEN}@github.com/troy218/sdynotes" /tmp/newsite && \
  cd /tmp/newsite && sudo bash ./apply.sh
```

> 저장소 디렉토리는 `/tmp/newsite/sdynotes` 가 아니라 `/tmp/newsite` 입니다.
> (`git clone ... /tmp/newsite` 가 `/tmp/newsite/.git`, `apply.sh` 등을 직접 만듦)

## 환경변수 방식 (URL 히스토리에 안 남음, 권장)

```bash
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
rm -rf /tmp/newsite && git clone --depth 1 -b main \
  "https://x-access-token:${GH_TOKEN}@github.com/troy218/sdynotes" /tmp/newsite && \
  cd /tmp/newsite && sudo bash ./apply.sh
```

## Deploy Key 방식 (토큰 1회만, 이후 영구 안전)

```bash
# 1) VM 에서 키 생성 + GitHub 에 공개키 등록 (1회)
ssh-keygen -t ed25519 -f ~/.ssh/sdy_deploy -N '' -C 'sdy-deploy'
cat ~/.ssh/sdy_deploy.pub
# → 출력된 줄을
#   https://github.com/troy218/sdynotes/settings/keys/new
#   "Read & write" 로 붙여넣기

# 2) ~/.ssh/config 등록
cat >> ~/.ssh/config <<'EOF'
Host gh-sdy
  HostName github.com
  User git
  IdentityFile ~/.ssh/sdy_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

# 3) 이후 모든 배포 (토큰 불필요)
rm -rf /tmp/newsite
GIT_SSH_COMMAND='ssh -o IdentitiesOnly=yes' git clone --depth 1 \
  git@gh-sdy:troy218/sdynotes.git /tmp/newsite
cd /tmp/newsite && sudo bash ./apply.sh
```

## `apply.sh` 가 자동으로 하는 일

- `npm install --omit=dev --no-audit --no-fund` (의존성)
- **저장소 모드 고정: `SDY_STORAGE=oracle`(기본)** — 모든 데이터를 이 Oracle
  서버 디스크에 저장. `.env` 에 옛 Supabase/Cloudinary 키가 남아 있어도
  무시된다. (롤백: 배포 시 `SDY_STORAGE=cloud` 환경변수)
- **최초 1회 자동 데이터 이전** — 옛 키가 있고 `.oracle_migrated` 마커가 없으면
  서비스 정지 상태에서 `node scripts/migrate_to_oracle.mjs` 가 Supabase 테이블
  7종 + Cloudinary 자산(음원·표지·스티커·보관함·노트 이미지·배경) + 콘텐츠 안
  cloudinary URL 전부를 이 서버로 옮긴다. 원본은 읽기만 하므로 안전하다.
  (`ORACLE_MIGRATION.md` 참조)
- Node/Fastify `:5000` + Python worker `:5100` systemd 서비스 재기동
- `/var/www/memo/.env` 보존 (TURN 변수는 더 이상 쓰지 않음)
- nginx 에 `/api/chat/voice-ws` WebSocket Upgrade 경로 추가
  (파일이 이미 있어도 보강 — 예전엔 신규 site 에만 넣어서 재실행해도 경고가 남았음)
- swap, deno, bgutil, fpcalc 자동 준비
- 마지막에 `음성 릴레이 : 준비됨` 출력

## 버그 일지는 어디에 저장되나요? (14.39.10)

- 기본 Oracle 모드에서는 **`/var/www/memo/sync/settings.json`**의
  `els["buglog:<id>"]`에 저장됩니다. 일반 문서와 같은 서버 디스크를 쓰되,
  일지는 설정 동기화 파일을 공유합니다. 브라우저 `sdy_buglog`는 기기 사본이고,
  미전송 변경은 `sdy_settings_outbox_8_17`에 남아 연결 복구 후 재전송됩니다.
- **`/tmp/newsite`는 내려받은 배포 코드**입니다. `apply.sh`는 코드를
  `/var/www/memo`로 옮기며 기존 `sync/`와 `db/`는 교체하지 않습니다.
  JSON 저장 때 생기는 `.tmp.*` 파일은 최종 JSON으로 원자 교체하는 중간 파일입니다.
- `apply.sh` 없이 임시 디렉터리에서 직접 서버를 실행하거나 `SDY_BASE_DIR`를 바꾸면
  데이터 위치도 달라집니다. 운영 데이터 루트를 임시 경로로 잡지 마세요.
  `SDY_STORAGE=cloud`에서는 같은 키가 Supabase `sdy_sync_states`에 저장됩니다.
- 14.39.10은 구버전 탭/빈 기기 목록의 자동 삭제를 차단합니다. 이미 서버에
  `del: 1`만 남고 본문이 없어진 일지는 패치만으로 되살릴 수 없습니다. **기존
  `sync/` 백업이나 아직 동기화하지 않은 기기 사본부터 보존**한 뒤 확인하세요.
  정상 삭제와 구별할 수 없으므로 tombstone 전체를 일괄 복원하지 않습니다.

## 배포 직후 검증

```bash
# 1) 통화 설정이 릴레이 전용인지
curl -s 'http://127.0.0.1:5000/api/chat/config?uid=deploy-check'
# 기대: {"ok":true,"voice":"relay"}

# 2) nginx 가 음성 WS 핸드셰이크를 통과시키는지
grep -A12 'location /api/chat/voice-ws' /etc/nginx/sites-available/memo
# 기대: Upgrade / Connection "upgrade" / proxy_read_timeout 3600s

# 3) 브라우저에서 — 두 명이 HTTPS 로 접속해 마이크를 켜면
#    DevTools → Network 에 /api/chat/voice-ws 가 101 Switching Protocols
```

## 자주 터지는 에러

- **`Permission denied (publickey)`** — Deploy key 안 걸고 `git@` 로 clone 시도.
  → 위 Deploy Key 방식 1) 키 등록 + 3) `GIT_SSH_COMMAND='ssh -o IdentitiesOnly=yes'`
- **`fatal: Authentication failed for 'https://troy218@github.com/...'`** — 옛
  `troy218:PAT@` URL 은 2025-08 부터 차단됨. 반드시 `x-access-token:$GH_TOKEN@` 형태로.
- **여전히 '연결 중' 에서 멈춤** — DevTools → Network 에서 `/api/chat/voice-ws`
  가 101 인지 확인. 400/404 이면 nginx Upgrade location 이 빠진 것 → `apply.sh`
  재실행(기존 site 파일에도 이제 경로를 보강함). HTTP 로 접속 중이면 마이크가
  막힌다 (`https://`).
- **`음성 nginx : location 없음` 이 재실행해도 그대로** — 예전 `apply.sh` 는
  `/etc/nginx/sites-available/memo` 가 없을 때만 location 을 썼다. 지금 버전은
  기존 파일의 80/443 블록에도 끼워 넣는다. 배포 후에도 경고면
  `sudo grep -n 'location /api/chat/voice-ws' /etc/nginx/sites-available/memo`
  로 파일을 직접 확인한다.

## 더 빠르게 (main 머지 시 자동)

`/usr/local/bin/sdy-deploy` 로 2분 폴링 배포:

```bash
#!/usr/bin/env bash
set -e
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx   # 또는 Deploy Key 등록 후 불필요
cd /var/www/memo
LOCAL=$(git rev-parse HEAD 2>/dev/null || echo none)
REMOTE=$(git ls-remote https://x-access-token:${GH_TOKEN}@github.com/troy218/sdynotes.git refs/heads/main | cut -f1)
[ "$LOCAL" = "$REMOTE" ] && exit 0
rm -rf /tmp/newsite
git clone --depth 1 -b main \
  https://x-access-token:${GH_TOKEN}@github.com/troy218/sdynotes.git /tmp/newsite
cd /tmp/newsite
# 기존 코드(/var/www/memo)는 apply.sh 가 자동 백업·교체.
# 별도 copy 불필요. apply.sh 가 알아서 /var/www/memo 로 배포.
sudo bash ./apply.sh
```

`chmod +x /usr/local/bin/sdy-deploy && /usr/local/bin/sdy-deploy` 로 수동 돌리거나,
`*/2 * * * * root /usr/local/bin/sdy-deploy >> /var/log/sdy-deploy.log 2>&1` 으로 cron.
