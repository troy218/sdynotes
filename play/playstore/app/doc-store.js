/* ═══════════════════════════════════════════════════════════════════════════
   notesis 발매판 · 논문을 기기에 담는 저장소 (IndexedDB)

   구조
     docs   — { jid, total, version, importedAt, released, name, pages:[쪽별 배경 이름] }
     parts  — { key: 'jid|s0', jid, s0, pages:[…] }   ← 본문 조각(슬라이스)
     meta   — { key: 'jid|meta', jid, blob }         ← {jid}.meta.json 원본
     images — { key: 'jid|name', jid, name, blob }   ← 배경 이미지 원본

   왜 조각으로 나눠 담나
     원본 서버도 `{jid}.json.gz` + `{jid}.s0.gz` 처럼 나눠 저장한다. 기기도 같은
     모양으로 담아 두면, 서버를 안 거치고도 **읽는 순서·응답 모양이 똑같아**진다.
     (원본 앱이 기대하는 응답 형태를 그대로 흉내낼 수 있다)

   번들 형식은 서버 routes/importBundle.js 의 설명과 짝이다.
     magic "SDYB1\n" → 항목 반복(u32 이름길이|이름|u32 크기|내용) → '#manifest' → u32 0
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var DB_NAME = 'sdy_docs_local';
  var DB_VER = 1;
  // files = 서버가 갖고 있던 나머지 파일을 **그대로** 담는 곳(.src 원본 PDF 등).
  //  손대지 않고 보관해야, 나중에 필요해질 때 되살릴 수 있다(서버에서는 지웠으므로).
  var S = { docs: 'docs', parts: 'parts', meta: 'meta', images: 'images', files: 'files' };

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
        if (!db.objectStoreNames.contains(S.docs)) db.createObjectStore(S.docs, { keyPath: 'jid' });
        if (!db.objectStoreNames.contains(S.parts)) db.createObjectStore(S.parts, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(S.meta)) db.createObjectStore(S.meta, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(S.images)) {
          var im = db.createObjectStore(S.images, { keyPath: 'key' });
          im.createIndex('jid', 'jid');
        }
        if (!db.objectStoreNames.contains(S.files)) {
          var fl = db.createObjectStore(S.files, { keyPath: 'key' });
          fl.createIndex('jid', 'jid');
        }
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

  // ── 값 하나 읽기 ────────────────────────────────────────────────────────
  //  ⚠ tx() 는 fn 이 돌려준 **요청 객체**를 그대로 넘긴다(트랜잭션이 끝날 때
  //    결과가 이미 있으므로). 값 하나를 읽을 때는 반드시 req() 로 결과를 꺼내야
  //    한다 — 그러지 않으면 '요청 객체'가 늘 참이라 **없는 문서도 있다고** 답한다.
  function get1(storeName, key) {
    return open().then(function (db) {
      return req(db.transaction([storeName], 'readonly').objectStore(storeName).get(key));
    });
  }

  function has(jid) {
    return get1(S.docs, String(jid)).then(function (d) { return !!d; });
  }

  function doc(jid) {
    return get1(S.docs, String(jid)).then(function (d) { return d || null; });
  }

  function listDocs() {
    return tx([S.docs], 'readonly', function (t) {
      var out = [];
      t.objectStore(S.docs).openCursor().onsuccess = function (e) {
        var c = e.target.result;
        if (c) { out.push(c.value); c.continue(); }
      };
      return out;
    }).then(function (rows) {
      return rows.sort(function (a, b) { return (b.importedAt || 0) - (a.importedAt || 0); });
    });
  }

  function putDoc(d) {
    return tx([S.docs], 'readwrite', function (t) {
      t.objectStore(S.docs).put(d);
      return d;
    });
  }

  function putPart(jid, s0, pages) {
    return tx([S.parts], 'readwrite', function (t) {
      t.objectStore(S.parts).put({ key: jid + '|s' + s0, jid: jid, s0: s0, pages: pages });
      return true;
    });
  }

  // 조각 범위 읽기 — 서버의 ?from=&to= 와 같은 뜻(from 부터 to 전까지)
  function slice(jid, from, to) {
    var out = [];
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction([S.parts], 'readonly');
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
        var os = t.objectStore(S.parts);
        var c = os.openCursor();
        c.onsuccess = function (e) {
          var cur = e.target.result;
          if (!cur) return;
          var v = cur.value;
          if (v.jid === String(jid)) {
            var s0 = v.s0, n = (v.pages || []).length;
            if (s0 < to && s0 + n > from) {
              for (var i = 0; i < n; i++) {
                var g = s0 + i;
                if (g >= from && g < to) out[g] = v.pages[i];
              }
            }
          }
          cur.continue();
        };
      });
    }).then(function () {
      // 빈 칸을 메우지 않고 순서대로만 돌려준다 (서버도 같은 방식)
      var pages = [];
      for (var i = 0; i < out.length; i++) if (out[i] !== undefined) pages.push(out[i]);
      return pages;
    });
  }

  function allParts(jid) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction([S.parts], 'readonly');
        var list = [];
        t.oncomplete = function () { res(list.sort(function (a, b) { return a.s0 - b.s0; })); };
        t.onerror = function () { rej(t.error); };
        t.objectStore(S.parts).openCursor().onsuccess = function (e) {
          var c = e.target.result;
          if (!c) return;
          if (c.value.jid === String(jid)) list.push(c.value);
          c.continue();
        };
      });
    });
  }

  function putMeta(jid, blob) {
    return tx([S.meta], 'readwrite', function (t) {
      t.objectStore(S.meta).put({ key: jid + '|meta', jid: String(jid), blob: blob });
      return true;
    });
  }
  function getMeta(jid) {
    return get1(S.meta, jid + '|meta').then(function (v) { return (v && v.blob) || null; });
  }

  function putImage(jid, name, blob) {
    return tx([S.images], 'readwrite', function (t) {
      t.objectStore(S.images).put({ key: jid + '|' + name, jid: String(jid), name: name, blob: blob, bytes: blob.size || 0 });
      return true;
    });
  }
  function getImage(jid, name) {
    return get1(S.images, jid + '|' + name).then(function (v) { return (v && v.blob) || null; });
  }
  // 배경 이미지 하나가 여러 문서에 걸칠 수 있어 이름만으로도 찾는다
  function imageByName(name) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction([S.images], 'readonly');
        var found = null;
        t.oncomplete = function () { res(found); };
        t.onerror = function () { rej(t.error); };
        t.objectStore(S.images).openCursor().onsuccess = function (e) {
          var c = e.target.result;
          if (!c) return;
          if (c.value.name === name) { found = c.value.blob; return; }   // 첫 하나면 충분
          c.continue();
        };
      });
    });
  }

  // ── 서버 파일 그대로 보관 (.src 원본 PDF 등) ────────────────────────────
  function putFile(jid, name, blob) {
    return tx([S.files], 'readwrite', function (t) {
      t.objectStore(S.files).put({ key: jid + '|' + name, jid: String(jid), name: name, blob: blob, bytes: blob.size || 0 });
      return true;
    });
  }
  function getFile(jid, name) {
    return get1(S.files, jid + '|' + name).then(function (v) { return (v && v.blob) || null; });
  }
  function listFiles(jid) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction([S.files], 'readonly');
        var out = [];
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
        t.objectStore(S.files).openCursor().onsuccess = function (e) {
          var c = e.target.result;
          if (!c) return;
          if (c.value.jid === String(jid)) out.push({ name: c.value.name, bytes: c.value.bytes });
          c.continue();
        };
      });
    });
  }

  function remove(jid) {
    var id = String(jid);
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction([S.docs, S.parts, S.meta, S.images, S.files], 'readwrite');
        t.oncomplete = function () { res(true); };
        t.onerror = function () { rej(t.error); };
        t.objectStore(S.docs).delete(id);
        t.objectStore(S.meta).delete(id + '|meta');
        var del = function (os) {
          os.openCursor().onsuccess = function (e) {
            var c = e.target.result;
            if (!c) return;
            if (c.value.jid === id) c.delete();
            c.continue();
          };
        };
        del(t.objectStore(S.parts));
        del(t.objectStore(S.images));
        del(t.objectStore(S.files));
      });
    });
  }

  function stats() {
    return listDocs().then(function (rows) {
      var bytes = 0;
      for (var i = 0; i < rows.length; i++) bytes += rows[i].bytes || 0;
      return { count: rows.length, bytes: bytes };
    });
  }

  // ── 서버가 지운 뒤에도 그림이 나오게 (sw.js 와 페이지가 같이 쓴다) ───────
  //   서버가 갖고 있던 배경 그림은 기기에 있다. 경로별로 **응답 모양이 다르다**:
  //     img/<이름>      → 그림 그대로 (binary)
  //     page/<jid>/<쪽> → 그림 그대로 (읽기 화면이 <img src> 로 건다)
  //     bg/<jid>/<쪽>   → JSON {ok, url} — 원본은 {url} 을 받아 <img src> 를 바꾼다
  //   여기서 모양을 틀리면 그림이 통째로 안 나오므로 한 곳에서만 만든다.
  function blobResponse(blob) {
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': blob.type || 'image/png',
        'Content-Length': String(blob.size || 0),
        // 이름이 내용을 가리킨다(내용이 바뀌면 이름도 바뀐다) → 오래 캐시해도 안전
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  }

  function pageImageName(jid, pno) {
    return doc(jid).then(function (d) {
      var n = (d && d.pages && d.pages[pno]) || '';
      if (!n) return null;
      return getImage(jid, n).then(function (b) {
        if (b) return { name: n, blob: b };
        return imageByName(n).then(function (b2) { return b2 ? { name: n, blob: b2 } : null; });
      });
    });
  }

  function imageResponse(kind, rest) {
    var jid = String(rest[0] || '');
    var pno = parseInt(rest[1] || '0', 10);
    if (!jid) return Promise.resolve(null);
    return Promise.resolve().then(function () {
      if (kind === 'img') return imageByName(jid).then(function (b) { return b ? blobResponse(b) : null; });
      return pageImageName(jid, isFinite(pno) ? pno : 0).then(function (f) {
        if (!f) return null;
        if (kind === 'bg') {
          // JSON 으로 답한다 — 원본 코드가 {ok, url} 을 기대한다.
          //  url 은 기기가 다시 물어볼 주소(우리가 기기에서 답한다).
          return new Response(JSON.stringify({ ok: true, url: '/api/import/img/' + encodeURIComponent(f.name), local: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
          });
        }
        return blobResponse(f.blob);        // page
      });
    });
  }

  function persist() {
    try { if (navigator.storage && navigator.storage.persist) return navigator.storage.persist(); } catch (e) {}
    return Promise.resolve(false);
  }

  // ── 번들 읽기 (서버 → 기기) ─────────────────────────────────────────────
  //  스트림으로 받아 파일 하나씩 저장한다. 문서가 수백 MB 여도 **파일 하나 크기**만
  //  메모리에 올라간다. 조금씩 도착하는 것을 견디도록 바이트 단위로 맞춰 읽는다.
  //
  //  ⚠ 여기서 조용히 어긋나면 '다 받았다'고 잘못 판단해 서버 사본이 지워진다.
  //    그래서 매니페스트와 **개수·용량을 대조**하고, 하나라도 다르면 ok:false 다.
  function readBundle(response, jid, onProgress) {
    var id = String(jid);
    var total = Number((response.headers && response.headers.get('X-SDY-Bundle-Files') != null
      ? response.headers.get('X-SDY-Bundle-Files') : 0)) || 0;
    var totalBytes = Number((response.headers && response.headers.get('X-SDY-Bundle-Bytes')) || 0) || 0;

    var reader = response.body.getReader();
    var queue = [];              // 아직 쓰지 않은 조각
    var qlen = 0;                // queue 에 남은 바이트
    var got = 0;                 // 파일 **내용** 바이트 합 (서버의 list.bytes 와 같은 뜻)
    var count = 0;               // 담은 파일 수 (매니페스트 포함)
    var manifest = null;
    var slices = [];             // [{s0, pages}] — 조각
    var full = null;             // 조각이 없을 때 쓰는 전체 본문
    var expected = { files: 0, bytes: 0 };

    function pull() {
      return reader.read().then(function (r) {
        if (r.done) return false;
        queue.push(r.value);
        qlen += r.value.length;
        return true;
      });
    }
    // n 바이트를 정확히 모아 돌려준다 (부족하면 스트림에서 더 받는다)
    function readExactly(n) {
      if (qlen >= n) return Promise.resolve(concat(n));
      return pull().then(function (more) {
        if (!more) {
          // 스트림이 먼저 끝났다 — 있는 것만 돌려주고 호출부가 실패로 판단한다
          return qlen >= n ? concat(n) : (qlen ? concat(qlen) : null);
        }
        return readExactly(n);
      });
    }
    function concat(n) {
      var out = new Uint8Array(n), off = 0;
      while (off < n) {
        var head = queue[0];
        var take = Math.min(head.length, n - off);
        out.set(head.subarray(0, take), off);
        off += take;
        if (take === head.length) queue.shift(); else queue[0] = head.subarray(take);
      }
      qlen -= n;
      return out;
    }
    function u32(u8) {
      return ((u8[0] << 24) | (u8[1] << 16) | (u8[2] << 8) | u8[3]) >>> 0;
    }

    function handleEntry(name, data, size) {
      if (name === '#manifest') {
        try { manifest = JSON.parse(new TextDecoder().decode(data)); } catch (e) { manifest = null; }
        return Promise.resolve();
      }
      // 파일 수·용량은 **파일만** 센다 (매니페스트 자신은 제외 — 서버도 빼고 센다)
      count += 1;
      got += size;
      var kind = name.slice(0, 2);
      var base = name.slice(2);
      if (kind === 'd/') return storeDocFile(id, base, data);
      if (kind === 'i/') return putImage(id, base, new Blob([data]));
      return Promise.resolve();
    }

    // 서버가 갖고 있던 파일을 **이름 그대로** 해석해 담는다.
    //  · {jid}.meta.json          → meta (쪽수·버전)
    //  · {jid}.s3.gz / .s3        → 조각 (3쪽부터)
    //  · {jid}.json.gz / .json    → 전체 본문 (조각이 없을 때만 쓴다)
    //  · 그 밖(.src 원본 PDF 등)  → files 에 그대로
    function storeDocFile(jid2, base, data) {
      var mSlice = /\.s(\d+)(\.gz)?$/.exec(base);
      if (/\.meta\.json$/.test(base)) {
        return putMeta(jid2, new Blob([data], { type: 'application/json' }));
      }
      // 본문은 두 가지 이름으로 온다 — {jid}.json.gz(전체) 와 {jid}.s3.gz(조각).
      //  ⚠ .s3.gz 는 .json 으로 끝나지 않는다. 이걸 빠뜨리면 조각을 '모르는 파일'로
      //    보고 그냥 보관만 해서 **쪽이 하나도 안 담긴다**(실제로 그랬다).
      var isBody = /\.json(\.gz)?$/.test(base) || !!mSlice;
      if (!isBody) return putFile(jid2, base, new Blob([data]));     // .src 등

      return decodePages(data, base).then(function (pages) {
        if (!pages) {
          // 못 읽은 본문은 원본 그대로 남긴다 — 조용히 버리면 논문이 사라진다
          return putFile(jid2, base, new Blob([data]));
        }
        if (mSlice) slices.push({ s0: parseInt(mSlice[1], 10), pages: pages });
        else full = pages;
        return true;
      });
    }

    // gzip 이면 풀고, 평문이면 그대로 — 두 경우 다 페이지 배열을 꺼낸다.
    //  서버는 `{jid}.json.gz`(전체)와 `{jid}.s{n}.gz`(조각)를 둘 다 만들 수 있고,
    //  옛 문서는 평문 `.json` 일 수도 있다.
    function decodePages(data, base) {
      var text = null;
      var gz = /\.gz$/.test(base) || (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b);
      return Promise.resolve()
        .then(function () {
          if (!gz) return new TextDecoder().decode(data);
          return gunzip(data);
        })
        .then(function (t) {
          text = t;
          var j = JSON.parse(t);
          var pages = Array.isArray(j) ? j : (j && (j.pages || j.__pages)) || null;
          return pages && pages.length ? pages : null;
        })
        .catch(function () {
          // gzip 이 아닐 수 있다 — 평문으로 한 번 더
          try {
            var j2 = JSON.parse(text != null ? text : new TextDecoder().decode(data));
            var p2 = Array.isArray(j2) ? j2 : (j2 && j2.pages) || null;
            return p2 && p2.length ? p2 : null;
          } catch (e) { return null; }
        });
    }

    function gunzip(u8) {
      if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('압축 해제 미지원'));
      var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer().then(function (ab) { return new TextDecoder().decode(ab); });
    }

    // 항목 하나를 읽는다. 스트림이 끝났으면 null.
    function readEntry() {
      return readExactly(4).then(function (h) {
        if (!h || h.length < 4) return null;
        var nameLen = u32(h);
        if (nameLen === 0) return { end: true };               // 끝 표시
        if (nameLen > 4096) return { broken: '이름 길이가 이상해요 (' + nameLen + ')' };
        return readExactly(nameLen).then(function (nb) {
          if (!nb || nb.length < nameLen) return { broken: '이름이 잘렸어요' };
          return readExactly(4).then(function (szb) {
            if (!szb || szb.length < 4) return { broken: '크기가 잘렸어요' };
            var sz = u32(szb);
            return readExactly(sz).then(function (body) {
              if (!body || body.length < sz) return { broken: '내용이 잘렸어요' };
              return { name: new TextDecoder().decode(nb), data: body, size: sz };
            });
          });
        });
      });
    }

    return readExactly(6).then(function (magic) {
      if (!magic || magic.length < 6) throw new Error('내려받은 내용이 비어 있어요');
      var mg = '';
      for (var i = 0; i < 6; i++) mg += String.fromCharCode(magic[i]);
      if (mg !== 'SDYB1\n') throw new Error('논문 묶음 형식이 아니에요');

      return (function step() {
        return readEntry().then(function (e) {
          if (!e) return null;
          if (e.end) return null;
          if (e.broken) throw new Error(e.broken);
          return handleEntry(e.name, e.data, e.size).then(function () {
            if (onProgress) onProgress(got, totalBytes);
            return step();
          });
        });
      })();
    }).then(function () {
      // 조각이 있으면 조각을, 없으면 전체 본문을 쓴다.
      //  (서버는 둘 다 보낸다. 조각 쪽이 페이지 범위를 정확히 알려 준다)
      var use = slices.length ? slices : (full ? [{ s0: 0, pages: full }] : []);
      return use.reduce(function (pr, s2) {
        return pr.then(function () { return putPart(id, s2.s0, s2.pages); });
      }, Promise.resolve()).then(function () {
        expected = {
          files: (manifest && manifest.files) || total,
          bytes: (manifest && manifest.bytes) || totalBytes
        };
        // 온전한가 — 매니페스트가 말한 **파일 수와 바이트 수가 정확히** 맞아야 한다.
        //  하나라도 모자라면 서버 사본을 지우면 안 된다(사본을 지우고 나서
        //  다시 받을 곳이 없어지는 것이 이 구조의 유일한 큰 위험이다).
        var bytesOK = got === expected.bytes;
        var filesOK = count >= expected.files;
        var ok = !!manifest && bytesOK && filesOK && expected.files > 0;
        var why = '';
        if (!ok) {
          why = !manifest ? '매니페스트가 없어 온전한지 확인할 수 없습니다'
            : (!filesOK ? '파일이 ' + (expected.files - count) + '개 모자랍니다'
              : '용량이 ' + (expected.bytes - got) + '바이트 모자랍니다');
        }
        return {
          ok: ok, jid: id, files: count, bytes: got, manifest: manifest,
          parts: use.length, slices: slices.length,
          expected_files: expected.files, expected_bytes: expected.bytes,
          reason: why
        };
      });
    });
  }

  root.SDYDocStore = {
    open: open, has: has, doc: doc, listDocs: listDocs, putDoc: putDoc,
    putPart: putPart, slice: slice, allParts: allParts,
    putMeta: putMeta, getMeta: getMeta,
    putImage: putImage, getImage: getImage, imageByName: imageByName,
    putFile: putFile, getFile: getFile, listFiles: listFiles,
    remove: remove, stats: stats, persist: persist,
    imageResponse: imageResponse,
    readBundle: readBundle
  };
})(typeof self !== 'undefined' ? self : this);
