/* ═══════════════════════════════════════════════════════════════════════════
   notesis 발매판 · 음악을 기기 안으로

   무엇을 하나
     플레이어(src/music-player.js, 5천 줄)는 곡을 전부 `/api/music/…` 로 다룬다.
     이 파일은 **그 주소들을 가로채** 서버 대신 기기(IndexedDB)로 답한다.
     플레이어 코드는 한 줄도 고치지 않는다 — 그래서 원본과 어긋날 일이 없다.

   나누는 기준 (사용자 요청: "로컬로 되게, 태그랑 가사 다는 것만 서버")
     · 기기가 답한다 — 목록 · 올리기 · 재생 · 삭제 · 태그 저장 · 표지 · 초기화 · 음량
     · 서버가 답한다 — 곡 정보 찾기 · 가사 · 싱크 가사 · 소리 인식 · 추천
       (다만 서버는 곡 id 로 자기 목록을 찾으므로, 기기에만 있는 곡은 아직
        연결되지 않았다. 아래 SERVER_ONLY 주석 참고.)

   순서
     이 스크립트는 반드시 src/music-player.js **보다 먼저** 실행돼야 한다.
     (빌드가 <head> 가 아니라 music-player 앞에 끼워 넣는다.)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__sdyLocalMusicOn) return;
  window.__sdyLocalMusicOn = true;

  var Store = window.SDYMusicStore;
  if (!Store) { console.warn('[local-music] music-store.js 가 없습니다 — 로컬 음악을 끕니다'); return; }

  var raw = window.fetch.bind(window);

  // 서버만 할 수 있는 일 — 이대로 통과시키면 서버가 곡을 못 찾아 404 가 난다.
  // (기기에만 있는 곡은 서버가 모른다. 아래 문구로 이유를 분명히 알려 준다.)
  var SERVER_ONLY = [
    '/api/music/lookup',        // 곡 정보(태그) 자동 찾기
    '/api/music/lyrics',        // 가사만 찾기
    '/api/music/synced-lyrics', // 싱크 가사
    '/api/music/recognize',     // 소리 인식(AcoustID)
    '/api/music/from_url',
    '/api/music/youtube',
    '/api/music/reco'
  ];

  function json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function isLocalId(id) { return /^loc_/.test(String(id || '')); }

  function bodyOf(input, init) {
    var b = (init && init.body);
    if (b) return b;
    if (input && typeof input !== 'string' && input.body) return input.body;
    return null;
  }

  async function readJson(input, init) {
    var b = bodyOf(input, init);
    if (!b) return {};
    if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
    if (b instanceof FormData) {
      var o = {};
      b.forEach(function (v, k) { if (!(v instanceof File)) o[k] = v; });
      return o;
    }
    try { return JSON.parse(await new Response(b).text()); } catch (e) { return {}; }
  }

  function fileOf(input, init, key) {
    var b = bodyOf(input, init);
    if (b instanceof FormData) {
      var f = b.get(key || 'file');
      if (f && typeof f === 'object' && 'size' in f) return f;
      // FormData 순회로 첫 File 을 집는다 (키 이름이 달라도 동작)
      var found = null;
      b.forEach(function (v) { if (!found && v && typeof v === 'object' && 'size' in v) found = v; });
      return found;
    }
    return null;
  }

  // ── 목록 응답 만들기 ─────────────────────────────────────────────────────
  // 플레이어가 읽는 이름을 그대로 채운다. stream_url 을 비워 두면 플레이어는
  // '/api/music/file/<id>' 를 <audio src> 로 쓴다 → 서비스워커가 기기 음원으로 답한다.
  function pub(rec) {
    var o = {};
    for (var k in rec) o[k] = rec[k];
    o.dur = rec.dur || 0;
    o.sec = rec.dur || 0;
    o.duration = rec.dur || 0;
    o.cover_url = '';
    o.stream_url = '';
    o.has_lyrics = !!(rec.lyrics || rec.lyrics_plain);
    o.has_sync = !!rec.has_sync;
    return o;
  }

  async function listResponse() {
    var rows = await Store.all();
    return json({ ok: true, tracks: rows.map(pub), local: true });
  }

  // ── 경로별 처리 ──────────────────────────────────────────────────────────
  async function handle(pathname, url, input, init) {
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    // 목록
    if (pathname === '/api/music/list' && method === 'GET') return listResponse();
    if (pathname === '/api/music/rescan') return listResponse();

    // 올리기 — 기기에 넣는다. 서버로는 바이트가 가지 않는다.
    if (pathname === '/api/music/upload' && method === 'POST') {
      var f = fileOf(input, init, 'file');
      if (!f) return json({ ok: false, error: '파일이 없습니다' }, 400);
      var rec = await Store.put(f);
      // 넣은 김에 표지를 한 장 뽑아 두고(로컬), 없으면 기본 표지를 쓴다.
      try { await grabCoverFromFile(rec.id, f); } catch (e) {}
      Store.persist();
      return json({ ok: true, id: rec.id });
    }

    // 삭제 — 내 기기 것이라 관리자 토큰이 필요 없다.
    if (pathname === '/api/music/delete' && method === 'POST') {
      var d1 = await readJson(input, init);
      if (d1.id) await Store.remove(d1.id);
      return json({ ok: true });
    }

    // 태그 저장
    if (pathname === '/api/music/meta' && method === 'POST') {
      var d2 = await readJson(input, init);
      var id2 = d2.id;
      if (!id2) return json({ ok: false, error: 'id 없음' }, 400);
      var patch = {};
      var keep = ['title', 'artist', 'album', 'year', 'genre', 'dur', 'sec',
        'lyrics', 'lyrics_plain', 'lyrics_src', 'has_lyrics', 'has_sync'];
      for (var i = 0; i < keep.length; i++) {
        var k = keep[i];
        if (d2[k] !== undefined) patch[k] = d2[k];
      }
      if (patch.sec !== undefined && patch.dur === undefined) patch.dur = patch.sec;
      if (patch.lyrics !== undefined) patch.has_lyrics = !!patch.lyrics;
      // 사용자가 직접 적은 값은 'manual' — 자동 태그가 덮지 않는다.
      patch.tag_state = 'manual';
      var t2 = await Store.patch(id2, patch);
      return json({ ok: true, track: t2 ? pub(t2) : null });
    }

    // 표지 — 파일로 올리거나, URL 로 받아 기기에 저장
    if (pathname === '/api/music/cover' && method === 'POST') {
      var fc = fileOf(input, init, 'file');
      var d3 = await readJson(input, init);
      var id3 = d3.id || url.searchParams.get('id');
      if (!id3) return json({ ok: false, error: 'id 없음' }, 400);
      if (fc) {
        await Store.putCover(id3, fc);
        return json({ ok: true });
      }
      if (d3.url) {
        try {
          var r = await raw(d3.url, { mode: 'cors' });
          if (r.ok) await Store.putCover(id3, await r.blob());
          else return json({ ok: false, error: '표지를 받지 못했어요' });
        } catch (e) {
          return json({ ok: false, error: '표지를 받지 못했어요' });
        }
        return json({ ok: true });
      }
      return json({ ok: false, error: '표지가 없습니다' }, 400);
    }

    // 초기화 — 기기 목록만 비운다
    if (pathname === '/api/music/reset' && method === 'POST') {
      await Store.clear();
      return json({ ok: true });
    }

    // 재생 횟수 (기기 기록)
    if (pathname === '/api/music/play' && method === 'POST') {
      var d4 = await readJson(input, init);
      if (d4.id && isLocalId(d4.id)) {
        var cur = await Store.get(d4.id);
        if (cur) await Store.patch(d4.id, {
          play_count: (cur.play_count || 0) + 1, last_play: Date.now()
        });
      }
      return json({ ok: true });
    }

    // 음량 — 플레이어가 잰 RMS 를 받아 -14 LUFS 로 맞출 값을 기기에서 계산한다.
    //   (서버 ffmpeg ebur128 을 쓰지 않는다. 계산은 곱셈 한 번이라 로컬이 더 싸다)
    if (pathname === '/api/music/norm' && method === 'POST') {
      var d5 = await readJson(input, init);
      var rms = Number(d5.rms_db);
      var gain = 0;
      if (isFinite(rms)) {
        gain = Math.round((-14 - rms) * 10) / 10;
        gain = Math.max(-12, Math.min(12, gain));
      }
      if (d5.id) await Store.patch(d5.id, { norm_db: gain, norm_ready: true });
      return json({ ok: true, norm_db: gain });
    }

    // 음원/표지 스트림 — 서비스워커가 없거나 못 가로챈 경우의 안전판.
    //   (평소에는 서비스워커가 답한다. <audio src> 는 fetch 를 타지 않는다)
    var mf = /^\/api\/music\/file\/(.+)$/.exec(pathname);
    if (mf && method === 'GET') {
      var b1 = await Store.blob(decodeURIComponent(mf[1]));
      if (!b1) return new Response('없음', { status: 404 });
      return new Response(b1, { headers: { 'Content-Type': b1.type || 'audio/mpeg' } });
    }
    var mc = /^\/api\/music\/cover\/(.+)$/.exec(pathname);
    if (mc && method === 'GET') {
      var b2 = await Store.coverBlob(decodeURIComponent(mc[1]));
      if (!b2) return new Response('없음', { status: 404 });
      return new Response(b2, { headers: { 'Content-Type': b2.type || 'image/jpeg' } });
    }

    // 서버만 할 수 있는 일 — 기기에만 있는 곡이면 이유를 분명히 알려 준다.
    if (SERVER_ONLY.indexOf(pathname) === 0 || SERVER_ONLY.some(function (p) {
      return pathname.indexOf(p) === 0;
    })) {
      var dd = await readJson(input, init);
      if (isLocalId(dd.id)) {
        return json({
          ok: false, local: true,
          error: '기기에만 있는 곡이에요 · 정보 찾기는 서버 연결이 필요합니다'
        }, 409);
      }
    }

    return null; // 나머지는 원래대로 서버로
  }

  // ── 파일에서 표지 뽑기 ───────────────────────────────────────────────────
  // 브라우저 기본 디코더로는 ID3 APIC 를 못 읽는다. 할 수 있는 선에서만:
  // mp3 안에 박힌 이미지 시그니처(JPEG/PNG)를 찾아 첫 장을 쓴다.
  // 실패하면 조용히 넘어간다(기본 표지가 나온다).
  async function grabCoverFromFile(id, file) {
    if (!file || file.size > 30 * 1024 * 1024) return;
    var head = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
    var b = new Uint8Array(head);
    var start = -1, end = -1, type = '';
    for (var i = 0; i < b.length - 3; i++) {
      if (b[i] === 0xFF && b[i + 1] === 0xD8 && b[i + 2] === 0xFF) { start = i; type = 'image/jpeg'; break; }
      if (b[i] === 0x89 && b[i + 1] === 0x50 && b[i + 2] === 0x4E && b[i + 3] === 0x47) { start = i; type = 'image/png'; break; }
    }
    if (start < 0) return;
    if (type === 'image/jpeg') {
      for (var j = start + 2; j < b.length - 1; j++) {
        if (b[j] === 0xFF && b[j + 1] === 0xD9) { end = j + 2; break; }
      }
    } else {
      // PNG 는 IEND 까지. 1MB 안에서 못 찾으면 표지를 포기한다.
      for (var k = start; k < b.length - 8; k++) {
        if (b[k] === 0x49 && b[k + 1] === 0x45 && b[k + 2] === 0x4E && b[k + 3] === 0x44) { end = k + 8; break; }
      }
    }
    if (end <= start) return;
    await Store.putCover(id, new Blob([b.slice(start, end)], { type: type }));
  }

  // ── fetch 가로채기 ───────────────────────────────────────────────────────
  window.fetch = async function (input, init) {
    var u = null;
    try {
      var raw_url = (typeof input === 'string') ? input : (input && input.url) || '';
      u = new URL(raw_url, location.origin);
    } catch (e) { return raw(input, init); }

    if (u.origin !== location.origin) return raw(input, init);
    if (u.pathname.indexOf('/api/music/') !== 0) return raw(input, init);

    try {
      var res = await handle(u.pathname, u, input, init);
      if (res) return res;
    } catch (e) {
      console.warn('[local-music]', u.pathname, e);
      return json({ ok: false, error: '기기 저장소 오류: ' + (e && e.message || e) }, 500);
    }
    return raw(input, init);
  };

  // 알림: 화면 어딘가에서 "로컬 음악"임을 알 수 있게 플래그를 세워 둔다.
  window.SDY_LOCAL_MUSIC = true;
  window.addEventListener('sdy-local-music-ready', function () {});
  try { window.dispatchEvent(new CustomEvent('sdy-local-music-ready')); } catch (e) {}
})();
