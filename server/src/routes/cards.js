// 암기카드 (텍스트 붙여넣기 → 객관식 묶음, Leitner 채점, 통계).
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { DIRS, BASE_DIR } from '../lib/paths.js';
import { sbEnabled, sbGet, sbPut, sbDelete, sbRows, errorText } from '../lib/supabase.js';
import { readJson, writeJsonAtomic, withLock, SAN_ID } from '../lib/store.js';
import { publishLive } from '../lib/sse.js';

const DAY = 24 * 3600;
const BOX_GAP = [0, 60, 10 * 60, 60 * 60, 24 * 3600, 3 * 24 * 3600, 7 * 24 * 3600, 21 * 24 * 3600];

function deckPath(did) {
  return path.join(DIRS.cards, `${SAN_ID(did, 40)}.json`);
}

async function deckLoad(did) {
  if (sbEnabled()) {
    const data = await sbGet('sdy_card_decks', did);
    return (data && typeof data === 'object') ? data : null;
  }
  return readJson(deckPath(did), null);
}

async function deckSave(did, data) {
  if (sbEnabled()) {
    await sbPut('sdy_card_decks', did, data);
    publishLive('cards', did);
    return;
  }
  await writeJsonAtomic(deckPath(did), data);
}

// ── 객관식 카드 치유: 보기 순서·답 인덱스가 어긋난 카드를 고친다 ──────────
//   과거에 별표를 제대로 못 읽어 만들어진 카드, 혹은 AI 가 별표를 변형해
//   (전각 ＊, 마크다운 **, 별표 뒤 문장부자 등) 엉뚱한 보기가 답으로 저장된
//   카드를 열 때·채점할 때 정리한다. 화면에서 보기를 섞어도 항상 '답 보기
//   텍스트'를 기준으로 판정하도록 만드는 것이 핵심이다.
function normalizeChoiceCard(card) {
  if (!card || card.type !== 'choice') return false;
  if (!Array.isArray(card.opts)) { card.opts = []; }
  let changed = false;
  // 1) 보기 맨앞/맨뒤에 묻은 별표(반각·전각, 연속 별표 포함)를 벗기고,
  //    별표가 붙어 있던 보기의 '텍스트'를 기억했다가 정리 후 인덱스를 다시 잰다.
  const starIdx = [];
  const clean = [];
  for (const o of card.opts) {
    const s = String(o == null ? '' : o);
    const had = /^\s*[*＊]+\s*/.test(s) || /\s*[*＊]+[\s。.．,，、;；)）]?$/.test(s);
    const t = s.replace(/^\s*[*＊]+\s*/, '').replace(/\s*[*＊]+([\s。.．,，、;；)）]?)$/, '$1').trim();
    if (had && t) starIdx.push(t);
    if (t !== s.trim()) changed = true;
    if (t) clean.push(t);
  }
  card.opts = clean;
  // 별표가 붙어 있던 보기들의 최종 인덱스 (여러 개면 마지막 것을 정답으로)
  const starAt = starIdx.map(t => card.opts.indexOf(t)).filter(i => i >= 0);
  const n = card.opts.length;
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < n;
  // 2) 답 인덱스 확정 — 신뢰도 순서:
  //   ① 별표가 붙어 있던 보기 (만들 때 사람/AI 가 직접 표시한 답)
  //   ② back(답 텍스트)이 opts 안에 있으면 그 인덱스 (과거 호환)
  //   ③ 기존 answer 인덱스가 유효하면 그대로
  let ans = -1;
  if (starAt.length) ans = starAt[starAt.length - 1];
  if (ans < 0) {
    const back = String(card.back == null ? '' : card.back).trim();
    if (back) {
      const bi = card.opts.findIndex(o => String(o).trim() === back);
      if (bi >= 0) ans = bi;
    }
  }
  if (ans < 0 && valid(card.answer)) ans = card.answer;
  if (!valid(ans)) { card._badChoice = true; return changed; }
  if (card.answer !== ans) { card.answer = ans; changed = true; }
  if (card.back !== card.opts[ans]) { card.back = card.opts[ans]; changed = true; }
  delete card._badChoice;
  return changed;
}

