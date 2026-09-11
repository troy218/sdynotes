// 14.65 · 지점 저장(checkpoint)에 '복원' 이 실제로 이어져 있는지 지키는 계약.
//
// 사용자 신고: "지점저장 기능은 있는데 복원 기능은 있는지?"
//   → 복원 엔진(restoreCheckpoint)은 예전부터 있었는데 **입구가 없었다**.
//     이제 더보기 > 노트 > '지점 복원' 으로 들어간다. 그 연결이 끊기지 않게 잡는다.
//
// 검사 항목
//   ① HTML: 노트 섹션에 openCheckpoints() 를 부르는 입구가 있다
//   ② HTML: 지점 모달(#cpModal)과 목록(#cpList) 이 있다
//   ③ JS  : 저장/열기/복원 3함수가 살아 있다
//   ④ JS  : 복원은 되돌리기(undo)·문서 되살리기·다시 그리기·저장·닫기 를 모두 지난다
//   ⑤ 번들: sdynotes.js 에 같은 코드가 들어 있다 (인라인 onclick 이 부르는 대상)
//   ⑥ 안전: 지점은 5개까지만 보관한다
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'sdynotes.html'), 'utf8');
const tools = fs.readFileSync(path.join(ROOT, 'src/app/09-tools-ui.js'), 'utf8');
const bundle = fs.readFileSync(path.join(ROOT, 'sdynotes.js'), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

console.log('지점 저장·복원 계약\n');

// ① 입구 — 예전에는 makeCheckpoint 를 부르는 곳만 있고 openCheckpoints 를 부르는 곳이 없었다
check('HTML: 노트 섹션에 복원 입구가 있다 (onclick=openCheckpoints)',
  /onclick="mi\(\(\)=>openCheckpoints\(\)\)"/.test(html));
check('HTML: 입구 이름이 \'지점 복원\' 이다', /지점 복원/.test(html));
check('HTML: 저장 입구도 그대로 있다', /지점 저장/.test(html) && /makeCheckpoint\(\)/.test(html));

// ② 모달
check('HTML: 지점 모달(#cpModal)과 목록(#cpList)이 있다',
  /id="cpModal"/.test(html) && /id="cpList"/.test(html));
check('HTML: 모달에서 바로 저장할 수 있다', /id="cpModal"[\s\S]{0,1400}makeCheckpoint\(\)/.test(html));

// ③ 함수 3종
for (const fn of ['makeCheckpoint', 'openCheckpoints', 'restoreCheckpoint']) {
  check(`JS: ${fn} 이 살아 있다`, new RegExp(`function\\s+${fn}\\s*\\(|window\\.${fn}\\s*=`).test(tools));
}

// ④ 복원이 실제로 문서를 되돌리는 경로를 전부 지나는가
const restore = tools.slice(tools.indexOf('function restoreCheckpoint'));
check('JS: 복원은 되돌리기 지점을 남긴다 (pushHistory)', /pushHistory\(true\)/.test(restore.slice(0, 900)));
check('JS: 복원은 문서를 실제로 되살린다 (reviveDocMaps + renderPages)',
  /reviveDocMaps\(/.test(restore.slice(0, 1200)) && /renderPages\(/.test(restore.slice(0, 1200)));
check('JS: 복원 뒤 서버·로컬에 저장한다 (saveDoc)', /saveDoc\(/.test(restore.slice(0, 1400)));
check('JS: 복원하면 모달을 닫는다 (closeCheckpoints)', /closeCheckpoints\(\)/.test(restore.slice(0, 1600)));
check('JS: 목록의 각 지점에 되돌리기 버튼이 붙는다',
  /restoreCheckpoint\(/.test(tools) && /되돌리기/.test(tools));

// ⑤ 번들 — 인라인 onclick 은 번들의 함수를 부른다
for (const fn of ['makeCheckpoint', 'openCheckpoints', 'restoreCheckpoint']) {
  check(`번들: ${fn} 이 들어 있다`, bundle.includes(`function ${fn}(`));
}

// ⑥ 보관 개수 상한
check('JS: 지점은 5개까지만 보관한다',
  /makeCheckpoint[\s\S]{0,400}?l=l\.slice\(0,5\)/.test(tools));

console.log(`\n지점 저장·복원 계약 — ${pass}개 항목 통과`);
