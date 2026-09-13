# 서브사이트(latexripper / converter) 접속 설정 — HTTPS 붙이기

`sdynotes.duckdns.org` 하나만 쓰다가 `latexripper.sdynotes.duckdns.org` 같은
서브사이트를 열 때 **실제로 손대야 하는 것은 TLS 인증서 하나뿐**이다.
DNS·nginx·앱 코드는 이미 다 준비돼 있다.

## 0. 결론 요약

| 단계 | 상태 | 해야 할 일 |
|---|---|---|
| DNS (`latexripper.sdynotes.duckdns.org` → 서버 IP) | ✅ 이미 됨 | 없음 |
| nginx vhost | ✅ 이미 됨 (`server_name _` + `default_server`) | 없음 |
| 앱 Host 허용 목록 | ✅ 이미 됨 (`converterAccess.js` 기본값) | `.env` 점검만 |
| **TLS 인증서에 새 이름 포함** | ❌ **안 됨** | **이 문서의 2장** |

`apply.sh` 는 **TLS 를 전혀 만지지 않는다** (스크립트 안에 `443` / `ssl_certificate` /
`certbot` 이 한 줄도 없다). nginx 설정도 `listen 80 default_server; server_name _;`
뿐이다. 지금 `https://sdynotes.duckdns.org` 가 도는 것은 **별도로 certbot 을 돌렸기
때문**이고, 그 인증서에 새 서브도메인 이름이 없으면 브라우저가 서브사이트를 거부한다.

## 1. 왜 DNS · nginx · 앱은 손댈 게 없나

### DNS — DuckDNS 는 하위 도메인이 와일드카드다

DuckDNS 에 등록한 것은 `sdynotes` 하나지만, `*.sdynotes.duckdns.org` 는
**어떤 이름이든** 같은 IP 로 해석된다. 실측:

```text
sdynotes.duckdns.org                    → 161.33.181.176
latexripper.sdynotes.duckdns.org        → 161.33.181.176   ← 등록한 적 없음
converter.sdynotes.duckdns.org          → 161.33.181.176   ← 등록한 적 없음
zzz-nonexistent-9x7.sdynotes.duckdns.org→ 161.33.181.176   ← 아무 이름이나
nonexistent-zzz.duckdns.org             → NXDOMAIN         (남의 도메인은 안 됨)
```

즉 DuckDNS 패널에서 `latexripper` 를 추가 등록할 필요가 없고, DuckDNS 업데이트
클라이언트(cron)도 `domains=sdynotes` 하나만 갱신하면 서브사이트까지 같이 따라온다.

### nginx — 호스트를 그냥 뒤로 넘긴다

`apply.sh` 가 쓰는 서버 블록은 `server_name _` + `listen 80 default_server` 라서
**어떤 Host 로 들어와도 같은 블록**에 걸리고, `location /` 의
`proxy_set_header Host $host;` 가 그 이름을 Node 에 그대로 전달한다.
새 호스트용 `server {}` 를 만들 필요가 없다.

`scripts/ensure_nginx_voice_ws.py` · `scripts/ensure_nginx_static_cache.py` 는
**모든** `server {}` 블록을 순회하므로, 직접 추가한 443 블록에도 재실행 시
음성 WS · 에셋 캐시 location 이 자동으로 들어간다.

### 앱 — Host 헤더로 갈라진다

`server/src/lib/converterAccess.js`:

```js
const DEFAULT_HOSTS = [
  'converter.sdynotes.duckdns.org',
  'latexripper.sdynotes.duckdns.org',   // ← 별칭으로 이미 포함
];
```

`server/src/index.js` 의 `onRequest` 훅이 이 목록으로 격리한다:

- 변환기 호스트 → `/`, `/converter`, `/converter.html|css|js`, `/api/converter/*` 만 통과, **나머지 전부 404**
- `sdynotes` 호스트 → `/converter` 등 변환기 경로 **404** (로그인·노트와 완전히 분리)

`converter.js` 는 `/api/converter/...` 처럼 **상대 경로**만 쓰고 서버는
`cors: { origin: true }` 라서 호스트가 늘어나도 CORS 문제가 없다.

