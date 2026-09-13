# 서브사이트(latexripper / converter) 접속 설정 — HTTPS 붙이기

`sdynotes.duckdns.org` 하나만 쓰다가 `latexripper.sdynotes.duckdns.org` 같은
서브사이트를 열 때 필요한 것은 **둘**이다 — ① TLS 인증서에 새 이름 추가,
② nginx 의 `server_name` 확장. DNS 와 앱 코드는 이미 다 준비돼 있다.

> `apply.sh` 만 돌린 신선한 서버라면 ② 가 필요 없다(`server_name _` 이라 모든
> Host 가 통과). 하지만 **`certbot --nginx` 를 한 번이라도 돌렸다면 certbot 이
> `server_name _` 를 실도메인으로 교체해 버려서 ② 가 반드시 필요하다.**
> 1장의 ⚠️ 박스와 2-4장 참조.

## 0. 결론 요약

| 단계 | 상태 | 해야 할 일 |
|---|---|---|
| DNS (`latexripper.sdynotes.duckdns.org` → 서버 IP) | ✅ 이미 됨 | 없음 |
| 앱 Host 허용 목록 | ✅ 이미 됨 (`converterAccess.js` 기본값) | `.env` 점검만 |
| **TLS 인증서에 새 이름 포함** | ❌ **안 됨** | **2-2장** |
| **nginx `server_name` / 443 `default_server`** | ❌ **certbot 이 `_` 를 실도메인으로 바꿔놨음** | **2-4장** |

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

### nginx — 호스트를 그냥 뒤로 넘긴다 (**단, certbot 이 이미 고쳤을 수 있다**)

`apply.sh` 가 쓰는 서버 블록은 `server_name _` + `listen 80 default_server` 라서
**어떤 Host 로 들어와도 같은 블록**에 걸리고, `location /` 의
`proxy_set_header Host $host;` 가 그 이름을 Node 에 그대로 전달한다.
이 상태 그대로라면 새 호스트용 `server {}` 를 만들 필요가 없다.

> ⚠️ **`certbot --nginx`(installer) 를 한 번이라도 돌렸다면 이 전제는 깨진다.**
> certbot 의 nginx installer 는 발급 대상 도메인으로 `server_name _` 를
> **그 도메인 이름으로 교체**하고, 블록을 둘로 쪼갠다:
>
> ```text
> server {                              ← Block A · HTTPS 본문
>     server_name sdynotes.duckdns.org;     ← _ 가 아니게 됨!
>     location = /sdynotes.js { … }
>     location /api/chat/voice-ws { … }
>     location / { proxy_pass …; proxy_set_header Host $host; }
>     listen 443 ssl;                   ← certbot 이 블록 끝에 덧붙임
>     ssl_certificate     /etc/letsencrypt/live/…/fullchain.pem;
>     ssl_certificate_key /etc/letsencrypt/live/…/privkey.pem;
> }
> server {                              ← Block B · certbot 이 새로 만든 리다이렉트
>     listen 80 default_server;
>     server_name sdynotes.duckdns.org;
>     if ($host = sdynotes.duckdns.org) { return 301 https://$host$request_uri; }
> }
> ```
>
> 이 모양이 되면 서브도메인은 **두 군데서 다 막힌다**:
>
> - **443**: Block A 의 `server_name` 에 새 이름이 없고 `listen 443 ssl` 에
>   `default_server` 도 없다 → SNI 불일치. nginx 가 443 의 첫 블록을
>   암묵적 기본값으로 써서 프록시는 되지만 **인증서 이름이 안 맞아** 브라우저가 차단.
> - **80**: Block B 는 `if ($host = sdynotes.duckdns.org)` 일 때만 리다이렉트하고
>   `location` 이 하나도 없다 → 새 호스트는 **프록시도 리다이렉트도 안 되고 404**.
>
> 게다가 Block A 의 `listen 80 default_server` 가 Block B 로 **옮겨졌으므로**,
> `apply.sh` 의 보강 스크립트들은 파일 수준 `grep`(`location /api/chat/voice-ws`,
> `location = /sdynotes.js`)에서 "이미 있음"으로 판단해 **Block B 는 영원히
> 건드리지 않는다**. 재실행해도 고쳐지지 않는다.
>
> → **2-4 장의 "certbot 이 이미 나눠 놓은 경우"를 반드시 함께 적용한다.**

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
nginx 443 블록의 `ssl_certificate` 경로를 고칠 필요가 없다.

