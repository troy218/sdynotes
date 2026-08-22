# 오라클 AMD → ARM(Ampere A1) 마이그레이션 가이드

> SDYnotes 14.9.0 · AMD(x86_64) 인스턴스에서 ARM(aarch64, Ampere A1) 인스턴스로 옮기는 순서.
> 핵심 원칙: **코드는 새로 깔고, 데이터 폴더는 통째로 옮긴다.** x86 전용 바이너리는 새 서버에서 다시 설치한다.

---

## 0. 먼저 알아둘 것

- **부트 볼륨은 AMD → ARM으로 옮길 수 없다.** 오라클에서 shape(CPU 아키텍처)가 다른 인스턴스로는 볼륨 재부착이 안 되므로 **새 인스턴스를 만들어 데이터를 복사**하는 방식이다.
- 서버의 모든 데이터는 `/var/www/memo/` 아래에 모여 있다:

| 경로 | 내용 |
|---|---|
| `vault/` | 관리자 파일 보관함 (절대 삭제 금지) |
| `music/` | 음악 파일 + `_index.json` + `_acoustid.json` + `_yt_cookies.txt`(유튜브 쿠키) |
| `imported/`, `imported_docs/`, `import_uploads/`, `import_jobs/` | PDF/Word 가져오기 산출물·원본·임시·작업 상태 |
| `stickers/`, `cards/`, `wallpaper/`, `sync/` | 스티커·암기카드·배경화면·로컬 동기화 상태 |
| `.env` | **비밀키** (Supabase·Cloudinary·AcoustID·ADMIN_PW_HASH 등) |
| `.sdy_escrow.key` | **에스크로 마스터 키 — 잃으면 보관된 비밀번호 복구 불가** |
| `.admin_sessions.json`, `notifications.json`, `_yt_cookies.txt.bak` | 관리자 세션·알림·쿠키 백업 |

- **Supabase / Cloudinary 는 원격**이므로 그대로 유지된다. 클라우드 모드라면 노트·카드·음악 메타·스티커 메타는 자동으로 복구된다. 다만 **음악 파일, 가져온 PDF 이미지, 보관함, 배경화면은 디스크에만 있으므로 반드시 복사**해야 한다.
- 엽스코드(채팅·음성)는 14.9.0 에서 제거되었다. 기존 `.env` 의 `SDY_TURN_*`
  값과 coturn 설정은 남아 있어도 동작에 영향을 주지 않는다.

---

## 1. 오라클 콘솔 — 새 ARM 인스턴스 만들기

1. **Create instance**
2. **Shape**: Ampere — `VM.Standard.A1.Flex` (Always Free면 4 OCPU / 24GB 추천)
3. **Image**: Ubuntu 22.04 또는 24.04 (aarch64). 기존 서버와 같은 Ubuntu 계열이면 무난
4. **VCN/서브넷**: 기존 VCN을 그대로 선택. **보안 목록(security list)에 포트 80 + 443 둘 다 개방** (HTTPS 운영 중이므로)
5. **공인 IP (선택)**:
   - **권장**: Oracle의 **Reserved Public IP** 기능으로 기존 공인 IP를 예약 → 새 인스턴스에 재할당하면 **DNS 변경 없이 그대로** 사용 가능
   - 또는 새 임시 IP를 받고 DNS를 새 IP로 변경

---

## 2. 새 서버 준비

```bash
ssh ubuntu@새서버IP
sudo apt-get update -y
```

- 배포 유저는 기존과 동일하게(예: `ubuntu`). apply.sh가 알아서 Node·Python·nginx·systemd를 깐다.

---

## 3. 배포 파일 + 데이터 옮기기

### 3-1. 배포 파일 올리기 (로컬 → 새 서버)

```bash
# 로컬에서
scp sdynotes-X.zip ubuntu@새서버IP:~/
# 새 서버에서
ssh ubuntu@새서버IP
unzip sdynotes-X.zip -d ~/deploy
```

### 3-2. 데이터 rsync (새 서버에서, 구 서버에서 당겨오기)

```bash
sudo mkdir -p /var/www/memo

sudo rsync -av --progress \
  --exclude 'server' --exclude 'worker' --exclude 'sdynotes.html' \
  --exclude 'package.json' --exclude 'package-lock.json' \
  --exclude 'node_modules' --exclude 'venv' \
  --exclude 'server.bak' --exclude 'worker.bak' \
  --exclude 'SUPABASE_SCHEMA.sql' \
  ubuntu@구서버IP:/var/www/memo/ /var/www/memo/

sudo chown -R "$USER:$USER" /var/www/memo
```

> `node_modules`/`venv` 를 제외하는 이유: sharp 등 x86 네이티브 모듈이 들어 있어 ARM에서 실행 불가. apply.sh가 새로 설치한다.
> `.env` 와 `.sdy_escrow.key` 가 실제로 왔는지 꼭 확인:
> ```bash
> ls -la /var/www/memo/.env /var/www/memo/.sdy_escrow.key
> ls /var/www/memo/vault /var/www/memo/music | head
> ```

---

## 4. apply.sh 실행 (새 서버)

```bash
cd ~/deploy && bash apply.sh
```

ARM에서 자동으로 준비되는 것들:
- Node 20 (nodesource arm64), Python venv + 패키지(pymupdf·pillow-heif 등 aarch64 wheel)
- **deno — CPU 아키텍처 자동 감지**(`uname -m` → aarch64/x86_64). 이번에 apply.sh가 ARM 바이너리를 받도록 패치됨
- bgutil PO 토큰 공급기(deno 기반), fpcalc(소리인식), swap, nginx, systemd 서비스 2개