> ⚠️ **유일한 함정 — `.env` 의 `SDY_CONVERTER_HOSTS`**
>
> 이 변수가 있으면 `DEFAULT_HOSTS` 를 **보완하는 게 아니라 통째로 대체**한다.
> `/var/www/memo/.env` 에
> `SDY_CONVERTER_HOSTS=converter.sdynotes.duckdns.org` 만 적혀 있으면
> `latexripper` 는 404 가 된다. 쓸 거면 **쉼표로 전부 나열**:
>
> ```dotenv
> SDY_CONVERTER_HOSTS=converter.sdynotes.duckdns.org,latexripper.sdynotes.duckdns.org
> ```
>
> 아니면 **그냥 줄 자체를 지우는 게 낫다** (기본값이 이미 두 개 다 포함).
> 바꿨으면 `sudo systemctl restart sdynotes`.

## 2. TLS — 인증서에 서브도메인 이름 추가

### 2-1. 먼저 현재 상태 확인 (VM 에서)

```bash
# ① 지금 어떤 인증서가 있는지, 어떤 이름이 들어 있는지
sudo certbot certificates

# ② nginx 의 443 블록이 그 인증서를 실제로 쓰는지
sudo grep -nE 'listen|server_name|ssl_certificate|acme-challenge' \
  /etc/nginx/sites-available/memo

# ③ 발급/갱신에 어떤 방식(authenticator)을 썼는지 — 2-2 에서 똑같이 써야 한다
sudo grep -E 'authenticator|installer|cert =|webroot' \
  /etc/letsencrypt/renewal/*.conf
```

### 2-2. 경로 A (권장) — 기존 인증서에 이름만 추가

`certonly` 는 **발급만** 하고 nginx 설정은 건드리지 않는다. `--cert-name` 을 기존
라인지로 맞추면 `live/<이름>/fullchain.pem` 이 **제자리에서 갱신**되므로,
nginx 443 블록을 한 줄도 고칠 필요가 없다.

```bash
# ③ 에서 authenticator = nginx 였다면:
sudo certbot certonly --nginx \
  --cert-name sdynotes.duckdns.org \
  -d sdynotes.duckdns.org \
  -d latexripper.sdynotes.duckdns.org \
  -d converter.sdynotes.duckdns.org

# ③ 에서 authenticator = webroot 였다면 같은 방식으로 webroot 을 쓴다:
sudo certbot certonly --webroot -w /var/www/memo \
  --cert-name sdynotes.duckdns.org \
  -d sdynotes.duckdns.org \
  -d latexripper.sdynotes.duckdns.org \
  -d converter.sdynotes.duckdns.org

sudo systemctl reload nginx
```

- HTTP-01 챌린지는 Let's Encrypt 가 `http://latexripper.sdynotes.duckdns.org/.well-known/...`
  로 직접 들어와 검증한다. DNS 는 이미 되고 80 포트도 열려 있으므로 추가 작업 없음.
- `converter.sdynotes.duckdns.org` 는 지금 안 써도 **미리 넣어두는 게 이득**이다.
  나중에 추가하면 인증서가 재발급되고, 그때 또 80 포트 검증이 필요해진다.
- 갱신은 기존 certbot 타이머가 그대로 이어받는다 (`sudo certbot renew --dry-run` 으로 확인).

### 2-3. 경로 B (선택) — 와일드카드 인증서, 서브사이트를 계속 늘릴 계획이면

`*.sdynotes.duckdns.org` 는 **DNS-01 만** 가능하고, DuckDNS TXT API 를 쓰는
플러그인이 필요하다. 와일드카드는 `sdynotes.duckdns.org` **자체를 포함하지
않으므로** 항상 둘을 함께 쓴다.

```bash
sudo apt install -y pipx
pipx install certbot-dns-duckdns
# DuckDNS 토큰: https://www.duckdns.org 상단 'your token'
~/.local/bin/certbot certonly \
  --authenticator dns-duckdns \
  --dns-duckdns-token '<DUCKDNS_TOKEN>' \
  --dns-duckdns-propagation-seconds 60 \
  --cert-name sdynotes.duckdns.org \
  -d sdynotes.duckdns.org -d '*.sdynotes.duckdns.org'
sudo systemctl reload nginx
```

이렇게 해두면 `anything.sdynotes.duckdns.org` 는 **인증서 작업 없이** 바로 붙는다
(단, 앱이 그 Host 를 허용해야 한다 → 2-5).

### 2-4. nginx 443 블록이 아예 없다면

경로 A/B 로 인증서만 만든 뒤 아래를 `sites-available/memo` 의 80 블록 뒤에 붙인다.
`default_server` 와 `server_name _` 를 그대로 두면 **모든 호스트가 한 블록**을 쓰고
Host 분기는 Node 가 한다.

