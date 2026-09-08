// 버그 일지 유실 회귀: 빈/구버전 기기 → 암묵적 삭제 → 서버 tombstone.
// 실제 설정/일지 프런트 + Fastify API + 디스크 + 새 Node 프로세스로 검증한다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Fastify from 'fastify';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const cache = path.join(ROOT, '.cache');
await fs.mkdir(cache, { recursive: true });
const base = await fs.mkdtemp(path.join(cache, 'buglog-test-'));
process.env.SDY_BASE_DIR = base;
process.env.SDY_STORAGE = 'oracle';
const password = 'buglog-test-only';
process.env.ADMIN_PW_HASH = crypto.createHash('sha256').update(password).digest('hex');
const { registerSync } = await import('../server/src/routes/sync.js');
const { adminLogin, adminLogout } = await import('../server/src/lib/admin.js');
const { SETTINGS_SCHEMA, APP_VERSION } = await import('../server/src/lib/config.js');
const { syncCacheInvalidate } = await import('../server/src/lib/syncEngine.js');
const sync = await fs.readFile(path.join(ROOT, 'src/app/02d-settings-sync.js'), 'utf8');
const buglog = await fs.readFile(path.join(ROOT, 'src/app/02f-buglog.js'), 'utf8');
const ai = await fs.readFile(path.join(ROOT, 'src/ai-assistant.js'), 'utf8');
const app = Fastify();
registerSync(app);
const nb = '__settings__';
const clients = [];
let pass = 0;
const ok = (name) => { pass++; console.log('  ✓ ' + name); };
const push = async (ops, token, extra = {}) => (await app.inject({
  method: 'POST', url: '/api/sync/push',
  headers: token ? { 'x-admin-token': token } : {},
  payload: { nb, schema: SETTINGS_SCHEMA, ops, ...extra },
})).json();
const pull = async () => (await app.inject({ url: '/api/sync/pull?nb=' + nb + '&since=0' })).json();
const bug = (id) => ({ id, t: 1234, title: '표 글자 겹침', text: '증상: 표 글자가 겹쳐요', raw: '표가 겹쳐요', who: '테스터', ver: APP_VERSION });

// 타이머는 명시적으로 실행한다. 네트워크만 Fastify inject로 연결하고 동기화
// 알고리즘, localStorage, outbox, 일지 렌더링은 실제 배포 소스를 쓴다.
function client(saved = {}) {
  const dom = new JSDOM(`<!doctype html><meta name="application-version" content="${APP_VERSION}">
    <div id="linkBar"></div><span id="bugCount"></span><div id="buglogModal" style="display:none"><div id="bugList"></div></div>`,
  { url: 'https://notes.test/', runScripts: 'outside-only' });
  clients.push(dom);
  const w = dom.window;
  for (const [k, v] of Object.entries(saved)) w.localStorage.setItem(k, v);
  const net = { offline: false, failPush: false };
  const requests = [];
  const timers = new Map();
  let seq = 0;
  w.setTimeout = (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; };
  w.clearTimeout = (id) => timers.delete(id);
  w.setInterval = () => 0;
  w.fetch = async (url, opts = {}) => {
    requests.push({ url, ...opts });
    if (net.offline || (net.failPush && url === '/api/sync/push')) throw new Error('offline');
    const r = await app.inject({ method: opts.method || 'GET', url, headers: opts.headers,
      ...(opts.body ? { payload: opts.body } : {}) });
    return { ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, json: async () => r.json() };
  };
  w.eval(`
    const SANDBOX=false, notebooks=[]; let curFolder=null, curNB=null, doc=null, _clawBusy=false;
    let adminMode=false, adminToken=null;
    function isAdmin(){ return adminMode; }
    function getFolders(){ return []; } function getCfg(){ return {}; } function setCfg(){}
    function _appSetPayload(){ return {}; } function _appSetApply(){ return false; }
    function getAdminEdits(){ return {}; } function isOnline(){ return true; }
    function toast(){} function openNav(){} function navDrop(){} function outboxCount(){ return 0; }
    function esc(s){ return String(s); }
    function updateTrashCount(){} function renderGrid(){} function rescalePreviews(){}
    ${sync}\n${buglog}
    window.testBuglog={buglogAdd,delBugEntry,getBugEntries,openBuglog,pullSettings,pushSettingsNow,_stDiff,
      outbox:()=>JSON.parse(JSON.stringify(_stOut)),
      admin:(token)=>{ adminToken=token; adminMode=!!token; }};
  `);
  return {
    w, net, requests, F: w.testBuglog,
    snapshot: () => Object.fromEntries(Object.keys(w.localStorage).map(k => [k, w.localStorage.getItem(k)])),
    restoreBlocked: async () => {
      for (const [id, t] of [...timers]) if (t.ms === 80) { timers.delete(id); t.fn(); }
      await w.testBuglog.pullSettings();
    },
  };
}

