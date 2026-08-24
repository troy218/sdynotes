// 협업 편집 프로토콜 수렴 시뮬레이션
// - 두 기기(A,B)가 같은 상자를 동시에 편집
// - 서버는 prevRev가 갈린 요소를 __base(공통 조상) 기반 3-way 병합
// - 각 기기도 원격 op를 같은 규칙으로 병합(rebase)
// 검증: 여러 라운드 뒤 양 기기가 같은 내용으로 수렴하고, 양쪽 편집이 모두 남는다.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'sdynotes.js'), 'utf8');
const s = html.indexOf('function _sdyUnits');
const e = html.indexOf('function _elById');
const o = {};
new Function('o', html.slice(s, e) + '; Object.assign(o,{_sdyUnits,_sdyDiff,_sdyResolve,_sdyApplyHunks,_sdyMerge3,mergeText3});')(o);
const { mergeText3 } = o;

// 프런트 _tbMergeRemote 의 순수 결정 로직 미러
function deviceMerge(base, mine, theirs) {
  if (base === undefined || mine === base) return { merged: theirs };
  if (Math.max(base.length, mine.length, theirs.length) > 20000) return { merged: theirs };
  const lo = mine <= theirs ? mine : theirs, hi = mine <= theirs ? theirs : mine;
  return { merged: mergeText3(base, lo, hi) };
}

function rnd(n) { let s = ''; for (let i = 0; i < n; i++) s += 'abc '[Math.floor(Math.random() * 4)]; return s; }

let fails = 0;
const N = 1500;
for (let t = 0; t < N; t++) {
  const base0 = rnd(1 + Math.floor(Math.random() * 8)).trim() || 'x';
  // 서버 상태: {html, rev}
  const srv = { html: base0, rev: 1000 };
  // 두 기기 상태: {mine, base, pushedRev}
  const A = { mine: base0, base: base0, rev: 0 };
  const B = { mine: base0, base: base0, rev: 0 };
  // 각 기기의 첫 편집 (동시에 다른 내용)
  const a1 = A.mine + 'A';
  const b1 = B.mine + 'B';
  A.mine = a1; B.mine = b1;
  // A push (rev 1001), 이어서 B의 prevRev=1000 push가 오면 서버가
  // base0/A/B를 병합해 둘 다 보존한 rev 1002를 반환한다.
  A.rev = 1001; srv.html = a1; srv.rev = 1001; A.base = a1;
  const lo = a1 <= b1 ? a1 : b1, hi = a1 <= b1 ? b1 : a1;
  B.rev = 1002; srv.html = mergeText3(base0, lo, hi); srv.rev = 1002;
  B.mine = srv.html; B.base = srv.html; // B는 서버의 병합 응답으로 재기반

  // A가 병합된 서버 값을 pull하고 양쪽이 수렴하는지 반복 확인
  for (let round = 0; round < 4; round++) {
    // A pull: srv.rev > A.rev → 원격 theirs=srv.html
    if (srv.rev > A.rev) {
      const r = deviceMerge(A.base, A.mine, srv.html);
      A.mine = r.merged; A.base = srv.html; A.rev = srv.rev;
      // A 재푸시 (rev 상승)
      A.rev = srv.rev + 1; srv.html = A.mine; srv.rev = A.rev; A.base = A.mine;
    }
    // B pull
    if (srv.rev > B.rev) {
      const r = deviceMerge(B.base, B.mine, srv.html);
      B.mine = r.merged; B.base = srv.html; B.rev = srv.rev;
      B.rev = srv.rev + 1; srv.html = B.mine; srv.rev = B.rev; B.base = B.mine;
    }
  }
  if (A.mine !== B.mine) { fails++; console.log('비수렴', JSON.stringify([base0, a1, b1, A.mine, B.mine])); if (fails > 5) break; }
  if (A.mine !== srv.html) { fails++; console.log('서버 불일치', JSON.stringify([base0, A.mine, srv.html])); if (fails > 5) break; }
  // 양쪽 편집 모두 반영 (추가분 'A'/'B'가 살아 있는지)
  if (!A.mine.includes('A') || !A.mine.includes('B')) { fails++; console.log('편집 유실', JSON.stringify([base0, a1, b1, A.mine])); if (fails > 5) break; }
}
console.log(fails === 0 ? `프로토콜 ${N}건: 두 기기 수렴 + 양쪽 편집 보존 전부 통과` : `실패 ${fails}건`);
process.exit(fails ? 1 : 0);
