// 음악 라이브러리 — 목록/스트리밍/재생/가사/표지 (로컬+클라우드).
// 무거운 작업(태깅·인식·유튜브)은 Python worker로 프록시한다.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DIRS, FILES } from '../lib/paths.js';
import { MUSIC_EXTS, MUSIC_MIME, CLOUD_READY, sbEnabled } from '../lib/config.js';
import { readJson, writeJsonAtomic, withLock, SAN_ID } from '../lib/store.js';
import { sbGet, sbRows, sbPut, sbDelete, errorText } from '../lib/supabase.js';
import { requireAdmin } from '../lib/admin.js';
import { cloudinaryUrl, destroy } from '../lib/cloudinary.js';
import { publishLive } from '../lib/sse.js';

const musicLoad = async () => {
  let m = await readJson(FILES.musicMeta, null);
  if (m && typeof m === 'object' && !Array.isArray(m)) return m;
  m = await readJson(FILES.musicBak, null);
  if (m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length) {
    await writeJsonAtomic(FILES.musicMeta, m).catch(() => {});
    return m;
  }
  return {};
};

const musicSave = (m) => writeJsonAtomic(FILES.musicMeta, m);

// 목록 응답용 공개 레코드 (가사 본문 제외)
const musicPublic = (r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'lyrics' || k === 'lyrics_plain') continue;
    o[k] = v;
  }
  const sync = r.lyrics || '';
  const plain = r.lyrics_plain || '';
  o.has_sync = sync.includes('[');
  o.has_lyrics = Boolean(sync.trim() || plain.trim());
  return o;
};

const musicPublicCloud = (rec) => {
  const out = musicPublic(rec);
  if (out.cover_url) out.cover = true;
  let stream = out.stream_url || '';
  if ((!stream || stream.startsWith('/api/')) && rec.cloud_public_id && CLOUD_READY) {
    try {
      stream = cloudinaryUrl(rec.cloud_public_id, {
        resource_type: 'video', secure: true, format: rec.ext, version: rec.version,
      });
      out.stream_url = stream;
    } catch { /* ignore */ }
  }
  return out;
};

const remoteTrack = async (mid) => {
  if (!sbEnabled()) return null;
  try {
    const d = await sbGet('sdy_music_tracks', mid);
    return (d && typeof d === 'object') ? d : null;
  } catch { return null; }
};

// 로컬 목록이 비었는데 음원 파일이 있으면 가벼운 플레이스홀더로 되살린다
async function localRebuildIfNeeded(m) {
  if (Object.keys(m).length) return m;
  let files = [];
  try { files = await fsp.readdir(DIRS.music); } catch { return m; }
  const audio = files.filter((fn) => MUSIC_EXTS.has((fn.split('.').pop() || '').toLowerCase()));
  if (!audio.length) return m;
  for (const fn of audio) {
    const ext = fn.split('.').pop().toLowerCase();
    const mid = fn.slice(0, fn.lastIndexOf('.'));
    if (!mid || m[mid]) continue;
    let bytes = 0;
    try { bytes = (await fsp.stat(path.join(DIRS.music, fn))).size; } catch { /* */ }
    const coverFile = `${mid}.cover`;
    const hasCover = await fsp.access(path.join(DIRS.music, coverFile)).then(() => true).catch(() => false);
    m[mid] = {
      id: mid, title: mid.slice(0, 120), ext, bytes, cover: hasCover,
      artist: '', album: '', year: '', genre: '',
      orig_title: mid.slice(0, 120), tag_state: 'placeholder', tag_src: '',
      created_at: new Date().toISOString().slice(0, 19).replace('T', '') + 'Z',
    };
  }
  await musicSave(m).catch(() => {});
  return m;
}

