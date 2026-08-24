import fs from 'node:fs';
import assert from 'node:assert/strict';

const js=fs.readFileSync(new URL('../sdynotes.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../sdynotes.css',import.meta.url),'utf8');

assert.match(js,/window\.sdyClampFloatingRect\s*=\s*function/,'shared floating-window clamp must exist');
assert.ok((js.match(/sdyClampFloatingRect\(/g)||[]).length>=8,'all floating windows should use the shared clamp');
assert.doesNotMatch(js,/Math\.max\(-300,Math\.min\(innerWidth\+300/,'windows must not be allowed 300px outside the viewport');
assert.doesNotMatch(js,/id='bbEgg'|getElementById\('bbEgg'\)|쫄라맨 야구/,'baseball easter egg JS must be removed');
assert.doesNotMatch(css,/#bbEgg|#bbTap/,'baseball easter egg CSS must be removed');
assert.match(js,/recentTitle\.textContent='최근 편집'/,'home should label the recently edited notes');
assert.doesNotMatch(js,/_homeScrollBottom\(false\)/,'home entry must not auto-scroll the create button under the sticky header');
console.log('floating window bounds and home layout contract: ok');
