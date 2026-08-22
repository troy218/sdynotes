# 토큰 한 줄 배포 (Oracle VM에서 실행)

> 머지된 PR: https://github.com/troy218/sdynotes/pull/2
> 현재 main HEAD: `5480a82 fix(turn): WebRTC TURN 후보가 안 잡히던 문제 수정 (#2)`

## 1단계: 토큰 1회만 등록 (Oracle VM 안에서)

```bash
# GitHub Personal Access Token (PAT) — classic 'repo' scope 또는
# fine-grained 'Contents: read & write' + 'Metadata: read-only' 로 충분.
# 만료 없이도 되지만 보통 90일 / 1년 만료 설정함.
# https://github.com/settings/tokens 에서 발급.

# 이 세션에만 쓸 거면 환경변수로 (셸 닫으면 사라짐):
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 영구히 쓰려면 ssh 키를 GitHub Deploy keys 에 등록하는 게 더 깔끔.
# VM 에서: ssh-keygen -t ed25519 -f ~/.ssh/sdy_deploy -N ''
# → ~/.ssh/sdy_deploy.pub 내용을
# https://github.com/troy218/sdynotes/settings/keys/new 에 'Read & write' 로 추가
# → ~/.ssh/config 에:
#     Host gh-sdy
#       HostName github.com
#       User git
#       IdentityFile ~/.ssh/sdy_deploy
# 그 다음 origin 을 git@gh-sdy:troy218/sdynotes.git 로 한 번만 갈아끼우면 끝.
```

## 2단계: 한 줄로 끝 (권장)

```bash
# ── (A) PAT 로 한 번에 (가장 단순) ──────────────────────────
sudo bash -c "$(curl -fsSL -H 'Authorization: token '${GH_TOKEN} \
  https://raw.githubusercontent.com/troy218/sdynotes/main/apply.sh)"

# ── (B) 위가 잘 안 되면 풀 pull + apply.sh 수동 실행 ───────
cd /var/www/memo
sudo git pull https://x-access-token:${GH_TOKEN}@github.com/troy218/sdynotes.git main
sudo bash apply.sh
```

`apply.sh`가 자동으로:
- `npm install`
- Node/Python systemd 서비스 재기동
- `/etc/turnserver.conf` 재작성 → `systemctl restart coturn` (이번 PR 의 `relay-ip` 제거 + `lt-cred-mech` 추가)
- `/var/www/memo/.env` 의 `SDY_TURN_*` 값 보존/갱신
- 마지막에 `통화 TURN : 준비됨` 출력

## 3단계: 배포 직후 검증 (Oracle VM 안에서)

```bash
# 1) coturn 새 설정 적용 확인
grep -E '^(relay-ip|lt-cred-mech|fingerprint|use-auth-secret|external-ip)' /etc/turnserver.conf
# 기대:
#   fingerprint
#   use-auth-secret
#   external-ip=161.33.181.176
#   lt-cred-mech
#   (relay-ip 줄이 사라졌어야 함)

# 2) 새 ICE config 가 TURN 을 잘 주는지
curl -s 'http://127.0.0.1:5000/api/chat/config?uid=deploy-check' | head -c 800
# 기대: "turn":true, urls 배열에 turn:161.33.181.176:3478 가 정확히 2번(외부+로컬)

# 3) 외부에서 TURN 도달 (이미 확인됨 — 이건 안 깨졌으면 그대로)
timeout 4 bash -c 'exec 3<>/dev/tcp/161.33.181.176/3478 && echo OK'

# 4) 브라우저에서 — 다른 네트워크(스마트폰 LTE 등)로 들어와
#    두 명이 동시에 마이크 켜고, DevTools → chrome://webrtc-internals 에서
#    Local Address 가 49160~49200 사이고 Connection: relay 로 잡히면 성공.
```

## 자주 터지는 에러

- **`Could not resolve host: api.ipify.org`** — apply.sh 가 공인 IP 자동 감지 실패.
  → VM 에서: `export SDY_TURN_PUBLIC_IP=161.33.181.176` 후 `bash apply.sh` 다시.
- **`Permission denied (publickey)`** — Deploy key 안 걸고 `git@` 로 push/pull 시도.
  → HTTPS + `x-access-token:${GH_TOKEN}` 방식 (B) 쓰면 무관.
- **`systemctl restart coturn` 가 hang** — 옛 PID 가 살아있을 때. `sudo systemctl kill -s SIGKILL coturn` 한 번.
- **여전히 '연결 중' 에서 멈춤** — 브라우저 콘솔에
  `iceconnectionstatechange → failed` 가 보이면 DevTools → Network → WS 차단 여부,
  또는 chrome://webrtc-internals 에서 `STUN-Ping STUN` 결과의 `rtt` 가 비어있는지.
  비어있으면 STUN 자체가 막힌 거라 VCN 의 UDP 인그레스를 다시 확인.

## 다음 자동화 (원하면)

토큰 + ssh + crontab 으로 main 머지 시 자동 pull & restart 까지 묶고 싶으면
`/etc/cron.d/sdy-deploy`:

```cron
*/2 * * * * root /usr/local/bin/sdy-deploy >> /var/log/sdy-deploy.log 2>&1
```

`/usr/local/bin/sdy-deploy`:

```bash
#!/usr/bin/env bash
set -e
cd /var/www/memo
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx     # 또는 ssh key 등록 후 GH_TOKEN 없이
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git ls-remote https://x-access-token:${GH_TOKEN}@github.com/troy218/sdynotes.git refs/heads/main | cut -f1)
[ "$LOCAL" = "$REMOTE" ] && exit 0
git pull --ff-only https://x-access-token:${GH_TOKEN}@github.com/troy218/sdynotes.git main
npm install --no-audit --no-fund
bash apply.sh
systemctl restart sdynotes sdynotes-worker
```
