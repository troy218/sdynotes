import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');

// A relay-only peer must be created only after the refreshed ICE response has
// restored TURN. Creating it immediately after ypRefreshIce() uses the STUN
// fallback (YP.ice is deliberately cleared first), leaving it with zero relay
// candidates on different networks.
const retryBlocks = [
  "ypRefreshIce().then(function(){ ypOffer(uid,{fresh:true,relay:true}); });",
];
for (const block of retryBlocks) assert.ok(html.includes(block), `missing awaited TURN relay retry: ${block}`);
assert.equal(html.includes('ypRefreshIce(); ypOffer(uid,{fresh:true,relay:true});'), false,
  'relay offer must not race the ICE/TURN refresh');

const makePc = html.match(/function ypMakePc\(uid, opts\)\{([\s\S]*?)\n  \}\n  function ypAttachRemote/);
assert.ok(makePc, 'WebRTC peer factory should exist');
assert.match(makePc[1], /iceTransportPolicy: relay\?'relay':'all'/,
  'retry peer must use relay-only policy');
assert.match(makePc[1], /iceServers:ypIceServers\(\)/,
  'retry peer must receive current ICE/TURN servers');

// ── 14.13 · 죽은 자체 TURN 은 내려주지 않는다 ──
// 실제 사고: .env 의 turns:…:5349 (coturn 이 TLS 를 안 켬) 이 그대로 브라우저로
// 나가 candidate error 를 내면, 되는 turn:3478 과 섞여 'TURN 불통'으로 통화가
// 굳어 보였다. 서버가 로컬 TCP 확인으로 걸러내고, 프런트는 안내를 나눈다.
const chat = fs.readFileSync(new URL('../server/src/routes/chat.js', import.meta.url), 'utf8');
assert.match(chat, /async function localTurnAlive\(urlText\)/, '자체 TURN 생존 확인 헬퍼');
assert.match(chat, /localTurnAddresses\(process\.env\.SDY_TURN_PRIVATE_IP\)/,
  '생존 확인은 사설 NIC/localhost 기준(hairpin 아님)');
assert.match(chat, /if \(await localTurnAlive\(localTlsTurn\)\) addTurn\(rewriteLocalHost\(localTlsTurn\), false\);\s*\n\s*else droppedTurn\.push\(localTlsTurn\);/,
  '죽은 turns: 는 iceServers 에 넣지 않고 droppedTurn 으로 알린다');
assert.match(chat, /droppedTurn, ice: \{ iceServers \}/, '응답에 droppedTurn 포함');
assert.match(chat, /turnAliveCache = \{ at: 0, ok: new Map\(\) \}/, '생존 확인 결과 캐시(30초)');
assert.match(makePc[1], /릴레이 연결이 막혔어요 — VCN 의 TURN 릴레이 포트 49160-49200\(UDP\)/,
  '후보는 있는데 연결 안 될 때는 릴레이 포트 안내로 구분');
assert.doesNotMatch(makePc[1], /if\(!pc\.__candidateOk \|\| pc\.__turnErr\)\{/,
  'turnErr 하나만으로 ' + "'TURN 서버에 닿지 못했어요'" + ' 오해 메시지를 띄우면 안 된다');

console.log('Call relay contract: refreshed TURN awaited; dead local TURN filtered server-side.');
