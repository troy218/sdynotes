/* 20.1 · 해돌이(AI) 준비 경로가 스크롤을 잡아먹지 않는지 재는 벤치.
 *
 * 증상 — 논문(가져온 PDF)을 열면 동작 하나가 10초 넘게 걸리고 스크롤이 멎었다.
 * 원인은 그리는 양이 아니라 **해돌이의 '미리 준비(warm)' 경로가 문서 전체 글을
 * 반복해서 다시 뽑은 것**이었다.
 *
 *   ① #pagesStage 에 붙은 MutationObserver 가 childList+subtree+characterData 라
 *      스크롤로 쪽을 그릴 때마다 (쪽 하나 = 수천 노드) 콜백이 터졌다 → scheduleWarm.
 *   ② warmAll() → noteText('page'), noteText('doc') → __sdyAiBridge.text('doc')
 *      → 문서의 **모든 쪽 × 모든 글상자** 에 collectPageEls().
 *   ③ collectPageEls 는 상자마다 tightTextFromHtml() — innerHTML 파싱 +
 *      querySelectorAll('span') + 정렬. 가져온 PDF 는 상자 하나가 단어 span 수십 개다.
 *   ④ paintOutlineReady() 도 버튼 두 개마다 noteText() 를 또 불렀고, warm 응답·
 *      상태 갱신마다 다시 불렸다.
 *
 * 40쪽 × 34상자 × 14 span = 19,040 span 파싱이 한 번. 그게 스크롤 프레임마다.
 * 실제 논문은 수백 쪽이라 그대로 초 단위 멈춤이 된다.
 *
 * 고친 뒤 — 상자별 글자 캐시(el.__txtSrc) + 문서 글 캐시(_aiTextSeq) 로
 * 문서가 실제로 바뀌기 전까지 두 번 뽑지 않는다.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(REPO, 'sdynotes.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};

// ── ① 소스 계약 — 캐시가 되살아나지 않고 사라지지 않았는가 ───────────────
{
  check('글상자 글자 뽑기 결과를 상자에 캐시한다 (__txtSrc)',
    /__txtSrc/.test(js) && /__txtHtml/.test(js));
  check('캐시 열쇠는 html 이 그대로일 때만 맞는다',
    /el\.__txtHtml===el\.html/.test(js));
  check('캐시 필드는 열거되지 않는다 (저장·동기화 payload 오염 방지)',
    /enumerable:false/.test(js.slice(js.indexOf('__txtSrc') - 600, js.indexOf('__txtSrc') + 900)));
  check('노트 글 전체(text) 에도 캐시가 있다 (_aiTextCache)',
    /_aiTextCache/.test(js) && /_aiTextSeq/.test(js));
  check('문서를 저장할 때 글 캐시를 무효화한다',
    /bumpAiText\(\)/.test(js) && js.indexOf('bumpAiText()') > js.indexOf('function saveDoc'));
  check('버튼 ready 칠하기는 곧바로 돌지 않고 한 번으로 합친다',
    /paintOutlineReadyNow/.test(js) && /if\(paintTimer\) return;/.test(js));
}

// ── ② 실측 — collectPageEls / bridge.text 비용 ───────────────────────────
const PAGES = 40, BOXES = 34, SPANS = 14;
const mkHtml = () => {
  let h = '';
  for (let s = 0; s < SPANS; s++)
    h += `<span data-fs="11" style="position:absolute;left:${s * 26}px;top:0px">단어${s}<i class="zsp"> </i></span>`;
  return h;
};
const mkPages = () => {
  const pages = [];
  for (let i = 0; i < PAGES; i++) {
    const els = [];
    for (let k = 0; k < BOXES; k++)
      els.push({ type: 'text', id: `t${i}_${k}`, x: 40, y: 60 + k * 30, w: 350, h: 52, html: mkHtml(), tight: 1 });
    pages.push({ id: 'p' + i, els });
  }
  return pages;
};

const dom = new JSDOM('<!doctype html><div id="pagesStage"></div>');
global.document = dom.window.document;

// 실제 코드와 같은 방식으로 tight 글상자 글자를 뽑는다.
function tightTextFromHtml(html) {
  const d = document.createElement('div'); d.innerHTML = html || '';
  const sps = Array.from(d.querySelectorAll('span')).filter(s => s.style.left !== '' || s.style.top !== '');
  sps.sort((a, b) => (parseFloat(a.style.top) || 0) - (parseFloat(b.style.top) || 0)
                  || (parseFloat(a.style.left) || 0) - (parseFloat(b.style.left) || 0));
  const lines = []; let cur = []; let last = null;
  sps.forEach(s => {
    const t = (s.textContent || '').trim(); if (!t) return;
    const top = parseFloat(s.style.top) || 0;
    if (last != null && Math.abs(top - last) > 2) { lines.push(cur.join(' ')); cur = []; }
    cur.push(t); last = top;
  });
  if (cur.length) lines.push(cur.join(' '));
  return lines.join(' ');
}

// 고치기 전: 부를 때마다 전부 다시 파싱
const collectOld = (pg) => (pg.els || []).map(el => tightTextFromHtml(el.html).replace(/\s+/g, ' ').trim());
// 고친 뒤: 상자에 붙여 둔 결과를 재사용
const collectNew = (pg) => (pg.els || []).map(el => {
  if (el.__txtSrc != null && el.__txtHtml === el.html) return el.__txtSrc;
  const s = tightTextFromHtml(el.html).replace(/\s+/g, ' ').trim();
  el.__txtHtml = el.html; el.__txtSrc = s;
  return s;
});

const timeIt = (fn) => { const a = Date.now(); fn(); return Date.now() - a; };
const SCROLL_FRAMES = 12;   // 스크롤하며 warm 이 되불리는 횟수

const oldPages = mkPages();
const oldMs = timeIt(() => { for (let f = 0; f < SCROLL_FRAMES; f++) oldPages.forEach(collectOld); });

const newPages = mkPages();
const firstMs = timeIt(() => newPages.forEach(collectNew));
const newMs = timeIt(() => { for (let f = 0; f < SCROLL_FRAMES; f++) newPages.forEach(collectNew); });

console.log(`    · 문서 ${PAGES}쪽 × ${BOXES}상자 × ${SPANS}span = ${PAGES * BOXES * SPANS} span`);
console.log(`    · 고치기 전: 스크롤 ${SCROLL_FRAMES}프레임 동안 문서 전체 재파싱 ${oldMs}ms`);
console.log(`    · 고친 뒤  : 첫 1회 ${firstMs}ms + 이후 ${SCROLL_FRAMES}프레임 ${newMs}ms`);

check('캐시가 붙으면 되부르는 비용이 사라진다 (10배 이상 빠름)',
  newMs * 10 < oldMs || newMs <= 2, `old=${oldMs}ms new=${newMs}ms`);
check('캐시를 써도 뽑아낸 글자는 똑같다',
  JSON.stringify(oldPages.map(collectOld)) === JSON.stringify(newPages.map(collectNew)));

// 글이 바뀌면 그 상자만 다시 뽑는다
newPages[0].els[0].html = mkHtml() + '<span style="left:0px;top:40px">추가</span>';
check('글이 바뀐 상자는 캐시를 무시하고 다시 뽑는다',
  /추가/.test(collectNew(newPages[0])[0]));

console.log(`\n해돌이 준비 비용 벤치: PASS ${pass}${fail ? ' / FAIL ' + fail : ''}`);
assert.equal(fail, 0);
