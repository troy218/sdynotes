// Oracle 이전 시뮬레이션 — 목업 Supabase(PostgREST) + Cloudinary 를 띄우고
// scripts/migrate_to_oracle.mjs 가 실제로 모든 데이터를 옮기는지 검증한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const ok = (name) => console.log(`  ✓ ${name}`);

// ── 목업 데이터 ────────────────────────────────────────────────────────
const NOTE_IMG_PID = 'sdynotes/abc123';
const COOKIES = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tCOOKIE_A\tvalue_a\n.youtube.com\tTRUE\t/\tTRUE\t0\tCOOKIE_B\tvalue_b\n';

const DB = {
  sdy_sync_states: [
    { id: 'nb1', updated_at: '2026-01-02T00:00:00Z', data: {
      els: { e1: { rev: 5, dev: 'pc', data: { type: 'text', html: '<p>remote</p>' } } },
      pages: { rev: 3, ids: ['p1'] }, version: 5,
    } },
    { id: '__settings1', updated_at: '2026-01-02T00:00:00Z', data: {
      els: { wall: { rev: 2, dev: 'pc', data: { type: 'settings',
        wallpaper: 'https://res.cloudinary.com/testcloud/video/upload/sdy_wallpaper/wid9.mp4' } } },
      version: 2,
    } },
    { id: 'yt_cookies', updated_at: '2026-01-02T00:00:00Z', data: { cookies: COOKIES } },
  ],
  sdy_card_decks: [
    { id: 'd1', updated_at: '2026-01-02T00:00:00Z', data: { id: 'd1', title: '덱1', cards: [{ id: 'c1', front: 'Q', opts: ['a', 'b'] }], created_at: 1, updated_at: 2 } },
  ],
  sdy_music_tracks: [
    { id: 'm1', updated_at: '2026-01-02T00:00:00Z', data: {
      id: 'm1', title: 'Hello', artist: 'Adele', ext: 'mp3', bytes: 9,
      cloud_public_id: 'sdynotes_music/m1', cover_public_id: 'sdynotes_music/m1_cover',
      cover_url: 'https://res.cloudinary.com/testcloud/image/upload/sdynotes_music/m1_cover.jpg',
      stream_url: 'https://res.cloudinary.com/testcloud/video/upload/sdynotes_music/m1.mp3',
      version: 1700000000, cover: true, play_count: 3, created_at: '2026-01-01T00:00:00Z',
      lyrics: '',
    } },
  ],
  sdy_stickers: [
    { id: 's1', updated_at: '2026-01-02T00:00:00Z', data: {
      id: 's1', name: '스티커1', bytes: 7, created_at: '2026-01-01T00:00:00Z',
      url: 'https://res.cloudinary.com/testcloud/image/upload/sdy_stickers/s1.png',
      public_id: 'sdy_stickers/s1', storage: 'cloudinary',
    } },
  ],
  notebooks: [
    { id: '11111111-1111-1111-1111-111111111111', title: '설정 ★sdy★', color: '#000', created_at: '2025-12-01T00:00:00Z', updated_at: '2025-12-01T00:00:00Z' },
    { id: '22222222-2222-2222-2222-222222222222', title: '내노트', color: '#4f6ef7', created_at: '2025-12-02T00:00:00Z', updated_at: '2025-12-02T00:00:00Z' },
  ],
  memos: [
    { id: '33333333-3333-3333-3333-333333333333', notebook_id: '22222222-2222-2222-2222-222222222222',
      content: JSON.stringify({ pages: [{ els: [
        { type: 'image', url: 'https://res.cloudinary.com/testcloud/image/upload/v1700000000/' + NOTE_IMG_PID + '.webp' },
        { type: 'image', url: 'https://res.cloudinary.com/testcloud/image/upload/f_auto,q_auto/v1700000000/' + NOTE_IMG_PID + '.webp' },
      ] }] }),
      font_size: 16, created_at: '2025-12-02T00:00:01Z', updated_at: '2025-12-02T00:00:01Z' },
  ],
  images: [
    { id: '44444444-4444-4444-4444-444444444444', public_id: NOTE_IMG_PID, url: 'https://res.cloudinary.com/testcloud/image/upload/' + NOTE_IMG_PID + '.webp' },
  ],
};

