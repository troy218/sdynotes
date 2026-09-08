/* PDF·사진 내보내기 WYSIWYG 정합 계약

   보고: "PDF나 사진으로 만들기를 누르면 실제 편집 화면에서 보이는 것과
   다르게 요소의 관계가 살짝 틀어진다."

   원인: 내보내기 조립(renderPageCanvas·bakeStickerSVG)이 편집 화면의
   상자 모델과 달랐다.
     · 글상자: .tb-content 의 투명 테두리(var(--bw))·회전·표 칸 서식·
       가져오기/번역 맞춤 크기(fitSize·trFS)·상자 서식을 빼먹음
     · 그림: .paper-img 테두리 안쪽 들여쓰기를 빼먹음
     · 수식: .latex-content 여백·테두리·정렬과 paintLatex 맞춤을 빼먹고,
       가져온 수식은 잉크 상자로 따로 그림
     · foreignObject 안에는 전역 리셋(*{margin:0}·sup/sub)이 닿지 않음
     · 펜 겹침 순서가 화면(채움 < 글자 < 선)과 반대

   이 계약은 조립기(_exp* 헬퍼·측정기)가 화면 규칙을 그대로 따르는지
   소스 패턴으로 지킨다. 실행 기반 회귀는 각 렌더 경로의 기존 테스트가 담당. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
const fnBody = (src, name, len) => {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{`));
  assert.ok(m, `${name} 함수가 존재해야 한다`);
  return src.slice(m.index, m.index + (len || 6000));
};

// ── ① 테두리 두께: 지금 보는 화면과 같은 --bw ──────────────────────────
{
  const b = fnBody(js, '_expBorderW');
  check('테두리 두께는 #pagesStage 의 --bw 를 읽는다',
    b.includes("getElementById('pagesStage')") && b.includes('--bw'));
  check('못 읽으면 기본값 2 로 둔다', b.includes('let out=2'));
}

// ── ② 글자 크기: 화면에 보이는 맞춤값을 쓴다 ───────────────────────────
{
  const b = fnBody(js, '_expTextMetrics');
  check('가져오기 맞춤(fit·fitDown)은 캐시된 fitSize·fitLS·fitLH 를 쓴다',
    b.includes('el.fitSize') && b.includes('el.fitLS') && b.includes('el.fitLH'));
  check('번역 맞춤(trFit)은 trFS·trLS·trFW 를 쓴다',
    b.includes('el.trFS') && b.includes('el.trLS') && b.includes('el.trFW'));
}

// ── ③ 글상자 안쪽: .tb-content 와 같은 상자 모델 ───────────────────────
{
  const b = fnBody(js, '_expTextInner', 4200);
  check('일반 상자는 화면과 같은 여백·투명 테두리·보이는 overflow 다',
    b.includes('padding:8px 12px') && b.includes('solid transparent')
    && b.includes('overflow:visible') && b.includes('overflow-wrap:break-word')
    && b.includes('min-width:60px'));
  check('표 칸(el.tbl)은 화면처럼 6px 8px + 세로 가운데 flex 다',
    b.includes('el.tbl') && b.includes('padding:6px 8px')
    && b.includes('flex-direction:column') && b.includes('_expVAlign(el)'));
  check('가져온 상자(tight)는 여백 0 + 줄간 1 + 보이는 overflow 다',
    b.includes('el.tight') && b.includes('padding:0') && b.includes('line-height:${m.lh||1}')
    && b.includes('word-break:normal'));
  check('pdf-text 상자는 화면처럼 테두리가 없고, 그 외 tight 는 테두리를 둔다',
    b.includes('if(!el.pdfText)'));
  check('상자 단위 서식(굵기·기울임·밑줄)도 따라간다',
    b.includes('el.fontWeight') && b.includes('el.fontStyle') && b.includes('el.textDecoration'));
  check('수동 자간·어간(ls·wsp)을 화면처럼 둔다',
    b.includes('el.ls') && b.includes('el.wsp'));
}
check('CSS 기준: .tb-content 는 여백 8px 12px + 투명 테두리다',
  css.includes('.tb-content{') && css.includes('padding:8px 12px')
  && css.includes('border:var(--bw,2px) solid transparent'));
check('CSS 기준: 표 칸은 여백 6px 8px + 세로 가운데 flex 다',
  css.includes('.tb.in-tbl .tb-content{') && css.includes('padding:6px 8px')
  && css.includes('justify-content:center'));

// ── ④ 수식 안쪽: .latex-content 와 같은 상자 모델 ──────────────────────
{
  const b = fnBody(js, '_expLatexInner', 2000);
  check('수식도 투명 테두리 + 줄바꿈 없음이다',
    b.includes('solid transparent') && b.includes('white-space:nowrap'));
  check('가져온 수식은 여백 0 + 숨김 + 가운데다',
    b.includes('padding:0;overflow:hidden;align-items:center;'));
  check('display 수식은 화면처럼 1px 4px + 가운데다',
    b.includes('padding:1px 4px;overflow:visible;align-items:center;'));
  check('인라인 수식은 화면처럼 아래 맞춤이다',
    b.includes('padding:0 4px 1px;overflow:visible;align-items:flex-end;'));
}
check('CSS 기준: .latex-content 기본 여백·아래 맞춤이 그대로다',
  css.includes('.latex-content{') && css.includes('padding:0 4px 1px'));

// ── ⑤ foreignObject 리셋 ──────────────────────────────────────────────
{
  const b = fnBody(js, '_expForeignReset', 1600);
  check('전역 리셋(margin·padding 0)을 SVG 안에 동봉한다',
    b.includes('.sdyx *{margin:0;padding:0;box-sizing:border-box;}'));
  check('sup/sub 규칙도 화면과 같다',
    b.includes('.sdyx sup{top:-.45em;}') && b.includes('line-height:0'));
}

// ── ⑥ 페이지 굽기(renderPageCanvas) ────────────────────────────────────
{
  const b = fnBody(js, 'renderPageCanvas', 9000);
  check('글상자 바깥에 회전을 건다',
    b.includes('transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;'));
  check('글자·수식은 공용 조립기(_expTextInner·_expLatexInner)로 만든다',
    b.includes('_expTextInner(el,bw,el.__c') && b.includes('_expLatexInner(el,bw,fs)'));
  check('리셋 스타일을 foreignObject 뿌리에 넣는다',
    b.includes('class="sdyx"') && b.includes('${_expForeignReset()}'));
  check('그림은 테두리 안쪽에 들여써 그린다',
    b.includes('el.x+bw') && b.includes('el.w-bw*2'));
  check('수식은 화면과 같은 el.w×el.h 상자에 굽는다 (잉크 상자 별도 금지)',
    b.includes("width:${el.w}px;height:${el.h}px;")
    && !b.includes('el.inkW||el.w'));
  check('수식 맞춤은 가져온 것·직접 넣은 것 가리지 않고 latexFitScale 이다',
    b.includes('(latexFitScale(el)||1)') && !b.includes('imp?Math.min(1,(latexFitScale'));
  const fillAt = b.indexOf("drawStrokeOnCanvas(ctx,st,'fill')");
  const textAt = b.indexOf('_expTextInner(el,bw,el.__c');
  const lineAt = b.indexOf("drawStrokeOnCanvas(ctx,st,'line')");
  check('겹침 순서가 화면과 같다 (채움 → 글자 → 선)',
    fillAt >= 0 && textAt > fillAt && lineAt > textAt);
}
{
  const b = fnBody(js, 'drawStrokeOnCanvas', 2400);
  check('펜 그리기는 채움/선 패스를 나눌 수 있다',
    b.includes("pass==='fill'") && b.includes("pass!=='line'") && b.includes("pass!=='fill'"));
}
{
  const b = fnBody(js, 'drawTextOnCanvas', 1200);
  check('캔버스 폴백도 회전·테두리·맞춤 크기를 따른다',
    b.includes('normalizedRotation(el.rotation)') && b.includes('_expBorderW()')
    && b.includes('_expTextMetrics(el)'));
}

// ── ⑦ 가져온 글줄 맞춤(_pdfStaticHtml) ────────────────────────────────
{
  const b = fnBody(js, '_pdfStaticHtml', 4200);
  check('자간·어간(ls·wsp)을 화면처럼 잰다', b.includes("el.ls") && b.includes('el.wsp'));
  check('줄간격(lg)을 화면처럼 첫 줄 기준으로 벌린다',
    b.includes('el.lg') && b.includes('(t.top-t0)*lg'));
  check('맞춤값 정밀도가 화면과 같다', b.includes('toFixed(5)') && b.includes('toFixed(3)'));
  check('겹겹 스타일 행은 실제 렌더 폭 프로브로 맞춘다', b.includes('_pdfProbeSpanW(s,c)'));
}

// ── ⑧ 수식 맞춤 측정(latexFitScale) ───────────────────────────────────
{
  const b = fnBody(js, 'latexFitScale', 3600);
  check('실제 .latex-box/.latex-content 클래스로 화면 밖에서 잰다',
    b.includes("'latex-box'") && b.includes("'latex-content'"));
  check('같은 크기의 상자로 잰다',
    b.includes('width:${Math.max(1,el.w||1)}px') && b.includes('height:${Math.max(1,el.h||1)}px'));
  check('테두리도 화면 값(--bw)으로 맞춘다', b.includes('_expBorderW()'));
  check('맞춤식이 paintLatex 와 같다 (여백 1/8·0/4 + .995 임계)',
    b.includes('padW=imp?1:8') && b.includes('padH=imp?0:4')
    && b.includes('k<.995?Math.max(.35,k):1'));
}

// ── ⑨ 편집 화면: 회전 유지 + 크기 되받기 가드 ──────────────────────────
{
  const b = fnBody(js, 'buildTextEl', 2400);
  check('글상자도 다시 그릴 때 회전을 유지한다', b.includes('applyBoxRotation(w,el)'));
}
{
  const b = fnBody(js, 'syncTextEl', 2400);
  check('회전한 상자는 외접 박스로 크기를 덮지 않는다',
    b.includes('normalizedRotation(el.rotation)'));
}

// ── ⑩ 스티커·미리보기도 같은 조립기 ───────────────────────────────────
{
  const b = fnBody(js, 'bakeStickerSVG', 5600);
  check('스티커 글자·수식도 공용 조립기를 쓴다',
    b.includes('_expTextInner(el,_xbw') && b.includes('_expLatexInner(el,_xbw,fs)'));
  check('스티커에도 리셋 스타일을 넣는다', b.includes('${_expForeignReset()}'));
}
{
  const b = fnBody(js, 'renderPageStatic', 5200);
  check('미리보기도 공용 조립기를 쓴다',
    b.includes('_expTextInner(el,bw') && b.includes('_expLatexInner(el,bw,'));
}

console.log(`\n내보내기 정합 계약: PASS ${pass} / FAIL 0`);
