# src/app — 에디터 메가 모듈 (소스 오브 트루스)

브라우저는 여전히 **`sdynotes.js` 하나**를 로드한다.  
이 폴더의 파트들을 `scripts/bundle-frontend.mjs` 가 `MANIFEST.txt` 순으로 이어 붙인다.

독립 기능(`src/cards.js`, `src/music-player.js`, `src/chat.js` …)은 여기 넣지 않는다 — 그쪽은 `window.*` 브릿지 모듈.

## 왜 concat 인가

`let doc` · `curNB` · `toast()` 가 수천 곳에서 **같은 어휘 스코프**를 공유한다.  
ES module 로 쪼개면 import/window 로 전면 개편이 필요해서,  
**편집 단위만 도메인 파일로 나누고 실행 단위는 하나로 유지**한다.

## 워크플로 (이후 변경은 여기만)

```bash
# 1) 심볼이 어느 파일인지
node scripts/find-app-symbol.mjs openNB saveDoc
node scripts/find-app-symbol.mjs --grep 형광펜

# 2) 해당 src/app/*.js 만 수정

# 3) 번들 재생성
npm run bundle
# 또는: node scripts/bundle-frontend.mjs

# 4) CI 동기화 검사 (npm test 가 자동 실행)
npm run bundle:check
```

`sdynotes.js` 를 직접 고치면 `bundle:check` 가 실패한다.

## 파트 지도 (변경 위치를 고르는 기준)

| 건드리는 기능 | 파일 |
|---|---|
| 플로팅 창 경계·배율 | `00-boot.js` |
| DB 심 · 문서 모델 · toast | `01-core.js` |
| 홈 배경·로딩바·슬라이스 | `02a-home-shell.js` |
| 검색·이모지·노트 목록 | `02b-search.js` |
| 홈 스택·폴더 잠금 | `02c-home-stack.js` |
| 북마크·설정 LWW 동기화 | `02d-settings-sync.js` |
| 폴더·휴지통·멀티선택 | `02e-folders.js` |
| 버그 일지(설정·LWW 저장) | `02f-buglog.js` |
| 관리자 | `03a-admin.js` |
| 파일 보관함 | `03b-vault.js` |
| PDF/Word 가져오기 | `04a-import.js` |
| 노트 비밀번호 잠금 | `04b-note-lock.js` |
| 노트 열기/닫기·saveDoc | `05a-editor-open.js` |
| 서버 동기화·아웃박스 | `05b-sync-outbox.js` |
| 페이지 가상화 | `06a-page-virtual.js` |
| 읽기 우선(어크로뱃) 레이어 | `06b-read-layer.js` |
| 요소 다중선택·그룹·클립보드 | `06c-el-select-ops.js` |
| 요소 빌더(DOM) | `07a-el-builder.js` |
| 형광펜 띠 표시 | `07b-hl-band.js` |
| 문서 되돌리기 | `07c-undo.js` |
| 선택/드래그·셀 이동 | `08a-selection.js` |
| 표 | `08b-table.js` |
| 더보기 서랍·체크포인트 | `09-tools-ui.js` |
| 배치 모드·단축키·뒤로가기 | `10a-place-keys.js` |
| 펜/지우개 | `10b-pen.js` |
| 글자색·글꼴 툴바 | `11a-text-style.js` |
| 인라인 서식 엔진 | `11b-inline-fmt.js` |
| 캐럿 서식·종이 크기 | `11c-caret-paper.js` |
| 이미지 업로드 | `12a-image.js` |
| 내보내기·스티커 | `12b-export-sticker.js` |
| 해돌이 색/형광펜/@명령 | `12c`–`12e-ai-*.js` |
| 실시간 문서 동기화 | `13a-collab-sync.js` |
| 커서 공유 | `13b-cursors.js` |
| 우클릭 메뉴·삭제 | `14a-ctx-menu.js` |
| 부팅·Init | `14b-init.js` |

이미 분리된 UI 모듈:

| 기능 | 파일 |
|---|---|
| 암기 카드 | `src/cards.js` |
| 서버 계기판·알림 | `src/server-status.js` |
| 음악 | `src/music-player.js` |
| 채팅·인증·번역·AI 창 | `src/chat.js` 등 |

## 새 파트를 더 쪼갤 때

1. 경계 주석(`// ============ …`)을 기준으로 파일 분리  
2. `MANIFEST.txt` 순서에 끼워 넣기  
3. `npm run bundle && npm run bundle:check`  
4. 이 README 표 한 줄 추가  
