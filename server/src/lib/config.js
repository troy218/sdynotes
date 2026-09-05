// Environment-derived configuration (mirrors sdynotes/common.py + per-module consts).
import crypto from 'node:crypto';

// ── 버전 · 작업마다 반드시 올려라 ─────────────────────────────────────
// 작업 하나가 끝나면 아래 5곳을 '같은 번호로' 함께 올린다 (x.y.z 의 z +1).
//   node scripts/bump-version.mjs 14.16.5   ← 5곳을 한 번에 바꿔 준다 (--check 는 검사만)
//   ① package.json                     "version"
//   ② package-lock.json                "version" 2곳 (최상단 + packages."")
//   ③ server/src/lib/config.js         APP_VERSION            ← 여기
//   ④ worker/sdynotes_worker/common.py APP_VERSION
//   ⑤ sdynotes.html                    <meta application-version>
//                                      + sdynotes.css?v=  /  sdynotes.js?v=
// 하나라도 빠지면 → apply.sh 의 버전 검사가 배포를 중단한다.
// ⑤의 ?v= 를 안 올리면 → nginx 가 sdynotes.js/css 를 1년 immutable 로 캐싱하므로
//   이미 접속한 브라우저가 옛 JS/CSS 를 1년 동안 계속 쓴다(조용히 깨진다).
//   그래서 내리는 쪽이 아니라 '올리는' 쪽으로 맞춘다.
export const APP_VERSION = '14.28.1';
export const SETTINGS_SCHEMA = 3;

// ── 저장소 모드 ────────────────────────────────────────────────────────
// 'oracle'  (기본) : 모든 상태·파일을 이 Oracle 서버 디스크에 저장한다.
//                    Supabase/Cloudinary 로 나가는 트래픽이 전혀 없다.
// 'cloud'   (롤백) : 예전처럼 Supabase(상태) + Cloudinary(파일) 를 쓴다.
//                    .env 의 SUPABASE_*/CLOUDINARY_* 키는 이 모드에서만 읽힌다.
export const STORAGE_MODE = (process.env.SDY_STORAGE || 'oracle').trim().toLowerCase();
export const oracleStorage = () => STORAGE_MODE !== 'cloud';

export const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'os8j8bnv';
export const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
export const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
export const CLOUD_READY = STORAGE_MODE === 'cloud' && Boolean(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

export const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://xillsulrehkpuzyuhgcn.supabase.co').replace(/\/+$/, '');
export const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_KEY
  || ''
).trim();
// oracle 모드에선 키가 남아 있어도 Supabase 를 쓰지 않는다 (쿼터 초과 방지).
export const sbEnabled = () => STORAGE_MODE === 'cloud' && Boolean(SUPABASE_URL && SUPABASE_KEY);

export const TABLES = {
  sync: 'sdy_sync_states',
  cards: 'sdy_card_decks',
  music: 'sdy_music_tracks',
  stickers: 'sdy_stickers',
};
export const SB_TABLES = new Set(Object.values(TABLES));

// admin
export const ADMIN_PW_HASH = process.env.ADMIN_PW_HASH || crypto.createHash('sha256').update('818988').digest('hex');
export const MAX_TRIES = 3;
export const BLOCK_SECONDS = 600;
export const SESSION_TTL = 30 * 24 * 3600;          // 30 days
export const SESSION_REFRESH_IF_LT = 7 * 24 * 3600;  // extend if <7d left

// misc
export const QUOTA_BYTES = parseInt(process.env.SDY_QUOTA_MB || '2048', 10) * 1024 * 1024;

// stickers
export const STICKER_MAX_BYTES = 8 * 1024 * 1024;

// wallpaper
export const WALL_MAX_MB = 12;
export const WALL_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp']);
export const WALL_MAX_WIDTH = 2560;
export const WALL_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);
export const WALL_VIDEO_MAX_MB = 40;

