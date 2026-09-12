#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   논문이 정말 '서버 → 기기'로 옮겨지고 서버에서 지워지는가

   이 검사가 필요한 이유
     이 구조의 유일한 큰 위험은 **기기가 못 받았는데 서버가 지워 버리는 것**이다.
     그러면 논문이 영영 사라진다. 그래서 ①받은 양과 서버가 가진 양을 맞춰 보고
     ②기기가 실제로 읽을 수 있는지(조각·그림·메타·원본) 확인하고
     ③덜 받았을 때는 서버가 **지우지 않는지** 확인한다.

   어떻게 진짜로 확인하나
     · 서버 파일을 실제로 만든다 (imported_docs/ 임시 폴더)
     · 서버가 쓰는 **같은 코드**(server/src/lib/bundle.js)로 번들을 만든다
     · **앱이 쓰는 doc-store.js · local-docs.js 를 그대로 불러와**(vm) 돌린다
       — IndexedDB 는 메모리 가짜. 번들이 조각조각 도착하는 상황까지 흉내낸다.
     · 마지막으로 서버의 importsRelease 를 불러 실제 파일이 지워지는지 본다

     node scripts/test-local-docs.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO = path.resolve(PKG, '..', '..');

let pass = 0; const fails = [];
function check(ok, good, bad) {
  if (ok) { pass += 1; console.log('  ✅ ' + good); }
  else { fails.push(bad || good); console.log('  ❌ ' + (bad || good)); }
}
const mb = (n) => ((n || 0) / 1048576).toFixed(1) + 'MB';

// ── 임시 서버 디렉터리 (운영과 같은 구조) ────────────────────────────────
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-docs-'));
const DOCS = path.join(ROOT, 'imported_docs');   // {jid}.json.gz · .s0.gz · .meta.json · .src
const IMG = path.join(ROOT, 'imported');         // 배경 이미지
fs.mkdirSync(DOCS, { recursive: true });
fs.mkdirSync(IMG, { recursive: true });

process.env.SDY_BASE_DIR = ROOT;
process.env.SDY_ENV_FILE = path.join(ROOT, '없는.env');
process.env.SDY_STORAGE = 'oracle';
process.env.SDY_IMPORT_QUOTA_MB = '2048';

const store = await import(path.join(REPO, 'server/src/lib/imports.js'));
const { bundleBuffer } = await import(path.join(REPO, 'server/src/lib/bundle.js'));

// ── 가짜 IndexedDB (앱이 쓰는 만큼만) ────────────────────────────────────
function makeIDB() {
  const dbs = new Map();
  const request = (getValue) => {
    const r = { result: undefined, error: null, onsuccess: null, onerror: null };
    setTimeout(() => {
      try { r.result = getValue(); if (r.onsuccess) r.onsuccess({ target: r }); }
      catch (e) { r.error = e; if (r.onerror) r.onerror({ target: r }); }
    }, 0);
    return r;
  };
  // 커서도 가짜다. 주의할 점 두 가지:
  //   ① 호출부가 반환값에 onsuccess 를 **나중에** 붙인다 → 동기로 돌리면 결과를 흘린다
  //   ② 커서가 도는 동안 트랜잭션이 '끝났다'고 하면 안 된다 → 완료 시각을 계속 미룬다
  function cursorFor(map, tx) {
    const r = { result: null, onsuccess: null, onerror: null };
    const keys = [...map.keys()];
    let i = 0;
    const step = () => {
      tx._arm();
      if (i >= keys.length) { r.result = null; if (r.onsuccess) r.onsuccess({ target: r }); return; }
      const k = keys[i++];
      r.result = { value: map.get(k), delete: () => { map.delete(k); }, continue: step };
      if (r.onsuccess) r.onsuccess({ target: r });
    };
    setTimeout(step, 0);
    return r;
  }
  function makeTx(db) {
    const tx = { error: null, oncomplete: null, onerror: null, onabort: null, _done: false };
    const finish = () => { if (!tx._done) { tx._done = true; if (tx.oncomplete) tx.oncomplete(); } };
    // 완료 시각은 '마지막 작업'보다 **뒤**여야 한다. 커서는 0ms 간격으로 도는데
    //  완료도 0ms 로 잡으면 값이 하나도 안 온 상태에서 끝났다고 알린다.
    tx._arm = () => { clearTimeout(tx._t); tx._t = setTimeout(finish, 3); };
    tx._arm();
    tx.objectStore = (n) => {
      const map = db._data.get(n);
      const kp = db._stores.get(n).keyPath;
      return {
        put: (v) => { map.set(v[kp], v); tx._arm(); return request(() => v); },
        get: (k) => { tx._arm(); return request(() => map.get(k)); },
        delete: (k) => { map.delete(k); tx._arm(); return request(() => undefined); },
        openCursor: () => cursorFor(map, tx),
      };
    };
    return tx;
  }
  return {
    open(name, ver) {
      const r = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        let db = dbs.get(name);
        const fresh = !db;
        if (!db) {
          db = { name, version: ver, _data: new Map(), _stores: new Map(),
            objectStoreNames: { contains: (n) => db._stores.has(n) } };
          dbs.set(name, db);
        }
        db.createObjectStore = (n, opt) => {
          db._stores.set(n, opt || {});
          db._data.set(n, new Map());
          return { name: n, createIndex() {} };
        };
        db.transaction = (names) => makeTx(db);
        r.result = db;
        if (fresh && r.onupgradeneeded) r.onupgradeneeded({ target: r });
        if (r.onsuccess) r.onsuccess({ target: r });
      }, 0);
      return r;
    },
  };
}

