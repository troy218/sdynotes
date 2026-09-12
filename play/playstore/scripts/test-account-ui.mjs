#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   계정 삭제가 화면에서 실제로 눌리는가 (jsdom)

   왜 필요한가
     스토어 심사는 "앱 안에 삭제 경로가 있는가"를 본다. 코드에 문자열이 있는지가
     아니라 **눌러서 끝까지 되는지**다. 그래서 계정 창을 흉내 낸 DOM 을 만들고
     진짜로 버튼을 눌러, 확인 창 → 이메일 입력 → 삭제 요청 → 로그아웃까지 따라간다.

   실행: node scripts/test-account-ui.mjs
   (jsdom 이 없으면 건너뛴다 — 저장소 의존성이 아니라 개발 편의 도구라서)
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const SRC = path.join(PKG, 'app', 'account.js');

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch (e) {
  console.log('\n⚠️  jsdom 이 없어 건너뜁니다 (npm i --no-save jsdom 하면 돌아갑니다)\n');
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { fail++; console.log('  ❌ ' + m); };
const check = (c, g, b) => (c ? ok(g) : bad(b));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

console.log('\n계정 삭제 화면 검사 (jsdom)\n');

// 계정 창(로그인됨 상태)을 그대로 흉내 낸다 — 원본 HTML 의 구조와 같은 id 를 쓴다.
const dom = new JSDOM(`<!DOCTYPE html><body>
  <div id="sdyAuthWrap" style="display:none">
    <div class="sa-card">
      <div class="sa-step" id="saStepDone">
        <div class="sa-me"><b id="saMeNick">나</b></div>
        <div class="sa-row"><span id="saMeEmail">me@example.com</span></div>
        <button class="sa-btn ghost" onclick="sdyAuthLogout()">로그아웃</button>
      </div>
    </div>
  </div>
</body>`, { url: 'https://notesis.app/', runScripts: 'outside-only' });

const { window } = dom;

// 앱이 제공하는 것들 (원본 auth.js 가 하는 일)
let loggedOut = false;
const toasts = [];
window.sdyUser = () => ({ uid: 'u_me', email: 'me@example.com', nick: '나' });
window.sdyAuthHeaders = () => ({ 'x-sdy-auth': 'tok_me' });
window.sdyAuthLogout = () => { loggedOut = true; };
window.toast = (m) => { toasts.push(m); };

// 서버 흉내 — 실제 요청 본문을 잡아 둔다
const calls = [];
window.fetch = async (url, init) => {
  calls.push({ url: String(url), body: init && init.body, headers: (init && init.headers) || {} });
  // 요금제 조회 — 프리미엄(클라우드)으로 답해 요금제 줄이 제대로 뜨는지 본다
  if (String(url).includes('/api/auth/storage')) {
    return {
      ok: true, status: 200,
      json: async () => ({
        ok: true, cloud: true, keeps_copy: true, quota: 200 * 1024 * 1024 * 1024,
        plan: { id: 'premium', name: '프리미엄', price: 14900, keeps_copy: true, cloud_bytes: 200 * 1024 * 1024 * 1024, papers_per_month: null },
        papers: { count: 3, bytes: 3 * 1024 * 1024 * 1024, this_month: 3, per_month: null },
      })
    };
  }
  return {
    ok: true, status: 200,
    json: async () => ({ ok: true, removed: { email: 'me@example.com', nick: '나', sessions: 2 }, kept: { local_notes: true } })
  };
};

// account.js 를 이 창에서 실행
window.eval(fs.readFileSync(SRC, 'utf8'));
await tick(60);

// ── ① 계정 창에 칸이 붙었는가 ────────────────────────────────────────────
const done = window.document.getElementById('saStepDone');
const block = window.document.querySelector('.sdy-acc-block');
check(!!block, "계정 창에 '내 데이터' 칸이 붙음", '칸이 붙지 않음');
check(!!window.document.querySelector('.sdy-acc-info'),
  '노트·필기가 기기에 있다는 안내가 보임', '데이터 위치 안내가 없음');
// 요금제 줄 — 결제한 사람이 "내 논문이 어디 있나"를 계정 화면에서 바로 안다
const planBox = window.document.querySelector('.sdy-acc-plan');
check(!!planBox, '계정 창에 요금제 줄이 붙음', '요금제 줄이 없음');
const planText = planBox ? planBox.textContent : '';
check(/프리미엄/.test(planText) && /클라우드/.test(planText) && /GB/.test(planText),
  `요금제·클라우드 사용량이 보임 (${planText.slice(0, 40)}…)`, `요금제 줄 내용이 이상함: ${planText}`);

const links = [...window.document.querySelectorAll('.sdy-acc-links a')].map((a) => a.getAttribute('href'));
check(links.includes('/privacy') && links.includes('/terms'),
  `약관 링크: ${links.join(' · ')}`, '약관 링크가 없음: ' + links.join(','));

// ── ② 삭제 버튼 → 확인 창 ────────────────────────────────────────────────
const delBtn = window.document.querySelector('.sdy-acc-del');
check(!!delBtn, '계정 삭제 버튼이 있음', '삭제 버튼이 없음');
delBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);

