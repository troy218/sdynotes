/* 14.14 · 빈 노트 회귀 방지 계약
 *  1) renderPages 끝에서 ensureVisiblePagesRendered 를 호출해
 *     IntersectionObserver 없이도 첫 페이지가 그려진다
 *  2) applyPagesOp 이 페이지 id 불일치 시 기존 본문을 버리지 않는다
 *  3) flushSaveDoc 이 로컬에 본문이 있는데 doc 이 비어 있으면 저장을 건너뛴다
 *  4) initSync / openNB 가 노트 전환 경쟁을 막는다
 *  5) pullSync 는 노트 신원 가드 + pages 우선 적용을 유지한다
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(path.join(root, 'sdynotes.js'), 'utf8');

const pass = [];
const ok = (name, cond) => {
  assert.ok(cond, name);
  pass.push(name);
  console.log('  ✓ ' + name);
};

// ── 0. _renderVersion NaN 회귀 (빈 노트 본원인) ─────────────────
const rpSrc = js.slice(js.indexOf('function renderPages'), js.indexOf('function ensureVisiblePagesRendered'));
ok('renderPages 가 _renderVersion 을 |0 으로 숫자 초기화한다',
  /const rv=\(window\._renderVersion\|0\)\+1/.test(rpSrc)
  || /window\._renderVersion\s*=\s*\(window\._renderVersion\|0\)\s*\+\s*1/.test(rpSrc));
ok('renderPages 가 ++window._renderVersion (NaN 함정) 을 쓰지 않는다',
  !/\+\+window\._renderVersion/.test(rpSrc));
ok('buildTextEl 이 innerText 없을 때도 안전하게 plain text 를 읽는다',
  /innerText!=null\s*\?\s*c\.innerText\s*:\s*c\.textContent/.test(js)
  || /String\(\(c\.innerText!=null\?c\.innerText:c\.textContent\)/.test(js));

// ── 1. 강제 페인트 경로 ─────────────────────────────────────────
ok('ensureVisiblePagesRendered 헬퍼가 있다',
  /function ensureVisiblePagesRendered\s*\(/.test(js));
ok('renderPages 끝에서 ensureVisiblePagesRendered 를 호출한다',
  /pageUnloader\.observe\(p\);\s*\}\);\s*try\{\s*ensureVisiblePagesRendered\(\);/.test(js)
  || /ensureVisiblePagesRendered\(\)/.test(js.slice(js.indexOf('function renderPages'), js.indexOf('function ensureVisiblePagesRendered') + 80)));
ok('openNB 가 에디터 open 뒤 강제 페인트를 예약한다',
  /ensureVisiblePagesRendered/.test(js.slice(js.indexOf('async function openNB'), js.indexOf('function closeEditor'))));

// 목록은 본문보다 먼저 mount된다. 뒤늦게 받은 preview data가 카드 생성 당시의
// 빈 문서 클로저를 교체하고, IntersectionObserver가 첫 콜백을 누락해도 paint되어야 한다.
const preloadSrc = js.slice(js.indexOf('async function preloadPreviews'), js.indexOf('function applyServerState'));
ok('미리보기 데이터 로드 뒤 카드 트리를 강제로 다시 만든다',
  (preloadSrc.match(/renderGrid\(true\)/g) || []).length >= 2);
ok('초기 mount에 IntersectionObserver 외 RAF/fallback 미리보기 트리거가 있다',
  /function _schedulePreviewRender\s*\(/.test(js)
  && /requestAnimationFrame\(\(\)=>\{ run\(\); requestAnimationFrame\(run\); \}\)/.test(js)
  && /setTimeout\(run,140\)/.test(js));

// ── 2. applyPagesOp 본문 보존 ───────────────────────────────────
const applySrc = js.slice(js.indexOf('function applyPagesOp'), js.indexOf('function genOps'));
ok('applyPagesOp 이 id 미스 시 index 본문을 살린다',
  /hasBody/.test(applySrc) && /oldPages\[i\]/.test(applySrc));
ok('applyPagesOp 이 빈 {id,els:[]} 로 무조건 교체하지 않는다',
  !/doc\.pages=ids\.map\(id=>byId\[id\]\|\|\{id,els:\[\],tables:\[\]\}\);/.test(applySrc));

// ── 3. 빈 저장 가드 ─────────────────────────────────────────────
// 앞에 빠른 전환 가드가 추가될 수 있으므로 함수 전체를 뽑아 검사한다.
const flushSrc = js.slice(js.indexOf('function flushSaveDoc'), js.indexOf('function getAdminEdits'));
ok('flushSaveDoc 이 로컬 본문 있는 빈 doc 저장을 막는다',
  /본문 복구 중 · 빈 저장 건너뜀/.test(flushSrc) || /locN>0/.test(flushSrc));

// ── 4. 노트 전환 가드 ───────────────────────────────────────────
const openSrc = js.slice(js.indexOf('async function openNB'), js.indexOf('function closeEditor'));
ok('openNB 가 같은 노트 재진입을 건너뛴다',
  /curNB\.id===nb\.id/.test(openSrc));
ok('openNB 전환 시 pushOps/flushSync 를 await 한다',
  /await pushOps\(\)/.test(openSrc) && /await flushSync\(\)/.test(openSrc));

const initSrc = js.slice(js.indexOf('async function initSync'), js.indexOf('async function startSlicePrefill'));
ok('initSync 가 노트 신원을 고정하고 전환 시 중단한다',
  /const _d0=doc, _nb0=curNB\.id/.test(initSrc)
  && /if\(doc!==_d0\|\|!curNB\|\|curNB\.id!==_nb0\) return;/.test(initSrc));

// ── 5. pullSync 기존 가드 유지 ──────────────────────────────────
const pullSrc = js.slice(js.indexOf('async function pullSync'), js.indexOf('function _selectiveRenderPage'));
ok('pullSync 가 fetch 뒤 노트 전환을 차단한다',
  /if\(doc!==_d0\|\|!curNB\|\|curNB\.id!==_nb0\) return \[\];/.test(pullSrc));
ok('pullSync 가 __pages__ 를 요소 op 보다 먼저 적용한다',
  /_pgs\.concat\(ops\.filter/.test(pullSrc) || /id==='__pages__'/.test(pullSrc));

// ── 6. applyPagesOp 동작 단위 시뮬레이션 ────────────────────────
// 실제 함수 본문을 추출해 실행
const m = applySrc.match(/function applyPagesOp\(op\)\{([\s\S]*?)\n    \}/);
assert.ok(m, 'applyPagesOp body extract');
function runApply(docPages, op) {
  const env = { doc: { pages: docPages.map(p => ({ ...p, els: (p.els || []).map(e => ({ ...e })) })) } };
  const fn = new Function('op', `
    const doc = this.doc;
    ${m[1]}
    return doc.pages;
  `);
  return fn.call(env, op);
}

const kept = runApply(
  [{ id: 'local_p1', els: [{ type: 'text', id: 't1', html: '<b>살아라</b>' }] }],
  { rev: 100, ids: ['server_p1'] }
);
ok('id 불일치여도 본문 html 이 유지된다',
  kept.length === 1 && kept[0].els?.[0]?.html === '<b>살아라</b>' && kept[0].id === 'server_p1');

const multi = runApply(
  [
    { id: 'a', els: [{ id: 'tA', html: 'A' }] },
    { id: 'b', els: [{ id: 'tB', html: 'B' }] },
  ],
  { rev: 2, ids: ['x', 'y'] }
);
ok('여러 페이지 id 스왑에도 자리별 본문이 산다',
  multi[0].els[0].html === 'A' && multi[1].els[0].html === 'B');

const exact = runApply(
  [{ id: 'p1', els: [{ id: 't1', html: 'ok' }] }],
  { rev: 3, ids: ['p1'] }
);
ok('id 가 같으면 그대로 매칭된다',
  exact[0].id === 'p1' && exact[0].els[0].html === 'ok');

console.log(`\nPASS ${pass.length}`);