```bash
# ③ 에서 authenticator = nginx 였다면 (대부분 이 경우):
sudo certbot certonly --nginx --expand \
  --cert-name sdynotes.duckdns.org \
  -d sdynotes.duckdns.org \
  -d latexripper.sdynotes.duckdns.org \
  -d converter.sdynotes.duckdns.org

# ③ 에서 authenticator = webroot 였다면 같은 방식으로 webroot 을 쓴다:
sudo certbot certonly --webroot -w /var/www/memo --expand \
  --cert-name sdynotes.duckdns.org \
  -d sdynotes.duckdns.org \
  -d latexripper.sdynotes.duckdns.org \
  -d converter.sdynotes.duckdns.org

sudo systemctl reload nginx
```

- **`--expand` 가 핵심이다.** 없으면 certbot 이 "기존 인증서를 확장·교체할까요?"
  를 대화형으로 물어보고, `--non-interactive` 라면 그냥 중단한다.
- **`sudo certbot --nginx -d …`(installer 형태) 는 쓰지 말 것.** 이미 installer 가
  한 번 지나간 설정에 다시 돌리면 `server_name` 이 또 덮어쓰이고 443 블록이 중복
  생성될 수 있다. `certonly` 로 발급만 하고 nginx 는 2-4장처럼 직접 고친다.
- HTTP-01 챌린지는 Let's Encrypt 가 `http://latexripper.sdynotes.duckdns.org/.well-known/...`
  로 직접 들어와 검증한다. DNS 는 이미 되고 80 포트도 열려 있으므로 추가 작업 없음.
  80 블록이 `default_server` 라서 `server_name` 에 새 이름이 아직 없어도 챌린지가
  그 블록으로 떨어진다 → **인증서 확장을 nginx 수정보다 먼저 해도 안전하다.**
- `converter.sdynotes.duckdns.org` 는 지금 안 써도 **미리 넣어두는 게 이득**이다.
  나중에 추가하면 인증서가 재발급되고, 그때 또 80 포트 검증이 필요해진다.
- **레이트리밋**: 같은 이름 조합의 인증서는 주 5회까지. 시행착오가 걱정되면
  먼저 `--dry-run`(staging) 으로 붙여 본다 — staging 은 한도가 없다.
- 기존 키 타입(ECDSA)은 라인지를 유지하므로 그대로 이어진다.
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
(단, 앱이 그 Host 를 허용해야 한다 → 2-6).

### 2-4. certbot 이 이미 나눠 놓은 설정에 서브도메인 추가 (**실제 운영 서버**)

2-2 로 인증서를 확장한 뒤, `/etc/nginx/sites-available/memo` 를 아래 순서로 고친다.
**반드시 백업부터.**

```bash
CONF=/etc/nginx/sites-available/memo
sudo cp -a "$CONF" "$CONF.bak.$(date +%Y%m%d-%H%M%S)"
```

#### ① 두 `server_name` 을 확장한다

certbot 이 `_` 를 실도메인으로 바꿔 놨으므로 **두 블록 모두** 고쳐야 한다.

```bash
sudo sed -i 's/server_name sdynotes\.duckdns\.org;/server_name sdynotes.duckdns.org latexripper.sdynotes.duckdns.org converter.sdynotes.duckdns.org;/g' "$CONF"
```

치환 후 문자열이 원문과 달라지므로 **두 번 실행해도 안전**(idempotent)하다.
`g` 플래그로 443 블록(파일 앞)과 80 블록(파일 뒤)이 한 번에 처리된다.

#### ② 443 에 `default_server` 를 붙인다

```bash
sudo sed -i 's/listen 443 ssl;/listen 443 ssl default_server;/' "$CONF"
```

certbot 이 남긴 주석(`# managed by Certbot`)은 줄 뒤에 그대로 남는다.
이렇게 해야 **목록에 없는 이름**으로 SNI 가 들어와도 443 의 첫 블록이 아니라
이 블록으로 떨어져서, 와일드카드 인증서로 바꿨을 때(2-3) 추가 편집이 0이 된다.

