import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

// 14.16 · 두 가지 계약
//  ① Alt+휠(상자 배율)로 키운 글자 크기가 '상자'에 저장되고 툴바에도 반영되어
//     그 뒤 '+' 를 눌러도 도로 작아지지 않아야 한다.
//  ② 글꼴 목록의 미리보기 문구는 'abc 가나다' 다 ('한글' 은 넣지 않는다).

// ── ① scaleSelection : 글자 크기 저장 + 툴바 동기화 ─────────────────────────
const scale = js.match(/function scaleSelection\(f,items\)\{([\s\S]*?)\n    \}\n/);
assert.ok(scale, 'scaleSelection should exist');
const scaleBody = scale[1];

assert.match(scaleBody, /let lastFS=0;/,
  'scaleSelection must remember the font size it just changed');
const fsStore = scaleBody.match(/if\(el\.type==='text'\)\{\s*\n\s*el\.fontSize=Math\.max\(6,Math\.round\(\(el\.fontSize\|\|16\)\*f\)\);/);
assert.ok(fsStore, 'scaleSelection must store the scaled font size on the text element (even when it had none)');
assert.match(scaleBody, /c\.style\.fontSize=el\.fontSize\+'px';/,
  'scaleSelection must repaint the box content with the new font size');
assert.match(scaleBody, /if\(scaleInlineFS\(c,f\)\) el\.html=stripWF\(c\.innerHTML\);/,
  'partially sized inline text must be scaled too and written back to the element html');
assert.match(scaleBody, /if\(lastFS\) setToolbarFS\(lastFS\);/,
  'scaleSelection must hand the new font size to the toolbar so +/- continues from it');

assert.match(js, /function scaleInlineFS\(c,f\)\{[\s\S]{0,600}?sp\.style\.fontSize=Math\.max\(2,Math\.round\(v\*f\)\)\+'px';/,
  'scaleInlineFS must scale inline font-size styles by the same factor');

// ── ① 툴바 동기화 장치 ───────────────────────────────────────────────────
assert.match(js, /function setToolbarFS\(v\)\{[\s\S]{0,400}?if\(inp&&document\.activeElement!==inp\) inp\.value=v;/,
  'setToolbarFS must update the toolbar number box (unless the user is typing in it)');

const chFS = js.match(/function chFS\(d\)\{([\s\S]*?)\n    \}/);
assert.ok(chFS, 'chFS should exist');
assert.match(chFS[1], /if\(!hasInlineTextSel\(\)\) syncFSFromTarget\(\);/,
  'the +/- buttons must start from the size actually on screen (not a stale toolbar value)');

assert.match(js, /function hasInlineTextSel\(\)\{[\s\S]{0,700}?savedHost&&document\.body\.contains\(savedHost\)\)/,
  'a drag-selected run of text inside a box must keep its own size as the base');

const sync = js.match(/function syncFSFromTarget\(\)\{([^}]*)\}/);
assert.ok(sync, 'syncFSFromTarget should exist');
assert.match(sync[1], /setToolbarFS\(activeTextFS\(\)\)/,
  'syncFSFromTarget must read the active box/cell size');

// 상자를 집거나 편집에 들어갈 때도 툴바가 그 상자의 크기를 따라간다
const enterEdit = js.match(/function enterEdit\(w,keepSel\)\{([\s\S]*?)\n        const c=w\.querySelector\('\.tb-content'\);\n        c\.contentEditable/);
assert.ok(enterEdit, 'enterEdit should exist');
assert.match(enterEdit[1], /syncFSFromTarget\(\);/,
  'entering a box must sync the toolbar to that box font size');
const clickSel = js.match(/deselectAll\(true\); clearMulti\(\);\s*\n\s*tb\.classList\.add\('sel'\);\s*\n\s*selected=\{type:'text',el:tb\};\s*\n\s*syncFSFromTarget\(\);/);
assert.ok(clickSel, 'clicking a text box must sync the toolbar to that box font size');

// ── ② 글꼴 미리보기 문구 ────────────────────────────────────────────────
const build = js.match(/function buildFontMenu\(\)\{([\s\S]*?)\n        m\.dataset\.ready='1';/);
assert.ok(build, 'buildFontMenu should exist');
assert.match(build[1], /class="fi-sample" style="font-family:\$\{f\.css\}">abc 가나다</,
  'the font preview sample must read exactly "abc 가나다"');
assert.ok(build[1].indexOf('한글') < 0,
  'the font preview must not contain the word 한글');

console.log('Editor font-size contract: alt-scale keeps its size, preview reads "abc 가나다".');
