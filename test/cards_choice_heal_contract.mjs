// 암기카드 객관식 답 치유 계약
//   · 프롬프트로 만든 카드의 '정답 별표'가 엉뚱한 형태(전각 ＊, 연속 별표,
//     별표 뒤 문장부호 등)여도 답 인덱스를 정확히 찾아야 한다
//   · 과거에 잘못 저장된 카드(answer 가 틀린 인덱스)도 back 텍스트로 치유돼야 한다
//   · 보기를 섞어도 화면에 그린 버튼의 data-i(원본 인덱스)로 채점이 이뤄져야 한다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function loadServerCardsFns(){
  let src = fs.readFileSync(path.join(root,'server/src/routes/cards.js'),'utf8');
  const start = src.indexOf('// ── 객관식 카드 치유');
  const end = src.indexOf('\nexport function registerCards');
  let code = src.slice(start,end).replace(/crypto\.randomBytes\([^)]*\)\.toString\('hex'\)/g,"'ab12'");
  const box = { exports:{} };
  new Function('module','exports', code + '\nmodule.exports={parseCodeCards,normalizeChoiceCard,normalizeDeck};')(box, box.exports);
  return box.exports;
}
const { parseCodeCards, normalizeChoiceCard, normalizeDeck } = loadServerCardsFns();

let fail = 0;
function ok(cond, msg){ if(!cond){ fail++; console.error('  ✗', msg); } else console.log('  ✓', msg); }

// 1) 파서: 별표 변형 모두 인식
const cases = [
  ['반각 중간', 'M [보통] q? | 가 | 나* | 다 || 해설', 1],
  ['전각 별표',  'M [보통] q? | 가 | 나＊ | 다 || 해설', 1],
  ['맨앞 별표',  'M [보통] q? | *가 | 나 | 다 || 해설', 0],
  ['연속 별표-마지막 승리', 'M [보통] q? | 가* | 나* | 다 || 해설', 1],
  ['별표 뒤 마침표', 'M [보통] q? | 가 | 나*。 | 다 || 해설', 1],
];
for(const [name, text, expectIdx] of cases){
  const [, cards] = parseCodeCards(text);
  const c = cards[0];
  ok(c && c.answer === expectIdx && c.opts[c.answer] && !c.opts[c.answer].includes('*') && !c.opts[c.answer].includes('＊'),
     `파서: ${name} → answer=${c&&c.answer} (기대 ${expectIdx}), opts=${JSON.stringify(c&&c.opts)}`);
}

// 2) 치유: 옛 카드의 틀린 answer 를 back 텍스트로 교정
let c = { type:'choice', opts:['서울','부산','대구'], answer:2, back:'서울' };
normalizeChoiceCard(c);
ok(c.answer === 0 && c.opts[c.answer] === '서울', `back 텍스트로 답 교정: answer=${c.answer}`);

// 3) 치유: 저장된 옵션에 별표가 남아 있고 answer 가 엉뚱하면 별표 보기로 교정
c = { type:'choice', opts:['1) 틀림','2) 맞음*','3) 틀림'], answer:0, back:'1) 틀림' };
normalizeChoiceCard(c);
ok(c.answer === 1 && c.opts[1] === '2) 맞음' && c.back === '2) 맞음',
   `별표 보기로 답 교정: answer=${c.answer}, opts=${JSON.stringify(c.opts)}, back=${c.back}`);

// 4) 치유: 멀쩡한 카드는 그대로(수학 곱셈 기호 등)
c = { type:'choice', opts:['2*3=6','2+2=4','1*1=1'], answer:0, back:'2*3=6' };
normalizeChoiceCard(c);
ok(c.answer === 0 && c.opts[0] === '2*3=6', `정상 카드 유지: answer=${c.answer}, opts=${JSON.stringify(c.opts)}`);

// 5) 묶음 전체 치유
const deck = { cards:[
  { type:'choice', opts:['a','b*','c'], answer:2, back:'c' },
  { type:'flip', front:'f', back:'bk' },
  { type:'choice', opts:['x','y'], answer:0, back:'x' },
]};
const changed = normalizeDeck(deck);
ok(changed === true && deck.cards[0].answer === 1 && deck.cards[2].answer === 0,
   `덱 치유: changed=${changed}, answers=${deck.cards.map(x=>x.answer).join(',')}`);

// 6) 클라이언트 채점은 data-i(원본 인덱스) 기반이어야 섞임에 강하다
const js = fs.readFileSync(path.join(root,'sdynotes.js'),'utf8');
ok(js.indexOf('data-i="${oi}"')>=0 && js.indexOf('pickOpt(${oi},this)')>=0,
   '클라이언트: 보기 버튼이 원본 인덱스(oi)를 data-i/onclick 으로 넘긴다');
ok(/pickText===ansText|pickText\s*===?\s*ansText/.test(js),
   '클라이언트: 채점이 답 보기 텍스트 일치도 함께 본다');
ok(/healChoiceCard/.test(js), '클라이언트: 묶음 열 때 healChoiceCard 실행');

if(fail){ console.error(`\n✗ ${fail}개 실패`); process.exit(1); }
console.log('\n✓ cards_choice_heal_contract: ok');
