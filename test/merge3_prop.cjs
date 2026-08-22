// 정준 순서(min,max)로 병합 호출 시: 수렴성 + 무손실(삽입만) 검증
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'sdynotes.html'), 'utf8');
const start = html.indexOf('function _sdyUnits');
const end = html.indexOf('function _elById');
const block = html.slice(start, end);
const o = {};
new Function('o', block + ' ; Object.assign(o,{_sdyUnits,_sdyDiff,_sdyResolve,_sdyApplyHunks,_sdyMerge3,mergeText3});')(o);
const { mergeText3 } = o;

function canonMerge(base, x, y) { const a = x <= y ? x : y, b = x <= y ? y : x; return mergeText3(base, a, b); }
function rnd(n) { let s = ''; for (let i = 0; i < n; i++) s += 'ab'[Math.floor(Math.random() * 2)]; return s; }
function insertAt(base, pos, ins) { return base.slice(0, pos) + ins + base.slice(pos); }
function isSubseq(s, t) { let i = 0; for (const ch of t) if (i < s.length && s[i] === ch) i++; return i === s.length; }

let fails = 0;
const N = 3000;
for (let t = 0; t < N; t++) {
  const base = rnd(1 + Math.floor(Math.random() * 10));
  let a = base; const na = 1 + Math.floor(Math.random() * 3);
  for (let k = 0; k < na; k++) a = insertAt(a, Math.floor(Math.random() * (a.length + 1)), rnd(1 + Math.floor(Math.random() * 3)));
  let b = base; const nb = 1 + Math.floor(Math.random() * 3);
  for (let k = 0; k < nb; k++) b = insertAt(b, Math.floor(Math.random() * (b.length + 1)), rnd(1 + Math.floor(Math.random() * 3)));

  // 두 기기 시뮬레이션: 각자 (mine, theirs) 순서가 달라도 정준 순서로 같은 결과
  const d1 = canonMerge(base, a, b);
  const d2 = canonMerge(base, b, a);
  if (d1 !== d2) { fails++; console.log('비수렴', JSON.stringify([base, a, b, d1, d2])); if (fails > 5) break; }

  if (!isSubseq(base, d1)) { fails++; console.log('base 유실', JSON.stringify([base, a, b, d1])); if (fails > 5) break; }
  if (!isSubseq(a, d1)) { fails++; console.log('a 유실', JSON.stringify([base, a, b, d1])); if (fails > 5) break; }
  if (!isSubseq(b, d1)) { fails++; console.log('b 유실', JSON.stringify([base, a, b, d1])); if (fails > 5) break; }
}
console.log(fails === 0 ? `무작위 ${N}건: 수렴성·무손실 전부 통과` : `실패 ${fails}건`);
process.exit(fails ? 1 : 0);
