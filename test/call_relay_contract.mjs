import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../server/src/routes/chat.js', import.meta.url), 'utf8');
const apply = fs.readFileSync(new URL('../apply.sh', import.meta.url), 'utf8');

// ══════════════════════════════════════════════════════════════
// 음성은 서버 릴레이만. WebRTC mesh + TURN/STUN + P2P 폴백은 없다.
// ══════════════════════════════════════════════════════════════

assert.doesNotMatch(html, /RTCPeerConnection/, '프론트에 WebRTC peer 가 없어야 한다');
assert.doesNotMatch(html, /function ypMakePc/, 'P2P 팩토리가 없어야 한다');
assert.doesNotMatch(html, /function ypHandleSignal/, 'offer/answer/ICE 시그널 핸들러가 없어야 한다');
assert.doesNotMatch(html, /function ypGetIce/, 'ICE/TURN 설정 수신이 없어야 한다');
assert.doesNotMatch(html, /function ypRunDiag/, 'P2P 자가 진단이 없어야 한다');
assert.doesNotMatch(html, /iceTransportPolicy/, 'ICE 정책 토글이 없어야 한다');
assert.doesNotMatch(html, /YPS\.relay/, '설정에 P2P/릴레이 토글이 없어야 한다');
assert.doesNotMatch(html, /\/api\/chat\/signal/, '프론트가 시그널 엔드포인트를 부르면 안 된다');

assert.match(html, /function ypRelayStart/, '릴레이 음성 엔진이 있어야 한다');
assert.match(html, /\/api\/chat\/voice-ws\?uid=/, '음성은 /api/chat/voice-ws 로 붙는다');
assert.match(html, /YP\._relayHb/, '프록시가 유휴 WS 를 끊지 않게 핑이 있어야 한다');
assert.match(html, /URL\.revokeObjectURL/, 'AudioWorklet blob URL 을 회수해야 한다');

assert.doesNotMatch(chat, /\/api\/chat\/signal/, '서버에 시그널 라우트가 없어야 한다');
assert.doesNotMatch(chat, /\/api\/chat\/diag/, '서버에 TURN 진단 라우트가 없어야 한다');
assert.doesNotMatch(chat, /localTurnAlive/, '자체 TURN 생존 확인이 없어야 한다');
assert.doesNotMatch(chat, /SDY_TURN_SECRET|SDY_LOCAL_TURN_URL|SDY_TURN_HOST/, 'TURN env 를 읽으면 안 된다');
assert.match(chat, /voice: 'relay'/, 'join/config 가 릴레이 전용임을 알려야 한다');
assert.match(chat, /path !== '\/api\/chat\/voice-ws'/, 'upgrade 는 음성 WS 만 처리한다');
assert.match(chat, /voiceClose\(uid, 4004, '퇴장'\)/, 'leave 가 음성 소켓을 닫아야 한다');
assert.match(chat, /d\.t === 'ping'/, '클라 ping 에 pong 해야 한다');

assert.match(apply, /location \/api\/chat\/voice-ws/, 'nginx 가 음성 WS Upgrade 경로를 연다');
assert.match(apply, /proxy_set_header Connection "upgrade"/, 'nginx 가 WebSocket Upgrade 를 통과시킨다');
assert.doesNotMatch(apply, /apt-get install -y -qq coturn/, 'coturn 을 새로 깔면 안 된다');
assert.doesNotMatch(apply, /tls-listening-port=5349/, 'TURN TLS 설정을 쓰면 안 된다');
assert.match(apply, /음성은 서버 릴레이/, 'apply.sh 가 TURN 대신 릴레이를 안내한다');

console.log('Call relay contract: WebRTC/TURN/P2P gone; voice is /api/chat/voice-ws only; nginx Upgrade path present.');
