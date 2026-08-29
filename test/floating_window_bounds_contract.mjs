import fs from 'node:fs';
import assert from 'node:assert/strict';

const js=fs.readFileSync(new URL('../sdynotes.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../sdynotes.css',import.meta.url),'utf8');

assert.match(js,/window\.sdyClampFloatingRect\s*=\s*function/,'shared floating-window clamp must exist');
assert.ok((js.match(/sdyClampFloatingRect\(/g)||[]).length>=8,'all floating windows should use the shared clamp');
assert.doesNotMatch(js,/Math\.max\(-300,Math\.min\(innerWidth\+300/,'windows must not be allowed 300px outside the viewport');
assert.doesNotMatch(js,/id='bbEgg'|getElementById\('bbEgg'\)|쫄라맨 야구/,'baseball easter egg JS must be removed');
assert.doesNotMatch(css,/#bbEgg|#bbTap/,'baseball easter egg CSS must be removed');
assert.match(js,/recentTitle\.textContent='최근 편집'/,'home should label the recently edited notes');
assert.doesNotMatch(js,/_homeScrollBottom\(false\)/,'home entry must not auto-scroll the create button under the sticky header');

/* ── 14.13.8 · 이동범위는 '직접 잰' 화면 사각형만 쓴다 ─────────────────────
   화면 폭/높이를 innerWidth·clientWidth·visualViewport 로 추정하면 단위가 섞여
   오른쪽이 잘린다(또는 밖으로 넘친다). 창과 같은 position:fixed 좌표계의 프로브로
   재는 함수 하나만 경계의 근거로 허용한다.                                */
assert.match(js,/\/\* FLOAT-BOUNDS:BEGIN \*\/[\s\S]*window\.sdyViewportBox=[\s\S]*uiViewportProbeGlobal[\s\S]*position:fixed;left:0;top:0;right:0;bottom:0;[\s\S]*\/\* FLOAT-BOUNDS:END \*\//,
  'viewport must be measured with a full-screen fixed probe inside the shared FLOAT-BOUNDS block');
assert.ok(js.indexOf('FLOAT-BOUNDS:BEGIN')<js.indexOf('window.sdyClampFloatingRect='),
  'bounds helpers must be defined before the shared clamp uses them');
assert.ok((js.match(/uiViewportProbeGlobal/g)||[]).length>=2,
  'the viewport probe must be looked up and created under the same id');

const block=(()=>{                                     // 공용 블록(모든 창이 공유하는 규칙)만 잘라 낸다
  const a=js.indexOf('/* FLOAT-BOUNDS:BEGIN */'), b=js.indexOf('/* FLOAT-BOUNDS:END */');
  assert.ok(a>0&&b>a,'FLOAT-BOUNDS block must stay together in one piece');
  return js.slice(a,b);
})();
assert.doesNotMatch(block,/window\.sdyClampFloatingRect[\s\S]*?Math\.max\(\s*Math\.round\(window\.innerWidth/,
  'the shared clamp must not size the screen from a raw innerWidth');

/* 창마다 '이동'과 '화면 밖 되돌림' 이 모두 공용 경계 함수를 지나야 한다.
   - innerWidth·innerHeight 로 미리 자르면 단위 혼동으로 오른쪽이 막힌다.
   - 포인터 델타를 UI CSS px 로 환산하지 않으면 90% 배율에서 창이 커서와 어긋난다. */
for(const [name,head] of [
    ['엽스코드',"function ypDrag("],
    ['음악플레이어 큰 창',"function clampMpb("],
    ['음악 바',"pl.addEventListener('pointerdown'"],
    ['단어카드',"function _fcardPlace("],
]){
  const i=js.indexOf(head);
  assert.ok(i>0,name+' 이동 코드를 찾지 못함');
  const seg=js.slice(i,i+3000);
  assert.match(seg,/sdyClampFloatingRect\(/,name+' 창은 공용 경계 함수를 써야 한다');
  assert.match(seg,/sdyUiCss\(e\.client[XY]-/,name+' 는 포인터 델타를 UI CSS px 로 환산해야 한다');
  assert.doesNotMatch(seg,/Math\.min\(\s*(window\.)?inner(Width|Height)\s*-\s*[a-zA-Z]/,
    name+' 창은 innerWidth/innerHeight 로 미리 잘라선 안 된다');
}

console.log('floating window bounds and home layout contract: ok');
