// Actual layout/paint regression. jsdom cannot detect the original multi-second freeze.
// npm run bench:activation (first: npx playwright install chromium)
// Optional system/bundled browser: SDY_CHROMIUM_PATH=/path/to/chromium
// Defaults to CPU-only headless rendering; SDY_CHROMIUM_ARGS can override launch flags.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { activationFixture, openActivationNote, BOXES, SPANS } from './page_activation_fixture.mjs';

const fixture = await activationFixture();
let browser;
const launchArgs = process.env.SDY_CHROMIUM_ARGS ? JSON.parse(process.env.SDY_CHROMIUM_ARGS)
  : ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
try {
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.SDY_CHROMIUM_PATH || undefined,
    args: launchArgs });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.stack || e.message));
  await page.route('**/*', route => route.request().url().startsWith(fixture.base)
    ? route.continue() : route.abort());
  await page.goto(fixture.base + '/?sandbox=1&turbo=1');
  await page.evaluate(openActivationNote);
  await page.waitForFunction(() => !!document.querySelector('.page-preview-img[data-width="900"]'));
  assert.equal(await page.locator('#pagesStage .tb').count(), 0, 'reading upgrade must not hydrate text');

  // Resolve geometry and finish automation setup before profiling. The timed
  // section below uses in-page measurement rather than DOM/Runtime polling.
  const rect = await page.locator('.paper[data-page-idx="0"]').boundingBox();
  await page.locator('.paper[data-page-idx="0"]').getAttribute('data-page-idx');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  // Do not poll Runtime/DOM during the timed interval. Cold Playwright/CDP
  // utility work can itself stop frames for seconds without an app long task.
  // The page measures its own native input → ready → fitting interval and emits
  // results; only native mouse input crosses the protocol while it is running.
  const readyMessage = page.waitForEvent('console', { predicate: m => m.text().startsWith('SDY_ACTIVATION_READY ') });
  const doneMessage = page.waitForEvent('console', { predicate: m => m.text().startsWith('SDY_ACTIVATION_DONE ') });
  await page.evaluate(() => {
    const a = window.__activation = { functions: {}, tasks: [], frames: [], running: false, done: false,
      downAt: 0, readyMs: null, endAt: Infinity, selectedId: null };
    let last = performance.now(), timeout;
    const summary = arr => ({ count: arr.length, total: +arr.reduce((x,y)=>x+y,0).toFixed(1), worst: +Math.max(0,...arr).toFixed(1) });
    const observer = new PerformanceObserver(list => {
      if (a.running) a.tasks.push(...list.getEntries().map(e => e.duration));
    });
    observer.observe({ type: 'longtask' });
    for (const name of ['renderPageEls', 'activatePage', '_drainPageRenders', '_drainTightQueue', 'onPaperDown', 'enterEdit', 'liveAct']) {
      const fn = window[name];
      window[name] = function(...args) {
        const t = performance.now();
        try { return fn(...args); }
        finally { if (a.running) (a.functions[name] ||= []).push(performance.now() - t); }
      };
    }
    function finish() {
      if (a.done) return;
      a.tasks.push(...observer.takeRecords().map(e => e.duration)); observer.disconnect();
      a.running = false; a.done = true; clearTimeout(timeout);
      if (a.readyMs === null) console.info('SDY_ACTIVATION_READY ' + JSON.stringify({ id: null }));
      console.info('SDY_ACTIVATION_DONE ' + JSON.stringify({
        functions: Object.fromEntries(Object.entries(a.functions).map(([k,v]) => [k, summary(v)])),
        longTasks: summary(a.tasks), frames: summary(a.frames), readyMs: a.readyMs,
        selectedId: a.selectedId, editingId: document.querySelector('.paper[data-page-idx="0"] .tb.edit')?.dataset.id || null,
      }));
    }
    window.addEventListener('pointerdown', () => {
      a.downAt = performance.now(); last = a.downAt; a.running = true;
      timeout = setTimeout(finish, 10000);
    }, { capture: true, once: true });
    function frame() {
      if (a.done) return;
      const now = performance.now();
      if (a.running) {
        a.frames.push(now - last);
        if (a.readyMs === null && pageReady(0) && selected?.el.classList.contains('sel')) {
          a.readyMs = now - a.downAt; a.selectedId = selected.el.dataset.id;
          a.endAt = now + 2000; // includes double click, late fitting and presence timers
          console.info('SDY_ACTIVATION_READY ' + JSON.stringify({ id: a.selectedId }));
        }
        if (now >= a.endAt) { finish(); return; }
      }
      last = now; requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  const before = await metrics();
  const x = rect.x + 60 / 800 * rect.width, y = rect.y + 48 / 1100 * rect.height;
  const start = Date.now();
  await page.mouse.click(x, y);
  const clickMs = Date.now() - start;
  const first = JSON.parse((await readyMessage).text().slice('SDY_ACTIVATION_READY '.length));
  assert.equal(first.id, 't0_0', 'the FIRST preview click must select its target');
  await page.mouse.dblclick(x, y, { delay: 65 });
  const result = JSON.parse((await doneMessage).text().slice('SDY_ACTIVATION_DONE '.length));
  const after = await metrics();
  result.fixture = { rendering: 'headless', gpuDisabled: launchArgs.includes('--disable-gpu'), boxes: BOXES, words: BOXES * SPANS, cpuSlowdown: 4, viewport: '1280×900', deviceScaleFactor: 1 };
  result.clickMs = clickMs; result.readyMs = Math.round(result.readyMs);
  result.layout = Object.fromEntries(['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration']
    .map(k => [k, +(after[k] - before[k]).toFixed(4)]));
  console.log(JSON.stringify(result, null, 2));
  // Generous regression ceilings, NOT a 60fps claim.
  assert.equal(result.editingId, 't0_0', 'double click enters editing');
  assert.ok(result.layout.LayoutCount < 250, 'no per-word forced-layout storm');
  assert.ok(result.functions.activatePage.worst < 100, 'activation must yield instead of hydrating synchronously');
  assert.ok(result.longTasks.worst < 800, 'no multi-second main-thread freeze');
  assert.ok(result.frames.worst < 1000, 'animation frames keep advancing through activation');
  assert.ok(result.readyMs !== null && result.readyMs < 8000, 'render must finish, not merely defer work indefinitely');

  // Real keyboard, selection, persistence and per-element undo/redo after activation.
  const original = await page.evaluate(() => findEl(0, 't0_0').html);
  await page.keyboard.insertText('검증 입력');
  await page.waitForFunction(() => findEl(0, 't0_0').html.includes('검증 입력'));
  assert.equal(await page.evaluate(() => !!doc.pages[0].edited), true);
  await page.evaluate(() => undo());
  await page.waitForFunction(() => pageReady(0));
  assert.equal(await page.evaluate(() => findEl(0, 't0_0').html), original);
  await page.evaluate(() => redo());
  await page.waitForFunction(() => pageReady(0));
  assert.ok(await page.evaluate(() => findEl(0, 't0_0').html.includes('검증 입력')));

  await page.evaluate(() => { deselectAll(); goToPage(3); });
  await page.waitForSelector('.paper[data-page-idx="2"] .page-preview-img');
  await page.waitForFunction(() => Math.abs(document.getElementById("editorBody").scrollTop - 2 * (paperSize().h + PAGE_GAP) * pageScale) < 2 && !_isScrolling());
  const cold = await page.locator('.paper[data-page-idx="2"]').boundingBox();
  await page.mouse.dblclick(cold.x + 60 / 800 * cold.width, cold.y + 48 / 1100 * cold.height, { delay: 65 });
  await page.waitForFunction(() => !!document.querySelector('.paper[data-page-idx="2"] .tb.edit'));
  assert.equal(await page.locator('.paper[data-page-idx="2"] .tb.edit').getAttribute('data-id'), 't2_0',
    'a native double click starting on a cold preview must enter editing');

  // A native wheel immediately after pressing a cold page must still scroll, and
  // must cancel the queued selection. No full-page input-blocking hydration overlay.
  await page.evaluate(() => { deselectAll(); goToPage(5); });
  await page.waitForSelector('.paper[data-page-idx="4"] .page-preview-img');
  await page.waitForFunction(() => Math.abs(document.getElementById("editorBody").scrollTop - 4 * (paperSize().h + PAGE_GAP) * pageScale) < 2 && !_isScrolling());
  const r = await page.locator('.paper[data-page-idx="4"]').boundingBox();
  await page.mouse.move(r.x + r.width * .2, Math.max(110, r.y + 50));
  const scrollBefore = await page.locator('#editorBody').evaluate(el => el.scrollTop);
  await page.mouse.down(); await page.mouse.wheel(0, 300); await page.mouse.up();
  await page.waitForFunction(top => document.getElementById('editorBody').scrollTop > top + 50, scrollBefore);
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.paper[data-page-idx="4"] .tb.sel,.paper[data-page-idx="4"] .tb.edit').count(), 0);
  // Real mobile touch, not MouseEvents carrying a made-up pointerType.
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', e => errors.push(e.stack || e.message));
  await mobile.route('**/*', route => route.request().url().startsWith(fixture.base) ? route.continue() : route.abort());
  await mobile.goto(fixture.base + '/?sandbox=1&turbo=1');
  await mobile.evaluate(openActivationNote);
  await mobile.waitForSelector('.page-preview-img');
  await mobile.waitForFunction(() => !_isScrolling());
  const touchCDP = await mobileContext.newCDPSession(mobile);
  const mr = await mobile.locator('.paper[data-page-idx="0"]').boundingBox();
  const tx = mr.x + mr.width * .4, ty = Math.min(700, mr.y + mr.height * .6);
  const touch = (type, y) => touchCDP.send('Input.dispatchTouchEvent', { type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: tx, y }] });
  await touch('touchStart', ty);
  await touch('touchMove', ty - 35); await touch('touchMove', ty - 120);
  // Release after briefly holding still, rather than creating an unbounded
  // high-velocity fling from two synthetic samples just milliseconds apart.
  await mobile.waitForTimeout(180); await touch('touchMove', ty - 120); await touch('touchEnd');
  await mobile.waitForFunction(() => document.getElementById('editorBody').scrollTop > 20);
  assert.equal(await mobile.locator('#pagesStage .tb').count(), 0, 'native touch pan must not activate the page');
  // Wait for the pan and then the actual smooth-scroll destination. curPageIdx
  // changes immediately, BEFORE the viewport arrives, so it is not a readiness test.
  await mobile.waitForFunction(() => !_isScrolling());
  await mobile.evaluate(() => goToPage(1));
  await mobile.waitForFunction(() => document.getElementById("editorBody").scrollTop < 1 && !_isScrolling());
  const tapRect = await mobile.locator('.paper[data-page-idx="0"]').boundingBox();
  const tapX = tapRect.x + 60 / 800 * tapRect.width, tapY = tapRect.y + 48 / 1100 * tapRect.height;
  await mobile.touchscreen.tap(tapX, tapY);
  await mobile.waitForFunction(() => !!document.querySelector('.paper[data-page-idx="0"] .tb.sel'));
  assert.equal(await mobile.locator('.tb.sel').getAttribute('data-id'), 't0_0');
  const selectedRect = await mobile.locator('.tb.sel .tb-content').boundingBox();
  await mobile.touchscreen.tap(selectedRect.x + selectedRect.width / 2, selectedRect.y + selectedRect.height / 2);
  await mobile.waitForFunction(() => !!document.querySelector('.paper[data-page-idx="0"] .tb.edit'));
  assert.deepEqual(errors, []);
  console.log('Chromium activation / native input / undo / wheel / mobile touch: PASS');
} finally {
  if (browser) await browser.close();
  await fixture.close();
}