### 관리자 비밀번호를 바꿔 둔 경우
- `.env` 에 `ADMIN_PW_HASH=...` 가 있으면 rsync로 따라오므로 그대로 동작한다.
- 만약 systemd 유닛에 직접 `Environment=` 로 넣어뒀었다면 새 서버에는 자동으로 생기지 않으므로, apply.sh 실행 후 재등록 필요:
  ```bash
  sudo mkdir -p /etc/systemd/system/sdynotes.service.d
  printf '[Service]\nEnvironment="ADMIN_PW_HASH=...sha256해시..."\n' | sudo tee /etc/systemd/system/sdynotes.service.d/override.conf
  sudo systemctl daemon-reload && sudo systemctl restart sdynotes sdynotes-worker
  ```

---

## 4-1. HTTPS 재설정 (같은 도메인 · certbot)

> apply.sh는 **80 포트 블록만** 만든다. 443 서버 블록과 Let's Encrypt 인증서는
> 새 서버에서 다시 만들어야 한다. (구 서버와 Ubuntu 버전이 같으므로 절차 동일)

**준비**: 도메인이 새 서버 IP를 가리켜야 발급 검증이 된다 → **이 절차는 6번(전환) 직전/직후**에 한다.

```bash
# 1) 서버 블록에 도메인 지정 (apply.sh 기본값은 server_name _;)
sudo sed -i 's/server_name _;/server_name yourdomain.com;/' /etc/nginx/sites-available/memo
sudo nginx -t && sudo systemctl reload nginx

# 2) certbot 설치 + 발급 (http-01 검증: 80 포트는 apply.sh가 이미 열어 둠)
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
#   → 리다이렉트 질문에 "2: Redirect" 선택 (http→https 강제)

# 3) 자동 갱신 확인
sudo certbot renew --dry-run
```

**대안 (인증서 복사)**: 발급 횟수 제한을 아끼려면 구 서버에서 인증서를 복사해도 된다.
```bash
sudo rsync -av ubuntu@구서버IP:/etc/letsencrypt/ /etc/letsencrypt/
sudo ln -sf /etc/letsencrypt/live/yourdomain.com/fullchain.pem /etc/nginx/...  # 기존 443 설정 경로 그대로
```
> 커스텀 443 설정(특정 TLS 암호화 스위트 등)이 있다면 `/etc/nginx/sites-available/memo`(443 부분)와
> `/etc/letsencrypt` 를 함께 복사하는 편이 낫다. 특별한 설정이 없으면 **certbot 재발급이 가장 깔끔**하다.

---

## 5. 검증

```bash
curl -s http://127.0.0.1/api/health
curl -s http://127.0.0.1/api/admin/status                    # 200
curl -s http://127.0.0.1/api/cloud/status                    # supabase:true / cloudinary:true 확인
curl -s http://127.0.0.1/api/music/youtube/status            # ok:true
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://yourdomain.com/   # 200 (HTTPS)
systemctl status sdynotes sdynotes-worker
journalctl -u sdynotes-worker -n 50   # 에러 없나
```

브라우저에서 실제로:
- **https://yourdomain.com** 으로 접속 → 자물쇠 정상 확인
- 로그인 → 노트 열기(가져온 PDF 포함) → 음악 재생 → **유튜브 링크 추가** → 보관함 파일 개수 확인

---

## 6. 전환(컷오버)

**순서가 중요합니다 — 인증서 발급은 도메인이 새 서버를 가리킨 뒤에 실행합니다.**

1. **Reserved IP 쓴 경우**: 콘솔에서 구 인스턴스 공인 IP 예약 → 새 인스턴스에 재할당 (DNS 그대로 → 즉시 새 서버로 전환)
2. **새 IP 쓴 경우**: DNS A레코드를 새 IP로 변경 → 전파 확인
   ```bash
   host yourdomain.com          # 새 IP가 나오는지
   ```
3. 도메인이 새 서버를 가리키는 게 확인되면 → **4-1의 certbot 발급 실행** (`sudo certbot --nginx -d yourdomain.com`)
4. `https://yourdomain.com` 이 200·자물쇠 정상인지 확인

구 서버는 확인이 끝난 뒤에:
```bash
sudo systemctl stop sdynotes sdynotes-worker
```
그리고 오라클 콘솔에서 인스턴스 **Terminate**.

---

## 참고·주의

- **worker는 단일 프로세스**를 유지한다 (gunicorn 다중 worker 금지 — `music/_index.json` 덮어쓰기로 곡 유실 위험).
- bgutil의 `canvas` 의존성이 ARM에서 빌드 실패해도 **무해** — "(공급기 의존성 세팅 실패 — deno 만으로 시도)"만 나오고 유튜브 다운로드는 동작한다 (14.10 수정으로 PO 토큰 강제가 제거됨).
- 14.9.0 부터 엽스코드(채팅·음성 통화)를 제거해 coturn/TURN 포트
  (UDP·TCP `3478`, UDP `49160-49200`)는 더 이상 열 필요가 없다. `apply.sh` 가
  구버전이 설치한 coturn 을 중지·비활성화한다. Oracle 인그레스 규칙은 콘솔에서 닫는다.
- 비밀키(`SUPABASE_SERVICE_KEY` 등)는 zip·로그·프런트에 노출 금지 (기존 운영 규칙 그대로).
- **구 서버와 Ubuntu 버전이 같으므로** certbot·nginx 설정 문법은 동일. 다만 ARM용 패키지 저장소에서 다시 설치된다는 점만 다르다.
- nginx `default` 사이트는 apply.sh가 삭제하므로, 기존에 기본 사이트에 걸린 443 설정은 새 서버에서 다시 만들어야 한다 (4-1 참조).
