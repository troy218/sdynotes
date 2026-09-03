// 14.20.0 · AI 노트 도우미 — 요약 · 질문 · 개조식
//
// 왜 서버를 거치는가
//   모델 키는 돈이다. 프런트에 심으면 그대로 털린다(이 사이트는 전역 CSP 가 없다).
//   그래서 브라우저는 '/api/ai/ask' 만 알고, 키·모델·프롬프트는 전부 여기 있다.
//   translate.js 와 같은 원칙: 외부 호출은 서버, 실패는 이유와 함께 돌려준다.
//
// 왜 '공급사 체인'인가
//   무료 티어(Groq·Gemini·OpenRouter …)는 하루 한도가 금방 찬다. translate.js 가
//   Google 호스트 3개를 순회하듯, 한 공급자가 429/5xx 를 주면 다음 공급사로
//   넘어간다. 전부 막혀야 비로소 '제한' 안내가 나간다.
//
// Arena.ai 를 직접 부르지 않는 이유 (config.js 주석과 같다)
//   arena.ai 는 공개 API/임베드가 없는 소비자용 채팅·투표 사이트다(reCAPTCHA +
//   "대화가 제3자 AI 에 전달·공개될 수 있다" 약관). 계정を作って 내부 엔드포인트를
//   우회 호출하는 것은 약관 위반이고 개인 노트가 공개될 수 있어 하지 않는다.
//   '아레나 UI'가 필요하면 그건 오픈소스(lm-sys/FastChat, Apache-2.0)를 따로
//   띄우는 일이고, 이 노트 앱은 OpenAI 호환 모델 API 만 쓴다.
//
// 남용 방지 (돈이 나가는 경로라 기본으로 다 걸어 둔다)
//   · task 화이트리스트 — 임의 프롬프트 주입이 아니라 정해진 4가지 일만 시킨다
//   · 본문 길이 상한 + 잘라 보냄, 질문 길이 상한
//   · 같은 입력 재요청은 캐시로 응답 (외부 호출 0번)
//   · 동시 중복 요청은 in-flight 하나로 합친다
//   · uid(없으면 ip) 별 슬라이딩 윈도우 레이트리밋
//   · 429/5xx 는 그 '공급사만' 잠깐 쿨다운 — 그 사이엔 외부 호출을 아예 하지 않는다
import crypto from 'node:crypto';
import {
  AI_PROVIDERS, AI_MAX_TOKENS, AI_TIMEOUT_MS,
  AI_MAX_TEXT, AI_MAX_QUESTION, AI_CACHE_TTL_MS,
  AI_RATE_N, AI_RATE_WINDOW_MS, AI_COOLDOWN_MS, AI_WARM_N,
} from '../lib/config.js';
import { requireUser } from '../lib/userauth.js';

const AI_READY = AI_PROVIDERS.length > 0;
const AI_MODEL = AI_PROVIDERS[0]?.model || '';

// task → 시스템 프롬프트. 화면에 그대로 뿌릴 결과라 '형식'을 못 박는다.
export const AI_TASKS = {
  summarize: {
    label: '요약',
    system: '너는 한국어 노트 도우미다. 사용자가 준 노트 본문을 5문장 이내의 자연스러운 한국어 단락으로 요약한다. '
      + '본문에 없는 내용을 지어내지 말고, 본문이 비어 있거나 너무 짧으면 "요약할 내용이 부족해요"라고만 답한다. '
      + ' markdown·머리말·서두 인사 없이 본문만 쓴다.',
    needText: true,
  },
  bullets: {
    label: '개조식 정리',
    system: '너는 한국어 노트 도우미다. 노트 본문을 핵심만 뽑아 3~7개의 짧은 한국어 개조식 항목으로 정리한다. '
      + '각 줄은 "- "로 시작하고 한 줄은 40자 안팎으로 짧게 쓴다. 본문에 없는 내용을 지어내지 않는다.',
    needText: true,
  },
  ask: {
    label: '노트에 대해 질문',
    system: '너는 한국어 노트 도우미다. 주어진 노트 본문에만 근거해 질문에 짧고 정확하게 답한다. '
      + '본문에 근거가 없으면 "노트에는 없는 내용이에요"라고 말한다. 지어내지 않는다.',
    needText: true,
    needQuestion: true,
  },
  free: {
    label: '자유 질문',
    system: '너는 한국어 글쓰기 도우미다. 질문에 6문장 이내로 명확하게 답한다. 모르는 것은 모른다고 말한다.',
    needText: false,
  },
};

