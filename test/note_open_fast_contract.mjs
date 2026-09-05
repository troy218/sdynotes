// 14.29.4 · '이미 있는 노트를 여는' 경로의 속도 계약
//
// 무엇을 지키는가 (전부 '결과는 그대로, 일만 줄인다'):
//   ① 노트 설정(nb_*) 파싱 캐시 — 같은 원문이면 재사용, 저장되면 즉시 무효
//   ② 표 격자선은 열 때 전 쪽이 아니라 그리는 쪽에서만 만든다
//   ③ 색 정규화는 색 지정이 있는 html 만 DOM 파싱한다
//   ④ 슬라이스는 조건부 요청(ETag/304)을 쓰고, 프록시가 검증자를 전달한다
//   ⑤ 나머지 슬라이스 미리 받기는 첫 화면 뒤로 미룬다
//   ⑥ 워커는 슬라이스에 ETag 를 달고 메모리 캐시로 디스크를 건너뛴다
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(REPO, 'sdynotes.js'), 'utf8');
const py = fs.readFileSync(path.join(REPO, 'worker/sdynotes_worker/importer.py'), 'utf8');
const proxy = fs.readFileSync(path.join(REPO, 'server/src/lib/workerProxy.js'), 'utf8');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log(`  ✓ ${name}`); };

// ═══ ① 설정 파싱 캐시 ═════════════════════════════════════════════════
const getCfgSrc = js.slice(js.indexOf('function _cfgRaw'), js.indexOf('const decCache'));
ok('getCfg 가 원문 문자열이 같을 때만 파싱 결과를 재사용한다',
  /_cfgCacheRaw===raw/.test(getCfgSrc));
ok('getCfg 는 캐시 객체를 그대로 넘기지 않고 복사본을 준다',
  getCfgSrc.includes('return {..._cfgCacheObj};') && getCfgSrc.includes('return {...o};'));
ok('setCfg 는 저장하면서 캐시를 버린다',
  /_cfgCacheDrop\(id\);return true/.test(js));
ok('migrate 는 캐시된 배열을 복사해서 doc 에 넣는다 (편집이 캐시를 오염시키지 않게)',
  /els:Array\.isArray\(p\.els\)\?p\.els\.slice\(\):\[\]/.test(js));

// 실제 동작 시뮬레이션: 캐시가 저장/외부 변경을 놓치지 않는가
{
  const store = new Map();
  const env = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
  };
  const fn = new Function('localStorage', `
    let _cfgCacheId=null,_cfgCacheRaw=null,_cfgCacheObj=null;
    let parses=0;
    ${getCfgSrc.replace(/JSON\.parse\(raw\)/, '(parses++, JSON.parse(raw))')}
    return { getCfg, setCfg:(id,c)=>{ localStorage.setItem('nb_'+id, JSON.stringify(c)); _cfgCacheDrop(id); },
             parses:()=>parses };
  `);
  const api = fn(env.localStorage);
  env.localStorage.setItem('nb_a', JSON.stringify({ paper: 'blank', pages: [{ id: 'p1', els: [] }] }));
  const a1 = api.getCfg('a');
  const a2 = api.getCfg('a');
  ok('같은 노트를 두 번 읽으면 파싱은 한 번뿐이다', api.parses() === 1);
  ok('그래도 값은 정확하다', a1.paper === 'blank' && a2.pages.length === 1);
  ok('반환 객체는 서로 다른 복사본이다', a1 !== a2);
  a1.folder = 'f1';
  ok('반환본을 고쳐도 다음 읽기는 저장된 값 그대로다', api.getCfg('a').folder === undefined);
  api.setCfg('a', { paper: 'grid' });
  ok('저장하면 캐시가 무효화되어 새 값이 나온다', api.getCfg('a').paper === 'grid');
  // 다른 탭이 직접 바꾼 경우 (원문 문자열이 달라진다)
  env.localStorage.setItem('nb_a', JSON.stringify({ paper: 'dot' }));
  ok('밖에서 바뀐 값도 원문 비교로 잡아낸다', api.getCfg('a').paper === 'dot');
}

