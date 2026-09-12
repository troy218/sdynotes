// 16.3 · 1:1 대화(DM) 저장소 — 친구끼리 나누는 개인 채팅.
//
// 공용방(엽스코드)과 다르게 DM 은 상대가 지금 접속해 있지 않아도 받아야 하므로
// 서버 디스크에 남긴다. 대신 아래처럼 스스로 줄어든다:
//   · 스레드당 최근 MAX_MSGS(500)개만 유지
//   · TTL(기본 30일, SDY_DM_TTL) 지난 메시지는 자동 삭제
//   · 사진/파일은 dm/ 폴더 — 총 바이트 예산(SDY_DM_FILE_MB, 기본 256MB)을
//     넘으면 가장 오래된 파일부터 삭제하고 메시지에는 file.gone 표시
//
// 상태 파일: .sdy_dm.json
//   seq     전역 메시지 id (증가)
//   threads { "uidA|uidB": { msgs: [{id,from,kind,text?,file?,ts}], reads: {uid: lastReadId} } }
//   files   { fileId: { id, name, mime, size, pair, path } }
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DIRS, FILES } from './paths.js';
import { readJson, writeJsonAtomic } from './store.js';

const TTL = Math.max(3600, parseInt(process.env.SDY_DM_TTL || String(30 * 24 * 3600), 10) || 30 * 24 * 3600);
const MAX_MSGS = Math.max(50, parseInt(process.env.SDY_DM_MAX_MSGS || '500', 10) || 500);
const FILE_BUDGET = Math.max(32, parseInt(process.env.SDY_DM_FILE_MB || '256', 10)) * 1024 * 1024;
export const DM_IMG_MAX = 8 * 1024 * 1024;
export const DM_FILE_MAX = 20 * 1024 * 1024;

let st = null;               // {seq, threads, files}
let notifier = null;         // (uids: string[], evt) => {}

const nowSec = () => Date.now() / 1000;

export function setDmNotifier(fn) { notifier = typeof fn === 'function' ? fn : null; }
function tell(uids, evt) {
  try { if (notifier) notifier(uids, evt); } catch { /* noop */ }
}

async function load() {
  if (st) return st;
  const d = (await readJson(FILES.dm, {})) || {};
  st = {
    seq: Number.isFinite(d.seq) ? d.seq : 0,
    threads: d.threads && typeof d.threads === 'object' ? d.threads : {},
    files: d.files && typeof d.files === 'object' ? d.files : {},
  };
  return st;
}
let saveT = null;
function save() {
  // 연속 쓰기를 1건으로 합친다 (채팅은 버스트가 잦다)
  if (saveT) return;
  saveT = setTimeout(() => {
    saveT = null;
    writeJsonAtomic(FILES.dm, st).catch((e) => console.error(`[dm] 저장 실패: ${e?.message || e}`));
  }, 250);
  if (saveT.unref) saveT.unref();
}
// 종료·테스트가 기다릴 수 있게 즉시 저장
export function dmFlush() {
  if (!st) return Promise.resolve();
  if (saveT) { clearTimeout(saveT); saveT = null; }
  return writeJsonAtomic(FILES.dm, st).catch(() => {});
}

export async function dmBoot() {
  await load();
  try { fs.mkdirSync(DIRS.dm, { recursive: true }); } catch { /* noop */ }
  gc();
  startGC();
}

const threadOf = (pk) => {
  let t = st.threads[pk];
  if (!t) { t = { msgs: [], reads: {} }; st.threads[pk] = t; }
  if (!t.reads) t.reads = {};
  return t;
};
export const participants = (pk) => String(pk || '').split('|');

// ── 메시지 ─────────────────────────────────────────────
export function dmPush(pk, m) {
  const t = threadOf(pk);
  st.seq += 1;
  m.id = st.seq;
  m.ts = nowSec();
  t.msgs.push(m);
  while (t.msgs.length > MAX_MSGS) {
    const old = t.msgs.shift();
    if (old.file && old.file.id) fileDrop(old.file.id, false);
  }
  // 보낸 사람은 자기 메시지까지 읽은 것으로 본다
  t.reads[m.from] = m.id;
  save();
  return m;
}

export function dmHistory(pk, { before = 0, limit = 60 } = {}) {
  const t = st.threads[pk];
  if (!t) return { msgs: [], more: false, last: 0 };
  const lim = Math.min(120, Math.max(1, limit | 0));
  let arr = t.msgs;
  if (before > 0) arr = arr.filter((m) => m.id < before);
  const more = arr.length > lim;
  const msgs = arr.slice(-lim);
  return { msgs, more, last: t.msgs.length ? t.msgs[t.msgs.length - 1].id : 0 };
}

export function dmLast(pk) {
  const t = st.threads[pk];
  if (!t || !t.msgs.length) return null;
  return t.msgs[t.msgs.length - 1];
}

const lastRead = (pk, uid) => (st.threads[pk] && st.threads[pk].reads[uid]) || 0;
export const dmLastRead = lastRead;   // 상대가 어디까지 읽었는지 (history 응답용)
export function dmUnread(pk, uid) {
  const t = st.threads[pk];
  if (!t) return 0;
  const lr = lastRead(pk, uid);
  if (!lr) return t.msgs.filter((m) => m.from !== uid).length;
  return t.msgs.filter((m) => m.from !== uid && m.id > lr).length;
}

