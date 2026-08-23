import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../server/src/routes/chat.js', import.meta.url), 'utf8');

const makePc = html.match(/function ypMakePc\(uid, opts\)\{([\s\S]*?)\n  \}\n  function ypAttachRemote/);
assert.ok(makePc, 'WebRTC peer factory should exist');
const body = makePc[1];

// ══════════════════════════════════════════════════════════════
// 14.14 · 같은 와이파이끼리도 통화가 안 되던 사고의 재발 방지
//
// 예전 로직: 통화 시작 2.5초 뒤에도 connected 가 아니면 연결을 통째로 부수고
//   iceTransportPolicy:'relay' (릴레이 전용) 로 다시 만들었다.
//   그런데 ICE 는 원래 수 초가 걸리고, 'all' 이면 브라우저가 host·srflx·relay 를
//   이미 동시에 시도한다. 결과적으로
//     · 잘 붙고 있던 같은 와이파이 직접 연결까지 2.5초에 끊어 버리고
//     · TURN 이 죽어 있으면 릴레이 전용이라 100% 실패 → 통화 자체가 불가능
//   이 됐다. 그래서 '포트를 다 열었는데 와이파이끼리도 안 되는' 증상이 났다.
// ══════════════════════════════════════════════════════════════

// ① 2.5초 강제 릴레이 전환이 없어야 한다
assert.equal(html.includes('ypRefreshIce().then(function(){ ypOffer(uid,{fresh:true,relay:true}); });'), false,
  '실패하지도 않은 연결을 릴레이 전용으로 강제 전환하면 안 된다 (같은 망 통화까지 끊긴다)');
assert.doesNotMatch(body, /},2500\);/,
  'ICE 가 끝나기도 전인 2.5초에 연결을 부수면 안 된다');

// ② 첫 감시 타이머는 넉넉해야 하고, 연결을 부수는 대신 ICE 재시작만 건다
const watch = body.match(/if\(!relay\)\{\s*pc\.__watch=setTimeout\(function\(\)\{([\s\S]*?)\},(\d+)\);/);
assert.ok(watch, '비릴레이 연결 감시 타이머가 있어야 한다');
assert.ok(Number(watch[2]) >= 8000,
  `첫 감시는 ICE 가 끝날 시간을 줘야 한다 (현재 ${watch[2]}ms)`);
assert.match(watch[1], /iceConnectionState==='connected'\s*\|\|\s*pc\.iceConnectionState==='completed'/,
  'ICE 가 이미 붙었으면 건드리지 않는다');
assert.match(watch[1], /ypOffer\(uid\)/, '연결을 부수지 않고 ICE 재시작만 한다');
assert.doesNotMatch(watch[1], /relay:true/, '감시 타이머가 릴레이 전용으로 갈아타면 안 된다');

// ③ 실제 failed 일 때의 복구도 릴레이 전용이 아니라 전체 후보 재수집이어야 한다
//    (relay 전용은 TURN 이 죽어 있을 때 남은 길까지 스스로 막는다)
assert.match(body, /ypRefreshIce\(\)\.then\(function\(\)\{ ypOffer\(uid,\{fresh:true\}\); \}\);/,
  'failed 복구는 host+srflx+relay 를 모두 다시 모으는 ICE 재시작이어야 한다');

// ④ 기본 연결은 항상 'all' (직접 연결 가능하면 TURN 없이도 통화된다)
assert.match(body, /iceTransportPolicy: relay\?'relay':'all'/,
  '기본은 all — TURN 이 없어도 같은 망 통화는 되어야 한다');
assert.match(body, /iceServers:ypIceServers\(\)/, '현재 ICE/TURN 서버를 그대로 사용');

// ── 14.13 · 죽은 자체 TURN 은 내려주지 않는다 (기존 계약 유지) ──
assert.match(chat, /async function localTurnAlive\(urlText\)/, '자체 TURN 생존 확인 헬퍼');
assert.match(chat, /localTurnAddresses\(process\.env\.SDY_TURN_PRIVATE_IP\)/,
  '생존 확인은 사설 NIC/localhost 기준(hairpin 아님)');
assert.match(chat, /if \(await localTurnAlive\(localTlsTurn\)\) addTurn\(rewriteLocalHost\(localTlsTurn\), false\);\s*\n\s*else droppedTurn\.push\(localTlsTurn\);/,
  '죽은 turns: 는 iceServers 에 넣지 않고 droppedTurn 으로 알린다');
assert.match(chat, /droppedTurn, publicTurn: publicTurnUsed, ice: \{ iceServers \}/, '응답에 droppedTurn 포함');
assert.match(chat, /turnAliveCache = \{ at: 0, ok: new Map\(\) \}/, '생존 확인 결과 캐시(30초)');
assert.match(body, /릴레이 연결이 막혔어요 — VCN 의 TURN 릴레이 포트 49160-49200\(UDP\)/,
  '후보는 있는데 연결 안 될 때는 릴레이 포트 안내로 구분');
assert.doesNotMatch(body, /if\(!pc\.__candidateOk \|\| pc\.__turnErr\)\{/,
  'turnErr 하나만으로 ' + "'TURN 서버에 닿지 못했어요'" + ' 오해 메시지를 띄우면 안 된다');

// ── 14.14 · 자체 TURN 이 죽었을 때의 공개 TURN 예비 ──
// 자체 coturn 이 하나도 안 붙으면 통화가 통째로 불가능해지던 것을 막는다.
assert.match(chat, /SDY_PUBLIC_TURN \|\| 'auto'/, '공개 TURN 예비 스위치(.env SDY_PUBLIC_TURN)');
assert.match(chat, /publicTurnMode !== 'off' && \(!turnReady \|\| publicTurnMode === 'always'\)/,
  '자체 TURN 이 준비된 경우엔 공개 TURN 을 쓰지 않는다 (auto)');
assert.match(chat, /turn:openrelay\.metered\.ca:443\?transport=tcp/,
  '방화벽을 넘기 쉬운 443/TCP 예비 경로 포함');
assert.match(chat, /publicTurn: publicTurnUsed/, '공개 TURN 사용 여부를 클라이언트에 알린다');

// ── 14.14 · 기기에서 직접 돌리는 통화 자가 진단 ──
assert.match(html, /function ypRunDiag\(\)/, '통화 자가 진단 함수');
assert.match(html, /id="ypDiagBtn"/, '설정에 진단 버튼');
assert.match(html, /got=\{host:0,srflx:0,relay:0\}/, 'host/srflx/relay 후보를 각각 센다');

console.log('Call relay contract: no forced relay-only downgrade; ICE restart preserves direct path; public TURN fallback + on-device diagnostics.');
