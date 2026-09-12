/* ═══════════════════════════════════════════════════════════════════════════
   가져온 논문의 임자(owner)와 용량 계산 — 요금제의 안전장치

   왜 필요한가
     "논문 불러오기는 구독자에게 무제한" 은 좋은 결정이다. 다만 지금 서버는
     누가 무엇을 가져왔는지 **전혀 모른다.** 그래서 두 가지가 안 된다.
       ① 구독자별 용량을 셀 수 없다 — 무제한을 팔려면 여기가 필요하다
       ② 계정을 지워도 그 사람 논문이 서버 디스크에 그대로 남는다
          (스토어 심사 요건 '개인정보 파기'에 구멍이 난다)

   무엇을 세는가
     가져온 문서 하나(`imported_docs/{jid}.*`)와 그 문서가 쓰는 배경 이미지
     (`imported/<hex>.png|jpg|svg`). 배경 이미지 이름은 문서 본문(gzip JSON)에
     들어 있으므로 거기서 찾아낸다. 페이지 수가 아니라 **바이트**를 센다 —
     텍스트 논문과 스캔본은 100배 차이가 나기 때문이다.

   한계 (솔직히)
     문서를 만든 그 순간의 응답에서 임자를 기록한다. 워커가 직접 만든 문서나
     기록 전에 죽은 작업은 임자가 비어 있을 수 있다(uid:'' 로 남는다).
     그런 문서는 계정 삭제로 지울 수 없으므로 reconcile() 이 보고하게 한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { DIRS } from './paths.js';
import { readJson, writeJsonAtomic, withLock } from './store.js';

const FILE = path.join(DIRS.docs, '_owners.json');

let st = null;              // { jid: { uid, at, bytes, pages, name } }
let lastScan = 0;

async function load() {
  if (st) return st;
  st = (await readJson(FILE, {})) || {};
  return st;
}

function save() {
  return withLock('importOwners', async () => writeJsonAtomic(FILE, st))
    .catch((e) => console.error(`[imports] 임자 기록 실패: ${e?.message || e}`));
}

export async function importsBoot() {
  await load();
}

// ── 문서가 쓰는 바이트 (문서 파일 + 배경 이미지) ─────────────────────────
function docFiles(jid) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(DIRS.docs); } catch { return out; }
  for (const n of names) {
    if (n.startsWith(jid + '.')) {
      const p = path.join(DIRS.docs, n);
      try { out.push({ path: p, bytes: fs.statSync(p).size }); } catch { /* noop */ }
    }
  }
  return out;
}

// 문서 본문에서 배경 이미지 이름을 찾는다.
//   본문은 gzip JSON 이고 수십 MB 가 될 수 있어, JSON 파싱 대신 정규식으로 훑는다.
const IMG_RE = /\/api\/import\/img\/([0-9a-zA-Z_.-]{4,64})/g;

