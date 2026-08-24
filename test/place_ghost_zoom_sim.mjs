/* 그림·수식 배치 고스트(미리보기)의 화면 위치와 commitPlaceAt 이 만드는 실제 요소의
   화면 위치가 html{zoom:.9} + 종이 확대 상태에서 픽셀 단위로 일치하는지 검증한다.
   (텍스트·표용 editor_place_runtime.mjs 와 달리 외부 의존성 없이 바로 돌린다)

   실제 sdynotes.js 에서 함수 본문을 뽑아(eval) 쓰므로 오타·단위 착오를 잡는다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const grab = (name) => {
  const m = js.match(new RegExp('function ' + name + '\\([^)]*\\)\\{', ''));
  assert.ok(m, name + ' 본문을 찾지 못함');
  let j = js.indexOf('{', m.index), d = 0;
  for (let k = j; k < js.length; k++) { if (js[k] === '{') d++; else if (js[k] === '}') { d--; if (!d) return js.slice(m.index, k + 1); } }
  throw new Error(name + ' 끝을 찾지 못함');
};

// ── 가짜 환경: 데스크톱 조건(html zoom 0.9) + 종이 150% 확대 ──────
const K = 0.9, PSCALE = 1.5, DOC = { w: 794, h: 1123 };
const RECT = { left: 140, top: 60, width: DOC.w * PSCALE * K, height: DOC.h * PSCALE * K };
const paper = { getBoundingClientRect: () => RECT, dataset: { pageIdx: '0' }, closest: () => paper };

const sandbox = [
  grab('clampEl'), grab('pageLocal'), grab('pageScreenScale'),
  // uiCssZoom 의 실제 구현은 100px 프로브를 재는데, 이 환경에선 K 를 돌려주는 것과 같다
  'function uiCssZoom(){ return ' + K + '; }',
  grab('uiPageScale'),
  'var paperSize=()=>({w:' + DOC.w + ',h:' + DOC.h + '});',
  'var paperAt=()=>paper;',
  'var pageScale=' + PSCALE + ';',
  'var curPageIdx=0;',
  'var document={ elementFromPoint: () => paper };',
].join('\n');

let pass = 0;
for (const [cx, cy] of [[300, 200], [900, 900], [500, 500]]) {
  const g = { style: {}, dataset: {}, querySelector: () => null };
  const fn = new Function('paper', 'g', sandbox + `
    const placeMode={kind:'latex', w:400, h:82};
    ${grab('movePlaceGhost').replace("const g=document.getElementById('placeGhost');", '')}
    movePlaceGhost(${cx}, ${cy});
    return { left: parseFloat(g.style.left), top: parseFloat(g.style.top),
             pageLocal, clampEl };
  `);
  const r = fn(paper, g);
  // 요소가 실제로 놓일 문서 좌표 (commitPlaceAt 수식 분기의 계산과 동일)
  const local = r.pageLocal({ clientX: cx, clientY: cy }, 0);
  const o = r.clampEl(local.x - 400 / 2, local.y - 82 / 2, 400, 82);
  // 종이 안 요소의 화면상 위치(화면 px)
  const elScreenLeft = RECT.left + o.x * (RECT.width / DOC.w);
  const elScreenTop = RECT.top + o.y * (RECT.height / DOC.h);
  // 고스트(style 은 fixed CSS px)의 화면상 위치 = CSS px × 사이트 zoom
  const ghostScreenLeft = r.left * K, ghostScreenTop = r.top * K;
  assert.ok(Math.abs(elScreenLeft - ghostScreenLeft) < 1.5,
    `x 불일치: 요소 ${elScreenLeft.toFixed(1)} vs 고스트 ${ghostScreenLeft.toFixed(1)}`);
  assert.ok(Math.abs(elScreenTop - ghostScreenTop) < 1.5,
    `y 불일치: 요소 ${elScreenTop.toFixed(1)} vs 고스트 ${ghostScreenTop.toFixed(1)}`);
  // 그리고 그 지점이 커서 바로 아래(중심)인지 확인
  assert.ok(Math.abs(elScreenLeft + (400 * PSCALE * K) / 2 - cx) < 2, 'x가 커서 중심에서 벗어남');
  assert.ok(Math.abs(elScreenTop + (82 * PSCALE * K) / 2 - cy) < 2, 'y가 커서 중심에서 벗어남');
  pass++;
  console.log(`  ✓ 커서(${cx},${cy}) — 고스트 = 만들어질 요소 = 커서 중심`);
}
console.log(`PASS (${pass}) — 배율과 무관하게 그림·수식이 누른 자리에 놓인다`);
