// 14.39.0 · 버그 일지 계약 테스트 — 해돌이(task=bug)가 정리한 내용을 저장·보기·지우기
//
// 이 파일이 지키려는 계약
//   1) 설정 화면에 '버그 일지' 줄(개수 + [보기])이 있고, [보기]를 눌러야 목록이
//      열린다. X(이 기록 지우기) 버튼은 **관리자로 로그인한 경우에만** 노출·동작한다
//      — 모두가 지울 수 없게 막는다(14.39.0 버그 수정: 누구나 X 를 누를 수 있었음)
//   2) 저장은 설정 LWW 동기화 키('buglog:<id>')를 타서 모든 기기에 퍼진다
//      (put=기록 추가 · del=삭제, 대량 삭제 방화벽 buglog:10)
//   3) 프런트 AI(ai-assistant)에 '버그 신고' 감지와 runBug 가 있다
//      — /버그·버그 신고: 접두사, '버그가 있어요' 자연어, 기능 이름 + '안 돼요'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

let pass = 0;
const ok = (name, cond) => {
  assert.ok(cond, name);
  pass++;
  console.log('  ✓ ' + name);
};

// ── 1) 소스 계약 ────────────────────────────────────────────────────────────
const bundle = read('sdynotes.js');
const sync = read('src/app/02d-settings-sync.js');
const part = read('src/app/02f-buglog.js');
const ai = read('src/ai-assistant.js');
const html = read('sdynotes.html');

ok('설정: 버그 일지 줄(#bugCount + [보기])과 스크롤 목록 모달(#buglogModal > #bugList)이 있다',
  /id="bugCount"/.test(html) && /onclick="openBuglog\(\)"/.test(html)
  && /id="buglogModal"/.test(html) && /id="bugList"/.test(html));
