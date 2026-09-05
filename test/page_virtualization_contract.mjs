/* 14.27.3 · 무거운 다중 페이지 DOM 가상화 계약
 * 문서 데이터(doc.pages)는 그대로 두고 화면에서 먼 페이지의 레이어 DOM만 회수한다.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(root, 'sdynotes.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sdynotes.css'), 'utf8');
let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

// 현재 페이지 판정은 화면 노출 높이를 직접 비교한다. 예전 35% 기준점 공식은
// 1쪽 400px / 2쪽 360px 상황에서도 2쪽으로 오판했다.
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
ok('현재 ±1만 선렌더하고 ±2 밖 DOM을 회수한다',
  /VIRTUAL_RENDER_RADIUS=1/.test(js) && /VIRTUAL_KEEP_RADIUS=2/.test(js));
ok('고정 렌더 창이 현재 페이지를 먼저 렌더한다',
  /function maintainPageWindow\(center,immediate\)/.test(js)
  && /if\(!renderedPages\.has\(center\)\) try\{ renderPageEls\(center\)/.test(js));
ok('IntersectionObserver도 고정 보존 범위 밖 페이지를 다시 그리지 않는다',
  /en\.isIntersecting&&Math\.abs\(i-\(curPageIdx\|0\)\)<=VIRTUAL_KEEP_RADIUS/.test(js));
ok('뒷페이지에서도 1페이지를 강제로 계속 렌더하지 않는다',
  !/new Set\(\[0, curPageIdx\|0\]\)/.test(js));
ok('스크롤 때 Observer와 별개로 고정 렌더 창을 갱신한다',
  /function onEditorScroll\(\)[\s\S]*?maintainPageWindow\(idx,false\)/.test(js));
ok('페이지 바로가기와 찾기 이동은 스크롤 전에 목적 페이지를 렌더한다',
  /function goToPage\(n\)[\s\S]*?maintainPageWindow\(i,true\)[\s\S]*?_scrollBodyTo/.test(js)
  && /function revealHit\(hit,soft\)[\s\S]*?maintainPageWindow\(hit\.pageIdx,true\)/.test(js));
ok('3쪽보다 먼 점프는 중간 페이지를 연쇄 로드하지 않도록 즉시 이동한다',
  (js.match(/Math\.abs\([^\n]+\)>2/g)||[]).length>=2
  && /far\?'auto':'smooth'/.test(js) && /\(soft\|\|far\)\?'auto':'smooth'/.test(js));
ok('AI 페이지 이동도 같은 가상화 창을 사용한다',
  /function aiEditScrollToPage\(pi\)[\s\S]*?maintainPageWindow\(_pi,true\)/.test(js));
ok('언로드는 렌더 토큰을 올려 이미 예약된 RAF 청크까지 취소한다',
  /function unloadPage\(i\)[\s\S]*?_pageRenderTok\[i\]=\(_pageRenderTok\[i\]\|\|0\)\+1[\s\S]*?clearPageEls\(i\)/.test(js));
const clearSrc = js.slice(js.indexOf('function clearPageEls'), js.indexOf('function _elBox'));
ok('언로드는 DOM 레이어만 비우고 doc.pages 데이터는 건드리지 않는다',
  /innerHTML='';/.test(clearSrc) && !/doc\.pages/.test(clearSrc));
ok('무거운 페이지 요소는 DocumentFragment로 묶어 삽입한다',
  /function renderPageEls\(idx\)[\s\S]*?createDocumentFragment\(\)[\s\S]*?flushBags/.test(js));
const tblAllSrc = js.slice(js.indexOf('function renderAllTblDivs'), js.indexOf('// 표 가까이'));
const wfClearSrc = js.slice(js.indexOf('function wfClear'), js.indexOf('// 화면의 글자에만'));
ok('표·단어 분석 종료가 가상화된 모든 페이지를 다시 렌더하지 않는다',
  /renderedPages\.has\(i\)/.test(tblAllSrc) && /Array\.from\(renderedPages\)/.test(wfClearSrc));
ok('마지막 페이지 복원은 서버 슬라이스를 기다리지 않고 위치와 렌더를 먼저 잡는다',
  /function restoreLastPos\(\)[\s\S]*?maintainPageWindow\(i,true\)[\s\S]*?doScroll\(\)/.test(js)
  && !/ensureLazyPage\(i\)\.then\(doScroll\)/.test(js));
const guardSrc = js.slice(js.indexOf('function canUnloadPage'), js.indexOf('function unloadPage'));
ok('편집·선택·활성 표·찾기·단어 분석 페이지는 언로드하지 않는다',
  /\.tb\.edit,\.sel,\.msel/.test(guardSrc) && /activeTbl/.test(guardSrc)
  && /findOpen\|\|wfOn/.test(guardSrc));

console.log(`\n페이지 가상화 계약: PASS ${pass}`);
