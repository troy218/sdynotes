// 암기카드 해설 번호 계약
//   · 객관식 보기는 화면에서 섞여 보인다(showCard 의 order)
//   · 해설(①②③…)은 '원래 보기 순서'로 저장돼 있으므로, 그대로 그리면
//     위 보기 번호(1,2,3…)와 아래 해설 번호가 어긋나 보인다
//   → 해설도 화면에 보이는 순서로 다시 나열하고 번호를 다시 매겨야 한다
//   · 정답/오답 색(ex-right/ex-wrong)은 나열 순서가 아니라 '원래 보기 번호'로 판정
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let fail = 0;
function ok(cond, msg){ if(!cond){ fail++; console.error('  ✗', msg); } else console.log('  ✓', msg); }

// ── sdynotes.js 의 fmtExplain 만 떼어 내어 실행해 본다 ──
function loadFmtExplain(){
  const src = fs.readFileSync(path.join(root,'sdynotes.js'),'utf8');
  const start = src.indexOf("const _EX_CIRCLED='①②③④⑤⑥⑦⑧⑨⑩';");
  const end = src.indexOf('function copyPrompt()');
  if(start < 0 || end < 0) throw new Error('fmtExplain 을 찾지 못했다');
  const code = src.slice(start,end);
  const esc = (s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const box = new Function('esc', code + '\nreturn fmtExplain;')(esc);
  return box;
}
const fmtExplain = loadFmtExplain();
const NOTE = '정답은 엽록체입니다. ① 미토콘드리아 — 호흡 담당이라 틀렸습니다. ' +
             '② 엽록체 — 맞습니다. ③ 리보솜 — 단백질 합성이라 틀렸습니다. ' +
             '④ 골지체 — 포장·운송이라 틀렸습니다.';

function parse(html){
  const items = [...html.matchAll(/<div class="ex-item" data-opt="(\d+)"><span class="ex-n">(\d+)<\/span>([^<]*)</g)]
      .map(m=>({opt:+m[1], n:+m[2], text:m[3].trim()}));
  return items;
}

// 1) 순서 정보가 없으면(뒤집기 카드 · 오답 노트) 옛날 그대로 원래 번호
{
  const items = parse(fmtExplain(NOTE));
  ok(items.length === 4, `order 없음: 해설 4조각 (실제 ${items.length})`);
  ok(items.every(it=>it.n === it.opt+1), 'order 없음: 번호는 원래 보기 번호 그대로');
  ok(fmtExplain(NOTE).indexOf('class="ex-lead"') >= 0, 'order 없음: ① 앞 요약은 ex-lead 로 남는다');
}

// 2) 보기를 섞어 보여 주면 → 해설도 '화면에 보이는 순서'로 다시 나열 + 번호 재부여
{
  const order = [2,0,3,1];          // 화면 1번=원래3번, 2번=원래1번, 3번=원래4번, 4번=원래2번
  const items = parse(fmtExplain(NOTE, order));
  ok(items.length === 4, `섞임: 해설 4조각 유지 (실제 ${items.length})`);
  ok(items.map(i=>i.n).join(',') === '1,2,3,4',
     `섞임: 번호가 화면 순서대로 1,2,3,4 (실제 ${items.map(i=>i.n).join(',')})`);
  ok(items.map(i=>i.opt).join(',') === order.join(','),
     `섞임: 해설 나열도 화면 순서를 따른다 (실제 ${items.map(i=>i.opt).join(',')})`);
  // 위 보기 4번 = 원래 2번(엽록체) → 해설 4번도 엽록체여야 '같은 번호'로 보인다
  ok(items[3].opt === 1 && items[3].text.indexOf('엽록체') === 0,
     `섞임: 4번 해설 = 화면 4번 보기(엽록체) → "${items[3].text.slice(0,10)}"`);
  ok(items.every(it=>it.n === order.indexOf(it.opt)+1),
     '섞임: 모든 항목의 번호가 화면 번호와 일치');
}

// 3) 해설이 보기보다 적거나 많아도 깨지지 않는다
{
  const short = fmtExplain('① 맞는 설명 ② 아닌 설명', [1,0,2,3]);
  ok(parse(short).map(i=>`${i.n}:${i.opt}`).join(',') === '1:1,2:0',
     `해설 2개·보기 4개: 남은 항목만 화면 번호로 (실제 ${parse(short).map(i=>`${i.n}:${i.opt}`).join(',')})`);
  const plain = fmtExplain('그냥 한 문장 해설', [2,1,0]);
  ok(plain.indexOf('ex-lead') >= 0 && plain.indexOf('ex-item') < 0,
     '원문자 없는 해설은 그냥 한 줄로');
  ok(fmtExplain('') === '' && fmtExplain(null) === '', '빈 해설은 빈 문자열');
}

// 4) 실제 화면 코드가 이 계약을 지킨다
{
  const js = fs.readFileSync(path.join(root,'sdynotes.js'),'utf8');
  ok(/fmtExplain\(c\.note,c\.__order\)/.test(js),
     'pickOpt: 해설에 화면 순서(c.__order)를 넘긴다');
  ok(/ex\.querySelectorAll\('\.ex-item'\)\.forEach\(el=>\{[\s\S]{0,200}dataset\.opt/.test(js),
     'pickOpt: 정답/오답 색을 나열 순서가 아니라 data-opt(원래 보기 번호)로 판정');
  ok(!/forEach\(\(el(k)?,k\)=>el(\(k\))?\.classList\.add\(k===c\.answer/.test(js)
     && js.indexOf('k===c.answer') < 0,
     'pickOpt: 예전처럼 나열 순서(k)로 정답 색을 칠하지 않는다');
  ok(/data-opt="'\+it\.opt\+'"'\s*>|data-opt="\$\{it\.opt\}"|data-opt="'\+it\.opt\+'"'>/.test(js)
     || js.indexOf("'<div class=\"ex-item\" data-opt=\"'") >= 0,
     'fmtExplain: 각 해설에 원래 보기 번호(data-opt)를 남긴다');
  const show = js.indexOf('c.__order=order;');
  const pick = js.indexOf('fmtExplain(c.note,c.__order)');
  ok(show > 0 && pick > show, 'showCard 가 섞은 순서를 c.__order 에 저장한 뒤 pickOpt 가 쓴다');
}

if(fail){ console.error(`\n✗ ${fail}개 실패`); process.exit(1); }
console.log('\n✓ cards_explain_order_contract: ok');
