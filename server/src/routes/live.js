// 실시간 커서 공유 (같은 노트를 여럿이 볼 때) + SSE 이벤트 스트림.
import { subscribe, unsubscribe } from '../lib/sse.js';
// 14.13.4 · 이름에 든 색 이름(복숭아빛 등)과 커서 색을 맞춤 → lib/pastel.js
import { pickPastel } from '../lib/pastel.js';

const LIVE_TTL = 12; // seconds

const live = new Map(); // note -> Map(uid -> {...})

// 14.18.4 · 실시간 그리기 미리보기(잉크) — 펜을 긋는 도중의 획을 다른 기기에
//   획 단위 완성을 기다리지 않고 바로 보여 준다. 신뢰할 수 없는 입력이므로
//   서버에서 모양/크기를 강제로 다듬는다 (좌표 2개 × 최대 96점 ≈ 2KB 미만).
function sanitizeInk(ink) {
  if (!ink || typeof ink !== 'object') return null;
  const pts = Array.isArray(ink.pts) ? ink.pts : [];
  const out = [];
  for (let i = 0; i < pts.length && out.length < 96; i++) {
    const p = pts[i];
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      out.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    }
  }
  if (out.length < 2) return null;
  const color = typeof ink.color === 'string' ? ink.color.slice(0, 24) : '#888888';
  const size = Number.isFinite(ink.size) ? Math.min(200, Math.max(0.5, +ink.size)) : 2;
  const op = Number.isFinite(ink.op) ? Math.min(1, Math.max(0.05, +ink.op)) : 1;
  return { pts: out, color, size, op };
}

export function registerLive(app) {
  app.post('/api/live/ping', async (req, reply) => {
    const d = req.body || {};
    const note = String(d.note || '').trim();
    const uid = String(d.uid || '').trim();
    if (!note || !uid) return reply.code(400).send({ ok: false, error: 'note/uid 필요' });
    const now = Date.now() / 1000;
    let room = live.get(note);
    if (!room) { room = new Map(); live.set(note, room); }
    let me = room.get(uid);
    if (!me) {
      const used = new Set();
      for (const v of room.values()) if (v && v.color) used.add(v.color);
      // 이름의 색(복숭아빛 후투티 → 복숭아색)을 커서 색으로 준다. 이미 쓰이면 빈 색으로.
      me = { color: pickPastel(used, String(d.name || '익명').slice(0, 24)) };
      room.set(uid, me);
    }
    const mode = ['draw', 'type'].includes(d.mode) ? d.mode : '';
    Object.assign(me, {
      name: String(d.name || '익명').slice(0, 24),
      x: d.x, y: d.y, page: d.page || 0,
      on: Boolean(d.on ?? true),
      act: String(d.act || '').slice(0, 40),
      // 14.18.4 · mode: '' 마우스 / 'draw' 펜으로 그리는 중 / 'type' 글 입력 중
      mode,
      // 그리는 중에만 잉크 미리보기를 싣는다 (다른 모드에서는 지운다)
      ink: mode === 'draw' ? sanitizeInk(d.ink) : null,
      ts: now,
    });
    for (const [k, v] of room) if (now - (v.ts || 0) > LIVE_TTL) room.delete(k);
    const peers = [];
    for (const [k, v] of room) {
      if (k === uid) continue;
      const { ts, ink, ...rest } = v;
      peers.push({ uid: k, ink: ink || null, ...rest });
    }
    if (!room.size) live.delete(note);
    return reply.send({ ok: true, peers, color: me.color });
  });

  app.post('/api/live/leave', async (req, reply) => {
    const d = req.body || {};
    const note = String(d.note || '');
    const uid = String(d.uid || '');
    const room = live.get(note);
    if (room) {
      room.delete(uid);
      if (!room.size) live.delete(note);
    }
    return reply.send({ ok: true });
  });

  // ── SSE 이벤트 스트림 (설정·카드·음악·스티커 즉시 알림) ──
  app.get('/api/live', async (req, reply) => {
    const queue = [];
    subscribe(queue);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (payload) => {
      reply.raw.write(`event: sdy\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    send({ topic: 'hello', ts: Date.now() / 1000 });
    let lastSent = Date.now();
    const timer = setInterval(() => {
      try {
        let flushed = false;
        while (queue.length) {
          send(queue.shift());
          flushed = true;
        }
        if (!flushed && Date.now() - lastSent >= 20000) {
          reply.raw.write(': keep-alive\n\n');
        }
        lastSent = Date.now();
      } catch { clearInterval(timer); }
    }, 1000);
    req.raw.on('close', () => {
      clearInterval(timer);
      unsubscribe(queue);
    });
  });
}
