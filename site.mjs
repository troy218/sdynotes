/* ═══════════════════════════════════════════════════════════════════════════
   발매판 뼈대 · 도메인 — 한 곳에서 정한다

   발매처는 셋이다.

     web/              웹        컴퓨터 브라우저 (논문 읽고 편집하는 주 무대)
     play/playstore/   Google Play   안드로이드 (패드에서 펜으로 필기)
     appstore/         App Store     iOS · iPadOS

   원본 사이트 코드(sdynotes.*, src/, server/, worker/)는 이 파일을 참조하지
   않는다. 발매판 폴더만 여기를 읽는다.

   ── 도메인 ──
   지금은 DuckDNS 주소를 쓰고, 도메인을 산 뒤 notesis.com 으로 옮긴다.
   이전할 때는 아래 SITE.current 한 줄만 바꾸면 된다(절차: web/docs/web_launch.md).
   배포 서버에서만 임시로 다른 주소를 쓰려면 SDY_SITE_DOMAIN 을 준다.
   ═══════════════════════════════════════════════════════════════════════════ */

export const SITE = {
  brand: 'notesis',

  // 지금 서비스하는 주소 (DuckDNS — 무료, 지금 쓰는 중)
  current: 'sdynote.duckdns.org',

  // 옮길 주소 (도메인 구입 후. 이전 절차는 web/docs/web_launch.md)
  next: 'notesis.com',

  // 이전 기간에는 두 주소가 함께 살아 있어야 한다(옛 주소로 들어온 사람·설치된 앱).
  aliases: ['www.notesis.com'],

  // 스토어 식별자 — 폴더마다 따로 적지 않는다
  android: { package: 'app.notesis.notes' },
  apple: { bundle: 'com.notesis.notes' },

  locales: ['ko'],
  supportEmail: 'dyshin218@gmail.com',
};

/* 발매처와 폴더 자리 — 검사 스크립트(scripts/check-launch.mjs)가 이 표를 근거로 본다. */
export const LAUNCH = {
  web: {
    dir: 'web',
    target: '웹 (컴퓨터 브라우저 — 읽고 편집)',
    readme: 'README.md',
  },
  play: {
    dir: 'play/playstore',
    target: 'Google Play (안드로이드 · 패드 필기)',
    readme: 'README.md',
  },
  appstore: {
    dir: 'appstore',
    target: 'App Store (iOS · iPadOS)',
    readme: 'README.md',
  },
};

/* ── 도메인 ─────────────────────────────────────────────────────────────── */

// 지금 쓸 도메인. 배포 서버에서 SDY_SITE_DOMAIN 으로 덮을 수 있다.
export function activeDomain(env = process.env) {
  const v = String((env && env.SDY_SITE_DOMAIN) || '').trim();
  return v || SITE.current;
}

// https://<도메인>
export function origin(env = process.env) {
  return 'https://' + activeDomain(env);
}

// https://<도메인>/경로 — 스토어 등록·법적 문서 링크에 쓴다
export function url(pathname = '/', env = process.env) {
  const p = String(pathname || '/');
  return origin(env) + (p.startsWith('/') ? p : '/' + p);
}

// 아직 옛 주소인가 (이전 안내·경고용)
export function onNextDomain(env = process.env) {
  return activeDomain(env) === SITE.next;
}

// 한 줄 요약 — 검사·안내 출력에 쓴다
export function domainLine(env = process.env) {
  const now = activeDomain(env);
  if (now === SITE.next) return `${now} (이전 완료)`;
  return `${now} → ${SITE.next} (이전 예정)`;
}

// 스토어 등록·개인정보처리방침에 넣을 기본 링크
export function launchLinks(env = process.env) {
  return {
    home: url('/', env),
    privacy: url('/privacy', env),
    terms: url('/terms', env),
    support: SITE.supportEmail,
  };
}
