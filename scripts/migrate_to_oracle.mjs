#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
//  SDYnotes — Supabase/Cloudinary → Oracle 자체 저장소 일괄 이전 (14.12)
//
//  Oracle VM 에서 실행 (서비스 정지 상태):
//      node scripts/migrate_to_oracle.mjs --base /var/www/memo
//
//  하는 일 (소스는 읽기만 함 — Supabase/Cloudinary 에서 아무것도 지우지
//  않는다. 롤백은 .env 의 SDY_STORAGE=cloud 로 언제든 가능):
//    1. Supabase 테이블(sdy_sync_states·sdy_card_decks·sdy_music_tracks·
//       sdy_stickers·notebooks·memos·images) 을 로컬 저장소로:
//         - sync 상태   → sync/<id>.json       (요소별 LWW 병합)
//         - 카드 덱     → cards/<id>.json
//         - 음악 레코드 → music/_index.json    (+ 음원/표지 파일)
//         - 스티커      → stickers/_index.json (+ 이미지 파일)
//         - notebooks/memos/images → db/<table>/<id>.json
//    2. Cloudinary 자산(음원·표지·스티커·보관함) 을 서버 디스크로 내려받기
//    3. 노트/설정/배경 콘텐츠에 박혀 있는 res.cloudinary.com URL 을 전부
//       스캔해 원본을 내려받고 로컬 주소(/api/img/..., /api/wallpaper/...)로 치환
//    4. yt_cookies 행 → music/_yt_cookies.txt (+백업)
//    5. .oracle_migrated 마커 + .oracle_migrated.report.json 리포트
//
//  옵션:
//    --base DIR   앱 루트(기본: 스크립트 상위 디렉토리)
//    --env FILE   .env 경로(기본: <base>/.env) — SUPABASE_*/CLOUDINARY_* 참조
//    --dry        실제 쓰기 없이 무엇을 하게 될지 표시
//    --force      이미 .oracle_migrated 가 있어도 다시 실행(빠진 파일만 보강)
// ─────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// ── 인자/환경 ─────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') out.dry = true;
    else if (a === '--force') out.force = true;
    else if (a === '--base') out.base = argv[++i];
    else if (a === '--env') out.env = argv[++i];
  }
  return out;
}

export function parseEnvFile(file) {
  const out = {};
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !m[1].startsWith('#')) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* 없으면 무시 */ }
  return out;
}

function freshStats() {
  return { rows: 0, files: 0, bytes: 0, replaced: 0, skipped: 0, failed: [] };
}

function log(...a) { console.log(...a); }

// ── Supabase (PostgREST) 읽기 ─────────────────────────────────────────
function makeSb(cfg) {
  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
  };
  async function getPage(table, order, start, step) {
    let url = `${cfg.url}/rest/v1/${table}?select=*&limit=${step}&offset=${start}`;
    if (order) url += `&order=${order}.asc`;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`supabase ${table} ${r.status}`);
    return r.json();
  }
  return async function rows(table) {
    const out = [];
    const step = 1000;
    // 정렬 컬럼은 테이블마다 다르다 — 실패하면 차선으로 시도한다.
    for (const order of ['updated_at', 'id', null]) {
      out.length = 0;
      try {
        for (let start = 0; start < 100000; start += step) {
          const pageRows = await getPage(table, order, start, step);
          out.push(...(pageRows || []));
          if ((pageRows || []).length < step) return out;
        }
        return out;
      } catch (e) {
        if (order === null) {
          cfg.warn(`Supabase ${table} 읽기 실패: ${e.message}`);
          return out;
        }
      }
    }
    return out;
  };
}

// ── Cloudinary URL 빌더 (SDK 우선, 없으면 공개 URL 수동 생성) ─────────
async function loadCloudinarySdk() {
  try {
    const mod = await import('cloudinary');
    return mod.v2 || mod.default?.v2 || mod.default;
  } catch {
    return null;
  }
}

