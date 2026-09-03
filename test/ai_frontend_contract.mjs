/* 14.23.0 · 노트 해돌이 계약 — 검색창 · 개요 버튼 · 말풍선 · 대화기록
   ---------------------------------------------------------------------------
   예전(✨ 아이콘 버튼 + 뜨는 창)과 달라진 계약:
     1) 소스 — #aiFab/#aiPanel/할일칩(요약·개조식·노트질문·자유질문 고르기)/
        보내기 버튼이 없고, #noteOtter 옆 한 줄 검색창(#aiAsk > #aiQ) +
        그 바로 위 개요 버튼(#aiOutline) 만 있다. 서버 task 도 outline/chat 둘뿐.
     2) 런타임(jsdom) — Enter 로 바로 묻고(task=chat), 답은 해돌이 말풍선
        (#aiSay)에 스트리밍되고, [[note]]/[[free]] 표식은 '노트 질문/자유 질문'
        딱지(#aiKind)가 되고, 말풍선은 닫기(#aiSayX) 전까지 계속 떠 있고,
        해돌이(#noteOtter)를 누르면 대화기록(#aiHist)이 열린다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import jsdom from 'jsdom';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(REPO, 'sdynotes.js'), 'utf8');
const css = fs.readFileSync(path.join(REPO, 'sdynotes.css'), 'utf8');
const html = fs.readFileSync(path.join(REPO, 'sdynotes.html'), 'utf8');
const srv = fs.readFileSync(path.join(REPO, 'server/src/routes/ai.js'), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

// ── 1) 소스 계약 ─────────────────────────────────────────────────────────────
check('서버: task 화이트리스트 2종(outline/chat)',
  /^  outline: \{/m.test(srv) && /^  chat: \{/m.test(srv)
  && !/^  summarize: \{/m.test(srv) && !/^  bullets: \{/m.test(srv)
  && !/^  ask: \{/m.test(srv) && !/^  free: \{/m.test(srv));
check('서버: chat 프롬프트가 해돌이 판단 표식([[note]]/[[free]])을 첫 줄에 요구한다',
  /\[\[note\]\]/.test(srv) && /\[\[free\]\]/.test(srv));
check('서버: chat 은 노트가 비어 있어도 된다(needText:false) · 질문은 필요하다',
  /chat: \{[\s\S]*?needText: false,[\s\S]*?needQuestion: true,/.test(srv));
check('서버: 미리 준비(warm)는 개요 정리(outline)만 받는다',
  /b\.warm === true && task === 'outline'/.test(srv));
check('서버: 키는 Authorization 헤더로만 나간다',
  /Authorization: `Bearer \$\{p\.key\}`/.test(srv));
check('서버: 같은 입력은 캐시로 답한다', /cachePut\(key, out\.text, out\.provider, out\.model\)/.test(srv) && /cached: true/.test(srv));
check('서버: 429/5xx 만 쿨다운을 건다', /status === 429 \|\| status >= 500/.test(srv));
check('서버: stream:true 면 SSE(text/event-stream) 로 조각을 흘려 본다',
  /text\/event-stream/.test(srv) && /send\('delta'/.test(srv) && /b\.stream === true/.test(srv));
check('서버: 긴 노트는 앞 70% + 뒤 30% 를 살린다',
  /function fitText/.test(srv) && /Math\.floor\(lim \* 0\.7\)/.test(srv));

check('프런트: 키를 직접 들고 있지 않다 (sk- 리터럴 없음)', !/sk-[A-Za-z0-9_\-]{8,}/.test(js));
check('프런트: AI 는 자기 엔드포인트(/api/ai/ask)만 부른다', /fetch\('\/api\/ai\/ask'/.test(js));
check('프런트: 상태 조회로 켜짐/모델을 확인한다', /fetch\('\/api\/ai\/status'/.test(js));
check('프런트: 노트 글은 bridge 로만 꺼낸다 (문서 구조를 직접 안 건드림)',
  /window\.__sdyAiBridge\.text\(/.test(js));
check('프런트: 예전 할 일(summarize/bullets/ask/free 고르기)이 없다',
  !/'summarize'/.test(js) && !/'bullets'/.test(js) && !/sdyAiToggle/.test(js));
check('프런트: 보내기 버튼이 없다 — Enter 만 누르면 바로 묻는다(한글 조합 중 제외)',
  !/aiGo/.test(js)
  && /e\.target\.id!=='aiQ'/.test(js) && /e\.isComposing\|\|e\.keyCode===229/.test(js)
  && /e\.preventDefault\(\);\s*window\.sdyAiRun\(\);/.test(js));
check('프런트: 해돌이 판단 표식을 파싱해 딱지로 단다',
  /function parseChat\(/.test(js) && /\[\[note\]\]/.test(js)
  && /노트 질문/.test(js) && /자유 질문/.test(js));
check('프런트: 말풍선은 사용자가 닫기 전까지 유지된다 (닫기는 sdyAiSayClose/노트 닫힘뿐)',
  (js.match(/sayHide\(\)/g) || []).length === 3)  // 정의 1 + 호출 2;
check('프런트: 대화기록은 해돌이 클릭으로 열고 최대 40개다',
  /window\.sdyAiHistToggle/.test(js) && /HIST_MAX=40/.test(js)
  && /no\.addEventListener\('click',function\(\)\{ window\.sdyAiHistToggle\(\); \}\)/.test(js));
check('프런트: 개요 정리는 미리 준비해 둔 답을 먼저 찾는다',
  /warmGet\(txt\)/.test(js) && /body:JSON\.stringify\(\{task:'outline',text:txt,question:'',warm:true\}\)/.test(js));
check('프런트: 같은 요청을 두 번 보내지 않는다 (실행 중 가드)', /if\(ctl\) return;/.test(js));
check('프런트: 실행 중 멈출 수 있다 (AbortController)', /new AbortController\(\)/.test(js) && /ctl\.abort\(\)/.test(js));
check('프런트: 로그인 토큰을 x-sdy-auth 로 본다', /'x-sdy-auth':token\(\)/.test(js));
check('프런트: 스트림 조각이 오는 대로 말풍선에 붙인다', /readSSE\(r,function\(d\)\{[\s\S]*?acc\+=d;/.test(js));

check('HTML: 아이콘 버튼·뜨는 창·할일칩·보내기 버튼이 사라졌다',
  !/id="aiFab"/.test(html) && !/id="aiPanel"/.test(html) && !/id="aiTasks"/.test(html)
  && !/id="aiGo"/.test(html) && !/id="aiScope"/.test(html));
check('HTML: 해돌이 옆 검색창(#aiAsk > #aiQ)이 있다',
  /id="aiAsk"/.test(html) && /id="aiQ"/.test(html));
check('HTML: 개요 버튼(#aiOutline)이 질문칸(#aiQ)보다 먼저(위)에 있다',
  html.indexOf('id="aiOutline"') >= 0 && html.indexOf('id="aiOutline"') < html.indexOf('id="aiQ"'));
check('HTML: 검색창은 #noteOtter 옆(같은 편집기 구역)에 붙어 있다',
  html.indexOf('id="noteOtter"') < html.indexOf('id="aiAsk"')
  && html.indexOf('id="aiAsk"') < html.indexOf('id="drawToolbar"'));
check('HTML: 말풍선(#aiSay)에 이름·딱지·닫기·멈추기·복사가 있다',
  /id="aiSay"/.test(html) && /id="aiKind"/.test(html) && /id="aiSayX"/.test(html)
  && /id="aiStop"/.test(html) && /id="aiCopy"/.test(html) && /id="aiOut"/.test(html));
check('HTML: 대화기록(#aiHist > #aiHistList)이 있다',
  /id="aiHist"/.test(html) && /id="aiHistList"/.test(html));
check('HTML: placeholder 가 Enter 로 묻는다고 안내한다', /placeholder="[^"]*\(Enter\)"/.test(html));

check('CSS: 말풍선에 해돌이 쪽(아래)을 가리키는 꼬리가 있다', /\.ai-say::after\{[^}]*bottom:-9px/.test(css));
check('CSS: 말풍선은 유리 토큰(var(--g-*))으로만 칠한다',
  /\.ai-say\{[^}]*background:var\(--g-fill-strong\)/.test(css)
  && !/\.ai-say\{[^}]*#[0-9a-fA-F]{3,6}/.test(css));
check('CSS: 검색창은 한 줄 필(pill) 모양이다', /\.ai-askbar-field\{[^}]*border-radius:999px/.test(css));
check('CSS: 종류 딱지(.ai-kind) 스타일이 있다', /\.ai-kind\{/.test(css));
check('CSS: 좁은 화면에서는 말풍선이 좌우 가득', /@media \(max-width:640px\)\{[\s\S]*\.ai-say\{left:10px;right:10px;/.test(css));
check('CSS: 모바일 전용 최종 블록(파일 맨 끝)을 침범하지 않는다',
  css.indexOf('14.23.0 · 노트 해돌이') < css.indexOf('17.0 · 모바일 전용 최종 레이아웃'));

// ── 2) 런타임 (jsdom) ────────────────────────────────────────────────────────
// 프런트 AI 블록만 잘라 실행한다 (27k 줄 전체는 다른 계약이 다룬다).
const frag = html.slice(html.indexOf('<div id="aiAsk"'), html.indexOf('<div id="drawToolbar"'));
assert.ok(frag.includes('id="aiHist"'), 'HTML 조각(aiAsk~aiHist)을 찾는다');
const dom = new jsdom.JSDOM(
  `<!DOCTYPE html><html><body><div id="editorView"></div><div id="noteOtter"><div id="noteOtterBubble"></div></div>${frag}</body></html>`,
  { runScripts: 'outside-only', url: 'http://localhost/' },
);
const w = dom.window;
const $ = (id) => w.document.getElementById(id);

const calls = [];
let askRes = null;                     // (url, body) -> 응답 객체 형태
const statusBody = { ok: true, enabled: true, model: 'test-model', tasks: [],
  providers: [{ name: 'groq', model: 'test-model' }, { name: 'gemini', model: 'gem' }] };
const fakeRes = (status, body) => ({ status, json: () => Promise.resolve(body) });
w.fetch = (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body || null,
    auth: (opts.headers && opts.headers['x-sdy-auth']) || '' });
  if (String(url) === '/api/ai/status') return Promise.resolve(fakeRes(200, statusBody));
  return Promise.resolve(askRes(String(url), JSON.parse(opts.body || '{}')));
};
w.__sdyAuthState = { token: 'tok-123', user: {} };
const LONG = '광합성은 잎의 엽록체에서 일어나는 반응이다. 빛 에너지로 물과 이산화탄소에서 포도당을 만든다.';
w.__sdyAiBridge = { text: () => LONG, title: () => '생물 노트' };

const mark = js.lastIndexOf('14.23.0 · 노트 해돌이');
const aiBlock = js.slice(js.lastIndexOf('/*', mark));
assert.ok(mark > 0 && aiBlock.startsWith('/*') && aiBlock.includes('sdyAiRun'),
  'AI 블록을 찾아 실행한다');
w.eval(aiBlock);

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
await tick(50); await flush();

// ── 2-1) 부팅: 상태 확인 + 노트 밖에서는 미리 준비를 하지 않는다 ──
check('런타임: 부팅하면 상태 조회를 한다', calls.some((c) => c.url === '/api/ai/status'));
check('런타임: 켜짐이면 검색창 점(title)에 모델이 뜬다',
  /AI 켜짐 · test-model/.test($('aiDot').title), $('aiDot').title);
check('런타임: 검색창은 떠 있고 처음엔 말풍선·기록이 닫혀 있다',
  Boolean($('aiAsk')) && $('aiSay').hidden === true && $('aiHist').hidden === true);
w.sdyAiWarmNow();
await tick(30); await flush();
check('런타임: 노트 밖(홈)에서는 개요를 미리 준비하지 않는다',
  calls.filter((c) => c.url === '/api/ai/ask').length === 0);

// 노트에 들어간다
$('editorView').classList.add('open');
await tick(60); await flush();

// ── 2-2) '개요 정리' — 노트를 열면 미리 준비해 두고, 누르면 바로 나온다 ──
askRes = () => fakeRes(200, { ok: true, text: '1. 광합성\n  - 엽록체에서 일어난다', provider: 'groq', model: 'test-model', cached: false });
calls.length = 0;
w.sdyAiWarmNow();                       // 노트를 여는 순간 하는 그 호출을 지금 바로
await tick(50); await flush();
const warmCalls = calls.filter((c) => c.body && /"warm":true/.test(c.body));
check('런타임: 미리 준비는 개요 정리 하나만 warm:true 로 부른다',
  warmCalls.length === 1 && /"task":"outline"/.test(warmCalls[0].body), warmCalls.length);
check('런타임: 준비가 되면 개요 버튼이 ready 로 빛난다',
  $('aiOutline').classList.contains('ready') === true);
check('런타임: 준비된 줄(title로) 알려 준다',
  /미리 준비해 뒀어요/.test($('aiOutline').title), $('aiOutline').title);
calls.length = 0;
w.sdyAiOutline();                       // 이제 버튼을 누른다
await tick(30); await flush();
check('런타임: 준비된 개요는 서버를 다시 부르지 않고 바로 나온다',
  calls.length === 0 && $('aiSay').hidden === false
  && $('aiOut').textContent === '1. 광합성\n  - 엽록체에서 일어난다', calls.length);
check('런타임: 개요 답에는 개요 딱지가 붙는다',
  $('aiKind').hidden === false && $('aiKind').textContent === '개요', $('aiKind').textContent);
check('런타임: 준비된 답임을 meta 로 알려 준다',
  /미리 준비해 둔 답/.test($('aiMeta').textContent), $('aiMeta').textContent);
check('런타임: 답이 있으면 복사 버튼이 보인다', $('aiCopy').hidden === false);

// ── 2-3) 검색창 Enter = 바로 묻기 (스트리밍 + 노트 질문 판단) ──
const sse = (parts, done) => {
  const evs = parts.map((t) => ({ e: 'delta', d: { t } }))
    .concat([{ e: 'done', d: done }]);
  const raw = evs.map((x) => `event: ${x.e}\ndata: ${JSON.stringify(x.d)}\n\n`).join('');
  const bytes = new TextEncoder().encode(raw);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7));
  let idx = 0;
  return {
    status: 200,
    headers: { get: () => 'text/event-stream; charset=utf-8' },
    body: { getReader: () => ({ read: () => {
      if (idx >= chunks.length) return Promise.resolve({ done: true });
      const v = chunks[idx++];
      return new Promise((r) => setTimeout(() => r({ done: false, value: v }), 3));
    } }) },
  };
};
const FULL1 = '엽록체에서 일어나요';
w.sdyAiWarmReset();
w.__sdyAiBridge = { text: () => LONG, title: () => '생물 노트' };
askRes = (url, b) => {
  if (b.task === 'chat') return sse(['[[no', 'te]]\n엽록', '체에서 일', '어나요'],
    { text: '[[note]]\n' + FULL1, provider: 'groq', model: 'test-model', cached: false, truncated: false });
  return fakeRes(200, { ok: true, text: '??', provider: 'groq', model: 'test-model' });
};
calls.length = 0;
$('aiQ').value = '어디서 일어나?';
$('aiQ').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await tick(20); await flush();
check('런타임: Enter 한 번으로 /api/ai/ask 를 POST 로 부른다',
  calls.length === 1 && calls[0].method === 'POST');
{
  const b = JSON.parse(calls[0].body);
  check('런타임: 질문은 task=chat 으로 본다 (노트/자유 구분은 서버·해돌이 몫)',
    b.task === 'chat' && b.question === '어디서 일어나?' && b.stream === true);
  check('런타임: 노트 본문을 함께 본다', b.text === LONG);
}
check('런타임: 토큰을 헤드로 본다', calls[0].auth === 'tok-123');
check('런타임: 본 질문은 검색창에서 지워진다', $('aiQ').value === '');
await tick(80);                          // 조각이 흘러오는 '중간'
check('런타임: 표식이 찢어져 와도 중간에 [[ 가 화면에 새지 않는다',
  $('aiOut').textContent.indexOf('[[') < 0, $('aiOut').textContent);
check('런타임: 답이 되는 중간에도 노트 질문 딱지가 먼저 붙는다',
  $('aiKind').hidden === false && $('aiKind').textContent === '노트 질문', $('aiKind').textContent);
check('런타임: 말하는 중에는 멈추기 버튼이 보인다', $('aiStop').hidden === false);
await tick(400); await flush();
check('런타임: 다 말하면 표식 없는 온전한 답이 남는다', $('aiOut').textContent === FULL1,
  $('aiOut').textContent);
check('런타임: 다 말하면 멈추기가 숨고 복사가 보인다',
  $('aiStop').hidden === true && $('aiCopy').hidden === false);
check('런타임: 누가 답했는지와 소요시간을 남긴다',
  /groq · test-model/.test($('aiMeta').textContent) && /초/.test($('aiMeta').textContent),
  $('aiMeta').textContent);

// ── 2-4) 말풍선은 닫기 전까지 계속 떠 있다 ──
await tick(200); await flush();
check('런타임: 시간이 지나도 말풍선이 저절로 접히지 않는다', $('aiSay').hidden === false);

// ── 2-5) 자유 질문 → 딱지가 '자유 질문' 으로 바뀐다 ──
askRes = (url, b) => fakeRes(200, { ok: true, text: '[[free]]\n날씨는 노트에 없어서 몰라요',
  provider: 'gemini', model: 'gem', cached: false, truncated: false });
calls.length = 0;
$('aiQ').value = '내일 날씨 어때?';
$('aiQ').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await tick(60); await flush();
check('런타임: 해돌이가 자유 질문이라 판단하면 딱지가 자유 질문이다',
  $('aiKind').hidden === false && $('aiKind').textContent === '자유 질문', $('aiKind').textContent);
check('런타임: 답에서 표식은 떼고 보여 준다',
  $('aiOut').textContent === '날씨는 노트에 없어서 몰라요', $('aiOut').textContent);

// 표식 없는 답(이상한 모델) — 딱지 없이 그대로
askRes = () => fakeRes(200, { ok: true, text: '그냥 평범한 답', provider: 'gemini', model: 'gem' });
$('aiQ').value = '표식 없는 답';
w.sdyAiRun();
await tick(60); await flush();
check('런타임: 표식이 없으면 딱지 없이 답만 보여 준다',
  $('aiKind').hidden === true && $('aiOut').textContent === '그냥 평범한 답', $('aiOut').textContent);

// 빈 노트에서 질문 — chat 은 본문 없이 본다(서버가 자유 질문으로 판단)
w.__sdyAiBridge = { text: () => '', title: () => '' };
calls.length = 0;
$('aiQ').value = '빈 노트 질문';
w.sdyAiRun();
await tick(60); await flush();
{
  const b = JSON.parse(calls[0].body);
  check('런타임: 노트가 비어 있어도 질문은 간다 (chat 은 needText 가 아니다)',
    b.task === 'chat' && b.text === '' && b.question === '빈 노트 질문');
}
w.__sdyAiBridge = { text: () => LONG, title: () => '생물 노트' };

// ── 2-6) 보내기 없는 UX 디테일 ──
calls.length = 0;
$('aiQ').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await tick(30);
check('런타임: 빈 검색창 Enter 는 서버를 부르지 않는다 (혼잣말만)', calls.length === 0, calls.length);
check('런타임: 빈 Enter 에는 작은 혼잣말 말풍선으로 살짝 알려 준다',
  /적어/.test($('noteOtterBubble').textContent), $('noteOtterBubble').textContent);
calls.length = 0;
$('aiQ').value = '조합중';
$('aiQ').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
await tick(30);
check('런타임: 한글 조합 중 Enter 는 보내지 않는다',
  calls.length === 0 && $('aiQ').value === '조합중', calls.length);
$('aiQ').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
await tick(30);
check('런타임: Shift+Enter 도 보내지 않는다', calls.length === 0);
$('aiQ').value = '';

// ── 2-7) 대화기록 — 해돌이를 누르면 열리고, 고륵면 말풍선으로 다시 본다 ──
$('aiSayX').dispatchEvent(new w.Event('click', { bubbles: true }));
// (inline onclick 은 jsdom 에서 안 돌므로 직접 부른다)
w.sdyAiSayClose();
check('런타임: 닫기를 눌러야 말풍선이 접힌다', $('aiSay').hidden === true);
$('noteOtter').dispatchEvent(new w.Event('click', { bubbles: true }));
await tick(30);
check('런타임: 해돌이를 누르면 대화기록이 열린다', $('aiHist').hidden === false);
{
  const items = w.document.querySelectorAll('.ai-hist-item');
  check('런타임: 나눈 이야기가 최신순으로 쌓인다 (개요+질문들)',
    items.length >= 4, items.length);
  check('런타임: 최신 이야기가 맨 위에 온다',
    /빈 노트 질문/.test(items[0].textContent), items[0].textContent.slice(0, 40));
  check('런타임: 기록에 종류 딱지가 있다',
    w.document.querySelectorAll('.ai-hist-item .ai-kind').length >= 2
    && [...w.document.querySelectorAll('.ai-hist-item .ai-kind')].some((k) => /자유 질문/.test(k.textContent)));
  // '날씨' 줄을 고륵면 그 답이 말풍선에 다시 뜬다
  let target = null;
  w.document.querySelectorAll('.ai-hist-item').forEach((el) => {
    if (!target && /날씨 어때/.test(el.textContent)) target = el;
  });
  assert.ok(target, '기록에서 날씨 줄을 찾는다');
  target.dispatchEvent(new w.Event('click', { bubbles: true }));
  await tick(30);
  check('런타임: 기록을 고륵면 말풍선으로 다시 보여 준다',
    $('aiSay').hidden === false && /날씨는 노트에 없어서 몰라요/.test($('aiOut').textContent),
    $('aiOut').textContent);
  check('런타임: 기록에서 본 답임을 알려 준다', /대화기록/.test($('aiMeta').textContent), $('aiMeta').textContent);
  check('런타임: 고륵면 기록은 닫힌다', $('aiHist').hidden === true);
}
// 기록 토글: 다시 누르면 닫힌다 / Esc 로도 닫힌다
w.sdyAiHistToggle();
check('런타임: 다시 누르면 기록이 열린다', $('aiHist').hidden === false);
w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('런타임: Esc 로 기록을 닫는다', $('aiHist').hidden === true);

// ── 2-8) 실패 경로 — 말풍선이 이유를 말해 준다 ──
askRes = () => fakeRes(429, { ok: false, limited: true, retry_after: 37, error: 'AI 사용량이 잠시 찼어요' });
w.sdyAiWarmReset();
calls.length = 0;
$('aiQ').value = '지금 답해 줘';
w.sdyAiRun();
await tick(60); await flush();
check('런타임: 제한이면 서버 안내를 말풍선에 그대로 보여 준다',
  /사용량이 잠시 찼어요/.test($('aiOut').textContent), $('aiOut').textContent);
check('런타임: 재시도 대기 초를 알려 준다',
  /37초 뒤에 다시 시도해 주세요/.test($('aiMeta').textContent), $('aiMeta').textContent);
check('런타임: 못 답하면 딱지가 사라진다', $('aiKind').hidden === true);

// 노트를 닫으면 말풍선·기록도 같이 닫힌다(노트 친구라 밖에 없다)
$('editorView').classList.remove('open');
await tick(60);
check('런타임: 노트를 닫으면 말풍선·기록도 같이 닫힌다',
  $('aiSay').hidden === true && $('aiHist').hidden === true);
$('editorView').classList.add('open');
await tick(60);

console.log(`\n  ${pass} passed`);