function normalizeDeck(deck) {
  if (!deck || !Array.isArray(deck.cards)) return false;
  let changed = false;
  for (const c of deck.cards) {
    try { if (normalizeChoiceCard(c)) changed = true; } catch (e) { /* ignore */ }
  }
  if (changed) deck.updated_at = Date.now() / 1000;
  return changed;
}

// ── 객관식(M) 코드 파서 (원본 _parse_code_cards 그대로) ──────────────
function pullTag(line) {
  const m = line.match(/\s#([^\s#|]+)\s*$/);
  return m ? [line.slice(0, m.index).trimEnd(), m[1]] : [line, ''];
}

function splitCells(line) {
  if (line.includes('|')) return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  return [line.trim()];
}

function parseCodeCards(text) {
  let title = null;
  const cards = [];
  const head = /^\s*#\s*DECK\s*[:：]?\s*(.+)$/i;
  const row = /^\s*([CM])\s*[)\].:：]?\s+(.+)$/i;

  for (const raw of String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    let m = head.exec(raw);
    if (m) { title = m[1].trim().slice(0, 80); continue; }
    m = row.exec(raw);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    const [body, tag] = pullTag(m[2]);
    // 18.0 · split(/(\|\|)/) — 캡처 그룹으로 '||' 자체를 둘째 요소로 받아야
    //       셋째 요소(explanation)에 해설이 들어온다. 캡처가 없으면 해설이
    //       항상 버려지던 버그(해설이 빈 문자열로 저장됨)를 바로잡았다.
    let [main, sep, explanation] = body.split(/(\|\|)/, 3);
    explanation = sep ? (explanation || '') : '';
    const cells = splitCells(main);
    if (cells.length < 2) continue;
    if (!sep && cells.length && /^\s*(?:해설|설명)\s*[:：]/.test(cells[cells.length - 1])) {
      explanation = cells.pop().replace(/^\s*(?:해설|설명)\s*[:：]\s*/, '');
    }
    const q0 = cells[0];
    let difficulty = '보통';
    const dm = /^\s*\[(쉬움|보통|어려움|하|중|상)\]\s*(.*)$/.exec(q0);
    if (dm) {
      difficulty = ({ 하: '쉬움', 중: '보통', 상: '어려움' })[dm[1]] || dm[1];
      cells[0] = dm[2].trim();
    }
    const base = {
      id: crypto.randomBytes(5).toString('hex'), tag, note: explanation.trim(), difficulty,
      box: 0, due: 0, seen: 0, ok: 0, ng: 0, lapses: 0, ease: 2.5, ivl: 0,
    };
    if (kind === 'C') continue; // 주관식은 지원하지 않음
    const q = cells[0];
    const opts = [];
    let ans = -1;
    // 별표는 정답 보기의 '앞이나 뒤'에 붙는다. 반각 * 뿐 아니라 전각 ＊ 도
    // 인정하고, 여러 보기에 별표가 있으면(AI 가 규칙을 어긴 경우) 마지막 것을
    // 정답으로 친다. 별표가 보기 안쪽에 묻힌 경우(예: '정답* 입니다')도
    // 놓치지 않도록 별표 위치를 따로 기억했다가 나중에 답 인덱스로 확정한다.
    const starAt = [];
    for (let c0 of cells.slice(1)) {
      if (!c0) continue;
      let c = c0;
      // 별표 뒤에 문장부호(。. , , 등)가 조금 따라붙어도 별표로 인정한다.
      const edgeStar = /^\s*[*＊]+\s*/.test(c) || /\s*[*＊]+[\s。.．,，、;；)）]?$/.test(c);
      c = c.replace(/^\s*[*＊]+\s*/, '').replace(/\s*[*＊]+([\s。.．,，、;；)）]?)$/, '$1').trim();
      const idx = opts.length;
      if (edgeStar) starAt.push(idx);
      if (c) opts.push(c);
    }
    if (starAt.length) ans = starAt[starAt.length - 1];
    if (!q || opts.length < 2 || ans < 0) continue;
    base.type = 'choice'; base.front = q; base.opts = opts;
    base.answer = ans; base.back = opts[ans]; base.hint = '';
    cards.push(base);
  }
  return cards.length ? [title, cards] : [null, []];
}