async function makeCld(cfg) {
  const sdk = (cfg.base === 'https://res.cloudinary.com') ? await loadCloudinarySdk() : null;
  if (sdk) {
    sdk.config({
      cloud_name: cfg.cloudName,
      ...(cfg.apiKey ? { api_key: cfg.apiKey } : {}),
      ...(cfg.apiSecret ? { api_secret: cfg.apiSecret } : {}),
      secure: true,
    });
  }
  function url(publicId, { resourceType = 'image', format = '', version = 0, sign = false } = {}) {
    if (sdk) {
      const opts = { resource_type: resourceType, type: 'upload', secure: true };
      if (format) opts.format = format;
      if (version) opts.version = version;
      if (sign && cfg.apiSecret) opts.sign_url = true;
      try { return sdk.url(publicId, opts); } catch { /* 수동 생성으로 계속 */ }
    }
    let u = `${cfg.base}/${cfg.cloudName}/${resourceType}/upload/`;
    if (version) u += `v${version}/`;
    u += publicId;
    if (format) u += `.${format}`;
    return u;
  }
  return { url, hasSdk: Boolean(sdk) };
}

async function downloadTo(urlStr, filePath, stats, { maxBytes = 400 * 1024 * 1024, dry = false, label = '' } = {}) {
  try {
    const st = await fsp.stat(filePath);
    if (st.size > 0) { stats.skipped += 1; return { ok: true, bytes: st.size, existed: true }; }
  } catch { /* 없으면 다운로드 */ }
  if (dry) {
    log(`    [dry] 다운로드 ${label || path.basename(filePath)} ← ${urlStr.slice(0, 110)}`);
    return { ok: true, dry: true, bytes: 0 };
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(urlStr, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
      if (r.status === 404) {
        stats.failed.push(`404 원본 없음: ${label || urlStr.slice(0, 140)}`);
        return { ok: false, missing: true };
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) throw new Error('빈 파일');
      if (buf.length > maxBytes) throw new Error(`파일이 너무 큼 (${buf.length}B)`);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, buf);
      stats.files += 1; stats.bytes += buf.length;
      return { ok: true, bytes: buf.length };
    } catch (e) {
      if (attempt === 3) {
        stats.failed.push(`다운로드 실패 ${label || urlStr.slice(0, 140)}: ${e.message}`);
        return { ok: false, error: e.message };
      }
      await new Promise((r2) => setTimeout(r2, 1500 * attempt));
    }
  }
  return { ok: false };
}

