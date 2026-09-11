// 14.65 · 곡별 음량 정규화 — 백엔드가 정하는 값.
//
// "노래마다 소리가 크고 작다" 는 문제를 **사용자가 고르는 옵션**이 아니라
// 서버가 맞춘다. 프런트(플레이어)는 재생하면서 곡의 기준 음량(RMS)을 재서
// 보고만 하고, 보정값(gain_db)은 여기서 정해 곡 기록에 남긴다. 그러면 어느
// 기기에서 들어도 같은 값으로 송출된다.
//
// · 목표: -14 dBFS (요즘 스트리밍 마스터와 비슷한 체감)
// · 내리기: 최대 -12 dB,  올리기: 최대 +6 dB
// · 트루피크가 -1 dBFS 를 넘지 않게 마지막으로 한 번 더 조인다 (클리핑 방지)
export const NORM_TARGET_DB = -14;
export const NORM_MIN_DB = -12;
export const NORM_MAX_DB = 6;
export const NORM_PEAK_DB = -1;
export const NORM_MIN_SEC = 3;

const round1 = (v) => Math.round(v * 10) / 10;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 프런트가 보고한 측정값을 쓸 수 있는지 판단한다.
export function validMeasure(rmsDb, peakDb, sec) {
  const r = num(rmsDb);
  if (r === null || r > 0 || r < -80) return null;
  const s = num(sec);
  if (s === null || s < NORM_MIN_SEC) return null;
  const p = num(peakDb);
  if (p !== null && (p > 1 || p < -80)) return null;
  return { rms: r, peak: p, sec: Math.round(s) };
}

// 목표 음량까지의 보정값(dB). 올릴 때는 트루피크 상한을 먼저 지킨다.
export function normGainDb(rmsDb, peakDb) {
  const r = num(rmsDb);
  if (r === null) return 0;
  let gain = NORM_TARGET_DB - r;
  const p = num(peakDb);
  if (p !== null && gain > 0) {
    const head = NORM_PEAK_DB - p;                 // 더 올리면 클리핑나는 만큼
    if (head < gain) gain = head;
  }
  gain = Math.max(NORM_MIN_DB, Math.min(NORM_MAX_DB, gain));
  if (Math.abs(gain) < 0.1) return 0;              // 0.1dB 미만은 손대지 않는다
  return round1(gain);
}

// 곡 기록에 저장할 정규화 정보.
export function normRecord(rmsDb, peakDb, sec, by = 'client-rms') {
  const m = validMeasure(rmsDb, peakDb, sec);
  if (!m) return null;
  return {
    lufs: round1(m.rms),                            // 기준 음량(추정 LUFS)
    peak_db: m.peak === null ? null : round1(m.peak),
    sec: m.sec,
    gain_db: normGainDb(m.rms, m.peak),
    by,
    at: new Date().toISOString().slice(0, 19) + 'Z',
  };
}

// 곡 기록에서 송출용 보정값을 꺼낸다 (없거나 이상하면 0 = 원본 그대로).
export function normDbOf(rec) {
  const g = num(rec && rec.norm && rec.norm.gain_db);
  if (g === null || Math.abs(g) < 0.1) return 0;
  return Math.max(NORM_MIN_DB, Math.min(NORM_MAX_DB, round1(g)));
}
