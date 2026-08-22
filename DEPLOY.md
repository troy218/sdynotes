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
- Node/Fastify `:5000` + Python worker `:5100` systemd 서비스 재기동
- `/var/www/memo/.env` 보존 (비밀키 유지)
- nginx, swap, deno, bgutil, fpcalc 자동 준비
- **14.9.0 부터 엽스코드(채팅·음성 통화) 제거**: 구버전이 설치한 `coturn` 을
  중지·비활성화하고 UFW 의 TURN 규칙(3478, 49160-49200)을 삭제한다.
  Oracle VCN/NSG 인그레스 규칙은 코드로 닫을 수 없으므로 콘솔에서 직접 닫아야 한다.

## 배포 직후 검증 (2단계)

```bash
# 1) 서버 API 응답 확인
curl -s http://127.0.0.1:5000/api/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/

# 2) coturn 이 꺼져 있는지 (구버전에서 업그레이드한 경우)
systemctl is-active coturn   # inactive 또는 not-found 여야 함
```

## 자주 터지는 에러

- **`Permission denied (publickey)`** — Deploy key 안 걸고 `git@` 로 clone 시도.
  → 위 Deploy Key 방식 1) 키 등록 + 3) `GIT_SSH_COMMAND='ssh -o IdentitiesOnly=yes'`
- **`fatal: Authentication failed for 'https://troy218@github.com/...'`** — 옛
  `troy218:PAT@` URL 은 2025-08 부터 차단됨. 반드시 `x-access-token:$GH_TOKEN@` 형태로.

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
