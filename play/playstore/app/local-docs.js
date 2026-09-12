/* ═══════════════════════════════════════════════════════════════════════════
   notesis 발매판 · 논문도 기기로 (서버는 변환만)

   사용자 결정: "내 서버에서 변환해서 그 로컬 기기에 보내준 후 서버에서는 지우는 방향."

   어떻게 (원본 코드는 한 줄도 고치지 않는다)
     원본 앱은 가져온 논문을 `/api/import/…` 로 다룬다. 이 파일이 그 주소들을
     가로채 **기기(IndexedDB)로 답한다** — 음악에서 쓴 방식과 같다.
     아직 기기에 없으면 그때만 서버로 보내고, **뒤에서 조용히 옮겨 온다.**

       · 변경 없이 그대로   — /api/import/status, /api/import/upload, /api/import/doc
                              (변환은 서버가 해야 한다 = 서버가 하는 유일한 일)
       · 기기가 답한다      — /api/import/docfile/…, /api/import/img/…,
                              /api/import/bg/…, /api/import/page/…
       · 옮겨 오는 중       — GET /api/import/bundle/:jid → 저장 → POST release

   다른 기기에서 열면
     그 논문은 그 기기에 없다. 서버에도 없다(지웠으므로). 이때는 분명히 알려 준다 —
     "이 논문은 다른 기기에 있어요". 조용히 빈 화면을 보여 주지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__sdyLocalDocsOn) return;
  window.__sdyLocalDocsOn = true;

  var Store = window.SDYDocStore;
  if (!Store) { console.warn('[local-docs] doc-store.js 가 없습니다 — 기기 보관을 끕니다'); return; }

  var raw = window.fetch.bind(window);
  var migrating = {};         // jid -> Promise (동시에 두 번 옮기지 않는다)

  function json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  function notHere() {
    return json({
      ok: false, local_missing: true,
      error: '이 논문은 다른 기기에 있어요 · 그 기기에서 열거나, PDF를 다시 가져와 주세요'
    }, 409);
  }
  function say(msg, ms) {
    try { if (window.toast) window.toast(msg, ms || 2600); } catch (e) {}
  }

  // ── 서버에서 기기로 옮기기 ──────────────────────────────────────────────
  //  순서: 받기 → 매니페스트 확인 → 저장 → 다 됐으면 서버에 알려 지우게 한다.
  //  어느 단계에서 실패해도 서버 파일은 그대로다(다음에 다시 시도한다).
  function migrate(jid, opts) {
    var id = String(jid || '');
    if (!id) return Promise.resolve({ ok: false, error: 'jid 없음' });
    if (migrating[id]) return migrating[id];
    opts = opts || {};

    var p = (async function () {
      try {
        if (await Store.has(id)) return { ok: true, already: true };
        var r = await raw('/api/import/bundle/' + encodeURIComponent(id), { cache: 'no-store' });
        if (!r.ok) {
          if (r.status === 404) return { ok: false, error: '서버에 없는 문서예요' };
          return { ok: false, error: '내려받지 못했어요 (HTTP ' + r.status + ')' };
        }
        if (!r.body) return { ok: false, error: '내려받기를 지원하지 않는 브라우저예요' };

        var res = await Store.readBundle(r, id);
        if (!res.ok) {
          // 반쯤 받은 것을 남기지 않는다 — 남으면 '있다'고 잘못 알고 빈 화면이 된다
          await Store.remove(id);
          return { ok: false, error: res.reason || '내려받은 내용이 온전하지 않아요' };
        }

        // 조각에서 쪽별 배경 이름을 뽑아 둔다 (page 미리보기·bg 응답에 필요)
        var parts = await Store.allParts(id);
        var pages = [];
        for (var i = 0; i < parts.length; i++) {
          var arr = parts[i].pages || [];
          for (var k = 0; k < arr.length; k++) {
            var el = arr[k] || {};
            var bg = el.bg || (el.__bg) || '';
            var name = bg ? String(bg).split('/').pop() : '';
            pages[parts[i].s0 + k] = name;
          }
        }
        var total = pages.length;
        for (var q = 0; q < pages.length; q++) if (pages[q] === undefined) pages[q] = '';

        // 버전: meta 파일이 있으면 그 안의 version, 없으면 1
        var version = 1;
        try {
          var mb2 = await Store.getMeta(id);
          if (mb2) {
            var mj = JSON.parse(await mb2.text());
            version = mj.version || mj.ver || 1;
          }
        } catch (e) {}

        await Store.putDoc({
          jid: id, total: total, version: version, pages: pages,
          importedAt: Date.now(), released: false,
          bytes: res.bytes || 0, name: (res.manifest && res.manifest.name) || ''
        });
        await Store.persist();

        // 다 받았다고 서버에 알린다 → 서버가 사본을 지운다
        try {
          var rr = await raw('/api/import/release/' + encodeURIComponent(id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: res.files, bytes: res.bytes })
          });
          var rd = await rr.json().catch(function () { return {}; });
          if (rd && rd.ok) {
            await Store.putDoc(Object.assign({}, await Store.doc(id), { released: true }));
            say('논문을 이 기기에 저장했어요 · 서버 사본은 지웠습니다', 3200);
          } else if (rd && rd.code === 'size_mismatch') {
            // 서버가 거절 — 이 기기 사본을 지우고 다음에 다시 받는다
            await Store.remove(id);
            say(rd.error || '내려받기가 온전하지 않아 다시 시도합니다', 3200);
          }
        } catch (e) {
          // 서버에 알리지 못해도 기기 사본은 쓸 수 있다(서버에만 사본이 남는다)
          console.warn('[local-docs] release 실패', e);
        }
        return { ok: true, files: res.files, bytes: res.bytes };
      } catch (e) {
        // 중간에 끊겨 예외로 끝난 경우 — 받다 만 조각을 남기지 않는다
        try { await Store.remove(id); } catch (e2) { /* noop */ }
        return { ok: false, error: (e && e.message) || String(e) };
      } finally {
        delete migrating[id];
      }
    })();

    migrating[id] = p;
    return p;
  }

  // ── 기기가 답하는 부분 ──────────────────────────────────────────────────
  async function docfile(id, url, method, init) {
    if (!(await Store.has(id))) return null;          // 서버로 넘긴다(아직 안 옮겨짐)
    var d = await Store.doc(id);

    if (method === 'POST') {
      // 원본은 편집한 쪽을 서버에 저장한다. 기기에서는 기기에 저장한다.
      var body = null;
      try {
        var b = init && init.body;
        body = b ? (typeof b === 'string' ? JSON.parse(b) : JSON.parse(await new Response(b).text())) : null;
      } catch (e) { body = null; }
      if (body && Array.isArray(body.pages)) {
        var from = Number(body.from != null ? body.from : body.s0 || 0);
        await Store.putPart(id, from, body.pages);
        // 쪽별 배경 이름도 갱신 (편집으로 배경이 바뀔 수 있다)
        for (var i = 0; i < body.pages.length; i++) {
          var el = body.pages[i] || {};
          var bg = el.bg || '';
          d.pages[from + i] = bg ? String(bg).split('/').pop() : d.pages[from + i] || '';
        }
        await Store.putDoc(d);
      }
      return json({ ok: true, local: true });
    }

    if (url.searchParams.get('meta')) {
      return json({
        ok: true, jid: id, total: d.total || 0, pages: d.total || 0,
        version: d.version || 1, local: true,
        bytes: d.bytes || 0, released: !!d.released
      });
    }

    var from = parseInt(url.searchParams.get('from') || '0', 10);
    var toRaw = url.searchParams.get('to');
    var to = toRaw ? parseInt(toRaw, 10) : (from + 1);
    var pages = await Store.slice(id, from, isFinite(to) ? to : from + 1);
    return json({ ok: true, pages: pages, total: d.total || 0, from: from, local: true });
  }

  // ── 경로별 처리 ─────────────────────────────────────────────────────────
  async function handle(pathname, url, input, init) {
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    // 문서 본문(조각·메타·저장)
    var m = /^\/api\/import\/(?:docfile|doc)\/([^/]+)$/.exec(pathname);
    if (m) {
      var id = decodeURIComponent(m[1]);
      var res = await docfile(id, url, method, init);
      if (res) return res;
      // 아직 기기에 없다 → 서버로 보내고, 뒤에서 조용히 옮겨 온다
      if (method === 'GET') {
        raw(input, init).then(function (r) {
          if (r.ok) migrate(id);      // 사용자는 기다리지 않는다
        }).catch(function () {});
        return null;
      }
      return null;
    }

    // 서버에 있는지 / 기기에만 있는지 미리 아는 창구
    var mw = /^\/api\/import\/where\/([^/]+)$/.exec(pathname);
    if (mw) {
      var wid = decodeURIComponent(mw[1]);
      if (await Store.has(wid)) return json({ ok: true, jid: wid, on_server: false, on_device_only: true, on_device: true });
      return null;
    }

    // 배경 그림·쪽 그림 — 서버가 지운 뒤에도 기기 그림으로 나와야 한다.
    //  응답 모양(img=그림, page=그림, bg=JSON)은 doc-store 가 한 곳에서 만든다.
    var mi = /^\/api\/import\/(img|page|bg)\/(.+)$/.exec(pathname);
    if (mi) {
      var rest = mi[2].split('/').map(decodeURIComponent);
      var ir = await Store.imageResponse(mi[1], rest);
      if (ir) return ir;
      // 기기에 없으면 서버에 아직 있을 수 있다(다른 기기에서 가져온 논문)
      return null;
    }

    // 기기에 있는 문서의 편집 저장은 위에서 처리되고, 없는 문서는 서버로 간다.
    return null;
  }

  window.fetch = async function (input, init) {
    var u = null;
    try {
      var rawUrl = (typeof input === 'string') ? input : (input && input.url) || '';
      u = new URL(rawUrl, location.origin);
    } catch (e) { return raw(input, init); }
    if (u.origin !== location.origin) return raw(input, init);
    if (u.pathname.indexOf('/api/import/') !== 0) return raw(input, init);

    try {
      var res = await handle(u.pathname, u, input, init);
      if (res) return res;
    } catch (e) {
      console.warn('[local-docs]', u.pathname, e);
    }
    return raw(input, init);
  };

  // ── 앱이 시작되면: 기기에 있는데 서버에 아직 있는 것을 마저 옮긴다 ──────
  //   (예전 버전에서 가져온 문서, 또는 옮기다 만 문서)
  window.addEventListener('load', function () {
    setTimeout(async function () {
      try {
        var r = await raw('/api/import/local', { cache: 'no-store' });
        if (!r.ok) return;
        var d = await r.json().catch(function () { return {}; });
        for (var i = 0; i < (d.docs || []).length; i++) {
          var jid = d.docs[i].jid;
          if (await Store.has(jid)) continue;
          await migrate(jid);           // 서버에 남아 있는 것을 하나씩 옮긴다
        }
      } catch (e) { /* 서버가 없으면 조용히 넘어간다 */ }
    }, 4000);
  });

  window.SDY_localDocs = { migrate: migrate, store: Store };
  try { window.dispatchEvent(new CustomEvent('sdy-local-docs-ready')); } catch (e) {}
})();