// music
export const MUSIC_MAX_MB = 50;
export const MUSIC_EXTS = new Set(['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'webm', 'weba']);
export const MUSIC_MIME = {
  mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm', weba: 'audio/webm',
};
export const TAG_ALGO = '13.0';

// translate
export const LT_URL = (process.env.LIBRETRANSLATE_URL || '').replace(/\/+$/, '');
export const LT_KEY = (process.env.LIBRETRANSLATE_KEY || '').trim();
export const TR_ENGINE = (process.env.TRANSLATE_ENGINE || 'auto').toLowerCase();

// ── AI (노트 요약·질문) ────────────────────────────────────────────────
// OpenAI 호환 /v1/chat/completions 를 쓰는 어디든 붙는다. 키는 서버에서만
// 읽는다 — 프런트(sdynotes.js)에는 절대 심지 않는다(전역 CSP 가 없어서
// JS 에 박힌 값은 그대로 노출된다).
//
// 왜 공급사 '체인'인가
//   무료 티어는 하루 한도가 곧 끝난다. translate.js 가 Google 호스트 3개를
//   순회하듯, 한 공급자가 429 를 주면 다음 공급자로 넘어가게 했다.
//   AI_PROVIDERS="groq,gemini" + GROQ_API_KEY + GEMINI_API_KEY 면 끝.
//
// ⚠ 노트 앱이라 '데이터가 학습에 쓰이는가'가 중요하다
//   Gemini 무료 티어는 입력이 Google 제품 개선에 사용될 수 있다(유료는 아님).
//   개인 노트가 그게 싫으면 Groq(학습 미사용)를 먼저 두거나, 아래 Ollama 처럼
//   아예 서버 안에서 돌린다.
//
// 로컬(Ollama) — 키 0원·외부 전송 0
//   AI_BASE_URL=http://127.0.0.1:11434/v1 + AI_KEY=ollama + AI_MODEL=qwen2.5:3b
//   (MIGRATION_AMD_TO_ARM.md 권장 Always Free 4 OCPU/24GB 면 3B 급 CPU 추론 가능)
export const AI_PROVIDER_PRESETS = {
  openai:     { url: 'https://api.openai.com/v1',      model: 'gpt-4o-mini',            keyEnv: 'OPENAI_API_KEY' },
  groq:       { url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyEnv: 'GROQ_API_KEY' },
  gemini:     { url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyEnv: 'GEMINI_API_KEY' },
  openrouter: { url: 'https://openrouter.ai/api/v1',   model: 'openai/gpt-4o-mini',     keyEnv: 'OPENROUTER_API_KEY' },
  // 로컬 Ollama 는 키가 필요 없지만 OpenAI 호환 클라이언트라 빈 키를 거부하는
  // 구현이 있어 자리표시자를 넣는다 (아무 값이나 됨 · 밖으로 나가지 않는다).
  ollama:     { url: 'http://127.0.0.1:11434/v1',      model: 'qwen2.5:3b',             keyEnv: 'OLLAMA_API_KEY', placeholderKey: 'ollama' },
};

const AI_PROVIDER_DEFAULT_URL = 'https://api.openai.com/v1';
const AI_PROVIDER_DEFAULT_MODEL = 'gpt-4o-mini';

// .env → 공급사 목록. 키가 실제로 있는 것만 살려 둔다(빈 키로 401 을 맞지 않게).
//
// 같은 키로 '모델 여러 개'를 걸어 두고 싶으면 <이름>_MODELS 콤마 목록을 쓴다.
//   GEMINI_MODELS=gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite
// 무료 티어는 모델마다 하루 한도가 따로라, 하나가 429 를 주면 체인이 **같은 키로**
// 다음 모델로 넘어간다(그래야 '한도에 걸려도 자동으로 다음 모델'처럼 보인다).
// 단일 <이름>_MODEL 보다 <이름>_MODELS 가 우선한다. manual 은 AI_MODELS / AI_MODEL.
export function aiProvidersFromEnv(env = process.env) {
  const read = (k) => String(env[k] || '').trim();
  const out = [];
  const seen = new Set();

  // 모델 후보 목록. <NAME>_MODELS(콤마) → <NAME>_MODEL → 프리셋 기본.
  const modelCandidates = (name, manual = false) => {
    if (manual) {
      const list = read('AI_MODELS').split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) return list;
      const single = read('AI_MODEL');
      return single ? [single] : [AI_PROVIDER_DEFAULT_MODEL];
    }
    const list = read(`${name.toUpperCase()}_MODELS`).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
    const single = read(`${name.toUpperCase()}_MODEL`);
    return single ? [single] : [AI_PROVIDER_PRESETS[name]?.model || AI_PROVIDER_DEFAULT_MODEL];
  };

  // 하나의 (키, url) 아래에서 모델 목록만큼 체인 항목을 만든다.
  const push = (name, key, url, models) => {
    if (!key) return;
    const baseUrl = String(url || AI_PROVIDER_PRESETS[name]?.url || AI_PROVIDER_DEFAULT_URL).replace(/\/+$/, '');
    for (const model of models) {
      const p = { name, key, url: baseUrl, model };
      const k = `${p.key}|${p.url}|${p.model}`;   // 같은 키+url+model 은 하나만
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  };

  // ① 수동 지정이 있으면 그게 1순위 (예전 AI_KEY/AI_BASE_URL/AI_MODEL 그대로 동작)
  const manualKey = read('AI_KEY');
  if (manualKey) push(read('AI_PROVIDER') || 'manual', manualKey, read('AI_BASE_URL'), modelCandidates('manual', true));
  // ② AI_PROVIDERS 로 여러 개를 순서대로
  const added = new Set();
  for (const raw of read('AI_PROVIDERS').split(',')) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    const preset = AI_PROVIDER_PRESETS[name];
    if (!preset) continue;
    const key = read(preset.keyEnv) || (name === 'ollama' ? preset.placeholderKey : '');
    push(name, key, read(`${name.toUpperCase()}_BASE_URL`), modelCandidates(name));
    added.add(name);
  }
  // ③ 프리셋 키만 있어도 자동으로 붙는다 (AI_PROVIDERS 를 안 적어도 됨).
  //    단 ②에서 이미 넣은 이름은 건너뛴다 — 안 그러면 BASE_URL/MODEL 을 덮어쓴
  //    경우 '덮어쓴 것 + 프리셋 기본값' 두 벌이 잡혀 같은 공급사를 두 번 때린다.
  for (const [name, preset] of Object.entries(AI_PROVIDER_PRESETS)) {
    if (name === 'ollama' || added.has(name)) continue;   // 로컬은 명시한 경우에만
    push(name, read(preset.keyEnv), read(`${name.toUpperCase()}_BASE_URL`), modelCandidates(name));
  }

  return out;
}

export const AI_PROVIDERS = aiProvidersFromEnv();
// 하위 호환: 예전 코드가 읽던 이름. 체인의 첫 번째 공급사를 가리킨다.
export const AI_KEY = AI_PROVIDERS[0]?.key || '';
export const AI_BASE_URL = AI_PROVIDERS[0]?.url || AI_PROVIDER_DEFAULT_URL;
export const AI_MODEL = AI_PROVIDERS[0]?.model || AI_PROVIDER_DEFAULT_MODEL;
// 14.22.0 · 답이 중간에 끊기지 않게 기본 출력 토큰을 넉넉히 (한국어는 토큰이 빨리 먹힌다)
// 14.27.1 · 장문 작성과 최대 120개 편집 명령을 끝까지 받도록 출력 여유를 넓힌다.
// 공급사별 출력 한도가 더 작으면 .env의 AI_MAX_TOKENS로 낮출 수 있다.
export const AI_MAX_TOKENS = Math.min(16000, Math.max(256, parseInt(process.env.AI_MAX_TOKENS || '8000', 10)));
// 긴 응답은 45초 안에 정상적으로 끝나지 않을 수 있다. 사용자는 프런트의 중단 버튼으로 즉시 취소할 수 있다.
export const AI_TIMEOUT_MS = Math.max(5000, parseInt(process.env.AI_TIMEOUT_MS || '120000', 10));
// 14.27.1 · 긴 노트의 앞·중간·뒤를 고르게 읽는다(routes/ai.js fitText).
// 기본 8만 자. 비정상 설정으로 요청이 무한히 커지지 않도록 20만 자에서 막는다.
export const AI_MAX_TEXT = Math.min(200000, Math.max(500, parseInt(process.env.AI_MAX_TEXT || '80000', 10)));
// 여러 상자에 대한 상세 지시나 긴 초안을 한 요청으로 받을 수 있게 한다.
export const AI_MAX_QUESTION = Math.min(20000, Math.max(200, parseInt(process.env.AI_MAX_QUESTION || '6000', 10)));
// 이어서 하는 장문 편집도 최근 대화가 너무 빨리 잘리지 않게 한다.
export const AI_MAX_CONTEXT = Math.min(50000, Math.max(0, parseInt(process.env.AI_MAX_CONTEXT || '16000', 10)));
// 낮은 사양·작은 컨텍스트 모델용 분할 처리. 긴 편집 상태는 이 크기마다 나눠
// 최대 AI_MAX_PARTS개로 병렬 계획하고, 출력 한도에 닿으면 AI_CONTINUE_PARTS까지 이어 쓴다.
export const AI_PART_CHARS = Math.min(50000, Math.max(4000, parseInt(process.env.AI_PART_CHARS || '18000', 10)));
export const AI_MAX_PARTS = Math.min(8, Math.max(1, parseInt(process.env.AI_MAX_PARTS || '4', 10)));
export const AI_CONTINUE_PARTS = Math.min(8, Math.max(1, parseInt(process.env.AI_CONTINUE_PARTS || '4', 10)));
export const AI_CACHE_TTL_MS = Math.max(0, parseInt(process.env.AI_CACHE_TTL_MS || '600000', 10));
export const AI_RATE_N = Math.max(1, parseInt(process.env.AI_RATE_N || '12', 10));      // 창당 요청 수
export const AI_RATE_WINDOW_MS = Math.max(1000, parseInt(process.env.AI_RATE_WINDOW_MS || '60000', 10));
// 14.22.0 · '미리 준비해 두기'(warm) 전용 창 — 버튼을 누르기 전에 백그라운드로
//   요약·개조식을 채워 두는 요청이다. 사용자가 직접 누른 요청과 한도를 섞지 않게
//   따로 센다(절반). 0 으로 두면 미리 준비를 끈다.
export const AI_WARM_N = Math.max(0, parseInt(process.env.AI_WARM_N
  || String(Math.max(2, Math.floor(AI_RATE_N / 2))), 10));
// 공급사별 쿨다운(AI_COOLDOWN_MS)은 없어졌다 — 429/5xx 를 맞아도 서버가 스스로
// 쉬지 않고, 다음 요청은 곧바로 다시 외부로 나간다 (공급사가 준 retry-after 만 전달).
export const AI_READY = AI_PROVIDERS.length > 0;

// 참고 · 왜 arena.ai 를 직접 부르지 않나
//   arena.ai 는 공개 API·임베드 위젯이 없는 소비자용 채팅/투표 사이트다
//   (reCAPTCHA + "대화가 제3자 AI 에 전달되고 공개될 수 있다" 약관). 계정을
//   만들어 내부 엔드포인트를 우회 호출하는 것은 약관 위반이고, 개인 노트가
//   제3자에게 공개될 수 있어 이 앱에서는 하지 않는다.
//   한편 '아레나 UI' 자체는 오픈소스다 — lm-sys/FastChat(Apache-2.0)의
//   `fastchat.serve.gradio_web_server_multi` 가 그 Gradio 화면이다. 그건
//   '비교 사이트'를 따로 띄울 때 쓰는 물건이고, 이 노트 앱에는 필요 없다.

// presence
export const PRESENCE_TTL = 45; // seconds

// python worker (heavy jobs: import, music tagging/yt/acoustid)
export const WORKER_URL = (process.env.SDY_WORKER_URL || 'http://127.0.0.1:5100').replace(/\/+$/, '');
