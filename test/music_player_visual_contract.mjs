import fs from 'node:fs';
import assert from 'node:assert/strict';

const css=fs.readFileSync(new URL('../sdynotes.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../sdynotes.html',import.meta.url),'utf8');

assert.match(html,/class="ri-search-line mp-search-icon"/,'lower-player search should have a dedicated search icon');
assert.match(css,/#mpBig \.mpb-tabs\{[\s\S]{0,180}background:transparent/,'expanded-player tabs should not have a surrounding fill');
assert.match(css,/#mpBig\.mpb-fs \.mpb-tabs,#mpBig:fullscreen \.mpb-tabs\{[\s\S]{0,180}background:transparent!important/,'fullscreen tab strip should remain transparent');
assert.match(css,/#mpBig\.mpb-fs \.mpb-tabs button,#mpBig:fullscreen \.mpb-tabs button\{[\s\S]{0,180}color:rgba\(255,255,255,\.88\)/,'fullscreen tab labels need high contrast');
assert.match(css,/#musicListPop \.mp-search\{[\s\S]{0,300}font-size:12px!important/,'desktop lower-player search text should be compact');
assert.doesNotMatch(css,/\/\* quick clean styling for library tabs and tools \*\//,'opaque legacy override must stay removed');
console.log('music player visual contract: ok');
