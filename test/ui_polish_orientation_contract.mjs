import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const importer = fs.readFileSync(new URL('../worker/sdynotes_worker/importer.py', import.meta.url), 'utf8');
const pass = [];
const check = (name, cond) => {
  assert.ok(cond, name);
  pass.push(name);
  console.log('  ✓ ' + name);
};

check('제목 공개는 깃털 아이콘의 직접 hover로 제한된다',
  css.includes('.app-brand .logo-dot:hover + h1') &&
  !css.includes('.app-brand:hover h1'));
check('깃털 아이콘은 키보드로도 초점을 받을 수 있다',
  /class="logo-dot"[^>]*tabindex="0"/.test(html));
check('접힌 노트 더미는 카드에 직접 들어갈 때만 펼친다',
  js.includes("stackWrap.addEventListener('mouseover',e=>{ if(stackCardAt(e)) fanIn(); });") &&
  !js.includes("upper.addEventListener('mouseenter',fanIn)"));
check('펼친 더미는 전체 선택 통로를 벗어날 때만 접힌다',
  js.includes("stackWrap.addEventListener('mouseleave',fanOut)"));
check('펼친 카드가 선택 통로 폭 안에 유지된다',
  js.includes('const corridorW=cw||') &&
  js.includes('corridorW-cardW-48'));
check('음악 목록의 검색 도구와 곡 영역에 둥근 내부 표면이 있다',
  /#musicListPop \.mp-library-tools\s*\{[^}]*border-radius:/s.test(css) &&
  /#musicListPop \.mp-lbody\s*\{[^}]*border-radius:/s.test(css));
check('설정 모달은 음악바보다 높은 레이어다',
  /\.modal-bg\{[^}]*z-index:1900/s.test(css));
check('문서 선택 작업판은 음악바보다 높은 레이어다',
  /\.select-bar\{[^}]*z-index:1900/s.test(css));
check('PDF 방향 판별기가 있다',
  /def _pdf_size_preset\(src\):/.test(importer));
check('Word 방향 판별기가 있다',
  /def _docx_size_preset\(data\):/.test(importer));
check('가로 문서는 1100×800 좌표계로 변환된다',
  /a4_landscape[^\n]+1100[^\n]+800/.test(importer));
check('PDF 본 변환과 안전 재변환 모두 선택된 좌표계를 전달한다',
  importer.includes('_imp_convert_pdf(src, jid, target_w, target_h)') &&
  importer.includes('args=(src, pnos, out, safe, total, target_w, target_h)') &&
  importer.includes('min(target_w / pw, target_h / ph)'));
check('Word 레이아웃도 선택된 용지 너비와 높이를 쓴다',
  importer.includes('_docx_to_pages(word_data, target_w, target_h)') &&
  importer.includes('max_y = target_h - margin_y') &&
  importer.includes('width = target_w - margin_x * 2'));
check('가져오기 결과가 판별된 용지 방향을 저장한다',
  /"sizePreset": size_preset/.test(importer) &&
  /sizePreset=size_preset/.test(importer));

console.log(`\nPASS ${pass.length}/${pass.length}`);
