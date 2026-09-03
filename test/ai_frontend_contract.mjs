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
  /if \(!anyProviderReady\(\)\)/.test(srv) && /aiCacheGet\(aiKeyFor\(task, text, question\)\)/.test(srv));

check('프런트: 키를 직접 들고 있지 않다 (sk- 리터럴 없음)', !/sk-[A-Za-z0-9_\-]{8,}/.test(js));
check('프런트: AI 는 자기 엔드포인트(/api/ai/ask)만 부른다', /fetch\('\/api\/ai\/ask'/.test(js));
check('프런트: 상태 조회로 켜짐/모델을 확인한다', /fetch\('\/api\/ai\/status'/.test(js));
check('프런트: task 4종이 서버와 같다',
  /id:'summarize'/.test(js) && /id:'bullets'/.test(js) && /id:'ask'/.test(js) && /id:'free'/.test(js));
check('프런트: 노트 글은 bridge 로만 꺼낸다 (문서 구조를 직접 안 건드림)',
  /window\.__sdyAiBridge\.text\(scope\)/.test(js));
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
check('CSS: 다크모드 지원 — 색을 변수로만 쓴다',
  /\.ai-panel\{[^}]*background:var\(--card\)/.test(css) && !/\.ai-panel\{[^}]*#fff/.test(css));
check('CSS: 좁은 화면에서는 좌우 가득', /@media \(max-width:640px\)\{\s*\.ai-panel\{right:10px;left:10px;/.test(css));
check('CSS: 모바일 전용 최종 블록(파일 맨 끝)을 침범하지 않는다',
  css.indexOf('14.20.0 · AI 노트 도우미 패널') < css.indexOf('17.0 · 모바일 전용 최종 레이아웃'));

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
let nextBody = { ok: true, enabled: true, model: 'test-model', tasks: [],
  providers: [{ name: 'groq', model: 'test-model' }, { name: 'gemini', model: 'gem' }] };
let nextStatus = 200;
// jsdom 에는 Response 가 없다 — 프런트 코드가 쓰는 .status/.json() 만 있으면 된다.
const fakeRes = (status, body) => ({ status, json: () => Promise.resolve(body) });
window.fetch = (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body || null, auth: (opts.headers && opts.headers['x-sdy-auth']) || '' });
  return Promise.resolve(fakeRes(nextStatus, nextBody));
};
window.__sdyAuthState = { token: 'tok-123', user: {} };
let bridgeScope = null;
window.__sdyAiBridge = { text: (scope) => { bridgeScope = scope; return '노트 본문 글자'; }, title: () => '테스트 노트' };
// 프런트 패널 블록만 실행한다 (27k 줄 전체는 다른 계약에서 다룬다).
// 프런트 AI 패널 블록만 잘라 실행한다 — 27k 줄 전체는 다른 계약이 다룬다.
const mark = js.lastIndexOf('14.20.0 · AI 노트 도우미 (요약');
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
check('런타임: 실패 뒤에도 다시 실행할 수 있다', $('aiGo').disabled === false && $('aiGo').textContent === '실행');

console.log(`\n  ${pass} passed`);
