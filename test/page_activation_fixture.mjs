// Reproducible imported-document fixture. No user database, network fonts or AI service.
// Shared by the deterministic DOM regression and the real Chromium performance check.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const REPO = path.resolve(new URL('..', import.meta.url).pathname);
export const BOXES = 36, SPANS = 60, PAGES = 24;
export function makePage(i) {
  const els = [{ type: 'image', id: `bg${i}`, x: 0, y: 0, w: 800, h: 1100,
    isBg: 1, locked: true, url: '/fixture-background.svg' }];
  for (let k = 0; k < BOXES; k++) {
    let html = '';
    for (let s = 0; s < SPANS; s++) {
      html += `<span data-fs="10" style="position:absolute;left:${s % 12 * 27}px;top:${Math.floor(s / 12) * 10}px;line-height:10px;font-size:10px;white-space:nowrap">word${s}<i class="zsp"> </i></span>`;
    }
    els.push({ type: 'text', id: `t${i}_${k}`, x: 40 + k % 2 * 380, y: 40 + Math.floor(k / 2) * 56,
      w: 350, h: 52, html, fontSize: 10, font: 'times', tight: 1 });
  }
  return { id: `p${i}`, els, tables: [] };
}
export function makeDoc() {
  return { version: 3, __ref: 'activation-test', paper: 'blank', sizePreset: 'a4_portrait',
    glossary: {}, pages: Array.from({ length: PAGES }, (_, i) => makePage(i)) };
}
export async function activationFixture() {
  const doc = makeDoc();
  const requests = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://fixture');
    requests.push(u.pathname + u.search);
    const json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    if (u.pathname.startsWith('/api/import/page/') || u.pathname === '/fixture-background.svg') {
      const width = +u.searchParams.get('w') || 800;
      // The browser really decodes an image at the requested resolution; never a broken URL.
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width * 1100 / 800}" viewBox="0 0 800 1100"><rect width="800" height="1100" fill="white"/>${u.pathname.startsWith('/api/') ? '<text x="40" y="50">Imported page preview</text>' : ''}</svg>`);
      return;
    }
    if (u.pathname.startsWith('/api/import/docfile/')) {
      if (u.searchParams.get('meta') === '1') return json({ ok: true, total: PAGES, version: 0 });
      const from = +u.searchParams.get('from') || 0, to = +u.searchParams.get('to') || 8;
      return json({ ok: true, total: PAGES, pages: doc.pages.slice(from, to) });
    }
    if (req.headers.accept?.includes('text/event-stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': fixture\n\n'); return;
    }
    if (u.pathname.startsWith('/api/')) return json({ ok: true, data: [], ops: [], peers: [], version: 0, enabled: false });
    const name = u.pathname === '/' ? 'sdynotes.html' : u.pathname.slice(1);
    if (!['sdynotes.html', 'sdynotes.js', 'sdynotes.css'].includes(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(path.join(REPO, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { doc, requests, base: `http://127.0.0.1:${server.address().port}`,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

// The real openNB/loadDocAsync path, including slices, sync initialization and render restoration.
// Runs in either a jsdom window or page.evaluate; it must be self-contained.
export async function openActivationNote() {
  document.getElementById('splash')?.remove();
  const nb = { id: 'local_activation_test', title: '읽기 → 편집 전환 회귀 문서' };
  setCfg(nb.id, { serverDoc: 'activation-test', sizePreset: 'a4_portrait', paper: 'blank' });
  await openNB(nb);
}
