/* 14.20.0 · AI 노트 도우미 계약
   ---------------------------------------------------------------------------
   프런트(sdynotes.html/.js/.css)와 서버(routes/ai.js)가 서로 어긋나지 않는지:
     1) 소스 계약 — 키가 프런트에 없고, task 목록·다리(bridge)가 양쪽에서 맞물린다
     2) 런타임 — jsdom 에서 실제로 패널을 열고 실행해 /api/ai/ask 를 부르고
        결과를 화면에 찍는지, 429 안내·재시도 힌트·멈추기·복사가 살아 있는지 */
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
check('서버: task 화이트리스트 4종(summarize/bullets/ask/free)',
  ['summarize', 'bullets', 'ask', 'free'].every((t) => new RegExp(`^  ${t}: \\{`, 'm').test(srv)));
check('서버: 키는 Authorization 헤더로만 나간다',
  /Authorization: `Bearer \$\{p\.key\}`/.test(srv));
check('서버: 같은 입력은 캐시로 답한다', /cachePut\(key, out\.text, out\.provider, out\.model\)/.test(srv) && /cached: true/.test(srv));
check('서버: 429/5xx 만 쿨다운을 건다', /status === 429 \|\| status >= 500/.test(srv));
check('서버: 로그인 uid 없으면 ip 로 사용량을 센다', /`uid:\$\{u\.uid\}`/.test(srv) && /`ip:\$\{req\.ip/.test(srv));
check('서버: 공급사 체인 — 429/5xx 는 그 공급사만 쉬고 다음으로 넘어간다',
  /for \(const p of AI_PROVIDERS\)/.test(srv) && /coolSet\(p\.name, r\.status\)/.test(srv));
check('서버: 401/404 는 쿨다운을 걸지 않는다 (설정 문제라 다시 때려도 같다)',
  /function coolWorthy\(status\) \{ return status === 429 \|\| status >= 500; \}/.test(srv));
check('서버: 전부 쉬는 중에도 캐시가 있으면 그것으로 답한다',
  /if \(!anyProviderReady\(\)\)/.test(srv) && /aiCacheGet\(job\.key\)/.test(srv)
  && /cached: true/.test(srv));
// 14.22.0 · 스트리밍 — 키·본문 검사와 캐시를 지나 SSE 로 조각을 흘려 보낸다
check('서버: stream:true 면 SSE(text/event-stream) 로 조각을 흘려 보낸다',
  /text\/event-stream/.test(srv) && /send\('delta'/.test(srv) && /b\.stream === true/.test(srv));
check('서버: 스트림도 캐시·in-flight 를 탄다 (같은 요청은 외부 호출 0번)',
  /aiCacheGet\(job\.key\)/.test(srv) && /inFlight\.get\(job\.key\)/.test(srv)
  && /cachePut\(job\.key/.test(srv));
check('서버: 스트림이 이미 나간 뒤에는 다른 공급사로 갈아타지 않는다',
  /if \(emitted\) throw e;/.test(srv));
check('서버: 긴 노트는 앞 70% + 뒤 30% 를 살려 보낸다',
  /function fitText/.test(srv) && /Math\.floor\(lim \* 0\.7\)/.test(srv)
  && /t\.slice\(t\.length - tail\)/.test(srv));
check('서버: 미리 준비(warm) 요청은 한도를 따로 센다',
  /const warm = b\.warm === true/.test(srv) && /warm \? AI_WARM_N : AI_RATE_N/.test(srv)
  && /warm \? `warm:\$\{rlKey\}` : rlKey/.test(srv));

check('프런트: 키를 직접 들고 있지 않다 (sk- 리터럴 없음)', !/sk-[A-Za-z0-9_\-]{8,}/.test(js));
check('프런트: AI 는 자기 엔드포인트(/api/ai/ask)만 부른다', /fetch\('\/api\/ai\/ask'/.test(js));
check('프런트: 상태 조회로 켜짐/모델을 확인한다', /fetch\('\/api\/ai\/status'/.test(js));
check('프런트: task 4종이 서버와 같다',
  /id:'summarize'/.test(js) && /id:'bullets'/.test(js) && /id:'ask'/.test(js) && /id:'free'/.test(js));
check('프런트: 노트 글은 bridge 로만 꺼낸다 (문서 구조를 직접 안 건드림)',
  /window\.__sdyAiBridge\.text\(/.test(js));
check('프런트: bridge 는 편집기 스코프에서 collectPageEls 로 글을 모은다',
  /window\.__sdyAiBridge=\{/.test(js) && /collectPageEls\(i\)\.forEach/.test(js));
check('프런트: 제한(429)이면 재시도 대기 초를 안내한다', /retry_after/.test(js) && /초 뒤에 다시 시도해 주세요/.test(js));
check('프런트: 설정 오류(401/404) 힌트를 그대로 보여 준다', /d\.hint/.test(js));
check('프런트: 실행 중 멈출 수 있다 (AbortController)', /new AbortController\(\)/.test(js) && /ctl\.abort\(\)/.test(js));
check('프런트: 로그인 토큰을 x-sdy-auth 로 보낸다', /'x-sdy-auth':token\(\)/.test(js));
check('프런트: 같은 요청을 두 번 보내지 않는다 (실행 중 가드)', /if\(ctl\) return;/.test(js));

check('HTML: 열기 버튼·패널·출력란이 있다',
  html.includes('id="aiFab"') && html.includes('id="aiPanel"') && html.includes('id="aiOut"'));
check('HTML: 질문란·결과 복사·멈추기가 있다',
  html.includes('id="aiQ"') && html.includes('id="aiCopy"') && html.includes('id="aiStop"'));
check('CSS: 패널은 모달(1900) 아래에 뜬다', /z-index:1850;/.test(css));
check('CSS: 다크모드 지원 — 색을 유리 토큰(var(--g-*))으로만 쓴다',
  /\.ai-panel\{[^}]*background:var\(--g-fill-strong\)/.test(css)
  && !/\.ai-panel\{[^}]*#[0-9a-fA-F]{3,6}/.test(css));
check('CSS: 좁은 화면에서는 좌우 가득', /@media \(max-width:640px\)\{\s*\.ai-panel\{right:10px;left:10px;/.test(css));
check('CSS: 모바일 전용 최종 블록(파일 맨 끝)을 침범하지 않는다',
  css.indexOf('14.22.0 · 노트 해돌이') < css.indexOf('17.0 · 모바일 전용 최종 레이아웃'));

// ── 1-2) 14.22.0 · 해돌이 UI 계약 ───────────────────────────────────────────
check('HTML: 해돌이 말풍선(얼굴 + 버블)이 있다',
  html.includes('id="aiSay"') && html.includes('ai-say-otter') && html.includes('ai-say-box'));
check('HTML: 말풍선 얼굴은 해돌이 스쿼드 공유 부품(#om-m-head)을 쓴다',
  html.includes('id="aiPanel"') && /<use href="#om-m-head"/.test(html));
check('HTML: 질문칸이 오른쪽 끝까지 늘어나는 칸(ai-ask-field) 안에 있다',
  /id="aiAskField"[\s\S]{0,400}id="aiQ"[\s\S]{0,400}id="aiGo"/.test(html));
check('CSS: 말풍선에 해돌이 쪽을 가리키는 꼬리가 있다', /\.ai-say-box::after\{/.test(css));
check('CSS: 질문칸·보내기 버튼이 한 줄(flex)로 붙어 있다',
  /\.ai-ask-field\{display:flex/.test(css) && /#aiQ\{flex:1 1 auto/.test(css));
check('CSS: 질문이 없는 일(요약·개조식)은 버튼이 칸을 가득 채운다',
  /\.ai-ask-field\.noq \.ai-go\{flex:1 1 auto/.test(css));
check('JS: 질문칸에서 Enter 를 누르면 바로 실행된다(한글 조합 중 제외)',
  /e\.target\.id!=='aiQ'/.test(js) && /e\.isComposing\|\|e\.keyCode===229/.test(js)
  && /e\.preventDefault\(\);\s*window\.sdyAiRun\(\);/.test(js));
check('JS: 스트림 조각이 오는 대로 말풍선에 붙인다', /readSSE\(r,function\(d\)\{ acc\+=d;/.test(js));
check('JS: 요약·개조식은 미리 준비해 둔 답을 먼저 찾는다',
  /if\(WARM\[task\]\)/.test(js) && /warmGet\(task,txt\)/.test(js)
  && /body:JSON\.stringify\(\{task:t,text:txt,question:'',warm:true\}\)/.test(js));
check('JS: 홈(노트 밖)에서는 해돌이를 숨긴다',
  /function inNote\(\)/.test(js) && /var show=note&&!\(p&&!p\.hidden\);/.test(js)
  && /classList\.toggle\('hide',!show\)/.test(js));
check('JS: 노트 안에서는 해돌이(마스코트) 옆 자리로 옮겨 앉는다',
  /classList\.toggle\('in-note',note\)/.test(js));
check('JS: 노트 안 해돌이(#noteOtter)를 누르면 패널이 열린다',
  /\$\('noteOtter'\)/.test(js) && /sdyAiToggle\(\); \}\);/.test(js));

// ── 2) 런타임 (jsdom) ────────────────────────────────────────────────────────
// HTML 은 패널 부분만 잘라 쓴다 — 전체 문서는 다른 계약(모바일/폰트)이 다룬다.
const panelHtml = html.slice(html.indexOf('<div id="aiFab"'), html.indexOf('<script src="sdynotes.js'));
const dom = new jsdom.JSDOM(
  `<!DOCTYPE html><html><body>${panelHtml}</body></html>`,
  { runScripts: 'outside-only', url: 'http://localhost/' },
);
const { window } = dom;

const calls = [];
// /api/ai/status 응답(부팅용) — enabled 가 있어야 모델명이 뜬다.
// 14.22.0 · 패널을 열 때마다 상태를 다시 물어보므로, 상태 조회는 경로로 구분해
// 항상 같은 모양으로 답한다(아래 ask 응답(nextBody)이 상태로 새어 들어가면
// 'AI 꺼짐' 으로 오진한다).
const statusBody = { ok: true, enabled: true, model: 'test-model', tasks: [],
  providers: [{ name: 'groq', model: 'test-model' }, { name: 'gemini', model: 'gem' }] };
let nextBody = { ok: true, enabled: true, model: 'test-model', tasks: [],
  providers: [{ name: 'groq', model: 'test-model' }, { name: 'gemini', model: 'gem' }] };
let nextStatus = 200;
// jsdom 에는 Response 가 없다 — 프런트 코드가 쓰는 .status/.json() 만 있으면 된다.
const fakeRes = (status, body) => ({ status, json: () => Promise.resolve(body) });
window.fetch = (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body || null, auth: (opts.headers && opts.headers['x-sdy-auth']) || '' });
  const isStatus = String(url) === '/api/ai/status';
  return Promise.resolve(fakeRes(isStatus ? 200 : nextStatus, isStatus ? statusBody : nextBody));
};
window.__sdyAuthState = { token: 'tok-123', user: {} };
let bridgeScope = null;
window.__sdyAiBridge = { text: (scope) => { bridgeScope = scope; return '노트 본문 글자'; }, title: () => '테스트 노트' };
// 프런트 패널 블록만 실행한다 (27k 줄 전체는 다른 계약에서 다룬다).
// 프런트 AI 패널 블록만 잘라 실행한다 — 27k 줄 전체는 다른 계약이 다룬다.
const mark = js.lastIndexOf('14.22.0 · 노트 해돌이');
const aiBlock = js.slice(js.lastIndexOf('/*', mark));
assert.ok(mark > 0 && aiBlock.startsWith('/*') && aiBlock.includes('sdyAiRun'),
  'AI 패널 블록을 찾아 실행한다');
window.eval(aiBlock);

const tick = () => new Promise((r) => setTimeout(r, 30));
// 프런트는 fetch().then().then() 체인이라 마이크로태스크가 여러 번 돈다.
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const $ = (id) => window.document.getElementById(id);

await tick(); await flush();
check('런타임: 부팅하면 상태 조회를 한다', calls.some((c) => c.url === '/api/ai/status'));
check('런타임: 모델명 + 공급사 수를 패널에 표시한다', $('aiModel').textContent === 'test-model 외 1개',
  $('aiModel').textContent);
check('런타임: 할 일 버튼 4개가 그려진다', window.document.querySelectorAll('.ai-task').length === 4);
check('런타임: 기본은 요약(요약 버튼이 켜짐)', window.document.querySelector('.ai-task.on').dataset.task === 'summarize');
check('런타임: 요약에서는 질문란을 숨긴다', $('aiQ').classList.contains('hide'));
nextBody = { ok: true, text: '요약 결과', model: 'test-model', provider: 'groq', cached: false, truncated: false };  // 이제부터는 ask 응답

// 열기/닫기
check('런타임: 패널은 처음에 닫혀 있다', $('aiPanel').hidden === true);
window.sdyAiOpen();
check('런타임: 열면 패널이 보이고 버튼은 숨는다', $('aiPanel').hidden === false && $('aiFab').classList.contains('hide'));
window.sdyAiClose();
check('런타임: 닫으면 패널이 숨고 버튼이 돌아온다', $('aiPanel').hidden === true && !$('aiFab').classList.contains('hide'));
window.sdyAiOpen();

// 요약 실행
calls.length = 0;
window.sdyAiRun();
await tick(); await flush();
const c0 = calls[0];
check('런타임: 요약은 /api/ai/ask 를 POST 로 부른다', c0 && c0.url === '/api/ai/ask' && c0.method === 'POST');
const b0 = JSON.parse(c0.body);
check('런타임: task=summarize + 노트 본문을 보낸다', b0.task === 'summarize' && b0.text === '노트 본문 글자');
check('런타임: 문서 전체를 보낸다(지금 쪽만 체크 없음)', bridgeScope === 'doc');
check('런타임: 토큰을 헤더로 보낸다', c0.auth === 'tok-123');
check('런타임: 결과를 화면에 찍는다', $('aiOut').textContent === '요약 결과');
check('런타임: 어느 공급사·모델이 답했는지와 소요시간을 남긴다',
  /groq · test-model/.test($('aiMeta').textContent) && /초/.test($('aiMeta').textContent),
  $('aiMeta').textContent);
check('런타임: 결과가 있으면 복사 버튼이 나타난다', $('aiCopy').hidden === false);

// '지금 쪽만'
$('aiScope').checked = true;
calls.length = 0;
window.sdyAiRun();
await tick(); await flush();
check('런타임: 지금 쪽만 체크하면 scope=page 로 꺼낸다', bridgeScope === 'page');
$('aiScope').checked = false;

// 노트 질문 (앞 단계의 응답 체인이 아직 돌고 있을 수 있으니 먼저 비운다)
await tick(); await flush();
calls.length = 0;
window.document.querySelector('.ai-task[data-task="ask"]').dispatchEvent(new window.Event('click', { bubbles: true }));
check('런타임: 노트 질문을 고르면 질문란이 보인다', !$('aiQ').classList.contains('hide'));
window.sdyAiRun();
await tick(); await flush();
check('런타임: 질문 없이 실행하면 서버를 부르지 않는다', calls.length === 0 && /질문을 적어 주세요/.test($('aiOut').textContent));
$('aiQ').value = '핵심이 뭐야?';
window.sdyAiRun();
await tick(); await flush();
const b1 = JSON.parse(calls[0].body);
check('런타임: 질문과 노트 본문을 함께 보낸다', b1.task === 'ask' && b1.question === '핵심이 뭐야?' && b1.text === '노트 본문 글자');

// 자유 질문은 노트를 보내지 않는다
calls.length = 0;
window.document.querySelector('.ai-task[data-task="free"]').dispatchEvent(new window.Event('click', { bubbles: true }));
$('aiQ').value = '제목 추천해 줘';
window.sdyAiRun();
await tick(); await flush();
const b2 = JSON.parse(calls[0].body);
check('런타임: 자유 질문은 노트 본문을 보내지 않는다', b2.task === 'free' && b2.text === '' && b2.question === '제목 추천해 줘');

// 빈 노트
calls.length = 0;
window.document.querySelector('.ai-task[data-task="summarize"]').dispatchEvent(new window.Event('click', { bubbles: true }));
window.__sdyAiBridge = { text: () => '', title: () => '' };
window.sdyAiRun();
await tick(); await flush();
check('런타임: 노트가 비면 서버를 부르지 않고 안내한다', calls.length === 0 && /글이 없어요/.test($('aiOut').textContent));
window.__sdyAiBridge = { text: () => '노트 본문 글자', title: () => '' };

// 429 제한 안내
// (같은 노트로는 '미리 준비한 답' 을 바로 쓰기 때문에, 실패 시나리오를 태우기
//  전에 준비 캐시를 비운다 — 성공한 요약이 그대로 남아 서버를 안 부르게 된다)
window.sdyAiWarmReset();
nextStatus = 429;
nextBody = { ok: false, limited: true, retry_after: 37, error: 'AI 사용량이 잠시 찼어요' };
calls.length = 0;
window.sdyAiRun();
await tick(); await flush();
check('런타임: 제한이면 서버 안내를 그대로 보여 준다', /사용량이 잠시 찼어요/.test($('aiOut').textContent));
check('런타임: 재시도 대기 초를 알려 준다', /37초 뒤에 다시 시도해 주세요/.test($('aiMeta').textContent));
check('런타임: 실패하면 복사 버튼이 사라진다', $('aiCopy').hidden === true);

// 설정 오류(502) — 서버가 짚어 준 힌트를 그대로 띄운다
nextStatus = 502;
nextBody = { ok: false, limited: false, error: 'AI에 닿지 못했어요',
  hint: 'gemini · 키가 거부됐어요(401) · Google AI Studio 에서 만든 API 키가 맞는지' };
window.sdyAiRun();
await tick(); await flush();
check('런타임: 설정 오류면 서버 힌트를 meta 에 띄운다', /키가 거부됐어요\(401\)/.test($('aiMeta').textContent),
  $('aiMeta').textContent);
check('런타임: 힌트 때문에 재시행 버튼이 죽지 않는다', $('aiGo').disabled === false);

// 네트워크 오류
window.fetch = () => Promise.reject(new window.Error('boom'));
calls.length = 0;
window.sdyAiRun();
await tick(); await flush();
check('런타임: 네트워크 오류도 안내로 떨어진다', /네트워크 오류/.test($('aiOut').textContent));
check('런타임: 못 답하면 해돌이 표정도 슬퍼진다',
  $('aiSayFace').getAttribute('href') === '#om-m-f-sad-mini', $('aiSayFace').getAttribute('href'));
check('런타임: 실패 뒤에도 다시 실행할 수 있다', $('aiGo').disabled === false && $('aiGo').textContent === '실행');

// ══ 3) 런타임 2 · 14.22.0 (말하는 대로 / Enter / 미리 준비 / 노트 안에서만) ══
// 위 시나리오는 fetch 를 갈아끼운 상태라, 새 jsdom 을 하나 더 띄운다.
// #editorView 를 같이 넣는다 — '노트 밖(홈)이면 해돌이를 숨긴다' 를 보려고.
const dom2 = new jsdom.JSDOM(
  `<!DOCTYPE html><html><body>${panelHtml}<div id="editorView"></div><div id="noteOtter"><div id="noteOtterBubble"></div></div></body></html>`,
  { runScripts: 'outside-only', url: 'http://localhost/' },
);
const w2 = dom2.window;
const $2 = (id) => w2.document.getElementById(id);
const calls2 = [];
let askRes = null;                                  // (url, body) -> 응답 객체
w2.fetch = (url, opts = {}) => {
  calls2.push({ url: String(url), body: opts.body || null, headers: opts.headers || {} });
  if (String(url) === '/api/ai/status') {
    return Promise.resolve(fakeRes(200, { ok: true, enabled: true, model: 'm1', providers: [] }));
  }
  return Promise.resolve(askRes(String(url), JSON.parse(opts.body || '{}')));
};
w2.__sdyAuthState = { token: 'tok-2' };
// 미리 준비(warm)가 붙도록 40자 넘는 노트를 준다
const LONG = '광합성은 잎의 엽록체에서 일어나는 반응이다. 빛 에너지로 물과 이산화탄소에서 포도당을 만든다.';
w2.__sdyAiBridge = { text: () => LONG, title: () => '생물 노트' };
w2.eval(aiBlock);
const tick2 = (ms = 30) => new Promise((r) => setTimeout(r, ms));
await tick2(50); await flush();

// ── 3-1) 홈(노트 밖)에서는 해돌이가 없다 ──
check('런타임2: 홈(노트 닫힘)에서는 둥근 버튼이 숨는다', $2('aiFab').classList.contains('hide'));
w2.sdyAiOpen();
check('런타임2: 노트 밖에서는 패널이 열리지 않는다', $2('aiPanel').hidden === true);
$2('editorView').classList.add('open');             // 노트에 들어감
await tick2(50);
check('런타임2: 노트를 열면 둥근 버튼이 나타난다', !$2('aiFab').classList.contains('hide'));
w2.sdyAiOpen();
await tick2(50);
check('런타임2: 노트 안에서는 패널이 열린다', $2('aiPanel').hidden === false);
check('런타임2: 열려 있는 동안엔 둥근 버튼이 숨는다', $2('aiFab').classList.contains('hide'));
check('런타임2: 열면 해돌이가 먼저 한마디 한다(빈 말풍선 없음)',
  $2('aiSay').hidden === false && /해돌~/.test($2('aiOut').textContent), $2('aiOut').textContent);

// ── 3-2) 노트 안 해돌이(#noteOtter) 를 눌러도 같은 패널 ──
w2.sdyAiClose();
$2('noteOtter').dispatchEvent(new w2.Event('click', { bubbles: true }));
await tick2(20);
check('런타임2: 노트 안 해돌이를 누르면 패널이 열린다', $2('aiPanel').hidden === false);

// ── 3-3) 말하는 대로: SSE 조각이 오는 족족 말풍선에 붙는다 ──
const FULL = '광합성은 잎의 엽록체에서 빛으로 포도당을 만드는 일이다. 해돌~';
askRes = (url, b) => {
  if (b.stream !== true) return fakeRes(200, { ok: true, text: FULL, provider: 'p', model: 'm1' });
  const evs = [
    { e: 'meta', d: { cached: false, truncated: false } },
    { e: 'delta', d: { t: '광합성은 ' } },
    { e: 'delta', d: { t: '잎의 엽록체에서 ' } },
    { e: 'delta', d: { t: '빛으로 포도당을 만드는 일이다. 해돌~' } },
    { e: 'done', d: { text: FULL, provider: 'p', model: 'm1', cached: false, truncated: false } },
  ];
  // 진짜 네트워크처럼 잘린 조각으로 흘려 보낸다(줄 중간에서 끊긴다)
  const raw = evs.map((x) => `event: ${x.e}\ndata: ${JSON.stringify(x.d)}\n\n`).join('');
  const bytes = new TextEncoder().encode(raw);
  const parts = [];
  for (let i = 0; i < bytes.length; i += 7) parts.push(bytes.slice(i, i + 7));
  let idx = 0;
  return {
    status: 200,
    headers: { get: () => 'text/event-stream; charset=utf-8' },
    body: { getReader: () => ({ read: () => {
      if (idx >= parts.length) return Promise.resolve({ done: true });
      const v = parts[idx++];
      // 조각마다 조금씩 늦게 — '말하는 중' 을 관찰할 수 있게
      return new Promise((r) => setTimeout(() => r({ done: false, value: v }), 3));
    } }) },
  };
};
calls2.length = 0;
w2.sdyAiRun();
await tick2(70);                                    // 조각이 흘러오는 '중간' 을 본다
const mid = $2('aiOut').textContent;
check('런타임2: 스트림 조각이 오는 대로 말풍선에 붙는다 (중간에도 글이 보인다)',
  mid.length > 0 && mid !== FULL && FULL.indexOf(mid) === 0, mid);
check('런타임2: 말하는 중에는 멈추기 버튼이 보인다', $2('aiStop').hidden === false);
check('런타임2: 말하는 중에는 해돌이 표정이 바뀐다',
  $2('aiSayFace').getAttribute('href') === '#om-m-f-wink', $2('aiSayFace').getAttribute('href'));
await tick2(400);
check('런타임2: 다 말하면 전체 문장이 남는다', $2('aiOut').textContent === FULL, $2('aiOut').textContent);
check('런타임2: 말풍선이 떠 있고, 다 말하면 멈추기 버튼이 숨는다',
  $2('aiSay').hidden === false && $2('aiStop').hidden === true);
check('런타임2: 누가 답했는지(공급사·모델)를 남긴다', /p · m1/.test($2('aiMeta').textContent),
  $2('aiMeta').textContent);
check('런타임2: 다 말하면 해돌이가 웃는다',
  $2('aiSayFace').getAttribute('href') === '#om-m-f-happy', $2('aiSayFace').getAttribute('href'));
check('런타임2: 해돌이도 한마디 남긴다', /해돌~/.test($2('noteOtterBubble').textContent));

// ── 3-4) 요약·개조식은 누르자마자 나온다 (미리 준비) ──
w2.sdyAiWarmReset();
calls2.length = 0;
w2.sdyAiWarmNow();                                  // 노트를 열면 슬쩍 준비해 두는 그 호출
await tick2(80); await flush();
const warmCalls = calls2.filter((c) => /"warm":true/.test(c.body || ''));
check('런타임2: 미리 준비는 요약·개조식 두 개를 warm:true 로 부른다',
  warmCalls.length === 2
  && warmCalls.some((c) => /"task":"summarize"/.test(c.body))
  && warmCalls.some((c) => /"task":"bullets"/.test(c.body)), warmCalls.length);
calls2.length = 0;
w2.sdyAiRun();                                      // 이제 요약 버튼을 누른다
await tick2(60); await flush();
check('런타임2: 준비된 요약은 서버를 다시 부르지 않고 바로 나온다',
  calls2.length === 0 && $2('aiOut').textContent === FULL, calls2.length);
check('런타임2: 준비된 답임을 알려 준다', /미리 준비해 둔 답/.test($2('aiMeta').textContent),
  $2('aiMeta').textContent);

// ── 3-5) 질문칸에서 Enter = 바로 물어보기 (한글 조합 중엔 보내지 않는다) ──
w2.document.querySelector('.ai-task[data-task="ask"]').dispatchEvent(new w2.Event('click', { bubbles: true }));
check('런타임2: 노트 질문을 고르면 질문칸이 보인다', !$2('aiQ').classList.contains('hide'));
askRes = () => fakeRes(200, { ok: true, text: '엽록체에서 일어나요', provider: 'p', model: 'm1' });
$2('aiQ').value = '어디서 일어나?';
calls2.length = 0;
$2('aiQ').dispatchEvent(new w2.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await tick2(60); await flush();
check('런타임2: Enter 만 누르면 바로 물어본다',
  calls2.length === 1 && /"question":"어디서 일어나\?"/.test(calls2[0].body), calls2.length);
// 한글 조합 중 Enter(ㅇ+ㅓ → '어' 가 완성되기 직전)에는 보내지 않는다
calls2.length = 0;
$2('aiQ').dispatchEvent(new w2.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
await tick2(60); await flush();
check('런타임2: 한글 조합 중 Enter 는 보내지 않는다', calls2.length === 0, calls2.length);
// Shift+Enter 는 줄바꿈이라 보내지 않는다
calls2.length = 0;
$2('aiQ').dispatchEvent(new w2.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
await tick2(60); await flush();
check('런타임2: Shift+Enter 는 줄바꿈이라 보내지 않는다', calls2.length === 0, calls2.length);

console.log(`\n  ${pass} passed`);
