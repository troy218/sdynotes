# 대용량 노트(500쪽+) 페이지 열람 설계 — '셸 가상화'

`sdynotes.js` 의 에디터 본문(`#pagesStage`) 렌더 구조 설명서. 14.29.0 에서 다시 설계했다.

## 문제

예전 `renderPages()` 는 노트를 열 때 **문서의 모든 쪽**에 대해

- `.page-wrap` + `.page-label` + `.page-del` + `.paper` + 레이어 6개 (쪽당 약 10 노드)
- `pageObserver.observe(paper)` / `pageUnloader.observe(paper)` (쪽당 2회)

를 만들었다. 500쪽이면 노드 5천 개 + 관찰 1000회 + 종이 500장 레이아웃이라
**여는 순간 화면이 멎었다.** 요소(글상자·그림)만 가상화하고 종이는 전부 만들었기
때문에, 쪽수가 늘면 비용이 그대로 선형으로 늘었다.

부수 문제도 있었다.

- `IntersectionObserver` 는 transform 조상(에디터 슬라이드인) 아래나 먼 쪽으로 점프할 때
  콜백을 놓쳐 **빈 종이**가 남는 회귀가 반복됐다.
- 현재 쪽 표시·표 다시 그리기·핀·찾기·단어 분석이 전부 `doc.pages` 전체를 훑었다.
- `layoutPages()` 는 매 확대/축소마다 500개 `.page-wrap` 을 배열 순서로 재배치했다.

## 지금 구조 — 창(window) 두 개

```
#pagesStage  (높이 = 전체 쪽수 × (종이 높이 + 간격) × 배율)   ← 스크롤 길이는 항상 정확
│
├── .page-wrap[data-page-idx=118]   ┐
├── .page-wrap[data-page-idx=119]   │ 셸 창 = 화면에 걸치는 쪽 ± SHELL_PAD(2)
├── .page-wrap[data-page-idx=120]   │        (상한 SHELL_MAX=24)
├── .page-wrap[data-page-idx=121]   │
├── .page-wrap[data-page-idx=122]   ┘
└── #addPageZone                              ← 맨 끝에 항상 하나
```

- **셸 창(종이)**: `syncPageShells()` 가 `scrollTop`/`clientHeight` 로 보이는 범위를
  *계산*해 그 범위 ±`SHELL_PAD` 만 `ensurePageShell()` 로 올리고, 나머지는
  `unmountPageShell()` 로 내린다. 스크롤 프레임마다 불러도 되는 싼 연산이다.
- **요소 창(내용)**: `maintainPageWindow(center, immediate)` 가 현재 쪽
  ±`VIRTUAL_RENDER_RADIUS(1)` 만 `renderPageEls()` 로 그리고,
  ±`VIRTUAL_KEEP_RADIUS(2)` 밖은 `unloadPage()` 로 레이어를 비운다.

종이는 `position:absolute` + `top = i*(h+gap)*scale` 로 놓는다. **자리를 계산으로
정하므로 앞쪽 종이가 DOM 에 없어도 위치가 밀리지 않는다** — 스페이서가 필요 없고,
5쪽이든 5000쪽이든 DOM 비용이 같다.

### 스크롤 중 프레임 예산

```
scroll ─rAF─▶ onEditorScroll()
                ├─ mostVisiblePageIndex()   현재 쪽 판정(노출 면적 비교)
                ├─ syncPageShells()         종이만: 매 프레임, 값싸게
                └─ maintainPageWindow(idx,false)
                     ├─ immediate            → 바로 채움 (점프·복원·강제 페인트)
                     ├─ 마지막 채움 후 FILL_MAX_GAP(220ms) 경과 → 바로 한 번 채움
                     └─ 그 외                → FILL_IDLE(90ms) 디바운스 후 채움
```

디바운스만 걸면 계속 스크롤하는 동안 백지가 되고, 매 프레임 그리면 그게 곧 렉이다.
둘을 섞어 **관성 스크롤 중에도 최소 220ms 마다 한 번은 내용이 채워진다.**

## 불변 조건 (다른 기능을 건드리지 않기 위한 규칙)

1. **문서 데이터는 절대 건드리지 않는다.** `unmountPageShell()` / `unloadPage()` /
   `clearPageEls()` 어디에도 `doc.pages` 가 나오면 안 된다. 화면에서 내려간 쪽도
   데이터는 100% 남고, 저장·동기화·AI 스냅샷·내보내기(PDF/발표)는 전 쪽 데이터를 쓴다.
2. **작업 중인 쪽은 내리지 않는다.** `canUnloadPage()` 가 현재 쪽,
   `.tb.edit/.sel/.msel`(편집·선택), 활성 표(`activeTbl`), 그리는 중(`drawing`)을 막는다.
