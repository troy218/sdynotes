/* SVG 벡터 스티커 소스 계약

   14.16.7 — 스티커를 PNG 래스터 대신 SVG 벡터로 구워 "확대해도 안 깨지게" 만든다.
   sdynotes.js / server/src/routes/stickers.js 가 지켜야 할 규칙:

     ① 굽기는 벡터 조립이다: 펜 획 → <path>, 글자 → <foreignObject>+XHTML,
        이미지 → <image>(data: 인라인), 수식 → KaTeX HTML
     ② strokeToPathD 는 drawStrokeOnCanvas 와 같은 지오메트리(sharp → 직선 L,
        부드럽게 → 2차 곡선 Q)를 만든다 — 화면과 스티커 모양이 같아야 한다
     ③ SVG 굽기가 실패하면 예전 캔버스 PNG 경로로 폴백한다
     ④ 굽은 스티커는 sticker:true + svg:true 로 붙고 보관함에도 저장된다
     ⑤ 서버는 base64(PNG)와 URL 인코딩(SVG) data: URL 을 모두 디코드하고,
        SVG 는 .svg 로 저장해 image/svg+xml 로 돌려준다
     ⑥ 서버는 SVG 를 저장할 때 스크립트를 무력화하고(sanitize), 원본 열기 차단
        CSP 헤더를 붙인다
     ⑦ useSticker 는 내부 크기를 못 구해도 기본 크기로 붙인다(벡터라 확대 무관) */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const srv = fs.readFileSync(new URL('../server/src/routes/stickers.js', import.meta.url), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
const fnBody = (src, name) => {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{`));
  assert.ok(m, `${name} 함수가 존재해야 한다`);
  return src.slice(m.index, m.index + 4200);
};

// ── ① 벡터 조립 ─────────────────────────────────────────────────────────
{
  const b = fnBody(js, 'bakeStickerSVG');
  const sp = fnBody(js, 'strokePath');
  check('펜 획은 화면 렌더와 같은 strokePath 로 <path> 를 만든다',
    b.includes('strokePath(el.pts, el.sharp&&!isEllipsePts(el.pts))') && b.includes('`<path d="${d}"'));
  check('strokePath 도 화면 규칙 그대로다 (sharp → 직선, 부드럽게 → 2차 곡선)',
    sp.includes('if(sharp){') && sp.includes(' Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}'));
  check('글자는 foreignObject + htmlToXhtml 로 서식이 유지된다',
    b.includes('<foreignObject') && b.includes('htmlToXhtml(fixDarkColors(el.html))'));
  check('이미지는 data: 로 인라인해 <image> 로 넣는다',
    b.includes('await toDataURL(el.url)') && b.includes('`<image x="${el.x}"'));
  check('만들 내용이 없으면 실패로 처리해 폴백을 유도한다', b.includes("throw new Error('스티커로 만들 내용이 없다')"));
  check('결과는 URL 인코딩 SVG data: URL 이다',
    b.includes("'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)"));
  check('획 색·굵기·반올림 끝모양이 화면 규칙을 따른다',
    b.includes("el.color||'#111111'") && b.includes('el.size||2')
    && b.includes("stroke-linecap=\"round\"") && b.includes("stroke-linejoin=\"round\""));
}

// ── ③④ 폴백 · 요소 플래그 ──────────────────────────────────────────────
{
  const b = fnBody(js, 'makeSticker');
  check('SVG 굽기 실패 시 예전 캔버스 PNG 경로로 폴백한다',
    b.includes('await bakeStickerSVG(items,pi,rx,ry,rw,rh)')
    && b.includes("renderPageCanvas(pi,{onlyIds:ids,transparent:true})")
    && b.includes("out.toDataURL('image/png')"));
  check('붙은 스티커는 sticker 표시와 svg 표시를 가진다',
    b.includes('sticker:true') && b.includes('el.svg=true'));
  check('보관함에도 저장해 다른 노트에서 재사용한다', b.includes("'/api/stickers/save'"));
  check('SVG 로 구웠다는 안내를 준다', b.includes('벡터라 확대해도 안 깨져요'));
}

// ── ⑦ useSticker 기본 크기 가드 ─────────────────────────────────────────
{
  const b = fnBody(js, 'useSticker');
  check('내부 크기가 0 이어도 기본 크기(300)로 붙인다',
    b.includes('Math.max(1,im.width||0)') && b.includes('||300'));
}

// ── ⑤ 서버 디코드 · 저장 ────────────────────────────────────────────────
{
  const b = fnBody(srv, 'decodeDataUrl');
  check('base64 PNG 를 디코드한다', b.includes("Buffer.from(body, 'base64')"));
  check('URL 인코딩 SVG 를 텍스트로 디코드한다',
    b.includes('decodeURIComponent(body)') && b.includes("Buffer.from(text, 'utf8')"));
  check('svg+xml 을 벡터로 식별한다', b.includes("kind === 'svg+xml'"));
}
{
  const m = srv.match(/app\.post\('\/api\/stickers\/save'[\s\S]*?\n  \}\);/);
  assert.ok(m, 'save 라우트가 존재해야 한다');
  check('SVG 는 .svg 로 저장한다', m[0].includes("${isSvg ? 'svg' : 'png'}"));
  check('저장 전에 sanitize 로 스크립트를 무력화한다', m[0].includes('sanitizeSvg(raw.toString'));
  check('레코드에 벡터 형식(fmt)을 남긴다', m[0].includes("fmt: isSvg ? 'svg' : 'png'"));
}
{
  const b = fnBody(srv, 'sanitizeSvg');
  check('sanitize 는 <script> 를 잘라낸다', b.includes('<script'));
  check('sanitize 는 on* 이벤트 속성을 잘라낸다', b.includes("\\son\\w+"));
  check('sanitize 는 javascript: 링크를 무력화한다', b.includes('javascript:'));
}
{
  const m = srv.match(/app\.get\('\/api\/stickers\/raw\/:sid'[\s\S]*?\n  \}\);/);
  assert.ok(m, 'raw 라우트가 존재해야 한다');
  check('SVG 는 image/svg+xml 로 돌려준다', m[0].includes("reply.type('image/svg+xml')"));
  check('PNG 는 여전히 image/png 다', m[0].includes("reply.type('image/png')"));
  check('SVG 원본 열기엔 CSP sandbox 를 붙인다',
    m[0].includes("Content-Security-Policy") && m[0].includes("sandbox"));
}

console.log(`\nSVG 벡터 스티커 계약: PASS ${pass} / FAIL 0`);
