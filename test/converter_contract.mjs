import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const converter = read('worker/sdynotes_worker/converter.py');
const access = read('server/src/lib/converterAccess.js');
const route = read('server/src/routes/converter.js');
const apply = read('apply.sh');
const page = read('converter.html');
const browser = read('converter.js');

for (const file of ['converter.html', 'converter.css', 'converter.js',
  'server/src/lib/converterAccess.js', 'server/src/routes/converter.js',
  'worker/sdynotes_worker/converter.py']) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} missing`);
}

// The standalone UI uses relative converter APIs and never boots SDYnotes,
// auth, or the notes storage in a second tab.
assert.match(browser, /\/api\/converter\/convert/);
assert.doesNotMatch(page, /sdynotes\.js|src\/auth\.js|localStorage/);
assert.match(browser, /\/api\/converter\/status/);
assert.doesNotMatch(browser, /localhost|127\.0\.0\.1/);

// Host isolation is explicit and includes both names mentioned for production.
assert.match(access, /converter\.sdynotes\.duckdns\.org/);
assert.match(access, /latexripper\.sdynotes\.duckdns\.org/);
assert.match(access, /SDY_CONVERTER_HOSTS/);
assert.match(route, /onlyConverter/);
assert.match(read('server/src/index.js'), /isConverterHost/);

// One parser source of truth: the DOCX layer calls the existing importer
// instead of copying or reimplementing PDF extraction.
assert.match(converter, /from \. import importer as _engine/);
assert.match(converter, /_engine\._imp_convert_pdf\(/);
assert.doesNotMatch(converter, /page\.get_text\(/);
assert.match(apply, /converter\.html/);
assert.match(apply, /converter\.css/);
assert.match(apply, /converter\.js/);

console.log('converter contract: ok');
