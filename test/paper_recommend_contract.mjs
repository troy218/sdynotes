// 오늘의 추천 논문 — arXiv Atom 파싱, 안전한 키워드, 캐시와 공개 라우트 계약
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  arxivApiUrl, latestArxivPapers, normalizePaperKeywords, paperRecommendationCacheReset,
  parseArxivAtom, registerPapers,
} from '../server/src/routes/papers.js';

let pass=0, fail=0;
function ok(name, condition){
  try { assert.ok(condition); pass++; console.log('✅ '+name); }
  catch (error) { fail++; console.error('❌ '+name+'\n   '+error.message); }
}

const atom=`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2609.09800v1</id>
    <updated>2026-09-10T09:00:00Z</updated><published>2026-09-10T08:00:00Z</published>
    <title> HBFSim: Fast &amp; Faithful Simulation </title>
    <summary> An <em>HBF</em> simulator. </summary>
    <author><name>Jane Doe</name></author><category term="cs.DC"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2609.09000v2</id>
    <updated>2026-09-09T09:00:00Z</updated><published>2026-09-09T08:00:00Z</published>
    <title>Earlier accelerator paper</title><summary>Summary</summary>
  </entry>
</feed>`;

const parsed=parseArxivAtom(atom);
ok('Atom: 제목 XML entity 및 공백을 안전하게 복원', parsed[0]?.title==='HBFSim: Fast & Faithful Simulation');
ok('Atom: version 없는 안전한 arXiv abs 링크를 만든다', parsed[0]?.url==='https://arxiv.org/abs/2609.09800');
ok('Atom: 저자·카테고리·요약을 읽는다', parsed[0]?.authors?.[0]==='Jane Doe' && parsed[0]?.categories?.[0]==='cs.DC' && parsed[0]?.abstract==='An HBF simulator.');
ok('keywords: 공백·중복을 정리하고 쿼리 연산자 문자열은 거절',
  JSON.stringify(normalizePaperKeywords([' hbf, GPU ', 'HBF', 'x" OR all:y', '  ']))===JSON.stringify(['hbf','GPU']));
const upstreamUrl=new URL(arxivApiUrl(['hbf','GPU']));
ok('upstream: arXiv Atom API 고정 주소와 submittedDate 정렬만 사용',
  upstreamUrl.origin==='https://export.arxiv.org' && upstreamUrl.pathname==='/api/query' &&
  upstreamUrl.searchParams.get('sortBy')==='submittedDate' && upstreamUrl.searchParams.get('max_results')==='10' &&
  upstreamUrl.searchParams.get('search_query')==='all:"hbf" OR all:"GPU"');

paperRecommendationCacheReset();
let fetchCount=0;
const stubFetch=async(url)=>{
  fetchCount++;
  return { ok:true, status:200, text:async()=>atom, url };
};
const first=await latestArxivPapers(['hbf'],{fetchImpl:stubFetch,now:1000});
const second=await latestArxivPapers(['hbf'],{fetchImpl:stubFetch,now:1001});
ok('latest: 제출일 내림차순으로 최신 논문이 먼저 온다', first.items[0]?.id==='2609.09800' && first.items.length===2);
ok('cache: 같은 키워드의 짧은 재요청은 upstream을 다시 부르지 않는다', fetchCount===1 && second.cached===true);

paperRecommendationCacheReset();
const savedFetch=globalThis.fetch;
let routeFetches=0;
globalThis.fetch=async()=>{ routeFetches++; return {ok:true,status:200,text:async()=>atom}; };
const app=Fastify({logger:false});
registerPapers(app);
const empty=await app.inject({method:'GET',url:'/api/papers/recommend'});
const route=await app.inject({method:'GET',url:'/api/papers/recommend?keyword=hbf&keyword=GPU'});
const routeCached=await app.inject({method:'GET',url:'/api/papers/recommend?keyword=GPU&keyword=hbf'});
const failedFetch=globalThis.fetch;
globalThis.fetch=async()=>{ throw new Error('offline'); };
paperRecommendationCacheReset();
const unavailable=await app.inject({method:'GET',url:'/api/papers/recommend?keyword=hbf'});
globalThis.fetch=savedFetch;
await app.close();
ok('route: 키워드 없으면 외부 호출 없이 빈 추천을 정상 응답한다', empty.statusCode===200 && JSON.parse(empty.body).ok && routeFetches===1);
const routeData=JSON.parse(route.body), cachedData=JSON.parse(routeCached.body);
ok('route: 등록 키워드를 반복 query로 받고 논문 링크를 반환한다', route.statusCode===200 && routeData.ok && routeData.items?.[0]?.url==='https://arxiv.org/abs/2609.09800');
ok('route: 키워드 순서가 달라도 서버 캐시를 재사용한다', routeCached.statusCode===200 && cachedData.cached===true && routeFetches===1);
ok('route: arXiv 연결 실패는 내부 오류 대신 안내 가능한 502가 된다', unavailable.statusCode===502 && /추천 논문/.test(JSON.parse(unavailable.body).error||''));

console.log(`\n추천 논문 테스트: PASS ${pass} / FAIL ${fail}`);
process.exit(fail?1:0);
