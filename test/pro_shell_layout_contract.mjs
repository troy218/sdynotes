/* 14.61 · 프로 셸 레이아웃 + 홈 배경 버츄얼라이저 계약
   14.62 · 사용자 보고 일곱 가지 계약 추가 (테마 문구·토글·엽스코드 이동·로고
   치우침·제목 Enter·해돌이 말풍선/질문칸·상단바 통합·체크상자 배치)
   ---------------------------------------------------------------------------
   사용자 보고 4가지를 잠그는 정적 계약이다 (실측 레이아웃은 브라우저 몫 —
   jsdom 은 계단식 레이아웃을 계산하지 못 하므로 규칙의 존재·우선순위를 검증):

   1) 사이드바가 첫 노트를 가리지 않게 — #mainView 은 static 이라 left 가 무효였다.
      데스크톱(≥1024)은 margin-left:280px, 접음(60px), 레일(641~1023) margin 규칙이
      반드시 있어야 하고, 248px 흔적이 남으면 실패.
   2) 사이드바 폭 확대(248→280) + 관리자 아이콘이 도구 행 오버플로에 잘리지 않게 —
      도구 행 wrap + 검색 입력이 아래 줄 통짜(flex-basis 100%).
   3) 앱 타이틀 'SDYnotes' — <title>·스플래시·브랜드 h1·JS 폴백이 전부 SDYnotes.
   4) 홈 배경 버츄얼라이저 — 28개 이산 막대가 아니라 연속 곡선(96칼럼+스무딩),
      화면 가장 바닥(baseY=h)에서 시작, 시간이 흐르며 이동하는 그라데이션.
   실행: npm run test:proshell */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAllJS } from './_frontend.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const html = fs.readFileSync(REPO + 'sdynotes.html', 'utf8');
const css = fs.readFileSync(REPO + 'sdynotes.css', 'utf8');
const js = readAllJS();

const check = (name, cond) => { assert.ok(cond, name); console.log('  ✓ ' + name); };

