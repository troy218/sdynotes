// 텍스트 3-way 병합 (협업 편집). sdynotes.html 의 14.9 협업 병합과 동일 로직.
// 서버가 이전 버전(prev)을 1개 보관하고, 두 기기가 같은 공통 조상에서 갈라진
// 텍스트 op 를 받으면 3-way 병합해 양쪽 편집을 모두 남긴다.

// HTML 을 '태그는 1단위, 글자는 1단위'로 쪼갠다 (태그를 반으로 자르지 않기 위함)
function sdyUnits(html) {
  const units = [];
  let buf = '';
  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end >= 0) {
        if (buf) { for (const c of buf) units.push(c); buf = ''; }
        units.push(html.slice(i, end + 1));
        i = end;
      } else buf += ch;
    } else buf += ch;
  }
  if (buf) for (const c of buf) units.push(c);
  return units;
}

// base → v 의 편집 연산(들). 각 연산: {pos, del, ins[]} (base 기준, 겹치지 않음)
function sdyDiff(base, v) {
  const n = base.length, m = v.length;
  let p = 0;
  while (p < n && p < m && base[p] === v[p]) p++;
  let s = 0;
  while (s < n - p && s < m - p && base[n - 1 - s] === v[m - 1 - s]) s++;
  const bm = base.slice(p, n - s), vm = v.slice(p, m - s);
  const n2 = bm.length, m2 = vm.length;
  const dp = Array.from({ length: n2 + 1 }, () => new Int32Array(m2 + 1));
  for (let i = n2 - 1; i >= 0; i--)
    for (let j = m2 - 1; j >= 0; j--)
      dp[i][j] = bm[i] === vm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n2 && j < m2) {
    if (bm[i] === vm[j]) { i++; j++; continue; }
    const st = i, tj = j;
    while (i < n2 && j < m2 && bm[i] !== vm[j]) {
      if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
    ops.push({ pos: p + st, del: i - st, ins: vm.slice(tj, j) });
  }
  if (i < n2) ops.push({ pos: p + i, del: n2 - i, ins: [] });
  else if (j < m2) ops.push({ pos: p + i, del: 0, ins: vm.slice(j) });
  // 인접한 '삭제'와 '삽입'을 하나의 '교체' hunk 로 합친다
  const norm = [];
  for (const o of ops) {
    if (!o.del && !o.ins.length) continue;
    if (norm.length) {
      const last = norm[norm.length - 1];
      if (last.del > 0 && last.ins.length === 0 && o.del === 0 && o.pos === last.pos + last.del) {
        last.ins = o.ins.slice(); continue;
      }
      if (last.del === 0 && o.del > 0 && o.pos === last.pos) {
        last.del = o.del; continue;
      }
    }
    norm.push({ pos: o.pos, del: o.del, ins: o.ins.slice() });
  }
  return norm;
}

function sdyResolve(a, b) {
  const A = a.join(''), B = b.join('');
  return A <= B ? a.concat(b) : b.concat(a);
}

function sdyApplyHunks(base, start, end, hunks, fromIdx) {
  const out = [];
  let p = start, k = fromIdx;
  while (k < hunks.length && hunks[k].pos < end) {
    const h = hunks[k++];
    const delStart = Math.max(start, h.pos);
    const delEnd = Math.min(end, h.pos + h.del);
    out.push(...base.slice(p, delStart));
    out.push(...h.ins);
    p = delEnd;
  }
  out.push(...base.slice(p, end));
  return out;
}

function sdyMerge3(o, a, b) {
  const ha = sdyDiff(o, a), hb = sdyDiff(o, b);
  const res = [];
  let pos = 0, i = 0, j = 0;
  while (i < ha.length || j < hb.length) {
    const A = i < ha.length ? ha[i] : null;
    const B = j < hb.length ? hb[j] : null;
    if (A && (!B || A.pos + A.del <= B.pos)) {
      res.push(...o.slice(pos, A.pos)); res.push(...A.ins);
      pos = A.pos + A.del; i++; continue;
    }
    if (B && (!A || B.pos + B.del <= A.pos)) {
      res.push(...o.slice(pos, B.pos)); res.push(...B.ins);
      pos = B.pos + B.del; j++; continue;
    }
    const start = Math.min(A.pos, B.pos);
    let end = Math.max(A.pos + A.del, B.pos + B.del);
    const i0 = i, j0 = j;
    for (;;) {
      let ext = false;
      while (i < ha.length && ha[i].pos < end) { end = Math.max(end, ha[i].pos + ha[i].del); i++; ext = true; }
      while (j < hb.length && hb[j].pos < end) { end = Math.max(end, hb[j].pos + hb[j].del); j++; ext = true; }
      if (!ext) break;
    }
    const ca = sdyApplyHunks(o, start, end, ha, i0);
    const cb = sdyApplyHunks(o, start, end, hb, j0);
    res.push(...o.slice(pos, start));
    res.push(...(ca.join('') === cb.join('') ? ca : sdyResolve(ca, cb)));
    pos = end;
  }
  res.push(...o.slice(pos));
  return res;
}

// 3-way 병합. base=공통 조상. 결과는 결정적(deterministic).
export function mergeText3(baseHtml, mineHtml, theirsHtml) {
  const o = sdyUnits(baseHtml || ''), a = sdyUnits(mineHtml || ''), b = sdyUnits(theirsHtml || '');
  return sdyMerge3(o, a, b).join('');
}
