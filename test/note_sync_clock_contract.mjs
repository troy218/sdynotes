// 14.13 계약 검증 — 노트 동기화 rev 시계(Lamport) + 전환 경쟁/페이지 순서 가드.
//
// 증상(보고): ① 시계가 느린 기기에서 "처음 몇 번만 동기화되고 이후 아예 안 됨"
// ② 써 놓은 텍스트가 지워져 보임 ③ 다른 쪽에서 만든 페이지가 실시간 반영 안 됨
// ④ 한 페이지/문서의 내용이 다른 페이지·문서 위에 복사돼 보임.
//
// 원인: 노트 편집기의 요소 rev 를 Date.now() 원값으로 찍어, 느린 시계의 기기는
// 서버 LWW(cur.rev >= rev 거부)에서 영구히 밀렸다. 설정 동기화(14.9)는 단조
// 시계+캐치업으로 이미 고쳤지만 노트 편집기에는 빠져 있었다.
// 이 테스트는 (1) 배포된 코드의 시계 로직을 실제로 뽑아 30초 느린 기기 시뮬레이션,
// (2) 소스 계약(가드/순서/재전송/서버 pages LWW)을 확인한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'sdynotes.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'server/src/lib/syncEngine.js'), 'utf8');

// ── 1. 배포된 rev 시계 코드 추출 (실제 sdynotes.js 의 _nbNow) ──
const clockStart = html.indexOf('let _nbRev=Date.now();');
const clockEnd = html.indexOf('function _nbNow(){', clockStart);
assert.ok(clockStart > 0 && clockEnd > clockStart, '_nbRev/_nbNow 시계가 있어야 한다');
const lineEnd = html.indexOf('\n', html.indexOf('}', html.indexOf('return _nbRev;', clockEnd)));
const clockSrc = html.slice(clockStart, lineEnd);
assert.match(clockSrc, /Math\.max\(_nbRev\+1, Date\.now\(\)\+Math\.random\(\)\)/,
  'rev 시계는 단조 증가(직전 값+1 보다 큼)여야 한다');

function makeClock(nowMs) {
  const o = {};
  const FakeDate = { now: () => nowMs };
  new Function('o', 'Date',
    `${clockSrc}; function _nbCatchup(v){ _nbRev=Math.max(_nbRev, v||0); }
     Object.assign(o, { next:_nbNow, catchup:_nbCatchup });`)(o, FakeDate);
  return o;
}

// ── 2. 서버 LWW 규칙 (syncEngine 과 같은 규칙의 미러) ──
function makeServer() {
  return {
    els: new Map(), pages: null,
    push(op) {
      if (op.kind === 'pages') {
        if (this.pages && parseFloat(this.pages.rev || 0) >= op.rev) return false;
        this.pages = { rev: op.rev, ids: op.ids };
        return true;
      }
      const cur = this.els.get(op.id);
      if (cur && parseFloat(cur.rev || 0) >= op.rev) return false;
      this.els.set(op.id, { rev: op.rev, html: op.data && op.data.html });
      return true;
    },
    version() {
      let v = this.pages ? parseFloat(this.pages.rev || 0) : 0;
      for (const e of this.els.values()) v = Math.max(v, parseFloat(e.rev || 0));
      return v;
    },
  };
}

const T0 = 1_750_000_000_000;
// A: 시계 30초 빠른 기기(예: PC), B: 30초 느린 기기(예: LTE 폰) — 실제 보고 사례급 오차
const A = makeClock(T0 + 30000);
const B = makeClock(T0);
const srv = makeServer();

// (1) 예전 동작 재현: 느린 기기가 순수 벽시계 rev 로 push → 서버가 계속 거부
let rawRejected = 0;
for (let i = 0; i < 5; i++) {
  const rev = T0 + i;                       // Date.now() 원값 (예전 코드)
  srv.els.set('t1', { rev: T0 + 30000 + i, html: 'A' });
  if (!srv.push({ id: 't1', kind: 'put', rev, data: { html: 'B' + i } })) rawRejected++;
}
assert.equal(rawRejected, 5, '느린 벽시계 rev 는 서버 LWW 에서 전부 거부된다(버그 재현)');

