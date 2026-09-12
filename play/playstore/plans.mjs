/* ═══════════════════════════════════════════════════════════════════════════
   요금제 — 한 곳에서 정한다

   여기 값을 바꾸면 스토어 문구·앱 안내·서버 정책이 모두 따라온다.
   원칙 (docs/store_plan.md §2):
     · 무료는 기기에서 도는 것을 전부 준다 — 논문 읽기·필기·수식·PDF. 서버비 0원.
     · 돈은 **서버가 일하는 것**에만 받는다 — AI 요약·번역, 논문 변환·보관.
     · "평생 무제한"은 팔지 않는다. AI 원가는 사용량에 비례한다.
   ═══════════════════════════════════════════════════════════════════════════ */

export const CURRENCY = 'KRW';

export const PLANS = [
  {
    id: 'free',
    name: '무료',
    price: 0,
    period: '',
    tagline: '논문 읽고 필기하는 건 전부 무료',
    includes: [
      '논문 PDF 가져오기 — 월 5편',
      '필기 · 형광펜 · 수식 · 표 (기기 저장, 무제한)',
      '오프라인에서도 열림',
      'AI 요약·번역 — 월 20회'
    ],
    serverCost: '월 0~500원 (AI 크레딧)'
  },
  {
    id: 'papers',
    name: '논문 100편',
    price: 3000,
    period: '1회',
    tagline: '3,000원으로 논문 100편 AI 처리',
    includes: [
      'AI 요약·번역 100회',
      '가져온 논문은 기기에 저장 (편수 제한 없음)',
      '나머지 기능 전부'
    ],
    serverCost: '약 1,500~2,500원'
  },
  {
    id: 'premium',
    name: '프리미엄',
    price: 14900,
    period: '월',
    tagline: '컴퓨터로 읽고 편집하고, 패드로 필기',
    recommended: true,
    includes: [
      '논문 가져오기 — 편수 제한 없음',
      // 핵심: 요금제를 올린 이유가 이 한 줄이다
      '개인 클라우드 200GB — 논문도 필기도 보관',
      '컴퓨터·패드·폰이 같은 상태 (열면 최신)',
      'AI 요약·번역 — 월 300회',
      '논문 챗 · 공동 편집'
    ],
    serverCost: '스토리지 약 4,000원 + AI 약 3,000원 (200GB · 300회 기준)'
  }
];

/* 가져오기 정책 — **요금제에 따라 두 갈래**다 (사용자 결정 두 번에 걸쳐 확정)

     무료      서버는 변환만. 기기가 다 받으면 서버 사본을 지운다.
               → 서버비 0, "논문이 서버에 남지 않는다"는 약속. 월 5편.
     프리미엄  서버가 원본(200GB). 컴퓨터에서 읽고 편집하고, 패드로 필기한다.
               → 기기 사본은 오프라인용. 편수 제한 없음.

   숫자의 진실은 서버에 있다 — server/src/lib/plans.js 가 실제로 막는 값이고,
   여기 값은 사람에게 보여 주는 값이다. verify.mjs 가 둘을 대조한다. */
export const IMPORT_POLICY = {
  free: { papersPerMonth: 5, maxPages: 1200, cloudBytes: 0 },
  papers: { papersPerMonth: Infinity, maxPages: 1200, cloudBytes: 0 },
  premium: { papersPerMonth: Infinity, maxPages: 1200, cloudBytes: 200 * 1024 * 1024 * 1024 },
  // 무료는 서버가 보관하지 않는다(변환 후 기기로). 프리미엄은 보관한다.
  serverKeepsCopy: { free: false, papers: false, premium: true },
  // 어느 요금제가 보관형인가 — 코드가 헷갈리지 않게 한 줄로
  cloudPlans: ['premium'],
  // 옛 기기·옛 브라우저(번들을 못 받는 경우)를 위한 안전판. 0 이면 무제한.
  serverQuotaMB: 2048
};

/* AI 크레딧 — 실제 원가의 5~10배를 남기지 않도록 상한을 코드로 박는다 */
export const AI_CREDITS = {
  free: { perMonth: 20, label: '월 20회' },
  papers: { total: 100, label: '100회' },
  premium: { perMonth: 300, label: '월 300회' }
};

/* 결제 — 스토어와 웹 둘 다 (사용자 결정).
   스토어: 수수료 20~30%지만 심사·환불이 단순하고 신뢰가 높다.
   웹    : 수수료 0% — 컴퓨터로 읽는 사람이 많으니 컴퓨터에서 결제하는 길을 둔다. */
export const PAYMENT = {
  store: true,          // 갤럭시스토어 · 구글플레이 IAP
  web: true,            // 웹 결제(카드·간편결제) — 앱 안에서 '웹에서 결제' 안내
  storeFeeHint: '갤럭시 20% · 플레이 20~30% (2025-05 부터 국내 인하)',
  webFeeHint: 'PG 수수료 2~3% 수준'
};

export function planById(id) {
  return PLANS.find((p) => p.id === id) || PLANS[0];
}

export function priceLabel(plan) {
  if (!plan.price) return '무료';
  const n = plan.price.toLocaleString('ko-KR');
  return plan.period === '월' ? `₩${n} / 월` : `₩${n} (${plan.period})`;
}
