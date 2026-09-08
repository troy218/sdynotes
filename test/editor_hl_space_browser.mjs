// Actual Chromium selection -> toolbar -> saved spans -> painted gap pixels.
// Synthetic markup matches worker/pdf_layout.py; no user document or live DB.
// Run: npx playwright install chromium && npm run bench:hlband
// Or: SDY_CHROMIUM_PATH=/path/to/chromium npm run bench:hlband
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { activationFixture, openActivationNote, REPO } from './page_activation_fixture.mjs';

const word = (text, x, y, width) =>
  `<span data-fs="20" data-pdf-w="${width}" data-pdf-base="${y + 16}" style="position:absolute;left:${x}px;top:${y}px;font-size:20px;line-height:20px;white-space:nowrap;font-family:'SDY Tinos',serif">${text}<i class="zsp"> </i></span>`;
const html = [0, 28].map(y => word('English', 0, y, 64) + word('paper', 84, y, 48) + word('text', 153, y, 32)).join('');
const fixture = await activationFixture();
for (const p of fixture.doc.pages) { p.els = []; p.tables = []; }
fixture.doc.pages[0].els = [
  { type: 'text', id: 'hl-import', x: 40, y: 80, w: 280, h: 64, fontSize: 20, font: 'times', tight: 1, pdfText: 1, html },
  { type: 'text', id: 'hl-normal', x: 40, y: 210, w: 400, h: 60, fontSize: 20, html: 'An ordinary English sentence.' },
];
let browser;
try {
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.SDY_CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== fixture.base) return route.abort();
    // The shared activation fixture serves the main bundle. Load its extracted
    // modules/fonts too, so this is the complete editor, not mocked formatting.
    let file;
    if (/^\/src\/[a-z0-9-]+\.js$/.test(url.pathname)) file = path.join(REPO, url.pathname.slice(1));
    if (/^\/assets\/fonts\/[a-z0-9.-]+\.woff2$/.test(url.pathname)) file = path.join(REPO, 'server', url.pathname.slice(1));
    if (file && fs.existsSync(file)) return route.fulfill({ path: file,
      contentType: file.endsWith('.js') ? 'text/javascript' : 'font/woff2' });
    return route.continue();
  });
  await page.goto(fixture.base + '/?sandbox=1&turbo=1');
  await page.evaluate(openActivationNote);
  const selector = '.tb[data-id="hl-import"]';
  await page.waitForSelector(selector + ' .tb-content');
  await page.waitForFunction(() => !_tightQueue.size && document.fonts.status === 'loaded');

  const select = (start, end, id = 'hl-import') => page.evaluate(({ start, end, id }) => {
    const w = document.querySelector('.tb[data-id="' + id + '"]');
    if (!w.classList.contains('edit')) enterEdit(w, true);
    const c = w.querySelector('.tb-content');
    _fmtRestoreSelection(c, start, end == null ? c.textContent.length : end);
    saveSel();
  }, { start, end, id });
  const inspect = () => page.evaluate(() => {
    const w = document.querySelector('.tb[data-id="hl-import"]'), c = w.querySelector('.tb-content');
    // Dismiss native selection paint so the screenshot measures our highlighter.
    getSelection().removeAllRanges(); savedRange = null; savedHost = null; savedCaret = null;
    const markup = c.innerHTML;
    _hlPaint(c, w);
    const words = [...c.querySelectorAll(':scope > span[data-pdf-w]')];
    const rects = [...w.querySelectorAll(':scope > .sdy-hl-layer rect')].map(r => {
      const b = r.getBoundingClientRect();
      return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, color: r.getAttribute('fill') };
    });
    const gaps = [];
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i].dataset.pdfBase !== words[i + 1].dataset.pdfBase) continue;
      const a = words[i].getBoundingClientRect(), b = words[i + 1].getBoundingClientRect();
      const x = (a.right + b.left) / 2, y = (a.top + a.bottom) / 2;
      gaps.push({ x, y, width: b.left - a.right,
        covered: rects.some(r => r.x <= x && x <= r.right && r.y <= y && y <= r.bottom) });
    }
    return { rects, gaps, text: c.textContent, saved: findEl(0, 'hl-import').html,
      untouched: markup === c.innerHTML, layerInContent: !!c.querySelector('.sdy-hl-layer') };
  });
  const continuous = async () => {
    const view = await inspect();
    assert.equal(view.rects.length, 2, JSON.stringify(view.rects));
    assert.equal(view.gaps.length, 4);
    assert.ok(view.gaps.every(g => g.width > 2.5 && g.covered), JSON.stringify(view.gaps));
    assert.equal(view.untouched, true);
    assert.equal(view.layerInContent, false);
    assert.equal(view.text, 'English paper text English paper text ');
    return view;
  };

  await select(0, null);
  await page.locator('#hlWrap > .main').click(); // real toolbar focus/selection path
  await page.waitForSelector(selector + ' .sdy-hl-layer rect');
  const view = await continuous();
  assert.match(view.saved, /background-color/);
  assert.doesNotMatch(view.saved, /sdy-hl-layer/);
  const pixels = await sharp(await page.screenshot({ animations: 'disabled' })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const gap of view.gaps) {
    const offset = (Math.floor(gap.y) * pixels.info.width + Math.floor(gap.x)) * pixels.info.channels;
    const [r, g, b] = pixels.data.subarray(offset, offset + 3);
    assert.ok(r > 200 && g > 200 && b < 100, 'space must actually be yellow, not just have a rect: ' + [r, g, b]);
  }
  console.log('  ✓ actual toolbar paints every imported space (including screenshot pixels)');

  await page.evaluate(() => undo());
  await page.waitForFunction(() => !findEl(0, 'hl-import').html.includes('background-color'));
  assert.equal((await inspect()).rects.length, 0);
  await page.evaluate(() => redo());
  await page.waitForFunction(() => findEl(0, 'hl-import').html.includes('background-color') && !_tightQueue.size);
  await continuous();
  console.log('  ✓ undo/redo restores the same continuous highlights');

  // Persist the application's serialized page in the mock server, then really
  // leave and reopen the notebook. No display-layer geometry is serialized.
  fixture.doc.pages[0] = await page.evaluate(() => JSON.parse(JSON.stringify(doc.pages[0])));
  await page.evaluate(() => closeEditor());
  await page.evaluate(openActivationNote);
  await page.waitForSelector(selector + ' .tb-content');
  await page.waitForFunction(() => !_tightQueue.size);
  await continuous();
  console.log('  ✓ saved markup rebuilds continuous bands after closing/reopening');

  for (const percent of [60, 150]) {
    await page.evaluate(percent => { zoomPct = percent; layoutPages(); }, percent);
    await continuous();
  }
  await page.evaluate(() => resetZoom());
  console.log('  ✓ continuity is preserved at 60% and 150% zoom');

  await select(0, null);
  await page.evaluate(() => applyHighlight(null));
  assert.equal((await inspect()).rects.length, 0);
  await select(7, 8); // only the .zsp after English
  await page.locator('#hlWrap > .main').click();
  const space = await inspect();
  assert.equal(space.rects.length, 1);
  assert.deepEqual(space.gaps.map(g => g.covered), [true, false, false, false]);
  console.log('  ✓ clearing works; selecting only a space paints only that gap');

  await select(0, null, 'hl-normal');
  await page.locator('#hlWrap > .main').click();
  const normalBands = await page.evaluate(() => {
    const w = document.querySelector('.tb[data-id="hl-normal"]');
    _hlPaint(w.querySelector('.tb-content'), w);
    return w.querySelectorAll(':scope > .sdy-hl-layer rect').length;
  });
  assert.equal(normalBands, 1, 'ordinary English whitespace remains one continuous band');
  assert.deepEqual(errors, []);
  console.log('  ✓ ordinary text is unchanged; browser page errors: 0');
  console.log('Chromium imported highlight spaces: PASS');
} finally {
  if (browser) await browser.close();
  await fixture.close();
}
