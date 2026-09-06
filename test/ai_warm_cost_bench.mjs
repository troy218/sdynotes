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
  check('노트 글은 쪽 단위로 캐시한다 (_aiPageText)',
    /_aiPageText/.test(js) && /_aiTextSeq/.test(js));
  check('문서를 저장할 때 글 캐시를 무효화한다',
    /bumpAiText\(\)/.test(js) && js.indexOf('bumpAiText()') > js.indexOf('function saveDoc'));
  check('버튼 ready 칠하기는 곧바로 돌지 않고 한 번으로 합친다',
    /paintOutlineReadyNow/.test(js) && /if\(paintTimer\) return;/.test(js));

  // ── 20.2 · 남은 '첫 1회' 비용을 잘게 쪼갰는가 ──
  check('20.2: 고친 쪽 하나만 캐시에서 버린다 (전체를 버리지 않는다)',
    /function aiInvalidatePage/.test(js)
    && /aiInvalidatePage\(pi\)/.test(js.slice(js.indexOf('function markPageEdited'), js.indexOf('function markPageEdited') + 700)));
  check('20.2: 문서 글을 한가할 때 몇 쪽씩 나눠 채운다 (aiFillDocText)',
    /function aiFillDocText/.test(js) && /requestIdleCallback/.test(js.slice(js.indexOf('function aiFillDocText'), js.indexOf('function aiFillDocText') + 1600)));
  check('20.2: 채우기는 보고 있는 쪽에서 바깥으로 퍼진다',
    /cur-r,cur\+r/.test(js));
  check('20.2: 한 번에 무한정 돌지 않는다 (프레임 예산 · 쪽 수 상한)',
    /did>=4\|\|left<3/.test(js));
  check('20.2: 노트가 바뀌면 채우기를 중단한다 (토큰 · owner)',
    /tok!==_aiFillTok/.test(js) && /_aiOwner\(\)!==owner/.test(js));
  check('20.2: 준비 안 됐으면 null 을 주는 길이 있다 (textIfReady)',
    /textIfReady/.test(js) && /function noteTextIfReady/.test(js));
  check('20.2: warm 은 textIfReady 를 쓴다 (억지로 다 뽑지 않는다)',
    /noteTextIfReady\(sc\)/.test(js));
  check('20.2: 버튼 표시도 textIfReady 를 쓴다',
    /noteTextIfReady\(it\[1\]\)/.test(js));
  check('20.2: 준비가 덜 됐으면 다음 기회에 다시 본다',
    /if\(again\) scheduleWarm/.test(js));
  check('20.2: 노트를 열면 배경 채우기를 시작한다',
    /__sdyAiFillText/.test(js));
  // 사용자가 실제로 버튼을 눌렀을 때는 기다려서라도 전부 준다
  check('20.2: 실제 질문 경로(noteText)는 여전히 문서 전체를 준다',
    /function noteText\(scope\)/.test(js)
    && /b\.text\(/.test(js.slice(js.indexOf('window.__sdyAiBridge={'), js.indexOf('window.__sdyAiBridge={') + 400))
       || /__sdyAiBridge\.text\(/.test(js));
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

// ── ③ 20.2 · 첫 1회 비용을 잘게 쪼갰는지 실측 ─────────────────────────────
// 남아 있던 문제: 노트를 연 직후 '문서 전체 글'을 한 번에 만들면 그 한 방이
// 그대로 긴 멈춤이 된다. 쪽 단위로 나눠 한가할 때만 채우면, 총합은 같아도
// '한 번에 멎는 시간'이 프레임 예산 안으로 들어온다.
{
  const pages = mkPages();
  const cache = new Array(pages.length).fill(null);
  const pageText = (i) => {
    if (cache[i] != null) return cache[i];
    return (cache[i] = collectNew(pages[i]).filter(Boolean).join('\n'));
  };

  // (a) 예전처럼 한 방에
  const bulkPages = mkPages();
  const bulkMs = timeIt(() => bulkPages.map((p) => collectNew(p).filter(Boolean).join('\n')).join('\n'));

  // (b) 20.2 처럼 쪽씩 (한 슬라이스 = 최대 4쪽)
  const SLICE = 4;
  const sliceMs = [];
  for (let i = 0; i < pages.length; i += SLICE)
    sliceMs.push(timeIt(() => { for (let k = i; k < Math.min(pages.length, i + SLICE); k++) pageText(k); }));
  const worstSlice = Math.max(...sliceMs);
  const totalSlice = sliceMs.reduce((a, b) => a + b, 0);

  console.log(`    · [20.2] 한 방에: ${bulkMs}ms (이만큼 화면이 멎었다)`);
  console.log(`    · [20.2] 쪽씩 ${SLICE}장: 조각 ${sliceMs.length}개 · 최악 조각 ${worstSlice}ms · 합계 ${totalSlice}ms`);

  check(`한 번에 멎는 시간이 크게 줄었다 (한 방 ${bulkMs}ms → 최악 조각 ${worstSlice}ms)`,
    worstSlice * 4 < bulkMs || worstSlice <= 50, `bulk=${bulkMs}ms worst=${worstSlice}ms`);
  check('쪽씩 채워도 결과는 한 방과 똑같다',
    pages.map((p, i) => pageText(i)).join('\n') === bulkPages.map((p) => collectNew(p).filter(Boolean).join('\n')).join('\n'));

  // 이미 채운 뒤 전체 글을 다시 달라고 해도 공짜다 (버튼 눌렀을 때)
  const reuseMs = timeIt(() => { for (let f = 0; f < 20; f++) pages.map((p, i) => pageText(i)).join('\n'); });
  check(`다 채운 뒤 전체 글 20번 재조립이 거의 공짜다 (${reuseMs}ms)`, reuseMs < 100, `${reuseMs}ms`);

  // 한 쪽만 고치면 그 쪽만 다시
  cache[7] = null;
  const oneMs = timeIt(() => pageText(7));
  check(`한 쪽만 고치면 그 쪽만 다시 뽑는다 (${oneMs}ms)`, oneMs * 8 < bulkMs || oneMs <= 40, `${oneMs}ms vs bulk ${bulkMs}ms`);
}

console.log(`\n해돌이 준비 비용 벤치: PASS ${pass}${fail ? ' / FAIL ' + fail : ''}`);
assert.equal(fail, 0);
