/* 스크래치: 사용자 '글꼴 풀림' 시나리오 재현 — 상자를 고른 뒤
   ① 글자 크기 변경 ② 형광펜 ③ 글씨색 ④ 볼드 ⑤ 기울임 → 어느 단계에서
   el.font / content.style.fontFamily 가 사라지는지 확인한다. */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-fnt-'));
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '글꼴 재현', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 220, h: 70, html: '안녕하세요 반갑습니다', fontSize: 16, font: 'jua' }] }] };
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
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('글꼴 재현'));
  assert.ok(card, '카드');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1800);
  assert.ok(document.getElementById('editorView').classList.contains('open'), '에디터 열림');

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = document.querySelector('#pagesStage .tb');
  const content = tb && tb.querySelector('.tb-content');
  assert.ok(content, '상자 존재');

  const fontNow = () => content.style.fontFamily || '(none)';
  const elFontNow = () => {
    const el = document.querySelector('#pagesStage .tb');
    const pi = +el.dataset.pageIdx; const id2 = el.dataset.id;
    const pg = window.sdyDoc && window.sdyDoc.pages ? window.sdyDoc.pages[pi] : null;
    return pg ? (pg.els.find(e => e.id === id2) || {}).font : '?';
  };
  console.log('초기 el.font(모델) =', elFontNow(), '| content.fontFamily =', fontNow());

  // 상자 선택
  content.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 60, clientY: 60 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(100);
  console.log('선택됨:', tb.classList.contains('sel'));

  // ① 글자 크기 변경
  window.setFS(24);
  await wait(200);
  console.log('①크기변경 후: el.font =', elFontNow(), '| content.fontFamily =', fontNow(),
    '| content.fontSize =', content.style.fontSize);
  assert.match(fontNow(), /Jua/, '① 글꼴 유지');

  // ② 형광펜 (상자 전체)
  window.applyHighlight('#ffff00');
  await wait(200);
  console.log('②형광펜 후: el.font =', elFontNow(), '| content.fontFamily =', fontNow());
  assert.match(fontNow(), /Jua/, '② 글꼴 유지');

  // ③ 글씨색 (상자 전체)
  window.applyTextColor('#e74c3c');
  await wait(200);
  console.log('③글씨색 후: el.font =', elFontNow(), '| content.fontFamily =', fontNow());
  assert.match(fontNow(), /Jua/, '③ 글꼴 유지');

  // ④ 볼드 (선택 없이 상자 선택됨 → box 전체여야... execFmt는 withSelection 필요)
  window.saveSel(); // collapse면 무시
  window.execFmt('bold');
  await wait(200);
  console.log('④볼드 후: el.font =', elFontNow(), '| content.fontFamily =', fontNow());
  assert.match(fontNow(), /Jua/, '④ 글꼴 유지');

  // ⑤ 기울임 — 텍스트를 선택해서
  const r = document.createRange();
  const txt = content.firstChild;
  if (txt && txt.nodeType === 3) { r.setStart(txt, 0); r.setEnd(txt, 2); }
  else { r.selectNodeContents(content); }
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
  window.saveSel();
  window.execFmt('italic');
  await wait(200);
  console.log('⑤기울임 후: el.font =', elFontNow(), '| content.fontFamily =', fontNow(),
    '| html =', content.innerHTML.slice(0, 160));
  assert.match(fontNow(), /Jua/, '⑤ 글꼴 유지');

  // ── 모델 저장 검증: 400ms saveDoc flush 후 localStorage 원본 모델에 font 가 남는가 ──
  await wait(700);
  const KEY='nb_'+id;
  const cfg=JSON.parse(window.localStorage.getItem(KEY)||'{}');
  const elsSaved=((cfg.pages||[]).find(p=>p.id==='p1')||{}).els||[];
  const m=elsSaved.find(e=>e.id==='t1');
  console.log('저장 모델: font =', m && m.font, '| html =', m && m.html.slice(0,120));
  assert.equal(m && m.font, 'jua', '저장 모델 font 유지');
  assert.match(m && m.html || '', /font-style/, '저장 html 에 기울임이 남는다');


  console.log('런타임 오류:', errors.length ? errors.slice(0,3) : '없음');
  console.log('모델 저장 검증 통과');
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await wait(200);
  try { child.kill('SIGKILL'); } catch {}
  closeDoms([dom]);
  process.exit(0);
}