// (2) 새 시계: pull 캐치업 → 편집 → push 를 반복하면 누구도 영구히 밀리지 않는다.
//     (실제 클라이언트도 push 뒤 pull(14.7) + SSE pull 로 매번 캐치업한다)
const srv2 = makeServer();
srv2.push({ id: 't1', kind: 'put', rev: A.next(), data: { html: 'A1' } });   // A 먼저 편집
srv2.push({ id: 't1', kind: 'put', rev: A.next(), data: { html: 'A2' } });
for (let i = 0; i < 6; i++) {
  B.catchup(srv2.version());                 // B: pull 로 서버 최대 rev 까지 캐치업
  const okB = srv2.push({ id: 't1', kind: 'put', rev: B.next(), data: { html: 'B' + i } });
  assert.ok(okB, `캐치업 뒤 느린 기기의 ${i + 1}번째 편집은 서버가 받아야 한다`);
  A.catchup(srv2.version());                 // A: pull 로 캐치업
  const okA = srv2.push({ id: 't1', kind: 'put', rev: A.next(), data: { html: 'A' + i } });
  assert.ok(okA, '빠른 기기 편집도 계속 받아져야 한다');
}

// (3) pages op: 낮은 rev 의 옛 페이지 목록은 새 목록을 덮지 못한다 (서버 14.13)
srv2.push({ id: '__pages__', kind: 'pages', rev: A.next(), ids: ['p1', 'p2', 'p3'] });
const stalePagesAccepted = srv2.push({ id: '__pages__', kind: 'pages', rev: T0, ids: ['p1'] });
assert.equal(stalePagesAccepted, false, '낮은 rev 페이지 목록은 거부된다');
assert.deepEqual(srv2.pages.ids, ['p1', 'p2', 'p3'], '방금 생긴 페이지가 지워지면 안 된다');

// ── 3. 소스 계약 (pullSync 가드/순서, pushOps 재전송, 서버 pages LWW) ──
const pullBody = html.slice(html.indexOf('async function pullSync(init)'), html.indexOf('function _selectiveRenderPage'));
assert.match(pullBody, /const _d0=doc, _nb0=curNB\.id/, 'pull 시작 시 노트 신원 고정');
assert.match(pullBody, /if\(doc!==_d0\|\|!curNB\|\|curNB\.id!==_nb0\) return \[\];/, 'fetch 뒤 노트가 바뀌었으면 적용 중단');
assert.match(pullBody, /_nbRev=Math\.max\(_nbRev, d\.version\|\|0\);/, 'pull 뒤 Lamport 캐치업');
assert.match(pullBody, /for\(const op of ordered\)/, 'ops 를 (pages 우선) 재정렬된 순서로 적용');
assert.match(pullBody, /const ordered=_pgs\.length\?_pgs\.concat\(ops\.filter\(o=>o\.id!=='__pages__'\)\):ops/,
  '__pages__ op 을 요소 op 보다 먼저 적용');
assert.match(pullBody, /if\(doc!==_d0\) return \[\];/, '루프/렌더 직전 노트 일관성 가드');
const pushBody = html.slice(html.indexOf('async function pushOps(pre)'), html.indexOf('// ============ 실시간 커서 공유'));
assert.match(pushBody, /failedIds/, 'push 실패한 put 추적');
assert.match(pushBody, /d0\.__lastHash\.delete\(id\)/, '실패한 put 의 해시를 걷어내 재전송');
const genBody = html.slice(html.indexOf('function genOps()'), html.indexOf('let opsTimer=null'));
assert.doesNotMatch(genBody, /Date\.now\(\)\+seq/, 'genOps 는 벽시계 원값 rev 를 쓰면 안 된다');
assert.match(genBody, /const rev=_nbNow\(\);/, 'genOps 는 단조 시계로 rev 생성');
assert.match(engine, /parseFloat\(curPages\.rev \|\| 0\) < rev/, '서버 pages op 도 rev LWW');
assert.match(engine, /rejected\.push\(oid\);\s*\n\s*continue;/, '낡은 pages op 는 거부 목록에');

console.log('노트 동기화 시계 계약: PASS (단조 rev + 캐치업 / 전환 가드 / pages 우선·LWW / 실패 재전송)');
