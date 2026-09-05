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

## 여는 속도 (14.29.4) — 가상화 다음에 남아 있던 비용

쪽 가상화로 "그리는 일"은 창 크기로 고정됐는데, **열기 자체가 여전히 느렸다.**
그리기와 무관하게 *전체 문서를 훑는* 일이 열기 경로에 남아 있었기 때문이다.
느린 기기일수록 이 부분이 그대로 체감 지연이 된다. 아래 여섯 군데를 걷어냈다.

| 무엇이 느렸나 | 어떻게 바꿨나 |
|---|---|
| `getCfg()` 가 부를 때마다 수 MB `nb_*` JSON 을 다시 파싱 (열 때만 6~8회) | 저장된 **원문 문자열이 같으면** 파싱 결과 재사용(한 칸 캐시). 반환은 항상 얕은 복사본 |
| `openNB()` 가 **전 쪽**의 표 × 요소를 훑어 격자선 생성 | `ensureTableGrid(pi)` — 그 쪽을 처음 그릴 때 한 번만 |
| `_normalizePaletteHtml()` 이 글상자마다 DOM 파싱 | 색 지정이 든 html 만 파싱(`_PAL_RE`), 나머지는 그대로 반환 |
| 슬라이스 요청이 `no-store` — 늘 본문을 통째로 다시 받음 | `no-cache`(항상 재검증) + 서버 **ETag** → 안 바뀌었으면 **304 · 본문 0바이트** |
| 워커가 같은 `.s{n}.gz` 를 열 때마다 디스크에서 읽음 | ETag 를 키로 한 메모리 LRU 캐시(`SDY_SLICE_CACHE_MAX`, 기본 512) |
| 여는 즉시 나머지 슬라이스를 4갈래로 내려받아 첫 페인트와 경쟁 | `requestIdleCallback` 으로 **첫 화면이 그려진 뒤** 시작 (받는 양은 동일) |

### 안전 규칙

- **데이터·화면 결과는 바뀌지 않는다.** 전부 "같은 결과를 더 적은 일로"다.
- 설정 캐시는 *원문 문자열*을 비교하므로 저장·다른 탭의 변경도 놓치지 않는다.
  `setCfg()` 는 저장하며 캐시를 버리고, `migrate()` 는 캐시된 배열을 `slice()`
  해서 넘긴다 — 편집이 "디스크에 저장된 값"의 캐시를 오염시킬 수 없다.
- ETag 는 `(수정시각ns, 크기)` 라 **저장(POST) 하면 반드시 달라진다.** 워커 메모리
  캐시도 ETag 를 키에 넣으므로 오래된 본문이 나갈 길이 없다. 저장 경로는 무수정.
- 프록시(`workerProxy.js`)는 `if-none-match` 를 워커로, `etag` 를 브라우저로
  전달하고 304 에는 본문을 붙이지 않는다.

```bash
npm run test:openfast   # test/note_open_fast_contract.mjs · 33개
```

가짜 워커를 세워 프록시가 실제로 200+ETag → 304(본문 0바이트) 를 내는지,
설정 캐시가 저장·외부 변경을 놓치지 않는지까지 실행으로 확인한다.

## 스크롤이 버벅이던 진짜 이유 (14.30.1) — '그리는 양'이 아니라 '훑는 횟수'

쪽 가상화로 DOM 에 올리는 종이 수는 이미 작았는데도 **그림이 많은 논문은
스크롤이 초 단위로 멎었다.** 프로파일(jsdom + `--cpu-prof`)을 떠 보니 원인은
그리는 비용이 아니라, **문서 전체를 훑는 선택자 질의가 스크롤·렌더 경로에서
반복**되는 것이었다. 쪽 수가 아니라 *쪽 안의 요소 수*에 비례해 터지는 비용이라
가상화로는 잡히지 않았다 — 논문은 글상자마다 단어 span 이 수십 개다.