// ═══════════════════════════════════════════════════════════════════
//  태그 기반 추천 엔진 (백엔드 전용)
//  · 곡마다 제목·가수·앨범·장르·연도·가사에서 태그를 아주 많이 뽑아낸다
//    (언어·템포·무드·스타일·보컬·장르 토큰·연대·가사 키워드 …).
//  · 태그는 절대 응답에 노출하지 않는다 — 태그가 겹치는 곡 묶음(groups)과
//    곡별 유사곡(sims)만 내려 준다. 프런트는 그걸 그대로 보여 주기만 한다.
// ═══════════════════════════════════════════════════════════════════
const _rNorm = (s) => String(s || '').toLowerCase().normalize('NFKC').trim();
const _HANGUL = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
const _KANA = /[\u3040-\u30ff]/;

// 무드·템포·스타일 키워드 사전 — 프런트의 것보다 훨씬 크게.
const RECO_DICT = [
  ['tempo:fast', /dance|edm|house|techno|club|trance|d&b|drum ?and ?bass|fast|punk|metal|hype|speed|hyper|bounce|banger|festival|신나는|빠른|댄스|파티|질주|달리|페스티벌|비트|일렉|파워|후렴|떼창|부스트/],
  ['tempo:slow', /ballad|lofi|lo-fi|slowly|slow|acoustic|piano|calm|chill|ambient|classical|sleep|lullaby|발라드|잔잔|조용|느린|수면|피아노|어쿠스틱|클래식|명상|자장가|위로|눈물|이별/],
  ['mood:calm', /calm|chill|relax|acoustic|ballad|healing|warm|piano|soft|cozy|mellow|잔잔|발라드|따뜻|힐링|위로|어쿠스틱|편안|감성|포근|서정/],
  ['mood:energy', /energy|dance|party|summer|bright|upbeat|fresh|hype|power|bounce|신나|활기|청량|여름|에너지|시원|파티|응원|질주|축제|불태/],
  ['mood:focus', /study|focus|lofi|lo-fi|work|instrumental|coffee|cafe|reading|독서|집중|공부|작업|연주|카페|배경음악|재즈|스터디/],
  ['mood:night', /night|dawn|midnight|deep|sentimental|dark|moon|starry|새벽|밤(?!하늘색)|감성|센치|달빛|야간|어두운|쓸쓸|고독|별빛/],
  ['mood:love', /love|kiss|crush|heart|romance|romantic|darling|사랑|연애|설렘|고백|그대|자기야|입맞|두근|로맨/],
  ['mood:sad', /sad|tears|cry|goodbye|farewell|lonely|miss you|breakup|슬픔|슬픈|눈물|이별|안녕|그리워|그립|보고싶|아픔|외로|헤어/],
  ['mood:rain', /rain|snow|winter|cloud|storm|fog|drizzle|umbrella|비(?:가| ?오|내리)|빗소리|빗물|장마|눈(?:이 ?오|내리)|겨울|흐림|안개|우산/],
  ['mood:sunny', /spring|autumn|breeze|sun|sunny|drive|walk|picnic|travel|봄|가을|햇살|바람|드라이브|산책|소풍|여행|하늘|바다/],
  ['mood:cinema', /ost|soundtrack|cinematic|drama|movie|film|anime|game|드라마|영화|애니|게임|테마곡|삽입곡|주제가/],
  ['mood:retro', /retro|city ?pop|80s|90s|newtro|oldies|classic pop|레트로|시티팝|뉴트로|옛날|추억|복고/],
  ['style:band', /\bband\b|rock|indie rock|밴드|락|록|기타(?!리스트 없)|드럼/],
  ['style:hiphop', /rap|hip ?hop|cypher|flow|swag|trap|boom ?bap|힙합|랩(?![아-핳])|사이퍼|디스|플로우/],
  ['style:rnb', /r&b|rnb|soul|groove|알앤비|소울|그루브/],
  ['style:edm', /edm|electronic|synth|house|techno|trance|dubstep|일렉|신스|하우스|테크노/],
  ['style:jazz', /jazz|swing|bossa|blues|재즈|스윙|보사|블루스/],
  ['style:classic', /classical|orchestra|symphony|concerto|sonata|클래식|오케스트라|교향곡|협주곡|소나타/],
  ['style:acoustic', /acoustic|unplugged|guitar|어쿠스틱|통기타|언플러그드/],
  ['style:idol', /k-?pop|idol|아이돌|걸그룹|보이그룹|컴백|타이틀곡/],
  ['style:trot', /trot|트로트|미스터트롯|미스트롯|뽕/],
  ['style:indie', /indie|인디|홍대|자작곡/],
  ['style:inst', /instrumental|piano ver|inst\.?$|연주곡|피아노 ?버전|반주|mr\b/],
  ['vocal:female', /iu|아이유|taeyeon|태연|heize|헤이즈|bol4|볼빨간|younha|윤하|백예린|권진아|태연|청하|화사|선미|에일리|박정현|이하이|조유리|taylor|swift|ariana|billie|adele|dua lipa|sia|newjeans|ive|aespa|le sserafim|twice|blackpink|red velvet|여자친구|오마이걸|로제|지수|제니|리사/],
  ['vocal:male', /성시경|박효신|이적|폴킴|임영웅|김동률|김범수|나얼|정승환|멜로망스|규현|디오|백현|첸|영탁|이찬원|sheeran|bruno mars|bieber|charlie puth|sam smith|bts|방탄|정국|지민|뷔|슈가|세븐틴|seventeen|day6|데이식스|nct|엑소|exo/],
];

