/* 14.18.4 · 실시간 그리기/타이핑 프레즌스 계약
   ---------------------------------------------------------------------------
   같은 노트를 여럿이 볼 때의 '실시간' 표시가 서버↔프런트 양쪽에서 지켜지는지:
     1) 펜을 긋는 도중의 획(ink)이 ping 에 실려 다른 기기로 즉시 새어 나간다
        (완성된 획을 기다리지 않는다) — 서버는 점 수/좌표/굵기를 강제로 다듬는다.
     2) mode 'draw' → 상대 화면에서 커서가 펜촉, mode 'type' → 깜빡이 캐럿.
     3) 그리는 중이 아니면 ink 는 실리지 않는다(null).
     4) 커서에는 이름표가 없다(색만) — 이름·활동은 화면 왼쪽 범례가 안내한다.
     5) 혼자 남으면(leave) 상대 목록이 비어 있고 레전드도 지워진다. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsdom from 'jsdom';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

// ── 소스 계약 ──────────────────────────────────────────────────────────────
const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(REPO, 'sdynotes.js'), 'utf8');
const css = fs.readFileSync(path.join(REPO, 'sdynotes.css'), 'utf8');
const srv = fs.readFileSync(path.join(REPO, 'server/src/routes/live.js'), 'utf8');

check('프런트: 그리는 중 획을 실시간 페이로드(liveInkPayload)로 만든다', /function liveInkPayload\(/.test(js));
check('프런트: 잉크 점은 단순화(RDP)+최대 96점으로 다듬는다', /rdpPts\(curPts,1\.1\)/.test(js) && /pts\.length>96/.test(js));
check('프런트: ping 에 mode 와 ink 를 함께 보낸다', /mode,\s*\n\s*ink:mode==='draw'\?liveInkPayload\(\):null/.test(js));
check('프런트: 글 쓰는 중엔 마우스 대신 캐럿 좌표를 보낸다', /mode==='type'\{\s*\n\s*const cp=liveCaretPos\(\);/.test(js.replace(/if\(/, 'if(')) || /if\(mode==='type'\)\{\s*const cp=liveCaretPos\(\);/.test(js));
check('프런트: 상대 잉크를 종이 위 임시 SVG(strokePath)로 그린다', /function _updateLiveInk\(/.test(js) && /strokePath\(ink\.pts\)/.test(js));
check('프런트: 펜을 뗀 뒤 잉크는 유예 뒤 지운다', /function _dropLiveInk\(/.test(js) && /3500/.test(js));
check('프런트: 커서 노드에 이름표(live-nm)를 만들지 않는다', !js.includes('live-nm'));
check('프런트: 커서 글리프 3종(화살표/펜촉/캐럿)을 모드로 바꾼다',
  /lc lc-pen ri-pen-nib-fill/.test(js) && /classList\.toggle\('draw',mode==='draw'\)/.test(js) && /classList\.toggle\('type',mode==='type'\)/.test(js));
check('프런트: 왼쪽 범례(renderLiveLegend)가 색+이름+활동을 안내한다', /function renderLiveLegend\(/.test(js) && /ll-dot/.test(js) && /\(나\)/.test(js));
check('프런트: 종료 시 잉크·범례까지 정리한다', /\[id\^="liveInk_"\]/.test(js) && /liveLegend'\); if\(lg\) lg\.remove\(\)/.test(js));
check('CSS: 커서에선 펜촉/캐럿 글리프만 보이게 토글된다', /\.live-cur\.draw \.lc-pen\{display:block;\}/.test(css) && /\.live-cur\.type \.lc-caret\{display:block;\}/.test(css));
check('CSS: 캐럿이 깜빡인다', /@keyframes liveCaretBlink/.test(css));
check('CSS: 범례는 화면 왼쪽에 고정', /\.live-legend\{[^}]*position:fixed;left:10px;/.test(css));
check('서버: ink 를 받아 다듬는다(sanitizeInk · 96점 · 유한 좌표)', /function sanitizeInk\(/.test(srv) && /out\.length < 96/.test(srv) && /Number\.isFinite/.test(srv));
check('서버: mode 는 draw/type 만 허용', /\['draw', 'type'\]\.includes\(d\.mode\)/.test(srv));
check('서버: 그리는 중이 아니면 ink 를 비운다', /mode === 'draw' \? sanitizeInk\(d\.ink\) : null/.test(srv));

// ── 런타임 계약 (서버 두 사용자 왕복) ───────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-live-'));
for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
process.env.SDY_BASE_DIR = TMP;
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (b) => (log += b));
child.stderr.on('data', (b) => (log += b));
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log.slice(-400));
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const ping = (body) => fetch(base + '/api/live/ping', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());

  const NOTE = 'note_live_contract';
  const pts = [];
  for (let i = 0; i < 120; i++) pts.push([i * 1.017, 2.3449 + Math.sin(i / 6) * 30]);
  let b = await ping({ note: NOTE, uid: 'viewer', name: '구경꾼 두루미', x: 5, y: 5, page: 0 });
  check('첫 ping 은 ok 이고 내 색을 준다', b.ok && typeof b.color === 'string' && b.color.startsWith('#'));

  // ① 그리는 중 — 잉크가 그대로 상대에게 새어 나가고, 96점 이하로 다듬어진다.
  //    peers 목록은 '받는 쪽' 응답에 들어 있으므로 viewer 가 받아 확인한다.
  await ping({ note: NOTE, uid: 'drawer', name: '그리는 사람', x: 10, y: 20, page: 0,
    act: '그리는 중', mode: 'draw', ink: { pts, color: '#f3a69e', size: 3.25, op: 0.4 } });
  b = await ping({ note: NOTE, uid: 'viewer', name: '구경꾼 두루미', x: 5, y: 5, page: 0 });
  const peer = (b.peers || []).find((p) => p.uid === 'drawer');
  check('그리는 중 잉크가 상대(viewer) 목록에 실려 온다', !!peer && !!peer.ink && Array.isArray(peer.ink.pts) && peer.ink.pts.length >= 2);
  check('점은 120개를 보내도 최대 96개로 다듬는다', peer && peer.ink.pts.length <= 96);
  check('좌표는 소수 1자리로 반올림된다', peer && peer.ink.pts.every((p) => p.every((v) => v === Math.round(v * 10) / 10)));
  check('색·굵기·불투명도가 그대로 전달된다',
    peer && peer.ink.color === '#f3a69e' && Math.abs(peer.ink.size - 3.25) < 1e-9 && Math.abs(peer.ink.op - 0.4) < 1e-9);
  check('mode "draw" 가 상대에게 전달된다', peer && peer.mode === 'draw');

  // ② 글 쓰는 중 — mode 만 바뀌고 잉크는 실리지 않는다
  await ping({ note: NOTE, uid: 'drawer', name: '그리는 사람', x: 30, y: 40, page: 0,
    act: '글 쓰는 중', mode: 'type', ink: { pts, color: '#f3a69e', size: 3, op: 1 } });
  b = await ping({ note: NOTE, uid: 'viewer', name: '구경꾼 두루미', x: 5, y: 5, page: 0 });
  const peer2 = ((b.peers || []).find((p) => p.uid === 'drawer'));
  check('mode "type" 가 전달된다', peer2 && peer2.mode === 'type');
  check('그리는 중이 아니면 잉크는 비워진다', peer2 && !peer2.ink);

  // ③ 이상한 잉크 — NaN 좌표는 버리고, 굵기·불투명도는 범위로 자른다
  await ping({ note: NOTE, uid: 'drawer', name: '그리는 사람', x: 1, y: 1, page: 0,
    mode: 'draw', ink: { pts: [[1, 1], [NaN, 2], [3, 'x'], [5, 5], [9, 9]], color: 42, size: 9999, op: 9 } });
  b = await ping({ note: NOTE, uid: 'viewer', name: '구경꾼 두루미', x: 5, y: 5, page: 0 });
  const peer3 = ((b.peers || []).find((p) => p.uid === 'drawer'));
  check('유한 좌표만 남는다(3점)', peer3 && peer3.ink.pts.length === 3);
  check('굵기·불투명도가 상한으로 잘린다', peer3 && peer3.ink.size === 200 && peer3.ink.op === 1);
  check('색이 숫자면 기본색으로 대체된다', peer3 && typeof peer3.ink.color === 'string');

  // ④ 모르는 mode 는 일반 마우스로 취급
  await ping({ note: NOTE, uid: 'drawer', name: '그리는 사람', x: 2, y: 2, page: 0, mode: 'lol' });
  b = await ping({ note: NOTE, uid: 'viewer', name: '구경꾼 두루미', x: 5, y: 5, page: 0 });
  const peer4 = ((b.peers || []).find((p) => p.uid === 'drawer'));
  check('알 수 없는 mode 는 빈 문자열로 정규화된다', peer4 && peer4.mode === '' && peer4.ink == null);

  // ⑤ 떠나면 목록이 비고, 혼자 남은 쪽에서도 더 이상 상대가 안 보인다
  await fetch(base + '/api/live/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: NOTE, uid: 'drawer' }) });
  b = await ping({ note: NOTE, uid: 'viewer', name: '구경꾼 두루미', x: 5, y: 5, page: 0 });
  check('상대가 떠나면 peers 가 비어 있다', b.ok && (b.peers || []).length === 0);

  // ── ⑥ 받는 쪽 화면(jsdom) — 잉크·펜촉·캐럿·왼쪽 범례가 실제로 그려지는지 ──
  {
    const { JSDOM, VirtualConsole } = jsdom;
    const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
    const q = (body) => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json());
    const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '실시간 잉크', color: '#4f6ef7' }], filters: [], returning: true, single: true });
    const nbId = nb.data.id;
    await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nbId, content: JSON.stringify({
      version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'p1', els: [] }],
    }), font_size: 16 }], filters: [] });

    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m); });
    vc.on('error', (...a) => errors.push(a.join(' ')));
    const d = await JSDOM.fromURL(base + '/', {
      resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(window) {
        window.innerWidth = 1280; window.innerHeight = 800;
        window.matchMedia = (query) => ({ matches: query.includes('pointer:fine'), media: query,
          addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
        window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
        window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
        window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
        window.EventSource = class { close(){} addEventListener(){} };
        window.requestIdleCallback = (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
        window.cancelIdleCallback = clearTimeout;
        window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
        window.cancelAnimationFrame = clearTimeout;
        window.scrollTo = () => {};
        window.HTMLElement.prototype.scrollIntoView = function () {};
        window.HTMLCanvasElement.prototype.getContext = () => ({});
        window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
        window.Audio = class { constructor(){ this.paused = true; } play(){ return Promise.resolve(); } pause(){} addEventListener(){} removeEventListener(){} };
        window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
        window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
        window.fetch = (input, init) => {
          const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
          return globalThis.fetch(target, init);
        };
        window.addEventListener('error', (e) => errors.push(e.error?.stack || e.message));
        window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
      },
    });
    try {
      const boot = Date.now();
      const { window } = d;
      const { document } = window;
      while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 1) await wait(60);
      const card = [...document.querySelectorAll('.note-stack .note-card')].find((c) => (c.textContent || '').includes('실시간 잉크'));
      check('jsdom: 노트 카드가 보인다', !!card);
      card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await wait(1600);

      // 상대가 그리고 있는 중 → 잉크 + 펜촉 커서 + 왼쪽 범례
      await ping({ note: nbId, uid: 'drawer', name: '그리는 사람', x: 120, y: 90, page: 0,
        act: '그리는 중', mode: 'draw', ink: { pts: [[10, 10], [80, 60], [140, 40]], color: '#f3a69e', size: 3, op: 1 } });
      let t0 = Date.now();
      let cur = null;
      while (Date.now() - t0 < 4_000 && !(cur = document.getElementById('live_drawer'))) await wait(80);
      check('jsdom: 그리는 상대 커서가 보인다', !!cur);
      check('jsdom: 커서가 펜 모양(draw)으로 바뀐다', cur && cur.classList.contains('draw') && !!cur.querySelector('.lc-pen'));
      check('jsdom: 커서에 이름 라벨이 없다(색만)', cur && !cur.querySelector('.live-nm'));
      const inkSvg = document.getElementById('liveInk_drawer');
      check('jsdom: 그리는 획이 종이 위 임시 SVG 로 실시간 보인다', !!inkSvg && /^M /.test(inkSvg.firstChild.getAttribute('d') || ''));
      check('jsdom: 잉크 색·굵기가 상대 설정 그대로다',
        inkSvg && inkSvg.firstChild.getAttribute('stroke') === '#f3a69e' && inkSvg.firstChild.getAttribute('stroke-width') === '3');
      const lg = document.getElementById('liveLegend');
      check('jsdom: 왼쪽 범례에 상대 이름과 내 이름이 함께 있다',
        !!lg && (lg.textContent || '').includes('그리는 사람') && (lg.textContent || '').includes('(나)'));

      // 상대가 글 쓰기 시작 → 펜 대신 깜빡이 캐럿, 잉크는 사라진 예약
      await ping({ note: nbId, uid: 'drawer', name: '그리는 사람', x: 200, y: 200, page: 0,
        act: '글 쓰는 중', mode: 'type' });
      t0 = Date.now();
      while (Date.now() - t0 < 4_000 && !(cur && cur.classList.contains('type'))) { cur = document.getElementById('live_drawer'); await wait(80); }
      check('jsdom: 글 쓰는 상대는 깜빡이 캐럿(type)으로 보인다',
        cur && cur.classList.contains('type') && !!cur.querySelector('.lc-caret') && !cur.classList.contains('draw'));
      await wait(4200);   // 잉크 유예(3.5초) 지나면 사라진다
      check('jsdom: 펜을 뗀 뒤 잉크는 유예 시간 뒤 지워진다', !document.getElementById('liveInk_drawer'));

      check('jsdom: 런타임 오류 없음', errors.length === 0);
    } finally {
      try { d.window.close(); } catch {}
    }
  }

  console.log(`실시간 프레즌스 계약: PASS ${pass}`);
} catch (e) {
  console.error('FAIL:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await wait(300);
  try { child.kill('SIGKILL'); } catch {}
  process.exit(process.exitCode || 0);
}