측정(40쪽 × 쪽당 37요소·476 span, jsdom):

| | 고치기 전 | 고친 뒤 |
|---|---|---|
| 스크롤 프레임 p95 | **5,913ms** | **169ms** |
| 최악 프레임 | **35,319ms** | **307ms** |

| 무엇이 느렸나 | 어떻게 바꿨나 |
|---|---|
| `liftLayers()` 가 `#pagesStage .paper` **전부** × 종이 subtree 하위선택자 3개. 게다가 MutationObserver 가 `#pagesStage` 아래 **모든** class 변경마다(빈 상자 `empty`·가져온 상자 `tight`·형광펜 띠·현재 쪽 `focused` …) 이걸 불러, 쪽 하나 그리는 동안 수백 번 전수 조사가 겹쳤다 — **스크롤 시간의 90%** | ① 올라와 있는 종이(`mountedShells`)만 ② 레이어의 **직계 자식**만 확인(`.tb`/`.paper-img`/`.stroke-g` 는 언제나 직계 자식이라 판정 결과 동일) ③ 관찰자는 선택 관련 변경만 골라 **그 종이만**, 프레임당 한 번(rAF) |
| `findElLoc()` 이 id 조회마다 문서 전체(쪽×요소) 선형 탐색. 동기화 op 하나당 여러 번 불려 배경 동기화가 스크롤을 멈춰 세웠다 | id → `{i,k}` 캐시. **돌려주기 전에 그 자리에 그 id 가 정말 있는지 검증**하고, 어긋나면 전체를 훑어 다시 캐시 → 요소를 옮기고 지우는 수많은 경로를 건드리지 않아도 항상 정확 |
| `document.querySelector('#pagesStage .tb.edit[data-id=…]')` — 편집 상자는 최대 하나인데 원격 op·실시간 표시 타이머마다 subtree 전체를 훑었다 | `_activeEditBox()` 한 칸 캐시. `edit` 가 붙고 떨어지는 순간(관찰자 + 동기 경로)에만 무효화 |
| `decodeTextMarkup()` 이 `data-*` 서식이 하나도 없는 html 까지 DOM 파싱 | 표식 정규식(`_DEC_RE`)에 걸릴 때만 파싱. 없으면 원문 그대로 반환(결과 동일) |
| `paintTblCellSelection()` 이 칸을 하나도 안 골랐을 때도 `#pagesStage` 전체에서 `.tbl-cell-sel` 을 찾았다 | 칠해 둔 칸을 배열로 기억해 그것만 되돌린다 |

### 안전 규칙

- **화면 결과와 문서 데이터는 그대로다.** 전부 "같은 결과를 더 적은 일로"다.
- 캐시는 전부 **자기 검증형**이다. `findElLoc` 은 반환 전에 그 자리를 확인하고,
  편집 상자 캐시는 `isConnected` + `edit` 클래스를 다시 본다. 그래서 캐시를
  무효화할 곳을 빠뜨려도 틀린 답이 나갈 수 없다.
- `MutationObserver` 는 마이크로태스크라 같은 실행 흐름 안에서는 아직 오지
  않는다 → `edit` 를 켜고 끄는 동기 경로에서도 캐시를 즉시 갱신한다.

```bash
npm run test:heavy   # test/heavy_doc_scroll_runtime.mjs · 20개
```

실제 서버 + jsdom 으로 '배경 래스터 + 그림 + 단어 span 글상자'가 든 논문형
문서를 열고, 사람이 굴리듯 프레임 단위로 스크롤하며 **프레임 시간**을 잰다.
소스 계약(전수 조사 패턴이 되살아났는지)과 런타임 예산(p95 < 1.5초)을 함께
확인하므로, 위 다섯 군데 중 하나라도 예전 방식으로 돌아가면 여기서 걸린다.
(고치기 전 코드로 이 테스트를 돌리면 p95 2,694ms 로 실패한다 — 검증 완료)