const dialog = window.document.querySelector('.sdy-del-wrap');
check(!!dialog, '확인 창이 뜸', '확인 창이 뜨지 않음');
if (dialog) {
  const text = dialog.textContent;
  check(text.includes('남는 것') && text.includes('기기에 있는 노트'),
    '무엇이 남는지 보여 줌 (기기 노트)', '남는 것 안내가 없음');
  check(text.includes('지워지는 것') && text.includes('모든 기기의 로그인'),
    '무엇이 지워지는지 보여 줌', '지워지는 것 안내가 없음');
  check(/가입 이메일|이메일/.test(text) && !!dialog.querySelector('.sdy-del-input'),
    '이메일 확인 입력칸이 있음', '확인 입력칸이 없음');
}

// ── ③ 빈 칸으로 누르면 막히는가 ──────────────────────────────────────────
const before = calls.length;
dialog.querySelector('.sdy-del-btn.danger').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(40);
check(calls.length === before, '빈 칸으로는 요청을 보내지 않음', '빈 값으로 서버를 호출함(위험)');

// ── ④ 이메일을 적고 누르면 진짜 지워지는가 ───────────────────────────────
const input = dialog.querySelector('.sdy-del-input');
input.value = 'me@example.com';
dialog.querySelector('.sdy-del-btn.danger').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(120);

const call = calls[calls.length - 1];
check(calls.length === before + 1, '삭제 요청을 한 번 보냄', `요청 횟수가 이상함(${calls.length - before})`);
check(call && call.url === '/api/auth/account/delete',
  `요청 주소: ${call && call.url}`, '주소가 다름: ' + (call && call.url));
let body = null;
try { body = JSON.parse(call.body); } catch (e) {}
check(body && body.confirm === 'me@example.com',
  '적은 이메일을 그대로 보냄(확인 절차)', '확인 값이 안 실림: ' + (call && call.body));
check(call && (call.headers['x-sdy-auth'] === 'tok_me'),
  '로그인 토큰을 함께 보냄', '인증 헤더가 없음');
check(loggedOut, '삭제 뒤 로그아웃 처리', '로그아웃이 안 됨 — 남은 세션으로 화면이 살아 있음');
check(toasts.some((t) => t.includes('계정을 지웠어요')),
  '사용자에게 결과를 알려 줌', '결과 안내가 없음');
check(/노트는 그대로/.test(toasts.join(' ')),
  '기기 노트가 남는다는 것도 함께 알려 줌', '노트 보존 안내가 없음');

// ── ⑤ 실패했을 때 조용히 성공한 척하지 않는가 ───────────────────────────
window.sdyAuthLogout = () => { loggedOut = 'again'; };
window.fetch = async () => ({
  ok: false, status: 400, json: async () => ({ ok: false, error: '이메일이 맞지 않아요' })
});
if (window.document.querySelector('.sdy-del-wrap')) {
  window.document.querySelector('.sdy-del-wrap').remove();
}
window.document.querySelector('.sdy-acc-del').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);
const d2 = window.document.querySelector('.sdy-del-wrap');
d2.querySelector('.sdy-del-input').value = '틀린@이메일.com';
d2.querySelector('.sdy-del-btn.danger').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(120);
const err = d2.querySelector('.sdy-del-err');
check(!!err && err.textContent.includes('맞지 않'),
  '서버가 거절하면 이유를 보여 줌', '거절됐는데 아무 안내가 없음');
check(loggedOut !== 'again', '실패했는데 로그아웃하지 않음', '실패인데 로그아웃됨');

console.log('\n' + '─'.repeat(56));
console.log(fail === 0 ? `✅ 전부 통과 — ${pass}개` : `❌ ${fail}개 실패 · ${pass}개 통과`);
console.log('─'.repeat(56) + '\n');
process.exit(fail === 0 ? 0 : 1);
