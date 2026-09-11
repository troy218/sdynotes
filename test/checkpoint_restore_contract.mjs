/* 14.65 · 되돌리기 지점(체크포인트) '복원' 입구 계약

   사용자 질문: "지점 저장 기능은 있는데 복원 기능은 없는 거니?"

   실은 복원 엔진(restoreCheckpoint)과 목록 모달(#cpModal)은 처음부터 있었지만
   **여는 버튼이 어디에도 없었다** — 목록을 여는 유일한 호출이 모달 안의
   '지금 상태 저장' 버튼뿐이라(그것도 모달이 열려 있어야 눌린다) 사용자는
   저장만 하고 되돌릴 수 없었다. 그래서

     · 더보기 → 노트 구역에 '지점 복원' 버튼(openCheckpoints)을 넣고,
     · 그 입구가 사라지지 않게 여기서 고정한다.

   실행: node test/checkpoint_restore_contract.mjs   (npm run test:checkpoint) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const pass = [];
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` → ${extra}` : ''));
  pass.push(name); console.log('  ✓ ' + name);
};

const html = read('sdynotes.html');
const tools = read('src/app/09-tools-ui.js');
const bundle = read('sdynotes.js');

console.log('\n── ① 저장·복원 엔진이 살아 있다 ───────────────────────────');
check('makeCheckpoint 가 소스에 있다', /async function makeCheckpoint\(\)/.test(tools));
check('openCheckpoints 가 소스에 있다', /async function openCheckpoints\(\)/.test(tools));
check('restoreCheckpoint 가 소스에 있다', /async function restoreCheckpoint\(i\)/.test(tools));
check('지점은 IndexedDB(sdy_cp)에 노트별로 보관한다', /indexedDB\.open\('sdy_cp',1\)/.test(tools)
  && /cpPutAll\(curNB\.id,l\)/.test(tools));

console.log('\n── ② 복원 엔진이 실제로 문서를 되돌린다 ───────────────────');
check('목록의 되돌리기 버튼이 restoreCheckpoint(i) 를 부른다',
  /onclick="restoreCheckpoint\(\$\{i\}\)"/.test(tools));
check('되돌리기는 되돌리기(Ctrl+Z)용 히스토리를 남긴다', /pushHistory\(true\)/.test(tools));
check('동기화용 Map 도 함께 되살린다', /reviveDocMaps\(keep\)/.test(tools));
check('되돌린 뒤 다시 그려 저장하고 창을 닫는다',
  /renderPages\(\); saveDoc\(\); closeCheckpoints\(\);/.test(tools));

console.log('\n── ③ 목록을 여는 입구가 있다(사용자 보고 지점) ─────────────');
const openers = [...html.matchAll(/onclick="[^"]*openCheckpoints\(\)[^"]*"/g)].map(m => m[0]);
check("더보기 노트 구역에 '지점 복원' 버튼이 있다", openers.some(o => /mi\(/.test(o)), openers.join(' | '));
check('저장 버튼 옆에 나란히 있다(찾기 쉽게)',
  /지점 저장<\/span><\/button>[\s\S]{0,260}openCheckpoints\(\)[\s\S]{0,80}지점 복원/.test(html));
check('모달 안에도 다시 저장하는 버튼이 있다', /onclick="makeCheckpoint\(\);openCheckpoints\(\);"/.test(html));
check('목록 상자는 #cpList, 모달은 #cpModal', /id="cpModal"/.test(html) && /id="cpList"/.test(html));

console.log('\n── ④ 번들에도 그대로 실린다(인라인 onclick 이 닿는다) ──────');
check('번들에 makeCheckpoint 가 있다', /async function makeCheckpoint\(\)/.test(bundle));
check('번들에 openCheckpoints 가 있다', /async function openCheckpoints\(\)/.test(bundle));
check('번들에 restoreCheckpoint 가 있다', /async function restoreCheckpoint\(i\)/.test(bundle));
check('최근 5개까지만 보관한다', /l=l\.slice\(0,5\);/.test(tools));

console.log(`\n지점 저장·복원 계약 — ${pass.length}개 항목 통과`);
