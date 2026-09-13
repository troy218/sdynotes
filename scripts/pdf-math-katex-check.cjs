// KaTeX 검증: /tmp/scan4_out.json 의 모든 latex 를 throwOnError 로 렌더링해본다.
const fs = require('fs');
const katex = require(process.env.KATEX_PATH || '/tmp/katex-check/node_modules/katex');
const data = JSON.parse(fs.readFileSync((process.argv[2] || '/tmp/pdf_math_scan.json'), 'utf8'));
const out = {};
for (const [file, r] of Object.entries(data)) {
  const fails = [], stats = {total: 0, fail: 0, uni: 0};
  for (const [pno, pg] of Object.entries(r.pages)) {
    for (const e of (pg.latex || [])) {
      stats.total++;
      if (e.unicode) stats.uni++;
      try {
        katex.renderToString(e.latex, {throwOnError: true, strict: 'ignore', displayMode: !!e.display});
      } catch (err) {
        stats.fail++;
        if (fails.length < 30) fails.push({page: +pno + 1, latex: e.latex.slice(0, 160), err: String(err.message).slice(0, 120)});
      }
    }
  }
  out[file] = {stats, fails};
  console.log(`== ${file}: total=${stats.total} katex_fail=${stats.fail} unicode=${stats.uni}`);
  for (const f of fails.slice(0, 10)) console.log(`   p${f.page} ERR ${f.err}\n      ${f.latex}`);
}
fs.writeFileSync('/tmp/pdf_math_katex.json', JSON.stringify(out, null, 1));
