/* 스크래치: 텍스트 서식의 두 기대 동작 확인
   A) 글자 일부만 선택 → 선택한 부분에만 적용 (기존 동작 유지)
   B) 편집 중(캐럿, 선택 없음) 색/글꼴/크기/볼드 변경 →
      상자 전체가 아니라 '앞으로 입력될 글자'에만 적용
   모델(el.font)·content.style 은 그대로여야 한다. */
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

const LOGF = '/tmp/scratch_typing.log';
import { appendFileSync as _af } from 'node:fs';
fs.writeFileSync(LOGF, '');
const _g = globalThis;
_g.console = { ..._g.console, log: (...a) => _af(LOGF, a.map(String).join(' ') + '\n'), error: (...a) => _af(LOGF, 'ERR: ' + a.map(String).join(' ') + '\n') };

const _glog = (...a) => _af(LOGF, a.map(String).join(' ') + '\n');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-typ-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
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
let dom = null;
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '타이핑 서식', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 260, h: 70, html: '안녕하세요 반갑습니다', fontSize: 16, font: 'jua' }] }] };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m); });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
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
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('타이핑 서식'));
  assert.ok(card, '카드');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1800);
  assert.ok(document.getElementById('editorView').classList.contains('open'), '에디터 열림');

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = document.querySelector('#pagesStage .tb');
  const content = tb.querySelector('.tb-content');
  const KEY = 'nb_' + id;
  const savedEl = () => {
    const cfg = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    return ((cfg.pages || []).find(p => p.id === 'p1') || {}).els?.find(e => e.id === 't1');
  };
  const modelFont = () => savedEl()?.font;
  const boxFont = () => content.style.fontFamily || '';
  const boxSize = () => content.style.fontSize || '';

  // ── A: 부분 선택 서식 (기존 동작) ──
  content.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  await wait(200);
  assert.ok(tb.classList.contains('edit'), '편집 상태');
  const r = document.createRange();
  const tn = content.firstChild;
  r.setStart(tn, 0); r.setEnd(tn, 2);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
  window.saveSel();
  window.applyTextColor('#e74c3c');
  await wait(150);
  _glog('A) 부분선택 색 후 html =', content.innerHTML.slice(0, 200));
  assert.match(content.innerHTML, /<span[^>]*color[^>]*>안녕/, 'A: 선택 구간만 span');
  assert.doesNotMatch(content.innerHTML, /color[^>]*>[^<]*다/, 'A: 나머지 글자엔 색 없음');

  // ── B: 캐럿(선택 없음) 서식 → 상자 전체가 아니라 앞으로 입력될 글자 ──
  // 캐럿을 끝으로 접기
  const r2 = document.createRange();
  r2.setStart(content.lastChild, content.lastChild.nodeValue.length);
  r2.collapse(true);
  sel.removeAllRanges(); sel.addRange(r2);
  window.saveSel();
  await wait(50);

  window.applyTextColor('#e74c3c');
  await wait(150);
  _glog('B1) 색 후 html =', content.innerHTML.slice(0, 260), '| box.font =', boxFont(), '| model.font =', modelFont());
  // 맨 뒤(캐럿)에 '빈' 색 span 이 생기고, 기존 글자는 감싸지지 않아야 한다
  assert.match(content.innerHTML, /<span class="sdy-type" style="color: rgb\(231, 76, 60\);"><\/span>$/, 'B1: 캐럿에 빈 색 span');
  assert.match(content.innerHTML, /안녕<\/span>하세요 반갑습니다/, 'B1: 기존 글자 전체를 감싸지 않음');
  assert.equal(modelFont(), 'jua', 'B1: 모델 font 유지');
  assert.match(boxFont(), /Jua/, 'B1: 상자 font 유지');

  window.applyFont('noto');
  await wait(150);
  _glog('B2) 글꼴 후 html =', content.innerHTML.slice(0, 260), '| model.font =', modelFont(), '| box.font =', boxFont());
  assert.equal(modelFont(), 'jua', 'B2: 모델 font 유지');
  assert.match(boxFont(), /Jua/, 'B2: 상자 font 유지');
  assert.match(content.innerHTML, /font-family/, 'B2: 캐럿 span 에 글꼴');

  window.setFS(24);
  await wait(150);
  _glog('B3) 크기 후 html =', content.innerHTML.slice(0, 260), '| box.size =', boxSize());
  assert.equal(boxSize(), '16px', 'B3: 상자 크기 유지');
  assert.match(content.innerHTML, /font-size/, 'B3: 캐럿 span 에 크기');

  window.execFmt('bold');
  await wait(150);
  _glog('B4) 볼드 후 html =', content.innerHTML.slice(0, 300));
  assert.match(content.innerHTML, /font-weight/, 'B4: 캐럿 span 에 볼드');

  window.applyHighlight('#ffff00');
  await wait(150);
  _glog('B5) 형광펜 후 html =', content.innerHTML.slice(0, 320));
  assert.match(content.innerHTML, /background-color/, 'B5: 캐럿 span 에 형광펜');

  // 볼드 다시 → 토글 해제(앞으로 입력될 글자는 일반)
  window.execFmt('bold');
  await wait(150);
  _glog('B6) 볼드 재토글 후 html =', content.innerHTML.slice(0, 340));
  const sp = content.querySelector('span.sdy-type');
  assert.ok(sp, 'B6: sdy-type span 존재');
  const ssp = sp.getAttribute('style') || '';
  assert.ok(/font-weight:\s*400/.test(ssp), 'B6: 볼드 토글 해제(400)');
  assert.ok(/color/.test(ssp) && /font-family/.test(ssp) && /font-size/.test(ssp) && /background-color/.test(ssp), 'B6: 다른 서식은 유지');

  // ── C: '이후 입력되는 글자' 검증 — 캐럿 span 안에 글자를 입력하면 ──
  //     그 글자만 서식을 갖고, 기존 글자·상자·모델은 불변
  sp.appendChild(document.createTextNode('가나다'));
  content.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(500);   // 입력 디바운스(300ms) → syncTextEl → saveDoc

  _glog('C) 입력 후 html =', content.innerHTML.slice(0, 400), '| box.font =', boxFont(), '| box.size =', boxSize(), '| model.font =', modelFont());
  assert.match(content.innerHTML, /<span class="sdy-type" style="[^"]*color[^"]*">가나다<\/span>$/, 'C: 입력 글자만 서식 span 안');
  assert.match(content.innerHTML, /안녕<\/span>하세요 반갑습니다/, 'C: 기존 글자 불변');
  assert.match(boxFont(), /Jua/, 'C: 상자 font 유지');
  assert.equal(boxSize(), '16px', 'C: 상자 크기 유지');

  const m = savedEl();
  _glog('저장 모델 font =', m && m.font, '| html =', m && m.html.slice(0, 260));
  assert.equal(m && m.font, 'jua', '저장 모델 font 유지');
  assert.match(m && m.html || '', /class="sdy-type" style="[^"]*color[^"]*">가나다/, '저장 html 에 서식+입력 글자 유지');

  _glog('런타임 오류:', errors.length ? errors.slice(0, 3) : '없음');
  _glog('PASS — 부분선택 vs 캐럿 서식 모두 기대 동작');
} catch (e) {
  _af(LOGF, 'CAUGHT: ' + (e && e.stack || e) + '\n');
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await wait(200);
  try { child.kill('SIGKILL'); } catch {}
  closeDoms([dom]);
  process.exit(0);
}
