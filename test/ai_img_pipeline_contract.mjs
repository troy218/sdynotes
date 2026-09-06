/* 14.31.0 · 사진 검색 파이프라인 계약 (네트워크 없음 — 가짜 소스로 검증)
 * ---------------------------------------------------------------------------
 * /api/ai/imgs · /api/ai/imgadd 가 실제로 어떻게 사진을 고르는지 본다.
 *   · 요청 문장 → AI(imgq) 로 영어 검색어 3단계 → 커먼즈+오픈버스 동시 검색
 *   · 관련도 순으로 다시 세우기(로고·지도 감점, 제목 일치 가점)
 *   · 기준을 못 넘으면 '아무 사진이나' 넣지 않고 못 찾았다고 말하기
 *
 *   바깥 네트워크는 쓰지 않는다 — globalThis.fetch 를 가짜로 바꿔 치우고
 *   (실제 .webp 저장까지 포함해) 파이프라인 전체를 그대로 돌린다. */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'sdy-ai-img-'));
process.env.SDY_BASE_DIR = TMP;
process.env.SDY_STORAGE = 'oracle';        // 클라우드 업로드 대신 로컬 저장소
process.env.AI_KEY = 'test-key';
process.env.AI_BASE_URL = 'https://ai.test/v1';
process.env.AI_MODEL = 'test-model';

const sharp = (await import('sharp')).default;
const PNG = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#ff8844' } }).png().toBuffer();
const bytes = () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength);

let pass = 0;
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` → ${extra}` : ''));
  pass++;
  console.log('  ✓ ' + name);
};

// ── 가짜 인터넷 ──────────────────────────────────────────────────────────────
const calls = [];
let imgqAnswer = 'sleeping ginger cat\ncat\nkitten';
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push(u);
  const json = obj => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => obj, text: async () => JSON.stringify(obj), arrayBuffer: async () => bytes(),
  });
  const binary = () => ({ ok: true, status: 200, headers: { get: () => String(PNG.length) },
    arrayBuffer: async () => bytes() });
  if (u.includes('ai.test/v1/chat/completions')) {
    const body = JSON.parse(String((init && init.body) || '{}'));
    const sys = String(((body.messages || [])[0] || {}).content || '');
    const content = /사진 검색어/.test(sys) ? imgqAnswer : '<svg viewBox="0 0 480 360"></svg>';
    return json({ choices: [{ finish_reason: 'stop', message: { content } }] });
  }
  if (u.includes('commons.wikimedia.org')) {
    return json({ query: { pages: {
      a: { title: 'File:Wikipedia logo.png', imageinfo: [{ url: 'https://up.test/logo.png', thumburl: 'https://up.test/logo_t.png',
        width: 1000, height: 1000, mime: 'image/png',
        extmetadata: { LicenseShortName: { value: 'CC' }, ImageDescription: { value: '' }, Categories: { value: 'Logos' } } }] },
      b: { title: 'File:Cat sleeping on a wooden table.jpg', imageinfo: [{ url: 'https://up.test/cat.jpg', thumburl: 'https://up.test/cat_t.jpg',
        width: 1600, height: 1200, mime: 'image/jpeg',
        extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, ImageDescription: { value: 'A ginger cat sleeping' },
          Categories: { value: 'Cats|Featured pictures' } } }] },
      c: { title: 'File:Tiny cat.jpg', imageinfo: [{ url: 'https://up.test/tiny.jpg', thumburl: 'https://up.test/tiny_t.jpg',
        width: 120, height: 90, mime: 'image/jpeg', extmetadata: {} }] },
    } } });
  }
  if (u.includes('api.openverse.org')) {
    return json({ result_count: 2, results: [
      { title: 'Map of Seoul 1900', url: 'https://ov.test/map.jpg', thumbnail: 'https://ov.test/map_t.jpg',
        width: 2000, height: 1500, license: 'cc0', license_version: '1.0', foreign_landing_url: 'https://ov.test/1', source: 'flickr' },
      { title: 'Cute orange kitten sleeping', url: 'https://ov.test/kitten.jpg', thumbnail: 'https://ov.test/kitten_t.jpg',
        width: 1400, height: 1050, license: 'by', license_version: '2.0', foreign_landing_url: 'https://ov.test/2', source: 'flickr' },
    ] });
  }
  if (/^https:\/\/(up|ov)\.test\//.test(u)) return binary();
  throw new Error('예상치 못한 외부 호출: ' + u);
};

