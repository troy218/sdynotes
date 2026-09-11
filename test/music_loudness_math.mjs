// 14.65 · 음량 보정값 계산 계약 (서버가 정하는 값).
//  측정값이 이상하거나 목표에서 너무 멀면 서버가 스스로 자른다 —
//  사용자가 고를 수 있는 여지를 남기지 않는다.
import assert from 'node:assert/strict';
import {
  NORM_TARGET_DB, NORM_MIN_DB, NORM_MAX_DB,
  normGainDb, normRecord, normDbOf, validMeasure,
} from '../server/src/lib/loudness.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const eq = (a, b, msg) => assert.equal(a, b, msg || `${a} !== ${b}`);

console.log('음량 보정값 계산\n');

ok('목표는 -14 dBFS', () => eq(NORM_TARGET_DB, -14));
ok('정확히 목표면 손대지 않는다', () => { eq(normGainDb(-14), 0); eq(normGainDb(-13.95), 0); });
ok('조용한 곡은 올리고 큰 곡은 내린다', () => { eq(normGainDb(-20), 6); eq(normGainDb(-8), -6); });
ok('올리기는 +6dB 까지만', () => eq(normGainDb(-40), NORM_MAX_DB));
ok('내리기는 -12dB 까지만', () => eq(normGainDb(0), NORM_MIN_DB));
ok('트루피크가 상한을 넘으면 그만큼만 올린다', () => {
  eq(normGainDb(-40, -3), 2);            // -1dBFS 상한 − (-3dBFS) = +2dB
  eq(normGainDb(-40, 0.5), -1.5);        // 이미 상한을 넘은 곡은 상한까지 내린다
});
ok('내릴 때는 피크를 이유로 더 깎지 않는다 (원래 큰 곡은 그대로 내림)', () => eq(normGainDb(-2, 0.4), -12));

ok('이상한 측정값은 거절한다', () => {
  eq(validMeasure(1, null, 10), null);          // 0dBFS 초과
  eq(validMeasure(-100, null, 10), null);       // 너무 조용
  eq(validMeasure(-14, null, 1), null);         // 3초 미만
  eq(validMeasure('abc', null, 10), null);      // 숫자 아님
  eq(validMeasure(-16, 3, 10), null);           // 피크가 범위 밖
  assert.ok(validMeasure(-16, -1.5, 12.4));
});

ok('기록에는 측정 근거와 보정값이 함께 남는다', () => {
  const r = normRecord(-18.2, -2.4, 12.6);
  eq(r.lufs, -18.2);
  eq(r.peak_db, -2.4);
  eq(r.sec, 13);
  eq(r.gain_db, 1.4);          // 피크(-2.4) 때문에 +4.2 가 아니라 +1.4 까지만
  assert.match(r.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  eq(r.by, 'client-rms');
});

ok('곡 기록에서 꺼낼 때도 범위를 다시 지킨다', () => {
  eq(normDbOf({ norm: { gain_db: -3.4 } }), -3.4);
  eq(normDbOf({ norm: { gain_db: 0.05 } }), 0);      // 의미 없는 차이는 0
  eq(normDbOf({ norm: { gain_db: 99 } }), NORM_MAX_DB);
  eq(normDbOf({ norm: { gain_db: -99 } }), NORM_MIN_DB);
  eq(normDbOf({}), 0);
  eq(normDbOf(null), 0);
});

console.log(`\n음량 보정값 계산 — ${pass}개 항목 통과`);