#### ③ 80 리다이렉트 블록의 `if` 에 새 호스트를 추가한다

certbot 이 만든 80 블록은 `if ($host = sdynotes.duckdns.org)` 일 때만 301 을
날리고 `location` 이 하나도 없어서, **새 호스트는 프록시도 리다이렉트도 안 되고
404** 다. 기존 `if` 바로 아래에 같은 모양으로 두 줄을 덧붙인다:

```nginx
server {
    listen 80 default_server;
    server_name sdynotes.duckdns.org latexripper.sdynotes.duckdns.org converter.sdynotes.duckdns.org;

    if ($host = sdynotes.duckdns.org) {
        return 301 https://$host$request_uri;
    } # managed by Certbot
    if ($host = latexripper.sdynotes.duckdns.org) {
        return 301 https://$host$request_uri;
    }
    if ($host = converter.sdynotes.duckdns.org) {
        return 301 https://$host$request_uri;
    }
}
```

certbot 의 기존 패턴을 그대로 복제하는 형태라 **갱신 동작이 바뀌지 않는다**.
(서버 레벨 `return` 은 nginx 의 `SERVER_REWRITE` 단계에서 실행되어 location 선택보다
먼저이므로, 통째를 `return 301 https://$host$request_uri;` 한 줄로 바꾸는 것은
권장하지 않는다 — 지금 certbot 이 ACME 챌린지를 이 `if` 구조 위에서 정상 수행 중이다.)

#### ④ 검사 후 적용

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` 가 실패하면 백업으로 되돌린다:

```bash
sudo cp -a "$CONF.bak."* "$CONF" && sudo nginx -t
```

> 실패 메시지가 `duplicate default server` 라면 다른 site 파일(예:
> `/etc/nginx/sites-enabled/default`)에도 443 `default_server` 가 있다는 뜻이다.
> `sudo grep -rn 'default_server' /etc/nginx/sites-enabled/` 로 확인하고 ② 를
> 건너뛴다 — ① 만으로도 서브도메인은 동작한다.

### 2-5. nginx 443 블록이 아예 없다면 (신선한 서버)

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

### 2-6. 새 이름을 앱이 모를 때 (기본값에 없는 호스트를 쓸 경우)

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
| `https://latexripper…` → `ERR_CERT_COMMON_NAME_INVALID` | 인증서 `Domains:` 에 새 이름 없음 | 2-2 |
| `http://latexripper…` → **nginx 404** (앱 404 아님) | certbot 80 블록에 `location` 이 없고 `if ($host = sdynotes…)` 만 있어 리다이렉트도 안 됨 | 2-4 ③ |
| `https://latexripper…` → 프록시는 되는데 인증서만 틀림 | 443 블록의 `server_name` 불일치, 암묵적 기본 블록으로 떨어짐 | 2-4 ①② |
| `ERR_NAME_NOT_RESOLVED` | (DuckDNS 와일드카드라 사실상 안 일어남) 로컬 DNS 캐시 | `ipconfig /flushdns` 등 |
| `nginx -t` → `duplicate default server` | 다른 site 파일에도 443 `default_server` | 2-4 ④ 의 박스 |
| `certbot` → `Certificate not yet due for renewal` / 확장 안 됨 | `--expand` 누락 | 2-2 |
| `latexripper` 에서 **앱이 만든 404 Not found** (plain text) | `.env` 의 `SDY_CONVERTER_HOSTS` 가 기본값을 대체 | 1장 ⚠️ 박스 |
| `latexripper` 에서 SDYnotes 노트 화면이 나옴 | 그 호스트가 변환기 목록에 없음 | 의도된 동작 (1장 참조) |
| `sdynotes` 에서 `/converter` 가 404 | 의도된 격리 | 변환기 호스트로 접속 |
| `502 Bad Gateway` | Node 서비스 다운 | `systemctl status sdynotes` |
| `apply.sh` 재실행해도 80 블록이 안 고쳐짐 | 보강 스크립트가 **파일 수준** `grep` 으로 "이미 있음" 판정 → 두 번째 `server{}` 는 영원히 스킵 | 2-4 를 수동 적용 |