// ── 목업 서버: /rest/v1/* (PostgREST) + /testcloud/* (Cloudinary) ─────
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/rest/v1/')) {
    const table = u.pathname.split('/')[3];
    const rows = DB[table] || [];
    const offset = parseInt(u.searchParams.get('offset') || '0', 10);
    const limit = parseInt(u.searchParams.get('limit') || '1000', 10);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(rows.slice(offset, offset + limit)));
    return;
  }
  const m = u.pathname.match(/^\/testcloud\/(image|video|raw)\/upload\/(.+)$/);
  if (m) {
    const pidish = m[2].replace(/^v\d+\//, '');
    if (pidish.includes('missing')) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(Buffer.from(`BYTES:${m[1]}:${m[2]}`));
    return;
  }
  res.statusCode = 404;
  res.end('nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ── 격리된 앱 루트 + 기존 로컬 데이터 ──────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-oracle-mig-'));
const readJson = async (f, d) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return d; } };
const exists = (p) => fsp.access(p).then(() => true, () => false);

// 로컬에 더 최신인 sync 요소(e2, rev 7) — 병합에서 살아남아야 한다
fs.mkdirSync(path.join(TMP, 'sync'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'sync', 'nb1.json'), JSON.stringify({
  els: { e2: { rev: 7, dev: 'phone', data: { type: 'text', html: 'local-only' } } },
  pages: { rev: 1, ids: [] }, version: 7,
}));
// 로컬 음악 메타(가사) — 원격 레코드의 빈 필드를 보충해야 한다
fs.mkdirSync(path.join(TMP, 'music'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'music', '_index.json'), JSON.stringify({
  m1: { id: 'm1', title: '', lyrics: '[00:01] 로컬 가사', tag_state: 'done', tag_algo: '13.0' },
}));
// 보관함: cloudinary 저장 레코드 1건 (로컬 메타는 원래부터 로컬 파일)
fs.mkdirSync(path.join(TMP, 'vault'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'vault', '_index.json'), JSON.stringify({
  f1: { id: 'f1', name: '문서.pdf', bytes: 0, resource_type: 'raw',
    public_id: 'sdy_vault/f1_문서.pdf', url: 'https://res.cloudinary.com/testcloud/raw/upload/v9/sdy_vault/f1_문서.pdf',
    storage: 'cloudinary', version: 9, created_at: '2025-12-03T00:00:00Z' },
}));

const envFile = path.join(TMP, '.env');
fs.writeFileSync(envFile, [
  `SUPABASE_URL=http://127.0.0.1:${PORT}`,
  'SUPABASE_SERVICE_KEY=test-service-key',
  'CLOUDINARY_CLOUD_NAME=testcloud',
  'CLOUDINARY_API_KEY=k', 'CLOUDINARY_API_SECRET=s',
  `CLOUDINARY_BASE=http://127.0.0.1:${PORT}`,
].join('\n'));

// ── 실행 ───────────────────────────────────────────────────────────────
const { migrateAll, parseCldUrl, mergeSyncState } = await import('../scripts/migrate_to_oracle.mjs');
const stats = await migrateAll({ base: TMP, env: envFile, force: true });
console.log(`  (stats: rows=${stats.rows} files=${stats.files} replaced=${stats.replaced} failed=${stats.failed.length})`);

// ── 검증 ───────────────────────────────────────────────────────────────
// 1. sync 병합 (syncEngine 과 같은 파일명 규칙: [0-9a-zA-Z-] 만)
const nb1 = await readJson(path.join(TMP, 'sync', 'nb1.json'), {});
assert.equal(nb1.els.e1.data.html, '<p>remote</p>', '원격 요소 보존');
assert.equal(nb1.els.e2.data.html, 'local-only', '로컬 최신 요소 보존(LWW 병합)');
assert.equal(nb1.version, 7);
assert.ok(await exists(path.join(TMP, 'sync', 'settings1.json')), '설정 상태 저장 (__settings1 → settings1.json)');
ok('sync 상태 요소별 LWW 병합');

// 2. yt 쿠키
const ck = await fsp.readFile(path.join(TMP, 'music', '_yt_cookies.txt'), 'utf8');
assert.ok(ck.includes('COOKIE_A'), 'yt_cookies 복원');
ok('yt_cookies → music/_yt_cookies.txt');

// 3. 카드
const d1 = await readJson(path.join(TMP, 'cards', 'd1.json'), null);
assert.equal(d1.title, '덱1');
ok('카드 덱 → cards/d1.json');

