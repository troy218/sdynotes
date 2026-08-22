// 알림 + 프레즌스 + 복습 리마인더 + 서버 상태 게이지.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { BASE_DIR, DIRS, FILES } from '../lib/paths.js';
import { PRESENCE_TTL } from '../lib/config.js';
import { readJson, writeJsonAtomic, withLock } from '../lib/store.js';
import { notifyAddInternal } from '../lib/notifyAdd.js';

const NOTIFY_MAX = 160;
const presence = new Map(); // device -> lastSeen
const STUDY_SLOTS = [9, 20];
const STUDY_MIN_DUE = 5;
let studyCheckT = 0;

const notifyLoad = () => readJson(FILES.notifications, []);
const notifySave = (items) => writeJsonAtomic(FILES.notifications, items.slice(-NOTIFY_MAX));

const notifyAdd = notifyAddInternal;

function presenceTouch(uid) {
  const u = String(uid || '').replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 64);
  const now = Date.now() / 1000;
  for (const [k, t] of presence) if (now - t > PRESENCE_TTL) presence.delete(k);
  if (u) presence.set(u, now);
  return presence.size;
}

const kstNow = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d; // hours in KST
};

function studySlotKey() {
  const t = kstNow();
  const passed = STUDY_SLOTS.filter((h) => t.getUTCHours() >= h);
  if (!passed.length) return null;
  const h = Math.max(...passed);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}:${String(h).padStart(2, '0')}`;
}

async function maybeStudyNotification() {
  if (Date.now() / 1000 - studyCheckT < 600) return;
  studyCheckT = Date.now() / 1000;
  try {
    const slot = studySlotKey();
    if (!slot) return;
    const cardsDir = DIRS.cards;
    const exists = await fsp.stat(cardsDir).then(() => true).catch(() => false);
    if (!exists) return;
    const now = Date.now() / 1000;
    const hour = parseInt(slot.split(':')[1], 10);
    const t = kstNow();
    const slotStart = now - ((t.getUTCHours() - hour) * 3600 + t.getUTCMinutes() * 60 + t.getUTCSeconds());
    let due = 0;
    let decks = 0;
    let studiedRecently = false;
    for (const fn of await fsp.readdir(cardsDir)) {
      if (!fn.endsWith('.json')) continue;
      try {
        const d = JSON.parse(await fsp.readFile(path.join(cardsDir, fn), 'utf-8'));
        due += (d.cards || []).filter((c) => (c.due || 0) <= now).length;
        if ((d.cards || []).some((c) => (c.due || 0) <= now)) decks += 1;
        for (const h of (d.history || []).slice(-80).reverse()) {
          if ((h.ts || 0) >= slotStart) { studiedRecently = true; break; }
        }
      } catch { /* ignore */ }
    }
    if (due >= STUDY_MIN_DUE && !studiedRecently) {
      const when = hour < 12 ? '아침' : '저녁';
      await notifyAdd('study', `${when} 복습 시간이에요`, `${decks}개 묶음에서 ${due}장이 기다리고 있어요.`, `study:${slot}`);
    }
  } catch { /* ignore */ }
}

export function registerNotify(app) {
  // server stat counters (fastify hooks)
  const srv = { n: 0, slow: 0, err: 0, t: Date.now() / 1000 };
  const srvT0 = Date.now() / 1000;

  app.addHook('onRequest', async (req) => { req._t0 = Date.now() / 1000; });
  app.addHook('onResponse', async (req, reply) => {
    try {
      const dt = Date.now() / 1000 - (req._t0 || Date.now() / 1000);
      srv.n += 1;
      if (dt > 1.0) srv.slow += 1;
      if (reply.statusCode >= 500) srv.err += 1;
    } catch { /* ignore */ }
  });

  app.post('/api/presence/ping', async (req, reply) => {
    return reply.send({ ok: true, online: presenceTouch((req.body || {}).device) });
  });

  app.get('/api/notifications', async (req, reply) => {
    await maybeStudyNotification();
    const items = await withLock('notify', notifyLoad);
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return reply.send({
      ok: true, items,
      unread: items.filter((x) => !x.read).length,
      online: presenceTouch(''), max: NOTIFY_MAX,
    });
  });

  app.post('/api/notifications/read', async (req, reply) => {
    await withLock('notify', async () => {
      const items = await notifyLoad();
      for (const x of items) x.read = true;
      await notifySave(items);
    });
    return reply.send({ ok: true });
  });

  app.post('/api/notifications/delete', async (req, reply) => {
    const d = req.body || {};
    const nid = String(d.id || '');
    const clearRead = Boolean(d.clear_read);
    await withLock('notify', async () => {
      let items = await notifyLoad();
      if (clearRead) items = items.filter((x) => !x.read);
      else if (nid) items = items.filter((x) => x.id !== nid);
      await notifySave(items);
    });
    return reply.send({ ok: true });
  });

  app.post('/api/notifications/event', async (req, reply) => {
    const d = req.body || {};
    let kind = String(d.kind || 'info');
    if (!['pdf', 'info'].includes(kind)) kind = 'info';
    const title = String(d.title || '작업이 끝났어요').slice(0, 120);
    const message = String(d.message || '').slice(0, 500);
    const dedupe = String(d.event || '').slice(0, 80) || null;
    await notifyAdd(kind, title, message, dedupe ? `client:${dedupe}` : null);
    return reply.send({ ok: true });
  });

  app.post('/api/notifications/study', async (req, reply) => {
    const d = req.body || {};
    let studied = 0;
    let acc = 0;
    try {
      studied = Math.max(0, parseInt(d.studied || 0, 10) || 0);
      acc = Math.max(0, Math.min(100, parseInt(d.accuracy || 0, 10) || 0));
    } catch { /* */ }
    if (studied >= 10 || (studied >= 5 && acc >= 90)) {
      const title = String(d.title || '암기 카드').slice(0, 80);
      const sid = String(d.session || crypto.randomBytes(8).toString('hex')).slice(0, 80);
      await notifyAdd('achievement', '학습 기록이 저장됐어요 ✨', `${title} · ${studied}장 · 정답률 ${acc}%`, `session:${sid}`);
    }
    return reply.send({ ok: true });
  });

  app.get('/api/server/stat', async (req, reply) => {
    const cpu = (() => {
      try {
        const la = parseFloat(fs.readFileSync('/proc/loadavg', 'utf-8').split(' ')[0]);
        return Math.min(100, (100 * la) / (os.cpus().length || 1));
      } catch { return null; }
    })();
    const mem = (() => {
      try {
        const info = {};
        for (const line of fs.readFileSync('/proc/meminfo', 'utf-8').split('\n')) {
          const [k, v] = line.split(':');
          if (k && v) info[k.trim()] = parseFloat(v.trim().split(' ')[0]) * 1024;
        }
        const total = info.MemTotal || 0;
        const avail = info.MemAvailable ?? ((info.MemFree || 0) + (info.Cached || 0));
        if (total <= 0) return [null, null, null];
        return [(100 * (total - avail)) / total, total, avail];
      } catch { return [null, null, null]; }
    })();
    const disk = (() => {
      try {
        const st = fs.statfsSync(BASE_DIR);
        const total = st.blocks * st.bsize;
        const free = st.bavail * st.bsize;
        if (total <= 0) return [null, null, null];
        return [(100 * (total - free)) / total, total, free];
      } catch { return [null, null, null]; }
    })();

    let n = srv.n, slow = srv.slow, err = srv.err;
    const span = Math.max(1e-6, Date.now() / 1000 - srv.t);
    if (span > 60) { srv.n = 0; srv.slow = 0; srv.err = 0; srv.t = Date.now() / 1000; }
    const rpm = (n / span) * 60;

    // working import jobs
    let jobs = 0;
    try {
      const now = Date.now() / 1000;
      for (const fn of await fsp.readdir(DIRS.jobs)) {
        if (!fn.endsWith('.json')) continue;
        const p = path.join(DIRS.jobs, fn);
        const st = await fsp.stat(p);
        if (now - st.mtimeMs / 1000 > 300) continue;
        try {
          const j = JSON.parse(await fsp.readFile(p, 'utf-8'));
          if (j?.status === 'working') jobs += 1;
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    let score = 100;
    const parts = [];
    const [cpuP] = [cpu];
    const [memP] = mem;
    const [diskP] = disk;
    if (cpuP !== null) { score -= Math.max(0, cpuP - 35) * 0.55; parts.push(['cpu', cpuP]); }
    if (memP !== null) { score -= Math.max(0, memP - 60) * 0.9; parts.push(['mem', memP]); }
    if (diskP !== null) { score -= Math.max(0, diskP - 80) * 1.4; parts.push(['disk', diskP]); }
    score -= Math.min(25, jobs * 9);
    if (n) {
      score -= Math.min(15, (slow / Math.max(1, n)) * 100 * 0.4);
      score -= Math.min(20, (err / Math.max(1, n)) * 100 * 0.8);
    }
    score = Math.max(0, Math.min(100, score));

    const level = score >= 70 ? 'good' : (score >= 40 ? 'warn' : 'bad');
    let reason = '쾌적합니다';
    if (level !== 'good') {
      const worst = parts.length ? parts.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
      if (jobs) reason = `문서 변환 ${jobs}건 처리 중`;
      else if (worst === 'disk') reason = '저장 공간이 부족합니다';
      else if (worst === 'mem') reason = '메모리 사용이 많습니다';
      else if (worst === 'cpu') reason = '처리량이 많습니다';
      else reason = '응답이 느립니다';
    }
    if (level === 'bad') {
      const slot = Math.floor(Date.now() / 1000 / (2 * 3600));
      await notifyAdd('server', '서버가 잠시 바빠요', reason + '. 잠시 뒤 다시 확인해 주세요.', `server-bad:${slot}`);
    }
    const gb = (v) => (v ? Math.round((v / 1024 / 1024 / 1024) * 10) / 10 : null);
    return reply.send({
      ok: true, score: Math.round(score), level, reason,
      cpu: cpuP === null ? null : Math.round(cpuP),
      mem: memP === null ? null : Math.round(memP),
      disk: diskP === null ? null : Math.round(diskP),
      jobs, rpm: Math.round(rpm), uptime: Math.floor(Date.now() / 1000 - srvT0),
      memTotalGB: gb(mem[1]), memFreeGB: gb(mem[2]),
      diskTotalGB: gb(disk[1]), diskFreeGB: gb(disk[2]),
    });
  });
}
