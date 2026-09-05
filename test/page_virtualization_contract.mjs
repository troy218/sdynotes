/* 19.0 · 대용량 문서 페이지 '셸 가상화' 계약
 *
 * 문서 데이터(doc.pages)는 그대로 두고, 화면에 걸치는 쪽만 종이(page-wrap)를
 * DOM 에 올린다. 500쪽이든 5000쪽이든 DOM 비용이 일정해야 한다.
 *   · 셸 창  : 화면에 걸치는 쪽 ± SHELL_PAD (상한 SHELL_MAX)
 *   · 요소 창: 현재 쪽 ± VIRTUAL_RENDER_RADIUS, ± VIRTUAL_KEEP_RADIUS 밖은 회수
 * 예전의 '전 쪽 셸 생성 + IntersectionObserver 2개' 구조는 제거됐다.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(root, 'sdynotes.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sdynotes.css'), 'utf8');
let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
const slice = (from, to) => js.slice(js.indexOf(from), js.indexOf(to));
const fnSrc = (name) => {
  const at = js.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' 함수가 있어야 한다');
  // 같은 들여쓰기 레벨의 닫는 중괄호까지
  const end = js.indexOf('\n    }', at);
  return js.slice(at, end > 0 ? end + 6 : at + 4000);
};

// ── 현재 쪽 판정 (기준점이 아니라 실제 노출 면적) ───────────────────────
const visSrc = js.slice(js.indexOf('function mostVisiblePageIndex'), js.indexOf('function onEditorScroll'));
const mostVisible = new Function(`${visSrc}; return mostVisiblePageIndex;`)();
assert.equal(mostVisible(700, 800, 5, 1100, 40, 1, 0), 0, '1쪽이 400px로 더 많이 보이면 1쪽');
assert.equal(mostVisible(760, 800, 5, 1100, 40, 1, 0), 1, '2쪽이 420px로 더 많이 보이면 2쪽');
assert.equal(mostVisible(720, 800, 5, 1100, 40, 1, 0), 0, '동률이면 기존 1쪽 유지');
assert.equal(mostVisible(720, 800, 5, 1100, 40, 1, 1), 1, '동률이면 기존 2쪽 유지');
ok('현재 페이지를 기준점이 아니라 실제 노출 면적으로 판정한다',
  visSrc.includes('Math.min(bottom,pb)-Math.max(top,pt)')
  && !js.includes('Math.round((body.scrollTop+body.clientHeight*0.35)'));
ok('현재 페이지는 테두리·라벨·접근성 상태로도 확실히 구분한다',
  css.includes('.paper.focused{') && css.includes('.page-wrap.focused .page-label')
  && js.includes('aria-current'));

// ── 셸 창 (종이 자체의 가상화) ─────────────────────────────────────────
ok('셸 창 상수(여유분·상한)와 요소 창 상수를 함께 둔다',
  /const SHELL_PAD=\d+/.test(js) && /const SHELL_MAX=\d+/.test(js)
  && /VIRTUAL_RENDER_RADIUS=1/.test(js) && /VIRTUAL_KEEP_RADIUS=2/.test(js));
ok('올라와 있는 종이를 쪽 번호로 관리한다 (배열 순서 인덱싱 금지)',
  /const mountedShells=new Map\(\)/.test(js)
  && !/document\.querySelectorAll\('\.page-wrap'\)\[/.test(js));

const rpSrc = fnSrc('renderPages');
ok('renderPages 가 전 쪽 종이를 만들지 않는다',
  !/doc\.pages\.forEach/.test(rpSrc) && /syncPageShells\(\)/.test(rpSrc));
ok('renderPages 가 스테이지 높이(스크롤 길이)를 먼저 잡는다',
  rpSrc.indexOf('layoutPages()') >= 0 && rpSrc.indexOf('layoutPages()') < rpSrc.indexOf('syncPageShells()'));
ok('renderPages 끝에서 현재 쪽을 강제로 그린다',
  /ensureVisiblePagesRendered\(\)/.test(rpSrc));

const totalSrc = slice('const totalH=', 'stage.style.setProperty');
ok('스테이지 높이는 화면에 올린 쪽이 아니라 전체 쪽수로 계산한다',
  /doc\.pages\.length\*size\.h/.test(totalSrc));

const syncSrc = fnSrc('syncPageShells');
ok('셸 창은 스크롤 위치로 계산한 범위 ± 여유분이다',
  /visiblePageRange\(\)/.test(syncSrc) && /SHELL_PAD/.test(syncSrc));
ok('셸 창에 상한을 둬 극단 축소·먼 점프에서도 DOM 이 폭발하지 않는다',
  /last-first\+1>SHELL_MAX/.test(syncSrc));
ok('창 밖 종이는 내리고 창 안 종이는 채운다',
  /unmountPageShell\(i\)/.test(syncSrc) && /ensurePageShell\(i\)/.test(syncSrc));

const visRangeSrc = fnSrc('visiblePageRange');
ok('보이는 범위는 IntersectionObserver 가 아니라 scrollTop 으로 계산한다',
  /body\.scrollTop/.test(visRangeSrc) && /Math\.floor\(top\/step\)/.test(visRangeSrc));
ok('레이아웃이 아직 0 인 순간에는 현재 쪽을 창의 기준으로 삼는다',
  /clientHeight>0\)\) return \{first:cur,last:cur\}/.test(visRangeSrc));

ok('페이지 IntersectionObserver(pageObserver/pageUnloader)는 완전히 제거됐다',
  !/pageObserver/.test(js) && !/pageUnloader/.test(js));

const unmountSrc = fnSrc('unmountPageShell');
ok('종이를 내려도 문서 데이터(doc.pages)는 건드리지 않는다',
  !/doc\.pages/.test(unmountSrc) && /wrap\.remove\(\)/.test(unmountSrc));
ok('종이를 내릴 때 렌더 토큰을 올려 예약된 청크까지 취소한다',
  /_pageRenderTok\[i\]=\(_pageRenderTok\[i\]\|\|0\)\+1/.test(unmountSrc)
  && /renderedPages\.delete\(i\)/.test(unmountSrc));

const layoutSrc = fnSrc('layoutPages');
ok('배치는 올라와 있는 종이만, 자리는 쪽 번호로 계산한다',
  /mountedShells\.forEach\(\(w,i\)=>positionPageWrap\(w,i\)\)/.test(layoutSrc));
ok('확대/축소 뒤 셸 창을 다시 맞춘다', /syncPageShells\(\)/.test(layoutSrc));

// ── 요소 창 (쪽 안의 내용) ────────────────────────────────────────────
const mpwSrc = fnSrc('maintainPageWindow');
ok('요소 창을 맞추기 전에 종이부터 올린다',
  mpwSrc.indexOf('syncPageShells()') > 0
  && mpwSrc.indexOf('syncPageShells()') < mpwSrc.indexOf('const fill'));
ok('관성 스크롤 중에는 무거운 내용을 몰아 그리지 않되, 멈출 때까지 백지로 두지도 않는다',
  /if\(immediate\) fill\(\);/.test(mpwSrc)
  && /Date\.now\(\)-_lastFillAt>=FILL_MAX_GAP\) fill\(\)/.test(mpwSrc)
  && /setTimeout\(\(\)=>\{[^}]*fill\(\); \},FILL_IDLE\)/.test(mpwSrc)
  && /const FILL_IDLE=\d+/.test(js) && /const FILL_MAX_GAP=\d+/.test(js));
ok('현재 쪽 ±KEEP 밖 요소 DOM 은 회수한다',
  /Math\.abs\(i-center\)>VIRTUAL_KEEP_RADIUS\) unloadPage\(i\)/.test(mpwSrc));

const guardSrc = fnSrc('canUnloadPage');
ok('편집·선택 중이거나 표·그리기가 살아 있는 쪽은 내리지 않는다',
  /\.tb\.edit,\.sel,\.msel/.test(guardSrc) && /activeTbl/.test(guardSrc) && /drawing/.test(guardSrc));
ok('찾기·단어분석 때문에 500쪽을 통째로 붙잡지 않는다',
  !/findOpen\|\|wfOn/.test(guardSrc));

const clearSrc = slice('function clearPageEls', 'function _elBox');
ok('요소 비우기는 레이어만 비우고 doc.pages 는 건드리지 않는다',
  /innerHTML='';/.test(clearSrc) && !/doc\.pages/.test(clearSrc));

ok('무거운 페이지 요소는 DocumentFragment 로 묶어 삽입한다',
  /function renderPageEls\(idx\)[\s\S]*?createDocumentFragment\(\)[\s\S]*?flushBags/.test(js));
ok('가져오기 중복 정리(O(n^2))는 쪽마다 한 번만 돌린다',
  /const _sanDone=new WeakSet\(\)/.test(js) && /if\(!_sanDone\.has\(els\)\)/.test(js));

// ── 이동 경로 ─────────────────────────────────────────────────────────
ok('페이지 바로가기와 찾기 이동은 스크롤 전에 목적 쪽을 올린다',
  /function goToPage\(n\)[\s\S]*?maintainPageWindow\(i,true\)[\s\S]*?_scrollBodyTo/.test(js)
  && /function revealHit\(hit,soft\)[\s\S]*?maintainPageWindow\(hit\.pageIdx,true\)/.test(js));
ok('3쪽보다 먼 점프는 중간 쪽을 연쇄 로드하지 않도록 즉시 이동한다',
  (js.match(/Math\.abs\([^\n]+\)>2/g) || []).length >= 2
  && /far\?'auto':'smooth'/.test(js) && /\(soft\|\|far\)\?'auto':'smooth'/.test(js));
ok('쪽 추가·AI 이동도 같은 창 로직(scrollPageIntoView)을 쓴다',
  /function scrollPageIntoView\(pi,behavior\)/.test(js)
  && /function aiEditScrollToPage\(pi\)[\s\S]*?scrollPageIntoView\(_pi,'auto'\)/.test(js));
ok('스크롤 때 종이는 매 프레임, 내용은 멎은 뒤에 맞춘다',
  /function onEditorScroll\(\)[\s\S]*?syncPageShells\(\);[\s\S]*?maintainPageWindow\(idx,false\)/.test(js));
ok('마지막 페이지 복원은 서버 슬라이스를 기다리지 않는다',
  /function restoreLastPos\(\)[\s\S]*?maintainPageWindow\(i,true\)[\s\S]*?doScroll\(\)/.test(js)
  && !/ensureLazyPage\(i\)\.then\(doScroll\)/.test(js));

// ── 전 쪽 훑기 금지 ───────────────────────────────────────────────────
ok('표 다시 그리기는 요소를 그려 둔 쪽만 훑는다',
  /function renderAllTblDivs\(\)\{ if\(doc\) Array\.from\(renderedPages\)/.test(js));
ok('메모(핀) 다시 그리기는 올라와 있는 쪽만 훑는다',
  /function renderAllPins\(\)\{ if\(doc\) Array\.from\(mountedShells\.keys\(\)\)/.test(js));
ok('단어 분석 색칠은 올라와 있는 쪽만, 되돌아온 쪽은 렌더 때 복원한다',
  /function wfPaintPage\(pi\)/.test(js)
  && /function wfPaint\(\)\{[\s\S]*?mountedShells\.keys\(\)/.test(js)
  && /if\(wfOn\) wfPaintPage\(idx\)/.test(js));
ok('찾기 하이라이트는 올라와 있는 쪽만 칠한다',
  /function paintFindHits\(\)[\s\S]*?if\(!mountedShells\.has\(h\.pageIdx\)\) return;/.test(js));

// ── null 안전 ─────────────────────────────────────────────────────────
ok('창 밖 쪽은 paperAt 이 null 이며, 부르는 쪽은 paperQ 로 방어한다',
  /function paperQ\(i,sel\)/.test(js) && !/paperAt\([^)]*\)\./.test(js));
ok('paperAt 은 500쪽을 querySelector 로 뒤지지 않는다',
  /function paperAt\(i\)[\s\S]*?mountedShells\.get\(\+i\)/.test(js));

console.log(`\n페이지 셸 가상화 계약: PASS ${pass}`);
