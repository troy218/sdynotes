/* ═══════════════════════════════════════════════════════════════════════════
   요금제 — 서버가 **강제하는** 숫자는 여기에만 있다

   왜 한 곳인가
     스토어 문구(play/playstore/plans.mjs)는 사람에게 보여 주는 값이고, 여기는
     서버가 실제로 막는 값이다. 두 곳이 어긋나면 "무제한이라고 팔았는데 막히는"
     사고가 난다. 그래서 play/playstore/scripts/verify.mjs 가 두 값을 대조한다.

   지금 방침 (사용자 결정)
     · 무료      — 기기 전용. 서버에 논문을 남기지 않는다(변환 후 기기로 보내고 삭제).
                   월 5편. 서버비가 0에 가깝다.
     · 프리미엄  — 월 14,900원 · 클라우드 200GB. **논문도 필기도 서버에 보관**해서
                   컴퓨터·패드·폰이 같은 상태를 본다. 기기 이관(삭제)은 하지 않는다.
     · 크레딧    — 3,000원에 AI 100회. 클라우드는 없음(무료와 같은 기기 전용).

   값은 환경변수로도 바꿀 수 있다(운영 중 조정·장애 대응).
   ═══════════════════════════════════════════════════════════════════════════ */
const GB = 1024 * 1024 * 1024;
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

function env(name, def) {
  return process.env[name] === undefined ? def : num(process.env[name], def);
}

export const PLANS = {
  free: {
    id: 'free',
    name: '무료',
    price: 0,
    // 기기 전용 — 서버는 변환만 하고 사본을 지운다
    keepsCopy: false,
    cloudBytes: () => env('SDY_FREE_CLOUD_MB', 0) * 1024 * 1024,
    papersPerMonth: () => env('SDY_FREE_PAPERS', 5),
    aiPerMonth: () => env('SDY_FREE_AI', 20),
  },
  credits: {
    id: 'credits',
    name: '논문 100편',
    price: 3000,
    keepsCopy: false,                 // 크레딧은 AI 사용량 상품이지 보관 상품이 아니다
    cloudBytes: () => 0,
    papersPerMonth: () => Infinity,
    aiPerMonth: () => Infinity,       // 총 100회를 다 쓰면 끝(차감은 결제 붙일 때)
    credits: 100,
  },
  premium: {
    id: 'premium',
    name: '프리미엄',
    price: 14900,
    period: '월',
    keepsCopy: true,                  // 클라우드가 원본 — 컴퓨터에서도 열린다
    cloudBytes: () => env('SDY_PREMIUM_CLOUD_GB', 200) * GB,
    papersPerMonth: () => Infinity,
    aiPerMonth: () => env('SDY_PREMIUM_AI', 300),
  },
};

export const PLAN_IDS = Object.keys(PLANS);

export function planById(id) {
  return PLANS[String(id || '').trim()] || PLANS.free;
}

// 회원 레코드에서 요금제 꺼내기 (없으면 무료)
export function planOf(user) {
  return planById(user && user.plan);
}

// 서버가 논문을 보관하는 요금제인가
export function planKeepsCopy(user) {
  return !!planOf(user).keepsCopy;
}

// 보관 상한(바이트). 0 이면 서버 보관 없음/무제한 구분은 호출부가 한다.
export function planCloudBytes(user) {
  return planOf(user).cloudBytes();
}

export function planPapersPerMonth(user) {
  return planOf(user).papersPerMonth();
}

export function planAiPerMonth(user) {
  return planOf(user).aiPerMonth();
}

// ── 사람에게 보여 줄 요약 (계정 화면·상태 확인용) ────────────────────────
export function planSummary(user) {
  const p = planOf(user);
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    period: p.period || '',
    keeps_copy: !!p.keepsCopy,
    cloud_bytes: p.cloudBytes(),
    papers_per_month: p.papersPerMonth() === Infinity ? null : p.papersPerMonth(),
    ai_per_month: p.aiPerMonth() === Infinity ? null : p.aiPerMonth(),
  };
}

// ── 요금제 바꾸기 (결제가 붙으면 여기만 부르면 된다) ─────────────────────
//   지금은 운영자가 스크립트로 바꾸거나, 결제 연동이 호출한다.
export function planApply(rec, planId, opts = {}) {
  const p = planById(planId);
  if (!rec) return { ok: false, error: '회원 없음' };
  rec.plan = p.id;
  rec.plan_since = Math.floor(Date.now() / 1000);
  if (opts.until) rec.plan_until = Math.floor(opts.until);
  if (opts.source) rec.plan_source = String(opts.source);      // 'web' | 'play' | 'galaxy' | 'admin'
  if (opts.orderId) rec.plan_order = String(opts.orderId);
  return { ok: true, plan: p.id };
}

// 구독이 끝난 회원을 무료로 되돌린다 (만료 검사에서 호출)
export function planExpireCheck(rec, now = Math.floor(Date.now() / 1000)) {
  if (!rec || !rec.plan_until) return { expired: false };
  if (rec.plan_until > now) return { expired: false };
  const was = rec.plan;
  rec.plan = 'free';
  delete rec.plan_until;
  return { expired: true, was };
}

export function planEnvDoc() {
  return {
    'SDY_FREE_PAPERS': '무료 회원 월 논문 편수 (기본 5)',
    'SDY_FREE_CLOUD_MB': '무료 회원 클라우드 (기본 0 = 서버 보관 안 함)',
    'SDY_FREE_AI': '무료 회원 월 AI 횟수 (기본 20)',
    'SDY_PREMIUM_CLOUD_GB': '프리미엄 클라우드 (기본 200GB)',
    'SDY_PREMIUM_AI': '프리미엄 월 AI 횟수 (기본 300)',
  };
}
