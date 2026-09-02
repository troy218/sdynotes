import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

// These ordering guarantees prevent the two data-loss cases that matter for a
// contenteditable text box: saving before its input debounce fires, and losing
// an in-flight server write when the page is closed/backgrounded.
const ctrlSave = html.match(/if\(e\.ctrlKey&&\(e\.key==='s'\|\|e\.key==='S'\)\)\{([\s\S]{0,900}?)\n        \}/);
assert.ok(ctrlSave, 'Ctrl+S handler should exist');
assert.ok(ctrlSave[1].indexOf('commitEditingText()') < ctrlSave[1].indexOf('flushSaveDoc()'),
  'Ctrl+S must commit active contenteditable text before serializing the document');
assert.equal(ctrlSave[1].includes("toast('저장됨 ✓'"), false,
  'Ctrl+S must not claim success before the server write result');
assert.ok(ctrlSave[1].includes('flushSync({manual:true})'),
  'Ctrl+S should request explicit save feedback, while autosave stays quiet');

const saveDoc = html.match(/function saveDoc\(\)\{([\s\S]{0,1200}?)\n    \}/);
assert.ok(saveDoc, 'saveDoc should exist');
assert.equal(saveDoc[1].includes("setSaveState('저장 중...')"), false,
  'autosave should not flash a saving banner on every change');

const sync = html.match(/async function flushSync\(\)\{([\s\S]*?)\n    \}\n\n    \/\/ ============ 페이지 렌더/);
assert.ok(sync, 'flushSync should exist');
const durableAt = sync[1].indexOf('jobs.forEach(enqueue);');
const onlineAt = sync[1].indexOf('if(!isOnline())');
const sendAt = sync[1].indexOf('await runJob(j)');
assert.ok(durableAt >= 0 && durableAt < onlineAt && durableAt < sendAt,
  'a sync job must be persisted to the outbox before any network send');
assert.match(sync[1], /await runJob\(j\)\) acknowledgeJob\(j\)/,
  'only an acknowledged server write may be removed from the outbox');

const outbox = html.match(/async function flushOutbox\(silent\)\{([\s\S]*?)\n    \}\n\n    function queueSync/);
assert.ok(outbox, 'flushOutbox should exist');
assert.match(outbox[1], /if\(await runJob\(j\)\)\{ acknowledgeJob\(j\); sent\+\+; \}/,
  'outbox retries should remove each item only after its own acknowledgement');
assert.equal(outbox[1].includes('saveOutbox(rest);'), false,
  'an old outbox snapshot must not overwrite edits queued during an in-flight retry');

console.log('Save outbox contract: active text commit and durable-before-send guarantees verified.');
