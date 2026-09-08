// Fitting and persistence contracts for PDF geometry. Chromium visual checks:
// npm run bench:import (requires a browser, see docs/pdf_import_quality.md).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import Fastify from 'fastify';
import { registerPages } from '../server/src/routes/pages.js';

const source = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`^    (?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n    }', start);
  return source.slice(start, end + 6);
}
const fitCache = new WeakMap();
const context = vm.createContext({ console, performance, _tightFontEpoch: 0,
  _fontState: () => 'L', _tightFitHit: () => null, _tightFitLive: () => true,
  _tightFitCache: fitCache, _pdfSpanMetrics: (_s, _c, fs) => ({ w: 100, baseline: fs * .8 }) });
vm.runInContext(fn('_measureTightSpans') + '\n' + fn('_applyTightFit'), context);
const span = (data, x = 0) => ({ tagName: 'SPAN', dataset: { fs: '10', ...data },
  style: { left: x+'px', top: '4px' }, scrollWidth: 100, offsetHeight: 10 });
const a = span({ pdfW: '25.25', pdfBase: '12.125' });
const b = span({ pdfW: '10.75', pdfBase: '12.125' }, 32.5);
const sub = span({ pdfW: '5.5', pdfBase: '17.75' }, 23.75);
const el = { html: 'original', w: 200, h: 30, font: 'times', fontSize: 10, pdfText: 1 };
const before = JSON.stringify(el);
const c = { children: [a, b, sub], clientWidth: 200, clientHeight: 30,
  style: {}, parentElement: { style: {} }, innerHTML: 'display only' };
const fit = context._measureTightSpans(c, el);
assert.equal(fit.rec.transforms[0], 'scaleX(0.25250)', 'no 84% floor');
assert.equal(fit.rec.transforms[1], 'scaleX(0.10750)', 'last word fits its PDF width, not the paragraph edge');
assert.equal(fit.rec.tops[0], 4.125, 'fractional baseline');
assert.equal(fit.rec.tops[2], 9.75, 'subscript uses actual baseline, not HTML sub offset');
assert.equal(fit.rec.growR, 0, 'PDF box must not grow into the adjacent column');
context._applyTightFit(fit);
assert.equal(a.style.transform, 'scaleX(0.25250)');
assert.equal(a.style.top, '4.125px');
assert.equal(JSON.stringify(el), before, 'fitting is view-only, not an edit/sync write');
assert.equal(fitCache.get(el), fit.rec);
assert.equal(fit.rec.zspSx[0], null, 'missing .zsp is a no-op');
assert.equal(fit.rec.zspSx[1], null);

const zspA={className:'zsp',style:{},scrollWidth:3,offsetWidth:3};
const za=span({pdfW:'25.25',pdfBase:'12.125'});
za.querySelector=sel=>sel==='.zsp'?zspA:null;
const zb=span({pdfW:'10.75',pdfBase:'12.125'},32.5);
zb.querySelector=()=>null;
const zfit=context._measureTightSpans({...c,children:[za,zb]},el);
const expectZsx=7.25/(0.2525*3);
assert.equal(+zfit.rec.zspSx[0].toFixed(4), +expectZsx.toFixed(4),
  'spacer scaleX fills the PDF gap after parent scaleX');
assert.equal(zfit.rec.zspSx[1], null, 'last-on-line spacer is not stretched into the margin');
context._applyTightFit(zfit);
assert.equal(zspA.style.transform, 'scaleX('+expectZsx.toFixed(4)+')');
assert.equal(zspA.style.transformOrigin, 'left center');
assert.equal(za.style.transform, 'scaleX(0.25250)', 'word scaleX is unchanged');
const justified = span({ j: '1' });
const legacy = context._measureTightSpans({ ...c, children: [justified], clientWidth: 40 }, { ...el, pdfText: 0 });
assert.ok(parseFloat(legacy.rec.transforms[0].slice(7)) < .4, 'legacy justified words cannot bypass overlap fitting');

// Mixed inline edits must be measured from their actual styled DOM, not one
// canvas font. Account for the old run transform AND page/UI scale.
context._pdfSpanMetrics=()=>null;
context.getComputedStyle=()=>({width:'200px'});
const mixed=span({pdfW:'25.25',pdfBase:'12.125'});
mixed.style.transform='scaleX(0.8)';
mixed.getBoundingClientRect=()=>({width:20});
const mixedFit=context._measureTightSpans({...c,children:[mixed],getBoundingClientRect:()=>({width:100})},el);
assert.equal(mixedFit.rec.transforms[0],'scaleX(0.50500)');
assert.equal(mixedFit.rec.tops[0],null,'do not overwrite the baseline of newly nested formatting');

vm.runInContext(fn('_scalePdfSpan')+'\n'+fn('scaleInlineFS'),context);
const scaled={style:{fontSize:'10.125px',lineHeight:'10.125px',left:'10.3px',top:'2.4px'},
  dataset:{fs:'10.125',pdfW:'24.375',pdfBase:'8.1'}};
assert.ok(context.scaleInlineFS({querySelectorAll:()=>[scaled]},1.5));
assert.equal(scaled.style.fontSize,'15.188px');
assert.equal(scaled.dataset.fs,'15.188');
assert.equal(scaled.dataset.pdfW,'36.563');
assert.equal(scaled.dataset.pdfBase,'12.15');
assert.equal(parseFloat(scaled.style.left),15.45);
assert.equal(parseFloat(scaled.style.top),3.6);
const normal={style:{fontSize:'10.125px'}};
context.scaleInlineFS({querySelectorAll:()=>[normal]},1.5);
assert.equal(normal.style.fontSize,'15px','legacy resizing is unchanged');

// Already-imported notes still hold LaTeX produced before the worker fix, so
// the renderer must repair a dangling command instead of handing KaTeX a
// string it rejects (which paints a red error where the equation should be).
vm.runInContext(fn('tidyLatex'), context);
const tidy = context.tidyLatex;
assert.equal(tidy(String.raw`v \hat _{i}`), String.raw`\hat{v} _{i}`);
assert.equal(tidy(String.raw`\mathcal{N} \widetilde`), String.raw`\widetilde{\mathcal{N}}`);
assert.equal(tidy(String.raw`\bar{g}_{\mu\nu}`), String.raw`\bar{g}_{\mu\nu}`,
  'a subscript that already has a base is not stolen by an accent');
assert.equal(tidy(String.raw`\frac{1}{2}`), String.raw`\frac{1}{2}`, 'valid math is untouched');
// Export must bake the same repaired string the screen shows, otherwise a
// broken formula renders fine in the editor but as a red error in the PDF/JPG.
assert.equal(source.match(/katex\.renderToString\(el\.latex/g), null,
  'export paths must pass el.latex through tidyLatex');
assert.ok(source.match(/katex\.renderToString\(tidyLatex\(el\.latex/g).length >= 2);

const DANGLING = /\\(?:hat|widetilde|bar|mathcal|frac|sqrt)(?![A-Za-z{])/;
for (const src of [String.raw`\mathcal{C} _{\Delta} ( u _{i} , v \hat _{i} ) = \mathcal{N}`,
                   String.raw`\widetilde ^{\alpha}`, String.raw`\mathcal _{x}`, String.raw`\hat`]) {
  assert.doesNotMatch(tidy(src), DANGLING, `dangling command survived: ${src}`);
}

vm.runInContext(fn('sanitizePageEls'), context);
const pdfParts = [
  { type: 'text', id: 'body', x: 10, y: 10, w: 200, h: 80, pdfText: 1, html: 'a paragraph' },
  { type: 'text', id: 'fragment', x: 10, y: 10, w: 100, h: 15, pdfText: 1, html: 'different words, same bbox' },
  { type: 'latex', id: 'math', x: 10, y: 10, w: 100, h: 20, latex: 'x^2' },
];
assert.equal(context.sanitizePageEls(pdfParts).length, 3, 'bbox containment cannot delete distinct imported text');
assert.ok(css.includes('.tb.tight .tb-content :where(span,b,i,sup,sub){font-family:inherit;}'),
  'UI universal font must not override imported words');
assert.ok(css.includes('.tb.pdf-text .tb-content{border-width:0;'), 'selection border cannot offset source coordinates');
const zspRule=(css.match(/\.tb\.tight \.zsp\{[^}]+\}/)||[])[0]||'';
assert.match(zspRule, /position:absolute/, 'zsp is out of flow so fitting width is unchanged');
assert.match(zspRule, /left:100%/);
assert.match(zspRule, /font-size:1em/);
assert.doesNotMatch(zspRule, /font-size:0/, 'font-size:0 hides ::selection in Chromium');
assert.match(source, /\.sdyx \.zsp\{[^}]*font-size:0/, 'export SVG has no editor CSS — hide zsp');
assert.ok(source.includes("n.style.fontSize='0px'"), 'page export bakes fontSize 0 on zsp');
assert.ok(source.includes("n.style.position='absolute'") && source.includes("n.style.left='100%'"),
  'page export bakes out-of-flow zsp');

const bg = { src: '/original.png', isConnected: true, getAttribute: () => '/original.png' };
const image = { type: 'image', isBg: 1, url: bg.src, pdfBg: 2, pdfPage: 7, pdfRef:'source-ref' };
const page = { els: [image] };
const calls = [];
Object.assign(context, { doc: { __ref: 'review-ref', pages: [page] }, window: { _renderVersion: 1 },
  _hiBgDone: new Set(), _hiBgBusy: new Set(), paperAt: () => ({ querySelector: () => bg }),
  fetch: async url => { calls.push(url); return { json: async () => ({ ok: true, url: '/upgraded.png' }) }; } });
vm.runInContext(fn('upgradeHiBg'), context);
await context.upgradeHiBg(0);
assert.deepEqual(calls, ['/api/import/bg/source-ref/7'], 'page reordering retains source page identity');
assert.equal(image.url, '/upgraded.png');
context._hiBgDone.clear(); image.pdfBg = undefined;
await context.upgradeHiBg(0);
assert.equal(calls.length, 1, 'legacy imports keep their existing segmentation/background');
context._hiBgDone.clear(); image.pdfBg = 2; bg.getAttribute = () => '/original.svg';
await context.upgradeHiBg(0);
assert.equal(calls.length, 1, 'vector backgrounds do not need a raster quality upgrade');

context._hiBgDone.clear(); bg.getAttribute=()=>'/original.png';
context.fetch=async()=>({status:404,json:async()=>({ok:false})});
await context.upgradeHiBg(0);
assert.ok(context._hiBgDone.has(0), 'a missing immutable plan cannot trigger repeated requests');

// Exercise the actual Fastify route, MIME type, ETag and strict path allowlist.
const app = Fastify();
registerPages(app);
try {
  const fontPaths = [...css.matchAll(/url\('([/]assets[/]fonts[/][^']+)'\)/g)].map(m => m[1]);
  assert.ok(fontPaths.length >= 12);
  for (const url of new Set(fontPaths)) {
    const res = await app.inject({ method: 'GET', url, headers: { host: '8799-review.e2b.app' } });
    assert.equal(res.statusCode, 200, url);
    assert.match(res.headers['content-type'], /^font\/woff2/);
    assert.equal(res.rawPayload.subarray(0, 4).toString(), 'wOF2');
    assert.match(res.headers['cache-control'], /immutable/);
    const cached = await app.inject({ method: 'GET', url, headers: { 'if-none-match': res.headers.etag } });
    assert.equal(cached.statusCode, 304);
  }
  for(const name of ['tinos','arimo','computer-modern']){
    const res=await app.inject({method:'GET',url:'/assets/fonts/'+name+'-LICENSE.txt'});
    assert.equal(res.statusCode,200);
    assert.match(res.headers['content-type'], /^text\/plain/);
    assert.match(res.payload, /SIL OPEN FONT LICENSE/);
  }
  for (const url of ['/assets/fonts/missing.woff2', '/assets/fonts/%2e%2e%2fsdynotes.js', '/assets/fonts/README.md']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404, url);
  }
} finally { await app.close(); }
console.log('PDF frontend: geometry, glyph ownership, fonts and background persistence PASS');
