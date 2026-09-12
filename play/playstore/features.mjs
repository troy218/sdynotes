/* ═══════════════════════════════════════════════════════════════════════════
   발매판 정체성 · 한 곳에서 정한다

   여기 값을 바꾸면 매니페스트·아이콘·서비스워커·앱 이름표가 모두 따라온다.
   (원본 사이트 코드는 이 파일을 참조하지 않는다 — 발매판 전용이다.)
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 이름표를 한 곳에 모아 둔다. 원본은 여전히 SDYnotes 라고 부르지만,
// 발매판이 보여 주는 이름은 전부 여기서 나온다.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BRAND = {
  from: 'SDYnotes',
  // 화면·앱 이름으로 쓰이는 표기 (사용자가 정한 이름 그대로 소문자)
  to: 'notesis',
  // 개발자의 옛 설정이 남아 있어도 새 이름을 쓰도록 legacy 판정에 넣는다
  legacyTitles: ['SDYnotes', '동엽신의 끄적끄적'],
};

export const APP = {
  brand: BRAND.to,
  // 스토어에 보이는 이름. 검색에 걸리도록 '논문'을 붙인다.
  name: 'notesis — 논문 읽는 노트',
  shortName: 'notesis',           // 홈 화면 아이콘 아래 이름(12자 이내)
  description: '논문 PDF에 바로 필기하고, 수식·표로 정리하고, AI로 요약·번역하는 연구용 노트. PDF와 필기는 기기 안에만 저장됩니다.',
  lang: 'ko',
  dir: 'ltr',

  // ── 타깃 ──
  //   주 사용자: 논문을 자주 읽는 대학원생 · 학부생
  //   (학부 3~4학년 세미나/졸업논문, 대학원 저널클럽·문헌연구)
  audience: {
    primary: '논문을 자주 읽는 대학원생',
    secondary: '논문 읽기를 시작한 학부생(3~4학년)',
    jobs: [
      'PDF 논문에 필기·형광펜 하면서 읽기',
      '읽은 내용을 수식·표로 다시 정리하기',
      '모르는 문장을 번역하고 요약해 두기',
      '발표·세미나 준비로 요약본 뽑기',
    ],
  },

  // PWA 매니페스트 id — 앱의 영구 식별자. 바꾸면 기존 설치와 분리된다.
  id: '/?app=notesis',
  // 안드로이드 스토어 등록에 쓸 패키지 이름(지금은 기록용 — TWA 만들 때 그대로 쓴다)
  packageId: 'app.notesis.notes',

  themeColor: '#14366E',      // 상단바(주소창) 색
  backgroundColor: '#0F2A5A', // 앱이 뜨기 전 배경
  display: 'standalone',
  orientation: 'any',

  // 시작 화면 — 기존 서버가 / 를 서빙한다.
  startUrl: '/?app=notesis',
  scope: '/',
};

/* 발매판이 쓰는 서버 기능과, 기기에서 도는 기능을 나눠 적어 둔다.
   README·개인정보처리방침·스토어 등록 문구가 모두 이 표를 근거로 쓴다. */
export const LOCAL_FIRST = {
  기기에서만: [
    '노트 본문·필기·수식·표 작성과 저장',
    'PDF 가져오기와 쪽 보기',
    '음악 파일 보관·재생·태그 편집',
    '앱 셸(화면·글꼴·수식 렌더러) — 오프라인에서도 열림',
  ],
  서버가_필요: [
    'AI 요약·질문·번역(해돌이)',
    '논문 챗 · 공동 편집 · 친구',
    '곡 정보(태그)·가사 찾기, 소리 인식',
    '다른 기기와 노트 맞추기(동기화)',
  ],
};

/* ── 이름표 바꾸기 ────────────────────────────────────────────────────────
   화면에 보이는 'SDYnotes' 만 notesis 로 바꾼다.
     · 살아있는 값(저장 키 sdy3, 파일 이름 sdynotes.js …)은 건드리지 않는다.
       원본에서 'SDYnotes' 가 쓰이는 곳은 11곳뿐이고 전부 표시용 문자열이다.
     · 그래서 이 함수는 **복사본에만** 적용한다. 원본은 그대로다.
   ─────────────────────────────────────────────────────────────────────── */
export function rebrand(text) {
  let out = text;
  // ① 표시용 이름
  if (BRAND.from !== BRAND.to) out = out.split(BRAND.from).join(BRAND.to);

  // ② 개발자 기기에 남은 옛 설정 제목을 '없음'으로 취급한다.
  //    (설정에 제목을 직접 넣은 사용자는 그대로 존중한다)
  const guard = BRAND.legacyTitles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pat = new RegExp(
    "const t=\\(S\\.appTitle&&String\\(S\\.appTitle\\)\\.trim\\(\\)\\)\\?S\\.appTitle\\.trim\\(\\):'" + BRAND.to + "';",
    'g');
  out = out.replace(pat,
    "const t=(S.appTitle&&String(S.appTitle).trim()&&!/^(" + guard + ")$/.test(String(S.appTitle).trim()))" +
    "?String(S.appTitle).trim():'" + BRAND.to + "';");

  return out;
}

/* 빌드가 지금 어떤 이름으로 조립되는지 한 줄로 */
export function brandLine() {
  return `${BRAND.from} → ${BRAND.to} · ${APP.name}`;
}

export { ROOT };