// ── 앱 코드를 앱과 같은 환경에서 불러온다 ───────────────────────────────
//  번들이 **조각조각** 도착하게 해서 경계 처리를 가혹하게 시험한다.
let chunkSize = 65536;
let brokenAt = 0;              // 0 이 아니면 그 지점에서 잘린 응답을 준다
let requests = [];

const sandbox = {
  console, setTimeout, clearTimeout, Promise, JSON, Object, Array, String, Number,
  Math, Date, isFinite, parseInt, parseFloat, Uint8Array, Int8Array, DataView, Map, Set,
  Error, TypeError, TextDecoder, TextEncoder, Blob, Response, ReadableStream,
  DecompressionStream, URL, Headers, encodeURIComponent, decodeURIComponent, CustomEvent,
  indexedDB: makeIDB(),
  navigator: { storage: { persist: () => Promise.resolve(true) } },
};
sandbox.self = sandbox;
sandbox.window = sandbox;
sandbox.location = { origin: 'https://app.notesis.test', href: 'https://app.notesis.test/' };
sandbox.addEventListener = () => {};
sandbox.dispatchEvent = () => {};
sandbox.toast = () => {};

const bundleFor = {};
const statusFor = {};
// 실제 서버는 세션 토큰으로 회원을 알아낸다. 여기서는 그 자리를 문서별 임자로 대신한다.
const ownerOf = { scan777: 'u_scan', half888: 'u_half', tiny999: 'u_tiny' };
function responseOf(buf, chunk) {
  const headers = new Headers({
    'X-SDY-Bundle-Files': String(statusFor[buf.__jid].files),
    'X-SDY-Bundle-Bytes': String(statusFor[buf.__jid].bytes),
    'Content-Type': 'application/vnd.sdy.bundle',
  });
  let i = 0;
  const body = new ReadableStream({
    pull(c) {
      if (i >= buf.length) { c.close(); return; }
      const n = Math.min(chunk, buf.length - i);
      c.enqueue(new Uint8Array(buf.subarray(i, i + n)));
      i += n;
    }
  });
  return new Response(body, { status: 200, headers });
}