const DISABLED = 'AI 키가 아직 등록되지 않았어요 · 서버 .env 에 GEMINI_API_KEY(구글) 또는 AI_KEY 를 넣으면 알아서 켜집니다';

// ── 캐시 · in-flight ────────────────────────────────────────────────────────
const cache = new Map();      // key -> { text, at }
const inFlight = new Map();   // key -> Promise<text>
const CACHE_MAX = 200;

export function aiCacheReset() { cache.clear(); inFlight.clear(); }
export const aiCacheSize = () => cache.length;

function normText(s) {
  return String(s == null ? '' : s).replace(/\r\n/g, '\n').trim();
}

// ── 14.22.0 · 긴 노트는 '앞부분만' 보내지 않는다 ─────────────────────────────
//   예전엔 그냥 앞에서 max 자만 잘랐다. 그러면 노트가 길 때 모델은 앞부분만 보고
//   답해서 "왜 뒤에 적은 얘기는 몰라?" 가 됐다. 이제는 앞 70% + 뒤 30% 를 살리고
//   가운데만 '생략' 표시로 접는다 — 결론이 보통 뒤에 있으니 뒤를 남기는 게 낫다.
export function fitText(s, max) {
  const t = String(s == null ? '' : s);
  const lim = Math.max(1, max | 0);
  if (t.length <= lim) return { text: t, truncated: false, chars: t.length, noteChars: t.length };
  const head = Math.max(1, Math.floor(lim * 0.7));
  const tail = lim - head;
  const text = t.slice(0, head)
    + '\n\n… (긴 노트라 가운데 ' + Math.max(0, t.length - head - tail) + '자를 접었어요) …\n\n'
    + (tail > 0 ? t.slice(t.length - tail) : '');
  return { text, truncated: true, chars: head + tail, noteChars: t.length };
}

function cacheKeyOf(task, model, text, question) {
  return crypto.createHash('sha1')
    .update([task, model, text, question].join('\u0000')).digest('hex');
}

function cachePut(key, text, provider, model) {
  if (!AI_CACHE_TTL_MS) return;
  if (cache.size >= CACHE_MAX) {           // 오래된 것부터 버린다
    let oldest = null;
    for (const [k, v] of cache) if (!oldest || v.at < oldest.at) oldest = { k, at: v.at };
    if (oldest) cache.delete(oldest.k);
  }
  cache.set(key, { text, provider, model, at: Date.now() });
}

// ── 레이트리밋 ──────────────────────────────────────────────────────────────
const hits = new Map();   // key -> number[] (요청 시각)
export function aiRateReset() { hits.clear(); }

// n 을 따로 받는다 — 사용자가 누른 요청(AI_RATE_N)과 '미리 준비해 두기'
// 백그라운드 요청(AI_WARM_N)의 한도를 섞지 않으려고.
function rateHit(key, now = Date.now(), n = AI_RATE_N) {
  const arr = (hits.get(key) || []).filter((t) => now - t < AI_RATE_WINDOW_MS);
  if (arr.length >= n) {
    const retry = Math.max(1, Math.ceil((AI_RATE_WINDOW_MS - (now - arr[0])) / 1000));
    return { ok: false, retry };
  }
  arr.push(now);
  hits.set(key, arr);
  return { ok: true, retry: 0 };
}

