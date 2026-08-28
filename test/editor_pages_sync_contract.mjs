import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

// ── 1. 서버 pull 의 pages 필드를 클라이언트가 반영하는지 ──────────────
// 서버 /api/sync/pull 은 페이지 목록을 별도 필드(pages)로 주고 ops 에는 넣지
// 않는다. 클라이언트가 이 필드를 __pages__ op으로 합성하지 않으면, 처음 열거나
// 늦게 pull 한 기기는 다른 기기가 추가/삭제한 페이지를 전혀 반영하지 못한다.
const pull = js.match(/async function pullSync\(init\)\{([\s\S]*?)\n        }\n    }/);
assert.ok(pull, 'pullSync should exist');
const pullBody = pull[1];
assert.match(pullBody, /const rp=\(d&&d\.pages\)/, 'pullSync must read server pages field');
assert.match(pullBody, /__pages__'.*kind:'pages'|kind:'pages','rev:parseFloat/,
  'pullSync must synthesize a __pages__ op from server pages field');
assert.match(pullBody, /ops=\[\{id:'__pages__'/, 'the synthesized pages op must be prepended to ops');

// ── 2. pages op 적용 후 재푸시 방지 ────────────────────────────────
assert.match(pullBody, /doc\.__lastPages=\(doc\.pages\|\|\[\]\)\.map\(p=>p\.id\)\.join\(','\)/,
  'applyPagesOp must refresh __lastPages so the same list is not re-pushed');

// ── 3. 라이브 커서를 자주, 부드럽게 ────────────────────────────────
assert.match(js, /const LIVE_RATE_MS=80, LIVE_HEARTBEAT_MS=4000;/,
  'live cursor needs a fast moving rate (80ms) plus a slow heartbeat (4s)');
assert.match(js, /liveRateTimer=setInterval\(liveFastTick,LIVE_RATE_MS\)/,
  'startLive must schedule the fast live cursor tick');
assert.match(js, /function liveFastTick\(\)\{/, 'liveFastTick must exist');
assert.match(js, /if\(!liveMoved && !liveAct\(\)\) return;/,
  'liveFastTick should only send while the pointer is moving or an action is shown');
assert.match(js, /if\(_liveBusy\)\{ _liveQueued=true; return; \}/,
  'livePing must serialize overlapping requests so cursors do not jump backwards');

console.log('Editor page-sync + live-cursor contract: server pages field applied and cursor rate raised.');
