/* 편집기 가상화·해돌이 요약 계약 — '줄 덧붙이기'가 아니라 '틀린 코드 교체'로
   고쳐진 것을 소스 수준에서 못박는다 (실행 1초 미만).

   고친 회귀 4가지:
     1) loadDocAsync — 마지막으로 보던 쪽 슬라이스(from=firstSlice)를 pages[0..]
        에 꽂아 여러 쪽 본문이 한 쪽에 겹쳐/섞여 나왔다. → lazy 빈 쪽으로
        앞을 채운 뒤 원래 자리(firstSlice)에 놓는다.
     2) renderPageEls — 렌더용 중복 제거 결과를 doc.pages[idx].els 에 되덮어써
        정상 글상자가 데이터에서 통째로 사라졌다. → 렌더는 문서 그대로 그린다.
     3) _selectiveRenderPage — lazy 빈 스텁(els=[]) 쪽에서 [data-id] 를 전부
        지워 협업 pull 한 번에 상자가 사라졌다. → lazy 쪽은 통째 다시 그리기.
     4) 해돌이 '이 페이지' — curPageIdx 변수만 믿어 화면과 다른 쪽(첫 쪽)을
        요약했다. → 스크롤 위치로 다시 계산하는 visiblePageIdx() 하나를
        스크롤 추적과 bridge 가 함께 쓴다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(REPO, 'sdynotes.js'), 'utf8');
const css = fs.readFileSync(path.join(REPO, 'sdynotes.css'), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

// 1) 첫 슬라이스는 원래 자리에 — 앞을 lazy 로 채우고 dd.pages 를 그대로 흘려 보내지 않는다
check('loadDocAsync: 받은 슬라이스를 dd.pages.slice() 로 0번 칸에 꽂지 않는다',
  !/const pages=dd\.pages\.slice\(\)/.test(js));
check('loadDocAsync: firstSlice 앞칸을 lazy 빈 쪽으로 채운다',
  /for\(let i=0;i<firstSlice&&i<total;i\+\+\)\s*pages\.push\(\{id:'lazy_'\+i/.test(js));
check('loadDocAsync: 슬라이스 뒤칸도 total 까지 lazy 로 채운다',
  /for\(let i=pages\.length;i<total;i\+\+\)\s*pages\.push\(\{id:'lazy_'\+i/.test(js));
check('loadDocAsync: loadedTo 도 슬라이스 끝까지 반영한다',
  /cfg\.__loadedTo=firstSlice\+dd\.pages\.length/.test(js));

// 2) 렌더가 문서 데이터를 되덮어쓰지 않는다
check('renderPageEls: sanitize 결과를 doc.pages[idx].els 에 되덮어쓰지 않는다',
  !/doc\.pages\[idx\]\.els=els/.test(js));

// 3) lazy 빈 스텁 쪽에서 DOM 요소를 일괄 삭제하지 않는다
const selp = js.slice(js.indexOf('function _selectiveRenderPage'), js.indexOf('async function retryPage'));
check('_selectiveRenderPage: 함수가 존재한다', selp.length > 0 && selp.length < 4000);
check('_selectiveRenderPage: lazy 스텁 쪽은 통째 다시 그리기로 돌린다',
  /__lazy!=null\)\{\s*renderPageEls\(idx\);\s*return;\s*\}/.test(selp));

// 4) 해돌이 '이 페이지' 는 화면 기준으로
check('visiblePageIdx 헬퍼가 있다', /function visiblePageIdx\(\)\{/.test(js));
check('onEditorScroll 도 같은 계산을 쓴다 (계약 복제 금지)',
  /const idx=visiblePageIdx\(\);\s*if\(idx!==curPageIdx\)\{ curPageIdx=idx; updatePageInfo\(\); \}/.test(js));
check("bridge.text('page') 는 화면에 보이는 쪽 본문을 꺼낸다",
  /const idx=\(scope==='page'\)\?\[visiblePageIdx\(\)\]:doc\.pages\.map\(\(p,i\)=>i\)/.test(js));

// 5) 해돋이 질문칸 — 너무 아래에 붙지 않게 올렸다
check('CSS: 질문칸 바닥 여백이 28px 로 올라가 있다', /\.ai-askbar\{position:absolute;left:140px;bottom:28px/.test(css));
check('CSS: 좁은 화면(22px)·전화(safe-area+22px)도 같이 올라가 있다',
  /\.ai-askbar\{left:96px;bottom:22px/.test(css)
  && /\.ai-askbar,\.ai-askbar\.draw-on\{bottom:calc\(var\(--ph-safe\) \+ 22px\);/.test(css));

console.log(`\n편집기 가상화·해돌이 요약 계약: PASS ${pass} / FAIL 0`);
