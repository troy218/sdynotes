# src/app — sdynotes.js 메가 모듈

이 폴더의 `00`–`14` 파일이 **소스 오브 트루스**다.
`scripts/bundle-frontend.mjs` 가 `MANIFEST.txt` 순서대로 이어 붙여 루트 `sdynotes.js` 를 만든다.

## 왜 이어 붙이나

메인 에디터는 `let doc` · `curNB` · `toast()` 같은 **같은 어휘 스코프** 심볼을
수천 곳에서 공유한다. 파일을 ES module 로 쪼개면 import/window 로 전부 바꿔야 해서
회귀 비용이 크다. 대신:

- **편집 단위**는 도메인별 파일 (`02-home.js`, `06-pages.js` …)
- **브라우저 로드**는 예전과 같이 `sdynotes.js` 하나 (HTML 변경 없음)
- `src/cards.js` · `src/music-player.js` 처럼 **이미 window 브릿지로 독립된 기능**은 여기 넣지 않는다

## 워크플로

```bash
# 파트 수정 후
node scripts/bundle-frontend.mjs

# CI / 배포 전 동기화 검사
node scripts/bundle-frontend.mjs --check
```

`sdynotes.js` 를 직접 고치면 `--check` 가 실패한다. 파트만 고치고 번들하라.

## 파트 지도

| 파일 | 역할 |
|------|------|
| 00-boot | 글꼴 지연로드, FLOAT-BOUNDS, 음악 칩 |
| 01-core | sandbox, SDB, 문서 모델, 팔레트, toast/esc |
| 02-home | 홈·설정동기화·검색·폴더·휴지통 |
| 03-admin | 관리자·파일 보관함 |
| 04-import-lock | PDF/Word 가져오기·노트 잠금 |
| 05-editor-shell | 열기/닫기·저장·동기화·아웃박스 |
| 06-pages | 페이지 렌더·가상화·읽기 우선 |
| 07-elements | 요소 빌더·형광펜 레이어·undo |
| 08-selection-table | 선택/드래그·표·셀 편집 |
| 09-tools-ui | 더보기 서랍·체크포인트 등 |
| 10-input-pen | 배치 모드·단축키·펜/지우개 |
| 11-text-format | 글자 서식·인라인 포맷 |
| 12-media | 이미지·내보내기·스티커·해돌이 브릿지 |
| 13-collab | 실시간 동기화·커서 |
| 14-menus-init | 우클릭 메뉴·Init·목록 동기화 |
