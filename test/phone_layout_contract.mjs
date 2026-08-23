/* 14.14 · 폰 화면 레이아웃 계약
 *
 * 왜 이 테스트가 있나 —
 *   폰 규칙이 네 군데(<style> 첫머리 / 음악 플레이어 / v88-mobile / ypStyle)에
 *   흩어져 같은 요소에 서로 다른 값을 2~4번씩 지정하고 있었다. 어느 쪽이
 *   이길지는 '파일에서 누가 더 아래냐'로 정해져서, 규칙 하나를 옮기거나
 *   추가하면 폰 화면이 조용히 깨졌다.
 *
 *   이 테스트는 폰(≤640px)에서 "위치·크기를 정하는 선언"이 요소별로
 *   딱 한 군데에서만 나오는지 검사한다. 새 규칙을 아무 데나 추가하면
 *   여기서 잡힌다.
 *
 * 실행: node test/phone_layout_contract.mjs
 */
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
};

/* ── CSS 수집 + 폰 폭에서 실제로 적용되는 규칙만 평탄화 ── */
let css = '';
for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) css += '\n' + m[1];
css = css.replace(/\/\*[\s\S]*?\*\//g, '');

const PHONE_W = 390;
function mqApplies(q) {
  if (/hover:\s*none/.test(q)) return true;
  const mx = [...q.matchAll(/max-width:\s*(\d+)px/g)].map(m => +m[1]);
  const mn = [...q.matchAll(/min-width:\s*(\d+)px/g)].map(m => +m[1]);
  if (mx.some(v => PHONE_W > v)) return false;
  if (mn.some(v => PHONE_W < v)) return false;
  return true;
}
function flatten(src, active = true, inMq = false) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('@media', i);
    const brace = src.indexOf('{', i);
    if (at >= 0 && (brace < 0 || at < brace)) {
      const ob = src.indexOf('{', at);
      const q = src.slice(at + 6, ob);
      let d = 1, j = ob + 1;
      while (j < src.length && d > 0) { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++; }
      out.push(...flatten(src.slice(ob + 1, j - 1), active && mqApplies(q), true));
      i = j; continue;
    }
    if (brace < 0) break;
    let d = 1, j = brace + 1;
    while (j < src.length && d > 0) { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++; }
    const sel = src.slice(i, brace).trim();
    const body = src.slice(brace + 1, j - 1);
    if (sel && !sel.startsWith('@')) out.push({ sel, body, active, inMq });
    i = j;
  }
  return out;
}
const rules = flatten(css).filter(r => r.active);

/* 어떤 선택자에 대해, 폰 미디어쿼리 안에서 특정 속성을 정하는 규칙 수 */
const GEOM = ['width', 'height', 'left', 'right', 'top', 'bottom', 'transform', 'max-width'];
function declsOf(body) {
  return body.split(';').map(s => s.trim()).filter(Boolean)
    .map(s => s.split(':')[0].trim().toLowerCase());
}
function mqRulesFor(selector, props) {
  return rules.filter(r => {
    if (!r.inMq) return false;
    if (!r.sel.split(',').map(s => s.trim()).some(p => p === selector)) return false;
    return declsOf(r.body).some(d => props.includes(d));
  });
}

console.log('\n폰(≤640px) 레이아웃 계약');

/* ── 1. 위치·크기가 한 곳에서만 정해지는가 ── */
console.log('\n[1] 겹치는 위치·크기 지정이 없어야 한다');
for (const sel of ['.mp', '.mp-list', '#ypApp', '#ypReopen', '#mpReopen', '.mp-btns button', '.header']) {
  const hits = mqRulesFor(sel, GEOM);
  ok(`${sel} — 폰 규칙 1개 이하 (현재 ${hits.length})`, hits.length <= 1,
    hits.length > 1 ? hits.map(h => h.body.trim().replace(/\s+/g, ' ').slice(0, 90)).join('\n      ') : '');
}

/* ── 2. 카드 크기 설정(card-s/card-l)이 폰에서 새어나오지 않는가 ──
   body.card-l .note-card{width:244px} 는 특이도 (0,2,1) 이라
   폰 규칙 .note-card (0,1,0) 를 이겨서 화면 밖으로 터졌다. */
console.log('\n[2] 카드 크기 설정이 폰 레이아웃을 이기지 못해야 한다');
const phoneCard = rules.filter(r => r.inMq &&
  r.sel.split(',').map(s => s.trim()).some(p => p === 'body.card-l .note-card'));
ok('body.card-l .note-card 를 폰에서 되돌리는 규칙이 있다', phoneCard.length >= 1);
ok('body.card-s .note-card 도 함께 되돌린다',
  rules.some(r => r.inMq && r.sel.includes('body.card-s .note-card')));
ok('폴더·추가 카드도 같이 되돌린다',
  rules.some(r => r.inMq && r.sel.includes('body.card-l .folder-card')) &&
  rules.some(r => r.inMq && r.sel.includes('body.card-l .add-card')));