const mod = await import('../server/src/routes/aiTools.js');
const routes = {};
mod.registerAiTools({
  get: (p, h) => { routes['GET ' + p] = h; },
  post: (p, h) => { routes['POST ' + p] = h; },
});
const call = async (method, route, req) => {
  let out = null;
  const reply = {
    status: 200,
    code(s) { this.status = s; return this; },
    send(b) { out = { status: this.status, body: b }; return out; },
  };
  await routes[method + ' ' + route](req, reply);
  return out;
};
const req = (body, query) => ({ body: body || {}, query: query || {}, ip: '127.0.0.1', headers: {} });

try {
  // ── ① 사진 후보 — 영어 검색어 + 두 소스 + 관련도 순 ───────────────────────
  let r = await call('GET', '/api/ai/imgs', req(null, { q: '고양이 사진 넣어 줘' }));
  check('사진 후보를 찾는다', r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 120));
  check('AI(imgq)로 영어 검색어를 먼저 만든다', r.body.how === 'ai'
    && Array.isArray(r.body.queries) && r.body.queries[0] === 'sleeping ginger cat',
    JSON.stringify(r.body.queries));
  check('두 소스(커먼즈·오픈버스)를 함께 찾는다',
    calls.some(u => u.includes('commons.wikimedia.org')) && calls.some(u => u.includes('api.openverse.org')));
  const titles = (r.body.results || []).map(x => x.title);
  check('관련도 1위가 진짜 고양이 사진이다', /^Cat sleeping on a wooden table/.test(titles[0] || ''), titles[0]);
  check('로고·지도는 뒤로 밀린다',
    (r.body.results || []).filter(x => /logo|Map of Seoul/i.test(x.title)).every(x => x.score < 0),
    JSON.stringify((r.body.results || []).map(x => x.score + ':' + x.title)));
  check('너무 작은 사진(120x90)은 후보에서 빠진다',
    (r.body.results || []).every(x => !/^Tiny cat/.test(x.title)), JSON.stringify(titles));

  // ── ② 사진 저장 — 1위를 내려받아 노트용 주소로 ───────────────────────────
  calls.length = 0;
  r = await call('POST', '/api/ai/imgadd', req({ q: '고양이 사진 넣어 줘' }));
  check('사진을 저장하고 노트용 주소(/api/img/…)를 돌려준다',
    r.status === 200 && r.body.ok === true && /^\/api\/img\/\S+\.webp$/.test(String(r.body.url || '')),
    JSON.stringify(r.body).slice(0, 160));
  check('가장 잘 맞는 사진을 골라 저장한다', /^Cat sleeping/.test(String(r.body.title || '')), String(r.body.title));
  check('출처·라이선스를 함께 돌려준다',
    /commons\.wikimedia\.org/.test(String(r.body.page || '')) && !!r.body.license,
    String(r.body.license));
  check('저장한 파일이 실제로 만들어진다',
    (await fsp.stat(path.join(TMP, 'imported', String(r.body.url || '').replace(/^\/api\/img\//, '')))).size > 100);

  // ── ③ 관련 없는 사진은 넣지 않는다 ───────────────────────────────────────
  imgqAnswer = 'zzqqxx nonexistent thing';
  r = await call('POST', '/api/ai/imgadd', req({ q: 'zzqqxx 존재하지 않는 것' }));
  check('잘 맞는 사진이 없으면 404 로 알린다(아무 사진이나 넣지 않는다)',
    r.status === 404 && r.body.ok === false && /잘 맞는 사진|찾지 못했어요/.test(String(r.body.error)),
    JSON.stringify(r.body));

  // ── ④ 캐시 — 같은 요청은 다시 찾지 않는다 ────────────────────────────────
  imgqAnswer = 'sleeping ginger cat\ncat\nkitten';
  calls.length = 0;
  r = await call('POST', '/api/ai/imgadd', req({ q: '고양이 사진 넣어 줘' }));
  check('같은 요청은 캐시로 바로 답한다', r.status === 200 && r.body.cached === true
    && calls.length === 0, `calls=${calls.length}`);

  // ── ⑤ 검색어가 짧으면 거절 ───────────────────────────────────────────────
  r = await call('POST', '/api/ai/imgadd', req({ q: 'a' }));
  check('너무 짧은 요청은 거절한다', r.status === 400 && r.body.ok === false);
} finally {
  await fsp.rm(TMP, { recursive: true, force: true });
}

console.log(`\n  ${pass}개 통과 · 사진 검색 파이프라인 계약`);
