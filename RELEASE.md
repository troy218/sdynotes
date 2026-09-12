# 발매판 — 웹 · 플레이스토어 · 앱스토어

원본 사이트 코드(`sdynotes.*`, `src/`, `server/`, `worker/`)는 **읽기만** 한다.
발매판은 아래 세 폴더에서 따로 설정·조립한다. 세 폴더 모두 같은 서버(`server/`)와
같은 조립물을 쓰되, 발매처마다 다른 것(포장·문구·결제·심사 요건)만 그 폴더에 둔다.

| 폴더 | 발매처 | 지금 상태 | 이 폴더가 하는 일 |
|---|---|---|---|
| `web/` | **웹** — 컴퓨터 브라우저 | 뼈대 | 도메인·SEO/OG, 웹 결제, 랜딩, 배포. 논문을 읽고 편집하는 주 무대 |
| `play/playstore/` | **Google Play** — 안드로이드 | 조립·검사까지 완료 | PWA+TWA 조립, 스토어 문구·이미지, 계정 삭제·법적 문서 |
| `appstore/` | **App Store** — iOS·iPadOS | 뼈대 | 심사 요건, iOS 포장(WKWebView), 구독, 스크린샷 |

패드(안드로이드·아이패드)는 **필기용**, 컴퓨터는 **읽고 편집하는 곳**이다.
그래서 순서도 **웹 → 플레이 → 앱스토어**다.

---

## 도메인은 한 곳에서

`site.mjs` 가 유일한 출처다.

```js
current: 'sdynote.duckdns.org',   // 지금 쓰는 주소
next:    'notesis.com',           // 옮길 주소
```

이전할 때는 `SITE.current` **한 줄**만 바꾸고 `npm run check:launch` 로 확인한다.
(절차 전체: `web/docs/web_launch.md` §도메인 이전)

| 읽는 곳 | 무엇에 쓰나 |
|---|---|
| `play/playstore/scripts/twa-prepare.mjs` | TWA 매니페스트 host·아이콘·웹매니페스트 URL, assetlinks 안내 |
| `web/` | 캐노니컬·OG·사이트맵·스토어에 알린 주소 |
| `appstore/` | 스토어 등록 URL·개인정보처리방침 링크 |
| 배포 서버 | `SDY_SITE_DOMAIN` 으로 덮을 수 있다(코드 수정 없이 임시 주소) |

---

## 검사

```bash
npm run check:launch                       # 세 폴더·이름·도메인이 어긋나지 않는가
cd play/playstore && node scripts/test-all.mjs   # 발매판 조립 + 검사 6단계
```

`check:launch` 는 폴더 존재만 보지 않는다. 브랜드 이름(`features.mjs`)·패키지
이름·TWA 예시 매니페스트가 `site.mjs` 와 **같은 값**인지, 그리고 도메인 단일
출처가 실제로 코드에서 읽히는지까지 본다. 발매판마다 값을 따로 적어 두면
언젠가 한 곳만 고치게 되고, 그러면 "광고한 주소로는 안 열리는" 사고가 난다.
