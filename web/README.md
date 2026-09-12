# web/ — 웹 발매판 (컴퓨터)

논문은 컴퓨터로 읽는 시간이 길다. 이 폴더는 **컴퓨터 브라우저로 내보내는 것**만 담는다.
패드에서 펜으로 필기하는 껍데기(안드로이드 앱)는 `play/playstore/` 가 만든다.

## 원칙

- 원본 코드(`sdynotes.html`·`sdynotes.js`·`sdynotes.css`, `src/`, `server/`, `worker/`)는
  **읽기만** 한다. 고칠 것은 이 폴더에 두고, 원본을 복사해 오지 않는다.
- 발매판 조립은 `play/playstore/scripts/build.mjs` 하나로 유지한다(웹도 같은 조립물을 쓴다).
  웹만의 파일을 새로 만들면 두 벌이 되어 언젠가 서로 달라진다.
- 도메인·패키지 이름은 `site.mjs`(루트) 한 곳에서 온다.

## 지금 있는 것

| 파일 | 무엇 |
|---|---|
| `README.md` | 이 문서 — 폴더의 역할 |
| `docs/web_launch.md` | 웹 발매 준비 목록 + **도메인 이전 절차**(duckdns → notesis.com) |

## 들어올 것 (예정)

| 무엇 | 자리(예정) | 비고 |
|---|---|---|
| 웹 결제 | `web/billing/` | 스토어 결제와 함께 쓰는 길. 서버는 `userSetPlan()` 하나로 붙는다 |
| 랜딩·가격 페이지 | `web/pages/` | 검색 유입용. 앱 안 화면과 문구를 맞춘다 |
| OG 이미지·파비콘 | `web/public/` | 스토어 이미지는 `play/playstore/scripts/store-art.mjs` 재사용 |
| 사이트맵·robots·캐노니컬 | `web/public/` | 도메인은 `site.mjs` |
| 배포 설정 | `web/deploy/` | nginx 는 지금 `apply.sh` 안에 있다(`server_name _` — 주소가 바뀌어도 그대로) |

## 하지 않는 것

- 스토어 심사용 포장(서명·AAB·IPA) — 그건 `play/` 와 `appstore/` 몫이다.
- 기기 안에만 두는 저장 정책 바꾸기 — 저장 위치는 요금제가 정한다(`server/src/lib/plans.js`).