// ── 공급사별 쿨다운 ─────────────────────────────────────────────────────────
// translate.js 의 호스트 쿨다운과 같은 발상: 429 를 맞은 '그 공급사만' 잠깐 쉰다.
// 그래서 한 곳이 한도에 걸려도 나머지 공급사는 계속 쓸 수 있다.
const cool = new Map();   // provider name -> { until, reason }
export function aiCooldownReset() { cool.clear(); }
const cooling = (name) => {
  const c = cool.get(name);
  return Boolean(c && c.until > Date.now());
};
const coolLeftSec = (name) => {
  const c = cool.get(name);
  return c ? Math.max(1, Math.ceil((c.until - Date.now()) / 1000)) : 1;
};
// 429(한도)·5xx(서버) 만 쉰다. 400/401/404 는 키·모델명 같은 설정 문제라
// 다시 때려도 결과가 같고, 다른 공급사로 넘어가도 소용이 없다.
function coolWorthy(status) { return status === 429 || status >= 500; }
function coolSet(name, status) {
  cool.set(name, { until: Date.now() + AI_COOLDOWN_MS, reason: `AI ${status}` });
}
// 아직 시도할 수 있는 공급사가 있나 (전부 쿨다운이면 '제한' 안내를 낸다)
const anyProviderReady = () => AI_PROVIDERS.some((p) => !cooling(p.name));
const earliestCoolSec = () => {
  let best = 0;
  for (const [name, c] of cool) {
    if (c.until > Date.now()) {
      const s = Math.ceil((c.until - Date.now()) / 1000);
      if (!best || s < best) best = s;
    }
  }
  return Math.max(1, best);
};

// ── 프롬프트 구성 ───────────────────────────────────────────────────────────
export function aiMessages(task, text, question) {
  const spec = AI_TASKS[task] || AI_TASKS.summarize;
  const user = [];
  if (spec.needText) {
    user.push('노트 본문:\n"""' + text + '"""');
  }
  if (spec.needQuestion) user.push('질문: ' + question);
  if (task === 'free') user.push(String(question || text || ''));
  return [
    { role: 'system', content: spec.system },
    { role: 'user', content: user.join('\n\n') },
  ];
}

// 공통 요청 본문 — 스트림이냐 아니냐만 다르다.
function providerBody(p, messages, stream) {
  return JSON.stringify({
    model: p.model,
    messages,
    temperature: 0.3,
    max_tokens: AI_MAX_TOKENS,
    stream: !!stream,
  });
}
async function callProvider(p, messages) {
  const r = await fetch(`${p.url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${p.key}`,
    },
    body: providerBody(p, messages, false),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  const raw = await r.text();
  if (!r.ok) {
    const err = new Error(`${p.name} ${r.status}`);
    err.provider = p.name;
    err.status = r.status;
    // 429/5xx 만 '한도'로 보고 그 공급사를 쉬게 한다.
    err.limited = coolWorthy(r.status);
    if (err.limited) coolSet(p.name, r.status);
    const ra = Number(r.headers.get('retry-after'));
    err.retryAfterSec = err.limited
      ? Math.max(1, Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : coolLeftSec(p.name))
      : 0;
    err.detail = raw.slice(0, 300);
    throw err;
  }
  let j;
  try { j = JSON.parse(raw); } catch { throw new Error('AI 응답 형식'); }
  const out = j?.choices?.[0]?.message?.content;
  const text = typeof out === 'string' ? out.trim() : '';
  if (!text) { const e = new Error('AI 빈 응답'); e.provider = p.name; throw e; }
  return text;
}