function rasterNames(jid) {
  const names = new Set();
  for (const f of docFiles(jid)) {
    if (!/\.(json\.gz|s\d+\.gz)$/.test(f.path)) continue;
    let text = '';
    try {
      text = zlib.gunzipSync(fs.readFileSync(f.path), { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8');
    } catch {
      try { text = fs.readFileSync(f.path, 'utf8'); } catch { continue; }
    }
    for (const m of text.matchAll(IMG_RE)) names.add(m[1]);
  }
  return [...names];
}

function rasterBytes(names) {
  let total = 0;
  let found = 0;
  for (const n of names) {
    try {
      const s = fs.statSync(path.join(DIRS.img, n));
      total += s.size; found += 1;
    } catch { /* 이미 지워졌거나 다른 문서와 공유 */ }
  }
  return { total, found };
}

// 문서 하나의 실제 사용량 — 디스크를 보므로 기록이 틀려도 정확하다
export async function importsSizeOf(jid) {
  const files = docFiles(jid);
  const docBytes = files.reduce((a, f) => a + f.bytes, 0);
  const names = rasterNames(jid);
  const { total: imgBytes, found: imgCount } = rasterBytes(names);
  return { jid, docBytes, imgBytes, bytes: docBytes + imgBytes, files: files.length, images: imgCount };
}

// ── 임자 기록 ────────────────────────────────────────────────────────────
// 워커가 잡을 만들고 돌려준 순간, 그 요청을 보낸 회원을 적어 둔다.
export async function importsRecord(jid, uid, meta = {}) {
  const id = String(jid || '').replace(/[^0-9a-zA-Z_-]/g, '');
  if (!id) return { ok: false, error: 'jid 없음' };
  await load();
  const size = await importsSizeOf(id);
  st[id] = {
    uid: String(uid || ''),
    at: Date.now() / 1000,
    bytes: size.bytes,
    pages: Number(meta.pages) || 0,
    name: String(meta.name || '').slice(0, 120),
  };
  await save();
  return { ok: true, jid: id, bytes: size.bytes };
}

export function importsOwnerOf(jid) {
  return (st && st[String(jid || '')]) || null;
}

// ── 한 회원의 사용량 ─────────────────────────────────────────────────────
export async function importsUsage(uid) {
  await load();
  const me = String(uid || '');
  const docs = [];
  let bytes = 0;
  for (const [jid, rec] of Object.entries(st)) {
    if (!rec || String(rec.uid) !== me) continue;
    // 기록된 값이 아니라 지금 디스크를 다시 본다(문서를 다시 만들면 크기가 바뀐다)
    const size = await importsSizeOf(jid);
    if (size.bytes === 0) continue;      // 이미 지워진 문서
    bytes += size.bytes;
    docs.push({ jid, bytes: size.bytes, at: rec.at, pages: rec.pages, name: rec.name });
  }
  docs.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { uid: me, bytes, count: docs.length, docs };
}

export function importsQuotaBytes() {
  // 0 이면 무제한. 기본값은 넉넉하게(2GB) 두어 구독자 약속을 지킨다.
  const mb = parseInt(process.env.SDY_IMPORT_QUOTA_MB || '2048', 10);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : 0;
}

// 이 회원이 지금 가져와도 되는가 (무제한이면 항상 통과)
export async function importsCheckQuota(uid) {
  const quota = importsQuotaBytes();
  const usage = await importsUsage(uid);
  if (!quota) return { ok: true, unlimited: true, usage };
  const over = usage.bytes >= quota;
  return {
    ok: !over,
    unlimited: false,
    usage,
    quota,
    over_by: over ? usage.bytes - quota : 0,
  };
}

// ── 정리 ─────────────────────────────────────────────────────────────────
// 계정 삭제 — 이 회원이 가져온 문서와 배경 이미지를 디스크에서 지운다.
//   (다른 회원이 쓰는 배경 이미지는 남긴다: 같은 파일을 여러 문서가 쓸 수 있다)
export async function importsPurgeUser(uid) {
  await load();
  const me = String(uid || '');
  if (!me) return { docs: 0, bytes: 0 };
  let docs = 0, bytes = 0;

  for (const [jid, rec] of Object.entries(st)) {
    if (!rec || String(rec.uid) !== me) continue;
    const names = rasterNames(jid);
    for (const f of docFiles(jid)) {
      try { await fsp.unlink(f.path); bytes += f.bytes; } catch { /* noop */ }
    }
    // 배경 이미지: 이 회원의 다른 문서도 쓰지 않을 때만 지운다
    const stillUsed = new Set();
    for (const [otherJid, other] of Object.entries(st)) {
      if (otherJid === jid || !other || String(other.uid) !== me) continue;
      for (const n of rasterNames(otherJid)) stillUsed.add(n);
    }
    for (const n of names) {
      if (stillUsed.has(n)) continue;
      try {
        const s = await fsp.stat(path.join(DIRS.img, n));
        await fsp.unlink(path.join(DIRS.img, n));
        bytes += s.size;
      } catch { /* noop */ }
    }
    delete st[jid];
    docs += 1;
  }
  if (docs) await save();
  return { docs, bytes };
}

// 임자 없는 문서 찾기 — 계정 삭제로 지울 수 없는 것들. 운영자가 확인할 수 있게.
export async function importsOrphans() {
  await load();
  const out = [];
  for (const [jid, rec] of Object.entries(st)) {
    if (!rec || rec.uid) continue;
    const size = await importsSizeOf(jid);
    if (size.bytes > 0) out.push({ jid, bytes: size.bytes, at: rec.at });
  }
  return out;
}

// 기록에 있는데 파일이 사라진 항목 정리 (문서를 지웠거나 재배포로 사라진 경우)
export async function importsReconcile() {
  await load();
  let dropped = 0, seen = 0;
  for (const jid of Object.keys(st)) {
    seen += 1;
    const size = await importsSizeOf(jid);
    if (size.bytes === 0) { delete st[jid]; dropped += 1; }
    else if (st[jid].bytes !== size.bytes) { st[jid].bytes = size.bytes; }
  }
  if (dropped) await save();
  lastScan = Date.now();
  return { seen, dropped };
}

// 전체 현황 — 운영자용
export async function importsReport() {
  await load();
  const byUser = new Map();
  let total = 0, docs = 0, anonymous = 0;
  for (const [jid, rec] of Object.entries(st)) {
    const size = await importsSizeOf(jid);
    if (size.bytes === 0) continue;
    docs += 1; total += size.bytes;
    const uid = (rec && rec.uid) || '';
    if (!uid) anonymous += 1;
    const cur = byUser.get(uid) || { uid, bytes: 0, count: 0 };
    cur.bytes += size.bytes; cur.count += 1;
    byUser.set(uid, cur);
  }
  const users = [...byUser.values()].sort((a, b) => b.bytes - a.bytes);
  return { total, docs, anonymous, users, scannedAt: lastScan || Date.now() };
}
