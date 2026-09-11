// arXiv 기반 오늘의 추천 논문 — 등록한 키워드의 최신 제출 논문을 안전하게 중계한다.
// 브라우저가 arxiv.org를 직접 호출하면 CORS·캐시 정책에 막힐 수 있어 서버에서만
// Atom API를 읽는다. URL은 아래에서 조립하므로 사용자가 임의 주소를 요청할 수 없다.

const ARXIV_API = 'https://export.arxiv.org/api/query';
const MAX_KEYWORDS = 8;
const MAX_KEYWORD_CHARS = 64;
const MAX_RESULTS = 10;
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8500;

const paperCache = new Map();       // key → { at, items }
const paperInFlight = new Map();    // 같은 키를 동시에 열면 upstream 요청도 하나만

export function normalizePaperKeywords(value) {
  const source = Array.isArray(value) ? value : (value == null ? [] : [value]);
  const seen = new Set();
  const out = [];
  for (const raw of source) {
    // 쉼표/줄바꿈으로 넘어온 값도 개별 키워드로 받아 API·테스트 모두 같은 규칙을 쓴다.
    for (const part of String(raw || '').split(/[\n,]/)) {
      const keyword = part.replace(/\s+/g, ' ').trim();
      if (!keyword || keyword.length > MAX_KEYWORD_CHARS) continue;
      // arXiv all: 검색에 필요한 일반 문자만 허용한다. URL·연산자를 직접 넣는 식의
      // 쿼리 주입은 막되, 한국어·수식 이름(C++, HBM3E)은 그대로 쓸 수 있다.
      if (!/^[\p{L}\p{N}\s.+#/_-]+$/u.test(keyword)) continue;
      const key = keyword.toLocaleLowerCase('en-US');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(keyword);
      if (out.length >= MAX_KEYWORDS) return out;
    }
  }
  return out;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i').exec(xml);
  return match ? decodeXml(match[1]) : '';
}

export function parseArxivAtom(xml) {
  const entries = String(xml || '').match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];
  const seen = new Set();
  const papers = [];
  for (const entry of entries) {
    const idUrl = tagText(entry, 'id');
    const idMatch = /arxiv\.org\/abs\/([^\s?#]+)/i.exec(idUrl);
    if (!idMatch) continue;
    const id = idMatch[1].replace(/v\d+$/i, '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title = tagText(entry, 'title');
    if (!title) continue;
    const authorBlocks = entry.match(/<author\b[^>]*>[\s\S]*?<\/author>/gi) || [];
    const authors = authorBlocks.map(block => tagText(block, 'name')).filter(Boolean).slice(0, 12);
    const categoryMatches = [...entry.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?\s*>/gi)];
    const categories = categoryMatches.map(match => decodeXml(match[1])).filter(Boolean).slice(0, 8);
    papers.push({
      id,
      title,
      authors,
      categories,
      abstract: tagText(entry, 'summary'),
      submitted: tagText(entry, 'published') || tagText(entry, 'updated'),
      updated: tagText(entry, 'updated'),
      url: `https://arxiv.org/abs/${encodeURIComponent(id)}`,
      pdfUrl: `https://arxiv.org/pdf/${encodeURIComponent(id)}`,
    });
  }
  return papers;
}

function submittedAt(paper) {
  const at = Date.parse(paper && paper.submitted);
  return Number.isFinite(at) ? at : 0;
}

export function arxivApiUrl(keywords) {
  const terms = normalizePaperKeywords(keywords);
  const searchQuery = terms.map(term => `all:"${term}"`).join(' OR ');
  const url = new URL(ARXIV_API);
  url.searchParams.set('search_query', searchQuery);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', String(MAX_RESULTS));
  url.searchParams.set('sortBy', 'submittedDate');
  url.searchParams.set('sortOrder', 'descending');
  return url.toString();
}

export async function latestArxivPapers(keywords, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const terms = normalizePaperKeywords(keywords);
  if (!terms.length) return { keywords: [], items: [], cached: false };
  const key = terms.map(term => term.toLocaleLowerCase('en-US')).sort().join('\u0001');
  const stored = paperCache.get(key);
  if (stored && now - stored.at < CACHE_TTL_MS) {
    return { keywords: terms, items: stored.items, cached: true };
  }
  if (paperInFlight.has(key)) return paperInFlight.get(key);

  const job = (async () => {
    const response = await fetchImpl(arxivApiUrl(terms), {
      headers: {
        // arXiv API etiquette: identify the application instead of looking like an anonymous scraper.
        'User-Agent': 'SDYnotes-paper-recommendation/14.67 (https://github.com/troy218/sdynotes)',
        'Accept': 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response || !response.ok) throw new Error(`arXiv ${response ? response.status : 'unavailable'}`);
    const xml = await response.text();
    if (xml.length > 1_500_000) throw new Error('arXiv response too large');
    const items = parseArxivAtom(xml)
      .sort((a, b) => submittedAt(b) - submittedAt(a))
      .slice(0, MAX_RESULTS);
    paperCache.set(key, { at: now, items });
    return { keywords: terms, items, cached: false };
  })();
  paperInFlight.set(key, job);
  try { return await job; }
  finally { paperInFlight.delete(key); }
}

export function paperRecommendationCacheReset() {
  paperCache.clear();
  paperInFlight.clear();
}

export function registerPapers(app) {
  app.get('/api/papers/recommend', async (req, reply) => {
    const query = req.query || {};
    const raw = query.keyword ?? query.keywords ?? [];
    const keywords = normalizePaperKeywords(raw);
    if (!keywords.length) return reply.send({ ok: true, keywords: [], items: [], cached: false });
    try {
      const result = await latestArxivPapers(keywords);
      return reply.send({ ok: true, ...result });
    } catch (error) {
      // upstream 세부 오류·주소는 사용자 화면에 내보내지 않는다.
      return reply.code(502).send({ ok: false, error: '추천 논문을 불러오지 못했어요. 잠시 뒤에 다시 시도해 주세요.' });
    }
  });
}