// ── 14.22.0 · 스트리밍 (말하는 대로 흘려 보내기) ────────────────────────────
//   답이 다 끝날 때까지 기다리면 "멈췄나?" 로 보이고, 중간에 끊기면 앞부분만
//   남는다. 모델이 만드는 대로 SSE 로 조각을 흘려 보내면 화면이 말하는 것처럼
//   따라온다. 키·프롬프트·한도·캐시 규칙은 비스트림과 완전히 같다.
async function callProviderStream(p, messages, onDelta, signal) {
  const r = await fetch(`${p.url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${p.key}`,
      Accept: 'text/event-stream',
    },
    body: providerBody(p, messages, true),
    signal,
  });
  if (!r.ok) {
    const raw = await r.text().catch(() => '');
    const err = new Error(`${p.name} ${r.status}`);
    err.provider = p.name;
    err.status = r.status;
    err.limited = coolWorthy(r.status);
    if (err.limited) coolSet(p.name, r.status);
    const ra = Number(r.headers.get('retry-after'));
    err.retryAfterSec = err.limited
      ? Math.max(1, Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : coolLeftSec(p.name))
      : 0;
    err.detail = String(raw).slice(0, 300);
    throw err;
  }
  // SSE 를 못 주는 공급사 → 뒤에서 비스트림으로 한 방에 받는다.
  // (stream:true 를 무시하고 JSON 을 주는 곳이 은근히 있다)
  const ctype = String(r.headers.get('content-type') || '').toLowerCase();
  if (!r.body || (ctype && ctype.indexOf('application/json') >= 0)) {
    const e = new Error(`${p.name} 스트림 미지원`);
    e.provider = p.name; e.noStream = true;
    throw e;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = ''; let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    // 버퍼에 남은 마지막 줄은 다음 조각을 기다린다(줄이 잘려 올 수 있다)
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line || line[0] === ':') continue;
      if (line.indexOf('data:') !== 0) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === '[DONE]') { buf = ''; break; }
      let j;
      try { j = JSON.parse(payload); } catch { continue; }
      // OpenAI 호환: choices[0].delta.content (어떤 곳은 message.content 로 준다)
      const d = (j && j.choices && j.choices[0])
        ? ((j.choices[0].delta && j.choices[0].delta.content)
          || (j.choices[0].message && j.choices[0].message.content) || '')
        : '';
      if (typeof d === 'string' && d) { out += d; onDelta(d); }
    }
  }
  const text = out.trim();
  // 조각이 하나도 안 왔으면 '말하기 실패' 로 보고, 한 방 응답으로 다시 시도한다.
  if (!text) { const e = new Error('AI 빈 응답'); e.provider = p.name; e.noStream = true; throw e; }
  return text;
}

// 스트림 체인 — 조각이 이미 나가기 시작했으면 다른 공급사로 갈아타지 않는다
// (앞부분이 두 번 붙어 나오는 게 더 나쁘다).
async function callChainStream(messages, onDelta, signal, tried = []) {
  let lastErr = null;
  let limitedOnly = true;
  let emitted = false;
  const emit = (d) => { emitted = true; onDelta(d); };
  for (const p of AI_PROVIDERS) {
    if (cooling(p.name)) {
      lastErr = lastErr || Object.assign(new Error(`${p.name} 쿨다운`), { limited: true, provider: p.name });
      continue;
    }
    try {
      const text = await callProviderStream(p, messages, emit, signal);
      cool.delete(p.name);
      return { text, provider: p.name, model: p.model };
    } catch (e) {
      lastErr = e;
      tried.push(`${p.name}:${e.status || e.message}`);
      if (!e.limited) limitedOnly = false;
      if (emitted) throw e;                       // 이미 말하기 시작 → 여기서 끝
      if (e.noStream) {                           // 스트림을 못 주면 그냥 한 번에 받는다
        try {
          const text = await callProvider(p, messages);
          cool.delete(p.name);
          emit(text);
          return { text, provider: p.name, model: p.model };
        } catch (e2) {
          lastErr = e2;
          tried.push(`${p.name}:${e2.status || e2.message}`);
          if (!e2.limited) limitedOnly = false;
          continue;
        }
      }
    }
  }
  const err = lastErr || new Error('쓸 수 있는 AI 공급사가 없어요');
  err.limited = limitedOnly;
  err.retryAfterSec = err.limited ? earliestCoolSec() : 0;
  err.tried = tried;
  throw err;
}

