/* ═══════════════════════════════════════════════════════════════════════════
   SDYnotes 발매판 · 앱처럼 쓰기(PWA)

   하는 일
     · 서비스워커 등록 (오프라인·음원 로컬 서빙)
     · 끊겼을 때 조용한 띠 — "오프라인 · 쓰던 노트는 그대로 보입니다"
     · 설치 유도 띠 — 홈 화면에 추가 (스토어 없이도 앱처럼)
     · 저장공간 영구 보존 요청 — 곡·노트가 브라우저 정리로 사라지지 않게

   앱 내부 함수(toast 등)에 기대지 않는다. 이 스크립트는 app 본체보다 먼저
   돌 수 있고, 본체가 없어도 조용히 동작해야 한다.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__sdyPwaOn) return;
  window.__sdyPwaOn = true;

  var BUILD = '__SDY_BUILD__';
  var isStandalone = false;
  try {
    isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  } catch (e) {}

  window.SDY_PWA = { build: BUILD, standalone: isStandalone };

  // ── ① 서비스워커 ─────────────────────────────────────────────────────────
  // 로컬 파일(file://)이나 사설 IP 로 열면 브라우저가 막는다. 그때는 조용히
  // 넘어간다 — 앱 자체는 그대로 동작해야 한다.
  var swOK = 'serviceWorker' in navigator && (location.protocol === 'https:' ||
    location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  if (swOK) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (reg) {
        // 새 빌드가 준비되면 다음 실행에 바로 적용되게 미리 당겨 둔다.
        try { reg.update(); } catch (e) {}
        reg.addEventListener('updatefound', function () {
          var w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', function () {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              // 새 버전이 준비됨 — 쓰던 화면을 갑자기 새로고침하지 않는다.
              banner('새 버전이 준비됐어요 · 앱을 다시 열면 적용됩니다', { idle: true });
            }
          });
        });
      }).catch(function (e) {
        console.warn('[pwa] 서비스워커 등록 실패', e);
      });
    });
  } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    console.info('[pwa] HTTPS 가 아니라 오프라인 기능을 켤 수 없습니다');
  }

  // ── ② 저장공간 영구 보존 ─────────────────────────────────────────────────
  // 곡과 노트를 기기에 두므로, 브라우저가 "공간 부족"으로 지우지 않게 요청한다.
  // 사용자 조작이 있어야 허용되는 브라우저도 있어서 조용히 실패해도 넘어간다.
  function askPersist() {
    try {
      if (!(navigator.storage && navigator.storage.persist)) return;
      navigator.storage.persisted && navigator.storage.persisted().then(function (already) {
        if (already) return;
        navigator.storage.persist().then(function (ok) {
          if (!ok) console.info('[pwa] 저장공간 영구 보존이 거절됐습니다(공간이 부족할 수 있어요)');
        });
      });
    } catch (e) {}
  }
  if (document.readyState === 'complete') askPersist();
  else window.addEventListener('load', askPersist);

  // ── ③ 알림 띠 ────────────────────────────────────────────────────────────
  var bar = null, hideT = null;
  function banner(msg, opt) {
    opt = opt || {};
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'sdyPwaBar';
      bar.setAttribute('role', 'status');
      document.body.appendChild(bar);
    }
    bar.className = '';
    bar.innerHTML = '';

    var span = document.createElement('span');
    span.className = 'sdy-pwa-msg';
    span.textContent = msg;
    bar.appendChild(span);

    if (opt.action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sdy-pwa-btn';
      btn.textContent = opt.action;
      btn.onclick = function () { try { opt.onAction && opt.onAction(); } catch (e) {} };
      bar.appendChild(btn);
    }
    if (opt.close !== false) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'sdy-pwa-x';
      x.setAttribute('aria-label', '닫기');
      x.textContent = '✕';
      x.onclick = hide;
      bar.appendChild(x);
    }
    bar.classList.add('on');
    if (opt.idle) bar.classList.add('idle');

    clearTimeout(hideT);
    if (opt.ms) hideT = setTimeout(hide, opt.ms);
  }
  function hide() {
    if (bar) bar.classList.remove('on');
  }
  window.SDY_pwaBanner = banner;

  // ── ④ 오프라인 표시 ──────────────────────────────────────────────────────
  function netPaint() {
    if (navigator.onLine) { hide(); return; }
    banner('오프라인 · 쓰던 노트와 기기에 있는 곡은 그대로 됩니다', { idle: true });
  }
  window.addEventListener('online', netPaint);
  window.addEventListener('offline', netPaint);
  if (!navigator.onLine) netPaint();

  // ── ⑤ 설치 유도 ──────────────────────────────────────────────────────────
  // 이미 앱으로 열고 있으면 띄우지 않는다. 거절하면 다시 조르지 않는다.
  var SNOOZE = 'sdy_pwa_install_snooze';
  var deferred = null;

  function snoozed() {
    try {
      var t = +localStorage.getItem(SNOOZE) || 0;
      return Date.now() - t < 1000 * 60 * 60 * 24 * 14;   // 2주
    } catch (e) { return false; }
  }
  function snooze() {
    try { localStorage.setItem(SNOOZE, String(Date.now())); } catch (e) {}
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (isStandalone || snoozed()) return;
    banner('홈 화면에 추가하면 앱처럼 열려요', {
      action: '설치',
      close: false,
      onAction: function () {
        if (!deferred) return hide();
        deferred.prompt();
        deferred.userChoice.then(function (r) {
          if (r && r.outcome !== 'accepted') snooze();
          deferred = null;
          hide();
        }).catch(function () { hide(); });
      }
    });
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    banner('설치했어요 🎉 홈 화면에서 열어 보세요', { ms: 3200 });
  });

  // iOS 는 beforeinstallprompt 가 없다 — 안내만 남긴다.
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && !isStandalone && !snoozed() && navigator.onLine) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        banner('아이폰은 공유 → 홈 화면에 추가로 설치합니다', { ms: 6000 });
      }, 4000);
    });
  }
})();
