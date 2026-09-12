# notesis — 발매판 (플레이스토어용)

원본 사이트(SDYnotes)를 **그대로 두고**, 스토어에 올릴 수 있는 형태로 조립하는 패키지.
코드는 이 폴더 안에서만 만지고, 결과물은 `build/` 에만 생긴다.

```
play/playstore/
├─ features.mjs          앱 이름·설명·타깃·패키지 id 를 정하는 한 곳
├─ plans.mjs             요금제(무료·3,000원·월 4,900원)와 가져오기 정책의 한 곳
├─ app/                  발매판이 새로 더하는 코드 (원본 아님)
│   ├─ music-store.js      기기(IndexedDB) 음악 저장소 — 페이지와 서비스워커가 같이 씀
│   ├─ doc-store.js        기기(IndexedDB) 논문 저장소 — 본문 조각·배경 이미지·목차
│   ├─ local-music.js      /api/music/* 를 가로채 서버 대신 기기로 답한다 (플레이어 무수정)
│   ├─ local-docs.js       /api/import/* 를 가로채 기기로 답한다 + 서버 사본 삭제 요청
│   ├─ sw.js               서비스워커 — 오프라인 + 음원·논문 그림을 기기에서 흘려보냄
│   ├─ pwa.js              설치·오프라인·저장공간 안내
│   ├─ pwa.css             그 안내용 스타일 (기존 CSS 와 충돌 없음)
│   ├─ account.js          계정 창에 '내 데이터' 칸 + 계정 삭제 (원본 UI 에 덧붙임)
│   └─ account.css         그 칸·삭제 확인 창 스타일
├─ legal/
│   ├─ privacy.html        개인정보처리방침 (/privacy)
│   └─ terms.html          이용약관 (/terms)
├─ twa/                   안드로이드 앱(TWA) 포장 — README.md 참고
│   └─ twa-manifest.example.json   bubblewrap 입력 형식(지문은 스크립트가 채움)
├─ server-play/index.mjs  배포용 얇은 서버 (의존성 0개 · 정적 + API 넘기기)
├─ scripts/
│   ├─ build.mjs           조립 (원본은 읽기만)
│   ├─ icons.mjs           로고 SVG 패스로 아이콘 6종 굽기 (librsvg 불필요)
│   ├─ store-art.mjs       스토어 피처 그래픽 1024×500 · 대표 이미지 1200×630
│   ├─ twa-prepare.mjs     지문 등록 → assetlinks.json + bubblewrap 명령 안내
│   ├─ verify.mjs          구조 검사 84항목 (+ 제출 전 자리표시자 경고)
│   ├─ test-account-delete.mjs  삭제가 서버 파일에서 정말 사라지게 하는가 (17항목)
│   ├─ test-account-ui.mjs      삭제가 화면에서 눌러서 되는가 (jsdom · 18항목)
│   ├─ test-import-ownership.mjs 논문 임자·용량·'기기로 옮기고 서버 삭제' (34항목)
│   ├─ test-all.mjs        위 5단계를 한 번에
│   └─ serve.mjs           미리 보기 서버
├─ docs/listing.md        스토어 등록 문구 (그대로 붙여 넣기용)
└─ build/                 ⚙ 결과물 (git 에 안 올림)
```

## 쓰는 법

```bash
node scripts/test-all.mjs         # 조립 + 검사 5단계 (권장)
node scripts/build.mjs            # 조립만
node scripts/verify.mjs           # 구조 검사 84항목
node scripts/twa-prepare.mjs --print   # TWA 준비 상태 보기
PORT=5173 node scripts/serve.mjs  # 미리 보기
```

검사는 다섯 단계다. ① 조립 ② 구조(앱 셸·아이콘·이름표·심사 요건·원본 불변·논문 로컬화)
③ **계정 삭제가 서버 파일에서 정말 사라지게 하는가**(임시 폴더에서 실제로 돌림)
④ **삭제가 화면에서 눌러서 끝까지 되는가**(jsdom)
⑤ **논문이 임자·용량과 함께 '기기로 옮기고 서버에서 지워지는가'**. ③④는 실제로
버그를 잡았다 — 세션 저장을 기다리지 않던 것, 1:1 대화 파일의 필드명을 잘못 본 것.
⑤는 '크기가 안 맞는데 지워 버리는' 사고를 막는 검사다.

## 논문은 서버에 남지 않는다 (요금제의 근거)

원래 서버는 가져온 논문을 **영구 보관**했다(`common.py` 주석 참고). 그러면 구독자에게
'무제한'을 팔 수 없다 — 스캔 논문 한 편이 16MB라 디스크가 그대로 늘어난다.
그래서 구조를 바꿨다:

```
① 기기가 논문을 올린다   →  ② 서버가 변환한다(CPU만)   →  ③ 기기가 통째로 내려받는다
                                                        →  ④ 기기가 다 받았다고 알리면
                                                           서버는 그 논문을 지운다
```

