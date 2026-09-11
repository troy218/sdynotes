/* 14.61 · 프로 셸 레이아웃 + 홈 배경 버츄얼라이저 계약
   14.62 · 사용자 보고 일곱 가지 계약 추가 (테마 문구·토글·엽스코드 이동·로고
   치우침·제목 Enter·해돌이 말풍선/질문칸·상단바 통합·체크상자 배치)
   14.64 · 사이드바 접기 제거 + 상태 줄 + 도구 한 줄 + 파동 버츄얼라이저 + 원형 음반
   ---------------------------------------------------------------------------
   사용자 보고 4가지를 잠그는 정적 계약이다 (실측 레이아웃은 브라우저 몫 —
   jsdom 은 계단식 레이아웃을 계산하지 못 하므로 규칙의 존재·우선순위를 검증):

   1) 사이드바가 첫 노트를 가리지 않게 — #mainView 은 static 이라 left 가 무효였다.
      데스크톱(≥1024)은 margin-left:280px, 레일(641~1023) margin 규칙이 반드시
      있어야 하고, 248px 흔적이 남으면 실패. 14.64 부터 '접음(60px)' 상태는 없다.
   2) 사이드바 폭 확대(248→280) + 도구 버튼이 오버플로에 잘리지 않게 —
      버튼은 flex:1 1 0 으로 한 줄에 균등 분배, 검색 입력은 아래 줄 통짜.
   3) 앱 타이틀 'SDYnotes' — <title>·스플래시·브랜드 h1·JS 폴백이 전부 SDYnotes.
   4) 홈 배경 버츄얼라이저 — 14.64 부터 '그래프'가 아니라 서로 다른 주파수의
      사인 파동 6겹. 겹마다 담당 대역이 있고, 시간 완화(공격 0.55s/낙하 2.4s)로
      부드럽게 숨쉬며, 단색 도형 재질(fillRect·createPattern)을 쓰지 않는다.
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
// 14.64 · 접기 기능 제거 — 흔적(클래스 규칙·토글 버튼·저장값)이 남아 있으면 실패
check('14.64 · CSS: .pro-collapsed 규칙이 하나도 없다(접기 제거)',
  !/html\.theme-pro\.pro-collapsed[^{]*\{/.test(css));
check('14.64 · HTML: 사이드바 접기 토글 버튼 제거',
  !html.includes('proSideToggle') && !html.includes('pro-side-toggle'));
// 정리 코드(옛 저장값·클래스 청소)만 남고, 토글 함수·전역 노출은 없어야 한다
check('14.64 · JS: applyProCollapsed/toggleProSide 함수·전역 노출 제거',
  !/function applyProCollapsed|function toggleProSide|window\.toggleProSide|window\.applyProCollapsed/.test(js));
check('14.64 · JS: 옛 접힘 흔적은 테마 적용 때 청소',
  /classList\.remove\('pro-collapsed'\)[\s\S]{0,80}removeItem\('proSideCollapsed'\)/.test(js));
check('14.64 · CSS: #proSide 는 접기 트랜지션 없이 고정 폭(280px)',
  !/html\.theme-pro #proSide\{transition:width/.test(css) &&
  /html\.theme-pro #proSide\{[^}]*width:280px/.test(css));
check('CSS: 레일(641~1023) #mainView margin-left:60px',
  /@media \(min-width:641px\) and \(max-width:1023px\)\{[^@]*?html\.theme-pro #mainView\{margin-left:60px!important;\}/.test(css.replace(/\n/g, '')));
// 폭이 하나뿐이라 margin-left 전환도 남아 있지 않다
check('14.64 · CSS: 접기용 사이드바 폭/마진 전환 제거',
  !/html\.theme-pro #proSide\{[^}]*transition/.test(css) &&
  !/html\.theme-pro #mainView\{[^}]*transition/.test(css));
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
// 14.64 · 도구 버튼은 flex:1 1 0 으로 280px 를 균등 분배해 한 줄에 전부 들어간다
// (14.54 의 nowrap + overflow-x:auto 는 280px 에서 곧 '가로 스크롤 = 잘림'이었다)
const cssFlat = css.replace(/\n/g, '');
check('14.64 · CSS: 도구 행은 wrap(가로 스크롤 아님)',
  /html\.theme-pro \.pro-tools \.hdr-right\{display:flex;flex-wrap:wrap;gap:6px;margin:0!important;width:100%;align-items:center;overflow:visible;\}/.test(cssFlat));
check('14.64 · CSS: 도구 버튼 한 줄 균등 분배(flex:1 1 0)',
  /html\.theme-pro \.pro-tools \.tool-btn\{flex:1 1 0;min-width:0;width:auto;height:34px;padding:0;\}/.test(cssFlat));
check('14.64 · CSS: 검색 입력은 아래 줄 통짜(flex 1 1 100%)',
  /html\.theme-pro \.pro-tools \.search-wrap\{order:9;flex:1 1 100%;min-width:0;max-width:none;width:auto;margin-left:0;\}/.test(cssFlat));
check('14.64 · CSS: 사이드바 도구 행은 14.54 nowrap 강제에서 빠져 있다',
  !/html\.theme-pro \.pro-tools \.hdr-right\{[^}]*flex-wrap:nowrap!important/.test(cssFlat));
// 상태 줄 — 서버 계기판 + 문구(+오프라인 배지)가 도구 줄 위 전용 줄에 산다
check('14.64 · HTML: 사이드바 맨 위 상태 줄(#proStateRow)',
  /<div class="pro-state" id="proStateRow"[^>]*>[\s\S]{0,200}srvStateText/.test(html));
check('14.64 · CSS: 상태 줄 문구는 계기판 등급 색을 따른다',
  /html\.theme-pro \.pro-state\.good \.pro-state-text\{color:#0E9F6E;\}/.test(css) &&
  /html\.theme-pro \.pro-state\.bad\s+\.pro-state-text\{color:#E02424;\}/.test(css));
check('14.64 · JS: 계기판·오프라인 배지를 상태 줄로 옮기고 캐주얼엔 헤더로 되돌린다',
  /proStateRow[\s\S]{0,900}stateRow\.insertBefore\(gauge,stateRow\.firstChild\)[\s\S]{0,300}tools\.insertBefore\(gauge,tools\.firstChild\)/.test(js));
check('14.64 · JS: 상태 문구도 계기판과 함께 갱신',
  /srvStateText[\s\S]{0,600}서버 원활/.test(js));
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

/* ── 4) 홈 배경 버츄얼라이저 — 서로 다른 주파수의 파동 6겹 ───────────────── */
// 홈 배경 전용 IIFE 만 추출한다 (플레이어 안 이퀄라이저 eqViz 는 막대가 맞다)
const iifeAt = js.indexOf("getElementById('proHomeEq')");
assert.ok(iifeAt > 0, '번들에 proHomeEq 배경 그리기가 있다');
const iife = js.slice(iifeAt - 3000, iifeAt + 14000);
check('VIZ: 이산 막대(BAR_N=28)·연속 곡선(COL_N=96) 잔재 없음',
  !/const BAR_N=28/.test(iife) && !/const COL_N=96/.test(iife));
