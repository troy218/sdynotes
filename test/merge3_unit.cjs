// 3-way 병합(협업 편집) 단위 테스트 — sdynotes.js 에서 실제 함수를 추출해 검증
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'sdynotes.js'), 'utf8');
const start = html.indexOf('function _sdyUnits');
const end = html.indexOf('function _elById');
if (start < 0 || end < 0) { console.error('merge functions not found'); process.exit(2); }
const block = html.slice(start, end);
const o = {};
new Function('o', block + ' ; Object.assign(o,{_sdyUnits,_sdyDiff,_sdyResolve,_sdyApplyHunks,_sdyMerge3,mergeText3});')(o);
const { mergeText3 } = o;

let P = 0, F = 0;
function ok(name, cond, extra) {
  if (cond) { P++; }
  else { F++; console.log('  ✗ ' + name + '  ' + (extra || '')); }
}

// 1) 양쪽이 서로 다른 위치에 덧붙임 → 둘 다 반영
let m = mergeText3('hello', 'hello world', 'hello folks');
ok('append 양쪽 반영', m.includes('world') && m.includes('folks'), m);

// 2) 앞/뒤 동시 삽입
m = mergeText3('abc', 'XYZabc', 'abcDEF');
ok('앞 삽입 유지', m.includes('XYZ'), m);
ok('뒤 삽입 유지', m.includes('DEF'), m);

// 3) 정준 순서 병합의 수렴성: (mine,theirs)를 정렬해 부르면 어느 기기나 같은 결과
function canonMerge(base, x, y) { const lo = x <= y ? x : y, hi = x <= y ? y : x; return mergeText3(base, lo, hi); }
const cases = [
  ['hello', 'hello world', 'hello folks'],
  ['abc', 'XYZabc', 'abcDEF'],
  ['가나다', '가나다라', '가나다마'],
  ['x', 'x<B>x', 'x y'],
  ['<p>hi</p>', '<p>hi</p>!', '<p>hi</p>?'],
  ['1234567890', '12345X67890', '123456Y7890'],
];
for (const [base, a, b] of cases) {
  ok('수렴 ' + base, canonMerge(base, a, b) === canonMerge(base, b, a),
     JSON.stringify([canonMerge(base, a, b), canonMerge(base, b, a)]));
}

// 4) 텍스트 유실 없음 (a의 글자가 결과에 모두 존재)
function txt(h) { return h.replace(/<[^>]+>/g, ''); }
for (const [base, a, b] of cases) {
  const merged = txt(mergeText3(base, a, b));
  let buf = merged.split('');
  const aAll = [...txt(a)].every(ch => {
    const i = buf.indexOf(ch);
    if (i < 0) return false;
    buf.splice(i, 1);
    return true;
  });
  ok('a 유실없음 ' + base, aAll, merged);
}

// 5) 한쪽만 수정 → 그쪽 반영
ok('A만 수정', mergeText3('abc', 'aXc', 'abc') === 'aXc');
ok('B만 수정', mergeText3('abc', 'abc', 'abYc') === 'abYc');

// 6) 같은 수정 → 한 번만
ok('같은 수정', mergeText3('abc', 'aXc', 'aXc') === 'aXc');

// 7) HTML 태그 단위 보존 (태그 반토막 안 남)
m = mergeText3('<b>hello</b>', '<b>hello</b> world', '<b>hello</b> folks');
ok('태그 보존', (m.match(/<b>/g) || []).length === 1 && (m.match(/<\/b>/g) || []).length === 1, m);

// 8) 대형 문자열 성능
const bigO = 'a'.repeat(5000), bigA = bigO + 'x', bigB = bigO + 'y';
const t0 = Date.now();
m = mergeText3(bigO, bigA, bigB);
const dt = Date.now() - t0;
ok('대형 성능(<500ms)', dt < 500, dt + 'ms');
ok('대형 결과', m.includes('x') && m.includes('y'));

// 9) base 가 빈 경우 (새 상자) — 정준 순서로 수렴
m = canonMerge('', 'abc', 'def');
ok('빈 base 충돌 결정적', m === canonMerge('', 'def', 'abc'), m);
ok('빈 base 양쪽 보존', m.includes('abc') && m.includes('def'), m);

console.log('\n병합 단위테스트: PASS ' + P + ' / FAIL ' + F);
process.exit(F ? 1 : 0);
