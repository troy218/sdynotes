// 해돌이(마스코트) 자리 계약
//   · 스톱워치/타이머(집중 화면) 해돌이 — 공중에 뜨지 않고 화면 바닥에 붙어 앉는다
//     (좁은 화면에선 아래 버튼 바를 덮지 않도록 폰 규칙이 따로 잡는다)
//   · 전체화면 암기카드 해돌이 — 카드 '왼쪽 아래'가 아니라 문제의 '진짜 왼쪽'
//     (카드와 나란한 flex 항목 · 세로 가운데)
//   · 편지 해돌이 — 엽스코드 첫 입장(로그인/비회원 선택) 화면에서도 보인다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let fail = 0;
function ok(cond, msg){ if(!cond){ fail++; console.error('  ✗', msg); } else console.log('  ✓', msg); }

const css = fs.readFileSync(path.join(root,'sdynotes.css'),'utf8');
const js  = fs.readFileSync(path.join(root,'sdynotes.js'),'utf8');
const html= fs.readFileSync(path.join(root,'sdynotes.html'),'utf8');

/** 선택자 블록 본문을 가져온다 (첫 번째 것) */
function rule(src, sel){
  const i = src.indexOf(sel);
  if(i < 0) return null;
  const open = src.indexOf('{', i + sel.length - 1);   // sel 끝의 '{' 자기 자신
  const close = src.indexOf('}', open);
  return src.slice(open + 1, close);
}

// ── 1) 스톱워치(집중 화면) 해돌이: 바닥에 붙는다 ─────────────────
{
  const body = rule(css, '.fc-otter{');
  ok(!!body, '.fc-otter 규칙이 있다');
  ok(/bottom:\s*max\(8px/.test(body) || /bottom:\s*[0-8]px/.test(body),
     `집중 화면 해돌이는 바닥에 붙는다 (bottom: ${(body.match(/bottom:[^;]+/)||[''])[0]})`);
  ok(!/bottom:\s*clamp\(70px/.test(body), '예전처럼 70~92px 위에 떠 있지 않는다');
  // 좁은 화면: 버튼 바가 해돌이 자리를 침범하지 않게 폭을 줄이고 바에 여백을 준다
  const narrow = css.slice(css.indexOf('@media (max-width:1024px){'), css.indexOf('/* ── ⑤ 졸리는 해돌이'));
  ok(/@media \(max-width:1024px\)/.test(css), '좁은 화면 규칙이 있다');
  ok(/\.fc-otter\{[^}]*width:76px/.test(narrow), '좁은 화면에선 해돌이를 줄인다');
  ok(/\.fc-chrome\.bottom\{[^}]*padding-left:104px[^}]*padding-right:104px/.test(narrow),
     '좁은 화면에선 버튼 바가 해돌이 자리를 피해 가운데 정렬된다');
  // 폰 규칙(더 뒤에 있음)이 좁은 화면 규칙을 이긴다 = 소스에서 뒤에 와야 한다
  const phoneIdx = css.indexOf('.fc-otter{left:10px;bottom:calc(var(--ph-safe');
  ok(phoneIdx > css.indexOf('@media (max-width:1024px){'),
     '폰 규칙(바 위로 올림)은 좁은 화면 규칙보다 뒤에 있어 폰에서 이긴다');
}

// ── 2) 전체화면 암기카드 해돌이: 문제의 진짜 왼쪽 ─────────────────
{
  const wide = css.slice(css.indexOf('@media (min-width:920px){'));
  const block = wide.slice(0, wide.indexOf('\n}'));
  ok(/@media \(min-width:920px\)/.test(css), '넓은 화면 규칙이 있다');
  ok(/\.fcard-win\.fcard-max \.cd-otter\{[^}]*position:relative/.test(block),
     '전체화면 해돌이는 절대 위치를 벗어나 카드와 나란히 선다(position:relative)');
  ok(/\.fcard-win\.fcard-max \.cd-otter\{[^}]*flex:0 0 auto/.test(block),
     '카드와 같은 줄의 flex 항목이다(flex:0 0 auto)');
  ok(/\.fcard-win\.fcard-max \.cd-otter\{[^}]*align-self:center/.test(block),
     '세로 가운데 정렬 — 왼쪽 아래가 아니라 문제 옆');
  ok(/\.fcard-win\.fcard-max \.cd-otter\{[^}]*left:auto[^}]*bottom:auto/.test(block),
     '예전 왼쪽 아래 고정(left/bottom)을 해제한다');
  ok(/\.otter-bubble\{[^}]*left:0;right:auto/.test(block),
     '말풍선이 화면 왼쪽에서 잘리지 않게 왼쪽 정렬로 뿜는다');
  // 좁은 화면(920px 미만)에선 예전처럼 왼쪽 아래 — 카드를 덮지 않는 자리
  const base = rule(css, '.fcard-win.fcard-max .cd-otter{');
  ok(/bottom:clamp\(10px,4vh,34px\)/.test(base), '좁은 화면 대비: 기본값(왼쪽 아래)은 유지');
}

// ── 3) 편지 해돌이: 엽스코드 첫 입장 화면에서도 보인다 ────────────
{
  ok(html.indexOf('id="ypGate"') >= 0 && html.indexOf('id="ypEmpty"') >= 0,
     '입장 게이트(#ypGate)와 빈 채팅 안내(#ypEmpty)가 있다');
  ok(/\.yp-empty \.yp-otter|querySelector\('#ypEmpty \.yp-otter'\)/.test(js),
     '빈 채팅 해돌이를 원본으로 삼는다');
  ok(/cloneNode\(true\)/.test(js) && /c\.id='ypGateOtter'/.test(js)
     && /gate\.insertBefore\(c,gate\.firstChild\)/.test(js),
     '첫 입장 화면(.ypg-card) 맨 위에 편지 해돌이를 복제해 둔다');
  ok(/querySelector\('#ypGate \.ypg-card'\)/.test(js), '복제 대상은 입장 게이트 카드');
  ok(/\.ypg-card \.yp-otter\{/.test(css), '게이트 카드용 해돌이 크기 규칙이 있다');
  ok(/ypGateOtterHello\(\)/.test(js) && /g\.style\.display='flex'/.test(js),
     '게이트가 열릴 때 해돌이가 인사한다');
  // 복제는 스쿼드 클릭 바인딩보다 먼저 일어나야 게이트 해돌이도 눌린다
  ok(js.indexOf("c.id='ypGateOtter'") < js.indexOf(".om-mini[data-word]"),
     '복제가 해돌이 스쿼드 클릭 바인딩보다 앞서 일어난다');
  // 폰에선 게이트 카드가 스크롤(overflow)되므로 말풍선을 아래로 뿜는다
  const phone = css.slice(css.indexOf('.ypg-card .yp-otter{width:92px;}'));
  ok(/\.om-say\{[^}]*translate\(-50%,100%\)/.test(phone.slice(0,400)),
     '폰 게이트: 말풍선이 카드 안쪽(아래)으로 뿜혀 잘리지 않는다');
}

if(fail){ console.error(`\n✗ ${fail}개 실패`); process.exit(1); }
console.log('\n✓ otter_place_contract: ok');
