/* 14.39.5 · 중요어 색칠 — "너무 산만하다"(사용자 보고) 회귀 검증
 *
 * 예전 동작: 두 번 이상 나온 '모든' 낱말을 6색·5굵기로 칠했다.
 *   → 조금만 긴 노트면 수백 개 낱말이 알록달록해져 본문을 읽을 수 없었다.
 *
 * 지금 동작(이 파일이 지킨다):
 *   ① 점수(빈도 × 퍼진 정도 × 낱말 구체성) 상위 wfTopN 개(기본 8)만 칠한다
 *   ② 문서가 길수록 최소 등장 횟수 기준(wfMin)이 저절로 올라간다
 *   ③ 칠하는 글자 비율이 본문의 아주 일부(5% 미만)로 유지된다
 *   ④ 색 단계는 3단계뿐이다 (6색·5굵기 그라데이션 폐기)
 *   ⑤ 화면 색칠 레이어(.wf)는 여전히 저장 원문을 건드리지 않는다
 *
 * 방법: 번들(sdynotes.js)에서 순수 로직 구간을 잘라 내 실제로 실행한다.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};

// ── 순수 로직 구간 잘라 내기 ────────────────────────────────────────────────
const from = js.indexOf('    function stripWF(html){');
const to = js.indexOf('    function toggleWordFreq(');
assert.ok(from > 0 && to > from, '중요어 분석 로직 구간을 찾지 못했다');
const logic = js.slice(from, to);

const makeWF = (docObj) => new Function('doc', 'elPlainText', 'document', `
  let wfStats=[], wfMap=null, wfPick=null, wfMin=2;
  let wfTopN=8, wfSel=new Map(), wfExtra=new Set(), wfCand=[], wfTotal=0;
  ${logic}
  return {
    wfAnalyze, wfSelect, wfScore, wfTokens, wfStem, wfValid, wfColor, wfTier, wfPaintable, wfKey,
    setTop:(v)=>{wfTopN=v;}, state:()=>({wfStats,wfCand,wfSel,wfMin,wfTopN,wfTotal}),
  };
`)(docObj, (el) => String(el.text || ''), {
  createElement: () => ({ innerHTML: '', normalize() {}, querySelectorAll: () => [] }),
});

// ── 견본 문서: 길고 평범한 학습 노트 ───────────────────────────────────────
// 주제어 몇 개(문서를 관통) + 흔한 일반 낱말 수백 개 + 두어 번 스치는 잡낱말.
// 예전 규칙(2번 이상 전부 색칠)이라면 본문 대부분이 파랗게 물든다.
let seed = 20240908;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const themes = ['광합성', '엽록체', '이산화탄소', '포도당', '명반응'];
const fillers = Array.from({ length: 260 }, (_, i) => `용어${i}`);
const tails = ['을 정리했다', '를 확인하였다', '는 실험에서 나타난다', '와 관계가 깊다', '도 기록해 두자'];
const pages = [];
for (let p = 0; p < 5; p++) {
  const els = [];
  for (let l = 0; l < 26; l++) {
    const ws = [];
    for (let k = 0; k < 9; k++) {
      ws.push(rnd() < 0.16
        ? themes[Math.floor(rnd() * themes.length)]
        : fillers[Math.floor(Math.pow(rnd(), 1.7) * fillers.length)]);
    }
    els.push({ type: 'text', id: `t${p}_${l}`, text: ws.join(' ') + ' ' + tails[Math.floor(rnd() * tails.length)] });
  }
  pages.push({ els });
}
const wf = makeWF({ pages });
wf.wfAnalyze();
let st = wf.state();

// ── ① 칠하는 낱말 개수 상한 ────────────────────────────────────────────────
check('색칠 대상은 wfTopN(기본 8)개를 넘지 않는다',
  st.wfSel.size <= st.wfTopN && st.wfSel.size > 0, `sel=${st.wfSel.size}`);
check('후보(기준 통과 낱말)는 많아도 칠하는 것만 추린다',
  st.wfCand.length >= st.wfSel.size, `cand=${st.wfCand.length} sel=${st.wfSel.size}`);

// ── ② 문서가 길면 '두 번 나온 말'은 중요어가 아니다 ────────────────────────
check('긴 문서에서는 최소 등장 횟수 기준이 2보다 높아진다',
  st.wfMin >= 3, `wfMin=${st.wfMin} total=${st.wfTotal}`);
const rare = st.wfStats.filter(s => s.n === 2).slice(0, 5);
check('두어 번 스친 낱말은 칠하지 않는다',
  rare.length > 0 && rare.every(s => !wf.wfPaintable(s.key)));
check('문서를 관통하는 주제어는 칠한다',
  themes.every(t => wf.wfPaintable(t)),
  themes.filter(t => !wf.wfPaintable(t)).join(','));

// ── ③ 실제로 칠해지는 글자 비율 ────────────────────────────────────────────
const allText = pages.flatMap(p => p.els.map(e => e.text)).join('\n');
const toks = wf.wfTokens(allText);
const painted = toks.filter(t => wf.wfPaintable(t.key));
// 예전 규칙: 기준(2번) 이상 나온 낱말을 전부 칠했다
const legacy = toks.filter(t => (wf.state().wfStats.find(s => s.key === t.key) || { n: 0 }).n >= 2);
const kinds = new Set(painted.map(t => t.key)).size;
const legacyKinds = new Set(legacy.map(t => t.key)).size;
check('칠하는 낱말 종류가 예전의 1/10 이하로 줄었다',
  kinds <= legacyKinds / 10, `${kinds}종 (예전 ${legacyKinds}종)`);
check('색이 닿는 글자도 예전의 1/3 이하다',
  painted.length <= legacy.length / 3,
  `${(painted.length / toks.length * 100).toFixed(1)}% (예전 ${(legacy.length / toks.length * 100).toFixed(1)}%)`);
check('칠해지는 낱말 종류는 손에 꼽는다(≤8종)', kinds <= 8, `${kinds}종`);

// ── ④ 색 단계는 3단계 ──────────────────────────────────────────────────────
const tiers = new Set([...st.wfSel.keys()].map(k => wf.wfTier(k)));
check('색 단계는 0·1·2 세 단계뿐이다',
  [...tiers].every(t => t === 0 || t === 1 || t === 2) && tiers.size <= 3,
  [...tiers].join(','));
const weights = new Set([...st.wfSel.keys()].map(k => wf.wfColor(k).w));
check('굵기도 세 갈래를 넘지 않는다 (예전 500~900 다섯 갈래 폐기)',
  weights.size <= 3 && [...weights].every(w => w >= 600 && w <= 800), [...weights].join(','));
const topKey = [...st.wfSel.entries()].find(([, r]) => r === 0)[0];
check('가장 중요한 낱말이 가장 진하다', wf.wfTier(topKey) === 2);
check('고르지 않은 낱말은 색 정보를 물어도 가장 옅은 단계다',
  wf.wfColor('없는낱말키').t === 0);

// ── ⑤ 점수: 빈도가 같으면 여러 쪽에 퍼진 말이 더 중요하다 ──────────────────
const spreadOut = wf.wfScore({ word: '분포', n: 6, pages: 4 });
const clumped = wf.wfScore({ word: '분포', n: 6, pages: 1 });
check('같은 횟수라면 문서 전체에 퍼진 낱말의 점수가 높다', spreadOut > clumped,
  `${spreadOut.toFixed(2)} vs ${clumped.toFixed(2)}`);
check('같은 조건이면 구체적인(긴) 낱말의 점수가 높다',
  wf.wfScore({ word: '자기상관', n: 5, pages: 2 }) > wf.wfScore({ word: '결과', n: 5, pages: 2 }));

// ── ⑥ 개수 조절 ────────────────────────────────────────────────────────────
wf.setTop(3); wf.wfSelect(); st = wf.state();
check('개수를 3개로 줄이면 딱 3개만 칠한다', st.wfSel.size === 3, `sel=${st.wfSel.size}`);
wf.setTop(24); wf.wfSelect(); st = wf.state();
check('개수를 늘려도 기준을 통과한 후보 수를 넘지 않는다',
  st.wfSel.size === Math.min(24, st.wfCand.length));

// ── ⑦ 짧은 노트에서는 기준이 도로 내려간다 ─────────────────────────────────
const small = makeWF({ pages: [{ els: [
  { type: 'text', id: 'a', text: '광합성은 빛에너지를 씁니다. 광합성 실험을 했습니다.' },
  { type: 'text', id: 'b', text: '엽록체 안에서 광합성이 일어난다. 엽록체 관찰.' },
] }] });
small.wfAnalyze();
const ss = small.state();
check('짧은 노트는 기준이 2번으로 내려가 핵심어를 놓치지 않는다', ss.wfMin === 2, `wfMin=${ss.wfMin}`);
check('짧은 노트에서도 반복된 핵심어를 칠한다', small.wfPaintable('광합성'));
check('짧은 노트에서 한 번만 나온 말은 칠하지 않는다', !small.wfPaintable('빛에너지'));

// ── ⑦-2 한 글자 차이로 쪼개진 낱말 합치기 ─────────────────────────────────
const split = makeWF({ pages: [{ els: [
  { type: 'text', id: 'a', text: '캘빈회로가 진행된다. 캘빈회로는 이산화탄소를 고정한다.' },
  { type: 'text', id: 'b', text: '정리하면 캘빈회로 한 단계다. 캘빈회로 그림을 그려 두자.' },
] }] });
split.wfAnalyze();
const splitStats = split.state().wfStats;
check('조사처럼 보이는 끝 글자 때문에 낱말이 둘로 갈리지 않는다',
  splitStats.filter(s => s.word && s.word.startsWith('캘빈회')).length === 1,
  splitStats.filter(s => s.word && s.word.startsWith('캘빈회')).map(s => `${s.word}:${s.n}`).join(','));
check('합쳐진 낱말의 이름은 잘리지 않은 쪽을 쓴다',
  (splitStats.find(s => s.word && s.word.startsWith('캘빈회')) || {}).word === '캘빈회로');
check('조사가 붙은 꼴도 같은 낱말로 칠해진다',
  split.wfTokens('캘빈회로가 캘빈회로 캘빈회로는').every(t => split.wfPaintable(t.key)));

// ── ⑧ 거르기 규칙 ──────────────────────────────────────────────────────────
check('조사·접속사 같은 기능어는 애초에 세지 않는다',
  !wf.wfValid('그리고') && !wf.wfValid('하지만') && !wf.wfValid('입니다'));
check('뜻이 옅은 일반 명사도 거른다(내용·부분·정도·자체)',
  ['내용', '부분', '정도', '자체'].every(w => !wf.wfValid(w)));
check('영어 흔한 말도 거른다(about·these·using)',
  ['about', 'these', 'using'].every(w => !wf.wfValid(w)));
check('한 글자·숫자만 있는 토큰은 세지 않는다',
  !wf.wfValid('가') && !wf.wfValid('123') && !wf.wfValid('3쪽'));
check('용언 활용형은 중요어가 아니다(필요하다·살펴보면·중요한·아름답다)',
  ['필요하다', '살펴보면', '중요한', '아름답다'].every(w => !wf.wfValid(wf.wfStem(w))),
  ['필요하다', '살펴보면', '중요한', '아름답다'].filter(w => wf.wfValid(wf.wfStem(w))).join(','));
check('그래도 명사는 잘리지 않는다(보고서·이미지·냉장고·외국인·포함)',
  ['보고서를', '이미지가', '냉장고에', '외국인', '포함'].every(w => wf.wfValid(wf.wfStem(w))),
  ['보고서를', '이미지가', '냉장고에', '외국인', '포함'].filter(w => !wf.wfValid(wf.wfStem(w))).join(','));
check('용언에 묻힌 명사는 살려서 같이 센다(검토하였다→검토 · 기록해→기록)',
  wf.wfStem('검토하였다') === '검토' && wf.wfStem('기록해') === '기록'
  && wf.wfStem('제한된') === '제한');

// ── ⑨ 소스 계약: 화면 전용 레이어·UI 배선 ─────────────────────────────────
check('색칠은 고른 중요어만 대상으로 한다(예전 빈도 필터 제거)',
  js.includes('wfTokens(text).filter(t=>wfPaintable(t.key))')
  && !js.includes('wfTokens(text).filter(t=>(wfMap.get(t.key)||0)>=wfMin)'));
check('저장 경로는 여전히 stripWF 로 색을 걷어 낸다',
  js.includes('function stripWF(html)') && js.includes('imathCollapse(stripWF(c.innerHTML))'));
check('개수 조절 함수 wfSetTop 이 3~24 로 묶여 있다',
  /function wfSetTop\(v\)\{[\s\S]{0,160}Math\.max\(3,Math\.min\(24,/.test(js));
check('고른 개수는 다음에도 이어 쓰도록 저장한다',
  js.includes("localStorage.setItem('sdy_wf_top'") && js.includes("localStorage.getItem('sdy_wf_top')"));

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
check('안내 띠의 ±는 이제 "몇 개를 칠할지"를 조절한다',
  html.includes('wfSetTop(wfTopN-2)') && html.includes('wfSetTop(wfTopN+2)')
  && html.includes('id="wfTopLbl"') && !html.includes('wfSetMin('));

const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
check('배경 강조는 최상위 단계에만 옅게 남긴다',
  /\.wf\.hot\{background:transparent;\}/.test(css)
  && /\.wf\.top\{background:rgba\(23,58,150,\.09\);\}/.test(css));

console.log(`\n중요어 색칠(산만함 수정) — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
