// 14.13.1 · zoom 환경의 집게 기하와 실시간 포인터 반응성 계약
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const apply = fs.readFileSync(new URL('../apply.sh', import.meta.url), 'utf8');

// 집게와 줄은 같은 회전 변수를 쓰고 같은 윗점(origin)을 축으로 돌아야 한다.
assert.match(css, /\.claw-wire[\s\S]*?transform-origin:50% 0;[\s\S]*?rotate\(var\(--claw-angle,0deg\)\)/,
  '줄은 윗점을 축으로 --claw-angle만큼 회전');
assert.match(css, /\.claw-head[\s\S]*?transform-origin:50% 0;[\s\S]*?rotate\(var\(--claw-angle,0deg\)\)/,
  '집게도 같은 축과 --claw-angle을 사용');
assert.match(js, /function _clawCss\([\s\S]*?window\.sdyUiCss/,
  '카드 화면 좌표를 zoom 된 fixed UI 좌표로 변환');
assert.match(js, /function _clawRect\([\s\S]*?_clawCss\(r\.left\)/,
  '집게 대상 사각형의 left/top/width를 모두 UI 좌표로 측정');
assert.match(js, /_clawPlaceParts\(u\.head,u\.wire,u\.note/,
  '다중 집게도 단일 집게와 같은 정렬 함수 사용');

// 순수 기하 함수를 꺼내 실제 줄 끝이 집게 윗중심에 닿는지 좌우에서 확인한다.
const rigMatch = js.match(/function _clawRig\(headX,headY\)\{[\s\S]*?\n    \}/);
assert.ok(rigMatch, '_clawRig 함수가 있어야 한다');
const ctx = { window: { innerWidth: 1200 }, document: { documentElement: { clientWidth: 1200 } }, Math };
vm.runInNewContext(`${rigMatch[0]}; result=[_clawRig(100,600),_clawRig(600,600),_clawRig(1100,600)]`, ctx);
for (const [i, rig] of ctx.result.entries()) {
  const targetX = [100, 600, 1100][i];
  const rad = rig.angle * Math.PI / 180;
  // CSS rotate(a)에서 아래 방향 벡터의 x는 -sin(a), y는 cos(a).
  const endX = rig.anchorX - Math.sin(rad) * rig.length;
  const endY = Math.cos(rad) * rig.length;
  assert.ok(Math.abs(endX - targetX) < 0.02, `줄 끝 x가 집게 중심과 일치 (${i})`);
  assert.ok(Math.abs(endY - 600) < 0.02, `줄 끝 y가 집게 중심과 일치 (${i})`);
  assert.ok(Math.abs(rig.angle) <= 3.201, '기울기는 과하지 않게 최대 3.2도');
}
assert.ok(ctx.result[0].angle > 0 && ctx.result[2].angle < 0,
  '화면 가운데를 기준으로 좌우 방향이 자연스럽게 반대');
assert.ok(Math.abs(ctx.result[1].angle) < 1e-9, '화면 가운데에서는 수직');

// 상대 커서는 내가 멈춰도 계속 받아야 하며 left/top 대신 합성 transform으로 이동한다.
assert.match(js, /const LIVE_RATE_MS=40, LIVE_DISCOVER_MS=600/,
  '상대가 있을 때 25fps, 혼자일 때 저빈도 탐색');
assert.match(js, /const hasPeer=.*livePeerCount[\s\S]*?!liveMoved && !hasPeer/,
  '내 마우스가 멈춰도 상대가 있으면 polling 유지');
assert.match(js, /getCoalescedEvents/, '고주사율 포인터의 최신 합쳐진 이벤트 사용');
assert.match(css, /\.live-cur[\s\S]*?translate3d\(var\(--live-x,0\),var\(--live-y,0\),0\)/,
  '상대 커서는 GPU transform으로 이동');
assert.match(css, /\.tool-cursor[\s\S]*?translate3d\(var\(--cursor-x,0\),var\(--cursor-y,0\),0\)/,
  '펜 커서도 GPU transform으로 이동');
assert.match(js, /pr\.width\/Math\.max\(1,ps\.w\)/,
  '상대 커서는 pageScale 상수가 아니라 실제 종이 화면 크기로 환산');

// 배포 중 반쪽 파일/구 캐시가 섞이지 않도록 에셋을 버전 고정하고 원자 교체한다.
assert.match(html, /sdynotes\.css\?v=14\.13\.1/);
assert.match(html, /sdynotes\.js\?v=14\.13\.1/);
assert.match(apply, /deploy_atomic/);
assert.match(apply, /node --check "\$SRC\/sdynotes\.js"/);

console.log('집게/포인터 계약: PASS (일자 기하 · zoom 좌표 · 25fps 커서 · 원자 배포)');
