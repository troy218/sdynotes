#!/usr/bin/env node
// Screenshot the REAL editor, not its source-PDF preview. No production database.
// node scripts/import-visual-review.mjs import_uploads/review/manifest.json
// Optional: SDY_CHROMIUM_PATH=/path/to/chromium, SDY_REVIEW_KATEX=/path/to/katex/dist
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.resolve(process.argv[2] || 'import_uploads/review/manifest.json');
const dir = path.dirname(manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://fixture');
  const json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  let file;
  if (u.pathname.startsWith('/api/import/img/')) file = path.join(root, 'imported', path.basename(u.pathname));
  else if (u.pathname.startsWith('/assets/fonts/')) file = path.join(root, 'server/assets/fonts', path.basename(u.pathname));
  else if (u.pathname.startsWith('/katex/')) {
    const base = process.env.SDY_REVIEW_KATEX;
    if (base) file = path.join(base, u.pathname.slice('/katex/'.length));
  } else if (req.headers.accept?.includes('text/event-stream')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': fixture\n\n'); return;
  } else if (u.pathname.startsWith('/api/')) return json({ ok: true, data: [], ops: [], peers: [], version: 0, enabled: false });
  else if (u.pathname === '/') file = path.join(root, 'sdynotes.html');
  else if (['/sdynotes.js', '/sdynotes.css'].includes(u.pathname)) file = path.join(root, u.pathname.slice(1));
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  let data = fs.readFileSync(file);
  if (file.endsWith('sdynotes.html') && process.env.SDY_REVIEW_KATEX) {
    data = data.toString().replaceAll('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/', '/katex/');
  }
  res.end(data);
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.SDY_CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  manifest.browserVersion=browser.version();
  manifest.appVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  for (const c of manifest.cases) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1300 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const url=route.request().url();
      if(!url.startsWith(base)) return route.abort();
      if(url.includes('/assets/fonts/')){
        if(process.env.SDY_REVIEW_NO_FONTS) return route.abort();
        const delay=Number(process.env.SDY_REVIEW_FONT_DELAY||0);
        if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
      }
      return route.continue();
    });
    await page.goto(base + '/?sandbox=1&turbo=1');
    await page.evaluate(async c => {
      document.getElementById('splash')?.remove();
      const nb = { id: 'local_pdf_review', title: 'PDF visual review' };
      setCfg(nb.id, { version: 3, pages: [c.converted], paper: 'blank',
        sizePreset: c.width > c.height ? 'a4_landscape' : 'a4_portrait' });
      await openNB(nb);
    }, c);
    await page.addStyleTag({ content: 'html{zoom:1!important}.paper{background:white!important;border-radius:0!important;box-shadow:none!important;border:0!important}*{caret-color:transparent!important}' });
    await page.waitForSelector('.paper .tb,.paper .paper-img');
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.waitForFunction(() => _tightQueue.size === 0 && _pageRenderJobs.size === 0);
    await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.paper img')].map(i => i.decode().catch(() => {}))); });
    const paper = page.locator('.paper[data-page-idx="0"]');
    // Capture at 1 CSS px per paper coordinate, independently of editor auto-fit.
    await page.evaluate(() => { zoomPct=100; layoutPages(); });
    await paper.screenshot({ path: path.join(dir, `${c.id}-editor.png`), animations: 'disabled' });
    c.browserErrors = errors;
    c.metrics = await page.evaluate(() => {
      const paper=document.querySelector('.paper'), ps=paper.getBoundingClientRect();
      const scale=ps.width/paper.offsetWidth;
      const runs=[...paper.querySelectorAll('.tb.pdf-text .tb-content > span[data-pdf-w]')];
      const widthErrors=runs.map(s=>Math.abs(s.getBoundingClientRect().width/scale-Number(s.dataset.pdfW)));
      const rows=new Map();
      for(const s of runs){
        const box=s.closest('.tb'), rect=s.getBoundingClientRect();
        const baseline=(parseFloat(box.style.top)||0)+Number(s.dataset.pdfBase);
        const key=Math.round(baseline*4), sourceX=(parseFloat(box.style.left)||0)+(parseFloat(s.style.left)||0);
        if(!rows.has(key)) rows.set(key,[]);
        rows.get(key).push({x:rect.x/scale,right:rect.right/scale,sourceX,sourceRight:sourceX+Number(s.dataset.pdfW)});
      }
      let overlaps=0;
      for(const row of rows.values()){
        row.sort((a,b)=>a.x-b.x);
        row.forEach((r,i)=>{
          const n=row[i+1];
          if(n&&r.right>n.x+.3&&r.sourceRight<=n.sourceX+.05) overlaps++;
        });
      }
      return {boxes:paper.querySelectorAll('.tb').length,words:runs.length,
        previewImages:paper.querySelectorAll('.page-preview-img').length,
        maxWidthError:Math.max(0,...widthErrors),unexpectedWordOverlaps:overlaps,
        fonts:[...document.fonts].filter(f=>f.family.startsWith('SDY ')).map(f=>({family:f.family,weight:f.weight,style:f.style,status:f.status}))};
    });
    assert.equal(c.metrics.previewImages, 0, 'must review editable DOM, never the PDF preview');
    assert.equal(c.metrics.boxes, c.converted.els.filter(e => e.type === 'text' || e.type === 'latex').length,
      `${c.id}: live text/math was lost during page rendering`);
    assert.deepEqual(errors, [], `${c.id}: browser errors`);
    assert.ok(c.metrics.maxWidthError<.3, `${c.id}: a word exceeds its PDF advance (${c.metrics.maxWidthError})`);
    assert.equal(c.metrics.unexpectedWordOverlaps, 0, `${c.id}: introduced word overlap`);
    if(process.env.SDY_REVIEW_NO_FONTS) assert.ok(!c.metrics.fonts.some(f=>f.status==='loaded'), 'font-failure fixture really blocked fonts');
    else assert.ok(!c.metrics.fonts.some(f=>f.status==='error'), `${c.id}: a bundled font failed to load`);
    if(process.env.SDY_REVIEW_EXPORT){
      const exported=await page.evaluate(async()=> (await renderPageCanvas(0)).toDataURL('image/png'));
      fs.writeFileSync(path.join(dir, `${c.id}-export.png`), Buffer.from(exported.split(',')[1], 'base64'));
    }
    if (c.hiBg) {
      await page.evaluate(url => { const img = document.querySelector('.paper .pdf-bg img'); if (img) img.src = url; }, c.hiBg);
      await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.paper img')].map(i => i.decode().catch(() => {}))); });
      await paper.screenshot({ path: path.join(dir, `${c.id}-hi-editor.png`), animations: 'disabled' });
    }
    if(process.env.SDY_REVIEW_EDIT_CHECK){
      await page.evaluate(()=>{
        const s=[...document.querySelectorAll('.paper .pdf-text span[data-pdf-w]')]
          .find(s=>s.style.fontWeight==='400'&&s.textContent.trim().length>=8);
        if(!s) throw new Error('missing editable PDF run');
        s.id='pdf-edit-probe';
        const b=document.createElement('b'); b.textContent=s.textContent.trimEnd();
        const z=document.createElement('i'); z.className='zsp'; z.textContent=' ';
        s.replaceChildren(b,z);
        const c=s.closest('.tb-content'),w=c.parentElement,el=findEl(+w.dataset.pageIdx,w.dataset.id);
        el.html=c.innerHTML;
        _queueTightFit(c,el);
      });
      await page.evaluate(async()=>{ await document.fonts.ready; });
      await page.waitForFunction(()=>_tightQueue.size===0);
      const widthError=()=>page.evaluate(()=>{
        const s=document.getElementById('pdf-edit-probe'),p=s.closest('.paper');
        const scale=p.getBoundingClientRect().width/p.offsetWidth;
        return Math.abs(s.getBoundingClientRect().width/scale-Number(s.dataset.pdfW));
      });
      const nestedWidthError=await widthError();
      assert.ok(nestedWidthError<.3,`${c.id}: nested bold text overlaps its source width`);
      await page.evaluate(()=>{
        const s=document.getElementById('pdf-edit-probe'),c=s.closest('.tb-content'),w=c.parentElement;
        const el=findEl(+w.dataset.pageIdx,w.dataset.id),oldWidth=Number(s.dataset.pdfW);
        scaleInlineFS(c,1.25);
        if(Math.abs(Number(s.dataset.pdfW)-oldWidth*1.25)>.001) throw new Error('PDF width did not scale');
        el.w*=1.25;el.h*=1.25;el.fontSize*=1.25;el.html=c.innerHTML;
        w.style.width=el.w+'px';w.style.height=el.h+'px';c.style.fontSize=el.fontSize+'px';
        _queueTightFit(c,el);
      });
      await page.waitForFunction(()=>_tightQueue.size===0);
      const resizedWidthError=await widthError();
      assert.ok(resizedWidthError<.3,`${c.id}: resized PDF text loses its geometry`);
      c.editChecks={nestedWidthError,resizedWidthError};
    }
    console.log(c.id, {boxes:c.metrics.boxes, words:c.metrics.words, maxWidthError:+c.metrics.maxWidthError.toFixed(4), unexpectedWordOverlaps:c.metrics.unexpectedWordOverlaps}, errors);
    assert.deepEqual(errors, [], `${c.id}: post-render browser errors`);
    await page.close();
  }
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(manifest, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
