# Clipboard-Image Paste → Disconnection-Dependent Visibility Failure

**QA deliverable:** root-cause analysis + test-case suite (unit / integration / E2E) + automated no-sleep test script
**Automated suite:** `test/image_paste_persistence_contract.mjs` — `npm run test:pasteimg` (34 checks, ~17 s, 0 arbitrary sleeps)
**Related existing coverage:** `test/image_cross_device_contract.mjs`, `test/note_image_reopen_contract.mjs` (`npm run test:image`)

---

## 1. Executive Summary

Pasting an image renders it **immediately on every device** — and can **simultaneously store it in a form that only the sender's device can ever load**. Those are two different channels:

| Channel | What it carries | Lifetime |
|---|---|---|
| **Real-time channel** (ops + SSE) | the element op, optionally carrying a *local* image source (`data:`/`blob:`) | instant, but the source may be bound to the sender's document |
| **Persistence channel** (`/api/upload` → `/api/img/...` → URL-fix op) | the binary on server storage + the durable URL in the ops store | must be independent of any device's session |

The bug happens when the real-time channel succeeds but the persistence channel never completes (or its confirmation is lost). Device B renders the pasted image live from the *local* source riding in the op; when Device A disconnects, the local source dies (`blob:` object URLs are destroyed with the document that created them; a stripped/absent `localURL` leaves nothing to load), and the durable URL was never written. Result: a broken reference — "there was an image here" — for B and for every device connecting afterwards.

In this codebase the note-canvas paste path is the vulnerable surface and carries four defenses (18.4/14.15/14.17/18.8); the chat upload path stores files server-side and is immune to *sender* disconnect. The automated suite reproduces the pre-fix bug state deterministically, then verifies each defense.

---

## 2. Code-Level Trace (where the bug lives)

### 2.1 Paste intake — instant local placement

```
sdynotes.js:15524  document.addEventListener('paste', …)
  └─ collects image files from e.clipboardData.items
sdynotes.js:15279  filesToImgItems(files)
  ├─ URL.createObjectURL(file)                    ← blob: preview (document-bound!)
  └─ pendingDataURLForFile(file)                  ← compressed data: original (survives sync)
sdynotes.js:15296  placeImgItem(item, …)
  └─ doc.pages[p].els.push({ type:'image', id, url:'', localURL, pending:true })
sdynotes.js:7090   buildImageEl(el)
  └─ img.src = el.localURL || el.url              ← local-first render (no upload gate)
sdynotes.js:15338  uploadImgs → saveDoc() → runUploadQueue()   ← persistence starts *after* placement
```

### 2.2 Real-time propagation (why Device B sees it instantly)

```
sender: genOps → POST /api/sync/push          (sdynotes.js:17303, 17340)
server: syncPush stores op per element (LWW)  (server/src/lib/syncEngine.js)
        publishLive('notes', nb)              (server/src/lib/sse.js)
others: EventSource('/api/live') → pullSync() within ~60 ms   (sdynotes.js:24441-24448)
        upsertEl(op.data) → buildImageEl → img.src = localURL || url
```

So Device B renders the image **from the op's `localURL` fallback — before any upload has finished**. The op serializer decides whether that fallback is durable:

```
sdynotes.js:5665  serverImageElement(el)         — op serialization policy
  · url set              → localURL dropped (durable URL is enough)
  · url unset + data:    → data: original rides in the op          ← defense ① (18.8)
  · url unset + blob:    → localURL dropped (blob: is useless on any other document)
  · pending/failed flags → stripped (volatile, device-local)
```

### 2.3 Persistence — the part that must outlive the sender

```
sdynotes.js:15378  uploadOne → POST /api/upload                      (binary → server)
server pages.js:37   sharp → webp → disk → { url:'/api/img/img_x.webp' }
sdynotes.js:15434  applyUploadedURL(job, url)
  ├─ swap el.url, delete el.pending/failed/localURL
  ├─ immediate flushSaveDoc + pushOps + flushSync (no debounce wait) ← defense (18.8)
  └─ queueImageMetaPut(nbId, urlFixOp) → localStorage outbox         ← defense ② (durable)
sdynotes.js:15417  flushImageMetaOutbox() — retry on online/open/interval/leave
sdynotes.js:15315  enqueuePendingImageUploads() — any device re-uploads a data:-sourced
                   pending image on open/online/8 s interval         ← defense ③ (14.17)
sdynotes.js:16933  initSync() — pull + heal + re-enqueue on every note open
```

