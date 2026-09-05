/* 14.24.0 · 노트 해돌이 계약 — 질문 · 개요 · 안전한 문서 편집
   ---------------------------------------------------------------------------
   예전(✨ 아이콘 버튼 + 뜨는 창)과 달라진 계약:
     1) 소스 — #aiFab/#aiPanel/할일칩(요약·개조식·노트질문·자유질문 고르기)/
        보내기 버튼이 없고, #noteOtter 옆 한 줄 검색창(#aiAsk > #aiQ) +
        그 바로 위 '이 페이지'(#aiOutlinePage)·'전체 페이지'(#aiOutlineDoc)
        버튼 둘만 있다. 일반 질문은 chat, 느낌표로 시작한 요청은 edit이다.
     2) 런타임(jsdom) — Enter 로 바로 묻고, chat 답은 말풍선에 스트리밍된다.
        !편집 요청은 문서 스냅샷과 revision을 캡처하고, 모델의 @ 명령을 완료 뒤
        허용 목록으로 파싱해 bridge.apply에 한 번만 전달한다. */
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
check('서버: task 화이트리스트 3종(outline/chat/edit)',
  /^  outline: \{/m.test(srv) && /^  chat: \{/m.test(srv) && /^  edit: \{/m.test(srv)
  && !/^  summarize: \{/m.test(srv) && !/^  bullets: \{/m.test(srv)
  && !/^  ask: \{/m.test(srv) && !/^  free: \{/m.test(srv));
check('서버: edit은 @ 명령 허용 목록이며 캐시/in-flight를 쓰지 않는다',
  /edit: \{[\s\S]*?@mv[\s\S]*?@tx[\s\S]*?@add[\s\S]*?noCache: true/.test(srv)
  && /const noCache = !!AI_TASKS\[task\]\?\.noCache/.test(srv)
  && /job\.noCache \? null : aiCacheGet/.test(srv));
check('서버: chat 프롬프트가 해돌이 판단 표식([[note]]/[[free]])을 첫 줄에 요구한다',
  /\[\[note\]\]/.test(srv) && /\[\[free\]\]/.test(srv));
check('서버: chat 은 노트가 비어 있어도 된다(needText:false) · 질문은 필요하다',
  /chat: \{[\s\S]*?needText: false,[\s\S]*?needQuestion: true,/.test(srv));
check('서버: 미리 준비(warm)는 개요 정리(outline)만 받는다',
  /b\.warm === true && task === 'outline'/.test(srv));
check('서버: 키는 Authorization 헤더로만 나간다',
  /Authorization: `Bearer \$\{p\.key\}`/.test(srv));
check('서버: 같은 입력은 캐시로 답한다', /cachePut\(key, out\.text, out\.provider, out\.model\)/.test(srv) && /cached: true/.test(srv));
check('서버: 429/5xx 만 한도(limited)로 분류한다', /status === 429 \|\| r\.status >= 500/.test(srv));
check('서버: 자체 쿨다운이 없다 — 429 뒤에도 다음 요청은 곧바로 나간다',
  !/AI_COOLDOWN_MS/.test(srv) && !/anyProviderReady/.test(srv) && !/coolSet/.test(srv));
check('서버: stream:true 면 SSE(text/event-stream) 로 조각을 흘려 본다',
  /text\/event-stream/.test(srv) && /send\('delta'/.test(srv) && /b\.stream === true/.test(srv));
check('서버: 긴 노트는 앞 70% + 뒤 30% 를 살린다',
  /function fitText/.test(srv) && /Math\.floor\(lim \* 0\.7\)/.test(srv));

check('프런트: 키를 직접 들고 있지 않다 (sk- 리터럴 없음)', !/sk-[A-Za-z0-9_\-]{8,}/.test(js));
check('프런트: AI 는 자기 엔드포인트(/api/ai/ask)만 부른다', /fetch\('\/api\/ai\/ask'/.test(js));
check('프런트: 상태 조회로 켜짐/모델을 확인한다', /fetch\('\/api\/ai\/status'/.test(js));
check('프런트: 노트 글은 bridge 로만 꺼낸다 (문서 구조를 직접 안 건드림)',
  /window\.__sdyAiBridge\.text\(/.test(js));
check('프런트: 편집도 capture/apply bridge로만 하고 요청 중 문서 변경을 막는다',
  /capture:\(\)=>/.test(js) && /apply:\(ops,revision\)=>/.test(js)
  && /expectedRevision!==aiEditRevision\(\)/.test(js) && /res\.stale=true/.test(js));
check('프런트: 모델 명령은 허용 목록 파서로 평문·좌표만 받는다',
  /window\.sdyAiEditParse=function/.test(js) && /cmd:'mv'/.test(js)
  && /cmd:'tx'/.test(js) && /cmd:'add'/.test(js) && /ops\.slice\(0,60\)/.test(js));
check('프런트: AI 편집은 최대 30개이며 한 번의 undo 지점으로 묶인다',
  /AI_EDIT_MAX_OPS=30/.test(js) && /const beforeChange=[\s\S]{0,500}pushHistory\(true\)/.test(js));
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
check('프런트: 정리는 미리 준비해 둔 답을 먼저 찾는다',
  /warmGet\(txt\)/.test(js) && /body:JSON\.stringify\(\{task:'outline',text:txt,question:'',warm:true\}\)/.test(js));
check('프런트: 이 페이지/전체 페이지 범위로 나눠 묻는다',
  /window\.sdyAiOutline=function\(scope\)/.test(js)
  && /noteText\(task==='outline'\?scope:'doc'\)/.test(js)
  && /outlinePage:'이 페이지'/.test(js) && /outlineDoc:'전체 페이지'/.test(js));
check('프런트: !·/편집·편집: 접두사를 edit 요청으로 보내고 완료 전 부분 적용하지 않는다',
  /var EDIT_PRE=/.test(js) && /run\('edit',editCommand\)/.test(js)
  && /if\(task==='edit'\)\{ out\(editProgress\(acc\),true\); return; \}/.test(js)
  && /editApplyDone\(text,editCapture\)/.test(js));
// ── 14.25.0 · 똑똑한 해돌이 — 자동 라우팅·서식·표·이동·클립보드·되묻기 ──
check('서버: chat은 편집 요청이면 [[edit]] 표식으로 넘기라고 한다',
  /\[\[edit\]\]/.test(srv) && /문서 편집기가 이어받는다/.test(srv));
check('서버: edit 프롬프트는 부분 수정·서식·표·이동·클립보드·되묻기를 문서화한다',
  ['@rp', '@ap', '@st', '@tbl', '@tsz', '@tmv', '@tcell', '@goto', '@newpage',
    '@title', '@clip', '@clipin', '@copy', '@ask'].every((c) => srv.includes(c)));
check('서버: edit 후속 문맥(context)을 이전 대화로 전달한다',
  /aiMessages\(task, text, question, context\)/.test(srv) && /이전 대화:\\n/.test(srv));
check('프런트: [[edit]] 표식을 파싱해 편집으로 넘긴다',
  /note\|free\|edit/.test(js) && /run\('edit',q,scope,true\)/.test(js));
check('프런트: ! 없이도 고쳐 달라는 말투면 편집으로 자동 라우팅한다',
  /function looksLikeEdit\(q\)/.test(js) && /window\.sdyAiLooksLikeEdit=looksLikeEdit/.test(js)
  && /if\(looksLikeEdit\(q\)\)\{ run\('edit',q\); return; \}/.test(js));
check('프런트: 편집 파서는 부분 수정·서식·표·이동·클립보드·되묻기를 읽는다',
  /cmd:'rp'/.test(js) && /cmd:'ap'/.test(js) && /cmd:'st'/.test(js) && /cmd:'tbl'/.test(js)
  && /cmd:'tsz'/.test(js) && /cmd:'tmv'/.test(js) && /cmd:'tcell'/.test(js) && /cmd:'goto'/.test(js)
  && /cmd:'newpage'/.test(js) && /cmd:'title'/.test(js) && /cmd:'clip'/.test(js)
  && /cmd:'clipin'/.test(js) && /cmd:'copy'/.test(js) && /ask=decode\(rest\)/.test(js));
check('프런트: 스냅샷에 서식·표 정보를 싣는다',
  /fmt\+=' font='/.test(js) && /fs='\+Math\.round/.test(js) && /type=표/.test(js) && /rows='\+rows/.test(js));
check('프런트: 편집 요청에 직전 1턴 문맥을 싣는다',
  /context:task==='edit'\?editCtxText\(\):''/.test(js));
check('프런트: 클립보드 명령은 비동기 적용을 기다렸다 마무리한다',
  /typeof applied\.then==='function'/.test(js) && /clipboard\.readText/.test(js));
check('프런트: 되돌리기 직후 내 에코가 서식을 되살리지 못하게 가드한다',
  /let _undoGuardUntil=0/.test(js) && /_undoGuardUntil=Date\.now\(\)\+30000/.test(js)
  && /op\.dev&&op\.dev===SYNC_DEV&&Date\.now\(\)<_undoGuardUntil/.test(js));
check('프런트: 모델 이름·소요 초 같은 기술 정보는 화면에 남기지 않는다',
  !/tailMeta/.test(js) && /meta\(''\);\s*\/\/ 모델·소요 초 같은 기술 정보는 안 보여 준다/.test(js)
  && /dot\.title=enabled\?'AI 켜짐'/.test(js));
check('프런트: 아이디어 해돌이는 클릭이 아니라 호버로 나온다',
  /note\.addEventListener\('mouseenter',otterIdea\)/.test(js)
  && !/note\.addEventListener\('click',otterIdea\)/.test(js));
check('CSS: 답이 길면 말풍선 본문을 스크롤해서 읽는다',
  /\.ai-say-body\{[^}]*overflow-y:auto/.test(css)
  && /\.ai-say-body::-webkit-scrollbar\{/.test(css));
check('프런트: 같은 요청을 두 번 보내지 않는다 (실행 중 가드)', /if\(ctl\) return;/.test(js));
check('프런트: 실행 중 멈출 수 있다 (AbortController)', /new AbortController\(\)/.test(js) && /ctl\.abort\(\)/.test(js));
check('프런트: 로그인 토큰을 x-sdy-auth 로 본다', /'x-sdy-auth':token\(\)/.test(js));
check('프런트: 스트림 조각이 오는 대로 말풍선에 붙인다', /readSSE\(r,function\(d\)\{[\s\S]*?acc\+=d;/.test(js));

check('HTML: 아이콘 버튼·뜨는 창·할일칩·보내기 버튼이 사라졌다',
  !/id="aiFab"/.test(html) && !/id="aiPanel"/.test(html) && !/id="aiTasks"/.test(html)
  && !/id="aiGo"/.test(html) && !/id="aiScope"/.test(html));
check('HTML: 해돌이 옆 검색창(#aiAsk > #aiQ)이 있다',
  /id="aiAsk"/.test(html) && /id="aiQ"/.test(html));
check('HTML: 이 페이지·전체 페이지 버튼이 질문칸(#aiQ)보다 먼저(위)에 있다',
  html.indexOf('id="aiOutlinePage"') >= 0 && html.indexOf('id="aiOutlineDoc"') >= 0
  && html.indexOf('id="aiOutlinePage"') < html.indexOf('id="aiQ"')
  && html.indexOf('id="aiOutlineDoc"') < html.indexOf('id="aiQ"')
  && !/id="aiOutline"/.test(html));
check('HTML: 별도 요약 문구 없이 두 범위 버튼만 질문칸 바로 위에 있다',
  !/개조식\s+요약/.test(html)
  && html.indexOf('class="ai-outline-row"') < html.indexOf('class="ai-askbar-field"')
  && !/class="ai-outline-box"/.test(html) && !/class="ai-outline-ttl"/.test(html));
check('CSS: 범위 버튼 둘은 질문칸과 가운데가 맞고 좁은 화면에서는 줄바꿈한다',
  /\.ai-askbar\{[^}]*align-items:center/.test(css)
  && /\.ai-outline-row\{[^}]*justify-content:center[^}]*flex-wrap:wrap/.test(css));
check('HTML: 해돌이는 호버=아이디어 · 클릭=대화기록이라고 안내한다',
  /커서를 올리면 아이디어 · 누르면 대화기록/.test(html));
check('HTML: 검색창은 #noteOtter 옆(같은 편집기 구역)에 붙어 있다',
  html.indexOf('id="noteOtter"') < html.indexOf('id="aiAsk"')
  && html.indexOf('id="aiAsk"') < html.indexOf('id="drawToolbar"'));
check('HTML: 말풍선(#aiSay)에 이름·딱지·닫기·멈추기·복사가 있다',
  /id="aiSay"/.test(html) && /id="aiKind"/.test(html) && /id="aiSayX"/.test(html)
  && /id="aiStop"/.test(html) && /id="aiCopy"/.test(html) && /id="aiOut"/.test(html));
check('HTML: 대화기록(#aiHist > #aiHistList)이 있다',
  /id="aiHist"/.test(html) && /id="aiHistList"/.test(html));
check('HTML: 검색창 안내 글씨는 한 줄 — (Enter) 없이, Enter 안내는 title·aria 로',
  /placeholder="해돌이에게 물어보기…"/.test(html)
  && !/placeholder="[^"]*\(Enter\)"/.test(html)
  && /title="[^"]*Enter[^"]*"/.test(html) && /aria-label="[^"]*Enter[^"]*"/.test(html));
check('HTML: 질문칸은 여러 줄로 자랄 수 있는 textarea 다',
  /<textarea id="aiQ"/.test(html) && !/<input[^>]*id="aiQ"/.test(html));
check('HTML/CSS: ! 없이도 되는 편집을 안내하고 입력 중 편집 딱지를 보여 준다',
  /! 없이도 문서를 고쳐요/.test(html) && /id="aiEditTag"[^>]*hidden>편집</.test(html)
  && /\.ai-askbar\.edit-on \.ai-askbar-field/.test(css) && /\.ai-edittag\{/.test(css));
check('프런트: 질문이 길면 옆으로, 여러 줄이면 위로 자란다 (aiQGrow)',
  /function aiQGrow\(/.test(js) && /--ai-q-w/.test(js)
  && /ai-q-mirror/.test(js) && /document\.addEventListener\('input',/.test(js));
check('CSS: 질문칸 폭은 --ai-q-w 를 따라 유동적이다',
  /\.ai-askbar-field\{[^}]*width:min\(var\(--ai-q-w/.test(css)
  && /\.ai-q-mirror\{/.test(css));

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
check('런타임: 켜짐이면 점에 AI 켜짐만 뜬다 (모델 이름은 안 보인다)',
  $('aiDot').title === 'AI 켜짐', $('aiDot').title);
check('런타임: 검색창은 떠 있고 처음엔 말풍선·기록이 닫혀 있다',
  Boolean($('aiAsk')) && $('aiSay').hidden === true && $('aiHist').hidden === true);
w.sdyAiWarmNow();
await tick(30); await flush();
check('런타임: 노트 밖(홈)에서는 개요를 미리 준비하지 않는다',
  calls.filter((c) => c.url === '/api/ai/ask').length === 0);

// 노트에 들어간다
$('editorView').classList.add('open');
await tick(60); await flush();

// ── 2-2) '이 페이지'·'전체 페이지' — 노트를 열면 미리 준비해 두고, 누르면 바로 나온다 ──
askRes = () => fakeRes(200, { ok: true, text: '1. 광합성\n  - 엽록체에서 일어난다', provider: 'groq', model: 'test-model', cached: false });
calls.length = 0;
w.sdyAiWarmNow();                       // 노트를 여는 순간 하는 그 호출을 지금 바로
await tick(50); await flush();
const warmCalls = calls.filter((c) => c.body && /"warm":true/.test(c.body));
check('런타임: 미리 준비는 warm:true 로 부른다 (쪽 하나라 글이 같아 한 번만)',
  warmCalls.length === 1 && /"task":"outline"/.test(warmCalls[0].body), warmCalls.length);
check('런타임: 준비가 되면 이 페이지·전체 페이지 버튼이 ready 로 빛난다',
  $('aiOutlinePage').classList.contains('ready') === true
  && $('aiOutlineDoc').classList.contains('ready') === true);
check('런타임: 준비된 줄(title로) 알려 준다',
  /미리 준비해 뒀어요/.test($('aiOutlinePage').title), $('aiOutlinePage').title);
calls.length = 0;
w.sdyAiOutline('page');                 // 이제 '이 페이지' 버튼을 누른다
await tick(30); await flush();
check('런타임: 준비된 개요는 서버를 다시 부르지 않고 바로 나온다',
  calls.length === 0 && $('aiSay').hidden === false
  && $('aiOut').textContent === '1. 광합성\n  - 엽록체에서 일어난다', calls.length);
check('런타임: 이 페이지 답에는 이 페이지 딱지가 붙는다',
  $('aiKind').hidden === false && $('aiKind').textContent === '이 페이지', $('aiKind').textContent);
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
check('런타임: 모델 이름·소요 초 같은 기술 정보는 보이지 않는다',
  $('aiMeta').textContent === '', JSON.stringify($('aiMeta').textContent));

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
// 질문칸 유동 크기 — 글을 치면 폭·높이를 다시 잰다 (jsdom 은 레이아웃이 0 이라 안 깨지는지만 본다)
$('aiQ').value = '아주아주 긴 질문을 한 줄로 계속 적어 보면 옆으로 늘어나야 하고';
$('aiQ').dispatchEvent(new w.Event('input', { bubbles: true }));
check('런타임: 질문을 치면 칸 크기를 다시 잰다 (폭·높이가 잡힌다)',
  $('aiQ').style.height !== '' && /px/.test($('aiQ').parentNode.style.getPropertyValue('--ai-q-w')),
  $('aiQ').style.height + ' / ' + $('aiQ').parentNode.style.getPropertyValue('--ai-q-w'));
$('aiQ').value = '';

// ── 2-7) ! 문서 편집 — 스냅샷 → 숨긴 명령 스트림 → 완료 뒤 한 번 적용 ──
{
  const parsed = w.sdyAiEditParse([
    '@mv t_1 | 120px | 80',
    '@tx t_2 |',                         // 빈 내용으로 만들기도 정상 명령
    '@add 1 | 30 | 200 | 320 | 70 | 새 문장\\n둘째 줄 | 세로줄',
    '@mv t_bad | 숫자아님 | 20',
    '@unknown anything',
    '@done 세 군데를 정리했어요',
  ].join('\n'));
  check('런타임: 편집 파서는 이동·빈 텍스트·새 상자를 허용 목록으로 읽는다',
    parsed.ops.length === 3 && parsed.ops[0].cmd === 'mv'
    && parsed.ops[1].cmd === 'tx' && parsed.ops[1].text === ''
    && parsed.ops[2].cmd === 'add' && /둘째 줄 \| 세로줄/.test(parsed.ops[2].text));
  check('런타임: 잘못된 숫자·모르는 명령은 실행하지 않고 센다', parsed.dropped === 2);
  check('런타임: @done만 사용자에게 보여 줄 요약으로 분리한다', parsed.say === '세 군데를 정리했어요');
}
const EDIT_SNAPSHOT = '페이지 크기: 800x1100 px · 총 1쪽\n[1쪽]\n  id=t_1 type=글상자 x=40 y=50 w=300 h=80 text="옛 제목"';
const editApplied = [];
w.__sdyAiBridge = {
  text: () => LONG,
  capture: () => ({ text: EDIT_SNAPSHOT, revision: 'revision-before-ai' }),
  apply: (ops, revision) => {
    editApplied.push({ ops, revision });
    return { applied: ops.length, failed: 0, notes: [], stale: false };
  },
};
const EDIT_FULL = '@mv t_1 | 80 | 30\n@tx t_1 | 새 제목\\n부제\n@done 제목을 위로 옮기고 내용을 고쳤어요';
askRes = (url, b) => sse(['@mv t_1 | 80', ' | 30\n@tx t_1 | 새', ' 제목\\n부제'],
  { text: EDIT_FULL, provider: 'gemini', model: 'gem', cached: false, truncated: false });
calls.length = 0;
$('aiQ').value = '! 제목을 위로 옮기고 새 제목과 부제로 고쳐 줘';
$('aiQ').dispatchEvent(new w.Event('input', { bubbles: true }));
check('런타임: !를 입력하는 즉시 편집 모드 색·딱지가 켜진다',
  $('aiAsk').classList.contains('edit-on') && $('aiEditTag').hidden === false);
$('aiQ').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await tick(25); await flush();
{
  const editReq = JSON.parse(calls[0].body);
  check('런타임: !는 떼고 task=edit·문서 스냅샷·편집 요청을 보낸다',
    editReq.task === 'edit' && editReq.text === EDIT_SNAPSHOT
    && editReq.question === '제목을 위로 옮기고 새 제목과 부제로 고쳐 줘' && editReq.stream === true);
}
check('런타임: 명령 스트림 중에는 @ 원문을 보이지 않고 아직 적용하지 않는다',
  editApplied.length === 0 && !$('aiOut').textContent.includes('@'));
check('런타임: 처리 중에도 말풍선 딱지는 문서 편집이다',
  $('aiKind').hidden === false && $('aiKind').textContent === '문서 편집');
await tick(400); await flush();
check('런타임: done 뒤 파싱된 명령을 캡처 revision과 함께 한 번만 적용한다',
  editApplied.length === 1 && editApplied[0].revision === 'revision-before-ai'
  && editApplied[0].ops.length === 2 && editApplied[0].ops[1].text === '새 제목\n부제');
check('런타임: 말풍선에는 @ 명령 대신 요약과 적용 개수만 보인다',
  /제목을 위로 옮기고/.test($('aiOut').textContent)
  && /적용 2개/.test($('aiOut').textContent) && !$('aiOut').textContent.includes('@mv'));
check('런타임: 전송 뒤 편집 입력 딱지는 꺼진다',
  !$('aiAsk').classList.contains('edit-on') && $('aiEditTag').hidden === true);

// bridge가 stale을 알리면 모델 계획을 적용 성공처럼 표시하지 않는다.
w.__sdyAiBridge = {
  text: () => LONG,
  capture: () => ({ text: EDIT_SNAPSHOT, revision: 'old-revision' }),
  apply: () => ({ applied: 0, failed: 0, stale: true,
    notes: ['기다리는 동안 문서가 바뀌어서 적용하지 않았어요 · 다시 요청해 주세요'] }),
};
askRes = () => fakeRes(200, { ok: true, text: '@del t_1\n@done 지웠어요', provider: 'gemini', model: 'gem' });
$('aiQ').value = '/편집 첫 상자를 지워 줘';
w.sdyAiRun();
await tick(80); await flush();
check('런타임: 문서가 바뀐 stale 계획은 적용 완료로 표시하지 않는다',
  /문서가 바뀌어서 적용하지 않았어요/.test($('aiOut').textContent)
  && !/적용 1개/.test($('aiOut').textContent));
w.__sdyAiBridge = { text: () => LONG, title: () => '생물 노트' };

// ── 2-8) 대화기록 — 해돌이를 누르면 열리고, 고르면 말풍선으로 다시 본다 ──
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
    /첫 상자를 지워 줘/.test(items[0].textContent), items[0].textContent.slice(0, 50));
  check('런타임: 기록에 질문·편집 종류 딱지가 있다',
    w.document.querySelectorAll('.ai-hist-item .ai-kind').length >= 3
    && [...w.document.querySelectorAll('.ai-hist-item .ai-kind')].some((k) => /자유 질문/.test(k.textContent))
    && [...w.document.querySelectorAll('.ai-hist-item .ai-kind')].some((k) => /문서 편집/.test(k.textContent)));
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

// ── 2-9) 실패 경로 — 말풍선이 이유를 말해 준다 ──
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

// ── 2-10) 똑똑한 해돌이(14.25.0): ! 없는 자동 라우팅·새 명령·되묻기 ──
{
  const p2 = w.sdyAiEditParse([
    '@rp t_1 | 옛말 | 새말',
    '@rp t_2 | 지울말',
    '@ap t_1 | 뒤 | 덧붙는 줄',
    '@st t_1 | font=gaegu, fs=20, fg=빨강, hl=노랑, bold=on, align=center',
    '@st s_1 | color=#a63f47, size=3',
    '@add 1 | 60 | 400 | 300 | 80 | ~t_1 | 이웃 닮은 상자',
    '@tbl 1 | 60 | 200 | 2 | 3 | 이름|나이|지역\\n철수|7|서울',
    '@tsz tb_1 | 400 | 120',
    '@tmv tb_1 | 60 | 300',
    '@tcell tb_1 | 2 | 3 | 서울',
    '@tcell tb_1 | 1 | 1 |',
    '@goto 3',
    '@newpage',
    '@title 새 노트 이름',
    '@clip 1 | 60 | 400 | 300 | 80',
    '@clipin t_1 | 앞',
    '@copy t_1',
    '@ask 파란 상자와 빨간 상자 중 어느 것을 옮길까요?',
    '@nonsense blah',
    '@done 다 했어요',
  ].join('\n'));
  check('런타임: 새 명령 17종을 파싱하고 모르는 명령만 센다',
    p2.ops.length === 17 && p2.dropped === 1 && p2.say === '다 했어요', `${p2.ops.length}/${p2.dropped}`);
  check('런타임: 부분 바꾸기는 찾을 글·바꿀 글을 나누고 바꿀 글 없으면 지우기로 본다',
    p2.ops[0].cmd === 'rp' && p2.ops[0].find === '옛말' && p2.ops[0].repl === '새말'
    && p2.ops[1].cmd === 'rp' && p2.ops[1].find === '지울말' && p2.ops[1].repl === '');
  check('런타임: 덧붙이기·서식은 방향과 서식 덩어리를 살린다',
    p2.ops[2].cmd === 'ap' && p2.ops[2].dir === '뒤' && p2.ops[2].text === '덧붙는 줄'
    && p2.ops[3].cmd === 'st' && /font=gaegu/.test(p2.ops[3].style) && /align=center/.test(p2.ops[3].style));
  check('런타임: 새 상자는 ~id 서식 물려받기를 읽는다',
    p2.ops[5].cmd === 'add' && p2.ops[5].inherit === 't_1' && p2.ops[5].text === '이웃 닮은 상자');
  check('런타임: 표는 행·칸 구분을 살려 통째로 넘긴다',
    p2.ops[6].cmd === 'tbl' && p2.ops[6].rows === 2 && p2.ops[6].cols === 3
    && p2.ops[6].text === '이름|나이|지역\n철수|7|서울');
  check('런타임: 표 크기·이동·칸(빈 칸 비우기 포함)·쪽 이동·새 쪽·제목을 파싱한다',
    p2.ops[7].cmd === 'tsz' && p2.ops[8].cmd === 'tmv'
    && p2.ops[9].cmd === 'tcell' && p2.ops[9].r === 2 && p2.ops[9].c === 3 && p2.ops[9].text === '서울'
    && p2.ops[10].cmd === 'tcell' && p2.ops[10].text === ''
    && p2.ops[11].cmd === 'goto' && p2.ops[11].page === 3
    && p2.ops[12].cmd === 'newpage' && p2.ops[13].cmd === 'title' && p2.ops[13].text === '새 노트 이름');
  check('런타임: 클립보드 3종과 되묻기를 파싱한다',
    p2.ops[14].cmd === 'clip' && p2.ops[14].w === 300 && p2.ops[14].h === 80
    && p2.ops[15].cmd === 'clipin' && p2.ops[15].dir === '앞'
    && p2.ops[16].cmd === 'copy' && p2.ops[16].id === 't_1'
    && p2.ask === '파란 상자와 빨간 상자 중 어느 것을 옮길까요?');
}

// 자동 라우팅용 편집 다리 — 비동기(clipboard) 없이 동기 적용만 기록한다
const autoApplied = [];
const autoBodies = [];
w.__sdyAiBridge = {
  text: () => LONG,
  capture: () => ({ text: EDIT_SNAPSHOT, revision: 'rev-auto' }),
  apply: (ops, revision) => {
    autoApplied.push({ ops, revision });
    return { applied: ops.length, failed: 0, notes: [], stale: false };
  },
};
const origFetch = w.fetch;
w.fetch = (url, opts = {}) => {
  if (String(url) === '/api/ai/ask') autoBodies.push(JSON.parse(opts.body || '{}'));
  return origFetch(url, opts);
};
check('런타임: 고쳐 달라는 말투는 ! 없이도 편집으로 본다',
  w.sdyAiLooksLikeEdit('제목을 맨 위로 옮겨 줘') === true
  && w.sdyAiLooksLikeEdit('두 번째 상자 글자를 빨갛게 해줘') === true
  && w.sdyAiLooksLikeEdit('표 만들어 줘') === true);
check('런타임: 물음 말투·일반 질문은 편집으로 보내지 않는다 (!는 강제라 제외)',
  w.sdyAiLooksLikeEdit('어디서 일어나?') === false
  && w.sdyAiLooksLikeEdit('표는 어떻게 만들어?') === false
  && w.sdyAiLooksLikeEdit('이게 뭔지 알려줘') === false
  && w.sdyAiLooksLikeEdit('!강제 편집') === false);
askRes = () => fakeRes(200, { ok: true, text: '@mv t_1 | 40 | 20\n@done 제목을 맨 위로 옮겼어요',
  provider: 'gemini', model: 'gem' });
calls.length = 0; autoBodies.length = 0; autoApplied.length = 0;
$('aiQ').value = '제목을 맨 위로 옮겨 줘';
$('aiQ').dispatchEvent(new w.Event('input', { bubbles: true }));
check('런타임: ! 없이도 고쳐 달라는 말을 치면 편집 딱지가 켜진다',
  $('aiAsk').classList.contains('edit-on') && $('aiEditTag').hidden === false);
$('aiQ').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await tick(80); await flush();
check('런타임: ! 없는 편집 말투는 task=edit 으로 가고 말은 통째로 실린다',
  autoBodies.length === 1 && autoBodies[0].task === 'edit'
  && autoBodies[0].question === '제목을 맨 위로 옮겨 줘' && autoBodies[0].text === EDIT_SNAPSHOT);
check('런타임: 자동 라우팅 편집도 캡처 revision으로 적용하고 요약한다',
  autoApplied.length === 1 && autoApplied[0].revision === 'rev-auto'
  && /제목을 맨 위로 옮겼어요/.test($('aiOut').textContent) && /적용 1개/.test($('aiOut').textContent));
check('런타임: 자동 라우팅에도 문서 편집 딱지가 붙는다',
  $('aiKind').hidden === false && $('aiKind').textContent === '문서 편집');

// 물음이 섞인 편집 단어는 질문으로 — 서버가 답한다
askRes = () => fakeRes(200, { ok: true, text: '[[note]]\n표 단추를 누르면 돼요', provider: 'groq', model: 'm' });
autoBodies.length = 0; autoApplied.length = 0;
$('aiQ').value = '표는 어떻게 만들어?';
w.sdyAiRun();
await tick(80); await flush();
check('런타임: 어떻게 같은 물음은 편집 단어가 있어도 chat 으로 간다',
  autoBodies.length === 1 && autoBodies[0].task === 'chat' && autoApplied.length === 0
  && $('aiKind').textContent === '노트 질문');

// 서버 [[edit]] — chat 으로 나갔다가 편집으로 자동 넘기기 (한 번만)
askRes = (url, b) => (b.task === 'chat'
  ? fakeRes(200, { ok: true, text: '[[edit]]', provider: 'groq', model: 'm' })
  : fakeRes(200, { ok: true, text: '@tx t_1 | 손본 내용\n@done 손봐뒀어요', provider: 'groq', model: 'm' }));
autoBodies.length = 0; autoApplied.length = 0;
$('aiQ').value = '저거 좀 손봐줘';
w.sdyAiRun();
await tick(120); await flush();
check('런타임: 서버 [[edit]] 이면 스냅샷을 잡아 edit 으로 넘긴다',
  autoBodies.length === 2 && autoBodies[0].task === 'chat' && autoBodies[1].task === 'edit'
  && autoBodies[1].text === EDIT_SNAPSHOT && autoApplied.length === 1);
check('런타임: 넘겨받은 편집 결과가 말풍선에 요약된다',
  /손봐뒀어요/.test($('aiOut').textContent) && $('aiKind').textContent === '문서 편집');

// @ask 되묻기 — 실행 없이 질문만, 다음 요청에 문맥으로 실린다
askRes = () => fakeRes(200, { ok: true, text: '@ask 파란 상자와 빨간 상자 중 어느 것을 옮길까요?\n@done 되묻기',
  provider: 'groq', model: 'm' });
autoBodies.length = 0; autoApplied.length = 0;
$('aiQ').value = '! 상자 옮겨 줘';
w.sdyAiRun();
await tick(80); await flush();
check('런타임: @ask 는 적용 없이 질문을 말풍선에 싣는다',
  autoApplied.length === 0 && /어느 것을 옮길까요/.test($('aiOut').textContent)
  && /이어서 할게요/.test($('aiOut').textContent));
askRes = () => fakeRes(200, { ok: true, text: '@mv t_9 | 10 | 10\n@done 파란 상자를 옮겼어요',
  provider: 'groq', model: 'm' });
autoBodies.length = 0;
$('aiQ').value = '! 파란 상자';
w.sdyAiRun();
await tick(80); await flush();
check('런타임: 다음 편집 요청에 직전 1턴 문맥이 실린다',
  autoBodies.length === 1 && /이전 요청: 상자 옮겨 줘/.test(autoBodies[0].context || '')
  && /어느 것을 옮길까요/.test(autoBodies[0].context || ''));

// 비동기 적용(clipboard) — Promise 를 기다렸다 마무리한다
w.__sdyAiBridge = {
  text: () => LONG,
  capture: () => ({ text: EDIT_SNAPSHOT, revision: 'rev-async' }),
  apply: () => new Promise((resolve) => setTimeout(
    () => resolve({ applied: 1, failed: 0, notes: [], stale: false }), 30)),
};
askRes = () => fakeRes(200, { ok: true, text: '@copy t_1\n@done 복사했어요', provider: 'groq', model: 'm' });
$('aiQ').value = '! 복사해 줘';
w.sdyAiRun();
await tick(120); await flush();
check('런타임: 비동기 적용이 끝나야 요약이 나온다',
  /복사했어요/.test($('aiOut').textContent) && /적용 1개/.test($('aiOut').textContent));
w.__sdyAiBridge = { text: () => LONG, title: () => '생물 노트' };
w.fetch = origFetch;

console.log(`\n  ${pass} passed`);
