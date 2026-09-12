/* ═══════════════════════════════════════════════════════════════════════════
   notesis 발매판 · 계정 화면에 '내 데이터' 칸 붙이기

   왜 이렇게 하나
     계정 창(#sdyAuthWrap 안의 #saStepDone)은 원본 코드가 그린다. 원본을 고치지
     않고도 스토어 심사 요건(① 앱 안에서 계정 삭제 ② 개인정보처리방침·약관 접근)을
     채우려면, 이 스크립트가 그 창에 **칸을 덧붙이면** 된다.
     (음악을 fetch 로 가로챈 것과 같은 방식 — 원본은 한 줄도 안 고친다.)

   붙이는 것
     · 개인정보처리방침 · 이용약관 링크
     · '내 데이터는 어디에 있나요' 한 줄 안내 (기기 / 서버 구분)
     · 계정 삭제 — 이메일을 그대로 적어야 실행되는 확인 창
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__sdyAccountOn) return;
  window.__sdyAccountOn = true;

  var APP = 'notesis';
  var LEGAL = { privacy: '/privacy', terms: '/terms' };
  var injected = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function authHeaders() {
    try { return window.sdyAuthHeaders ? window.sdyAuthHeaders() : {}; } catch (e) { return {}; }
  }
  function myEmail() {
    try { var u = window.sdyUser && window.sdyUser(); return (u && u.email) || ''; } catch (e) { return ''; }
  }

  // ── 확인 창 ─────────────────────────────────────────────────────────────
  function askDelete(email) {
    return new Promise(function (resolve) {
      var wrap = el('div', 'sdy-del-wrap');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', '계정 삭제 확인');

      var card = el('div', 'sdy-del-card');
      card.appendChild(el('b', 'sdy-del-ttl', '계정을 지울까요?'));

      var keep = el('div', 'sdy-del-keep');
      keep.appendChild(el('b', null, '남는 것 (지우지 않습니다)'));
      var ul1 = el('ul');
      ['이 기기에 있는 노트·필기·PDF', '이 기기에 있는 음악 파일', '내보내기로 저장해 둔 파일']
        .forEach(function (t) { ul1.appendChild(el('li', null, t)); });
      keep.appendChild(ul1);
      keep.appendChild(el('p', 'sdy-del-note',
        '노트는 계정이 아니라 기기에 딸려 있어요. 계정을 지워도 이 기기에서는 그대로 씁니다.'));
      card.appendChild(keep);

      var gone = el('div', 'sdy-del-gone');
      gone.appendChild(el('b', null, '지워지는 것'));
      var ul2 = el('ul');
      ['회원 정보(이메일·닉네임·비밀번호)', '모든 기기의 로그인 상태',
        '친구 목록과 1:1 대화 기록', '서버에 올려 둔 AI 사용 기록']
        .forEach(function (t) { ul2.appendChild(el('li', null, t)); });
      gone.appendChild(ul2);
      card.appendChild(gone);

      var lab = el('label', 'sdy-del-lab', '확인을 위해 가입 이메일을 그대로 적어 주세요');
      card.appendChild(lab);
      var input = el('input', 'sdy-del-input');
      input.type = 'email';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = email;
      card.appendChild(input);

      var err = el('div', 'sdy-del-err');
      err.style.display = 'none';
      card.appendChild(err);

      var row = el('div', 'sdy-del-row');
      var cancel = el('button', 'sdy-del-btn', '취소');
      cancel.type = 'button';
      var ok = el('button', 'sdy-del-btn danger', '계정 삭제');
      ok.type = 'button';
      row.appendChild(cancel);
      row.appendChild(ok);
      card.appendChild(row);

      wrap.appendChild(card);
      document.body.appendChild(wrap);
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);

      function close(v) {
        wrap.classList.remove('on');
        setTimeout(function () { try { wrap.remove(); } catch (e) {} }, 180);
        resolve(v);
      }
      cancel.onclick = function () { close(false); };
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(false); });
      document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); close(false); }
      });

      var busy = false;
      ok.onclick = async function () {
        if (busy) return;
        var typed = String(input.value || '').trim();
        if (!typed) { err.textContent = '이메일을 적어 주세요'; err.style.display = 'block'; return; }
        busy = true;
        ok.textContent = '지우는 중…';
        try {
          var r = await fetch('/api/auth/account/delete', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({ confirm: typed })
          });
          var d = await r.json().catch(function () { return {}; });
          if (!r.ok || !d.ok) {
            err.textContent = (d && d.error) || '지우지 못했어요';
            err.style.display = 'block';
            ok.textContent = '계정 삭제';
            busy = false;
            return;
          }
          // 지워졌다 — 화면 상태를 로그아웃으로 되돌린다
          try {
            if (window.sdyAuthLogout) window.sdyAuthLogout();
            else {
              var x = document.getElementById('saStepDone');
              if (x) x.style.display = 'none';
              var y = document.getElementById('sdyAuthWrap');
              if (y) y.style.display = 'none';
            }
          } catch (e) {}
          close(true);
          if (window.toast) {
            window.toast('계정을 지웠어요 · 이 기기의 노트는 그대로입니다', 3600);
          }
        } catch (e) {
          err.textContent = '서버에 연결하지 못했어요 · 잠시 뒤 다시 시도해 주세요';
          err.style.display = 'block';
          ok.textContent = '계정 삭제';
          busy = false;
        }
      };
    });
  }

  // ── 칸 붙이기 ───────────────────────────────────────────────────────────
  function inject() {
    if (injected) return true;
    var done = document.getElementById('saStepDone');
    if (!done) return false;
    if (done.querySelector('.sdy-acc-block')) { injected = true; return true; }

    var block = el('div', 'sdy-acc-block');

    // ① 내 요금제 — 무료는 기기 전용, 프리미엄은 클라우드(컴퓨터에서도 열린다)
    var planBox = el('div', 'sdy-acc-plan');
    block.appendChild(planBox);

    // ② 데이터 위치 안내 — 이 앱의 핵심 약속 (요금제에 따라 문장이 달라진다)
    var info = el('div', 'sdy-acc-info');
    info.appendChild(el('b', null, '내 데이터는 어디에 있나요'));
    var ul = el('ul');
    ul.appendChild(el('li', null, '노트 · 필기 · PDF · 음악 → 기기 안 (서버로 안 감)'));
    ul.appendChild(el('li', null, '논문 가져오기 → 서버가 변환만 하고, 기기로 보낸 뒤 지웁니다'));
    ul.appendChild(el('li', null, 'AI 요약·번역을 쓸 때만 → 그때 보낸 부분만 서버로'));
    ul.appendChild(el('li', null, '회원 정보(이메일·닉네임) → 서버에 저장'));
    info.appendChild(ul);
    block.appendChild(info);

    // ② 약관 링크
    var links = el('div', 'sdy-acc-links');
    var a1 = el('a', null, '개인정보처리방침');
    a1.href = LEGAL.privacy;
    a1.target = '_blank';
    a1.rel = 'noopener';
    var a2 = el('a', null, '이용약관');
    a2.href = LEGAL.terms;
    a2.target = '_blank';
    a2.rel = 'noopener';
    links.appendChild(a1);
    links.appendChild(el('span', 'sdy-acc-sep', '·'));
    links.appendChild(a2);
    block.appendChild(links);

    // ③ 계정 삭제
    var del = el('button', 'sdy-acc-del', '계정 삭제');
    del.type = 'button';
    del.onclick = function () { askDelete(myEmail()); };
    block.appendChild(del);

    done.appendChild(block);
    fillPlan(planBox);
    injected = true;
    return true;
  }

  // ── 요금제 줄 ───────────────────────────────────────────────────────────
  //   무료: 논문은 기기에만 (서버에 남지 않음) / 프리미엄: 클라우드에 보관 → 컴퓨터에서도
  function fillPlan(box) {
    function line(strong, rest) {
      box.innerHTML = '';
      box.appendChild(el('b', null, strong));
      if (rest) box.appendChild(el('span', null, rest));
    }
    line('요금제 확인 중…', '');
    fetch('/api/auth/storage', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok) { line('무료', ' · 논문은 내 기기에만 저장됩니다'); return; }
        var p = d.plan || {};
        if (d.cloud) {
          var used = ((d.papers && d.papers.bytes) || 0) / 1073741824;
          var cap = (p.cloud_bytes || 0) / 1073741824;
          line((p.name || '프리미엄'),
            ' · 클라우드 ' + Math.round(cap) + 'GB 중 ' + used.toFixed(2) + 'GB 사용'
            + ' · 컴퓨터에서도 같은 논문을 봅니다');
          var sub = el('div', 'sdy-acc-plan-sub');
          sub.textContent = '논문도 필기도 클라우드에 있어 컴퓨터·패드·폰이 같은 상태를 봅니다.';
          box.appendChild(sub);
        } else {
          var pm = (d.papers && d.papers.per_month) || 5;
          var tm = (d.papers && d.papers.this_month) || 0;
          line((p.name || '무료'),
            ' · 이번 달 ' + tm + '/' + pm + '편 · 논문은 이 기기에 저장됩니다');
          var sub2 = el('div', 'sdy-acc-plan-sub');
          sub2.textContent = '프리미엄이면 클라우드 200GB에 보관되어 컴퓨터에서도 열립니다.';
          box.appendChild(sub2);
        }
      })
      .catch(function () { line('무료', ' · 논문은 내 기기에만 저장됩니다'); });
  }

  // 계정 창이 열릴 때마다 확인 (원본이 언제 그리는지 알 수 없어 가볍게 지켜본다)
  function watch() {
    if (inject()) return;
    var wrap = document.getElementById('sdyAuthWrap');
    if (!wrap) return;
    var mo = new MutationObserver(function () { if (inject()) mo.disconnect(); });
    mo.observe(wrap, { childList: true, subtree: true, attributes: true });
    setTimeout(function () { mo.disconnect(); }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }
  // 로그인 직후에도 한 번 더 (창이 닫혔다 다시 열리는 흐름)
  window.addEventListener('sdy-auth', function () { setTimeout(watch, 50); });

  window.SDY_accountUI = { inject: inject, askDelete: askDelete, app: APP };
})();