### 2.4 Chat surface (Youpscord)

```
sdynotes.js:25500  ypUpload(file) → POST /api/chat/upload → msg.file.id (server-side id)
server chat.js      state.files (RAM, TTL 24 h, byte-budget eviction) → GET /api/chat/file/:id
sdynotes.js:26105  yfUploadDm → POST /api/dm/upload → dmstore on disk → GET /api/dm/file/:id
```

Chat/DM binaries are stored **server-side** — asset lifetime is already independent of the uploader's session. (Gap: the chat input has no `paste` handler; images enter via the file picker. The document-level paste listener only acts while a note is open.)

---

## 3. Root-Cause Analysis — Failure Modes

### FM-1 · `blob:` object URL persisted as the image source (the classic paste bug)
`URL.createObjectURL(file)` returns a URL **scoped to the document that created it**. It dies when Device A's tab closes/refreshes; it was never valid on Device B at all. If the element's state keeps `localURL: 'blob:…'` (or worse, `url: 'blob:…'`) as the only source, every other device — and A itself after a reload — gets a dead reference. *Serialization defense:* `serverImageElement()` drops `blob:` values from outgoing ops. *Residual hole:* if browser compression fails (`pendingDataURLForFile` returns `''`), the element is blob-only and is deliberately unrecoverable — see test B-02/B-03.

### FM-2 · Sender disconnects before the upload finishes ("pending death race")
The element was placed with `url:''`, `pending:true` and pushed live with at best a `data:` fallback. If A goes offline before `uploadOne` completes, no device ever receives a durable URL. **Pre-fix behavior:** the op serializer stripped `localURL` unconditionally, so other devices kept only `{type:'image', url:''}` — a placeholder with nothing to load. **Fixes:** ① `data:` original rides in the op (rendering still works everywhere), ③ any device that opens the note re-uploads the `data:` source and confirms the `/api/img/` URL itself.

### FM-3 · Upload succeeds but the URL-fix op is lost (partial-failure race)
The binary reached the server, but the *small JSON op* saying "element X now has URL Y" was cancelled by the disconnect (or eaten by a debounce when the tab closed quickly). The file exists on the server, unreferenced; the element stays pending forever. **Fix:** ② durable localStorage outbox (`queueImageMetaPut`) + immediate non-debounced flush on upload completion + retry on reconnect/open/interval.

### FM-4 · Asset lifetime bound to the uploader's session (architecture invariant)
Whenever a client keeps the binary itself (blob:, IndexedDB, in-memory cache) instead of uploading it and persisting a **remote** URL in the shared store, every other client's reference dies with the uploader's session. This is the invariant the whole report boils down to: *the persisted reference must point at storage whose lifetime is independent of any client session.* The chat route satisfies it for sender disconnect (server-side files) — verified by test — but note the residual server-side caveats: chat files are **RAM-resident** (lost on server restart, TTL 24 h, budget eviction), while note images are on disk under `/api/img/`.

