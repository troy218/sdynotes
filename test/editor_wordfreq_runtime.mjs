/* 14.39.5 · 중요어 색칠 런타임 — 사용자 보고 "너무 산만하다"
 *
 * 계약 테스트(editor_wordfreq_contract.mjs)가 고르는 규칙을 지킨다면,
 * 이 파일은 '진짜 편집기'에서 눈에 보이는 결과를 지킨다.
 *   ① 색칠을 켜면 종이 위 .wf 는 몇 종류(기본 8) 안쪽이다
 *   ② 조사·용언 활용형·한두 번 스친 낱말에는 색이 닿지 않는다
 *   ③ 색은 3단계(굵기 600·700·800)만 쓰고, 배경 강조는 최상위(.top)에만 있다
 *   ④ 안내 띠의 −/＋ 로 개수를 줄이면 화면의 색도 곧바로 줄어든다
 *   ⑤ 목록에서 안 칠한 낱말을 눌러 보면 그 낱말만 노랗게 짚어 준다
 *   ⑥ 색칠은 화면 전용 — 저장 원문(el.html)에는 .wf 가 스며들지 않는다
 *   ⑦ 끄면 색이 남김없이 사라진다
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
const { JSDOM, VirtualConsole } = jsdom;
const wait = ms => new Promise(r => setTimeout(r, ms));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-wordfreq-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
  fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
    const from = path.join(REPO, 'src', f), to = path.join(TMP, 'src', f);
    if (fs.statSync(from).isDirectory()) continue; // src/app 메가파트는 번들된 sdynotes.js 로만 제공
    fs.copyFileSync(from, to);
  }
}
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}

// ── 견본 노트: 주제어가 또렷한 보통 학습 노트 ───────────────────────────────
const THEMES = ['광합성', '엽록체', '이산화탄소', '포도당'];
const FILLER = ['자료', '관찰', '수업', '노트', '질문', '토론', '숙제', '준비물', '교과서', '연습'];
const lines = [];
for (let i = 0; i < 40; i++) {
  const a = THEMES[i % THEMES.length], b = THEMES[(i + 1) % THEMES.length];
  lines.push(`${a}은 빛을 받아 일어나고 ${b}와 함께 살펴보면 중요한 내용이 정리된다`);
  lines.push(`${FILLER[i % FILLER.length]}${i} 를 적어 두었고 오늘 수업에서 필요하다고 했다`);
}
const pages = [];
for (let p = 0; p < 2; p++) {
  pages.push({
    id: `p${p + 1}`,
    els: lines.slice(p * 40, p * 40 + 40).map((t, i) => ({
      type: 'text', id: `t${p}_${i}`, x: 40, y: 40 + i * 20, w: 500, h: 24,
      html: t, fontSize: 16, font: 'jua',
    })),
  });
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
let dom;
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '중요어', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){}, save(){}, restore(){}, scale(){}, translate(){}, setTransform(){}, measureText(){return {width:10}}, getImageData(){return {data:new Uint8ClampedArray(4)}}, putImageData(){} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  });
  const { window } = dom, { document } = window;
  const boot = Date.now();
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 1) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('중요어'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1800);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const spans = () => [...document.querySelectorAll('#pagesStage .wf')];
  const kinds = () => new Set(spans().map(s => s.dataset.k));

  // ══ ① 색칠 켜기 ═══════════════════════════════════════════════════════
  window.toggleWordFreq();
  await wait(400);
  check('색칠이 켜진다', document.getElementById('editorView').classList.contains('wf-on'));
  check('종이 위에 색칠된 낱말이 생긴다', spans().length > 0);
  check('칠해진 낱말 종류가 기본 8개를 넘지 않는다', kinds().size > 0 && kinds().size <= 8);

  // ══ ② 산만함의 원인이던 말에는 색이 닿지 않는다 ═════════════════════════
  const painted = new Set(spans().map(s => s.textContent));
  const noisy = ['그리고', '중요한', '살펴보면', '필요하다고', '내용이', '오늘', '적어', '두었고',
    '일어나고', '함께', '받아', '했다'];
  check('조사·용언 활용형·흔한 말은 칠하지 않는다',
    noisy.every(w => ![...painted].some(p => p === w)));
  check('한두 번 스친 낱말(자료0 같은 것)은 칠하지 않는다',
    ![...painted].some(p => /^(자료|관찰|숙제)\d+$/.test(p)));
  check('문서를 관통하는 주제어는 칠한다',
    THEMES.some(t => [...painted].some(p => p.startsWith(t))));

  // ══ ③ 3단계 색만 쓴다 ═════════════════════════════════════════════════
  const weights = new Set(spans().map(s => s.style.fontWeight));
  check('굵기는 세 갈래(600·700·800)뿐이다',
    weights.size <= 3 && [...weights].every(w => ['600', '700', '800'].includes(w)));
  check('배경 강조는 최상위 단계(.top)에만 붙는다',
    spans().every(s => !s.classList.contains('hot')) || spans().some(s => s.classList.contains('top')));

  // ══ ④ 안내 띠에서 개수 줄이기 ═════════════════════════════════════════
  const bar = document.getElementById('wfBar');
  check('안내 띠가 보인다', bar.classList.contains('show'));
  check('안내 띠가 칠한 개수를 알려 준다', /중요어 \d+개/.test(document.getElementById('wfInfo').textContent));
  const before = kinds().size;
  const minus = [...bar.querySelectorAll('button')].find(b => b.textContent.trim() === '−');
  minus.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(350);
  check('−를 누르면 칠하는 낱말이 줄어든다', kinds().size < before || before <= 3);
  check('띠의 개수 표시도 함께 바뀐다', document.getElementById('wfTopLbl').textContent === '6개');

  // ══ ⑤ 목록에서 안 칠한 낱말 짚어 보기 ═════════════════════════════════
  const dimItem = document.querySelector('#sidePanel .wf-item.dim') || document.querySelector('.wf-item.dim');
  if (dimItem) {
    dimItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(350);
    check('목록에서 고른 낱말만 노랗게 짚어 준다', spans().some(s => s.classList.contains('pick')));
    check('짚어 본 낱말 하나만 더해질 뿐 색칠은 여전히 적다', kinds().size <= 7);
  }

  // ══ ⑥ 저장 원문은 그대로 ═══════════════════════════════════════════════
  // 색칠한 채로 저장해도 서버에 남는 본문에는 .wf 가 스며들면 안 된다.
  window.saveDoc();
  await wait(1500);
  const saved = await q({ table: 'memos', op: 'select', values: [],
    filters: [{ field: 'notebook_id', op: 'eq', value: String(id) }], limit: 1, single: true });
  const savedText = JSON.stringify(saved && saved.data || {});
  check('색칠한 채 저장해도 서버 본문에 .wf 가 스며들지 않는다', !/class=\\?"wf/.test(savedText));
  check('저장된 본문에 원래 글자는 그대로 남는다', savedText.includes('광합성'));
  check('stripWF 가 색칠 레이어를 걷어 낸다',
    !/class="wf/.test(window.stripWF('<span class="wf" data-k="광합성">광합성</span>은 빛')));

  // ══ ⑦ 끄기 ════════════════════════════════════════════════════════════
  window.wfOff();
  await wait(400);
  check('끄면 색이 남김없이 사라진다', spans().length === 0);
  check('본문 글자는 그대로 남는다',
    (document.querySelector('#pagesStage .tb[data-id="t0_0"] .tb-content').textContent || '').includes('광합성'));

  check('치명적 런타임 오류가 없다', errors.length === 0);
  console.log(`\n중요어 색칠 런타임: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  console.error('server log:\n' + log);
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await closeDoms([dom]);
}
