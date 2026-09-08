// Imported PDF words are positioned separately; their copy/search spaces have
// zero width. Exercise the real formatting and highlight pipeline with explicit
// geometry (jsdom has no layout). Real Chromium coverage: bench:hlband.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source = name => fs.readFileSync(new URL('../src/app/' + name, import.meta.url), 'utf8');
const style = source('11a-text-style.js');
const highlight = source('07b-hl-band.js');
const dom = new JSDOM('<div class="tb tight pdf-text edit" data-page-idx="0" data-id="t1"><div class="tb-content"></div></div>',
  { runScripts: 'outside-only' });
const { window } = dom, { document } = window;
const box = document.querySelector('.tb'), content = box.firstElementChild;
let zoom = 1, pass = 0;
const yellow = '#ffff00', blue = '#00aaff';
const check = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
const word = (text, x, y = 0, w = text.length * 10, space = true) =>
  `<span data-word="1" data-fs="20" data-pdf-w="${w}" data-pdf-base="${y + 16}" style="position:absolute;left:${x}px;top:${y}px;font-size:20px;line-height:20px;white-space:nowrap">${text}${space ? '<i class="zsp"> </i>' : ''}</span>`;
const original = word('English', 0) + word('paper', 86) + word('text', 155);

try {
  // Only application services outside this rendering/formatting test are stubbed.
  window._classicPaletteColor = (_kind, color) => color;
  window.pageScreenScale = () => ({ x: zoom, y: zoom });
  window.findEl = () => ({ html: content.innerHTML });
  window.eval(style.slice(style.indexOf('    const FMT_PROPS=')) + '\n'
    + source('11b-inline-fmt.js') + '\n'
    + highlight.slice(0, highlight.indexOf('    function buildTextEl(')));

  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this === box || this === content) return rect(100, 40, 400 * zoom, 100 * zoom);
    if (!this.matches('span[data-word]')) return rect(0, 0, 0, 0);
    return rect(100 + parseFloat(this.style.left) * zoom, 40 + parseFloat(this.style.top) * zoom,
      parseFloat(this.dataset.pdfW) * zoom, 20 * zoom);
  };
  window.Range.prototype.getClientRects = function () {
    const node = this.startContainer;
    if (node.nodeType !== 3 || node !== this.endContainer) return [];
    const owner = node.parentElement.closest('span[data-word]');
    if (!owner) return [];
    let before = '';
    const walker = document.createTreeWalker(owner, window.NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()) && n !== node;) before += n.data;
    // Like .zsp, or trailing collapsed whitespace after inline normalization,
    // spaces carry text offsets but no glyph advance.
    const visible = s => s.replace(/\s/g, '').length;
    const bounds = owner.getBoundingClientRect();
    const advance = bounds.width / visible(owner.textContent);
    const start = visible(before + node.data.slice(0, this.startOffset));
    const end = visible(before + node.data.slice(0, this.endOffset));
    return [rect(bounds.left + start * advance, bounds.top, (end - start) * advance, bounds.height)];
  };

  const reset = (html = original) => { content.innerHTML = html; };
  const format = (start, end, color = yellow) => {
    assert.equal(window._fmtRunRange(content, start, end,
      color ? { type: 'set', prop: 'backgroundColor', value: color }
        : { type: 'remove', prop: 'backgroundColor', value: '' }), true);
  };
  const all = () => format(0, content.textContent.length);
  const paint = () => {
    const saved = content.innerHTML;
    window._hlPaint(content, box);
    assert.equal(content.innerHTML, saved, 'display geometry must not alter saved markup');
    assert.equal(content.querySelector('.sdy-hl-layer'), null, 'SVG is outside the saved content');
    return [...box.querySelectorAll(':scope > .sdy-hl-layer rect')].map(r => ({
      x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'),
      h: +r.getAttribute('height'), color: r.getAttribute('fill'),
    }));
  };
  const band = (x, w, color = yellow, y = 0) => ({ x, y, w, h: 20, color });

  check('English sentence includes both positioned inter-word spaces', () => {
    reset(); all();
    assert.equal(content.textContent, 'English paper text ');
    assert.deepEqual(paint(), [band(0, 195)]);
  });
  check('partial first/last words keep exact selection boundaries', () => {
    reset(); format(2, 16); // glish paper te
    assert.deepEqual(paint(), [band(20, 155)]);
  });
  check('a selected zero-width space is painted even without selected letters', () => {
    reset(); format(7, 8);
    assert.deepEqual(paint(), [band(70, 16)]);
  });
  check('unselected spaces stay clear, even when smaller than the merge tolerance', () => {
    reset(word('one', 0) + word('two', 31));
    format(0, 3); format(4, 7);
    assert.deepEqual(paint(), [band(0, 30), band(31, 30)]);
  });
  check('neighboring highlight colors are never swallowed by a merged band', () => {
    reset(word('one', 0) + word('two', 30));
    format(0, 4); format(4, 7, blue);
    assert.deepEqual(paint(), [band(0, 30), band(30, 30, blue)]);
  });
  check('a differently colored space retains its own color', () => {
    reset(word('one', 0) + word('two', 46)); all(); format(3, 4, blue);
    assert.deepEqual(paint(), [band(0, 30), band(30, 16, blue), band(46, 30)]);
  });
  check('clearing only the space does not remove neighboring highlights', () => {
    reset(word('one', 0) + word('two', 46)); all(); format(3, 4, null);
    assert.deepEqual(paint(), [band(0, 30), band(46, 30)]);
    format(3, 4, 'transparent');
    assert.deepEqual(paint(), [band(0, 30), band(46, 30)]);
  });
  check('touching line boxes stay separate; no bridge at a line ending', () => {
    reset(word('one', 0) + word('two', 90, 20)); all();
    assert.deepEqual(paint(), [band(0, 30), band(90, 30, yellow, 20)]);
    reset(word('one', 0) + word('two', 0, 19)); all();
    assert.deepEqual(paint(), [band(0, 30), band(0, 30, yellow, 19)]);
  });
  check('justified spaces are not limited to a fixed pixel gap', () => {
    reset(word('one', 0) + word('two', 110)); all();
    assert.deepEqual(paint(), [band(0, 140)]);
  });
  check('separate containers, line breaks and non-space layout gaps are not bridged', () => {
    for (const html of [
      '<div>' + word('one', 0) + '</div><div>' + word('two', 110) + '</div>',
      word('one', 0) + '<br>' + word('two', 110),
      word('one', 0, 0, 30, false) + word('two', 110),
    ]) {
      reset(html); all();
      assert.deepEqual(paint(), [band(0, 30), band(110, 30)]);
    }
  });
  check('nested formatting and pre-existing highlighted .zsp markers both work', () => {
    reset('<span style="background-color:' + yellow + '">' + original + '</span>');
    assert.equal(content.querySelectorAll('.zsp').length, 3);
    assert.deepEqual(paint(), [band(0, 195)]);
    reset();
    window._fmtRunRange(content, 2, 12, { type: 'set', prop: 'fontWeight', value: '700' });
    all();
    assert.ok(content.querySelector('[style*="font-weight: 700"]'));
    assert.deepEqual(paint(), [band(0, 195)]);
  });
  check('serialize/reopen reconstructs the same band without changing word positions', () => {
    reset(); all();
    const saved = content.innerHTML, expected = paint();
    reset(saved);
    assert.deepEqual(paint(), expected);
    assert.deepEqual([...content.querySelectorAll('span[data-word]')].map(s => s.style.left), ['0px', '86px', '155px']);
  });
  check('page zoom does not change which spaces are painted', () => {
    reset(); all();
    for (zoom of [.5, 1, 2]) assert.deepEqual(paint(), [band(0, 195)]);
    zoom = 1;
  });
  check('clearing all highlighting removes the display layer', () => {
    format(0, content.textContent.length, null);
    assert.deepEqual(paint(), []);
    assert.equal(box.classList.contains('sdy-hl-band-on'), false);
  });
  check('missing Range geometry keeps the original span-background fallback', () => {
    reset(); all();
    const measure = window.Range.prototype.getClientRects;
    try {
      delete window.Range.prototype.getClientRects;
      assert.deepEqual(paint(), []);
      assert.ok(content.querySelector('[style*="background-color"]'));
      assert.equal(box.classList.contains('sdy-hl-band-on'), false);
    } finally { window.Range.prototype.getClientRects = measure; }
  });
  console.log(`\nImported highlight spaces: PASS ${pass}`);
} finally {
  window.close();
}