/* ── 1) 사이드바가 첫 노트를 가리지 않게 ─────────────────────────────────── */
// 데스크톱: #mainView 밀기는 margin-left 로 (left 는 static 에 무효 — 옛 버그)
check('CSS: 데스크톱 #mainView margin-left:280px (사이드바 폭과 동일)',
  /@media \(min-width:1024px\)\{[^@]*?html\.theme-pro #mainView\{margin-left:280px!important;\}/.test(css.replace(/\n/g, '')));
check('CSS: 데스크톱 접음 #mainView margin-left:60px',
  /html\.theme-pro\.pro-collapsed #mainView\{margin-left:60px!important;\}/.test(css));
check('CSS: 레일(641~1023) #mainView margin-left:60px',
  /@media \(min-width:641px\) and \(max-width:1023px\)\{[^@]*?html\.theme-pro #mainView\{margin-left:60px!important;\}/.test(css.replace(/\n/g, '')));
// margin 토글이 사이드바 폭 애니메이션과 같은 속도로 따라온다
check('CSS: #mainView 전환에 margin-left 포함',
  /html\.theme-pro #mainView\{transition:left [^}]*margin-left \.22s/.test(css));
// 옛 버그 흔적 금지 — 248px 사이드바 규칙·124px/260px 오프셋이 남아 있으면 어긋난다
// (에디터 옆패널 .side-panel 248px 은 별개 요소라 그대로 둔다)
check('CSS: 옛 248px 사이드바 좌표 흔적 없음',
  !/#proSide\{[^}]*248px/.test(css) &&
  !/#mainView\{left:248px/.test(css) &&
  !/#proHomeEq\{[^}]*248px/.test(css.replace(/\n/g, '')) &&
  !/calc\(50% \+ 124px\)/.test(css) &&
  !/left:260px!important/.test(css));

/* ── 2) 사이드바 폭 280px + 관리자 아이콘 안 잘림 ────────────────────────── */
check('CSS: 사이드바 폭 280px', /html\.theme-pro #proSide\{[^}]*width:280px/.test(css));
check('CSS: #mainView left 도 280px 동기화(fixed 문맥용)',
  /html\.theme-pro #mainView\{left:280px!important;\}/.test(css));
check('CSS: 홈 배경 캔버스 #proHomeEq 도 280px 영역',
  /#proHomeEq\{[^}]*left:280px[^}]*width:calc\(100% - 280px\)/.test(css));
// 도구 행(알림·계정·시계·보관함·관리자·검색)은 280px 에 다 들지 않으므로
// wrap 해서 검색을 아래 줄로 내린다 — 오버플로 숨김(overflow-x:auto)이면 관리자 아이콘이 조용히 잘린다.
const deskBlock = css.slice(css.indexOf('PRO editor') === -1 ? 0 : 0); // 전체 대상 — 미디어 블록 내 규칙을 정규식으로
check('CSS: 데스크톱 도구 행 wrap(잘림 대신 줄바꿈)',
  /@media\(min-width:1024px\)\{[^@]*?html\.theme-pro \.pro-tools \.hdr-right\{flex-wrap:wrap;overflow-x:visible;overflow-y:visible;/.test(css.replace(/\n/g, '')));
check('CSS: 검색 입력은 아래 줄 통짜(flex 1 1 100%)',
  /html\.theme-pro \.pro-tools \.search-wrap\{margin-bottom:0;flex:1 1 100%;min-width:0;max-width:none;width:auto;margin-left:0;\}/.test(css));
check('CSS: 오디오 바·곡목록·선택막대도 280px 기준 중앙 정렬',
  /html\.theme-pro \.mp\.mp-bar\{left:calc\(50% \+ 140px\)/.test(css) &&
  /html\.theme-pro \.select-bar\{left:calc\(50% \+ 140px\)/.test(css));
check('CSS: 엽스코드 도킹 292px(사이드바 280+12)',
  /html\.theme-pro #ypApp\{left:292px!important;right:auto!important/.test(css));

/* ── 3) 타이틀 SDYnotes ─────────────────────────────────────────────────── */
check('HTML: <title>SDYnotes', /<title>SDYnotes<\/title>/.test(html));
check('HTML: 스플래시 제목 SDYnotes', /class="sp-title">SDYnotes</.test(html));
check('HTML: 브랜드 h1 SDYnotes', /<h1[^>]*>SDYnotes<\/h1>/.test(html));
check('JS: 앱 제목 폴백 SDYnotes', /String\(S\.appTitle\)\.trim\(\)\)\?S\.appTitle\.trim\(\):'SDYnotes'/.test(js));
check('JS/HTML: 기본 타이틀에 옛 이름 흔적 없음', !js.includes("'동엽신의 끄적끄적'") && !html.includes('동엽신의 끄적끄적'));

/* ── 4) 홈 배경 버츄얼라이저 — 연속 곡선 + 이동 그라데이션 + 바닥 시작 ───── */
// 홈 배경 전용 IIFE 만 추출한다 (플레이어 안 이퀄라이저 eqViz 는 막대가 맞다)
const iifeAt = js.indexOf("getElementById('proHomeEq')");
assert.ok(iifeAt > 0, '번들에 proHomeEq 배경 그리기가 있다');
const iife = js.slice(iifeAt - 4000, iifeAt + 12000);
check('VIZ: 이산 막대 상수(BAR_N=28) 제거 — 연속 칼럼(COL_N=96)',
  !/const BAR_N=28/.test(iife) && /const COL_N=96/.test(iife));
check('VIZ: 공간 스무딩(이웃 3칸) 존재 — 계단 없는 연속 그래프',
  /sm\[i\]=\(left\+cur\*2\+nxt\)\/4/.test(iife));
check('VIZ: 시작점이 화면 가장 바닥(baseY=h+2)',
  /const baseY=h\+2;/.test(iife));
check('VIZ: 물결 아래는 화면 밖까지 닫힌 채로 채운다(바닥에서 피어오름)',
  /closePath\(\)/.test(iife) && /lineTo\(xs\[COL_N-1\], baseY\)/.test(iife));
check('VIZ: 중점 2차 베지어로 부드럽게 이은 곡선',
  /quadraticCurveTo\(xs\[i\], ys\[i\], mx, my\)/.test(iife));
check('VIZ: 이동하는 그라데이션 — 흐르는 색 띠(좌→우 순환)',
  /createLinearGradient\(bx, 0, bx\+bandW, 0\)/.test(iife) && /\(\(now\*0\.05\)%cyc\)-bandW/.test(iife));
check('VIZ: 이동하는 그라데이션 — 미끄러지는 윗선(주기=화면 폭)',
  /createLinearGradient\(sx0, 0, sx0\+w, 0\)/.test(iife));
check('VIZ: 세로 페이드 몸통 그라데이션',
  /createLinearGradient\(0, baseY-maxH, 0, baseY\)/.test(iife));
check('VIZ: 서브 컬러(HSL 회전) 헬퍼 — 그라데이션 색이 강조색과 다르게 이동',
  /function hexToHsl\(/.test(iife) && /hue2=\(hsl\[0\]\+42\+360\)%360/.test(iife));
check('CSS: 재생 중 캔버스 노출(연속 물결 기준 .14)', /html\.theme-pro #proHomeEq\.playing\{opacity:\.14;\}/.test(css));
// 피크 캡(막대 위 점)은 이산 막대의 상징 — 배경 IIFE 에서 사라졌어야 한다
check('VIZ: 피크 캡 제거(막대 잔재 없음)', !/peak\[i\]/.test(iife) && !/roundRect/.test(iife));

console.log('\n14.61 프로 셸 레이아웃·버츄얼라이저 계약 — 전부 통과');

/* ═══════════ 14.62 · 사용자 보고 일곱 가지 ═══════════ */
const css14 = css.replace(/\n/g, '');

// ① 테마 행 라벨 — 옆 설명 문구 제거
check('14.62 · HTML: 테마 행에 옆 설명 문구 없음', !html.includes('기본 · 전문가용 디자인 / 캐주얼'));
check('14.62 · HTML: 테마 행 라벨은 유지', /set-label[^>]*>테마</.test(html));

// ② 사이드바 토글 — 브랜드 행 중앙 정렬 + 세련된 필
check('14.62 · CSS: 토글이 브랜드 로고 중심(top:23px)에 정렬',
  /\.pro-side-toggle\{position:absolute;top:23px;right:-12px/.test(css14));
check('14.62 · CSS: 접힘 상태 토글 보정(top:15px)',
  /html\.theme-pro\.pro-collapsed \.pro-side-toggle\{top:15px;\}/.test(css));

// ③ 엽스코드 창 이동 — 기본 테마 !important 고정을 이기는 인라인 important
check('14.62 · JS: ypDrag 가 인라인 !important 로 위치를 쓴다',
  /ypDrag[\s\S]{0,900}setProperty\('left',c\.x\+'px','important'\)[\s\S]{0,200}setProperty\('top',c\.y\+'px','important'\)/.test(js));

// ④ 로고 펜 치우침 — 사이드바 로고 미세 nudge
check('14.62 · CSS: 브랜드 로고 펜 translateX(-.8px)',
  /html\.theme-pro \.pro-brand \.logo-dot \.logo-pro\{width:16px;height:16px;transform:translateX\(-\.8px\);\}/.test(css));

// ⑤ 제목 Enter — blur 로 포커스 해제
check('14.62 · JS: edTitle Enter blur',
  /edTitle'\)\.addEventListener\('keydown'[\s\S]{0,120}e\.key==='Enter'\)\{ e\.preventDefault\(\); this\.blur\(\); \}/.test(js));

// ⑥ 해돌이 — 대화기록 열면 말풍선 닫기 + 질문칸 가로 확장
const histAt = js.indexOf('sdyAiHistToggle=function');
check('14.62 · JS: 대화기록 열 때 말풍선 닫기(sayHide+미니 버블)',
  histAt > 0 && /sdyAiHistToggle=function\(\)\{[\s\S]{0,420}sayHide\(\);[\s\S]{0,200}noteOtterBubble[\s\S]{0,120}classList\.remove\('show'\)/.test(js));
check('14.62 · CSS: 질문칸 기본 폭 320px', /width:min\(var\(--ai-q-w,320px\),660px,100%\)/.test(css));
check('14.62 · CSS: 질문 기둥 상한 720px', /max-width:min\(720px,calc\(100% - 160px\)\)/.test(css));
check('14.62 · JS: 질문칸 성장 상한 560px', /want=Math\.max\(240,Math\.min\(560,textW\+80\)\)/.test(js));

// ⑦ 편집 상단바 통합 — 제목·글꼴 도구·액션이 한 줄
check('14.62 · CSS: 상단바 한 줄 그리드(title tools actions)',
  /grid-template-areas:"title tools actions"!important/.test(css14));
check('14.62 · CSS: 도구 칸은 가운데 정렬', /html\.theme-pro \.editor-toolbar \.tb-mid\{\s*grid-area:tools;justify-self:center;/.test(css.replace(/\n/g, '')));

// ⑧ 체크상자 배치 모드 — 고스트가 따라다니고 누르면 확정
const placeAt = js.indexOf('function beginCheckPlacement');
check('14.62 · JS: 체크상자 배치 모드 진입 함수', placeAt > 0);
check('14.62 · JS: 체크상자 고스트 표시(kind check)',
  /kind==='check'[\s\S]{0,400}체크상자/.test(js));
check('14.62 · JS: 누른 자리에 확정(commit check)',
  /pm\.kind==='check'\)\{[\s\S]{0,300}pushHistory\(\);[\s\S]{0,1200}체크상자를 넣었습니다/.test(js));
check('14.62 · JS: 넣기 버튼이 배치 모드로 연결',
  /function insertCheckbox\(\)\{[\s\S]{0,1400}beginCheckPlacement\(\);/.test(js));

console.log('\n14.61 + 14.62 계약 — 전부 통과');
