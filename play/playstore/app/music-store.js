/* ═══════════════════════════════════════════════════════════════════════════
   SDYnotes 발매판 · 로컬 음악 저장소 (IndexedDB)

   왜 이 파일이 따로 있나
     음악을 **기기 안에만** 둔다. 서버는 태그·가사(곡 정보)를 찾을 때만 쓴다.
     같은 저장소를 두 곳에서 읽는다.
       · 페이지  — 목록·업로드·태그 편집
       · 서비스워커 — <audio src="/api/music/file/…"> 요청을 실제 음원으로 응답
     그래서 ESM(import/export)을 쓰지 않고 `self.SDYMusicStore` 하나에 담는다.
     (서비스워커는 클래식 모드라 importScripts 로 이 파일을 그대로 불러 쓴다.)

   저장 구조
     tracks  — {id, title, artist, album, year, genre, dur, bytes, mime, ext,
                added, tag_state, lyrics, lyrics_plain, has_lyrics, has_sync,
                cover(불리언), cover_v, norm_db, play_count, last_play}
     blobs   — {id, blob}   ← 음원 원본. 여기서만 나간다(서버로 안 감)
     covers  — {id, blob}   ← 표지 이미지
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var DB_NAME = 'sdy_music_local';
  var DB_VER = 1;
  var S_TRACKS = 'tracks';
  var S_BLOBS = 'blobs';
  var S_COVERS = 'covers';

  var _db = null;

  function req(r) {
    return new Promise(function (res, rej) {
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('idb 오류')); };
    });
  }

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains(S_TRACKS)) {
          var t = db.createObjectStore(S_TRACKS, { keyPath: 'id' });
          t.createIndex('added', 'added');
        }
        if (!db.objectStoreNames.contains(S_BLOBS)) db.createObjectStore(S_BLOBS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(S_COVERS)) db.createObjectStore(S_COVERS, { keyPath: 'id' });
      };
      r.onsuccess = function () { _db = r.result; res(_db); };
      r.onerror = function () { rej(r.error || new Error('IndexedDB 를 열 수 없습니다')); };
    });
  }

  function tx(stores, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(stores, mode);
        var out;
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('트랜잭션 중단')); };
        out = fn(t);
      });
    });
  }

  // ── id 만들기 ────────────────────────────────────────────────────────────
  // 서버 곡 id 와 섞이지 않게 'loc_' 접두사를 붙인다. 서버 워커는 id 를
  // [0-9a-zA-Z_-] 로만 받으므로 접두사를 쓰면 서버 곡과 절대 충돌하지 않는다.
  var seq = 0;
  function newId() {
    seq = (seq + 1) % 1e6;
    return 'loc_' + Date.now().toString(36) + '_' + seq.toString(36) +
      Math.random().toString(36).slice(2, 6);
  }

  // ── 파일 이름 → 제목/가수 추측 ───────────────────────────────────────────
  // "01. 가수 - 제목.mp3" 같은 흔한 이름을 최소한으로 해석한다.
  // (정확한 태그는 서버 '정보 찾기'가 채운다 — 여기서는 빈칸 방지용)
  function guessMeta(name) {
    var s = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').trim();
    s = s.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/^\s*(\d{1,3})[\s._-]+/, '');
    var out = { title: s || '제목 없음', artist: '' };
    var m = s.split(/\s+[-–—]\s+/);
    if (m.length >= 2) {
      // '가수 - 제목' 이 흔하다. 어느 쪽인지 확실치 않으므로 통째로도 남긴다.
      out.artist = m[0].trim();
      out.title = m.slice(1).join(' - ').trim() || out.title;
    }
    return out;
  }

  function extOf(name) {
    var m = /\.([a-z0-9]{2,5})$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : 'mp3';
  }

  // ── 목록 ─────────────────────────────────────────────────────────────────
  function all() {
    return tx([S_TRACKS], 'readonly', function (t) {
      var out = [];
      t.objectStore(S_TRACKS).openCursor().onsuccess = function (e) {
        var c = e.target.result;
        if (c) { out.push(c.value); c.continue(); }
      };
      return out;
    }).then(function (rows) {
      return rows.sort(function (a, b) { return (a.added || 0) - (b.added || 0); });
    });
  }

  function get(id) {
    return tx([S_TRACKS], 'readonly', function (t) {
      return t.objectStore(S_TRACKS).get(id);
    }).then(function (v) { return v || null; });
  }

  // ── 추가 ─────────────────────────────────────────────────────────────────
  // 파일 하나를 통째로 기기에 넣는다. 서버로는 아무것도 보내지 않는다.
  function put(file, extra) {
    var id = (extra && extra.id) || newId();
    var g = guessMeta(file.name);
    var rec = {
      id: id,
      title: (extra && extra.title) || g.title,
      artist: (extra && extra.artist) || g.artist,
      album: '', year: '', genre: '',
      dur: 0,
      bytes: file.size || 0,
      mime: file.type || '',
      ext: extOf(file.name),
      added: Date.now(),
      // 'manual' = 이 곡은 사용자 기기에만 있고 서버는 모른다.
      // 플레이어의 자동 태그 폴링(_needsTag)이 'pending' 을 계속 기다리지 않게 한다.
      tag_state: 'manual',
      cover: false, cover_v: 1,
      has_lyrics: false, has_sync: false,
      lyrics: '', lyrics_plain: '', lyrics_src: '',
      norm_db: 0, norm_ready: false,
      play_count: 0, last_play: 0,
      local: true,
      orig_name: file.name || ''
    };
    return tx([S_TRACKS, S_BLOBS], 'readwrite', function (t) {
      t.objectStore(S_TRACKS).put(rec);
      t.objectStore(S_BLOBS).put({ id: id, blob: file });
      return rec;
    });
  }

  // ── 태그 수정 ────────────────────────────────────────────────────────────
  var WRITABLE = ['title', 'artist', 'album', 'year', 'genre', 'dur', 'lyrics',
    'lyrics_plain', 'lyrics_src', 'has_lyrics', 'has_sync', 'norm_db',
    'norm_ready', 'cover', 'cover_v', 'play_count', 'last_play', 'tag_state'];

  function patch(id, fields) {
    return tx([S_TRACKS], 'readwrite', function (t) {
      var os = t.objectStore(S_TRACKS);
      var out = null;
      os.get(id).onsuccess = function (e) {
        var rec = e.target.result;
        if (!rec) return;
        for (var k in fields) {
          if (WRITABLE.indexOf(k) >= 0 && fields[k] !== undefined) rec[k] = fields[k];
        }
        os.put(rec);
        out = rec;
      };
      return out;
    });
  }

  // ── 삭제 ─────────────────────────────────────────────────────────────────
  function remove(id) {
    return tx([S_TRACKS, S_BLOBS, S_COVERS], 'readwrite', function (t) {
      t.objectStore(S_TRACKS).delete(id);
      t.objectStore(S_BLOBS).delete(id);
      t.objectStore(S_COVERS).delete(id);
      return true;
    });
  }

  function clear() {
    return tx([S_TRACKS, S_BLOBS, S_COVERS], 'readwrite', function (t) {
      t.objectStore(S_TRACKS).clear();
      t.objectStore(S_BLOBS).clear();
      t.objectStore(S_COVERS).clear();
      return true;
    });
  }

  // ── 음원/표지 blob ───────────────────────────────────────────────────────
  function blob(id) {
    return tx([S_BLOBS], 'readonly', function (t) {
      return t.objectStore(S_BLOBS).get(id);
    }).then(function (v) { return (v && v.blob) || null; });
  }

  function coverBlob(id) {
    return tx([S_COVERS], 'readonly', function (t) {
      return t.objectStore(S_COVERS).get(id);
    }).then(function (v) { return (v && v.blob) || null; });
  }

  function putCover(id, b) {
    return tx([S_COVERS, S_TRACKS], 'readwrite', function (t) {
      if (b) t.objectStore(S_COVERS).put({ id: id, blob: b });
      else t.objectStore(S_COVERS).delete(id);
      var os = t.objectStore(S_TRACKS);
      os.get(id).onsuccess = function (e) {
        var rec = e.target.result;
        if (!rec) return;
        rec.cover = !!b;
        rec.cover_v = Date.now();
        os.put(rec);
      };
      return true;
    });
  }

  // ── 용량 ─────────────────────────────────────────────────────────────────
  // 곡을 기기에 넣으면 브라우저 저장공간이 찬다. 얼마나 쓰는지 화면에 보여줄 수
  // 있게 합계를 돌려준다.
  function stats() {
    return all().then(function (rows) {
      var bytes = 0;
      for (var i = 0; i < rows.length; i++) bytes += rows[i].bytes || 0;
      return { count: rows.length, bytes: bytes };
    });
  }

  // ── 저장공간 확보 요청 ───────────────────────────────────────────────────
  // Chrome 은 사용자 제스처 없이 부르면 조용히 false 를 준다(그냥 넘어가면 된다).
  function persist() {
    try {
      if (navigator.storage && navigator.storage.persist) return navigator.storage.persist();
    } catch (e) {}
    return Promise.resolve(false);
  }

  root.SDYMusicStore = {
    open: open,
    all: all,
    get: get,
    put: put,
    patch: patch,
    remove: remove,
    clear: clear,
    blob: blob,
    coverBlob: coverBlob,
    putCover: putCover,
    stats: stats,
    persist: persist,
    newId: newId,
    guessMeta: guessMeta
  };
})(typeof self !== 'undefined' ? self : this);
