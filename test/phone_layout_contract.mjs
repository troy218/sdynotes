/* 17.0 · 모바일 레이아웃/기능 표면 계약
 *
 * 실제 CSS는 sdynotes.css로 분리되어 있다. 이 테스트는 브라우저가 CSS 전체를
 * 오류 없이 파싱하는지, 마지막 모바일 블록이 데스크톱으로 새지 않는지, 그리고
 * 홈·에디터·모달·암기카드·음악·시계·채팅의 주요 조작면이 휴대폰 규칙 안에
 * 모두 포함되는지를 검사한다.
 *
 * 실행: node test/phone_layout_contract.mjs
 */
import fs from 'node:fs';
import { readAllJS } from './_frontend.mjs';
import * as csstree from 'css-tree';
import jsdom from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const js = readAllJS();

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '\n      ' + String(extra).replace(/\n/g, '\n      ') : ''));
  }
};
const has = (src, re) => re.test(src);

console.log('\n모바일 레이아웃/기능 표면 계약');

/* ── 1. CSS 자체가 유효한가 ─────────────────────────────────── */
console.log('\n[1] CSS 파싱과 모바일 전용 격리');
const parseErrors = [];
let ast = null;
try {
  ast = csstree.parse(css, { positions: true, onParseError: e => parseErrors.push(e) });
} catch (e) { parseErrors.push(e); }
ok('sdynotes.css 전체를 파싱 오류 없이 읽는다', parseErrors.length === 0,
  parseErrors.map(e => e.formattedMessage || e.message).join('\n'));
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
ok('분리 전 <style> 태그가 CSS에 남아 있지 않다', !/<\/?style\b/i.test(noComments));
ok('모바일 최종 블록이 파일 마지막에 존재한다', css.includes('17.0 · 모바일 전용 최종 레이아웃'));

const mobileMarkerAt = css.indexOf('17.0 · 모바일 전용 최종 레이아웃');
const mobileAt = mobileMarkerAt >= 0 ? css.lastIndexOf('/*', mobileMarkerAt) : -1;
const mobileSource = mobileAt >= 0 ? css.slice(mobileAt) : '';
const mobileErrors = [];
let mobileAst = null;
try {
  mobileAst = csstree.parse(mobileSource, { positions: true, onParseError: e => mobileErrors.push(e) });
} catch (e) { mobileErrors.push(e); }
ok('모바일 최종 블록도 독립적으로 파싱된다', mobileErrors.length === 0);
const topLevel = mobileAst ? [...mobileAst.children] : [];
ok('최종 블록의 선언은 전부 @media 안에만 있다',
  topLevel.length >= 3 && topLevel.every(n => n.type === 'Atrule' && n.name === 'media'),
  topLevel.map(n => `${n.type}:${n.name || ''}`).join(', '));
const queries = topLevel.map(n => n.prelude ? csstree.generate(n.prelude) : '');
ok('모든 최종 쿼리가 좁은 폭 또는 coarse-pointer 휴대폰만 대상으로 한다',
  queries.length >= 3 && queries.every(q =>
    /max-width:(?:380|640)px/.test(q) ||
    (/max-height:560px/.test(q) && /pointer:coarse/.test(q))), queries.join('\n'));
ok('휴대폰 가로 방향도 별도 대응한다',
  queries.some(q => /max-height:560px/.test(q) && /pointer:coarse/.test(q) && /orientation:landscape/.test(q)));

/* ── 2. viewport / safe area / 키보드 ───────────────────────── */
console.log('\n[2] 실제 모바일 viewport와 safe area');
ok('viewport-fit=cover와 사용자 확대 허용을 유지한다',
  has(html, /name="viewport"[^>]*user-scalable=yes[^>]*viewport-fit=cover/));
ok('상·하·좌·우 safe-area 변수를 모두 정의한다',
  ['--ph-safe:', '--ph-top:', '--ph-left:', '--ph-right:'].every(v => mobileSource.includes(v)));
ok('동적 visual viewport 높이를 홈·에디터·오버레이에서 쓴다',
  (mobileSource.match(/--sdy-mobile-vh/g) || []).length >= 8);
