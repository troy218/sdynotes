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

console.log('Call relay contract: refreshed TURN is awaited before relay-only offer.');