// 4. db 테이블 (프런트가 쓰던 notebooks/memos/images)
assert.ok(await exists(path.join(TMP, 'db', 'notebooks', '11111111-1111-1111-1111-111111111111.json')));
assert.ok(await exists(path.join(TMP, 'db', 'notebooks', '22222222-2222-2222-2222-222222222222.json')));
assert.ok(await exists(path.join(TMP, 'db', 'images', '44444444-4444-4444-4444-444444444444.json')));
const memoTxt = await fsp.readFile(path.join(TMP, 'db', 'memos', '33333333-3333-3333-3333-333333333333.json'), 'utf8');
assert.ok(!memoTxt.includes('res.cloudinary.com'), 'memos content 의 cloudinary URL 전부 치환됨');
assert.ok(memoTxt.includes('/api/img/img-abc123.webp'), '노트 이미지 → /api/img (원본+변형 모두)');
assert.equal((memoTxt.match(/\/api\/img\/img-abc123\.webp/g) || []).length, 2, '두 변형 URL 모두 치환');
ok('notebooks/memos/images → db/ + URL 치환');

// 5. 노트 이미지 원본 파일
assert.ok(await exists(path.join(TMP, 'imported', 'img-abc123.webp')), '노트 이미지 원본 다운로드');
ok('노트 이미지 → imported/ + /api/img');

// 6. 배경화면 (설정 상태 안 URL)
const st = await readJson(path.join(TMP, 'sync', 'settings1.json'), {});
assert.equal(st.els.wall.data.wallpaper, '/api/wallpaper/wid9', '배경 URL 치환');
assert.ok(await exists(path.join(TMP, 'wallpaper', 'wid9.mp4')), '배경 mp4 다운로드');
ok('배경화면 → wallpaper/ + /api/wallpaper');

// 7. 음악
const mi = await readJson(path.join(TMP, 'music', '_index.json'), {});
assert.equal(mi.m1.stream_url, '/api/music/file/m1', 'stream_url 로컬 경로로');
assert.ok(!('cloud_public_id' in mi.m1) && !('cover_url' in mi.m1), '클라우드 필드 제거');
assert.equal(mi.m1.lyrics, '[00:01] 로컬 가사', '로컬 가사 보존(빈 필드 보충)');
assert.equal(mi.m1.title, 'Hello', '원격 제목 우선');
assert.equal(mi.m1.cover, true);
const audio = await fsp.readFile(path.join(TMP, 'music', 'm1.mp3'));
assert.ok(audio.includes('BYTES:video:') && audio.includes('sdynotes_music/m1'), '음원 다운로드');
assert.ok(await exists(path.join(TMP, 'music', 'm1.cover')), '표지 다운로드');
ok('음악: 음원+표지 다운로드 + 레코드 로컬화');

// 8. 스티커
const si = await readJson(path.join(TMP, 'stickers', '_index.json'), {});
assert.equal(si.s1.storage, 'local');
assert.equal(si.s1.url, '/api/stickers/raw/s1');
assert.equal(si.s1.stored, 's1.png');
assert.ok(await exists(path.join(TMP, 'stickers', 's1.png')));
ok('스티커 → stickers/ + 로컬 레코드');

// 9. 보관함
const vi = await readJson(path.join(TMP, 'vault', '_index.json'), {});
assert.equal(vi.f1.storage, 'local');
assert.equal(vi.f1.url, '/api/files/raw/f1');
assert.ok(vi.f1.stored.includes('f1_'), 'stored 파일명');
assert.ok(await exists(path.join(TMP, 'vault', vi.f1.stored)), '보관함 파일 다운로드');
ok('보관함 → vault/ 로컬 전환');

// 10. 마커/리포트
assert.ok(await exists(path.join(TMP, '.oracle_migrated')));
const rep = await readJson(path.join(TMP, '.oracle_migrated.report.json'), {});
assert.equal(rep.dry, false);
ok('.oracle_migrated + 리포트');

// 11. 파서/병합 유닛
let p = parseCldUrl('testcloud', 'image', 'f_auto,q_auto/v1700/sdynotes/abc123.webp');
assert.deepEqual([p.pid, p.ext], ['sdynotes/abc123', 'webp']);
p = parseCldUrl('testcloud', 'video', 'sdy_wallpaper/wid9.mp4');
assert.equal(p.pid, 'sdy_wallpaper/wid9', '밑줄 폴더명(sdy_wallpaper) 을 변형으로 오인하지 않음');
p = parseCldUrl('testcloud', 'video', 'w_800,h_600,c_fill/v1/sdy_wallpaper/w9.jpg');
assert.equal(p.pid, 'sdy_wallpaper/w9', '변형+버전 조합');
ok('parseCldUrl — 변형/버전/폴더 구분');

server.close();
try { await fsp.rm(TMP, { recursive: true, force: true }); } catch { /* */ }
console.log('\nOracle 이전 시뮬레이션: 전체 통과 ✅');