// 내 모든 스레드의 안 읽은 합계 (칩/버튼 뱃지용)
export async function dmUnreadTotal(uid) {
  await load();
  let n = 0;
  for (const pk of Object.keys(st.threads)) {
    if (!participants(pk).includes(uid)) continue;
    n += dmUnread(pk, uid);
  }
  return n;
}

// 읽음 처리 — 스레드 참여자 모두에게 알림(라우트가 수신자별 peer 로 변환).
export function dmMarkRead(pk, uid, id) {
  const t = st.threads[pk];
  if (!t) return 0;
  const upto = Math.max(lastRead(pk, uid), Math.min(Number(id) || 0, t.msgs.length ? t.msgs[t.msgs.length - 1].id : 0));
  if (upto <= lastRead(pk, uid)) return lastRead(pk, uid);
  t.reads[uid] = upto;
  save();
  tell(participants(pk), { type: 'dm_read', pk, by: uid, id: upto });
  return upto;
}

// 메시지 삭제 (본인 것만 — 라우트에서 소유 확인)
export function dmDelete(pk, id, uid) {
  const t = st.threads[pk];
  if (!t) return { ok: false, code: 'not_found' };
  const i = t.msgs.findIndex((m) => m.id === id);
  if (i < 0) return { ok: false, code: 'not_found' };
  const m = t.msgs[i];
  if (m.from !== uid) return { ok: false, code: 'forbidden' };
  t.msgs.splice(i, 1);
  if (m.file && m.file.id) fileDrop(m.file.id, false);
  // 삭제된 메시지를 가리키던 읽음 위치 보정
  for (const [u, r] of Object.entries(t.reads)) {
    if (r > (t.msgs.length ? t.msgs[t.msgs.length - 1].id : 0)) t.reads[u] = t.msgs.length ? t.msgs[t.msgs.length - 1].id : 0;
  }
  save();
  tell(participants(pk), { type: 'dm_del', pk, by: uid, id });
  return { ok: true };
}

// ── 파일 (dm/ 폴더) ───────────────────────────────────
export async function dmFileAdd(pk, fileId, meta, buf) {
  const safeName = String(meta.name || 'file').slice(0, 120);
  const rec = {
    id: fileId, name: safeName, mime: String(meta.mime || 'application/octet-stream').toLowerCase(),
    size: buf.length, pair: pk, path: path.join(DIRS.dm, fileId),
  };
  await fsp.mkdir(DIRS.dm, { recursive: true });
  await fsp.writeFile(rec.path, buf);
  st.files[fileId] = rec;
  fileEvict();
  save();
  return { id: rec.id, name: rec.name, size: rec.size, mime: rec.mime };
}

export function dmFileGet(fileId) {
  return st ? st.files[String(fileId || '')] || null : null;
}

// 예산 초과 시 오래된 파일부터 삭제. breakTies: 가장 최근 1개는 남긴다.
function fileEvict() {
  let total = 0;
  const recs = Object.values(st.files);
  for (const r of recs) total += r.size || 0;
  if (total <= FILE_BUDGET) return;
  recs.sort((a, b) => String(a.id).localeCompare(String(b.id)));   // fileId 는 시간순 hex
  for (const r of recs) {
    if (total <= FILE_BUDGET || Object.keys(st.files).length <= 1) break;
    total -= r.size || 0;
    fileDrop(r.id, true);
  }
}
function fileDrop(fileId, markGone) {
  const rec = st.files[fileId];
  if (!rec) return;
  delete st.files[fileId];
  fsp.unlink(rec.path).catch(() => {});
  if (markGone) {
    const t = st.threads[rec.pair];
    if (t) for (const m of t.msgs) {
      if (m.file && m.file.id === fileId) { m.file.gone = true; break; }
    }
  }
}

// ── GC: TTL 지난 메시지 삭제 + 빈 스레드 정리 ────────────
function gc() {
  if (!st) return;
  const now = nowSec();
  let dirty = false;
  for (const [pk, t] of Object.entries(st.threads)) {
    const keep = t.msgs.filter((m) => now - m.ts <= TTL);
    if (keep.length !== t.msgs.length) {
      const removed = t.msgs.filter((m) => now - m.ts > TTL);
      for (const m of removed) if (m.file && m.file.id) fileDrop(m.file.id, false);
      t.msgs = keep;
      dirty = true;
    }
    if (!t.msgs.length) { delete st.threads[pk]; dirty = true; }
  }
  // 메시지는 사라졌는데 남은 파일 레코드 청소
  for (const [fid, rec] of Object.entries(st.files)) {
    const t = st.threads[rec.pair];
    const used = t && t.msgs.some((m) => m.file && m.file.id === fid);
    if (!used) { fileDrop(fid, false); dirty = true; }
  }
  if (dirty) save();
}
let gcTimer = null;
function startGC() {
  if (gcTimer) return;
  gcTimer = setInterval(gc, 10 * 60 * 1000);
  if (gcTimer.unref) gcTimer.unref();
}
export const dmGC = gc;   // 테스트·강제 정리용