// 가사 키워드 추출에서 버릴 흔한 말들
const RECO_STOP = new Set(('the and you for that with this from your they will have not are was but all can what when out now come like just know its it\'s dont don\'t im i\'m oh yeah la na woo ooh baby '
  + '나는 너는 우리 그리고 그래서 하지만 그런 이런 저런 있는 없는 것은 것을 나의 너의 그대 내가 네가 니가 우리는 당신 오늘 지금 다시 정말 너무 그냥 모든 하나 마음 시간 사람 세상 함께 위해 대한 그게 이게').split(/\s+/));

function _recoLangTags(rec, text) {
  const tags = [];
  const hasKo = _HANGUL.test(rec.title || '') || _HANGUL.test(rec.artist || '') || _HANGUL.test(text.slice(0, 400));
  const hasJa = _KANA.test((rec.title || '') + (rec.artist || '') + text.slice(0, 400));
  if (hasKo || /k.?pop|가요|한국|국내|트로트|아이돌|인디|발라드|korean/.test(_rNorm(rec.genre))) tags.push('lang:kr');
  else if (hasJa) tags.push('lang:jp');
  else tags.push('lang:global');
  return tags;
}

function _recoLyricWords(plain) {
  const out = [];
  if (!plain) return out;
  const counts = new Map();
  const words = String(plain).toLowerCase().match(/[가-힣a-z][가-힣a-z']{1,}/g) || [];
  for (const w of words) {
    if (w.length < 2 || w.length > 14 || RECO_STOP.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => 'w:' + w);
}

function recoExtractTags(rec) {
  const plain = String(rec.lyrics_plain || String(rec.lyrics || '').replace(/\[[^\]]*\]/g, ' ') || '');
  const text = _rNorm((rec.title || '') + ' ' + (rec.artist || '') + ' ' + (rec.album || '') + ' '
    + (rec.genre || '') + ' ' + plain.slice(0, 1200));
  const tags = new Set(_recoLangTags(rec, plain));
  let fast = false, slow = false;
  for (const [tag, re] of RECO_DICT) {
    if (!re.test(text)) continue;
    if (tag === 'tempo:fast') { fast = true; continue; }
    if (tag === 'tempo:slow') { slow = true; continue; }
    tags.add(tag);
  }
  tags.add(fast && !slow ? 'tempo:fast' : (slow && !fast ? 'tempo:slow' : 'tempo:mid'));
  for (const g of _rNorm(rec.genre).split(/[/,;·&]+/)) {
    const t = g.trim(); if (t && t.length <= 24) tags.add('genre:' + t);
  }
  const artist = _rNorm(rec.artist).replace(/\s+/g, '');
  if (artist) tags.add('artist:' + artist.slice(0, 40));
  const album = _rNorm(rec.album).replace(/\s+/g, '');
  if (album) tags.add('album:' + album.slice(0, 40));
  const y = parseInt(String(rec.year || '').slice(0, 4), 10);
  if (y >= 1950 && y <= 2100) tags.add('era:' + (Math.floor(y / 10) * 10));
  for (const w of _recoLyricWords(plain)) tags.add(w);
  return tags;
}

// 태그 종류별 기본 가중치 — 겹치는 태그가 '얼마나 강한 공통점'인지
const RECO_W = { artist: 30, album: 14, genre: 12, era: 6, lang: 8, tempo: 10, mood: 9, style: 10, vocal: 7, w: 4 };
const _tagKind = (t) => t.slice(0, t.indexOf(':'));
const _rHash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

const GROUP_NAMES = [
  '‘%s’ 같은 분위기', '‘%s’ 좋아하면 이것도', '‘%s’와 잘 어울리는 곡들',
  '‘%s’ 무드 이어듣기', '‘%s’에서 이어지는 믹스', '‘%s’ 느낌 그대로',
];

function recoBuild(records) {
  const list = records.filter((r) => r && r.id);
  const n = list.length;
  const tagsOf = new Map();
  const inv = new Map();                        // tag -> [ids]
  for (const r of list) {
    const tags = recoExtractTags(r);
    tagsOf.set(r.id, tags);
    for (const t of tags) {
      if (!inv.has(t)) inv.set(t, []);
      inv.get(t).push(r.id);
    }
  }
  const byId = new Map(list.map((r) => [r.id, r]));
  const wOf = (tag, df) => (RECO_W[_tagKind(tag)] || 4) / Math.log2(2 + df);

  // ── 곡별 유사곡: 역색인으로 '태그가 겹치는 만큼' 점수를 쌓는다 ──
  const simScore = new Map(list.map((r) => [r.id, new Map()]));
  for (const [tag, ids] of inv) {
    if (ids.length < 2 || ids.length > Math.max(8, n * 0.55)) continue; // 절반 이상이 가진 태그는 공통점이 아니다
    const w = wOf(tag, ids.length);
    for (let i = 0; i < ids.length; i++) {
      const m = simScore.get(ids[i]);
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        m.set(ids[j], (m.get(ids[j]) || 0) + w);
      }
    }
  }
  const sims = {};
  for (const [id, m] of simScore) {
    sims[id] = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map((x) => x[0]);
  }

  // ── 태그 묶음 → 추천 그룹 (겹치는 태그가 있는 곡들의 묶음) ──
  const plays = (id) => { const r = byId.get(id); return Math.max(0, parseInt(r && r.play_count || 0, 10) || 0); };
  const cand = [...inv.entries()]
    .filter(([tag, ids]) => ids.length >= 3 && ids.length <= Math.max(6, n * 0.7) && _tagKind(tag) !== 'artist' && _tagKind(tag) !== 'album')
    .map(([tag, ids]) => ({ tag, ids, score: wOf(tag, ids.length) * Math.min(ids.length, 30) + Math.random() * 2 }))
    .sort((a, b) => b.score - a.score);
  const groups = [];
  const usedSets = [];
  for (const c of cand) {
    if (groups.length >= 10) break;
    const set = new Set(c.ids);
    // 이미 뽑은 그룹과 60% 이상 겹치면 사실상 같은 묶음이니 버린다
    const dup = usedSets.some((u) => {
      let hit = 0; for (const id of set) if (u.has(id)) hit++;
      return hit >= Math.min(set.size, u.size) * 0.6;
    });
    if (dup) continue;
    const ids = c.ids.slice().sort((a, b) => plays(b) - plays(a)).slice(0, 40);
    const rep = byId.get(ids[0]) || {};
    const name = GROUP_NAMES[groups.length % GROUP_NAMES.length]
      .replace('%s', String(rep.title || '추천').slice(0, 28));
    groups.push({ id: _rHash(c.tag), name, size: ids.length, ids });   // 태그 원문은 절대 노출하지 않는다
    usedSets.push(set);
  }
  return { sims, groups, count: n };
}

let _recoCache = null;   // { at, n, data }
// 테스트에서 추천 계산을 직접 검증할 수 있게 내보낸다 (라우트 계약과 동일 로직)
export { recoBuild, recoExtractTags };

export function registerMusic(app, { worker }) {
  // ── 태그 기반 추천 — 곡 묶음(groups) + 곡별 유사곡(sims). 태그는 비공개. ──
  app.get('/api/music/reco', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      let rows;
      if (sbEnabled()) {
        rows = (await sbRows('sdy_music_tracks')).map((r) => r.data).filter((d) => d && typeof d === 'object');
      } else {
        const m = await withLock('music', async () => localRebuildIfNeeded(await musicLoad()));
        rows = Object.values(m);
      }
      if (_recoCache && _recoCache.n === rows.length && Date.now() - _recoCache.at < 60 * 1000) {
        return reply.send({ ok: true, ..._recoCache.data });
      }
      const data = recoBuild(rows);
      _recoCache = { at: Date.now(), n: rows.length, data };
      return reply.send({ ok: true, ...data });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: '추천 계산 실패: ' + (e && e.message || e) });
    }
  });

  app.get('/api/music/list', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (sbEnabled()) {
      try {
        const rows = await sbRows('sdy_music_tracks');
        const items = rows.map((r) => r.data).filter((d) => d && typeof d === 'object')
          .map(musicPublicCloud)
          .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
        return reply.send({ ok: true, tracks: items, tagging: false, count: items.length });
      } catch (e) {
        return reply.code(502).send({ ok: false, error: `음악 목록 연결 실패: ${errorText(e)}` });
      }
    }
    const m = await withLock('music', async () => {
      const mm = await musicLoad();
      return localRebuildIfNeeded(mm);
    });
    const items = Object.values(m).map(musicPublic)
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    return reply.send({ ok: true, tracks: items, tagging: false, count: items.length });
  });

  app.get('/api/music/file/:mid', async (req, reply) => {
    const mid = SAN_ID(req.params.mid, 80);
    if (sbEnabled()) {
      const rec = await remoteTrack(mid);
      if (!rec) return reply.code(404).send({ error: '없는 곡입니다' });
      let url = rec.stream_url || '';
      if (!url && rec.cloud_public_id) {
        try {
          url = cloudinaryUrl(rec.cloud_public_id, { resource_type: 'video', secure: true, format: rec.ext, version: rec.version });
        } catch { /* */ }
      }
      if (!url) return reply.code(404).send({ error: '음원 주소가 없습니다' });
      return reply.redirect(url, 302);
    }
    // 로컬 Range 스트리밍
    let hits = [];
    try {
      const files = await fsp.readdir(DIRS.music);
      hits = files.filter((fn) => fn.startsWith(mid + '.') && !fn.endsWith('.cover') && !fn.endsWith('.meta.json')
        && MUSIC_EXTS.has((fn.split('.').pop() || '').toLowerCase()));
    } catch { /* */ }
    if (!hits.length) return reply.code(404).send({ error: '없는 곡입니다' });
    const filePath = path.join(DIRS.music, hits[0]);
    const stat = await fsp.stat(filePath);
    const size = stat.size;
    const ext = hits[0].split('.').pop().toLowerCase();
    const mime = MUSIC_MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : 0;
        let end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
        if (start >= size) {
          return reply.code(416).header('Content-Range', `bytes */${size}`).send();
        }
        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', String(end - start + 1));
        reply.type(mime);
        return reply.send(fs.createReadStream(filePath, { start, end }));
      }
    }
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', String(size));
    reply.type(mime);
    return reply.send(fs.createReadStream(filePath));
  });

  app.post('/api/music/play', async (req, reply) => {
    // 클라우드: Supabase 레코드에 직접 반영. 로컬: music/_index.json 의 단일
    // 작성자인 Python worker 가 처리한다 (Node 는 읽기 전용).
    if (sbEnabled()) {
      const mid = SAN_ID((req.body || {}).id, 80);
      if (!mid) return reply.code(400).send({ ok: false, error: 'id 없음' });
      const rec = await remoteTrack(mid);
      if (!rec) return reply.code(404).send({ ok: false, error: '없는 곡입니다' });
      rec.play_count = (parseInt(rec.play_count || 0, 10) || 0) + 1;
      rec.last_played = Date.now() / 1000;
      await sbPut('sdy_music_tracks', mid, rec);
      return reply.send({ ok: true, play_count: rec.play_count });
    }
    return worker.proxy(req, reply);
  });

  app.get('/api/music/lyrics/:mid', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const mid = SAN_ID(req.params.mid, 80);
    let r;
    if (sbEnabled()) r = await remoteTrack(mid);
    else r = await withLock('music', async () => (await musicLoad())[mid]);
    if (!r) return reply.code(404).send({ ok: false, error: '없는 곡' });
    return reply.send({
      ok: true, id: mid,
      lyrics: r.lyrics || '', lyrics_plain: r.lyrics_plain || '',
      lyrics_src: r.lyrics_src || '', lyrics_tries: r.lyrics_tries || 0,
    });
  });

  app.get('/api/music/cover/:mid', async (req, reply) => {
    const mid = SAN_ID(req.params.mid, 80);
    if (sbEnabled()) {
      const rec = await remoteTrack(mid);
      if (!rec) return reply.code(404).send({ error: '없는 곡' });
      let url = rec.cover_url;
      if (!url && rec.cover_public_id) {
        try { url = cloudinaryUrl(rec.cover_public_id, { resource_type: 'image', secure: true }); } catch { /* */ }
      }
      if (!url) return reply.code(404).send({ error: '없음' });
      return reply.redirect(url, 302);
    }
    const filePath = path.join(DIRS.music, `${mid}.cover`);
    try {
      const buf = await fsp.readFile(filePath);
      reply.header('Cache-Control', 'public, max-age=31536000');
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: '없음' });
    }
  });

  // 삭제 (관리자 전용) — 클라우드는 원본과 동일 계약, 로컬은 worker 가 처리
  app.post('/api/music/delete', async (req, reply) => {
    if (!requireAdmin(req, req.body || {})) return reply.code(403).send({ ok: false, error: '관리자 인증이 필요합니다' });
    if (sbEnabled()) {
      const mid = SAN_ID((req.body || {}).id, 80);
      const rec = await remoteTrack(mid);
      if (!rec) return reply.code(404).send({ ok: false, error: '없는 곡입니다' });
      try {
        if (CLOUD_READY && rec.cloud_public_id) {
          await destroy(rec.cloud_public_id, { resource_type: 'video', invalidate: true }).catch(() => {});
        }
        if (rec.cover_public_id) await destroy(rec.cover_public_id, { resource_type: 'image' }).catch(() => {});
        await sbDelete('sdy_music_tracks', mid);
        publishLive('music', mid);
        return reply.send({ ok: true });
      } catch (e) {
        return reply.code(502).send({ ok: false, error: `음악 삭제 실패: ${errorText(e)}` });
      }
    }
    return worker.proxy(req, reply);
  });

  // ── 무거운 음악 작업 → Python worker 프록시 ──
  const heavyMusicRoutes = [
    ['POST', '/api/music/upload'],
    ['POST', '/api/music/youtube'],
    ['POST', '/api/music/lookup'],
    ['POST', '/api/music/recognize'],
    ['POST', '/api/music/recognize/key'],
    ['GET', '/api/music/recognize/status'],
    ['POST', '/api/music/rescan'],
    ['POST', '/api/music/reset'],
    ['POST', '/api/music/synced-lyrics'],
    ['POST', '/api/music/meta'],
    ['POST', '/api/music/cover'],
    ['POST', '/api/music/from_url'],
    ['POST', '/api/music/background-work'],
    ['GET', '/api/music/youtube/status'],
    ['POST', '/api/music/youtube/cookies'],
    ['DELETE', '/api/music/youtube/cookies'],
  ];
  for (const [method, url] of heavyMusicRoutes) {
    app.route({
      method,
      url,
      // Unlike the import endpoints, music uploads are limited to 50 MB.
      // Buffering here prevents Fastify multipart parsing from consuming the
      // request before it reaches Flask (the source of empty-file uploads
      // after the Node/worker migration).
      handler: (req, reply) => worker.proxy(req, reply, {
        bufferMultipart: url === '/api/music/upload',
      }),
    });
  }
}
