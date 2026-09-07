// The missing regression: a real imported page, still represented by a preview image,
// is clicked for the FIRST time. Existing edit-lag tests start after plain-text DOM exists.
import assert from 'node:assert/strict';
import jsdom from 'jsdom';
const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;
import { activationFixture, openActivationNote, makeDoc, makePage, BOXES } from './page_activation_fixture.mjs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';

const fixture = await activationFixture();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let dom, pass = 0;
const check = (name, condition) => { assert.ok(condition, name); console.log('  ✓ ' + name); pass++; };
async function until(fn, name, ms = 6000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await wait(15);
  assert.ok(fn(), name);
}
try {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented|Could not load|HTMLMediaElement/.test(e.message)) errors.push(e.message); });
  dom = await JSDOM.fromURL(fixture.base + '/?sandbox=1&turbo=1', {
    resources: { interceptors: [requestInterceptor(req => req.url.startsWith(fixture.base) ? undefined : new Response(''))] }, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      installWindowGuard(w);
      w.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      w.IntersectionObserver = w.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      w.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      w.EventSource = class { close(){} addEventListener(){} };
      w.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, save(){}, restore(){}, measureText(){ return { width: 10 }; } });
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      w.Audio = class { constructor(){ this.paused = true; } play(){ return Promise.resolve(); } pause(){} addEventListener(){} removeEventListener(){} };
      w.confirm = () => true; w.alert = () => {}; w.prompt = () => null;
      w.fetch = (u, opts) => fetch(new URL(String(u), w.location.href), opts);
      w.__imageURLs = []; w.__autoImages = true; w.__holdDecode = true; w.__decodes = [];
      Object.defineProperty(w.HTMLImageElement.prototype, 'src', { configurable: true,
        set(value) {
          this.setAttribute('src', value); w.__imageURLs.push(value);
          if (w.__autoImages) w.setTimeout(() => this.dispatchEvent(new w.Event('load')), 5);
        }, get(){ return this.getAttribute('src') || ''; } });
      w.HTMLImageElement.prototype.decode = () => w.__holdDecode
        ? new Promise(resolve => w.__decodes.push(resolve)) : Promise.resolve();
      Object.defineProperty(w.HTMLElement.prototype, 'contentEditable', { configurable: true,
        get(){ return this.getAttribute('contenteditable') || 'inherit'; },
        set(v){ this.setAttribute('contenteditable', v); } });
      w.addEventListener('error', e => errors.push(e.error?.stack || e.message));
    },
  });
  const w = dom.window, d = w.document, ev = source => w.eval(source);
  await until(() => typeof w.openNB === 'function', 'app boot');
  const body = d.getElementById('editorBody');
  Object.defineProperties(body, { clientWidth: { get: () => 1200 }, clientHeight: { get: () => 900 } });
  body.scrollTo = opts => { body.scrollTop = opts.top || 0; body.dispatchEvent(new w.Event('scroll')); };
  await ev(`(${openActivationNote.toString()})()`);
  const paper = pi => d.querySelector(`.paper[data-page-idx="${pi}"]`);
  const preview = pi => paper(pi)?.querySelector('.page-preview-img');
  const ready = pi => ev(`pageReady(${pi})`);
  const go = pi => { ev(`deselectAll(); clearMulti(); goToPage(${pi + 1})`); };
  const pointer = (target, type, opts = {}) => {
    const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: 60, clientY: 48, detail: 1, ...opts });
    Object.defineProperty(e, 'pointerType', { value: opts.pointerType || 'mouse' });
    target.dispatchEvent(e);
  };
  const rect = pi => { paper(pi).getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100 }); };

  const draft = preview(0);
  check('실제 열기 경로는 480px 초벌 그림으로 즉시 시작한다', draft && draft.src.endsWith('w=480'));
  await until(() => w.__decodes.length > 0, 'visible preview quality upgrade');
  check('편집하지 않아도 보이는 쪽은 화면 해상도로 승급한다', w.__imageURLs.some(u => u.endsWith('/0?w=900')));
  check('고화질 decode 전에는 초벌 그림을 제거하지 않는다', preview(0) === draft);
  w.__holdDecode = false; w.__decodes.splice(0).forEach(resolve => resolve());
  await until(() => preview(0) !== draft, 'decoded swap');
  check('읽기 화질 승급이 글상자 DOM을 만들지 않는다', d.querySelectorAll('#pagesStage .tb').length === 0);
  const sharp = preview(0);
  w.__autoImages = false; w.devicePixelRatio = 2;
  ev('upgradePagePreview(0); _previewUpgrades.get(paperQ(0,".page-preview-img")).next.onerror()');
  check('상위 화질 요청 실패는 기존 그림을 훼손하거나 편집 폴백하지 않는다', preview(0) === sharp && ev('_pvFailed.size') === 0);
  w.devicePixelRatio = 1; w.__autoImages = true;

  go(16);
  await until(() => ev('doc.pages[16].__lazy==null'), 'visible slice warmup');
  check('보이는 쪽의 데이터만 예열하며 저사양 전체 프리필을 되살리지 않는다',
    fixture.requests.some(u => u.includes('from=16')) && !fixture.requests.some(u => u.includes('from=8')));
  check('데이터 예열 뒤에도 읽기 화면은 그림 한 장이다', !!preview(16) && !paper(16).querySelector('.tb'));
  check('읽기 데이터 예열은 먼 쪽을 다시 lazy로 돌려 메모리를 제한한다', ev('doc.pages[0].__lazy!=null'));
  go(0); rect(0); await ev('ensureLazyPage(0)');

  const before = ev('JSON.stringify(doc.pages[0].els)');
  const hashBefore = ev('doc.__lastHash.get("t0_0")');
  ev(`window.__builds=[]; window.__frame=0;
    window.__build=buildTextEl; window.__drain=_drainPageRenders;
    buildTextEl=function(el,pi){ __builds.push({pi,frame:__frame}); return __build(el,pi); };
    _drainPageRenders=function(){ __frame++; return __drain(); };`);
  const first = ev('activatePage(0)'), job = ev('_pageRenderJobs.get(0)');
  check('첫 활성화 호출 안에서는 무거운 글상자를 하나도 만들지 않는다', w.__builds.length === 0);
  check('준비 중은 완료로 표시되지 않고 미리보기를 유지한다', !ready(0) && !!preview(0));
  check('중복 활성화는 같은 Promise와 작업을 재사용한다', first === ev('activatePage(0)') && job === ev('_pageRenderJobs.get(0)'));
  check('중복 활성화가 미리보기를 조기에 걷지 않는다', !!preview(0));
  assert.equal(await first, true);
  check('완료 후에만 원본 그림을 걷고 전체 요소가 편집 준비된다', ready(0) && !preview(0) && paper(0).querySelectorAll('.tb').length === BOXES);
  const frames = new Set(w.__builds.filter(b => b.pi === 0).map(b => b.frame));
  check('120개 미만의 문단도 실제 단어량에 따라 여러 프레임에 분산된다', frames.size > 2);
  check('활성화 자체는 원문 데이터를 바꾸지 않는다', ev('JSON.stringify(doc.pages[0].els)') === before);
  ev('buildTextEl=__build; _drainPageRenders=__drain');

  // Simulated layout getters check read/write ordering; jsdom by itself has NO layout engine.
  // The real-browser companion checks actual style/layout cost and pointer latency.
  const tb = paper(0).querySelector('.tb'), c = tb.querySelector('.tb-content');
  Object.defineProperties(c, { clientWidth: { get: () => 350 }, clientHeight: { get: () => 52 } });
  const trace = []; let measure = false;
  for (const span of c.children) {
    for (const [key, value] of Object.entries({ offsetLeft: parseFloat(span.style.left), offsetTop: parseFloat(span.style.top), scrollWidth: 50, offsetHeight: 10 })) {
      Object.defineProperty(span, key, { get(){ if (measure) trace.push('read'); return value; } });
    }
    Object.defineProperty(span.style, 'transform', { get(){ return this.getPropertyValue('transform'); }, set(v){ if (measure) trace.push('write'); this.setProperty('transform', v); } });
  }
  measure = true; ev('fitTightSpans(paperQ(0,".tb-content"),findEl(0,"t0_0"))'); measure = false;
  const firstWrite = trace.indexOf('write');
  check('단어 맞춤은 모든 레이아웃 읽기 후에만 스타일을 쓴다', firstWrite > 0 && trace.slice(firstWrite).every(v => v === 'write'));
  check('단어 맞춤도 원문 html/dirty/동기화 해시를 수정하지 않는다', ev('JSON.stringify(doc.pages[0].els)') === before && !ev('pageEdited(0)')
    && ev('doc.__lastHash.get("t0_0")') === hashBefore);
  trace.length = 0; measure = true;
  ev('fitTightSpans(paperQ(0,".tb-content"),findEl(0,"t0_0"))'); measure = false;
  check('같은 원문/크기/폰트의 재맞춤은 레이아웃 캐시를 쓴다', !trace.includes('read'));
  trace.length = 0; measure = true;
  ev('_tightFontEpoch++; fitTightSpans(paperQ(0,".tb-content"),findEl(0,"t0_0"))'); measure = false;
  check('늦게 로드된 웹폰트는 폭 캐시를 무효화한다', trace.includes('read'));
  ev('_tightFontEpoch++; window.__fitJob={readAt:0}; _measureTightSpans(paperQ(0,".tb-content"),findEl(0,"t0_0"),__fitJob,0)');
  check('단일 문단 안에서도 읽기 예산이 끝나면 중간에서 멈춘다', w.__fitJob.readAt === 1);
  ev('window.__fit=_measureTightSpans(paperQ(0,".tb-content"),findEl(0,"t0_0"),__fitJob,Infinity); _applyTightFit(__fit,Infinity,8)');
  check('쓰기 역시 단어 단위로 예산을 나누고 원문을 건드리지 않는다', w.__fit.writeAt === 8 && ev('JSON.stringify(doc.pages[0].els)') === before);
  ev('findEl(0,"t0_0").fontSize=10.5; paperQ(0,".tb-content").style.fontSize="10.5px"; enterEdit(paperQ(0,".tb"),true); commitEditingText(); deselectAll()');
  check('소수점 글자 크기도 편집 진입만으로 반올림/저장되지 않는다', ev('findEl(0,"t0_0").fontSize') === 10.5 && !ev('pageEdited(0)'));
  ev('findEl(0,"t0_0").fontSize=10; paperQ(0,".tb-content").style.fontSize="10px"');
  ev('window.__selectionStrings=0; const ss=getSelection(); window.__selectionString=ss.toString; ss.toString=function(){ __selectionStrings++; return __selectionString.call(this); }; for(let i=0;i<20;i++) liveAct(); ss.toString=__selectionString');
  check('실시간 활동 표시가 선택 문자열/페이지 본문을 직렬화하지 않는다', w.__selectionStrings === 0);

  check('편집 진입 후 아무것도 안 쓰고 나와도 표시용 압축을 저장하지 않는다', !ev('pageEdited(0)'));

  go(2); rect(2);
  pointer(paper(2), 'pointerdown'); body.dispatchEvent(new w.Event('scroll'));
  check('누르기 전에 예약됐던 무이동 scroll 알림은 첫 클릭을 버리지 않는다', ev('_pagePointerIntent') !== null);
  pointer(d, 'pointerup');
  await until(() => ready(2), 'first pointer replay');
  check('첫 클릭은 페이지를 깨우기만 하는 대신 누른 글상자를 선택한다', paper(2).querySelector('.tb.sel')?.dataset.id === 't2_0');

  go(3); rect(3);
  pointer(paper(3), 'pointerdown', { detail: 2 }); pointer(d, 'pointerup');
  await until(() => !!paper(3)?.querySelector('.tb.edit'), 'double-click replay');
  check('준비 중 더블클릭도 해당 상자의 편집으로 이어진다', paper(3).querySelector('.tb.edit')?.dataset.id === 't3_0');
  const original = ev('findEl(3,"t3_0").html');
  const edit = paper(3).querySelector('.tb.edit .tb-content');
  edit.append('수정'); edit.dispatchEvent(new w.InputEvent('input', { bubbles: true }));
  await until(() => ev('findEl(3,"t3_0").html.includes("수정")'), 'typing commit');
  check('실제 입력은 edited로 표시하고 데이터에 반영한다', ev('pageEdited(3)'));
  ev('undo()'); await until(() => ready(3), 'undo ready');
  check('비동기 렌더 후에도 상자 패치 undo가 원문을 복구한다', ev('findEl(3,"t3_0").html') === original);
  ev('redo()'); await until(() => ready(3), 'redo ready');
  check('redo도 편집분을 복구한다', ev('findEl(3,"t3_0").html.includes("수정")'));
  go(20); go(3); await until(() => ready(3), 'edited page revisit');
  check('고친 쪽은 언마운트 후에도 원본 그림으로 덮이지 않는다', !preview(3) && ev('findEl(3,"t3_0").html.includes("수정")'));

  go(4); rect(4);
  pointer(paper(4), 'pointerdown', { pointerType: 'touch' });
  pointer(d, 'pointermove', { pointerType: 'touch', clientY: 150 }); pointer(d, 'pointerup', { pointerType: 'touch' });
  await wait(60);
  check('읽기 페이지의 터치 스크롤은 편집 DOM 생성을 시작하지 않는다', !ev('activatedPages.has(4)') && !paper(4).querySelector('.tb'));
  pointer(paper(4), 'pointerdown'); body.scrollTop += 20; body.dispatchEvent(new w.Event('scroll')); pointer(d, 'pointerup');
  await until(() => ready(4), 'cancelled tap completes safely');
  check('준비 중 스크롤한 뒤 늦게 첫 클릭을 재생하지 않는다', !paper(4).querySelector('.sel,.edit'));
  go(20); go(4);
  check('선택만 했던 쪽은 돌아왔을 때 다시 가벼운 그림을 쓸 수 있다', !!preview(4) && !ev('activatedPages.has(4)'));

  go(5); rect(5);
  pointer(paper(5), 'pointerdown', { pointerType: 'touch' });
  check('터치 down만으로는 활성화하지 않는다', !ev('activatedPages.has(5)'));
  d.dispatchEvent(new w.Event('pointercancel', { bubbles: true })); pointer(d, 'pointerup', { pointerType: 'touch' });
  check('브라우저가 취소한 터치를 재생하지 않는다', ev('_pagePointerIntent') === null && !ev('activatedPages.has(5)'));
  pointer(paper(5), 'pointerdown', { pointerType: 'touch' }); pointer(d, 'pointerup', { pointerType: 'touch' });
  await until(() => ready(5), 'touch tap');
  check('스크롤이 아닌 터치 탭은 첫 대상 선택을 보존한다', paper(5).querySelector('.tb.sel')?.dataset.id === 't5_0');

  go(7); rect(7);
  ev('textToolActive=true');
  pointer(paper(7), 'pointerdown', { clientY: 1080 }); pointer(d, 'pointerup', { clientY: 1080 });
  await until(() => !!paper(7)?.querySelector('.tb.edit'), 'text tool first placement');
  check('글상자 도구의 첫 빈 공간 클릭도 새 상자를 놓고 편집한다', ev('doc.pages[7].els.length') === BOXES + 2);
  ev('deselectAll(); textToolActive=false');

  go(9); rect(9); await ev('ensureLazyPage(9)');
  pointer(paper(9), 'pointerdown'); pointer(d, 'pointerup');
  ev('findEl(9,"t9_0").html+="remote"; _selectiveRenderPage(9,null)');
  await until(() => ready(9), 'replacement render');
  check('준비 중 원격 갱신은 오래된 청크를 섞지 않고 첫 선택도 유지한다',
    paper(9).querySelectorAll('.tb').length === BOXES && paper(9).querySelector('.tb.sel')?.dataset.id === 't9_0'
    && paper(9).querySelector('[data-id="t9_0"]').textContent.includes('remote'));

  go(10); rect(10);
  pointer(paper(10), 'pointerdown'); pointer(d, 'pointerup');
  ev('textToolActive=true');
  await until(() => ready(10), 'mode change cancels tap');
  check('준비 중 도구가 바뀌면 늦은 클릭을 취소하고 포인터 상태도 정리한다',
    ev('_pagePointerIntent') === null && !paper(10).querySelector('.tb.sel,.tb.edit'));
  ev('textToolActive=false');

  // Model-only formatting is a real imported-page edit, even when HTML is unchanged.
  ev('doc.pages[10].els=[{...findEl(10,"t10_0"),html:"sent text",tight:false}]');
  await ev('renderPageEls(10)');
  const fontBox = paper(10).querySelector('.tb');
  ev('selected={type:"text",el:paperAt(10).querySelector(".tb")}; selected.el.classList.add("sel")');
  w.applyFont('gaegu');
  check('본문이 같은 상자 전체 글꼴 변경도 편집/저장 대상으로 표시한다',
    ev('pageEdited(10) && findEl(10,"t10_0").font==="gaegu" && findEl(10,"t10_0").html==="sent text"'));

  // Deliberately hold a save ACK across the next formatting action. Previously
  // genOps handed fetch a live element; ACK re-read that mutated object as the
  // "sent" base, then its own echo replaced the newer text AND selected DOM.
  const ops = w.genOps().filter(o => o.id === 't10_0');
  check('생성한 동기화 op는 편집 중인 모델과 같은 객체를 공유하지 않는다',
    ops.length === 1 && ops[0].data !== ev('findEl(10,"t10_0")'));
  const rawFetch = w.fetch;
  let sent, releaseACK;
  w.fetch = (url, options) => {
    if (String(url).includes('/api/sync/push')) {
      sent = JSON.parse(options.body).ops;
      return new Promise(resolve => { releaseACK = () => resolve(new Response(JSON.stringify({ ok: true, accepted: sent.map(o => o.id) }))); });
    }
    if (String(url).includes('/api/sync/pull'))
      return Promise.resolve(new Response(JSON.stringify({ ok: true, version: sent[0].rev, ops: sent })));
    return rawFetch(url, options);
  };
  try {
    const flight = w.pushOps(ops);
    await until(() => !!releaseACK, 'held save ACK');
    w.applyFont('jua'); w.execFmt('bold');
    ev('clearTimeout(opsTimer)');
    const latest = ev('findEl(10,"t10_0").html');
    check('전송 중 다음 서식이 바뀌어도 이미 생성한 op의 본문은 고정된다', ops[0].data.html === 'sent text');
    ops[0].data.html = 'caller changed its own payload'; // explicit pushOps(pre) also owns a snapshot
    releaseACK(); await flight;
    check('늦은 저장 응답은 실제 전송한 본문만 동기화 기준으로 확정한다',
      ev('doc.__base.get("t10_0")') === sent[0].data.html);
    check('자기 저장 에코가 다음 서식/글꼴이나 선택한 DOM을 되돌리지 않는다',
      ev('findEl(10,"t10_0").html') === latest && latest.includes('font-weight')
      && ev('findEl(10,"t10_0").font') === 'jua' && fontBox.isConnected && fontBox.classList.contains('sel'));
  } finally { w.fetch = rawFetch; }

  // A delayed slice response, render frame and image error must not cross documents.
  go(8);
  ev(`window.__ensure=ensureLazyPage; window.__loads=0;
    doc.pages[8]={id:'lazy_8',els:[],__lazy:1};
    ensureLazyPage=function(){ __loads++; return new Promise(resolve=>{ window.__resolveSlice=resolve; }); };`);
  const staleError = preview(8)?.onerror;
  const pending = ev('activatePage(8)');
  check('lazy 페이지 활성화 중복도 요청을 합친다', pending === ev('activatePage(8)') && w.__loads === 1);
  w.__newDoc = makeDoc();
  ev('doc=__newDoc; doc.__ref="different-note"; curPageIdx=0; document.getElementById("editorBody").scrollTop=0; renderPages()');
  assert.equal(await pending, false);
  w.__resolveSlice(); if (staleError) staleError(); await wait(30);
  check('옛 슬라이스/그림 콜백이 새 문서를 렌더하거나 폴백시키지 않는다', ev('_pvFailed.size') === 0 && !paper(0).querySelector('.tb'));
  check('문서 전환은 예약된 렌더/포인터 작업을 남기지 않는다', ev('_pageRenderJobs.size') === 0 && ev('_pagePointerIntent') === null);

  ev('doc.pages[0]={id:"lazy_0",els:[],__lazy:1}; ensureLazyPage=function(){ __loads++; return Promise.resolve(); }');
  const calls = w.__loads;
  assert.equal(await ev('activatePage(0)'), false);
  await wait(30);
  check('실패한 lazy 로드가 렌더 재귀/무한 재요청을 만들지 않는다', w.__loads === calls + 1 && ev('_pageRenderJobs.size') === 0 && !!preview(0));
  w.__recovered = makePage(0);
  ev('ensureLazyPage=function(){ doc.pages[0]=__recovered; return Promise.resolve(); }');
  assert.equal(await ev('activatePage(0)'), true);
  check('다음 활성화에서 로드가 복구되면 정상 편집으로 전환된다', ready(0));
  ev('ensureLazyPage=__ensure');

  go(6); rect(6);
  ev('penActive=true; paperAt(6).classList.add("drawing")');
  pointer(paper(6).querySelector('.draw-surface'), 'pointerdown');
  pointer(d, 'pointermove', { clientX: 95, clientY: 80 }); pointer(d, 'pointerup');
  await until(() => ready(6) && ev('doc.pages[6].els.some(e=>e.type==="stroke")'), 'first buffered stroke');
  check('준비 중 첫 펜 획도 시작점/끝점을 잃지 않는다', ev('doc.pages[6].els.find(e=>e.type==="stroke").pts.length') >= 2);
  ev('penActive=false');
  const inkId = ev('doc.pages[6].els.find(e=>e.type==="stroke").id');
  check('펜 획도 텍스트처럼 실제 편집으로 기록한다', ev('pageEdited(6) && doc.pages[6].__dirty'));
  go(20); go(6); await until(() => ready(6), 'ink revisit');
  check('그린 뒤 회수/재방문해도 원본 그림으로 돌아가 획을 숨기지 않는다',
    !preview(6) && !!paper(6).querySelector(`[data-id="${inkId}"]`));

  go(11); rect(11); await ev('activatePage(11)');
  ev('insertTable(2,2,11,40,40)');
  await until(() => ready(11), 'table insert readiness');
  check('무거운 쪽에 표를 넣어도 완료 후 선택 테두리와 네 칸이 함께 보인다',
    paper(11).querySelectorAll('.tb.in-tbl').length === 4 && !!paper(11).querySelector('.tbl-box.on') && ev('pageEdited(11)'));
  ev('tblCellSelection={pageIdx:11,tid:activeTbl.tid,r0:0,c0:0,r1:1,c1:1}; tblCellApply(el=>{el.html="cell";},"test")');
  await until(() => ready(11), 'table formatting readiness');
  check('비동기 표 재렌더 완료 뒤 칸 내용과 선택 범위를 복구한다',
    paper(11).querySelectorAll('.tbl-cell-sel').length === 4
    && [...paper(11).querySelectorAll('.tb.in-tbl .tb-content')].every(c => c.textContent === 'cell'));
  go(20); go(11); await until(() => ready(11), 'table revisit');
  check('표 편집도 회수/재방문 시 원본 미리보기로 덮이지 않는다', !preview(11) && paper(11).querySelectorAll('.tb.in-tbl').length === 4);
  check('전환·입력·되돌리기·취소 경로에 런타임 오류가 없다', errors.length === 0);
} finally {
  await closeDoms([dom]); await fixture.close();
}
console.log(`\n읽기 → 편집 전환: PASS ${pass}`);