**Why the symptom is deceptive:** real-time rendering (FM-2's `data:` fallback or a shared preview) makes the image look "synced" while the durability step is still in flight. The disconnect doesn't break what users see *now* — it breaks what they can load *later*, so the bug surfaces far from its cause.

---

## 4. Test-Case Suite

Legend — **Expected** = required (fixed) behavior; **Actual (bug state)** = what the pre-fix code did / what a regression reintroduces. "Automated" refers to a check in `test/image_paste_persistence_contract.mjs`.

### 4.1 Unit level — serialization & render policy (pure functions, no server)

#### TC-U1 · Local-first render: pasted image paints before any upload
- **Preconditions:** editor module loaded (`window.buildImageEl` available).
- **Steps:** build the DOM node for `{type:'image', url:'', localURL:'data:image/png;base64,…', pending:true}`.
- **Expected:** node has class `pending`; `img.src === localURL` (placement needs no network round-trip).
- **Actual (bug state):** if rendering gated on `url`, the paste would show nothing until upload finishes — and forever, if the upload never finishes.
- **Automated:** `U-01`.

#### TC-U2 · Confirmed element renders from the durable URL
- **Preconditions:** same as U1.
- **Steps:** build the node for `{type:'image', url:'/api/img/img_x.webp'}`.
- **Expected:** `img.src === '/api/img/img_x.webp'`; no `pending` class.
- **Actual (bug state):** rendering a stale `localURL` in preference to a confirmed `url` resurrects dead blob:/data: sources after reload.
- **Automated:** `U-02`.

#### TC-U3 · Op keeps the `data:` original while `url` is unset (durable fallback)
- **Preconditions:** `window.serverImageElement` available.
- **Steps:** serialize `{url:'', localURL:'data:image/png;base64,…', pending:true}`.
- **Expected:** returned op still carries `localURL` starting with `data:image/`.
- **Actual (bug state):** pre-18.8 serializer deleted `localURL` unconditionally → receivers got `{url:''}` → broken image with "was here" placeholder only.
- **Automated:** `U-03`.

#### TC-U4 · Volatile flags never leave the device
- **Steps:** serialize an element with `pending:true, failed:true`.
- **Expected:** op contains neither `pending` nor `failed`.
- **Actual (bug state):** leaked `pending` flags make receivers render permanent spinners for images that are actually durable.
- **Automated:** `U-03` (flags check).

#### TC-U5 · Local source dropped once the durable URL exists
- **Steps:** serialize `{url:'/api/img/a.webp', localURL:'data:…'}`.
- **Expected:** op has `url`, no `localURL` (keeps ops/memos small; no double source of truth).
- **Automated:** `U-04`.

#### TC-U6 · `blob:` object URLs never leave the device
- **Steps:** serialize `{url:'', localURL:'blob:http://a/x'}`.
- **Expected:** op has no `localURL` (a blob: URL is meaningless on any other document).
- **Actual (bug state):** persisting it yields a permanently dead reference on every other device and after sender reload.
- **Automated:** `U-05`.

#### TC-U7 · `blob:` smuggled into the `url` field is sanitized
- **Steps:** serialize `{url:'blob:http://a/x'}`.
- **Expected:** `url` serialized as `''`.
- **Automated:** `U-05` (sanitization check).

### 4.2 Integration level — server routes, durable outbox, chat asset lifetime

#### TC-I1 · `/api/upload` produces a durable, servable asset
- **Preconditions:** Fastify server up, `SDY_STORAGE=oracle`.
- **Steps:** POST a real decodable PNG to `/api/upload`; GET the returned `/api/img/…` URL.
- **Expected:** 200; `content-type: image/*` (webp re-encode); non-empty bytes.
- **Actual (bug state):** if the "upload" only returned a session-scoped reference (or stored nothing), the later GET would 404 — the missing-asset symptom.
- **Automated:** `E-03` (exercised through the real client flow).

#### TC-I2 · URL-fix op is recorded in the durable outbox before it is trusted as sent
- **Preconditions:** app booted in a device (JSDOM) realm.
- **Steps:** call `queueImageMetaPut(nbId, op)`; inspect `getImageMetaOutbox()` and `localStorage['sdy_imgmeta_outbox']`.
- **Expected:** entry present under the localStorage key → survives reload/crash.
- **Actual (bug state):** in-memory-only queue → URL-fix lost on disconnect → orphaned server file, element pending forever (FM-3).
- **Automated:** `I-01`.

#### TC-I3 · Outbox survives a severed connection and delivers after reconnect
- **Preconditions:** outbox entry queued; `/api/sync/push` severed (partial connectivity: small sync ops fail while other traffic works).
- **Steps:** ① `flushImageMetaOutbox()` while severed → assert entry still present and server did **not** receive it. ② Restore endpoint → flush again → assert server op store now has the URL and the outbox entry is cleared.
- **Expected:** no data loss across the disconnect; exactly-once visible delivery.
- **Actual (bug state):** fire-and-forget push → the URL-fix op dies with the connection (FM-3).
- **Automated:** `I-03` (severed / not-received / delivered-and-cleared).

#### TC-I4 · Chat: upload binds the message to a server-side file id
- **Preconditions:** chat room joined as sender.
- **Steps:** POST `/api/chat/upload` (multipart, uid + PNG).
- **Expected:** `{ok, msg:{kind:'img', file:{id,…}}}` — the message references server storage, not the sender.
- **Automated:** `I-04`.

#### TC-I5 · Chat: asset remains fully loadable after the sender leaves (byte-exact)
- **Preconditions:** image uploaded per I4.
- **Steps:** POST `/api/chat/leave` (sender session ended) → GET `/api/chat/file/:id`.
- **Expected:** 200 with byte-identical content — asset lifetime ≠ uploader session.
- **Actual (bug state):** any client-side retention (blob:/IndexedDB served by the sender) makes the image unloadable the moment the sender disconnects.
- **Automated:** `I-05`.

#### TC-I6 · Chat: unknown/evicted file ids fail fast
- **Steps:** GET `/api/chat/file/does-not-exist`.
- **Expected:** 404 with a clear error (no phantom assets, no hangs).
- **Automated:** `I-06`.

#### TC-I7 · DM attachments persist on disk *(covered by the existing friends/DM suites; listed for completeness)*
- **Notes:** `/api/dm/upload` → `dmstore` disk file; `GET /api/dm/file/:id` (participants only). Same invariant as I5 with participant authorization.

### 4.3 E2E level — full device matrix, real paste events, real disconnects

#### TC-E1 · Paste places the image instantly on the sender's canvas
- **Preconditions:** Device A signed in-less session, note open; clipboard carries a PNG.
- **Steps:** dispatch a real `paste` event with `clipboardData.items → File`.
- **Expected:** `.paper-img` element with an `img` child appears with no upload gate.
- **Automated:** `E-01`.

#### TC-E2 · Upload completes → durable URL persisted in the server ops store
- **Preconditions:** E1 done.
- **Steps:** wait (event-driven) for the sender's `img.src` to become `/api/img/…`; pull `/api/sync/pull?nb=…&since=0`.
- **Expected:** the element's op carries `url:'/api/img/…'`; **no `blob:` localURL is ever persisted** in the durable op.
- **Actual (bug state):** op stuck at `url:''` (FM-2) or carrying a blob: source (FM-1).
- **Automated:** `E-02`.

#### TC-E3 · The asset is servable from server storage over HTTP
- **Steps:** `GET` the durable URL from a raw HTTP client (no session).
- **Expected:** 200, `image/*`, non-empty body.
- **Actual (bug state):** 404 / broken reference once the sender's session is gone.
- **Automated:** `E-03`.

#### TC-E4 · Sender session destroyed → a fresh device still renders the image
- **Preconditions:** E2/E3 done.
- **Steps:** destroy Device A's session (window closed — timers, in-flight fetches, blob URLs all die); boot Device B with **empty localStorage**; open the same note.
- **Expected:** B renders `img.src === <server URL>`; no `pending`/`failed` placeholder.
- **Actual (bug state):** B shows an empty/broken image or a spinner — the reported symptom.
- **Automated:** `E-04`.

#### TC-E5 · Bug condition: sender offline before upload finishes → op carries the durable fallback
- **Preconditions:** Device A's `/api/upload` severed (large-binary transfer dead; small sync ops still flow — the exact "visible live, then A drops" scenario). Paste an image.
- **Steps:** ① assert A still sees the pasted image (`pending`, local src — upload can never finish); ② wait for the pending op on the server; ③ assert it carries `localURL: data:image/…` with `url:''`.
- **Expected:** the live op contains the recoverable `data:` original (this is precisely what Device B "sees in real time").
- **Actual (bug state):** pre-18.8 the op had **no** localURL → B renders nothing but a placeholder; with a blob:-only element (compression fallback) it is unrecoverable by design.
- **Automated:** `E-05` (3 checks).

#### TC-E6 · Receiving device self-heals and persists the repair server-side
- **Preconditions:** E5 done; sender's session destroyed.
- **Steps:** boot Device B (fresh) and open the note; wait for B's element src to become `/api/img/…`; pull the server op.
- **Expected:** B renders the image from the start (data: fallback), re-uploads the original itself, and the **repaired URL is persisted in the server ops store** (screen and storage identical).
- **Actual (bug state):** B renders a placeholder forever; no device ever repairs the asset because no recoverable source existed.
- **Automated:** `E-06` (2 checks).

#### TC-E7 · A brand-new device loads the image purely from server storage
- **Preconditions:** E6 done; original sender still gone.
- **Steps:** boot Device C (fresh); open the note; HTTP-GET the asset.
- **Expected:** C's `img.src` equals the server URL, no pending class; GET → 200. *(This is the acceptance criterion of the original bug report: "any new device subsequently connecting" must be able to load the image.)*
- **Automated:** `E-07` (2 checks).

#### TC-E8 · Regression canary: pre-fix op (no localURL, no url) → broken reference on receivers
- **Preconditions:** note seeded directly in the server ops store with `{type:'image', url:''}` — the exact state old clients produced.
- **Steps:** open the note on a fresh device.
- **Expected (canary):** the DOM shows `img.src === ''` — i.e. the deterministic bug state; combined with B-03 this proves such elements are **unrepairable** (auto-reupload skips sources that aren't `data:`).
- **Purpose:** pins the failure mode so any serialization regression that recreates this op shape fails loudly elsewhere.
- **Automated:** `B-01`, `B-03`.

#### TC-E9 · Regression canary: `blob:` localURL reaches a receiver as a dead reference
- **Steps:** seed an op with `localURL:'blob:http://device-a/gone-forever'`; open on a fresh device.
- **Expected (canary):** receiver renders `src` starting with `blob:` — a reference that can never resolve outside the sender's (now dead) document.
- **Automated:** `B-02`.

#### TC-E10 · No fatal runtime errors across the whole device matrix
- **Steps:** collect `window.onerror` / unhandled rejections / jsdomErrors on every device (including destroyed ones).
- **Expected:** zero fatal errors — repairs and severed connections degrade gracefully.
- **Automated:** `E-08`.

---

## 5. Automated Suite — Design & No-Sleep Strategy

File: `test/image_paste_persistence_contract.mjs` · Script: `npm run test:pasteimg` · Auto-discovered by `npm test` (group `test:pasteimg`, also appended to `test:image`).

**Constraint honored: zero arbitrary `sleep`/fixed `setTimeout` settle-delays.** The only timed waits are (a) deadline bounds and (b) an adaptive poll backoff (0→1→2→…→16 ms) whose value never affects correctness — a condition becoming true is detected within one loop tick regardless.

1. **`waitFor(desc, predicate, {timeout})`** — smart polling: evaluates the predicate, returns the instant it is truthy, fails fast on predicate exceptions, bounded by a deadline. Consumes the app's real async work (fetch round-trips, 400 ms save debounce, 180 ms ops debounce, upload queue) as *events*, not as guessed delays.
2. **`waitForSelector(dom, selector)`** — fully event-driven via `MutationObserver` (no polling at all); DOM insertions resolve immediately.
3. **Server readiness** — retry loop of real `/api/health` requests (each attempt is a network event).
4. **Deterministic bug-state setup** — instead of racing to catch a transient pre-fix state, broken ops are seeded directly into the server ops store, making TC-E8/E9 stable on every run.

**Device simulation:** each device is a real `JSDOM.fromURL` session loading the production `sdynotes.html`/`sdynotes.js` against the real Fastify server (oracle storage mode, temp `SDY_BASE_DIR`). "Disconnect" = destroying the session (all timers cleared, in-flight fetches killed, blob URLs invalidated) — faithful to a closed tab. "Partial connectivity" = per-endpoint fetch severing (`/api/upload` or `/api/sync/push`).

**Harness notes worth keeping (they encode real bugs found while building this):**
- jsdom never fires `load`/`error` for `<img>` with `data:`/`blob:` URLs → the suite stubs `Image` (microtask onload for `data:`), `canvas.getContext/toBlob`, and unique `URL.createObjectURL`, so the *real* paste pipeline (`compressImg` → `pendingDataURLForFile` → `placeImgItem`) runs end-to-end.
- `window.File/Blob` must stay jsdom-native: swapping in Node's makes jsdom's `FileReader` reject them, which **silently kills the `data:` fallback** and recreates the exact bug under test. The jsdom↔Node blob boundary is bridged only inside the fetch shim (FormData parts are deserialized via `FileReader.readAsArrayBuffer` and rebuilt as Node `File`s).

**Results:** 34/34 checks pass, ~17 s per run (verified across repeated runs), covering TC-U1…U7, TC-I1…I6, TC-E1…E10 and both bug-state canaries.

---

## 6. Residual Risks (not fixed by current defenses — tracked, not hidden)

1. **blob:-only elements are unrecoverable by design** — when browser compression fails, `pendingDataURLForFile` returns `''` and the element keeps only a blob: source; serialization correctly refuses to ship it, but the image is then unrecoverable on other devices. Mitigation ideas: queue the raw `File` in IndexedDB as a second durable fallback, or retry compression.
2. **Chat files are RAM-resident** (`server/src/routes/chat.js`): safe against sender disconnect, lost on server restart, TTL 24 h, byte-budget eviction → `404 파일이 사라졌어요`. Note images (`/api/img/`) and DM files (disk) do not share this risk.
3. **Chat input has no paste handler** — pasted images into the chat box do nothing unless a note is open (the document-level listener then targets the note canvas). A paste handler for `#ypTxt`/DM input would route clipboard images to `ypUpload`/`yfUploadDm` and inherit the server-side persistence for free.
