/* 14.38 · '마지막으로 보던 쪽'에서 가져온 문서를 다시 열 때 슬라이스가
 *        제 자리에 붙는지 지키는 소스 계약.
 *
 * 재현하던 사고 (사용자 보고 — 논문 열람):
 *   열고 → 아래로 스크롤 → 위로가기 → 다시 열기(또는 빠르게 열고 스크롤)를
 *   반복하면 쪽들이 서로 뒤섞였다. 마지막으로 본 쪽의 슬라이스를 먼저 받아
 *   온 뒤 **문서 맨 앞 자리**에 놓아
 *     · 앞쪽 쪽이 뒤쪽 쪽 내용으로 열리고
 *     · 같은 슬라이스가 반쯤 lazy인 채 loadBatch 되면 id 보강 병합(concat)이
 *       다른 쪽의 글상자를 이어 붙여 두 쪽이 한 종이에 겹쳐지며
 *     · 그 상태로 저장(POST)되어 서버 보관본이 영구히 섞였다.
 *
 * 여기서는
 *   ① loadDocAsync fast path 가 받아 온 슬라이스를 firstSlice+k 자리에 놓고
 *   ② 문서 앞자리에 통째로 놓는 옛 코드가 없으며
 *   ③ loadBatch 의 id 보강 병합이 '같은 쪽 신원(id)'일 때만 일어나고,
 *     신원이 다르면 서버 본문으로 교체하며
 *   ④ 저장(flushImportedSave)은 여전히 쪽 인덱스 → 슬라이스 시작(from) 정렬로
 *      자기 범위의 쪽만 보내는지
 * 를 확인한다. 실행 기반 회귀는 import_reopen_align_runtime.mjs 가 담당한다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

// ① fast path: 받아 온 슬라이스를 제 자리(firstSlice+k)에 놓는다
const fast = js.slice(js.indexOf('async function loadDocAsync'), js.indexOf('async function ensureLazyPage'));
assert.ok(fast.length > 200, 'loadDocAsync 소스를 찾지 못했다');
assert.match(fast, /dd\.pages\.forEach\(\(p,k\)=>\{[^}]{0,120}const i=firstSlice\+k;/,
  'first slice must be placed at its true offset (firstSlice+k), not at the front');
assert.match(fast, /const i=firstSlice\+k;\s*if\(i<total\) pages\[i\]=p;/,
  'fetched pages must be assigned into pages[firstSlice+k]');
assert.doesNotMatch(fast, /const pages=dd\.pages\.slice\(\);\s*for\(let i=pages\.length/,
  'the old "drop fetched slice at index 0" placement must be gone');
assert.match(fast, /for\(let i=0;i<total;i\+\+\)\s*pages\.push\(\{id:'lazy_'\+i/,
  'unfetched positions must become lazy_N stubs so scroll can fetch them');

// ② loadBatch 병합: 쪽 신원(id)이 다르면 concat 하지 않고 교체한다
const lb = js.slice(js.indexOf('async function loadBatch'), js.indexOf('function prefetchBatch'));
assert.ok(lb.length > 200, 'loadBatch 소스를 찾지 못했다');
assert.match(lb, /if\(cur\.id&&p\.id&&cur\.id!==p\.id\)\{ d\.pages\[i\]=p; return; \}/,
  'a page whose identity differs from the server copy must be replaced, never concatenated');
assert.match(lb, /const extra=\(p\.els\|\|\[\]\)\.filter\(e=>e&&e\.id&&!have\.has\(e\.id\)\);\s*if\(extra\.length\) cur\.els=\(cur\.els\|\|\[\]\)\.concat\(extra\);/,
  'same-page id-complement merge must keep working (translations must not be wiped)');
// 교체 가드는 반드시 concat 보다 앞에 있다
assert.ok(lb.indexOf('cur.id&&p.id&&cur.id!==p.id') < lb.indexOf('cur.els=(cur.els||[]).concat(extra)'),
  'identity guard must run before the concat merge');

// ③ 저장은 자기 범위의 쪽만 from 시작 정렬로 보낸다
const fis = js.slice(js.indexOf('async function flushImportedSave'), js.indexOf('function persistDoc'));
assert.match(fis, /slices\.add\(Math\.floor\(i\/LAZY_SLICE\)\*LAZY_SLICE\)/,
  'dirty pages must map to their own slice start');
assert.match(fis, /for\(let i=s0;i<Math\.min\(n,s0\+LAZY_SLICE\);i\+\+\)/,
  'posted chunk must be built from the slice range in document order');

console.log('Import-reopen alignment contract: slices land at their true offset; foreign pages are replaced, never concatenated.');
