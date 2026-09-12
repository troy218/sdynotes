# notesis — 발매판 (플레이스토어용)

원본 사이트(SDYnotes)를 **그대로 두고**, 스토어에 올릴 수 있는 형태로 조립하는 패키지.
코드는 이 폴더 안에서만 만지고, 결과물은 `build/` 에만 생긴다.

```
play/playstore/
├─ features.mjs          앱 이름·설명·타깃·패키지 id 를 정하는 한 곳
├─ app/                  발매판이 새로 더하는 코드 (원본 아님)
│   ├─ music-store.js      기기(IndexedDB) 음악 저장소 — 페이지와 서비스워커가 같이 씀
│   ├─ local-music.js      /api/music/* 를 가로채 서버 대신 기기로 답한다 (플레이어 무수정)
│   ├─ sw.js               서비스워커 — 오프라인 + 음원을 기기에서 흘려보냄
│   ├─ pwa.js              설치·오프라인·저장공간 안내
│   └─ pwa.css             그 안내용 스타일 (기존 CSS 와 충돌 없음)
├─ server-play/index.mjs  배포용 얇은 서버 (의존성 0개 · 정적 + API 넘기기)
├─ scripts/
│   ├─ build.mjs           조립 (원본은 읽기만)
│   ├─ icons.mjs           로고 SVG 패스로 아이콘 6종 굽기 (librsvg 불필요)
│   ├─ verify.mjs          결과 검사 57항목
│   └─ serve.mjs           미리 보기 서버
├─ docs/listing.md        스토어 등록 문구 (그대로 붙여 넣기용)
└─ build/                 ⚙ 결과물 (git 에 안 올림)
```

## 쓰는 법

```bash
node scripts/build.mjs            # 조립 → build/
node scripts/verify.mjs           # 검사 57항목
PORT=5173 node scripts/serve.mjs  # 미리 보기
```

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

## 원본을 건드리지 않는다는 보장

`verify.mjs` 7번 항목이 `git status` 로 확인한다:
**`play/` 밖의 파일은 하나도 수정되지 않았다.** 조립은 읽기만 한다.
