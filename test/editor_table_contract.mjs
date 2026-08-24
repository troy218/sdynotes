import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
let pass = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  pass++;
  console.log('  ✓ ' + name);
};
const fn = name => {
  const at = js.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} 함수가 있어야 한다`);
  const next = js.indexOf('\n    function ', at + 12);
  return js.slice(at, next < 0 ? js.length : next);
};

console.log('\n에디터 표·배율 계약');

const toolbar = html.match(/<!-- ═══ Insert Group ═══ -->([\s\S]*?)<!-- ═══ Core Tools Group ═══ -->/)?.[1] || '';
const noteMenu = html.match(/<div class="more-sec" data-ms="note" hidden>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/)?.[1] || '';
check('문서 가져오기는 에디터 상단 넣기 도구에서 빠졌다', !toolbar.includes('importInput'));
check('문서 가져오기는 숨겨진 노트 더보기 메뉴에 있다', noteMenu.includes('importInput') && noteMenu.includes('문서 가져오기'));

check('fine-pointer 데스크톱의 전체 사이트 기본 배율은 90%다',
  /@media\s*\(min-width:641px\)\s*and\s*\(pointer:fine\)\s*\{\s*html\s*\{\s*zoom:\.9/.test(css));
check('페이지 포인터 델타는 실제 종이 사각형으로 환산한다',
  fn('pageClientDelta').includes('getBoundingClientRect') && fn('pageClientDelta').includes('dx*s.w/r.width'));

check('최근 노트 줄의 그림자 클리핑 경계를 아래로 확장한다',
  /\.home-stack-area\.has-recent \.recent-row\s*\{[\s\S]*?height:calc\(100% \+ 112px\)[\s\S]*?margin:0 auto -112px!important/.test(css));
check('최근 노트 줄과 카드는 헤더 아래의 높은 격리 레이어에 렌더된다',
  /\.home-stack-area\.has-recent \.recent-section\s*\{[^}]*z-index:40[^}]*isolation:isolate/.test(css)
  && /\.recent-row \.note-card\s*\{[^}]*z-index:1[^}]*isolation:isolate/.test(css));
/* 17.7 · 호버 그림자(위 8px · 좌우 18px · 아래 42px)가 잘리지 않는 여유
   좌우 여유는 2배(데스크톱 34→68 · 모바일 22→44)로 잡는다. */
check('최근 노트 줄은 카드 위·옆·아래 그림자가 모두 들어올 만큼 패딩을 둔다',
  /\.home-stack-area\.has-recent \.recent-row\s*\{[^}]*padding:18px 68px 56px!important;[^}]*margin:-14px auto -60px!important/.test(css)
  && !css.includes('padding:4px 16px 56px!important')
  && !css.includes('padding:4px 10px 56px!important'));
check('위 패딩을 키운 만큼 음수 마진으로 카드 자리를 그대로 지킨다',
  /\.home-stack-area\.has-recent \.recent-row\s*\{[^}]*padding:18px [^}]*margin:-14px auto/.test(css)
  && /@media\(max-width:640px\)\{\s*\.home-stack-area\.has-recent \.recent-row\{padding:18px 44px 56px!important;\}/.test(css));
check('모바일 최근 줄도 좌우 22px 여백으로 옆 그림자를 지킨다',
  /\.recent-row\{[^}]*padding-left:22px!important;padding-right:22px!important/.test(css));
check('줄 높이는 CSS 의 패딩·음수 마진을 그대로 재서 정한다 (상수 4/60 제거)',
  fn('_fitHomeRows').includes('px(rcs.marginTop)') && fn('_fitHomeRows').includes('px(rcs.marginBottom)')
  && fn('_fitHomeRows').includes('rowH-secPT-titleH-rowMT-rowMB')
  && !fn('_fitHomeRows').includes('rowH-secPT-titleH+60'));

check('텍스트 상자·표 고스트는 사이트 배율(html{zoom})을 직접 재서 환산한다',
  fn('uiCssZoom').includes('uiZoomProbe') && fn('uiCssZoom').includes('/100')
  && fn('moveTextGhost').includes('uiCssZoom()') && fn('moveTableGhost').includes('uiCssZoom()')
  && fn('positionTblBar').includes('uiCssZoom()'));
check('텍스트 고스트는 삽입 경로와 같은 계산으로 실제 생성 자리를 미리 본다',
  fn('moveTextGhost').includes('clampEl(p.x-TB_W/2,p.y-TB_H/2,TB_W,TB_H)')
  && /if\(textToolActive\)\{[\s\S]{0,220}c=clampEl\(p\.x-TB_W\/2,p\.y-TB_H\/2,TB_W,TB_H\)/.test(js)
  && /if\(textToolActive&&ghost\) moveTextGhost\(e\.clientX,e\.clientY\)/.test(js));
check('배율을 바꾸면 고스트를 크기·위치 모두 다시 맞춘다',
  fn('sizeTextGhost').includes('moveTextGhost(lastMouse.clientX')
  && fn('sizeTextGhost').includes('moveTableGhost(lastMouse.clientX'));

check('표 삽입은 크기 입력 뒤 자유 배치 모드로 전환한다',
  fn('openTableModal').includes('beginTablePlacement') && html.includes('id="tableGhost"'));
check('표 배치는 종이 클릭 좌표를 표 중심으로 사용한다',
  /if\(tablePlace\)\{[\s\S]*?p\.x-cfg\.w\/2[\s\S]*?insertTable\(cfg\.rows,cfg\.cols,pageIdx/.test(js));
check('Esc로 표 배치 모드를 취소할 수 있다',
  fn('closeTopOverlay').includes('if(tablePlace){ cancelTablePlacement(); return true; }'));

check('표 내부 group은 일반 다중 객체 드래그에서 제외된다',
  js.includes('gEl&&gEl.group&&!tblOf(gEl)'));
check('일반 중복 글상자 정리에서 표 셀을 제외해 선만 남는 손상을 막는다',
  fn('sanitizePageEls').includes("e.type==='text'&&!e.tbl"));
const moveBody = fn('startTblMove') + fn('previewTblMove');
check('표 이동 미리보기는 칸·선·선택틀에 같은 델타를 적용한다',
  moveBody.includes('m.cells.forEach') && moveBody.includes('m.strokes.forEach') && moveBody.includes('m.box'));
check('표 이동 중 매 프레임 rebuild하지 않고 mouseup에서 한 번 재구성한다',
  /if\(tblMove\)\{[\s\S]*?previewTblMove\(tblMove,dx,dy\);[\s\S]*?return;/.test(js)
  && /document\.addEventListener\('mouseup',[\s\S]*?rebuildTable\(tblMove\.pi,tblMove\.tid,\{quiet:true\}\)/.test(js));

check('표 셀 선택은 앵커와 끝점으로 직사각형 범위를 계산한다',
  fn('selectedTblCellEls').includes('Math.min(s.r0,s.r1)')
  && fn('selectedTblCellEls').includes('Math.max(s.c0,s.c1)'));
check('마우스 드래그가 셀 범위 끝점을 계속 갱신한다',
  /if\(tblCellPick\)\{[\s\S]*?tblCellSelection\.r1=cell\.r; tblCellSelection\.c1=cell\.c/.test(js));
check('선택한 셀 범위가 명확히 강조된다', css.includes('.tb.in-tbl.tbl-cell-sel .tb-content'));
check('선택 셀 범위에 가로·세로 정렬과 배경색을 저장한다',
  fn('tblCellAlign').includes('el.align=dir')
  && fn('tblCellVAlign').includes('el.vAlign=dir')
  && fn('tblCellFill').includes('el.cellBg=color'));
check('상단 가로 정렬도 선택 셀 범위에 적용된다', fn('setAlign').includes('selectedTblCellEls().length'));
check('선택 셀에서 Delete는 표 전체를 지우고 Backspace는 내용만 지운다',
  fn('clearTblCellContents').includes("el.html=''")
  && /if\(e\.key==='Delete'\)[\s\S]{0,180}tblDelAll\(true,s\.tid,s\.pageIdx\)/.test(js)
  && js.includes("if(e.key==='Backspace'){ e.preventDefault(); clearTblCellContents(); return; }"));
check('표 미리보기와 실제 삽입이 같은 종이 좌표 경계를 쓴다',
  fn('moveTableGhost').includes('clampTableOrigin(tablePlace')
  && fn('insertTable').includes('clampTableOrigin(dim'));
check('표 전체 삭제가 셀·stroke·거터 메타데이터를 모두 제거한다',
  fn('tblDelAll').includes('tblOf(e) !== tid && e.group !== group')
  && fn('tblDelAll').includes("document.querySelectorAll('.layer-tbl .tbl-box')"));
check('표 도구막대에 셀 정렬과 배경색 조절이 노출된다',
  html.includes("tblCellAlign('center')") && html.includes("tblCellVAlign('middle')") && html.includes('tblCellFill(this.value)'));

console.log(`\n에디터 표·배율 계약: PASS ${pass} / FAIL 0`);
