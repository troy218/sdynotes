// 14.65 · 폴더 색·아이콘을 바꾸면 '그 자리에서' 보여야 한다.
//
// 사용자 신고: "폴더색 바꾸기를 한 후에 엔터를 누르면 바로 반영이 안 되고
//              나중에 새로고침해야 나타남."
//
// 원인 두 가지 — 둘 다 다시 생기지 않게 잡는다.
//   ① 홈 그리드는 _gridSig() 가 같으면 다시 그리지 않는다. 그런데 그 시그니처가
//      폴더의 색·아이콘·잠금을 안 봤다 → 색만 바뀌면 '변화 없음'으로 판단해
//      옛 카드가 그대로 남았다 (새로고침하면 새로 그려져서 나타났다).
//   ② 프로 사이드바 폴더 목록(paintProSide)은 색 변경 경로에서 아예 안 불렸다.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const home = read('src/app/02c-home-stack.js');
const search = read('src/app/02b-search.js');
const bundle = read('sdynotes.js');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

console.log('폴더 색 즉시 반영 계약\n');

// ① 시그니처가 폴더 카드에 그려지는 것을 전부 담고 있는가
const sig = home.slice(home.indexOf('function _gridSig()'), home.indexOf('function _gridSig()') + 900);
check('시그니처에 폴더 색이 들어 있다', /f\.color/.test(sig));
check('시그니처에 폴더 아이콘이 들어 있다', /f\.icon/.test(sig));
check('시그니처에 잠금 상태가 들어 있다', /isFolderLocked\(f\.id\)/.test(sig));
check('시그니처에 폴더 이름·개수도 그대로 있다', /f\.name/.test(sig) && /folderCount\(f\.id\)/.test(sig));

// ② 다시 그릴 필요가 없어도 사이드바는 맞춘다
const grid = home.slice(home.indexOf('function renderGrid(force)'), home.indexOf('function renderGrid(force)') + 1200);
check('renderGrid 는 건너뛸 때도 사이드바를 갱신한다',
  /sig===_lastGridSig[\s\S]{0,600}?paintProSide\(\)/.test(grid));

// ③ 색·아이콘·이름 변경 경로가 두 화면을 함께 갱신한다
check('공용 갱신 함수가 홈 그리드와 사이드바를 모두 다시 그린다',
  /function refreshFolderLook\(\)\{[\s\S]{0,220}?renderGrid\(\)[\s\S]{0,220}?paintProSide\(\)/.test(search));
check('색 변경이 공용 갱신 함수를 부른다',
  /function pickFolderColor\(c\)\{[\s\S]{0,400}?refreshFolderLook\(\)/.test(search));
check('아이콘 변경도 공용 갱신 함수를 부른다',
  /function pickFolderIcon\(ic\)\{[\s\S]{0,400}?refreshFolderLook\(\)/.test(search));
check('이름 변경도 두 화면에 바로 반영된다',
  /function renameFolder\(fid\)\{[\s\S]{0,500}?refreshFolderLook\(\)/.test(search));
check('폴더 잠금/해제도 사이드바를 다시 그린다',
  (home.match(/paintProSide\(\)/g) || []).length >= 3);

// ④ 번들에도 들어 있다 (소스만 고치고 번들을 안 만들면 화면은 그대로다)
check('번들에 refreshFolderLook 이 들어 있다', bundle.includes('function refreshFolderLook('));
check('번들 _gridSig 에 f.color 가 들어 있다',
  /function _gridSig\(\)\{[\s\S]{0,700}?f\.color/.test(bundle));

console.log(`\n폴더 색 즉시 반영 계약 — ${pass}개 항목 통과`);
