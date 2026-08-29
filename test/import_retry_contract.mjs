/* 가져온(대용량) 문서 '첫 슬라이스 실패'가 영구 차단이 되지 않도록 하는 계약.

   사용자가 겪던 일:
     본문을 못 받았다는 메시지가 순간 네트워크·서버 재시작·느린 응답 뒤에도
     새로고침 전까지 계속 남아, 저장/동기화가 계속 막히는 일이 잦았다.

   여기서는 소스 계약으로
     ① 실패를 __blockedNB 에 남기되 영구 Set 가 아니라 재시도 가능한 상태로 남기고
     ② 성공 시 _importLoaded 가 해당 노트의 블록·__loadFailed 를 해제하며
     ③ fetchSlice 가 무한 대기하지 않도록 타임아웃을 갖고
     ④ 온라인/복귀/주기 재시도가 있는지
   를 확인한다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

// ① 영구 Set(세션 막음) 대신 Map 기반 mark/clear 헬퍼
assert.match(js, /function _nbMarkBlocked\(id\)\{/,
  'there must be a mark-block helper for imported-doc fetch failures');
assert.match(js, /window\.__blockedNB=window\.__blockedNB\|\|new Map\(\)/,
  'the block registry must be a Map (timestamped/retryable), not a session Set');
assert.match(js, /function _nbClearBlocked\(id\)\{/,
  'successful slice loads must be able to clear the block');
assert.match(js, /function _nbBlocked\(id\)\{/,
  'flags must be read through a helper that handles the registry');
assert.match(js, /function _importLoaded\(d,nbId\)\{[\s\S]{0,700}?d\)?\s*\.__loadFailed=false/,
  'loading real pages must clear doc.__loadFailed');
assert.match(js, /function _armBlockedImportRetry\(\)\{/,
  'a blocked note must schedule a fresh retry instead of waiting for reload');

// ② loadDocAsync 는 잠글 때 Set 에 덧붙이지 않고 봉인+재시도 어엄을 건다
assert.doesNotMatch(js, /window\.__blockedNB\.add\(nbId\)/,
  'loadDocAsync must not permanently add to a session Set');
assert.match(js, /_nbMarkBlocked\(nbId\);/,
  'loadDocAsync must mark the note blocked through the retryable helper');
assert.match(js, /_armBlockedImportRetry\(\);/,
  'loadDocAsync must arm a background retry on failure');
assert.match(js, /firstSliceFailed=true;/,
  'loadDocAsync must remember only real first-slice failures');
assert.match(js, /firstSliceFailed\) d\.__loadFailed=true;/,
  'a successfully-fetched but blank first slice must not be treated as a failed body');

// ③ 슬라이스 요청은 타임아웃으로 끝이 나게 한다 (느린 응답이 재시도 기회를 막지 않게)
assert.match(js, /async function fetchSlice\(ms, ref, s0, total\)\{/,
  'fetchSlice must take a timeout argument');
assert.match(js, /new AbortController\(\)/,
  'fetchSlice must use AbortController for the timeout');

// ④ 성공 경로(loadBatch / startSlicePrefill / retryPage)마다 블록을 푼다
assert.match(js, /_importLoaded\(d, curNB&&curNB\.id\);/,
  'a successful batch/slice fill must clear the block');

// ⑤ 동기화 저장도 영구 차단이 아니라 복구 재시도를 건다
assert.doesNotMatch(js, /window\.__blockedNB&&window\.__blockedNB\.has\(p\.id\)/,
  'flushSync must use the retryable helper, not the old Set');
assert.match(js, /if\(_nbBlocked\(p\.id\)\)\{/,
  'flushSync must read the block through _nbBlocked');
assert.match(js, /_armBlockedImportRetry\(\);/,
  'flushSync/save guards must schedule a retry when they skip a save');

console.log('Import-retry contract: first-slice failure is retryable, not a permanent block.');