3. **창 밖의 쪽은 `paperAt()` 이 `null`** 이다. 호출부는 `paperQ(i, sel)` 로 방어한다
   (`paperAt(i).querySelector(...)` 처럼 바로 체이닝하면 안 된다 — 계약 테스트가 막는다).
4. **쪽 번호로만 찾는다.** `document.querySelectorAll('.page-wrap')[i]` 같은 배열
   순서 접근은 금지. 올라와 있는 종이는 `mountedShells: Map<pageIdx, wrap>` 이 관리하고,
   이동은 `scrollPageIntoView(pi, behavior)` 하나로 통일했다.
5. **새로 올라온 종이는 현재 모드를 물려받는다.** `buildPageShell()` 이 현재 쪽 강조
   (`focused` / `aria-current`), 종이 무늬(`paper-*`), 펜 모드(`drawing`)를 붙인다.
6. **화면 상태는 다시 그릴 때 복원된다.** 찾기 하이라이트(`paintFindHits`)와 단어 분석
   색칠(`wfPaintPage`)은 `renderPageEls()` 의 `finish()` 에서 그 쪽만 다시 칠한다.
   그래서 찾기·단어분석 중이라고 500쪽을 통째로 붙잡을 필요가 없다.

## 함께 지운 것 / 줄인 것

| 예전 | 지금 |
|---|---|
| `pageObserver` / `pageUnloader` (IntersectionObserver 2개) | 삭제 — 보이는 범위를 `scrollTop` 으로 계산 |
| `renderPages()` 가 전 쪽 셸 생성 | 스테이지 높이만 잡고 `syncPageShells()` |
| `layoutPages()` 가 `.page-wrap` 전부 재배치 | `mountedShells` 만, 자리는 쪽 번호로 계산 |
| `updatePageInfo()` 가 전 종이 순회(배열 인덱스) | 올라온 종이만, 쪽 번호로 판정 |
| `renderAllTblDivs` / `renderAllPins` 가 전 쪽 순회 | `renderedPages` / `mountedShells` 만 |
| `wfPaint` 가 전 쪽 순회 | 올라온 쪽만 + 되돌아온 쪽은 렌더 때 복원 |
| `paperAt()` 이 쪽마다 `querySelector` | `mountedShells.get()` (O(1)) |
| `sanitizePageEls()` O(n²) 를 렌더할 때마다 | `WeakSet` 으로 배열마다 한 번만 |
| `elPlainText()` 가 매번 HTML 파싱 | `WeakMap` 캐시(html 이 바뀌면 자동 무효) |

## 조절 손잡이

| 상수 | 기본 | 뜻 |
|---|---|---|
| `SHELL_PAD` | 2 | 화면 위아래로 더 올려 둘 종이 수 |
| `SHELL_MAX` | 24 | 동시에 올려 둘 종이 상한(극단 축소·먼 점프 방어) |
| `VIRTUAL_RENDER_RADIUS` | 1 | 현재 쪽 ±n 쪽까지 요소를 미리 그림 |
| `VIRTUAL_KEEP_RADIUS` | 2 | 현재 쪽 ±n 밖의 요소 DOM 회수 |
| `FILL_IDLE` | 90ms | 스크롤이 멎고 내용을 채우기까지 |
| `FILL_MAX_GAP` | 220ms | 스크롤이 이어져도 이 간격마다 한 번은 채움 |
| `HEAVY_ELS` / `CHUNK` | 120 / 60 | 요소가 많은 쪽은 나눠 그림 |
| `LAZY_SLICE` | 8 | 가져온(서버 보관) 문서의 쪽 데이터 슬라이스 크기 |

## 검증

```bash
npm run test:virtual
#  · test/page_virtualization_contract.mjs  구조 계약 37개
#  · test/empty_note_render_contract.mjs    빈 노트 회귀 19개
#  · test/large_doc_runtime.mjs             520쪽 실제 열람 런타임 29개
```

`large_doc_runtime.mjs` 는 실제 서버 + jsdom 으로 520쪽 노트를 열어

- 열린 뒤 `.page-wrap` 이 30개 이하인가(문서는 520쪽 그대로인가)
- 스테이지 높이가 전체 쪽수 기준인가(스크롤 막대가 짧아지지 않는가)
- 400쪽·520쪽 점프 → 그 쪽 종이·글상자가 뜨고 먼 쪽은 내려가는가
- 뷰포트를 흉내 낸 스크롤(120쪽)에서 창이 따라오고 멎으면 채워지는가
- 되돌아온 쪽이 되살아나는가 / 확대·쪽 추가 후에도 종이 수가 작은가
- 치명적 런타임 오류가 없는가

를 확인한다. 참고로 같은 테스트를 예전 코드로 돌리면 `page-wrap 520개`가 나온다.