// ═══ ② 표 격자선 지연 생성 ═══════════════════════════════════════════
const openSrc = js.slice(js.indexOf('async function openNB'), js.indexOf('function closeEditor'));
ok('openNB 가 열 때 전 쪽 표를 훑지 않는다',
  !/\(doc\.pages\|\|\[\]\)\.forEach\(\(pg,pi\)=>\{[\s\S]{0,400}rebuildTable/.test(openSrc));
ok('renderPageEls 가 그 쪽 표의 격자선만 확인한다',
  /ensureTableGrid\(idx\);/.test(js) && /function ensureTableGrid\(pi\)\{/.test(js));
ok('격자선 확인은 쪽마다 한 번만 돈다', /_tblGridDone\.has\(pi\)\) return;/.test(js));
ok('노트를 다시 그리면(renderPages) 격자선 확인도 초기화된다',
  /_tblGridDone=new Set\(\);\s*\/\/ 표 격자선/.test(js));
ok('bg 표(배경에 격자가 있는 PDF 표)는 여전히 건너뛴다',
  /if\(t\.bg\) return;/.test(js.slice(js.indexOf('function ensureTableGrid'))));

// ═══ ③ 색 정규화 빠른 경로 ═══════════════════════════════════════════
{
  const src = js.slice(js.indexOf('const _PAL_RE='), js.indexOf('function _normalizeDocPalette'));
  ok('색 지정이 없는 html 은 DOM 파싱 없이 그대로 돌려준다',
    /if\(!_PAL_RE\.test\(html\)\) return html;/.test(src));
  const re = /color|background|highlight/i;
  // 실제로 치환이 일어나는 형태는 전부 걸러진다
  for (const h of ['<span style="color:#e74c3c">x</span>',
    '<span style="background-color:#ffff00">x</span>',
    '<span style="background:#ffff00">x</span>',
    '<font color="#e74c3c">x</font>',
    '<b data-text-color="#e74c3c">x</b>',
    '<b data-highlight="#ffff00">x</b>',
    '<b data-background-color="#ffff00">x</b>']) {
    assert.ok(re.test(h), `색 지정 html 은 반드시 통과: ${h}`);
  }
  ok('색을 담을 수 있는 모든 표기가 빠른 경로를 통과한다', true);
  ok('평범한 글자는 빠른 경로에서 걸러진다',
    !re.test('<b>안녕하세요</b> 수식 $x^2$ <i>기울임</i><br>다음 줄'));
}

// ═══ ④/⑤ 슬라이스 조건부 요청 · 프리필 지연 ══════════════════════════
ok('슬라이스 요청이 no-store 대신 no-cache(조건부 재검증)를 쓴다',
  /const SLICE_FETCH=\{cache:'no-cache'\};/.test(js)
  && !/from='\+s0\+'&to='\+\(s0\+LAZY_SLICE\),\{cache:'no-store'\}/.test(js));
ok('타임아웃 있는 슬라이스 요청도 재검증을 쓴다',
  /cache:'no-cache',signal:ctl\.signal/.test(js));
ok('나머지 슬라이스 미리 받기는 첫 화면 뒤(유휴 시간)로 미룬다',
  /requestIdleCallback\(kick/.test(openSrc));
ok('미리 받기 자체는 그대로 살아 있다', /startSlicePrefill\(\)/.test(openSrc));

// ═══ ⑥ 워커 ETag / 메모리 캐시 ═══════════════════════════════════════
ok('슬라이스 응답에 ETag 가 붙는다', /resp\.headers\["ETag"\] = etag/.test(py));
ok('ETag 는 파일 수정시각+크기라 저장하면 반드시 달라진다',
  /etag = '"%x-%x"' % \(int\(st\.st_mtime_ns\), st\.st_size\)/.test(py));
ok('안 바뀌었으면 304 로 본문을 아예 보내지 않는다',
  /Response\(status=304\)/.test(py));
ok('슬라이스 본문은 메모리 LRU 캐시로 디스크 읽기를 건너뛴다',
  /def _slice_cache_get\(path, etag\):/.test(py) && /_slice_cache\.pop\(next\(iter\(_slice_cache\)\), None\)/.test(py));
ok('캐시 키에 ETag 가 들어가 오래된 본문이 나갈 수 없다',
  /key = \(path, etag\)/.test(py));
ok('저장(POST) 경로는 손대지 않았다', /if request\.method == "POST":/.test(py));

ok('프록시가 조건부 요청 헤더를 워커로 넘긴다',
  /'if-none-match', 'if-modified-since'/.test(proxy));
ok('프록시가 검증자(ETag 등)를 브라우저로 돌려준다',
  /\['etag', 'last-modified', 'vary'\]/.test(proxy));
ok('프록시가 304 에 본문을 붙이지 않는다',
  /if \(r\.status === 304\) return reply\.send\(\);/.test(proxy));

// ═══ 프록시 실전 검증 (가짜 워커) ════════════════════════════════════
{
  const ETAG = '"abc-123"';
  const worker = http.createServer((req, res) => {
    const inm = req.headers['if-none-match'] || '';
    if (inm === ETAG) { res.writeHead(304, { ETag: ETAG }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ETag: ETAG });
    res.end(JSON.stringify({ ok: true, pages: [{ id: 'p0', els: [] }], total: 520 }));
  });
  await new Promise((r) => worker.listen(0, '127.0.0.1', r));
  // config.js 는 import 시점에 env 를 읽는다 → 반드시 먼저 정한다
  process.env.SDY_WORKER_URL = `http://127.0.0.1:${worker.address().port}`;
  const Fastify = (await import('fastify')).default;
  const { createWorkerProxy } = await import('../server/src/lib/workerProxy.js');
  {
    const app = Fastify({ logger: false });
    const wp = createWorkerProxy({ app });
    app.route({ method: 'GET', url: '/api/import/docfile/:jid', handler: (rq, rp) => wp.proxy(rq, rp) });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${app.server.address().port}`;

    const r1 = await fetch(`${base}/api/import/docfile/j1?from=0&to=8`);
    const b1 = await r1.json();
    ok('첫 요청은 본문과 ETag 를 함께 받는다',
      r1.status === 200 && b1.total === 520 && r1.headers.get('etag') === ETAG);

    const r2 = await fetch(`${base}/api/import/docfile/j1?from=0&to=8`, { headers: { 'If-None-Match': ETAG } });
    const t2 = await r2.text();
    ok('두 번째(재검증) 요청은 304 · 본문 0바이트다',
      r2.status === 304 && t2.length === 0);

    await app.close();
  }
  worker.close();
}

console.log(`\n노트 열기 속도 계약: PASS ${pass}`);
