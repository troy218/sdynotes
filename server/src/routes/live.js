// 실시간 커서 공유 (같은 노트를 여럿이 볼 때) + SSE 이벤트 스트림.
import { subscribe, unsubscribe } from '../lib/sse.js';

const LIVE_TTL = 12; // seconds
// 14.9 · 연한 파스텔톤 팔레트. 입장 순서가 아니라 방 안의 색을 피해 랜덤으로 고른다.
const PASTELS = ['#f9a8d4', '#fda4af', '#fdba74', '#fcd34d', '#bef264', '#6ee7b7',
                 '#5eead4', '#7dd3fc', '#a5b4fc', '#c4b5fd', '#d8b4fe', '#f0abfc'];

function pickPastel(room) {
  const used = new Set();
  for (const v of room.values()) if (v && v.color) used.add(v.color);
  const free = PASTELS.filter((c) => !used.has(c));
  const pool = free.length ? free : PASTELS;
  return pool[Math.floor(Math.random() * pool.length)];
}

const live = new Map(); // note -> Map(uid -> {...})

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
    if (!me) { me = { color: pickPastel(room) }; room.set(uid, me); }
    Object.assign(me, {
      name: String(d.name || '익명').slice(0, 24),
      x: d.x, y: d.y, page: d.page || 0,
      on: Boolean(d.on ?? true),
      act: String(d.act || '').slice(0, 40),
      ts: now,
    });
    for (const [k, v] of room) if (now - (v.ts || 0) > LIVE_TTL) room.delete(k);
    const peers = [];
    for (const [k, v] of room) {
      if (k === uid) continue;
      const { ts, ...rest } = v;
      peers.push({ uid: k, ...rest });
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