```nginx
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/letsencrypt/live/sdynotes.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sdynotes.duckdns.org/privkey.pem;

    client_max_body_size 512M;

    location = /sdynotes.js { root /var/www/memo; add_header Cache-Control "public, max-age=31536000, immutable"; access_log off; }
    location = /sdynotes.css { root /var/www/memo; add_header Cache-Control "public, max-age=31536000, immutable"; access_log off; }
    location /src/ { root /var/www/memo; add_header Cache-Control "public, max-age=31536000, immutable"; access_log off; }

    location /api/chat/voice-ws {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 2-5. 새 이름을 앱이 모를 때 (기본값에 없는 호스트를 쓸 경우)

`converterAccess.js` 기본값에 없는 이름(예: `pdf.sdynotes.duckdns.org`)을 쓰려면
`.env` 에 **전체 목록**을 적는다:

```dotenv
SDY_CONVERTER_HOSTS=converter.sdynotes.duckdns.org,latexripper.sdynotes.duckdns.org,pdf.sdynotes.duckdns.org
```

```bash
sudo systemctl restart sdynotes
```

## 3. 배포는 한 번이면 두 사이트가 같이 최신화된다 — 맞다

두 "사이트"는 **따로 배포되는 게 아니라 같은 프로세스의 두 얼굴**이다.

- 저장소는 하나: `apply.sh` 가 `/tmp/newsite` → **`/var/www/memo`** 로 옮긴다
- 프로세스도 하나: `sdynotes`(Node `:5000`) + `sdynotes-worker`(Python `:5100`)
- `apply.sh` 가 `converter.html/css/js` 와 `sdynotes.html/css/js`, `src/`, `server/`,
  `worker/` 를 **한꺼번에** 배포하고 두 systemd 서비스를 재기동한다
- 갈림은 **요청이 들어올 때 Host 헤더로만** 일어난다 (`index.js` 의 `onRequest` 훅)

그래서 `git clone … && sudo bash ./apply.sh` 한 번 = `sdynotes.duckdns.org` 와
`latexripper.sdynotes.duckdns.org` 가 **동시에** 새 버전이 된다. 서브사이트용
배포 명령을 따로 돌릴 필요가 없다.

> `sync/` · `db/` · `.env` · vault 는 `apply.sh` 가 보존하므로 노트 데이터는 그대로다.

## 4. 배포 후 검증

```bash
# 인증서에 새 이름이 really 들어갔는지
sudo openssl x509 -in /etc/letsencrypt/live/sdynotes.duckdns.org/fullchain.pem \
  -noout -text | grep -A1 'Subject Alternative Name'

# 로컬에서 Host 헤더만 바꿔서 두 얼굴이 다 살아 있는지 (인증서·DNS 와 무관)
curl -s -H 'Host: sdynotes.duckdns.org'            http://127.0.0.1:5000/ | head -c 80
curl -s -o /dev/null -w 'converter page: %{http_code}\n' \
     -H 'Host: latexripper.sdynotes.duckdns.org'   http://127.0.0.1:5000/
# 기대: 200

# 격리가 유지되는지 — 변환기 호스트에서 노트 API 는 404 여야 한다
curl -s -o /dev/null -w 'notes api on converter host: %{http_code}\n' \
     -H 'Host: latexripper.sdynotes.duckdns.org'   http://127.0.0.1:5000/api/chat/config
# 기대: 404

# 실 HTTPS (서버 밖에서)
curl -sSI https://latexripper.sdynotes.duckdns.org/ | head -5
```

## 5. 증상별 원인

| 증상 | 원인 | 조치 |
|---|---|---|
| 브라우저 `ERR_CERT_COMMON_NAME_INVALID` | 인증서에 새 이름 없음 | 2-2 |
| `ERR_NAME_NOT_RESOLVED` | (DuckDNS 와일드카드라 사실상 안 일어남) 로컬 DNS 캐시 | `ipconfig /flushdns` 등 |
| HTTP 는 되는데 HTTPS 만 안 됨 | 443 블록 없음 | 2-4 |
| `latexripper` 에서 **404 Not found** | `.env` 의 `SDY_CONVERTER_HOSTS` 가 기본값을 대체 | 1장 ⚠️ 박스 |
| `latexripper` 에서 SDYnotes 노트 화면이 나옴 | 그 호스트가 변환기 목록에 없음 | 의도된 동작 (1장 참조) |
| `sdynotes` 에서 `/converter` 가 404 | 의도된 격리 | 변환기 호스트로 접속 |
| `502 Bad Gateway` | Node 서비스 다운 | `systemctl status sdynotes` |
| 재실행 후 음성 WS 경고 | 기존 site 파일에 location 없음 | `apply.sh` 재실행(보강함) |