// 체인 순회 — 살아 있는 공급사를 순서대로 tries 하다가 하나라도 성공하면 끝.
async function callChain(messages, tried = []) {
  let lastErr = null;
  let limitedOnly = true;
  for (const p of AI_PROVIDERS) {
    if (cooling(p.name)) {                       // 방금 429 를 맞은 곳은 건너뛴다
      lastErr = lastErr || Object.assign(new Error(`${p.name} 쿨다운`), { limited: true, provider: p.name });
      continue;
    }
    try {
      const text = await callProvider(p, messages);
      cool.delete(p.name);
      return { text, provider: p.name, model: p.model };
    } catch (e) {
      lastErr = e;
      tried.push(`${p.name}:${e.status || e.message}`);
      if (!e.limited) limitedOnly = false;
      // 401/403 은 키 문제 — 뒤에 같은 키를 쓰는 곳이 없다면 계속 시도해 볼 가치는
      // 있지만, 대부분 설정 오류라 로그에 남기고 다음 공급사로 넘긴다.
    }
  }
  const err = lastErr || new Error('쓸 수 있는 AI 공급사가 없어요');
  err.limited = limitedOnly;
  err.retryAfterSec = err.limited ? earliestCoolSec() : 0;
  err.tried = tried;
  throw err;
}

// 캐시 키는 '체인 전체' 기준 — 공급사가 바뀌어도 같은 질문은 같은 답으로 친다.
function aiKeyFor(task, text, question) {
  const chainId = AI_PROVIDERS.map((p) => `${p.name}/${p.model}`).join('+');
  return cacheKeyOf(task, chainId, text, question);
}
const aiCacheGet = (key) => {
  if (!AI_CACHE_TTL_MS) return null;
  const hit = cache.get(key);
  return (hit && Date.now() - hit.at < AI_CACHE_TTL_MS) ? hit : null;
};

