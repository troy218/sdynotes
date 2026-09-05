import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

// 14.15 · 노트를 빠르게 연속 전환할 때 이전 노트의 저장이 새 노트에 들어가지 않는
// 필수 가드가 코드에 남아 있는지 확인한다. 소스 계약이 깨지면 아래 assert 가 실패한다.

assert.match(js, /let _sdyOpenSeq=0, _docId=null, _saveNoteId=null;/,
  '빠른 전환 가드 변수(openSeq/_docId/_saveNoteId)가 선언되어야 한다');

const saveDoc = js.match(/function saveDoc\(\)\{\n([\s\S]*?)\n        _saveTimer=setTimeout\(flushSaveDoc,400\);\n    \}/);
assert.ok(saveDoc, 'saveDoc should exist');
const saveBody = saveDoc[1];
assert.ok(saveBody.indexOf('if(_docId && _docId!==curNB.id) return;') < saveBody.indexOf("_saveNoteId=curNB.id;"),
  'saveDoc must abort when the loaded doc is not for the currently opened note before scheduling the debounce');
assert.match(saveBody, /_saveNoteId=curNB\.id;/,
  'saveDoc must capture which note the pending save belongs to');

const flush = js.match(/function flushSaveDoc\(\)\{\n([\s\S]*?)\n        persistDoc\(curNB.id,doc\);/);
assert.ok(flush, 'flushSaveDoc should exist');
assert.match(flush[1], /if\(_saveNoteId && _saveNoteId!==curNB\.id\)\{ _saveNoteId=null; return; \}/,
  'flushSaveDoc must drop a save that was scheduled for a previous note during a fast switch');
assert.match(flush[1], /if\(_docId && _docId!==curNB\.id\)\{ _saveNoteId=null; return; \}/,
  'flushSaveDoc must not serialize a doc that does not belong to the current note');

const openNB = js.match(/async function openNB\(nb\)\{([\s\S]*?)\n        openNav\(closeEditor\);/);
assert.ok(openNB, 'openNB should exist');
const openBody = openNB[1];
assert.match(openBody, /const openSeq=\+\+_sdyOpenSeq;/,
  'openNB must stamp a sequence so a superseded open can be cancelled');
const guardCount = (openBody.match(/openSeq!==_sdyOpenSeq/g) || []).length;
assert.ok(guardCount >= 5,
  `openNB must re-check the sequence after every await (found ${guardCount} guards)`);
assert.match(openBody, /const openedId=nb\.id;/,
  'openNB must remember the target id and compare against it after awaits');
assert.match(openBody, /doc=loadedDoc; _docId=nb\.id;/,
  'only the still-current open may install its doc');

// 18.10 렌더러가 저장 마크업을 decodeTextMarkup 으로 풀도록 바뀌었다(예전은
// el.html 을 그대로 innerHTML 에 꽂았다). 소스 계약은 '반드시 남아야 할 가드'
// 만 보는 것이므로, 이 렌더 호출 형태가 바뀌어도 아래 가드가 남아 있는지 검사한다.
const buildText = js.match(/function buildTextEl\(el,pageIdx\)\{([\s\S]{0,2600}?)\n        c\.innerHTML=decodeTextMarkup\((?:_normalizePaletteHtml\()?el\.html\|\|''\)?\);/);
assert.ok(buildText, 'buildTextEl should exist');
assert.match(buildText[1], /w\.dataset\.nbId=\(curNB&&curNB\.id\)\|\|'';/,
  'each text DOM must remember which notebook it was rendered for');
assert.match(buildText[1], /w\._sdyRv=doc&&doc\.__rv;/,
  'each text DOM must remember its render version');

const syncText = js.match(/function syncTextEl\(w\)\{([\s\S]*?)\n        el\.html=imathCollapse\(stripWF/);
assert.ok(syncText, 'syncTextEl should exist');
assert.match(syncText[1], /if\(!w\|\|!w\.isConnected\) return;/,
  'delayed text sync must ignore detached boxes');
assert.match(syncText[1], /curNB&&w\.dataset\.nbId&&curNB\.id!==w\.dataset\.nbId\) return;/,
  'delayed text sync must ignore a box rendered for a different note');
assert.match(syncText[1], /doc&&doc\.__rv!=null&&w\._sdyRv!=null&&doc\.__rv!==w\._sdyRv\) return;/,
  'delayed text sync must ignore a box from an earlier render version');

const commit = js.match(/function commitEditingText\(only\)\{([\s\S]{0,1200}?)\n        const list=/);
assert.ok(commit, 'commitEditingText should exist');
assert.match(commit[1], /if\(_docId && _docId!==curNB\.id\) return;/,
  'committing active text during note replacement must not write into the new note');

const startLive = js.match(/async function startLiveDocSync\(\)\{([\s\S]*?)\n        _syncGap=SYNC_FAST; _syncQuiet=0;\n        _armSync\(SYNC_FAST\);\n    \}/);
assert.ok(startLive, 'startLiveDocSync should exist');
assert.match(startLive[1], /doc!==d\|\|!curNB\|\|curNB\.id!==nid\) return;/
  || /doc!==d\|\|!curNB\|\|curNB\.id!==nid\) return;/,
  'startLiveDocSync must not apply a fetched version to a note switched after the request');

console.log('Editor fast-operations contract: note-id save/open guards verified.');