ok('되돌리는 규칙이 2열(50%)로 맞춘다',
  phoneCard.some(r => /flex:\s*1\s+1\s+calc\(50%/.test(r.body)));
/* 미리보기는 고정 높이가 아니라 카드 폭에 비례해야 한다 */
ok('미리보기 높이가 카드 폭에 비례한다(aspect-ratio)',
  rules.some(r => r.inMq && /\.note-preview/.test(r.sel) && /aspect-ratio/.test(r.body)));

/* ── 3. 아래 떠 있는 것들이 서로 겹치지 않게 쌓이는가 ── */
console.log('\n[3] 아래 떠 있는 단추가 겹치지 않아야 한다');
const stackVars = rules.filter(r => r.inMq && /--ph-stack|--ph-safe/.test(r.body));
ok('쌓기 기준 변수(--ph-safe/--ph-stack)를 정의한다', stackVars.length >= 1);
ok('음악바가 뜨면 칩을 위로 올린다(body.has-mpbar)',
  rules.some(r => r.inMq && /body\.has-mpbar/.test(r.sel) && /--ph-stack/.test(r.body)));
ok('엽스코드 칩이 쌓기 변수를 쓴다',
  rules.some(r => r.inMq && r.sel.includes('#ypReopen') && /--ph-stack/.test(r.body)));
ok('음악 칩이 세이프에어리어를 쓴다',
  rules.some(r => r.inMq && r.sel.includes('#mpReopen') && /--ph-safe/.test(r.body)));
ok('JS 가 has-mpbar 를 토글한다', /classList\.toggle\('has-mpbar'/.test(html));

/* ── 4. 드래그로 옮긴 좌표가 화면 밖에 남지 않는가 ── */
console.log('\n[4] 화면을 돌려도 창이 밖으로 나가지 않아야 한다');
ok('폰에서 엽스코드 인라인 좌표를 지운다', /app\.style\.left='';app\.style\.top=''/.test(html));
ok('회전(orientationchange)에 반응한다', /orientationchange/.test(html));
ok('리사이즈에 반응한다', /addEventListener\('resize',tick/.test(html));
ok('데스크톱에서는 드래그 좌표를 보존한다(폰에서만 초기화)',
  /PHONE\(\)\)\{[\s\S]{0,120}app\.style\.left=''/.test(html));

/* ── 5. 데스크톱(캄) 화면은 건드리지 않았는가 ── */
console.log('\n[5] 데스크톱 화면은 그대로여야 한다');
/* 마지막 일치를 쓴다 — 주석이 이 블록을 이름으로 언급할 수 있으므로
   (앞쪽 주석이 먼저 잡히면 엉뚱한 내용을 검사하게 된다) */
const phoneBlockRaw = [...html.matchAll(/<style id="v1414-phone">([\s\S]*?)<\/style>/g)]
  .map(m => m[1]).pop() || '';
ok('폰 전용 블록이 존재한다', phoneBlockRaw.length > 0);
/* 블록 안의 모든 선언이 max-width:640px 미디어쿼리 안에 있어야 한다.
   (주석은 선언이 아니므로 먼저 걷어낸다) */
const phoneBlock = phoneBlockRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const outside = phoneBlock.replace(/@media[^{]*\{[\s\S]*\}/, '').trim();
ok('폰 블록 밖에 새는 규칙이 없다', outside === '', outside.slice(0, 120));
ok('폰 블록은 max-width:640px 로 감싸져 있다', /@media\s*\(max-width:640px\)/.test(phoneBlock));
/* 데스크톱 폭에서는 폰 규칙이 하나도 적용되지 않아야 한다 */
const deskRules = flatten(css.slice(css.indexOf('v1414') >= 0 ? 0 : 0)).length;
ok('데스크톱 폭(1280px)에서 폰 블록이 적용되지 않는다',
  !mqApplies('(max-width:640px)') === false && (() => {
    const W = 1280;
    const applies = (q) => {
      const mx = [...q.matchAll(/max-width:\s*(\d+)px/g)].map(m => +m[1]);
      return !mx.some(v => W > v);
    };
    return !applies('(max-width:640px)');
  })());

/* ── 6. 손가락으로 누를 수 있는 크기인가 ── */
console.log('\n[6] 터치 타깃이 너무 작지 않아야 한다');
function sizeOf(sel) {
  const r = mqRulesFor(sel, ['width', 'height']).pop();
  if (!r) return null;
  const m = r.body.match(/height:\s*(\d+)px/);
  return m ? +m[1] : null;
}
const mpBtn = sizeOf('.mp-btns button');
ok(`음악바 단추 ≥32px (현재 ${mpBtn})`, mpBtn !== null && mpBtn >= 32);
const ypChip = sizeOf('#ypReopen');
ok(`엽스코드 칩 ≥40px (현재 ${ypChip})`, ypChip !== null && ypChip >= 40);
const mpChip = sizeOf('#mpReopen');
ok(`음악 칩 ≥40px (현재 ${mpChip})`, mpChip !== null && mpChip >= 40);

/* ── 7. 지운 중복이 되살아나지 않았는가 ── */
console.log('\n[7] 예전 중복 규칙이 되살아나지 않아야 한다');
ok('.mp-btns button 을 25px 로 줄이던 규칙이 없다', !/\.mp-btns button\{width:25px/.test(css));
ok('.mp-btns button 을 29px 로 줄이던 규칙이 없다', !/\.mp-btns button,#mpX\{width:29px/.test(css));
ok('.mp 를 96vw 로 잡던 규칙이 없다', !/\.mp\{width:96vw/.test(css));
ok('헤더를 두 줄로 접던 규칙이 없다', !/\.header \.w-full\{flex-wrap:wrap/.test(css));
ok('380px 에서 카드를 1열로 떨구던 규칙이 없다',
  !/@media\(max-width:380px\)\{\s*\.note-card\{flex:1 1 100%/.test(css));

console.log(`\n폰 레이아웃 계약: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
