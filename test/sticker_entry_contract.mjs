/* 스티커 넣기 진입점 · '스티커로 합치기' 제거 소스 계약

   14.16.6 변경이 깨지지 않게 sdynotes.js / sdynotes.html 이 지켜야 할 규칙:

     ① '스티커로 합치기'(el-sticker-rep — 원본을 지우고 스티커로 갈아끼우기)는
        객체 묶기와 겹치므로 메뉴·처리부·makeSticker 의 replace 분기까지 완전히 없어야 한다
     ② '객체 묶기'(el-group)는 여러 개 선택 시 여전히 메뉴에 있어야 한다
     ③ '스티커로 만들기'(el-sticker — 원본 유지)는 남아 있어야 한다
     ④ 빈 종이 우클릭 메뉴에 '스티커 넣기'가 이미지 넣기 바로 다음에 있어야 한다
     ⑤ 우클릭으로 열면 그 자리(_stickerAnchor)를 기억하고, 보관함에서 고르면
        그 자리에 붙인다 — 닫으면 기억한 자리를 버린다
     ⑥ 툴바의 사진 추가(그림) 버튼 바로 옆에 스티커 넣기 버튼이 있어야 한다 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

// ── ① '스티커로 합치기' 완전 제거 ────────────────────────────────────────
check("우클릭 메뉴 항목 t:'스티커로 합치기' 가 사라졌다", !js.includes("t:'스티커로 합치기'"));
check("el-sticker-rep 처리와 메뉴 등록이 모두 사라졌다", !js.includes('el-sticker-rep'));
check("토스트 문구 '스티커로 바꿨습니다'도 사라졌다", !js.includes('스티커로 바꿨습니다'));
{
  const m = js.match(/async function makeSticker\(([^)]*)\)\{/);
  assert.ok(m, 'makeSticker 함수가 존재해야 한다');
  check('makeSticker 는 replace 인수를 더 받지 않는다', m[1].trim() === '');
  const b = js.slice(m.index, m.index + 2600);
  check('makeSticker 안에 원본을 지우는 replace 분기가 없다',
    !b.includes('if(replace)') && !b.includes('purgeElements(rm)'));
  check('makeSticker 은 원본을 그대로 두고 보관함에 저장한다',
    b.includes('purgeElements') === false || !/filter\(e=>!ids\.has/.test(b));
}

// ── ②③ 객체 묶기 · 스티커로 만들기는 남아 있다 ──────────────────────────
{
  const i0 = js.indexOf("{a:'el-front'");
  const i1 = js.indexOf("items.push({sub:'더보기'");
  assert.ok(i0 > 0 && i1 > i0, '더보기 메뉴 만드는 구간이 존재해야 한다');
  const region = js.slice(i0, i1);
  check("여러 개 선택 메뉴에 '객체 묶기'(el-group)가 남아 있다",
    region.includes("}else{") && region.includes("{a:'el-group', i:'ri-links-line', t:'객체 묶기'}"));
  check('여러 개 선택 메뉴에 스티커 합치기 항목이 더는 없다', !region.includes('el-sticker-rep'));
}
check("'스티커로 만들기'(el-sticker · 원본 유지)는 남아 있다",
  js.includes("{a:'el-sticker', i:'ri-sticky-note-line', t:'스티커로 만들기'}")
  && js.includes("else if(a==='el-sticker'){ makeSticker(); }"));

// ── ④ 빈 종이 우클릭 메뉴에 '스티커 넣기' ────────────────────────────────
{
  const iImg = js.indexOf("{a:'img',      i:'ri-image-add-line', t:'이미지 넣기'},");
  const iStk = js.indexOf("{a:'sticker',  i:'ri-sticky-note-line', t:'스티커 넣기'},");
  check('빈 종이 우클릭 메뉴에 스티커 넣기가 생겼다', iStk > 0);
  check('스티커 넣기는 이미지 넣기 바로 다음에 있다',
    iImg > 0 && iStk > iImg
    && js.slice(iImg, iStk).trim() === "{a:'img',      i:'ri-image-add-line', t:'이미지 넣기'},".trim());
}
{
  const m = js.match(/else if\(a==='sticker'\)\{ _stickerAnchor=\{pageIdx:pi,x:t\.x,y:t\.y\}; openStickers\(\); \}/);
  check("우클릭 '스티커 넣기'는 그 자리를 기억하고 보관함을 연다", !!m);
}

// ── ⑤ 앵커 자리에 붙이기 ────────────────────────────────────────────────
{
  const m = js.match(/function closeStickers\(\)\{[\s\S]{0,300}?\}/);
  assert.ok(m, 'closeStickers 함수가 존재해야 한다');
  check('보관함을 닫으면 기억한 자리(_stickerAnchor)를 버린다', m[0].includes('_stickerAnchor=null'));
}
{
  const m = js.match(/function useSticker\(id\)\{([\s\S]*?)\n    \}/);
  assert.ok(m, 'useSticker 함수가 존재해야 한다');
  const b = m[1];
  check('앵커가 있으면 우클릭한 페이지·자리에 붙인다',
    b.includes('_stickerAnchor&&doc.pages[_stickerAnchor.pageIdx]')
    && b.includes('clampEl(_stickerAnchor.x-w/2,_stickerAnchor.y-h/2,w,h)'));
  check('앵커가 없으면(툴바) 기본 자리(80,100)에 붙인다', b.includes('let pi=curPageIdx, x=80, y=100;'));
  check('붙인 요소는 스티커 표시(sticker:true)를 가진다', b.includes('sticker:true'));
}

// ── ⑥ 툴바 버튼 (그림 옆) ───────────────────────────────────────────────
{
  const iImgAttr = html.indexOf('onclick="triggerImgUpload()"');
  const iStkAttr = html.indexOf('onclick="openStickers()" id="stkBtn"');
  check('툴바에 스티커 넣기 버튼(stkBtn)이 있다', iStkAttr > 0);
  const iImgBtn = iImgAttr > 0 ? html.lastIndexOf('<button', iImgAttr) : -1;
  const iStkBtn = iStkAttr > 0 ? html.lastIndexOf('<button', iStkAttr) : -1;
  check('스티커 버튼은 사진 추가(그림) 버튼 바로 다음에 있다',
    iImgBtn > 0 && iStkBtn > iImgBtn && !html.slice(iImgBtn + 8, iStkBtn).includes('<button'));
  check('스티커 버튼 제목은 "스티커 넣기"다',
    iStkAttr > 0 && html.slice(iStkBtn, iStkAttr + 140).includes('title="스티커 넣기"'));
}

console.log(`\n스티커 넣기 진입점 계약: PASS ${pass} / FAIL 0`);