// 앱이 쓰는 raw fetch (서버 역할을 대신한다 — 실제로는 서버로 나가는 요청)
sandbox.fetch = async function (input, init) {
  const u = new URL(typeof input === 'string' ? input : input.url, sandbox.location.origin);
  const method = String((init && init.method) || 'GET').toUpperCase();
  requests.push(method + ' ' + u.pathname);
  const jid = decodeURIComponent((u.pathname.split('/')[4] || ''));

  if (u.pathname.startsWith('/api/import/bundle/')) {
    if (!bundleFor[jid]) return new Response('{}', { status: 404 });
    let b = bundleFor[jid];
    if (brokenAt) b = b.subarray(0, brokenAt);
    return responseOf(b, chunkSize);
  }
  if (u.pathname.startsWith('/api/import/release/')) {
    const body = JSON.parse((init && init.body) || '{}');
    const r = await store.importsRelease(jid, ownerOf[jid] || 'u_scan', body);
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 409 });
  }
  if (u.pathname === '/api/auth/storage') {
    // 요금제에 따라 답이 달라진다 (앱은 이걸 보고 서버 보관/기기 보관을 가른다)
    const premium = !!sandbox.__premium;
    return new Response(JSON.stringify(premium ? {
      ok: true, cloud: true, keeps_copy: true, quota: 200 * 1024 * 1024 * 1024,
      plan: { id: 'premium', name: '프리미엄', price: 14900, keeps_copy: true, cloud_bytes: 200 * 1024 * 1024 * 1024, papers_per_month: null },
      papers: { count: 0, bytes: 0, this_month: 0, per_month: null },
    } : {
      ok: true, cloud: false, keeps_copy: false, quota: 0,
      plan: { id: 'free', name: '무료', price: 0, keeps_copy: false, cloud_bytes: 0, papers_per_month: 5 },
      papers: { count: 0, bytes: 0, this_month: 1, per_month: 5 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.pathname === '/api/import/local') {
    const uid = u.searchParams.get('uid') || 'u_scan';   // 앱은 토큰을 쓴다(검사에선 생략)
    const docs = await store.importsLocalList(uid);
    return new Response(JSON.stringify({ ok: true, docs }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: false, error: '없음' }), { status: 404 });
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(PKG, 'app', 'doc-store.js'), 'utf8'), sandbox, { filename: 'doc-store.js' });
vm.runInContext(fs.readFileSync(path.join(PKG, 'app', 'local-docs.js'), 'utf8'), sandbox, { filename: 'local-docs.js' });

const Store = sandbox.SDYDocStore;
const Docs = sandbox.SDY_localDocs;

// ── 픽스처 ① 스캔 논문 (12쪽 · 조각 2개 · 배경 3장 · 원본 PDF 5MB) ──────
//  서버(worker)의 규칙을 그대로 따른다:
//   · 조각 이름은 {jid}.s{쪽번호}.gz — 숫자가 **쪽 오프셋**이다 (IMP_SLICE=8)
//   · 전체 본문 {jid}.json.gz 도 함께 있고, 배경은 16진 이름의 그림 파일
const JID = 'scan777';
const PAGES = 12;
const IMP_SLICE = 8;                     // 서버 기본값 (SDY_IMP_SLICE)
const SRC_BYTES = 5 * 1024 * 1024;
const A = 'aa11aa11aa11aa11.png', B = 'bb22bb22bb22bb22.png', C = 'cc33cc33cc33cc33.png';

const pageEl = (i, img) => ({ bg: '/api/import/img/' + img, els: [{ type: 'text', t: 'page ' + i }] });
const imgOf = (i) => (i < 4 ? A : (i < 8 ? B : C));
const allPages = [];
for (let i = 0; i < PAGES; i++) allPages.push(pageEl(i, imgOf(i)));
const slice0 = allPages.slice(0, IMP_SLICE);            // 쪽 0~7
const slice1 = allPages.slice(IMP_SLICE);               // 쪽 8~11

fs.writeFileSync(path.join(DOCS, JID + '.src'), Buffer.alloc(SRC_BYTES, 7));
fs.writeFileSync(path.join(DOCS, JID + '.meta.json'), JSON.stringify({ jid: JID, total: PAGES, version: 3 }));
fs.writeFileSync(path.join(DOCS, JID + '.s0.gz'), zlib.gzipSync(JSON.stringify(slice0)));
fs.writeFileSync(path.join(DOCS, JID + '.s' + IMP_SLICE + '.gz'), zlib.gzipSync(JSON.stringify(slice1)));
// 전체 본문도 함께 있다(서버는 둘 다 만든다) — 기기는 조각 쪽을 써야 한다
fs.writeFileSync(path.join(DOCS, JID + '.json.gz'), zlib.gzipSync(JSON.stringify(allPages)));
for (const n of [A, B, C]) fs.writeFileSync(path.join(IMG, n), Buffer.alloc(400 * 1024, 3));

await store.importsRecord(JID, 'u_scan', { name: '스캔 논문.pdf' });
const usageBefore = await store.importsUsage('u_scan');
const list = await store.importsBundleList(JID);
bundleFor[JID] = bundleBuffer(list);
bundleFor[JID].__jid = JID;
statusFor[JID] = { files: list.files, bytes: list.bytes };

console.log('\n논문 → 기기 옮기기 검사 (앱 코드를 그대로 돌린다)\n' + '─'.repeat(58));
check(list && list.files === 8, `서버가 가진 파일 ${list.files}개 (문서 5 + 배경 3)`, `파일 수 이상: ${list && list.files}`);
check(usageBefore.bytes > 6 * 1024 * 1024, `서버 사용량 ${mb(usageBefore.bytes)} (원본 PDF 5MB 포함)`, `사용량 이상: ${mb(usageBefore.bytes)}`);

// ── ① 기기가 받는다 — 64KB씩 도착 ────────────────────────────────────────
const r1 = await Docs.migrate(JID);
check(r1.ok, `migrate 성공 — ${r1.files}개 · ${mb(r1.bytes)}`, `migrate 실패: ${r1.error}`);
check(r1.bytes === list.bytes, '기기가 받은 용량 = 서버가 가진 용량', `용량 불일치: ${r1.bytes} vs ${list.bytes}`);

const d = await Store.doc(JID);
check(!!d && d.total === PAGES, `문서 기록 생성 · ${PAGES}쪽`, `문서 기록 이상: ${d && d.total}`);
check(d && d.version === 3, 'meta.json 에서 버전(3)을 읽음', `버전 이상: ${d && d.version}`);
const expectPages = Array.from({ length: PAGES }, (_, i) => imgOf(i));
check(d && (d.pages || []).join(',') === expectPages.join(','),
  '쪽별 배경 이름 12개를 순서대로 뽑음(그림 서빙의 근거)', `쪽 배경 이름 이상: ${d && (d.pages || []).join(',')}`);
check(d && d.released === true, '서버가 지웠다는 표시를 남김', 'released 표시가 없음');

const s0 = await Store.slice(JID, 0, 2);
check(s0.length === 2 && s0[0].els[0].t === 'page 0' && s0[1].els[0].t === 'page 1',
  '조각 읽기(0~2쪽) 내용이 맞음', `조각 내용 이상: ${JSON.stringify(s0).slice(0, 60)}`);
const parts = await Store.allParts(JID);
check(parts.map((x) => x.s0).join(',') === '0,' + IMP_SLICE,
  `조각 오프셋이 서버와 같음 (${parts.map((x) => x.s0).join(', ')})`, `조각 오프셋 이상: ${parts.map((x) => x.s0).join(',')}`);
const s2 = await Store.slice(JID, 9, 12);
check(s2.length === 3 && s2[0].els[0].t === 'page 9' && s2[2].els[0].t === 'page 11',
  '두 번째 조각(9~12쪽)도 쪽 번호까지 맞음', `두 번째 조각이 어긋남: ${JSON.stringify(s2.map((x) => x.els[0].t))}`);
const s3 = await Store.slice(JID, 4, 8);
check(s3.length === 4 && s3[0].els[0].t === 'page 4' && s3[3].els[0].t === 'page 7',
  '조각 경계를 넘지 않는 읽기도 맞음(4~8쪽)', '중간 조각 읽기가 어긋남');

const src = await Store.getFile(JID, JID + '.src');
check(!!src && src.size === SRC_BYTES, `원본 PDF(${mb(SRC_BYTES)})도 기기에 그대로 보관`, `원본 PDF 보관 실패: ${src && src.size}`);
const st = await Store.stats();
check(st.count === 1 && st.bytes > 6 * 1024 * 1024, `기기 보관 ${mb(st.bytes)}`, `기기 보관량 이상: ${mb(st.bytes)}`);

// ── ② 서버에서 사라졌는가 ───────────────────────────────────────────────
const left = fs.readdirSync(DOCS).filter((n) => n.startsWith(JID));
check(left.length === 0, '서버에 이 논문의 파일이 하나도 남지 않음', `아직 남음: ${left.join(', ')}`);
check((await store.importsUsage('u_scan')).bytes === 0, '서버 사용량 0 — 디스크가 늘지 않는다', '사용량이 남음');
const local = await store.importsLocalList('u_scan');
check(local.some((x) => x.jid === JID), '옮긴 논문을 서버가 기록해 둠(다른 기기 안내용)', '기록이 없음');

// ── ③ 서버가 지운 뒤에도 그림이 나오는가 ────────────────────────────────
const imgR = await Store.imageResponse('img', [A]);
check(imgR && imgR.status === 200 && /image/.test(imgR.headers.get('Content-Type')),
  '배경 그림(img)을 기기에서 그대로 내보냄', 'img 응답이 없음');
const pageR = await Store.imageResponse('page', [JID, '11']);
check(pageR && pageR.status === 200 && (await pageR.arrayBuffer()).byteLength === 400 * 1024,
  '쪽 미리보기(page)를 기기 그림으로 답함 — 읽기 화면이 뜬다', `page 응답 이상: ${pageR && pageR.status}`);
const bgR = await Store.imageResponse('bg', [JID, '1']);
const bgJson = bgR ? await bgR.json() : null;
check(bgJson && bgJson.ok === true && bgJson.url === '/api/import/img/' + A,
  '고화질 배경(bg)은 원본이 기대하는 {ok,url} JSON 으로 답함', `bg 응답 모양이 틀림: ${JSON.stringify(bgJson)}`);
check((await Store.imageResponse('page', [JID, '99'])) === null,
  '없는 쪽은 null (서버로 넘겨 판단)', '없는 쪽에 엉뚱한 응답');

// ── ④ 앱이 부르는 주소로도 답하는가 (fetch 가로채기) ─────────────────────
const fDoc = await sandbox.fetch('/api/import/docfile/' + JID + '?from=10&to=12');
const jDoc = await fDoc.json();
check(jDoc && jDoc.ok && jDoc.local === true && jDoc.pages.length === 2 && jDoc.pages[1].els[0].t === 'page 11',
  '기기에 있으면 서버를 거치지 않고 본문을 답함', `docfile 응답 이상: ${JSON.stringify(jDoc).slice(0, 70)}`);
const fMeta = await sandbox.fetch('/api/import/docfile/' + JID + '?meta=1');
const jMeta = await fMeta.json();
check(jMeta && jMeta.total === PAGES, '메타 조회(?meta=1)도 기기가 답함', `메타 응답 이상: ${JSON.stringify(jMeta)}`);
check(!requests.some((r) => r.includes('/api/import/docfile/')),
  '위 두 요청은 서버로 나가지 않았다(기기에서 끝남)', `서버로 나간 요청: ${requests.join(' · ')}`);

// ── ⑤ 다시 옮기려 해도 안전한가 ─────────────────────────────────────────
const again = await Docs.migrate(JID);
check(again.ok && again.already === true, '이미 옮긴 논문은 다시 받지 않음', '중복으로 다시 받음');

// ── ⑥ 덜 받았을 때는 서버가 지우지 않는가 (가장 중요한 안전판) ──────────
const JID2 = 'half888';
const D = 'dd44dd44dd44dd44.png';
fs.writeFileSync(path.join(DOCS, JID2 + '.json.gz'), zlib.gzipSync(JSON.stringify([pageEl(0, D), pageEl(1, D)])));
fs.writeFileSync(path.join(IMG, D), Buffer.alloc(100 * 1024, 4));
await store.importsRecord(JID2, 'u_half', { name: '반쪽.pdf' });
const list2 = await store.importsBundleList(JID2);
bundleFor[JID2] = bundleBuffer(list2);
bundleFor[JID2].__jid = JID2;
statusFor[JID2] = { files: list2.files, bytes: list2.bytes };

brokenAt = Math.floor(bundleFor[JID2].length * 0.6);       // 60%에서 끊긴 응답
const r2 = await Docs.migrate(JID2);
check(!r2.ok, `덜 받으면 실패로 판정 (${r2.error})`, '덜 받았는데 성공이라고 함 — 논문이 사라질 수 있다');
check(fs.existsSync(path.join(DOCS, JID2 + '.json.gz')), '서버 사본이 그대로 남아 다시 받을 수 있음', '실패했는데 서버 파일이 사라짐 — 큰 사고');
check(!(await Store.has(JID2)), '반쯤 받은 것은 기기에도 남기지 않음(있다고 잘못 알면 빈 화면이 된다)', '반쯤 받은 문서가 남음');

// 다시 시도 — 이번엔 온전히 온다
brokenAt = 0;
const r3 = await Docs.migrate(JID2);
check(r3.ok && (await Store.has(JID2)), '다시 받으면 성공 (재시도가 실제로 고쳐 준다)', `재시도 실패: ${r3.error}`);
check(!fs.existsSync(path.join(DOCS, JID2 + '.json.gz')), '이번엔 서버에서 지워짐', '두 번째 삭제 실패');

// ── ⑦ 아주 작은 조각으로 와도 경계를 맞추는가 ───────────────────────────
const JID3 = 'tiny999';
const E = 'ee55ee55ee55ee55.png';
fs.writeFileSync(path.join(DOCS, JID3 + '.json.gz'), zlib.gzipSync(JSON.stringify([pageEl(0, E)])));
fs.writeFileSync(path.join(IMG, E), Buffer.alloc(2048, 5));
await store.importsRecord(JID3, 'u_tiny', { name: '조그만.pdf' });
const list3 = await store.importsBundleList(JID3);
bundleFor[JID3] = bundleBuffer(list3);
bundleFor[JID3].__jid = JID3;
statusFor[JID3] = { files: list3.files, bytes: list3.bytes };

chunkSize = 7;                                    // 7바이트씩 — 항목 경계가 매번 걸린다
const r4 = await Docs.migrate(JID3);
chunkSize = 65536;
check(r4.ok, `7바이트씩 도착해도 정확히 받음 (${r4.files}개 · ${r4.bytes}B)`, `작은 조각 처리 실패: ${r4.error}`);
check((await Store.slice(JID3, 0, 1)).length === 1, '그 문서도 읽힘', '작은 조각 문서를 못 읽음');

// ── ⑧ 프리미엄(클라우드)은 서버 사본을 지우지 않는다 ────────────────────
//  여기서 틀리면 **결제한 회원의 원본이 사라진다**(컴퓨터에서 못 연다).
const JID4 = 'cloud444';
const F = 'ff66ff66ff66ff66.png';
fs.writeFileSync(path.join(DOCS, JID4 + '.json.gz'), zlib.gzipSync(JSON.stringify([pageEl(0, F), pageEl(1, F)])));
fs.writeFileSync(path.join(IMG, F), Buffer.alloc(4096, 6));
await store.importsRecord(JID4, 'u_cloud', { name: '클라우드 논문.pdf' });
const list4 = await store.importsBundleList(JID4);
bundleFor[JID4] = bundleBuffer(list4);
bundleFor[JID4].__jid = JID4;
statusFor[JID4] = { files: list4.files, bytes: list4.bytes };
ownerOf[JID4] = 'u_cloud';

sandbox.__premium = true;                       // 요금제를 프리미엄으로
await Docs.refreshPlan();
const rc = await Docs.migrate(JID4);
check(rc.ok && rc.cloud === true, `프리미엄: 기기에도 저장하되 클라우드가 원본 (${rc.files}개)`, `클라우드 이관 실패: ${rc.error}`);
check(fs.existsSync(path.join(DOCS, JID4 + '.json.gz')),
  '프리미엄은 서버 사본을 지우지 않음 — 컴퓨터에서도 열려야 한다', '결제 회원의 원본을 지움 — 큰 사고');
const d4 = await Store.doc(JID4);
check(d4 && d4.cloud === true, '그 문서를 클라우드 문서로 표시', 'cloud 표시가 없음');

// 클라우드 문서는 **서버가 우선** (다른 기기에서 고친 것이 보여야 한다)
const beforeReq = requests.length;
const fCloud = await sandbox.fetch('/api/import/docfile/' + JID4 + '?from=0&to=2');
check(requests.slice(beforeReq).some((r) => r.includes('/api/import/docfile/')),
  '클라우드 문서를 읽으면 서버에 물어봄(최신본)', '기기 사본만 읽음 — 컴퓨터 편집이 안 보인다');

sandbox.__premium = false;
await Docs.refreshPlan();

// ── ⑨ 임자가 아니면 못 지운다 (남의 논문 보호) ──────────────────────────
const bad = await store.importsRelease(JID3, 'u_other', { bytes: 1 });
check(!bad.ok && bad.code === 'not_owner', '임자가 아니면 삭제 거절', '남의 논문을 지울 수 있음');

// ── 정리 ────────────────────────────────────────────────────────────────
fs.rmSync(ROOT, { recursive: true, force: true });

console.log('\n' + '─'.repeat(58));
if (fails.length) {
  console.log(`❌ ${fails.length}개 실패 · ${pass}개 통과\n`);
  process.exit(1);
}
console.log(`✅ 전부 통과 — ${pass}개\n`);
