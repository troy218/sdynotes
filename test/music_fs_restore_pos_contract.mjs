// 음악 플레이어 전체화면 → 확장창 복귀 위치 계약
//   전체 화면에서 일반 확장 플레이어로 돌아올 때, 창이 고정된 위치(왼쪽 위)로
//   줄어들면 안 되고, 전체 화면이 되기 전의 자리로 돌아가야 한다.
//   복귀 경로의 clampMpb(화면 안 잡아두기)는 모핑(0.52s)이 끝난 뒤에 불려야
//   한다 — 모핑 중에는 창이 아직 100vw 라 clamp 가 (0,0)을 반환하기 때문.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const js = fs.readFileSync(path.join(root,'sdynotes.js'),'utf8');

let fail=0;
function ok(cond,msg){ if(!cond){ fail++; console.error('  ✗',msg);} else console.log('  ✓',msg); }

// 1) 복귀(else) 분기에 즉시 실행되는 requestAnimationFrame(clampMpb) 가 없어야 한다
//    (모핑 중 clamp 가 0,0 을 꽂던 버그). 복귀 분기 텍스트만 뽑아 검사한다.
const fakeFsIdx = js.indexOf('function mpbFakeFs(');
ok(fakeFsIdx>=0, 'mpbFakeFs 함수 존재');
const fakeFsBody = js.slice(fakeFsIdx, fakeFsIdx+2600);
const elseIdx = fakeFsBody.indexOf('}else{');
const restore = fakeFsBody.slice(elseIdx);
ok(!/requestAnimationFrame\(\s*\(\)\s*=>\s*\{[^}]*clampMpb/.test(restore),
   '복귀 분기: rAF 안에서 clampMpb 를 즉시 부르지 않는다 (모핑 중 0,0 방지)');

// 2) 대신 모핑이 끝난 뒤(setTimeout) 클램프가 불려야 한다
ok(/setTimeout\(\(\)\s*=>\s*\{[\s\S]{0,600}?clampMpb\(\)/.test(restore),
   '복귀 분기: 모핑 끝난 뒤 setTimeout 으로 clampMpb 실행');

// 3) 전체화면 직전 자리를 기억(_mpbPrePos)했다가 그 자리로 복원해야 한다
ok(/_mpbPrePos=\{x,y\}/.test(fakeFsBody), '전체화면 진입 시 직전 자리 저장');
ok(/const p=_mpbPrePos\|\|_mpbSavedPos\(\)/.test(restore), '복귀 시 저장한 자리 우선 사용');
ok(/mpbEl\.style\.left=Math\.round\(p\.x\)/.test(restore) && /mpbEl\.style\.top=Math\.round\(p\.y\)/.test(restore),
   '복귀 분기: 저장한 x/y 를 인라인 스타일로 복원');

// 4) 드래그 경로의 clampMpb 호출은 그대로 남아 있어야 한다 (창 이동범위 영향 없음)
ok(/function clampMpb\(\)\{/.test(js), 'clampMpb 함수 유지');
ok(js.includes('requestAnimationFrame(clampMpb)'), '창 열기 경로의 clampMpb 유지');
ok(/head\.addEventListener\('pointermove'[\s\S]{0,600}?sdyClampFloatingRect/.test(js),
   '드래그 중 공용 클램프(sdyClampFloatingRect) 유지 — 다른 창 이동범위 영향 없음');

// 5) 공용 FLOAT-BOUNDS 블록(다른 모든 창이 쓰는 클램프 자)은 손대지 않는다
ok(js.includes('/* FLOAT-BOUNDS:BEGIN */') && js.includes('/* FLOAT-BOUNDS:END */'),
   '공용 FLOAT-BOUNDS 클램프 블록 보존');

if(fail){ console.error(`\n✗ ${fail}개 실패`); process.exit(1); }
console.log('\n✓ music_fs_restore_pos_contract: ok');