ok('02f: 기록 추가(buglogAdd)·삭제(delBugEntry)·열기/닫기(open/closeBuglog)·그리기(renderBugList)가 있다',
  /function buglogAdd\(/.test(part) && /function delBugEntry\(/.test(part)
  && /function openBuglog\(/.test(part) && /function closeBuglog\(/.test(part)
  && /function renderBugList\(/.test(part) && /function paintBugCount\(/.test(part));
ok('02f: MANIFEST 에 들어 있어 번들에 포함된다',
  /function buglogAdd\(/.test(bundle) && /function delBugEntry\(/.test(bundle)
  && /function openBuglog\(/.test(bundle));
ok('동기화: buglog 키는 put/del 모두 로컬 배열(sdy_buglog)에 반영된다',
  /if\(k\.indexOf\('buglog:'\)===0\)\{[\s\S]*?saveBugEntries/.test(sync)
  && /k\.indexOf\('buglog:'\)===0/.test(sync));
ok('동기화: push 상태 수집(_stKeys)이 로컬 버그 일지를 키로 올리고 대량 삭제 방화벽이 있다',
  /getBugEntries\(\)\.forEach/.test(sync) && /buglog:10/.test(sync));
ok('프런트 AI: 버그 신고 감지(/버그·버그 신고:·"버그가 있어요"·"○○가 안 돼요")와 runBug 가 있다',
  /window\.sdyAiBugCmdOf=bugCmdOf/.test(ai) && /window\.sdyAiLooksLikeBug=looksLikeBug/.test(ai)
  && /function runBug\(/.test(ai) && /task:'bug'/.test(ai)
  && /window\.sdyBuglogAdd/.test(ai));

// ── 2) 런타임 (jsdom) — 저장·목록·X 삭제·열고 닫기 ─────────────────────────
const dom = new JSDOM(`<!DOCTYPE html><html><body>
<span id="bugCount"></span>
<div id="buglogModal" style="display:none"><div id="bugList"></div></div>
</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/' });
const w = dom.window;
let storage = {};
const ls = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { storage = {}; },
  key: () => null, length: 0,
};
const queued = [];                       // _stQueueOp 기록 (동기화 큐 흉내)
const nav = { openNav: 0, navDrop: 0 };
const src = part + '\nwindow.__t={paintBugCount,renderBugList,delBugEntry,openBuglog,closeBuglog,getBugEntries,buglogAdd};';
// isAdmin: 14.39.0 버그 수정 — X 버튼은 관리자로 로그인한 경우에만 노출·동작한다.
//   admin.mode 를 바꿔 가며 두 상태를 모두 검증한다.
const admin = { mode: false };
new Function('localStorage', 'document', 'CustomEvent', 'toast', '_stQueueOp',
  'pushSettingsNow', 'openNav', 'navDrop', 'window', 'isAdmin', src)(
  ls, w.document, w.CustomEvent, () => {},
  (id, kind, data) => queued.push({ id, kind, data }),
  () => {},
  () => nav.openNav++, () => nav.navDrop++, w,
  () => admin.mode,
);
const F = w.__t;
const $ = (id) => w.document.getElementById(id);

ok('런타임: 빈 일지는 "없음"으로 보인다', $('bugCount').textContent === '없음');
F.openBuglog();
ok('런타임: [보기]를 누르면 목록이 열린다(새 창처럼)', $('buglogModal').style.display === 'flex');
ok('런타임: 빈 목록에는 신고 안내가 그려진다',
  /아직 기록된 버그가 없어요/.test($('bugList').innerHTML));

F.buglogAdd({ title: '표 글자 겹침', text: '제목: 표 글자 겹침\n증상: 표를 만들면 겹쳐요', raw: '표를 만들면 겹쳐 보여요', who: '테스터', ver: '14.39.0' });
F.buglogAdd({ title: '저장 안 됨', text: '제목: 저장 안 됨' });
ok('런타임: 기록하면 개수가 늘고 목록에 제목이 그려진다', $('bugCount').textContent === '2건'
  && /표 글자 겹침/.test($('bugList').innerHTML) && /저장 안 됨/.test($('bugList').innerHTML));
// ── 14.39.0 수정: X 버튼은 관리자 전용 ──
ok('런타임: 관리자가 아니면 항목마다 X 버튼이 붙지 않는다(모두가 지울 수 없음)',
  ($('bugList').innerHTML.match(/class="buglog-x"/g) || []).length === 0);
ok('런타임: 관리자가 아니면 delBugEntry 로 지울 수 없다(삭제 무시)',
  (() => { const before = F.getBugEntries().length; F.delBugEntry(F.getBugEntries()[0].id); return F.getBugEntries().length === before; })());

admin.mode = true;            // 관리자로 로그인한 상태로 전환
F.renderBugList();           // 열려 있는 목록을 관리자 상태에 맞춰 다시 그린다
ok('런타임: 관리자로 로그인하면 항목마다 X(이 기록 지우기) 버튼이 붙는다',
  ($('bugList').innerHTML.match(/class="buglog-x"/g) || []).length === 2);
ok('런타임: 보고자·버전·원문 보고가 함께 보인다', /테스터/.test($('bugList').innerHTML)
  && /14\.39\.0/.test($('bugList').innerHTML) && /원문 보고: 표를 만들면/.test($('bugList').innerHTML));
ok('런타임: 기록은 put op(' + "buglog:<id>'" + ')로 동기화 큐에 실린다',
  queued.filter((q) => q.kind === 'put').length === 2
  && queued.every((q) => q.id.indexOf('buglog:bug_') === 0));

const firstId = queued[0].id.slice(7);
F.delBugEntry(firstId);
ok('런타임: X 를 누르면 그 기록만 지워지고 del op 가 나간다', $('bugCount').textContent === '1건'
  && !/표 글자 겹침/.test($('bugList').innerHTML) && /저장 안 됨/.test($('bugList').innerHTML)
  && queued[queued.length - 1].kind === 'del' && queued[queued.length - 1].id === 'buglog:' + firstId);
ok('런타임: 지운 기록은 localStorage 에서도 빠진다',
  (JSON.parse(ls.getItem('sdy_buglog') || '[]')).length === 1);

F.closeBuglog();
ok('런타임: 닫기(뒤로가기 히스토리 정리 포함)가 동작한다',
  $('buglogModal').style.display === 'none' && nav.openNav === 1 && nav.navDrop === 1);

console.log(`\n✅ buglog_contract — ${pass}개 항목 통과`);