export function registerCards(app) {
  app.post('/api/cards/text', async (req, reply) => {
    const b = req.body || {};
    const text = b.text || '';
    if (text.length > 800000) return reply.code(400).send({ ok: false, error: '내용이 너무 깁니다' });
    const [codeTitle, cards] = parseCodeCards(text);
    if (!cards.length) {
      return reply.code(400).send({
        ok: false,
        error: '객관식 카드만 만들 수 있습니다. M 질문 | 보기1 | 정답* | 보기3 형식으로 입력해 주세요',
      });
    }
    for (const c of cards) { try { normalizeChoiceCard(c); } catch (e) { /* ignore */ } }
    const did = crypto.randomBytes(6).toString('hex');
    const title = ((b.title || '').trim() || codeTitle || '').slice(0, 80)
      || `카드 ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`;
    const now = Date.now() / 1000;
    const deck = { id: did, title, cards, created_at: now, updated_at: now };
    await withLock('cards:' + did, () => deckSave(did, deck));
    return reply.send({ ok: true, id: did, title, count: cards.length });
  });

  app.post('/api/cards/preview', async (req, reply) => {
    const b = req.body || {};
    const [ttl, cards] = parseCodeCards(b.text || '');
    if (!cards.length) return reply.code(400).send({ ok: false, error: '객관식 M 형식만 지원합니다' });
    const nCh = cards.filter((c) => c.type === 'choice').length;
    return reply.send({
      ok: true, count: cards.length, title: ttl, choice: nCh, basic: cards.length - nCh,
      sample: cards.slice(0, 5).map((c) => ({
        front: c.front, back: c.back, type: c.type || 'basic', hint: c.hint || '',
        tag: c.tag || '', explanation: c.note || '', difficulty: c.difficulty || '보통',
      })),
    });
  });

  app.post('/api/cards/upload', async (req, reply) => {
    return reply.code(410).send({ ok: false, error: '카드는 텍스트 붙여넣기로만 만들 수 있습니다' });
  });

  app.get('/api/cards/list', async (req, reply) => {
    const now = Date.now() / 1000;
    if (sbEnabled()) {
      try {
        const rows = await sbRows('sdy_card_decks');
        const out = [];
        for (const row of rows) {
          const d = row.data || {};
          if (!d || typeof d !== 'object' || !d.id) continue;
          const cards = d.cards || [];
          const due = cards.filter((c) => (c.due || 0) <= now).length;
          const learned = cards.filter((c) => (c.box || 0) >= 4).length;
          const seen = cards.filter((c) => (c.seen || 0) > 0).length;
          const prog = cards.reduce((s, c) => s + ((c.seen || 0) ? Math.min(1, (c.box || 0) / 4) : 0), 0);
          out.push({
            id: d.id, title: d.title, count: cards.length, due, learned, seen,
            progress: cards.length ? Math.round((prog / cards.length) * 100) : 0,
            updated_at: d.updated_at ?? row.updated_at ?? '',
          });
        }
        out.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        return reply.send({ ok: true, decks: out });
      } catch (e) {
        return reply.code(502).send({ ok: false, error: `암기노트 연결 실패: ${errorText(e)}` });
      }
    }
    // local
    const out = [];
    try {
      const files = await fs.readdir(DIRS.cards);
      for (const fn of files) {
        if (!fn.endsWith('.json')) continue;
        const d = await readJson(path.join(DIRS.cards, fn), null);
        if (!d) continue;
        const cards = d.cards || [];
        const due = cards.filter((c) => (c.due || 0) <= now).length;
        const learned = cards.filter((c) => (c.box || 0) >= 4).length;
        const seen = cards.filter((c) => (c.seen || 0) > 0).length;
        const prog = cards.reduce((s, c) => s + ((c.seen || 0) ? Math.min(1, (c.box || 0) / 4) : 0), 0);
        out.push({
          id: d.id, title: d.title, count: cards.length, due, learned, seen,
          progress: cards.length ? Math.round((prog / cards.length) * 100) : 0,
          updated_at: d.updated_at ?? 0,
        });
      }
    } catch { /* ignore */ }
    out.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    return reply.send({ ok: true, decks: out });
  });

  app.get('/api/cards/deck/:did', async (req, reply) => {
    const did = req.params.did;
    // 열 때 한 번 치유하고(답 인덱스·별표 정리), 바뀐 게 있으면 저장해
    // 다른 기기에서도 바로 고쳐진 카드를 받는다. withLock 으로 채점과 경합 방지.
    const d = await withLock('cards:' + did, async () => {
      const deck = await deckLoad(did);
      if (!deck) return null;
      try {
        if (normalizeDeck(deck)) await deckSave(did, deck);
      } catch (e) { /* 치유 실패는 응답을 막지 않는다 */ }
      return deck;
    });
    if (!d) return reply.code(404).send({ ok: false, error: '없는 묶음' });
    return reply.send({ ok: true, deck: d });
  });

  app.post('/api/cards/grade', async (req, reply) => {
    const b = req.body || {};
    const did = b.deck;
    const cid = b.card;
    const eid = String(b.event || '').replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 80);
    let g;
    if ('grade' in b) g = Math.max(0, Math.min(3, parseInt(b.grade || 0, 10) || 0));
    else g = b.good ? 3 : 0;

    return await withLock('cards:' + did, async () => {
      const d = await deckLoad(did);
      if (!d) return reply.code(404).send({ ok: false, error: '없는 묶음' });
      try { normalizeDeck(d); } catch (e) { /* ignore */ }
      const events = d.grade_events || (d.grade_events = []);
      if (eid && events.includes(eid)) {
        const c = (d.cards || []).find((x) => x.id === cid);
        const state = c ? { box: c.box, ease: c.ease, ivl: c.ivl, due: c.due } : null;
        return reply.send({ ok: true, duplicate: true, card: state });
      }
      const now = Date.now() / 1000;
      let cardObj = null;
      let out = null;
      for (const c of d.cards || []) {
        if (c.id !== cid) continue;
        cardObj = c;
        c.seen = (c.seen || 0) + 1;
        let ease = parseFloat(c.ease || 2.5);
        let ivl = parseFloat(c.ivl || 0);
        let due;
        if (g === 0) {
          c.ng = (c.ng || 0) + 1;
          c.lapses = (c.lapses || 0) + 1;
          c.box = 0;
          ease = Math.max(1.3, ease - 0.20);
          ivl = 0;
          due = now + 60;
        } else {
          c.ok = (c.ok || 0) + 1;
          c.box = Math.min(BOX_GAP.length - 1, (c.box || 0) + 1);
          if (g === 1) { ease = Math.max(1.3, ease - 0.15); ivl = ivl <= 0 ? 1 : Math.max(1, ivl * 1.2); }
          else if (g === 2) { ivl = ivl <= 0 ? 1 : ivl * ease; }
          else { ease = Math.min(3.2, ease + 0.10); ivl = ivl <= 0 ? 2 : ivl * ease * 1.25; }
          ivl = Math.min(ivl, 365);
          due = now + ivl * DAY;
        }
        c.ease = Math.round(ease * 1000) / 1000;
        c.ivl = Math.round(ivl * 1000) / 1000;
        c.due = due;
        out = { box: c.box, ease: c.ease, ivl: c.ivl, due, nextSec: Math.floor(due - now) };
        break;
      }
      if (!cardObj) return reply.code(404).send({ ok: false, error: '없는 카드' });

      let responseMs = 0;
      try { responseMs = Math.max(0, Math.min(60 * 60 * 1000, parseInt(b.response_ms || 0, 10) || 0)); } catch { /* */ }
      const hist = d.history || (d.history = []);
      hist.push({
        event: eid || `ev_${crypto.randomBytes(7).toString('hex')}`, ts: now,
        card: cid, front: String(cardObj.front || '').slice(0, 180),
        correct: g > 0, grade: g, response_ms: responseMs,
        session: String(b.session || '').slice(0, 80),
        selected: b.selected, tag: String(cardObj.tag || '').slice(0, 60),
        difficulty: String(cardObj.difficulty || '보통').slice(0, 20),
      });
      d.history = hist.slice(-5000);
      if (eid) {
        events.push(eid);
        d.grade_events = events.slice(-2500);
      }
      d.updated_at = now;
      await deckSave(did, d);
      return reply.send({ ok: true, card: out });
    });
  });

  const pct = (ok, total) => (total ? Math.round((ok * 1000) / total) / 10 : 0);
  const dayKey = (ts) => new Date((parseFloat(ts) + 9 * 3600) * 1000).toISOString().slice(0, 10);

  app.get('/api/cards/stats/:did', async (req, reply) => {
    const d = await deckLoad(req.params.did);
    if (!d) return reply.code(404).send({ ok: false, error: '없는 묶음' });
    const now = Date.now() / 1000;
    const cards = d.cards || [];
    const hist = (d.history || []).filter((h) => h && typeof h === 'object');
    const due = cards.filter((c) => (c.due || 0) <= now);
    const fresh = cards.filter((c) => !(c.seen || 0));
    const young = cards.filter((c) => (c.ivl || 0) > 0 && (c.ivl || 0) < 21);
    const mature = cards.filter((c) => (c.ivl || 0) >= 21);

    const period = (sec) => {
      const a = hist.filter((h) => now - parseFloat(h.ts || 0) <= sec);
      const ok = a.filter((h) => h.correct).length;
      const vals = a.map((h) => parseInt(h.response_ms || 0, 10) || 0).filter((v) => v > 0);
      return { attempts: a.length, correct: ok, accuracy: pct(ok, a.length), avgResponseMs: vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0 };
    };

    const totalOk = hist.filter((h) => h.correct).length;
    const response = hist.map((h) => parseInt(h.response_ms || 0, 10) || 0).filter((v) => v > 0);
    const dayKeys = [];
    for (let i = 13; i >= 0; i--) dayKeys.push(dayKey(now - i * DAY));
    const dayMap = Object.fromEntries(dayKeys.map((k) => [k, { date: k, attempts: 0, correct: 0 }]));
    for (const h of hist) {
      const k = dayKey(parseFloat(h.ts || 0));
      if (dayMap[k]) { dayMap[k].attempts += 1; if (h.correct) dayMap[k].correct += 1; }
    }
    const daily = dayKeys.map((k) => {
      const x = dayMap[k];
      return { ...x, accuracy: pct(x.correct, x.attempts) };
    });

    const activeDays = new Set(hist.map((h) => dayKey(parseFloat(h.ts || 0))));
    let streak = 0;
    const start = activeDays.has(dayKeys[dayKeys.length - 1]) ? 0 : 1;
    for (let i = start; i < 366; i++) {
      const k = dayKey(now - i * DAY);
      if (!activeDays.has(k)) break;
      streak += 1;
    }

    const grouped = (field) => {
      const out = {};
      for (const h of hist) {
        const name = String(h[field] || (field === 'tag' ? '미분류' : '보통'));
        const z = out[name] || (out[name] = { name, attempts: 0, correct: 0 });
        z.attempts += 1;
        if (h.correct) z.correct += 1;
      }
      return Object.values(out).map((z) => ({ ...z, accuracy: pct(z.correct, z.attempts) }))
        .sort((a, b) => (b.attempts - a.attempts) || String(a.name).localeCompare(String(b.name)));
    };

    const byCard = {};
    for (const h of hist) {
      const z = byCard[h.card] || (byCard[h.card] = { attempts: 0, correct: 0, front: h.front || '' });
      z.attempts += 1;
      if (h.correct) z.correct += 1;
    }
    const cmap = Object.fromEntries(cards.map((c) => [c.id, c]));
    const weak = [];
    for (const [cid, z] of Object.entries(byCard)) {
      const wrong = z.attempts - z.correct;
      if (wrong <= 0) continue;
      const c = cmap[cid] || {};
      weak.push({
        card: cid, front: c.front || z.front, attempts: z.attempts, wrong,
        accuracy: pct(z.correct, z.attempts), tag: c.tag || '',
      });
    }
    weak.sort((a, b) => (b.wrong - a.wrong) || (a.accuracy - b.accuracy) || (b.attempts - a.attempts));

    const sessions = new Set(hist.filter((h) => h.session).map((h) => h.session));
    const byTag = grouped('tag');
    return reply.send({
      ok: true, total: cards.length, due: due.length, new: fresh.length,
      young: young.length, mature: mature.length,
      overview: {
        attempts: hist.length, correct: totalOk, accuracy: pct(totalOk, hist.length),
        avgResponseMs: response.length ? Math.round(response.reduce((s, v) => s + v, 0) / response.length) : 0,
        streakDays: streak, sessions: sessions.size,
      },
      periods: { today: period(DAY), week: period(7 * DAY), month: period(30 * DAY) },
      daily, byTag, byDifficulty: grouped('difficulty'), weak: weak.slice(0, 12),
      tags: byTag.map((x) => [x.name, x.attempts]),
      hard: weak.slice(0, 10).map((x) => ({ front: x.front, lapses: x.wrong })),
    });
  });

  app.post('/api/cards/reset', async (req, reply) => {
    const b = req.body || {};
    return await withLock('cards:' + b.deck, async () => {
      const d = await deckLoad(b.deck);
      if (!d) return reply.code(404).send({ ok: false, error: '없는 묶음' });
      for (const c of d.cards || []) Object.assign(c, { box: 0, due: 0, seen: 0, ok: 0, ng: 0, lapses: 0, ease: 2.5, ivl: 0 });
      d.history = [];
      d.grade_events = [];
      d.updated_at = Date.now() / 1000;
      await deckSave(d.id, d);
      return reply.send({ ok: true });
    });
  });

  app.post('/api/cards/delete', async (req, reply) => {
    const b = req.body || {};
    const did = SAN_ID(b.deck, 40);
    if (!did) return reply.code(400).send({ ok: false, error: '묶음 id 없음' });
    if (sbEnabled()) {
      try { await sbDelete('sdy_card_decks', did); publishLive('cards', did); return reply.send({ ok: true }); }
      catch (e) { return reply.code(502).send({ ok: false, error: `암기노트 삭제 실패: ${errorText(e)}` }); }
    }
    try { await fs.unlink(deckPath(did)); } catch (e) { return reply.code(500).send({ ok: false, error: String(e.message) }); }
    return reply.send({ ok: true });
  });

  app.post('/api/cards/card/delete', async (req, reply) => {
    const b = req.body || {};
    const cid = String(b.card || '');
    return await withLock('cards:' + b.deck, async () => {
      const d = await deckLoad(b.deck);
      if (!d) return reply.code(404).send({ ok: false, error: '없는 묶음' });
      const cards = d.cards || [];
      const left = cards.filter((c) => String(c.id) !== cid);
      if (left.length === cards.length) return reply.code(404).send({ ok: false, error: '없는 문제' });
      d.cards = left;
      d.history = (d.history || []).filter((h) => !h || typeof h !== 'object' || String(h.card) !== cid);
      d.updated_at = Date.now() / 1000;
      await deckSave(d.id, d);
      return reply.send({ ok: true, count: left.length });
    });
  });

  app.post('/api/cards/card/reset', async (req, reply) => {
    const b = req.body || {};
    const cid = String(b.card || '');
    return await withLock('cards:' + b.deck, async () => {
      const d = await deckLoad(b.deck);
      if (!d) return reply.code(404).send({ ok: false, error: '없는 묶음' });
      const hit = (d.cards || []).find((c) => String(c.id) === cid);
      if (!hit) return reply.code(404).send({ ok: false, error: '없는 문제' });
      Object.assign(hit, { box: 0, due: 0, seen: 0, ok: 0, ng: 0, lapses: 0, ease: 2.5, ivl: 0 });
      d.updated_at = Date.now() / 1000;
      await deckSave(d.id, d);
      return reply.send({ ok: true, card: hit });
    });
  });

  app.post('/api/cards/rename', async (req, reply) => {
    const b = req.body || {};
    return await withLock('cards:' + b.deck, async () => {
      const d = await deckLoad(b.deck);
      if (!d) return reply.code(404).send({ ok: false, error: '없는 묶음' });
      const t = String(b.title || '').trim().slice(0, 80);
      if (t) {
        d.title = t;
        d.updated_at = Date.now() / 1000;
        await deckSave(d.id, d);
      }
      return reply.send({ ok: true });
    });
  });

  app.get('/api/cards/sample', async (req, reply) => {
    const buf = await fs.readFile(path.join(BASE_DIR, 'server', 'assets', 'sdy_cards_sample.xlsx'));
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="sdy_cards_sample.xlsx"');
    return reply.send(buf);
  });
}