check('VIZ: 파동 겹 정의 6개(밴드·파장·속도·색)',
  /const WAVES=\[/.test(iife) && /band:\[\s*40,/.test(iife) && /band:\[5000,14000\]/.test(iife) &&
  (iife.match(/\{ band:\[/g) || []).length === 6);
check('VIZ: 겹마다 담당 대역(저음→고음) 에너지만 쓴다',
  /bandRaw\(W\.band\[0\], W\.band\[1\], bins, nyq\)/.test(iife));
check('VIZ: 시간 완화 — 공격 0.55s / 낙하 2.40s (촐랑거림 방지)',
  /target>env\[i\]\?0\.55:2\.40/.test(iife) && /1-Math\.exp\(-dt\/tau\)/.test(iife));
check('VIZ: 사인 파동 + 느린 변조 + 옅은 배음(여러 주파수 겹침)',
  /Math\.sin\(u\*turns\+ph\)/.test(iife) && /overtone/.test(iife));
check('VIZ: 위상이 아주 느리게 흐른다(0.031 rad/s 이하)',
  /sp:\s*-?0\.0(3[01]|27|23|2|16|13)/.test(iife));
check('VIZ: 겹마다 강조색에서 살짝 돌린 색(HSL)',
  /function hexToHsl\(/.test(iife) && /\(\(hsl\[0\]\+W\.hue\)%360\+360\)%360/.test(iife));
check('VIZ: 몸통은 윗선에서 바닥까지 사라지는 세로 그라데이션',
  /createLinearGradient\(0, yc-amp\*1\.8, 0, top\)/.test(iife) && /ctx\.fill\(\)/.test(iife));
check('VIZ: 중점 2차 베지어로 부드럽게 잇는다(각진 꺾임 없음)',
  /quadraticCurveTo\(xs\[s\], ys\[s\], mx, my\)/.test(iife));
check('VIZ: 그림은 #proHomeEq 캔버스 자체에 그린다(호스트는 canvas)',
  /const cvs=document\.getElementById\('proHomeEq'\)/.test(iife) && !/attachShadow/.test(iife));
// 옛 '스펙트럼 그래프' 상징 — 칼럼 스무딩·이동 그라데이션 띠·피크 캡 — 은 사라졌어야 한다
check('VIZ: 옛 그래프 잔재 없음(칼럼 스무딩·흐르는 색 띠·피크 캡)',
  !/sm\[i\]=\(left\+cur\*2\+nxt\)\/4/.test(iife) && !/createLinearGradient\(bx, 0, bx\+bandW, 0\)/.test(iife) &&
  !/peak\[i\]/.test(iife) && !/roundRect/.test(iife) && !/fillRect/.test(iife));
check('CSS: 재생 중 캔버스 노출(은은한 .14)', /html\.theme-pro #proHomeEq\.playing\{opacity:\.14;\}/.test(css));

/* ── 5) 14.64 · 플로팅 음반은 원형 ──────────────────────────────────────── */
check('CSS: 플로팅 음반 .mp-float 은 border-radius:50%!important',
  /\.mp\.mp-float\{border-radius:50%!important;\}/.test(cssFlat));
check('CSS: 14.54 사각화 뒤에 원형 규칙이 온다(우선순위)',
  css.lastIndexOf('.mp.mp-float{border-radius:50%!important;}') > css.indexOf('14.54 · 전역 사각화'));

console.log('\n14.61~14.64 프로 셸 레이아웃·버츄얼라이저 계약 — 전부 통과');

/* ═══════════ 14.62 · 사용자 보고 일곱 가지 ═══════════ */
const css14 = css.replace(/\n/g, '');

// ① 테마 행 라벨 — 옆 설명 문구 제거
check('14.62 · HTML: 테마 행에 옆 설명 문구 없음', !html.includes('기본 · 전문가용 디자인 / 캐주얼'));
check('14.62 · HTML: 테마 행 라벨은 유지', /set-label[^>]*>테마</.test(html));

// ② 사이드바 토글 → 14.64 에서 기능 자체를 제거(사용자 요청: "그냥 안 접히게")
// 주석에 남은 '무엇을 지웠는지' 설명은 흔적으로 치지 않는다 — 실제 규칙에만 적용
const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '');
check('14.64 · CSS/HTML: 접기 토글 규칙·버튼 없음',
  !/\.pro-side-toggle\s*\{/.test(cssNoComment.replace(/\n/g, '').replace(/\s+/g, ' ')) &&
  !/pro-side-toggle\{/.test(cssNoComment) && !html.includes('proSideToggle'));

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

// ⑨ 14.63 · 브랜드(로고·SDYnotes) 왼쪽 정렬 — 레일/접힘은 중앙 유지
check('14.63 · CSS: 브랜드 왼쪽 정렬(왼쪽 여백 20px)',
  /html\.theme-pro \.pro-brand\{align-items:flex-start;text-align:left;padding:20px 12px 14px 20px;\}/.test(css));
check('14.64 · CSS: 접힘 상태 규칙은 사라졌다(접기 제거)',
  !/pro-collapsed/.test(cssNoComment));
check('14.63 · CSS: 좁은 레일(≤1023)도 중앙 정렬 유지',
  /@media \(max-width:1023px\)\{\s*html\.theme-pro \.pro-brand\{align-items:center;text-align:center;padding:12px 0 10px;\}/.test(css.replace(/\n/g, '')));

console.log('\n14.61 + 14.62 + 14.63 + 14.64 계약 — 전부 통과');
