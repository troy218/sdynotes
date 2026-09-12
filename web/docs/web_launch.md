# 웹 발매 준비 — 컴퓨터에서 읽고 편집하는 쪽

> 웹이 먼저다. 논문을 읽는 시간은 대부분 컴퓨터 앞에서 흐르고, 패드는 그 위에
> 펜으로 쓰는 도구다. 그래서 **웹이 되는 것**이 플레이스토어 심사의 바탕도 된다
> (TWA 는 도메인에 있는 웹앱을 그대로 감싼다).

---

## 1. 지금 되는 것

| 되는 것 | 어디 |
|---|---|
| 사이트·앱 셸 서빙 | `server/` (Fastify) + `apply.sh` 배포 |
| PWA 설치(컴퓨터 크롬·엣지) | `play/playstore/scripts/build.mjs` 조립물의 `manifest.webmanifest`·`sw.js` |
| 논문 가져오기 → 읽기 | `/api/import/*` + `06b-read-layer.js` |
| 계정·계정 삭제 | `/api/auth/*` (심사 필수 요건) |
| 개인정보처리방침·약관 | `/privacy` · `/terms` |

## 2. 웹에서 아직 없는 것 (순서대로)

- [ ] **웹 결제** — 스토어 결제와 함께 쓰는 두 번째 길. 결제 페이지 → 서버
      `userSetPlan(uid, 'premium', { until, source: 'web', orderId })`.
      스토어 심사를 받는 앱 **안에서는** 웹 결제로 유도하지 않는다(애플 3.1.1).
      웹 결제는 브라우저에서 직접 구독하는 사람만 쓴다.
- [ ] **가격·랜딩 페이지** — 무료(기기 전용) / 프리미엄(월 14,900원 · 클라우드 200GB).
      문구는 `play/playstore/docs/listing.md` 와 같은 표를 쓴다.
- [ ] **큰 화면 손보기** — 논문 읽기·편집이 중심이 되도록(쪽 확대, 옆 패널, 키보드 단축키).
- [ ] **검색·공유 미리보기** — 캐노니컬, `og:` 태그, OG 이미지, `sitemap.xml`, `robots.txt`.
- [ ] **설치 유도** — 컴퓨터 PWA 설치 안내(주소창 설치 버튼이 없는 브라우저 포함).
- [ ] **로그·오류 수집** — 배포 후 첫 주에 무엇이 깨지는지 보이게.

## 3. 도메인 이전 — `sdynote.duckdns.org` → `notesis.com`

주소가 바뀌면 **설치된 앱·스토어 등록·assetlinks 가 전부 따라와야** 한다.
순서를 지키면 무중단이고, 하나라도 빠지면 "앱이 주소창과 함께 뜨는" 상태가 된다.

### 3-1. 옮기기 전 (옛 주소 살아 있는 동안)

- [ ] 도메인 구입 + DNS A 레코드를 서버 IP 로 (`www` 포함)
- [ ] `site.mjs` 의 `SITE.current` 를 `notesis.com` 으로 (한 줄)
- [ ] `npm run check:launch` — 폴더·이름·도메인 일관성
- [ ] TLS 인증서: `certbot --nginx -d notesis.com -d www.notesis.com`
      (nginx 는 `apply.sh` 안에서 `server_name _;` 라 설정 변경은 필요 없다)
- [ ] **옛 주소를 지우지 않는다** — `sdynote.duckdns.org` 는 계속 열려 있어야
      이미 설치된 앱과 스토어에 적힌 링크가 산다. 301 로 새 주소로 보낸다.

### 3-2. 앱 쪽 (스토어 심사 전에)

- [ ] `node play/playstore/scripts/twa-prepare.mjs` — 매니페스트 host·아이콘 URL 이
      새 도메인으로 다시 쓰인다(도메인은 `site.mjs` 에서 온다)
- [ ] 지문 재등록 → `https://notesis.com/.well-known/assetlinks.json` 확인
      (`server/src/routes/wellknown.js` 가 내보낸다)
- [ ] 갤럭시·플레이 등록 정보의 **지원 링크·개인정보처리방침 URL**을 새 주소로
      (구글플레이 콘솔 · 갤럭시 스토어 셀러 포털)
- [ ] 앱 안에서 새 주소로 접속하는지 확인 — TWA 는 `startUrl` 이 host 기준이다

### 3-3. 확인

```bash
curl -sI https://notesis.com/.well-known/assetlinks.json   # 200 + 지문
curl -sI https://sdynote.duckdns.org/.well-known/assetlinks.json  # 옛 주소도 200
curl -s  https://notesis.com/manifest.webmanifest | head    # start_url·icons
```

## 4. 배포

```bash
# VM 안에서
rm -rf /tmp/newsite && git clone --depth 1 -b main \
  "https://x-access-token:$GH_TOKEN@github.com/troy218/sdynotes" /tmp/newsite && \
  cd /tmp/newsite && sudo bash ./apply.sh
```

절차 전문은 루트 `DEPLOY.md`. 배포 뒤 확인할 것:

- [ ] `https://<도메인>/` 열림 · 로그인 · 논문 가져오기
- [ ] `/privacy` · `/terms` 200
- [ ] `/api/app/status` (TWA 버전 안내)
- [ ] `/.well-known/assetlinks.json` 에 서명 지문
