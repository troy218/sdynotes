/* 14.31.0 · 사진 검색 알고리즘 계약 — 네트워크 없이 순수 함수만 검증한다.
 * ---------------------------------------------------------------------------
 * "사진이 자꾸 연관없게 나온다"는 불만을 고치면서 넣은 것들:
 *   ① 요청 문장 → 검색어 정제(cleanImgQuery) — 부탁 말·조사·'사진' 낱말 제거
 *   ② 검색어 낱말 추출(imgTerms)
 *   ③ 관련도 점수(imgScore) — 제목 우선, 설명·분류 보너스, 로고·지도 감점
 *   ④ 다시 세우기(imgRank) — 너무 작은 사진·중복 제목 제외, 점수 순
 * 네트워크(커먼즈·오픈버스)가 필요한 부분은 이 테스트가 부르지 않는다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanImgQuery, imgTerms, imgScore, imgRank } from '../server/src/routes/aiTools.js';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const src = fs.readFileSync(path.join(REPO, 'server/src/routes/aiTools.js'), 'utf8');

let pass = 0;
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` → ${extra}` : ''));
  pass++;
  console.log('  ✓ ' + name);
};

// ── 1) 검색어 정제 ───────────────────────────────────────────────────────────
check('요청 문장에서 부탁 말·조사·사진 낱말을 걷어 낸다',
  cleanImgQuery('고양이 사진을 아래에 넣어 줘') === '고양이',
  JSON.stringify(cleanImgQuery('고양이 사진을 아래에 넣어 줘')));
check('"이미지 추가해 줘" 도 주제만 남는다',
  cleanImgQuery('고양이 이미지 추가해 줘') === '고양이',
  JSON.stringify(cleanImgQuery('고양이 이미지 추가해 줘')));
check('"찾아서 넣어줘" 도 주제만 남는다',
  cleanImgQuery('강아지 사진 찾아서 넣어줘') === '강아지',
  JSON.stringify(cleanImgQuery('강아지 사진 찾아서 넣어줘')));
check('/사진 · 사진: 접두사를 떼어 낸다',
  cleanImgQuery('/사진 노을 지는 바다') === '노을 지는 바다'
  && cleanImgQuery('사진: 노을 지는 바다') === '노을 지는 바다');
check('영어 요청은 그대로 살린다',
  cleanImgQuery('cute cat photo') === 'cute cat',
  JSON.stringify(cleanImgQuery('cute cat photo')));
check('낱말 일부를 잘라 먹지 않는다 (노을·의자·고양이)',
  cleanImgQuery('노을 사진 넣어줘') === '노을'
  && cleanImgQuery('의자 사진 넣어줘') === '의자'
  && cleanImgQuery('고양이 사진 넣어줘') === '고양이');
check('빈 요청은 빈 검색어다', cleanImgQuery('') === '' && cleanImgQuery(null) === '');

// ── 2) 검색 낱말 ─────────────────────────────────────────────────────────────
check('영어 검색어는 불용어를 뺀 낱말로 쪼갠다',
  JSON.stringify(imgTerms('a photo of a cute cat')) === JSON.stringify(['cute', 'cat']),
  JSON.stringify(imgTerms('a photo of a cute cat')));
check('한국어 검색어도 조사·불용어를 뺀다',
  JSON.stringify(imgTerms('고양이 사진')) === JSON.stringify(['고양이']),
  JSON.stringify(imgTerms('고양이 사진')));

// ── 3) 관련도 점수 ───────────────────────────────────────────────────────────
const cand = (over) => Object.assign({
  title: 'Cat sitting on a sofa', url: 'https://example.org/a.jpg',
  width: 1600, height: 1200, desc: 'a cat resting', cats: 'Cats', score: 0,
}, over || {});
const terms = imgTerms('cat');

check('제목에 검색어가 있으면 가장 높은 점수를 받는다',
  imgScore(cand(), terms).score > imgScore(cand({ title: 'A sunny beach', desc: '', cats: '' }), terms).score);
check('제목보다 설명만 맞으면 점수가 낮다',
  imgScore(cand({ title: 'Sitting', desc: 'a cat', cats: '' }), terms).score
  < imgScore(cand({ title: 'Cat', desc: '', cats: '' }), terms).score);
check('로고·지도·도표처럼 사진이 아닌 것은 크게 감점한다',
  imgScore(cand({ title: 'Wikipedia logo', desc: '', cats: '' }), terms).score < imgScore(cand(), terms).score
  && imgScore(cand({ title: 'Map of Seoul', desc: '', cats: '' }), terms).score < 0,
  String(imgScore(cand({ title: 'Map of Seoul', desc: '', cats: '' }), terms).score));
check('검색어에 그 낱말이 있으면 감점하지 않는다 ("지도 사진")',
  imgScore(cand({ title: 'Map of Seoul', desc: '', cats: '' }), imgTerms('map seoul')).score > 0,
  String(imgScore(cand({ title: 'Map of Seoul', desc: '', cats: '' }), imgTerms('map seoul')).score));
check('한국어 검색어가 영어 사진 제목에 없어도 감점하지 않는다',
  imgScore(cand({ title: 'Cat', desc: '', cats: '' }), imgTerms('고양이')).score >= 0,
  String(imgScore(cand({ title: 'Cat', desc: '', cats: '' }), imgTerms('고양이')).score));
check('가로세로 비율이 극단적으로 기다란 사진은 감점한다',
  imgScore(cand({ width: 3000, height: 400 }), terms).score
  < imgScore(cand({ width: 1600, height: 1200 }), terms).score);
check('알맞은 크기(800~3000) 사진에 보너스를 준다',
  imgScore(cand({ width: 1200, height: 900 }), terms).score
  >= imgScore(cand({ width: 420, height: 320 }), terms).score);

// ── 4) 다시 세우기 ───────────────────────────────────────────────────────────
const ranked = imgRank([
  { title: 'Wikipedia logo', url: 'https://e/1.png', width: 1000, height: 1000 },
  { title: 'A cat on a sofa', url: 'https://e/2.jpg', width: 1600, height: 1200, desc: 'cat' },
  { title: 'Tiny cat', url: 'https://e/3.jpg', width: 80, height: 80 },
  { title: 'A cat on a sofa', url: 'https://e/4.jpg', width: 1200, height: 900, desc: 'cat' },
  { title: 'Sunset over the sea', url: 'https://e/5.jpg', width: 1600, height: 1200 },
], terms);
check('관련 없는 사진(로고)은 뒤로 밀린다', ranked[0].title === 'A cat on a sofa', ranked[0] && ranked[0].title);
check('노트에 넣기 너무 작은 사진은 목록에서 빠진다',
  ranked.every((r) => Number(r.width) >= 300 && Number(r.height) >= 300), JSON.stringify(ranked.map((r) => r.title)));
check('같은 제목은 한 번만 남는다',
  ranked.filter((r) => /^A cat on a sofa$/.test(r.title)).length === 1,
  JSON.stringify(ranked.map((r) => r.score + ':' + r.title)));
check('모든 후보에 점수가 붙는다', ranked.every((r) => typeof r.score === 'number'));

// ── 5) 소스 계약 ─────────────────────────────────────────────────────────────
check('사진 소스가 커먼즈 하나가 아니다 (오픈버스 병행)',
  /async function commonsImageSearch/.test(src) && /async function openverseSearch/.test(src)
  && /api\.openverse\.org\/v1\/images/.test(src));
check('검색어를 AI(imgq)로 한 번 다듬는다',
  /aiQuickText\('imgq'/.test(src) && /imgq: \{/.test(fs.readFileSync(path.join(REPO, 'server/src/routes/ai.js'), 'utf8')));
check('AI 가 꺼져 있으면 무료 번역 → 정제 검색어로 대체한다',
  /translateFree\(cleaned, 'en'\)/.test(src) && /how: 'clean'/.test(src));
check('관련도 기준(IMG_MIN_SCORE)을 못 넘으면 사진을 넣지 않는다',
  /const IMG_MIN_SCORE = \d+/.test(src) && /got\.results\[0\]\.score < IMG_MIN_SCORE/.test(src));
check('순수 함수는 export 되어 테스트가 직접 부른다',
  /export function cleanImgQuery/.test(src) && /export function imgTerms/.test(src)
  && /export function imgScore/.test(src) && /export function imgRank/.test(src));

console.log(`\n  ${pass}개 통과 · 사진 검색 알고리즘 계약`);
