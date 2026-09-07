#!/usr/bin/env node
// Offline real-editor smoke/visual fixture. Dependencies/setup in docs/pdf_import_quality.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.env.SDY_BENCH_OUT || 'import_uploads/visual/smoke');
const python = process.env.SDY_PYTHON || (fs.existsSync(path.join(root,'.venv/bin/python')) ? path.join(root,'.venv/bin/python') : 'python3');
const katex = process.env.SDY_REVIEW_KATEX || path.join(root,'import_uploads/visual/katex/dist');
if (!fs.existsSync(path.join(katex,'katex.min.js'))) {
  console.error('Set SDY_REVIEW_KATEX to a local KaTeX 0.16.11 dist/ directory (matching sdynotes.html). See docs/pdf_import_quality.md.');
  process.exit(2);
}
fs.mkdirSync(out,{recursive:true});
const pdf = path.join(out,'synthetic.pdf');
const run = (cmd,args,env=process.env) => execFileSync(cmd,args,{cwd:root,env,stdio:'inherit',timeout:180_000});
run(python,['test/import_pdf_fixture.py',pdf]);
run(python,['scripts/import-visual-fixture.py','--out',out,pdf+':1,2']);
run(process.execPath,['scripts/import-visual-review.mjs',path.join(out,'manifest.json')],{
  ...process.env, SDY_REVIEW_KATEX:katex, SDY_REVIEW_EXPORT:process.env.SDY_REVIEW_EXPORT||'1',
});
console.log(`PDF browser smoke PASS; inspect originals, editor, high-res and exports: ${out}`);