try {
  // 1) 빈 로컬 배열은 삭제 의도가 아니다. 북마크 등 기존 diff 동작은 유지한다.
  const diffSrc = sync.slice(sync.indexOf('    function _stDiff(){'), sync.indexOf('    const _DEL_LIMIT='));
  const diff = new Function('_stKeys', '_stHash', '_stGuardDeletes', diffSrc + '\nreturn _stDiff();')(
    () => ({}), new Map([['buglog:old', '{}'], ['bookmark:old', '{}']]), ops => ops);
  assert.deepEqual(diff, [{ id: 'bookmark:old', kind: 'del' }]);
  ok('빈 기기/저장 실패에서 버그 일지 삭제를 추론하지 않는다');

  // 2) 서버 파일에 저장한 기록은 메모리 캐시나 브라우저 없이 새 프로세스에서도 읽힌다.
  const entry = bug('bug_durable'), key = 'buglog:' + entry.id;
  assert.equal((await push([{ id: key, kind: 'put', rev: 1, data: entry }])).ok, true);
  const disk = JSON.parse(await fs.readFile(path.join(base, 'sync/settings.json'), 'utf8'));
  assert.deepEqual(disk.els[key].data, entry);
  const source = path.join(base, 'newsite');
  for (const file of ['sdynotes.js', 'sdynotes.css', 'sdynotes.html', 'package.json',
    'server/src/index.js', 'worker/run.py', 'scripts/deploy.mjs', 'src/ai-assistant.js']) {
    for (const [dir, text] of [[base, 'old code'], [source, 'new code']]) {
      const dest = path.join(dir, file);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, text);
    }
  }
  const deploy = await fs.readFile(path.join(ROOT, 'apply.sh'), 'utf8');
  const copyStage = deploy.slice(deploy.indexOf('# ── 2. 파일 복사'), deploy.indexOf('# ── Node 의존성 설치'));
  assert.ok(copyStage.includes('deploy_atomic') && copyStage.includes('cp -r'));
  const deployed = spawnSync('bash', ['-e', '-c', `
    say(){ :; }; ok(){ :; }; sudo(){ :; };
    ${copyStage}
  `], { env: { ...process.env, APP_DIR: base, SRC: source }, encoding: 'utf8', timeout: 10000 });
  assert.equal(deployed.status, 0, deployed.stderr);
  assert.equal(await fs.readFile(path.join(base, 'sdynotes.js'), 'utf8'), 'new code');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base, 'sync/settings.json'), 'utf8')), disk);
  ok('apply.sh의 실제 코드 교체 단계가 기존 버그 일지 파일을 보존');
  const restarted = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { syncPull } = await import('./server/src/lib/syncEngine.js');
    console.log(JSON.stringify((await syncPull('__settings__', 0)).body));
  `], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout).ops.find(o => o.id === key).data, entry);
  ok('sync/settings.json 영구 파일 → 서버 프로세스 재시작 후 같은 기록');

  const login = await adminLogin('test', password), token = login.body.token;
  assert.ok(token);
  const del = { id: key, kind: 'del', rev: 2 };
  for (const [op, auth] of [[del, null], [del, token], [{ ...del, explicit: true }, null], [{ ...del, explicit: true }, 'expired-token']]) {
    const result = await push([op], auth);
    assert.ok(result.blocked.includes(key));
    assert.ok(!result.accepted.includes(key));
    assert.deepEqual((await pull()).ops.find(o => o.id === key).data, entry);
  }
  ok('구버전 자동 삭제/비관리자/만료 토큰은 1건이어도 서버에서 차단');

  // 권한을 body에 써 보내도 신뢰하지 않는다. 같은 배치의 정상 추가는 저장한다.
  const other = bug('bug_other');
  const mixed = await push([{ ...del, explicit: true }, { id: 'buglog:' + other.id, kind: 'put', rev: 3, data: other }], null, { admin: true });
  assert.ok(mixed.blocked.includes(key));
  assert.ok(mixed.accepted.includes('buglog:' + other.id));
  ok('조작된 권한 필드 무시 + 차단된 삭제와 함께 보낸 정상 기록 보존');
  for (const alias of ['settings', 'set_tings', '__settings__!', 'settingssandbox']) {
    const result = await push([{ ...del, rev: 1000, explicit: true }], null, { nb: alias });
    assert.equal(result.ok, false);
  }
  syncCacheInvalidate(nb);
  assert.deepEqual((await pull()).ops.find(o => o.id === key).data, entry);
  ok('동일 설정 파일을 가리키는 nb 별칭으로 삭제 권한을 우회할 수 없다');

  // 3) 구버전 outbox의 삭제가 남아 있어도 업그레이드한 기기는 서버 기록을 복구한다.
  const stale = client({ sdy_buglog: '[]', sdy_settings_outbox_8_17: JSON.stringify({
    [key]: { ...del, rev: Date.now() + 100, dev: 'stale-tab' },
  }) });
  await stale.F.pullSettings();
  await stale.restoreBlocked();
  assert.ok(stale.F.getBugEntries().some(x => x.id === entry.id));
  assert.equal(stale.F.outbox()[key], undefined);
  ok('업데이트 전에 남긴 자동 삭제 outbox를 버리고 서버 일지 복원');

  // 4) 저장 실패/오프라인은 로컬 outbox에 남고, 새 브라우저 인스턴스가 재전송한다.
  const offline = client();
  await offline.F.pullSettings();
  offline.net.failPush = true;
  const pending = await offline.F.buglogAdd({ title: '오프라인 신고', text: '증상: 저장이 늦어요' });
  assert.equal(pending.synced, false);
  assert.equal(offline.F.outbox()['buglog:' + pending.id].kind, 'put');
  const reload = client(offline.snapshot());
  await reload.F.pullSettings();
  assert.equal(reload.F.outbox()['buglog:' + pending.id], undefined);
  assert.ok((await pull()).ops.some(o => o.id === 'buglog:' + pending.id && o.data.title === '오프라인 신고'));
  ok('실패 시 서버 저장 완료로 표시하지 않고, 새로고침 후 outbox 재전송');

  const beforePull = client();
  beforePull.net.offline = true;
  const early = await beforePull.F.buglogAdd({ title: '첫 연결 전 기록' });
  assert.equal(early.synced, false);
  const reconnected = client(beforePull.snapshot());
  await reconnected.F.pullSettings();
  assert.ok((await pull()).ops.some(o => o.id === 'buglog:' + early.id));
  ok('첫 서버 동기화 전에 기록한 일지도 업데이트/새로고침 뒤 보존');

  const online = client();
  await online.F.pullSettings();
  const complete = await online.F.buglogAdd({ title: '서버 확인 완료' });
  assert.equal(complete.synced, true);
  assert.equal(online.F.outbox()['buglog:' + complete.id], undefined);
  ok('서버 ACK를 받은 경우에만 synced=true');

  const full = client();
  await full.F.pullSettings();
  const setItem = full.w.Storage.prototype.setItem;
  full.w.Storage.prototype.setItem = function (k, v) {
    if (k === 'sdy_buglog') throw new full.w.DOMException('full', 'QuotaExceededError');
    return setItem.call(this, k, v);
  };
  await assert.rejects(async () => full.F.buglogAdd({ title: '저장 공간 부족' }), /full/);
  ok('브라우저 저장 실패를 삼키고 기록 완료로 반환하지 않는다');
  const failedPull = client();
  const pullSetItem = failedPull.w.Storage.prototype.setItem;
  failedPull.w.Storage.prototype.setItem = function (k, v) {
    if (k === 'sdy_buglog') throw new failedPull.w.DOMException('full', 'QuotaExceededError');
    return pullSetItem.call(this, k, v);
  };
  await failedPull.F.pullSettings();
  assert.equal(failedPull.F.getBugEntries().length, 0);
  assert.equal(failedPull.requests.filter(r => r.url === '/api/sync/push').length, 0);
  failedPull.w.Storage.prototype.setItem = pullSetItem;
  await failedPull.F.pullSettings();
  assert.ok(failedPull.F.getBugEntries().some(x => x.id === entry.id));
  ok('서버 기록의 기기 저장 실패 뒤에도 다음 pull에서 다시 복원');

  // 5) 실제 X 버튼 경로만 삭제 의도 + 현재 관리자 토큰을 보낸다.
  online.F.admin(token);
  await online.F.delBugEntry(complete.id);
  const request = online.requests.filter(r => r.url === '/api/sync/push').at(-1);
  const sent = JSON.parse(request.body).ops.find(o => o.id === 'buglog:' + complete.id);
  assert.equal(sent.explicit, true);
  assert.equal(request.headers['X-Admin-Token'], token);
  assert.equal((await pull()).ops.find(o => o.id === 'buglog:' + complete.id).del, 1);
  assert.ok((await pull()).ops.find(o => o.id === key).data);
  const newDevice = client();
  await newDevice.F.pullSettings();
  assert.ok(!newDevice.F.getBugEntries().some(x => x.id === complete.id));
  assert.ok(newDevice.F.getBugEntries().some(x => x.id === entry.id));
  ok('관리자의 명시적 X 삭제는 해당 기록만 지우고 새 기기에도 반영');

  const many = Array.from({ length: 11 }, (_, i) => bug('bug_bulk_' + i));
  await push(many.map(data => ({ id: 'buglog:' + data.id, kind: 'put', rev: 1, data })));
  const bulk = await push(many.map(data => ({ id: 'buglog:' + data.id, kind: 'del', rev: 2, explicit: true })), token);
  assert.equal(bulk.blocked.length, 11);
  assert.ok(many.every(e => bulk.blocked.includes('buglog:' + e.id)));
  syncCacheInvalidate(nb);
  const afterBulk = await pull();
  assert.ok(many.every(e => afterBulk.ops.find(o => o.id === 'buglog:' + e.id).data));
  ok('서버도 한 번에 10건을 넘는 일지 삭제를 차단');

  await adminLogout(token);
  assert.ok((await push([{ ...del, rev: Date.now() + 1000, explicit: true }], token)).blocked.includes(key));
  ok('로그아웃한 관리자 토큰으로는 삭제 불가');

  // 6) runBug 실제 실행: Promise(저장 결과)를 기다리고 완료/대기/실패를 구분한다.
  const runBugSrc = ai.slice(ai.indexOf('  function runBug(q){'), ai.indexOf('  window.sdyAiRunBug='));
  async function feedback(save) {
    const messages = [];
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const deps = {
      window: { sdyBuglogAdd: save }, document: { querySelector: () => ({ content: APP_VERSION }) },
      AbortController, fetch: async () => ({}), token: () => '',
      readSSE: async () => ({ d: { ok: true, text: '제목: 일지 저장\n증상: 목록이 사라져요' } }),
      meta: () => {}, kindChip: () => {}, otterHide: () => {}, histPush: () => {},
      busy: v => { if (!v) finish(); }, out: text => messages.push(text),
    };
    new Function(...Object.keys(deps), `let ctl=null, closedByUser=false, lastText='', lastKind='', lastQ='';
      ${runBugSrc}\nrunBug('버그 신고: 일지가 사라져요');`)(...Object.values(deps));
    await done;
    return messages.at(-1);
  }
  assert.match(await feedback(async () => ({ synced: true })), /서버에 저장했어요/);
  const waiting = await feedback(async () => ({ synced: false }));
  assert.match(waiting, /서버 저장 대기/);
  assert.doesNotMatch(waiting, /서버에 저장했어요/);
  const failed = await feedback(async () => { throw new Error('storage full'); });
  assert.match(failed, /저장하지 못했어요/);
  assert.match(failed, /증상: 목록이 사라져요/);
  ok('해돌이 안내가 서버 저장/로컬 대기/저장 실패를 실제 결과로 구분');

  console.log(`\n✅ buglog_persistence_runtime — ${pass}개 항목 통과`);
} finally {
  for (const dom of clients) dom.window.close();
  await app.close();
  await fs.rm(base, { recursive: true, force: true });
}