| 파일 | 역할 |
|---|---|
| `server/src/routes/importBundle.js` | ③ 내보내기 스트리밍 · ④ 삭제(`POST /api/import/release/:jid`) |
| `app/doc-store.js` | ③ 받아서 IndexedDB 에 넣기 |
| `app/local-docs.js` | 이후 `/api/import/*` 를 기기로 답하기 + ④ 요청 |
| `app/sw.js` | 배경 이미지도 기기에서 서빙(안 그러면 서버를 지운 뒤 그림이 깨진다) |

**크기가 안 맞으면 지우지 않는다**(`size_mismatch` 409). 반쯤 받은 상태에서 지우면
논문이 영영 사라지기 때문이다. 다른 기기에서 열면 기기에도 서버에도 없으므로
`local_missing` 으로 분명히 알려 준다(빈 화면 금지).

기존 백엔드(AI·논문 챗·동기화)까지 붙여 보려면:

```bash
PORT=5173 SDY_UPSTREAM=http://127.0.0.1:5000 node scripts/serve.mjs
```

## 무엇이 기기에서 돌고, 무엇이 서버로 가는가

발매판의 원칙: **돈이 드는 것만 서버로, 나머지는 기기에서.**

| | 어디서 | 근거 |
|---|---|---|
| 노트·필기·수식·표 | 기기 | 서버비 0원. 연구자에게 "안 나간다"는 약속이 곧 기능 |
| PDF 가져오기·쪽 보기 | 기기 | 가져온 문서는 기기에 |
| **음악 파일 보관·재생** | **기기(IndexedDB)** | 원본은 서버에 음원을 두지만 발매판은 기기에만. 재생·태그 편집도 로컬 |
| 곡 정보(태그)·가사 찾기 | 서버 | 외부 API(Apple·Deezer·MusicBrainz·AcoustID)·ffmpeg 필요 |
| AI 요약·번역·질문 | 서버 | 모델 키를 프런트에 둘 수 없다 |
| 논문 챗·공동편집·친구 | 서버 | 원래 서버 기능 |
| 앱 화면(셸) | 캐시 | 서비스워커가 미리 받아 둠 → 오프라인에서 열림 |

### 음악을 로컬로 돌리는 방법 (원본 코드를 고치지 않는다)

`src/music-player.js`(5천 줄)는 곡을 전부 `/api/music/…` 로 다룬다.
발매판은 그 주소들을 `fetch` 가로채기로 가로채 **서버 대신 기기로 답한다**.
플레이어는 한 줄도 고치지 않았으므로, 원본이 업데이트돼도 어긋나지 않는다.

- 목록·올리기·재생·삭제·태그 저장·표지·초기화·음량·재생기록 → 기기(IndexedDB)
- 정보 찾기·가사·싱크가사·소리 인식 → 서버
- `<audio src="/api/music/file/…">` 는 fetch 를 타지 않으므로 **서비스워커**가
  IndexedDB 에서 꺼내 Range 응답으로 흘려보낸다 (탐색·시크 정상 동작)

### 이름표

앱 이름은 `features.mjs` 의 한 곳에서 정한다. 조립할 때 복사본에서
`SDYnotes` → `notesis` 로 바꾼다. 원본의 `SDYnotes` 는 11곳뿐이고 **전부 표시용
문자열**이라(저장 키는 `sdy3`, 파일 이름은 `sdynotes.js` — 건드리지 않음) 안전하다.
개발자 기기에 남은 옛 제목 설정은 '없음'으로 취급해 새 이름이 나오게 했다.

## 스토어 심사 요건 (갖춰진 것)

| 요건 | 상태 | 어디에 |
|---|---|---|
| 개인정보처리방침 URL | ✅ `/privacy` | `legal/privacy.html` |
| 이용약관 URL | ✅ `/terms` | `legal/terms.html` |
| 앱 내 계정 삭제 | ✅ 계정 화면 → 계정 삭제 | `app/account.js` · `POST /api/auth/account/delete` |
| 삭제 시 개인정보 파기 | ✅ 회원·세션·친구·대화 | `userauth.js` · `friends.js` · `dmstore.js` |
| AI 데이터 전송 고지 | ✅ 방침 1-다 · 약관 제5조 | `legal/*` |
| 오프라인 동작(4.2 대응) | ✅ 서비스워커 앱 셸 | `app/sw.js` |
| 저작권 위험 기능 제외 | ✅ 음악 업로드·유튜브·DM 은 발매판에서 로컬/제외 | `app/local-music.js` |

**제출 전 남은 일:** `legal/*.html` 의 `[운영자명]` · `[연락처 이메일]` · `[시행일]` 을
실제 값으로 채우세요. `verify.mjs` 가 자리표시자가 남아 있으면 경고로 알려 줍니다.

## 원본을 건드리지 않는다는 보장

`verify.mjs` 7번 항목이 `git status` 로 확인한다:
**화면 파일(`sdynotes.html`·`sdynotes.css`·`sdynotes.js`·`src/*`)은 하나도 수정되지 않았다.**
(서버 쪽 변경 — 계정 삭제 API 추가 — 은 의도된 기능이라 알림으로만 표시한다.)
