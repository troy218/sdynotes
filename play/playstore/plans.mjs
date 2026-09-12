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
    price: 4900,
    period: '월',
    tagline: '논문을 끝없이 읽는 사람을 위한 것',
    recommended: true,
    includes: [
      '논문 가져오기 — 편수 제한 없음',
      'AI 요약·번역 — 월 300회',
      '논문 챗 · 공동 편집',
      '기기 간 노트 맞추기'
    ],
    serverCost: '약 1,500~3,000원 + AI 초과분'
  }
];

/* 가져오기 정책 — 서버는 변환만 하고 보관은 기기가 한다(16.7).
   그래서 '편수'가 아니라 '한 번에 옮기는 양'이 서버 부담을 정한다. */
export const IMPORT_POLICY = {
  free: { papersPerMonth: 5, maxPages: 1200 },
  papers: { papersPerMonth: Infinity, maxPages: 1200 },
  premium: { papersPerMonth: Infinity, maxPages: 1200 },
  // 변환 결과는 기기로 넘기고 서버에서는 지운다.
  //   기기 저장이 실패한 채로 남는 사본이 서버가 잠깐 들고 있는 유일한 것이다.
  serverKeepsCopy: false,
  // 옛 기기·옛 브라우저(번들을 못 받는 경우)를 위한 안전판.
  //   0 이면 무제한. 기본 2GB — 이 경로로 남는 문서만 여기에 걸린다.
  serverQuotaMB: 2048
};

/* AI 크레딧 — 실제 원가의 5~10배를 남기지 않도록 상한을 코드로 박는다 */
export const AI_CREDITS = {
  free: { perMonth: 20, label: '월 20회' },
  papers: { total: 100, label: '100회' },
  premium: { perMonth: 300, label: '월 300회' }
};

export function planById(id) {
  return PLANS.find((p) => p.id === id) || PLANS[0];
}

export function priceLabel(plan) {
  if (!plan.price) return '무료';
  const n = plan.price.toLocaleString('ko-KR');
  return plan.period === '월' ? `₩${n} / 월` : `₩${n} (${plan.period})`;
}