// ── 로컬 저장 헬퍼 ─────────────────────────────────────────────────────
async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')) ?? fallback; } catch { return fallback; }
}
async function writeJson(file, data, dry, stats) {
  if (dry) { log(`    [dry] 기록 ${file}`); return; }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${crypto.randomBytes(3).toString('hex')}`;
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
  if (stats) stats.rows += 1;
}
async function writeText(file, txt, dry) {
  if (dry) { log(`    [dry] 기록 ${file}`); return; }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, txt, 'utf8');
}

// ── sync 상태 병합 (요소별 LWW — 로컬/원격 양쪽 편집 모두 보존) ────────
export function mergeSyncState(local, remote) {
  const a = (local && typeof local === 'object') ? local : {};
  const b = (remote && typeof remote === 'object') ? remote : {};
  const out = { ...b };
  const els = {};
  const rev = (e) => parseFloat(e?.rev || 0) || 0;
  const ids = new Set([...Object.keys(a.els || {}), ...Object.keys(b.els || {})]);
  for (const id of ids) {
    const x = (a.els || {})[id];
    const y = (b.els || {})[id];
    if (!x) els[id] = y;
    else if (!y) els[id] = x;
    else els[id] = rev(y) >= rev(x) ? y : x;
  }
  if (Object.keys(els).length) out.els = els;
  const pa = a.pages, pb = b.pages;
  if (pa && (!pb || rev(pa) > rev(pb))) out.pages = pa;
  else if (pb) out.pages = pb;
  out.version = Math.max(parseFloat(a.version || 0) || 0, parseFloat(b.version || 0) || 0, rev(out.pages));
  return out;
}

// ── Cloudinary URL 파서 (치환 스윕용) ──────────────────────────────────
export const CLD_URL_RE = /https:\/\/res\.cloudinary\.com\/([a-z0-9_-]+)\/(image|video|raw)\/upload\/([^\s"'\\)<>]+?)(?=[\s"'\\)<>]|$)/gi;

// 이 앱이 Cloudinary 에서 쓰는 폴더들 — 변형(w_800,h_600) 과 달리 밑줄이
// 들어 있어도 폴더로 인식해야 한다.
const KNOWN_FOLDERS = new Set(['sdynotes', 'sdynotes_music', 'sdy_stickers', 'sdy_wallpaper', 'sdy_vault']);

export function parseCldUrl(cloud, type, tail) {
  // tail: [변형...]/[vN/]/<public_id>(.ext)?
  const segs = String(tail).split('/').filter(Boolean);
  const isTransform = (s) => /[,:]/.test(s)
    || (/^[a-z]+_[a-z0-9]+$/i.test(s) && !KNOWN_FOLDERS.has(s.toLowerCase()));
  const isVersion = (s) => /^v\d+$/i.test(s);
  let i = 0;
  while (i < segs.length && isTransform(segs[i])) i++;
  if (i < segs.length && isVersion(segs[i])) i++;
  const rest = segs.slice(i);
  if (!rest.length) return null;
  let ext = '';
  let last = rest[rest.length - 1];
  const dot = last.lastIndexOf('.');
  if (dot > 0 && /^\.[a-z0-9]{1,5}$/i.test(last.slice(dot))) {
    ext = last.slice(dot + 1).toLowerCase();
    rest[rest.length - 1] = last.slice(0, dot);
  }
  return { pid: rest.join('/'), ext, type };
}

const MUSIC_EXTS = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'webm', 'weba'];

// ── 메인 ──────────────────────────────────────────────────────────────
export async function migrateAll(opts = {}) {
  const args = parseArgs(process.argv);
  const o = { ...args, ...opts };
  const base = path.resolve(o.base || path.resolve(path.dirname(process.argv[1] || '.'), '..'));
  const envFile = o.env || path.join(base, '.env');
  const fileEnv = parseEnvFile(envFile);
  const env = (k) => process.env[k] || fileEnv[k] || '';
  const dry = Boolean(o.dry);
  const STATS = freshStats();
  const warn = (msg) => { STATS.failed.push(msg); console.warn('  ⚠', msg); };

  const SUPABASE_URL = (env('SUPABASE_URL') || 'https://xillsulrehkpuzyuhgcn.supabase.co').replace(/\/+$/, '');
  const SUPABASE_KEY = (env('SUPABASE_SERVICE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_KEY') || '').trim();
  const CLOUD_NAME = env('CLOUDINARY_CLOUD_NAME') || 'os8j8bnv';
  const CLD_KEY = env('CLOUDINARY_API_KEY') || '';
  const CLD_SECRET = env('CLOUDINARY_API_SECRET') || '';
  // 다운로드 호스트 오버라이드(테스트/프록시용). 콘텐츠 치환 정규식은 항상
  // res.cloudinary.com URL 을 대상으로 한다.
  const CLD_BASE = (env('CLOUDINARY_BASE') || 'https://res.cloudinary.com').replace(/\/+$/, '');

  const D = {
    sync: path.join(base, 'sync'),
    cards: path.join(base, 'cards'),
    music: path.join(base, 'music'),
    stickers: path.join(base, 'stickers'),
    vault: path.join(base, 'vault'),
    wallpaper: path.join(base, 'wallpaper'),
    img: path.join(base, 'imported'),
    db: path.join(base, 'db'),
  };
  const marker = path.join(base, '.oracle_migrated');

  log('━━━ SDYnotes → Oracle 자체 저장소 이전 ━━━');
  log(`  대상 루트   : ${base}`);
  log(`  모드        : ${dry ? 'DRY RUN (쓰기 없음)' : '실제 이전'}`);
  log(`  Supabase    : ${SUPABASE_KEY ? SUPABASE_URL : '(키 없음 — 테이블 이전 건너뜀)'}`);
  log(`  Cloudinary  : cloud=${CLOUD_NAME} api=${CLD_KEY ? '있음' : '없음(공개 자산만)'}`);

  if (!dry && !o.force && fs.existsSync(marker)) {
    log('  이미 이전 완료(.oracle_migrated). --force 로 빠진 항목만 다시 보강할 수 있습니다.');
    return STATS;
  }

  const sbRows = makeSb({ url: SUPABASE_URL, key: SUPABASE_KEY, warn });
  const cld = await makeCld({ cloudName: CLOUD_NAME, apiKey: CLD_KEY, apiSecret: CLD_SECRET, base: CLD_BASE });

  // ── 1. Supabase 테이블 → 로컬 ─────────────────────────────────────
  const hasSb = Boolean(SUPABASE_KEY);
  let sbSync = [], sbCards = [], sbMusic = [], sbStickers = [], sbNotebooks = [], sbMemos = [], sbImages = [];
  if (hasSb) {
    log('\n[1/5] Supabase 테이블 내려받기');
    sbSync = await sbRows('sdy_sync_states');
    sbCards = await sbRows('sdy_card_decks');
    sbMusic = await sbRows('sdy_music_tracks');
    sbStickers = await sbRows('sdy_stickers');
    sbNotebooks = await sbRows('notebooks');
    sbMemos = await sbRows('memos');
    sbImages = await sbRows('images');
    STATS.rows += sbSync.length + sbCards.length + sbMusic.length + sbStickers.length
      + sbNotebooks.length + sbMemos.length + sbImages.length;
    log(`  sync=${sbSync.length} cards=${sbCards.length} music=${sbMusic.length} stickers=${sbStickers.length}`
      + ` notebooks=${sbNotebooks.length} memos=${sbMemos.length} images=${sbImages.length}`);
  } else {
    log('\n[1/5] Supabase 키 없음 — 테이블 이전 건너뜀');
  }

  // (a) sync 상태 + yt_cookies
  if (sbSync.length) {
    log('  · sync 상태 병합(요소별 LWW)');
    for (const row of sbSync) {
      const id = String(row.id || '');
      if (!id) continue;
      if (id === 'yt_cookies') {
        const cookies = String(row?.data?.cookies || '');
        const localCookieFile = path.join(D.music, '_yt_cookies.txt');
        let localEmpty = true;
        try { localEmpty = (await fsp.stat(localCookieFile)).size < 50; } catch { /* */ }
        if (cookies.length >= 50 && localEmpty) {
          await writeText(localCookieFile, cookies, dry);
          await writeText(path.join(base, '_yt_cookies.txt.bak'), cookies, dry);
          log(`    yt_cookies 복원 (${cookies.length}B)`);
        } else {
          log('    yt_cookies — 로컬 파일 우선(건너뜀)');
        }
        continue;
      }
      const file = path.join(D.sync, `${id.replace(/[^0-9a-zA-Z-]/g, '')}.json`);
      const localState = await readJson(file, null);
      await writeJson(file, mergeSyncState(localState, row.data), dry, STATS);
    }
  }

  // (b) 카드 덱
  if (sbCards.length) {
    log('  · 카드 덱 저장');
    for (const row of sbCards) {
      const id = String(row.id || '').replace(/[^0-9a-zA-Z_-]/g, '');
      if (!id || !row.data) continue;
      await writeJson(path.join(D.cards, `${id}.json`), row.data, dry, STATS);
    }
  }

  // (c) db 테이블 (예전에 브라우저가 Supabase 에 직접 저장하던 노트 목록/본문)
  for (const [name, rows] of [['notebooks', sbNotebooks], ['memos', sbMemos], ['images', sbImages]]) {
    if (!rows.length) continue;
    log(`  · db/${name} ${rows.length}행`);
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !row.id) continue;
      const file = path.join(D.db, name, `${String(row.id).replace(/[^0-9a-zA-Z_-]/g, '')}.json`);
      if (fs.existsSync(file)) { STATS.skipped += 1; continue; }
      await writeJson(file, row, dry, STATS);
    }
  }

  // ── 2. Cloudinary 자산 → 서버 디스크 ────────────────────────────────
  log('\n[2/5] Cloudinary 자산 내려받기');

  // (a) 음악: 음원 + 표지 → music/, 레코드를 로컬 형태로 치환해 _index.json 병합
  let musicIndex = await readJson(path.join(D.music, '_index.json'), {});
  if (!musicIndex || typeof musicIndex !== 'object' || Array.isArray(musicIndex)) musicIndex = {};
  const localAudio = new Map(); // mid → {ext, bytes}
  try {
    for (const fn of await fsp.readdir(D.music)) {
      const m2 = fn.match(/^([0-9A-Za-z_-]+)\.([a-z0-9]+)$/i);
      if (m2 && MUSIC_EXTS.includes(m2[2].toLowerCase())) {
        try {
          const st = await fsp.stat(path.join(D.music, fn));
          localAudio.set(m2[1], { ext: m2[2].toLowerCase(), bytes: st.size });
        } catch { /* */ }
      }
    }
  } catch { /* */ }

  for (const row of sbMusic) {
    const rec = row?.data;
    const mid = String(rec?.id || row.id || '').replace(/[^0-9A-Za-z_-]/g, '');
    if (!mid || !rec) continue;
    const ext = String(rec.ext || 'mp3').toLowerCase();
    const target = path.join(D.music, `${mid}.${ext}`);
    if (!localAudio.has(mid)) {
      const pid = rec.cloud_public_id || `sdynotes_music/${mid}`;
      const u = cld.url(pid, { resourceType: 'video', format: ext, version: rec.version || 0 });
      const r = await downloadTo(u, target, STATS, { dry, label: `음원 ${rec.title || mid}` });
      if (r.ok && !r.dry) localAudio.set(mid, { ext, bytes: r.bytes });
    } else {
      STATS.skipped += 1;
    }
    const coverFile = path.join(D.music, `${mid}.cover`);
    let hasCover = false;
    try { hasCover = (await fsp.stat(coverFile)).size > 0; } catch { /* */ }
    if (!hasCover && (rec.cover_public_id || rec.cover_url)) {
      const pid = rec.cover_public_id || `sdynotes_music/${mid}_cover`;
      const r = await downloadTo(
        cld.url(pid, { resourceType: 'image', format: 'jpg' }),
        coverFile, STATS, { dry, label: `표지 ${rec.title || mid}` });
      hasCover = Boolean(r.ok);
    }
    // 레코드 병합: 원격(기준) + 로컬의 비어 있지 않은 필드로 보충(가사 등)
    const old = (typeof musicIndex[mid] === 'object' && musicIndex[mid]) || {};
    const merged = { ...old, ...rec };
    for (const k of ['title', 'artist', 'album', 'year', 'genre', 'lyrics', 'lyrics_plain', 'lyrics_src',
      'orig_title', 'tag_state', 'tag_src', 'tag_algo']) {
      const ov = old[k];
      if (ov !== undefined && ov !== '' && ov !== null
        && (merged[k] === undefined || merged[k] === '' || merged[k] === null)) merged[k] = ov;
    }
    const audioInfo = localAudio.get(mid);
    merged.id = mid;
    merged.ext = audioInfo ? audioInfo.ext : ext;
    merged.bytes = audioInfo ? audioInfo.bytes : (rec.bytes || 0);
    merged.cover = Boolean(hasCover);
    merged.stream_url = `/api/music/file/${mid}`;
    for (const k of ['cloud_public_id', 'cover_public_id', 'cover_url', 'version']) delete merged[k];
    musicIndex[mid] = merged;
  }
  if (sbMusic.length) {
    await writeJson(path.join(D.music, '_index.json'), musicIndex, dry, STATS);
    await writeJson(path.join(D.music, '_index.json.bak'), musicIndex, dry);
    log(`  · 음악 ${sbMusic.length}곡 정리 (보유 음원 ${localAudio.size})`);
  }

  // (b) 스티커
  let stickerIndex = await readJson(path.join(D.stickers, '_index.json'), {});
  if (!stickerIndex || typeof stickerIndex !== 'object' || Array.isArray(stickerIndex)) stickerIndex = {};
  for (const row of sbStickers) {
    const rec = row?.data;
    const sid = String(rec?.id || row.id || '').replace(/[^0-9A-Za-z_-]/g, '');
    if (!sid || !rec) continue;
    const urlExt = (String(rec.url || '').match(/\.(png|jpe?g|webp|gif)(?:$|\?)/i) || [])[1];
    const ext = (urlExt || 'png').toLowerCase().replace('jpeg', 'jpg');
    const fn = `${sid}.${ext}`;
    const target = path.join(D.stickers, fn);
    let existed = false;
    try { existed = (await fsp.stat(target)).size > 0; } catch { /* */ }
    if (!existed) {
      const pid = rec.public_id || `sdy_stickers/${sid}`;
      await downloadTo(cld.url(pid, { resourceType: 'image', format: ext }),
        target, STATS, { dry, label: `스티커 ${rec.name || sid}` });
    } else {
      STATS.skipped += 1;
    }
    stickerIndex[sid] = {
      id: sid, name: rec.name || '스티커', bytes: rec.bytes || 0,
      created_at: rec.created_at || row.updated_at || '',
      url: `/api/stickers/raw/${sid}`, stored: fn, storage: 'local',
    };
  }
  if (sbStickers.length) {
    await writeJson(path.join(D.stickers, '_index.json'), stickerIndex, dry, STATS);
    log(`  · 스티커 ${sbStickers.length}개 정리`);
  }

  // (c) 보관함(vault) — 메타는 원래 로컬, cloudinary 저장 행만 로컬 파일로 전환
  const vaultMeta = path.join(D.vault, '_index.json');
  let vault = await readJson(vaultMeta, {});
  let vaultChanged = 0;
  for (const [fid, rec] of Object.entries(vault)) {
    if (!rec || rec.storage !== 'cloudinary') continue;
    const pid = String(rec.public_id || '');
    if (!pid) continue;
    const rt = rec.resource_type || 'raw';
    let stored = pid.startsWith('sdy_vault/') ? pid.slice('sdy_vault/'.length) : pid.split('/').pop();
    stored = stored.replace(/[\\/]/g, '_');
    // image/video 는 업로드 때 확장자가 떨어져 나간다 — 원본 파일명에서 복구
    if (rt !== 'raw' && !/\.[a-z0-9]{1,5}$/i.test(stored)) {
      const nameExt = (String(rec.name || '').match(/\.([a-z0-9]{1,5})$/i) || [])[1];
      if (nameExt) stored += `.${nameExt.toLowerCase()}`;
    }
    const target = path.join(D.vault, stored);
    let existed = false;
    try { existed = (await fsp.stat(target)).size > 0; } catch { /* */ }
    if (!existed) {
      const u = rt === 'raw'
        ? cld.url(pid, { resourceType: 'raw', version: rec.version || 0, sign: true })
        : cld.url(pid, { resourceType: rt });
      const r = await downloadTo(u, target, STATS, { dry, label: `보관함 ${rec.name || fid}` });
      if (r.ok && !r.dry && r.bytes) rec.bytes = r.bytes;
    } else {
      STATS.skipped += 1;
    }
    rec.storage = 'local';
    rec.stored = stored;
    rec.url = `/api/files/raw/${fid}`;
    vaultChanged += 1;
  }
  if (vaultChanged) {
    await writeJson(vaultMeta, vault, dry, STATS);
    log(`  · 보관함 ${vaultChanged}건 → 로컬`);
  }

  // ── 3. URL 스윕: 노트/설정/배경의 cloudinary URL 치환 ───────────────
  log('\n[3/5] 콘텐츠 안 cloudinary URL 치환');
  const handledPrefixes = ['sdynotes_music/', 'sdy_stickers/', 'sdy_vault/']; // 위 단계에서 처리됨
  const scanFiles = [];
  for (const dir of [D.sync, path.join(D.db, 'memos'), path.join(D.db, 'notebooks')]) {
    try {
      for (const n of await fsp.readdir(dir)) {
        if (n.endsWith('.json') && !n.includes('.tmp.')) scanFiles.push(path.join(dir, n));
      }
    } catch { /* */ }
  }

  // 1차: 등장하는 모든 cloudinary URL 수집
  const assets = new Map(); // pid → {ext, type, count}
  for (const file of scanFiles) {
    let txt;
    try { txt = await fsp.readFile(file, 'utf8'); } catch { continue; }
    for (const m of txt.matchAll(CLD_URL_RE)) {
      if (m[1] !== CLOUD_NAME) continue;
      const info = parseCldUrl(m[1], m[2], m[3]);
      if (!info || !info.pid) continue;
      if (handledPrefixes.some((p) => info.pid.startsWith(p))) continue;
      if (!assets.has(info.pid)) assets.set(info.pid, { ext: info.ext, type: info.type, count: 0 });
      const a = assets.get(info.pid);
      a.count += 1;
      if (!a.ext) a.ext = info.ext;
      if (info.type === 'video' || info.type === 'raw') a.type = info.type;
    }
  }
  log(`  참조 발견: ${assets.size}개 자산`);

  // 2차: 원본 내려받기 + 치환 규칙 준비
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replacers = [];
  for (const [pid, a] of assets) {
    const isWall = pid.startsWith('sdy_wallpaper/');
    const tail = pid.split('/').pop();
    let localUrl;
    if (isWall) {
      const ext = a.ext || (a.type === 'video' ? 'mp4' : 'jpg');
      const target = path.join(D.wallpaper, `${tail}.${ext}`);
      const r = await downloadTo(cld.url(pid, { resourceType: a.type, format: ext }), target,
        STATS, { dry, label: `배경 ${tail}` });
      if (!r.ok && r.missing && a.ext && a.ext !== ext) {
        await downloadTo(cld.url(pid, { resourceType: a.type, format: a.ext }),
          path.join(D.wallpaper, `${tail}.${a.ext}`), STATS, { dry, label: `배경 ${tail}` });
      }
      localUrl = `/api/wallpaper/${tail}`;
    } else {
      const ext = a.ext || 'webp';
      const fn = `img-${tail}.${ext}`;
      const r = await downloadTo(cld.url(pid, { resourceType: a.type, format: ext }),
        path.join(D.img, fn), STATS, { dry, label: `이미지 ${tail}` });
      if (!r.ok && r.missing) {
        for (const alt of ['webp', 'jpg', 'png', 'mp4']) {
          if (alt === ext) continue;
          const rr = await downloadTo(cld.url(pid, { resourceType: a.type, format: alt }),
            path.join(D.img, `img-${tail}.${alt}`), STATS, { dry, label: `이미지 ${tail}` });
          if (rr.ok) break;
        }
      }
      localUrl = `/api/img/img-${tail}.${ext}`;
    }
    const re = new RegExp(
      `https://res\\.cloudinary\\.com/${escRe(CLOUD_NAME)}` +
      `\\/(image|video|raw)\\/upload\\/(?:[^\\s"'\\\\)<>]*?\\/)?${escRe(pid)}(?:\\.[a-zA-Z0-9]{1,5})?(?![A-Za-z0-9_-])`,
      'g');
    replacers.push({ pid, re, localUrl });
  }

  // 3차: 파일별 치환 (변형 URL f_auto,q_auto / w_..,h_.. / v123 모두 같은 로컬 주소로)
  for (const file of scanFiles) {
    let txt;
    try { txt = await fsp.readFile(file, 'utf8'); } catch { continue; }
    let out = txt;
    for (const { re, localUrl } of replacers) out = out.replace(re, localUrl);
    if (out !== txt) {
      const before = (txt.match(/https:\/\/res\.cloudinary\.com/g) || []).length;
      const after = (out.match(/https:\/\/res\.cloudinary\.com/g) || []).length;
      STATS.replaced += before - after;
      if (!dry) {
        const tmp = `${file}.tmp.${crypto.randomBytes(3).toString('hex')}`;
        await fsp.writeFile(tmp, out, 'utf8');
        await fsp.rename(tmp, file);
      } else {
        log(`    [dry] 치환 ${file}`);
      }
    }
  }
  log(`  URL 치환 ${STATS.replaced}곳`);

  // ── 4. 마커 + 리포트 ───────────────────────────────────────────────
  log('\n[4/5] 마커/리포트');
  const report = {
    when: new Date().toISOString(),
    base,
    dry,
    stats: { ...STATS },
    assets: [...assets.entries()].map(([pid, a]) => ({ pid, ...a })),
  };
  await writeJson(path.join(base, '.oracle_migrated.report.json'), report, dry);
  if (!dry) {
    await fsp.writeFile(marker, new Date().toISOString() + '\n');
    log('  .oracle_migrated 작성 — 다음 배포부터는 이 전을 건너뜁니다.');
  }

  log('\n[5/5] 요약');
  log(`  행 이전       : ${STATS.rows}`);
  log(`  파일 다운로드 : ${STATS.files} (${(STATS.bytes / 1024 / 1024).toFixed(1)}MB)`);
  log(`  URL 치환      : ${STATS.replaced}`);
  log(`  기존 파일 유지: ${STATS.skipped}`);
  if (STATS.failed.length) {
    log(`  실패/경고     : ${STATS.failed.length}건`);
    for (const f of STATS.failed) log(`    - ${f}`);
  }
  log(dry ? '\n  (dry-run — 실제로는 저장되지 않았습니다. --dry 를 빼고 다시 실행하세요.)'
    : '\n  ✅ 이전 완료. 이제 SDY_STORAGE 기본값(oracle) 로 서비스를 시작하세요.');
  return STATS;
}

// CLI 로 실행된 경우에만 시작 (테스트는 migrateAll 을 import 해 사용)
const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  migrateAll().catch((e) => { console.error('이전 실패:', e); process.exit(1); });
}