async function aiCore(task, text, question) {
  const key = aiKeyFor(task, text, question);
  const hit = aiCacheGet(key);
  if (hit) return { text: hit.text, cached: true, provider: hit.provider, model: hit.model };
  const pending = inFlight.get(key);
  if (pending) {
    const got = await pending;
    return { text: got.text, cached: true, provider: got.provider, model: got.model };
  }

  const p = (async () => {
    const out = await callChain(aiMessages(task, text, question));
    cachePut(key, out.text, out.provider, out.model);
    return out;
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, p);
  const got = await p;
  return { text: got.text, cached: false, provider: got.provider, model: got.model };
}

// ── 실패 원인 힌트 ──────────────────────────────────────────────────────────
// 401/404 는 '한도'가 아니라 설정 문제다. 같은 문구만 내보내면 원인을 못 찾으니
// 어디를 봐야 하는지만 짚어 준다 (키·본문 내용은 절대 싣지 않는다).
export function aiHintFor(e) {
  if (!e) return '';
  const status = Number(e.status || 0);
  const who = e.provider ? `${e.provider} · ` : '';
  if (status === 401 || status === 403) {
    return `${who}키가 거부됐어요(401) · Google AI Studio 에서 만든 API 키가 맞는지, `
      + `.env 의 키 이름이 맞는지 확인하세요 (Vertex AI 서비스계정 키는 여기서 안 됩니다)`;
  }
  if (status === 404) {
    return `${who}모델을 못 찾았어요(404) · curl "<base>/models" 로 지금 키에서 쓸 수 있는 `
      + `모델명을 확인하고 <공급사>_MODEL 로 지정하세요`;
  }
  if (status === 400) {
    return `${who}요청이 거부됐어요(400) · 본문이 그 모델의 한도를 넘었을 수 있어요 (AI_MAX_TEXT 를 낮춰 보세요)`;
  }
  return '';
}

export function registerAi(app) {
  // 켜져 있는지·어떤 공급사/모델인지 알려 준다. 키는 절대 내보내지 않는다.
  app.get('/api/ai/status', async (req, reply) => reply.send({
    ok: true,
    enabled: AI_READY,
    model: AI_READY ? AI_MODEL : '',
    providers: AI_PROVIDERS.map((p) => ({ name: p.name, model: p.model })),
    tasks: Object.entries(AI_TASKS).map(([id, t]) => ({ id, label: t.label })),
    error: AI_READY ? '' : DISABLED,
  }));

  // ── 요청 검사 — 스트림/비스트림/미리 준비(warm) 가 전부 같은 문을 지나간다 ──
  //   반환: { err: {status, body} } 이면 그대로 보내고, 아니면 job 이다.
  function prepare(req, b) {
    const task = String(b.task || '').trim();
    const spec = AI_TASKS[task];
    if (!spec) {
      return { err: { status: 400, body: { ok: false, error: '할 수 없는 일이에요', allowed: Object.keys(AI_TASKS) } } };
    }
    if (!AI_READY) return { err: { status: 503, body: { ok: false, error: DISABLED } } };

    let text = normText(b.text);
    const question = String(b.question == null ? '' : b.question).trim().slice(0, AI_MAX_QUESTION);
    if (spec.needText && !text) return { err: { status: 400, body: { ok: false, error: '빈 노트예요 · 먼저 노트에 글을 적어 주세요' } } };
    if (spec.needQuestion && !question) return { err: { status: 400, body: { ok: false, error: '질문을 적어 주세요' } } };
    if (task === 'free' && !question) return { err: { status: 400, body: { ok: false, error: '질문을 적어 주세요' } } };

    // 14.22.0 · 앞 70% + 뒤 30% — 뒤에 적은 결론도 같이 보낸다
    const fit = fitText(text, AI_MAX_TEXT);
    text = fit.text;

    const u = requireUser(req);
    const rlKey = u ? `uid:${u.uid}` : `ip:${req.ip || 'unknown'}`;
    // warm = 누군가 누르기 '전에' 미리 답을 만들어 두는 요청(요약·개조식).
    //   직접 누른 요청과 한도를 섞지 않게 다른 창(AI_WARM_N)으로 센다.
    const warm = b.warm === true && task !== 'free';
    if (warm && AI_WARM_N === 0) {
      return { err: { status: 200, body: { ok: false, skipped: true, error: '미리 준비 꺼짐' } } };
    }
    const rl = rateHit(warm ? `warm:${rlKey}` : rlKey, Date.now(), warm ? AI_WARM_N : AI_RATE_N);
    if (!rl.ok) {
      return {
        err: {
          status: 429,
          body: {
            ok: false, limited: true, retry_after: rl.retry,
            error: `잠시 뒤에 다시 시도해 주세요 · ${warm ? AI_WARM_N : AI_RATE_N}번/${Math.round(AI_RATE_WINDOW_MS / 1000)}초`,
          },
        },
      };
    }
    return { job: { task, spec, text, question, fit, warm, key: aiKeyFor(task, text, question) } };
  }

  // 실패를 JSON 으로 — 스트림이든 아니든 같은 문구·같은 코드로 떨어진다.
  function failBody(e) {
    const limited = Boolean(e && e.limited);
    const retry = limited ? Number((e && e.retryAfterSec) || earliestCoolSec()) : 0;
    return {
      status: limited ? 429 : 502,
      body: {
        ok: false,
        limited,
        retry_after: retry,
        error: limited
          ? `AI 사용량이 잠시 찼어요 · ${retry}초 뒤 다시 시도해 주세요`
          : 'AI에 닿지 못했어요 · 잠시 뒤 다시 시도해 주세요',
        hint: limited ? '' : aiHintFor(e),
      },
    };
  }

  // ── 스트리밍 응답 (SSE) ────────────────────────────────────────────────────
  //   event: meta → delta(여러 개) → done | error
  //   캐시에 있으면 delta 한 방에 보내고 곧 done — '누르자마자' 나오는 그 경로다.
  function streamReply(req, reply, job) {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let gone = false;
    res.on('close', () => { gone = true; });
    const send = (event, data) => {
      if (gone || res.writableEnded) return;
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 끊긴 소켓 */ }
    };
    const base = { truncated: job.fit.truncated, chars: job.fit.chars, note_chars: job.fit.noteChars };
    const finish = (got) => {
      send('done', Object.assign({}, base, {
        text: got.text, provider: got.provider || '', model: got.model || AI_MODEL,
        cached: !!got.cached, task: job.task,
      }));
      try { res.end(); } catch { /* noop */ }
    };

    const hit = aiCacheGet(job.key);
    if (hit) {
      send('meta', Object.assign({}, base, { cached: true }));
      if (hit.text) send('delta', { t: hit.text });
      finish({ text: hit.text, provider: hit.provider || '', model: hit.model || AI_MODEL, cached: true });
      return;
    }
    // 이미 나가 있는 요청(내가 누른 것/미리 준비)이 있으면 그걸 기다렸다 흘려 보낸다.
    const pending = inFlight.get(job.key);
    if (pending) {
      send('meta', Object.assign({}, base, { cached: true }));
      pending.then((got) => {
        if (got.text) send('delta', { t: got.text });
        finish({ text: got.text, provider: got.provider || '', model: got.model || AI_MODEL, cached: true });
      }).catch((e) => {
        const f = failBody(e);
        send('error', f.body);
        try { res.end(); } catch { /* noop */ }
      });
      return;
    }
    if (!anyProviderReady()) {
      send('error', {
        ok: false, limited: true, retry_after: earliestCoolSec(),
        error: `AI 요청이 잠시 제한됐어요 · ${earliestCoolSec()}초 뒤 다시 시도해 주세요`,
      });
      try { res.end(); } catch { /* noop */ }
      return;
    }

    send('meta', Object.assign({}, base, { cached: false }));
    const ac = new AbortController();
    const timer = setTimeout(() => { try { ac.abort(); } catch { /* noop */ } }, AI_TIMEOUT_MS);
    const stop = () => { try { ac.abort(); } catch { /* noop */ } };
    res.on('close', stop);

    const run = (async () => {
      const out = await callChainStream(
        aiMessages(job.task, job.text, job.question),
        (d) => send('delta', { t: d }),
        ac.signal,
      );
      cachePut(job.key, out.text, out.provider, out.model);
      return out;
    })();
    inFlight.set(job.key, run);
    // 정리·마무리를 '따로' 붙인다 — 한 줄로 붙이면 실패 때 처리 안 된
    // 거절(unhandled rejection) 이 생겨 프로세스가 죽을 수 있다.
    const cleanup = () => { inFlight.delete(job.key); clearTimeout(timer); };
    run.then(cleanup, cleanup);
    run.then(finish).catch((e) => {
      req.log?.error?.({ err: e, task: job.task, tried: e && e.tried }, 'ai stream failed');
      const f = failBody(e);
      send('error', f.body);
      try { res.end(); } catch { /* noop */ }
    });
  }

  app.post('/api/ai/ask', async (req, reply) => {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const pre = prepare(req, b);
    if (pre.err) return reply.code(pre.err.status).send(pre.err.body);
    const job = pre.job;

    // 14.22.0 · stream:true 면 말하는 대로 흘려 보낸다(SSE).
    //   stream 이 없거나 못 읽는 환경이면 예전처럼 JSON 한 방으로 떨어진다.
    if (b.stream === true) { streamReply(req, reply, job); return; }

    if (!anyProviderReady()) {
      // 모든 공급사가 쉬는 중. 그래도 캐시에 있으면 그걸로 답한다(외부 호출 0번).
      const hit = aiCacheGet(job.key);
      if (hit) {
        return reply.send({
          ok: true, task: job.task, text: hit.text, model: hit.model || AI_MODEL,
          provider: hit.provider || '', cached: true,
          truncated: job.fit.truncated, chars: job.fit.chars, note_chars: job.fit.noteChars,
        });
      }
      return reply.code(429).send({
        ok: false, limited: true, retry_after: earliestCoolSec(),
        error: `AI 요청이 잠시 제한됐어요 · ${earliestCoolSec()}초 뒤 다시 시도해 주세요`,
      });
    }

    try {
      const { text: out, cached, provider, model } = await aiCore(job.task, job.text, job.question);
      return reply.send({
        ok: true, task: job.task, text: out, model: model || AI_MODEL, provider: provider || '',
        cached, truncated: job.fit.truncated, chars: job.fit.chars, note_chars: job.fit.noteChars,
      });
    } catch (e) {
      const f = failBody(e);
      req.log?.error?.({ err: e, task: job.task, tried: e && e.tried }, 'ai ask failed');
      return reply.code(f.status).send(f.body);
    }
  });
}