ok('JS가 visualViewport resize/scroll을 모두 감시한다',
  has(js, /visualViewport\.addEventListener\('resize',tick/) &&
  has(js, /visualViewport\.addEventListener\('scroll',syncViewport/));
ok('주소창/키보드 변화 높이를 CSS 변수로 전달한다',
  has(js, /setProperty\('--sdy-mobile-vh'/));
ok('iOS 자동 확대 방지를 email/url까지 포함한다',
  has(mobileSource, /input\[type=email\][\s\S]{0,100}input\[type=url\][\s\S]{0,180}font-size:16px!important/));

/* ── 3. 홈과 노트 크기 ─────────────────────────────────────── */
console.log('\n[3] 홈·폴더·노트');
ok('헤더를 예측 가능한 두 줄 모바일 레이아웃으로 만든다',
  has(mobileSource, /\.header \.w-full\{[\s\S]{0,180}flex-direction:column/));
ok('헤더 주요 버튼이 42px 터치 타깃이다',
  has(mobileSource, /\.header \.tool-btn[^\{]*\{[\s\S]{0,120}width:42px!important[\s\S]{0,80}height:42px!important/));
ok('PC에서 고른 카드 크기와 무관하게 폰은 2열이다',
  has(mobileSource, /body\.card-l \.note-card[\s\S]{0,280}flex:1 1 calc\(50% - 4px\)/));
ok('노트/폴더 미리보기 비율이 카드 폭을 따른다',
  has(mobileSource, /body \.note-preview,body \.folder-thumb[\s\S]{0,260}aspect-ratio:4\/5/));
ok('노트 메뉴는 터치에서 항상 보이고 40px이다',
  has(mobileSource, /\.card-menu\{display:flex;width:40px;height:40px/));
ok('선택 작업은 2열 하단 작업판이며 버튼은 44px 이상이다',
  has(mobileSource, /\.select-bar\{[\s\S]{0,260}grid-template-columns:1fr 1fr/) &&
  has(mobileSource, /\.select-bar button\{min-height:44px/));
ok('가로 폰은 노트를 4열로 줄여 과대 카드가 되지 않는다',
  has(mobileSource, /orientation:landscape[\s\S]*flex:1 1 calc\(25% - 6px\)/));

/* ── 4. 에디터의 모든 조작면 ───────────────────────────────── */
console.log('\n[4] 에디터');
ok('종이는 화면 폭에 맞고 본문은 양방향 스크롤 가능하다',
  has(js, /availW\/size\.w/) && has(mobileSource, /\.editor-body\{[\s\S]{0,300}touch-action:pan-x pan-y/));
ok('툴바는 손가락 가로 스크롤이며 버튼이 40px이다',
  has(mobileSource, /\.editor-toolbar\{[\s\S]{0,320}overflow-x:auto!important/) &&
  has(mobileSource, /\.editor-toolbar \.tool-btn[^\{]*\{[\s\S]{0,100}width:40px!important/));
ok('에디터 제목 입력은 16px이며 150px 폭을 확보한다',
  has(mobileSource, /\.editor-toolbar #edTitle\{[\s\S]{0,180}150px[\s\S]{0,100}font-size:16px!important/));
ok('더보기 서랍이 toolbar 아래의 전체 폭 시트다',
  has(mobileSource, /\.more-panel\{[\s\S]{0,180}left:0;right:0[\s\S]{0,100}width:100%/));
ok('서식·글꼴·색·즐겨찾기·메모 팝업이 화면 안 하단 시트다',
  has(mobileSource, /\.font-menu\.show,\.color-popover\.show,\.fav-pop\.show,\.tint-pop\.show,\.pin-pop\.show/));
ok('찾기·표·펜 도구가 화면 폭 안에서 스크롤된다',
  ['.find-bar{', '.tbl-bar{', '.draw-toolbar{'].every(s => mobileSource.includes(s)) &&
  has(mobileSource, /\.tbl-bar\{[\s\S]{0,180}overflow-x:auto/));
ok('텍스트/이미지 조절 손잡이를 모바일에서 확대한다',
  has(mobileSource, /\.tb-move\{width:34px;height:34px/) &&
  has(mobileSource, /\.el-del\{width:34px;height:34px/));
ok('모바일 상자 이동/리사이즈는 rAF + transform preview로 깜박임을 줄인다',
  has(js, /_queueEditorMove\('drag',e\)/) && has(js, /_queueEditorMove\('resize',e\)/) &&
  has(js, /translate3d\(\$\{x\}px,\$\{y\}px,0\)/) && has(css, /\.tb\.sdy-dragging[\s\S]{0,160}will-change:transform/));
ok('터치 조작 손잡이는 브라우저 스크롤 제스처와 분리된다',
  has(css, /\.handle\{[\s\S]{0,360}touch-action:none/) &&
  has(css, /\.tb-edge\{[\s\S]{0,220}touch-action:none/) &&
  has(css, /\.tbl-edge,\.tbl-div,\.tbl-h,\.tbl-stretch\{[\s\S]{0,160}touch-action:none/));

/* ── 4b. 14.68 · 폰 세로 조작 강화 (핀치 앵커 · 손바닥 거부 · 더블탭 선택 · 전체 노출 도구막대) ── */
console.log('\n[4b] 14.68 폰 세로 조작 강화');
ok('핀치 줌은 손가락 중점 앵커 — 제스처 중 스크롤 대신 translate+scale을 쓴다',
  has(js, /translate\(\$\{tx\}px,\$\{ty\}px\) scale\(\$\{k\}\)/) &&
  has(js, /stageOrigin/) && has(js, /abortPinch/));
ok('두 손가락 터치 시작 시 네이티브 제스처를 차단하고, 뺏기면 중단한다',
  has(js, /if\(e\.cancelable===false\)\{ abortPinch\(\); return; \}/));
ok('펜으로 쓰는 동안 손바닥/손가락 터치는 자동 무시된다 (자동 손바닥 거부)',
  has(js, /_sdyPalmNow/) && has(js, /_palmGateTouch/) && has(js, /_palmGatePointer/) &&
  has(js, /e\.pointerType!=='pen'/));
ok('drawStart 가 손바닥 거부·연필 모드 터치를 걸러낸다',
  has(js, /if\(_sdyPalmIgnore\(e\)\) return;/));
ok('손바닥 차단(연필 모드)에서는 draw-surface 가 손가락 팬을 허용한다',
  has(css, /body\.palm-strict \.draw-surface\{touch-action:pan-x pan-y;\}/) &&
  has(js, /togglePalmStrict/));
ok('손바닥 차단 버튼은 터치 기기(폰·태블릿)에서만 주입된다 — 데스크톱 불변',
  has(js, /function sdyPenDevice\(\)/) && has(js, /if\(!sdyPenDevice\(\)\)\{ return; \}/) &&
  has(js, /sdyPenBarReady\(\); \}catch\(_e\)\{\}/));
ok('터치의 빈 종이 드래그는 marquee 대신 화면 이동(스크롤)에 양보한다',
  has(js, /if\(e\.button===0&&e\.pointerType!=='touch'\)\{[\s\S]{0,80}startMarquee\(e,pageIdx\);/));
ok('빈 곳 더블탭 + 끌기 = 영역 선택 (모바일 전용 제스처)',
  has(js, /startMarquee\(\{clientX:g\.x0,clientY:g\.y0\},g\.pi\)/) &&
  has(js, /_sdyDblDragAt/) &&
  has(js, /if\(window\._sdyDblDragAt&&now-window\._sdyDblDragAt<800\)\{ lastT=0; return; \}/));
ok('지우개 판정은 coarse pointer(폰/태블릿)에서만 넓어진다',
  has(js, /_eraserTouchBoost=\(window\.matchMedia&&matchMedia\('\(pointer:coarse\)'\)\.matches\)\?1\.7:1/) &&
  has(js, /return \(drawSize\*ERASER_MULT\*_eraserTouchBoost\)\/2;/));
ok('세로 폰 도구막대는 전체 노출(4줄)이 아니라 꼭 필요한 것만 두 줄이다',
  has(mobileSource, /orientation:portrait/) &&
  has(mobileSource, /\.editor-toolbar\{[\s\S]{0,120}flex-wrap:wrap!important/) &&
  has(mobileSource, /\.editor-toolbar \.tb-hide-ph\{display:none!important;\}/) &&
  has(mobileSource, /\.editor-toolbar \.tb-mid\{[\s\S]{0,260}flex:1 1 100%;min-width:100%/) &&
  has(mobileSource, /\.editor-toolbar \.tb-mid \.tool-btn\{[\s\S]{0,140}width:34px!important/) &&
  !/\.editor-toolbar \.tb-hide-sm\{display:inline-flex!important;\}/.test(css));
ok('세로 폰 그리기 도구막대도 전체 노출 줄바꿈이며 굵기 점 터치 영역이 넓다',
  has(mobileSource, /\.draw-toolbar\{[\s\S]{0,420}flex-wrap:wrap/) &&
  has(mobileSource, /\.draw-toolbar \.size-opt\{padding:11px;box-sizing:content-box;background-clip:content-box;\}/));
ok('그리기 도구막대가 열리면 본문 하단 여백이 늘어난다',
  has(mobileSource, /\.editor:has\(#drawToolbar\[style\*="flex"\]\) \.editor-body\{[\s\S]{0,120}padding-bottom/));
ok('10c-mobile-touch 파트가 MANIFEST 에 들어 있어 번들에 포함된다',
  fs.readFileSync(new URL('../src/app/MANIFEST.txt', import.meta.url), 'utf8').includes('10c-mobile-touch.js') &&
  has(js, /APP-PART:10c-mobile-touch\.js:BEGIN/));

/* ── 4c. 14.69 · 세로 폰 도구막대에 '실제로' 무엇이 남는지 계산 ─────────
   CSS 를 구문 분석해 390×844 세로 폰(coarse·hover:none)에 걸리는 @media 만
   고른 뒤, 그 안의 display:none 을 HTML 도구막대에 들이대어 '보이는 도구'를
   직접 센다. 눈대중이 아니라 실제로 남는 버튼 목록을 계약으로 못 박는다. ── */
console.log('\n[4c] 14.69 세로 폰 도구막대 — 남는 도구와 서랍으로 옮긴 도구');
{
  const { JSDOM } = jsdom;
  const doc = new JSDOM(html).window.document;
  const PHONE = { width: 390, height: 840, orientation: 'portrait', pointer: 'coarse', hover: 'none', motion: 'no-preference' };

  const evalCond = (txt) => {
    const m = /^\(\s*([a-z-]+)\s*(?::\s*([^)]+?)\s*)?\)$/.exec(txt.trim());
    if (!m) throw new Error('해석 못 하는 미디어 조건: ' + txt);
    const feat = m[1], val = m[2] === undefined ? null : m[2].trim();
    const px = (v) => { const n = /^(\d+(?:\.\d+)?)px$/.exec(v || ''); if (!n) throw new Error('px 아님: ' + v); return +n[1]; };
    switch (feat) {
      case 'min-width': return PHONE.width >= px(val);
      case 'max-width': return PHONE.width <= px(val);
      case 'min-height': return PHONE.height >= px(val);
      case 'max-height': return PHONE.height <= px(val);
      case 'orientation': return PHONE.orientation === val;
      case 'pointer': return PHONE.pointer === val;
      case 'hover': return PHONE.hover === val;
      case 'prefers-reduced-motion': return PHONE.motion === val;
      default: throw new Error('모르는 미디어 기능: ' + feat);
    }
  };
  const evalQuery = (q) => q.split(/\s*,\s*/).some((part) => part.split(/\s+and\s+/).every(evalCond));

  // display:none 을 만드는 선택자 — 항상 적용(미디어 없음) + 이 폰에 걸리는 미디어 안
  const hidden = [];
  const grabRules = (block) => {
    for (const node of block.children) {
      if (node.type !== 'Rule') continue;
      const sel = csstree.generate(node.prelude);
      for (const d of node.block.children) {
        if (d.type === 'Declaration' && d.property === 'display' && csstree.generate(d.value) === 'none') hidden.push(sel);
      }
    }
  };
  const walk = (block, insideMatchingMedia) => {
    for (const node of block.children) {
      if (node.type === 'Atrule' && node.name === 'media') {
        const match = insideMatchingMedia && evalQuery(csstree.generate(node.prelude));
        if (match) grabRules(node.block);
        walk(node.block, match);
      } else if (node.type === 'Atrule' && node.block) {
        walk(node.block, insideMatchingMedia);
      } else if (node.type === 'Rule' && insideMatchingMedia) {
        // 미디어 없는 최상위 규칙은 항상 적용된다
      }
    }
  };
  grabRules(ast);            // 최상위(미디어 밖) 규칙
  walk(ast, true);           // 걸리는 미디어쿼리 안 규칙

  const selHits = (el) => hidden.some((sel) => { try { return el.matches(sel); } catch { return false; } });
  const isHidden = (el) => { for (let n = el; n && n.classList && !n.classList.contains('editor-toolbar'); n = n.parentElement) if (selHits(n)) return true; return false; };

  const toolbar = doc.querySelector('.editor-toolbar');
  const label = (el) => el.getAttribute('title') || el.getAttribute('aria-label') || el.id || el.className;
  const shown = [...toolbar.querySelectorAll('button,input')]
    .filter((el) => !el.closest('.font-menu') && !el.closest('.color-popover') && !isHidden(el))
    .map(label);

  ok('세로 폰 도구막대에 남는 도구는 딱 이 목록이다 (15개)',
    shown.length === 15 && [
      '노트 제목',
      '텍스트 상자', '사진 추가', '펜 쓰기 / 종료', '형광펜 쓰기 / 종료',
      '굵게', '기울임', '밑줄',
      '글자 색 적용', '글자 색 선택', '형광펜 적용', '형광펜 색 선택',
      '되돌리기', '다시 실행', '도구 더보기 · 노트 설정',
    ].every((t) => shown.includes(t)),
    '실제: ' + shown.join(' | '));
  ok('글꼴·글자크기·취소선·정렬·스티커·표·수식·페인트·주요어·찾기·내보내기·쪽이동은 세로 폰 툴바에서 빠진다',
    ['#fontBtn', '#fsInput', '#stkBtn', '#paintBtn', '#wfBtn', '#findBtn'].every((id) => isHidden(doc.querySelector(id))) &&
    ['tb-bold', 'tb-italic'].every((c) => !isHidden(doc.querySelector('.' + c))) &&
    [...toolbar.querySelectorAll('button')].filter((b) => /setAlign\(/.test(b.getAttribute('onclick') || '')).every(isHidden) &&
    [...toolbar.querySelectorAll('button')].filter((b) => /chFS\(/.test(b.getAttribute('onclick') || '')).every(isHidden) &&
    isHidden(toolbar.querySelector('.pg-nav')) &&
    isHidden([...toolbar.querySelectorAll('button')].find((b) => /openExportModal\(/.test(b.getAttribute('onclick') || ''))));

  const sheet = doc.getElementById('moreSheet').innerHTML;
  ok('툴바에서 뺀 도구는 전부 더보기 서랍에서 부를 수 있다',
    ['toggleFontMenu()', 'phFs(-2)', 'phFs(2)', "execFmt('strike')", "setAlign('left')", "setAlign('center')",
     "setAlign('right')", 'openStickers()', 'togglePaint()', 'toggleFind()', 'openTableModal()',
     'openLatexModal()', 'openExportModal()', "openPanel('pages')", "openPanel('words')"]
      .every((call) => sheet.includes(call)),
    ['toggleFontMenu()', 'phFs(-2)', "execFmt('strike')", "setAlign('center')", 'openStickers()',
     'togglePaint()', 'toggleFind()', 'openTableModal()', 'openLatexModal()', 'openExportModal()',
     "openPanel('pages')", "openPanel('words')"].filter((c) => !sheet.includes(c)).join(', '));
  ok("서랍의 폰 전용 '도구' 칸은 세로 폰에서만 렌더된다",
    /\.more-tabs button\[data-mt="tools"\]\{display:none;\}/.test(css) &&
    /\.more-sec\[data-ms="tools"\]\{display:none;\}/.test(css) &&
    has(mobileSource, /\.more-tabs button\[data-mt="tools"\]\{display:inline-flex;\}/) &&
    has(mobileSource, /\.more-sec\[data-ms="tools"\]:not\(\[hidden\]\)\{display:block;\}/) &&
    !!doc.querySelector('#moreSheet .more-tabs button[data-mt="tools"]') &&
    !!doc.querySelector('#moreSheet .more-sec[data-ms="tools"]'));
}

/* ── 4d. 14.69 · 터치 선택은 '손을 떼야' 확정 (스크롤·핀치 방해 금지) ── */
console.log('\n[4d] 14.69 터치 선택 타이밍');
ok('터치의 요소 선택은 onPaperDown 앞에서 10c 게이트로 미뤄진다',
  has(js, /if\(typeof _sdyTapHoldSelect==='function'&&_sdyTapHoldSelect\(e,pageIdx\)\) return;/) &&
  has(js, /function _sdyTapHoldSelect\(e,pageIdx\)\{/));
ok('게이트는 터치에서만 열린다 — 마우스·펜(데스크톱)은 즉시 선택 그대로',
  has(js, /if\(!e\|\|e\.pointerType!=='touch'\) return false;/));
ok('끌기 손잡이·편집 중인 상자·표 조작점은 미루지 않는다(끌기가 살아야 한다)',
  has(js, /\.handle,\.tb-edge,\.tb-move,\.el-del,\.tbl-box,\.tbl-edge,\.tbl-div,\.tbl-h,\.tbl-stretch/) &&
  has(js, /if\(host\.classList\.contains\('edit'\)\) return false;/));
ok('스크롤(12px)·두 번째 손가락·pointercancel 이면 미뤄 둔 선택을 버린다',
  has(js, /const _TAP_SLOP=12;/) && has(js, /_tapSel=null; _tapSelMulti=true;/) &&
  has(js, /addEventListener\('pointercancel',e=>\{ if\(!e\|\|e\.pointerType==='touch'\) _tapSel=null; \}/));
ok('손을 떼면 onPaperDown 을 다시 돌려 확정하고 남은 끌기를 정리한다',
  has(js, /onPaperDown\(j\.e,j\.pi\);/) &&
  has(js, /if\(typeof finishEditorPointer==='function'\) finishEditorPointer\(\);/));
ok('touchend 가 없는 재생 포인터(읽기 쪽 첫 탭)는 pointerup 에서 확정한다',
  has(js, /addEventListener\('pointerup',e=>\{\s*if\(!e\|\|e\.pointerType!=='touch'\|\|_touchActive\) return;/) &&
  has(js, /if\(_tapSel&&!_tapSel\.touch\) _tapSelCommit\(\);/));

/* ── 5. 창/모달/부가 기능 ──────────────────────────────────── */
console.log('\n[5] 모달·보관함·암기카드·발표');
ok('일반 모달은 safe-area를 지키는 하단 시트다',
  has(mobileSource, /\.modal-bg\{[\s\S]{0,160}align-items:flex-end/) &&
  has(mobileSource, /\.modal-box:not\(\.cards-box\)\{[\s\S]{0,220}--sdy-mobile-vh/));
ok('모달 입력/선택은 44px 이상이다',
  has(mobileSource, /\.modal-box select,\.modal-box textarea\{min-height:44px/));
ok('새 노트 프리셋은 폰에서 2열이다',
  has(mobileSource, /#sizePresetGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/));
ok('보관함은 내부 목록만 스크롤하고 툴바는 44px이다',
  has(mobileSource, /\.vault-up,\.vault-tool\{min-width:44px;height:44px/) &&
  has(mobileSource, /\.vault-desk\{flex:1;min-height:180px;max-height:none/));
ok('암기카드 창은 저장된 드래그 좌표를 무시하고 화면 안에 고정된다',
  has(mobileSource, /\.fcard-win,\.fcard-win\.moved\{[\s\S]{0,180}top:auto!important[\s\S]{0,120}transform:none!important/));
ok('발표 화면과 이미지 뷰어도 동적 viewport 안에 맞춘다',
  has(mobileSource, /\.present\{height:var\(--sdy-mobile-vh/) &&
  has(mobileSource, /#viewer img\{max-width:100%!important;max-height:100%!important/));
ok('컨텍스트/곡 메뉴는 길어져도 하단 시트 안에서 스크롤된다',
  has(mobileSource, /\.ctx-menu\.show,\.mpctx\.show,\.pl-mini\{/) &&
  has(mobileSource, /max-height:min\(68dvh,560px\)!important;[\s\S]{0,100}overflow-y:auto/));

/* ── 6. 음악·채팅·집중시계 ─────────────────────────────────── */
console.log('\n[6] 음악·엽스코드·집중시계');
ok('음악바 버튼이 40px, 재생 버튼이 42px이다',
  has(mobileSource, /\.mp-btns button,#mpX\{[\s\S]{0,100}width:40px!important/) &&
  has(mobileSource, /\.mp-btns \.mp-pp\{width:42px!important;height:42px!important/));
ok('음악 목록과 큰 플레이어는 safe-area 하단 시트다',
  has(mobileSource, /\.mp-list\{[\s\S]{0,200}bottom:0!important[\s\S]{0,180}var\(--ph-safe\)/) &&
  has(mobileSource, /\.mpb\{[\s\S]{0,220}--sdy-mobile-vh/));
ok('음악 편집/추가 창과 컨트롤도 모바일 크기를 가진다',
  has(mobileSource, /\.mp-tagm \.[a-z]*box|\.mp-tagm \.box/) &&
  has(mobileSource, /\.mp-addpop\{[\s\S]{0,200}--sdy-mobile-vh/));
ok('음악/채팅 접기 칩은 46px이고 서로 동적으로 쌓인다',
  has(mobileSource, /#mpReopen,#ypReopen\{[^}]*width:46px;height:46px/) &&
  has(mobileSource, /body\.has-mpbar\{--ph-stack:72px/) &&
  has(js, /classList\.toggle\('has-mpbar'/));
ok('엽스코드 창은 viewport 안에 있고 헤더/음성/입력이 40px 이상이다',
  has(mobileSource, /#ypApp\{[\s\S]{0,420}--sdy-mobile-vh/) &&
  has(mobileSource, /#ypApp #ypHead button[^\{]*\{width:40px;height:40px/) &&
  has(mobileSource, /\.ypv-join,\.ypv-mute,\.ypv-icon,\.ypv-gear\{width:40px;height:40px/));
ok('채팅 입력은 iOS 확대 없는 16px이고 이모지는 6열이다',
  has(mobileSource, /\.yp-input textarea\{min-height:42px;font-size:16px!important/) &&
  has(mobileSource, /\.yp-emoji\{[^}]*grid-template-columns:repeat\(6,1fr\)/));
ok('집중시계 모드/버튼/링이 작은 화면 안에 맞는다',
  has(mobileSource, /#focusClock\{[\s\S]{0,120}--sdy-mobile-vh/) &&
  has(mobileSource, /#focusClock \.fc-modes button\{min-height:42px/) &&
  has(mobileSource, /\.fc-ring\{width:min\(42dvh,82vw,330px\)/));

/* ── 7. 모든 주요 기능 root가 HTML과 모바일 계약에 남아 있는가 ── */
console.log('\n[7] 주요 기능 표면 누락 방지');
const roots = [
  'mainView','noteGrid','editorView','moreSheet','selectBar',
  'setModal','trashModal','createModal','vaultModal','adminModal','folderStyleModal',
  'keyModal','delModal','pwModal','exportModal','importProg','infoModal','stickerModal',
  'latexModal','cardsModal','srvPop','notifPop','findBar','tblBar','pinPop','presentView',
  'cpModal','musicPlayer','musicListPop','mpBig','mpTagModal','mpAddPop','focusClock',
  'sdyAuthWrap','ypGate','ypApp'
];
const missingRoots = roots.filter(id => !new RegExp(`id=["']${id}["']`).test(html));
ok(`주요 기능 root ${roots.length}개가 모두 HTML에 있다`, missingRoots.length === 0, missingRoots.join(', '));
const surfaceTokens = [
  '#mainView', '.note-grid', '.editor-toolbar', '.more-panel', '.select-bar',
  '.modal-bg', '.modal-box', '#vaultModal', '.fcard-win', '.notif-pop', '.srv-pop',
  '.find-bar', '.tbl-bar', '.pin-pop', '.present', '.mp-list', '.mpb', '.mp-tagm',
  '.mp-addpop', '#focusClock', '.sa-card', '.ypg-card', '#ypApp'
];
const missingTokens = surfaceTokens.filter(s => !mobileSource.includes(s));
ok(`모바일 최종 블록이 기능 표면 ${surfaceTokens.length}종을 모두 다룬다`, missingTokens.length === 0, missingTokens.join(', '));
// 14.13.4 · 떠 있던 서식 막대(fmtBar)는 상단 바와 중복이라 없앴다 — 의도적 제거를 잠근다.
ok('14.13.4 fmtBar(떠 있는 서식 막대)가 HTML에서 제거됐다', !/id=["']fmtBar["']/.test(html));
ok('14.13.4 글자 크기/형광펜이 상단 바(.editor-toolbar) 안에 있다',
  // 14.18.1 · 툴바 크기칸은 '글자를 입력할 때마다'가 아니라 Enter/포커스
  // 이탈(change)로 크기를 확정하는 UI 로 바뀌었다. 예전 oninput-setFS 계약은
  // 이제 실제 동작과 어긋나므로(키 입력 중간값이 서식에 반영됨) onchange 로 고친다.
  has(html, /class="tb-group fmt-group"/) &&
  has(html, /id="fsInput"[^>]*onchange="[^"]*setFS/) &&
  has(html, /id="hlWrap"/));

/* ── 8. 회전/리사이즈/데스크톱 보존 ───────────────────────── */
console.log('\n[8] 회전과 데스크톱 홈 복원');
ok('PC/폰 홈은 노트 스택으로 렌더하고, 폴더 안/검색/선택 모드에서만 평범한 격자를 쓴다',
  has(js, /17\.2 · 홈 스택[\s\S]{0,400}const isHomeStack=!curFolder && !searchQuery && !selectMode;/) &&
  has(js, /if\(!searchQuery&&!isHomeStack\)\{[\s\S]{0,100}childFolders\(curFolder\)/) &&
  has(js, /filtered\.forEach\(nb=>\{ g\.appendChild\(_makeCard\(nb\)\); \}\)/));
ok('기본 PC note-grid의 중앙 정렬·줄바꿈 규칙을 유지한다',
  has(css, /\.note-grid\{\s*display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;/));
ok('JS 모바일 판별은 세로 폭 + 가로 coarse pointer를 함께 쓴다',
  has(js, /PHONE_QUERY='\(max-width:640px\), \(max-height:560px\) and \(pointer:coarse\)'/));
ok('폰에서 엽스코드의 드래그 인라인 좌표를 지운다',
  has(js, /if\(PHONE\(\)\)\{[\s\S]{0,160}app\.style\.left='';app\.style\.top=''/));
ok('resize와 orientationchange 모두 재배치한다',
  has(js, /addEventListener\('resize',tick/) && has(js, /addEventListener\('orientationchange'/));
/* 14.13.8 · 예전 이 계약은 innerWidth(화면 px) 으로 미리 자르는 코드를 요구했다.
   창 폭·높이는 UI CSS px 라 90% 배율에서 오른쪽 10% 가 후보에서 사라졌다 —
   '화면 안으로만 clamp' 의 옳은 형태는 공용 경계 함수(실측 기반)에만 판정을 맡기는 것. */
ok('PC에서는 드래그 좌표를 보존하고 공용 경계 함수로만 clamp한다',
  has(js, /else if\(app\.classList\.contains\('open'\)\)[\s\S]{0,420}sdyClampFloatingRect\(app,/) &&
  !has(js, /else if\(app\.classList\.contains\('open'\)\)[\s\S]{0,420}Math\.min\(innerWidth-/));
ok('모바일 최종 소스에 데스크톱 min-width 규칙이 없다', !/min-width:\s*641px/.test(mobileSource));

console.log(`\n모바일 레이아웃 계약: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
