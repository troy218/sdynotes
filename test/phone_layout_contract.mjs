/* 17.0 · 모바일 레이아웃/기능 표면 계약
 *
 * 실제 CSS는 sdynotes.css로 분리되어 있다. 이 테스트는 브라우저가 CSS 전체를
 * 오류 없이 파싱하는지, 마지막 모바일 블록이 데스크톱으로 새지 않는지, 그리고
 * 홈·에디터·모달·암기카드·음악·시계·채팅의 주요 조작면이 휴대폰 규칙 안에
 * 모두 포함되는지를 검사한다.
 *
 * 실행: node test/phone_layout_contract.mjs
 */
import fs from 'node:fs';
import * as csstree from 'css-tree';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '\n      ' + String(extra).replace(/\n/g, '\n      ') : ''));
  }
};
const has = (src, re) => re.test(src);

console.log('\n모바일 레이아웃/기능 표면 계약');

/* ── 1. CSS 자체가 유효한가 ─────────────────────────────────── */
console.log('\n[1] CSS 파싱과 모바일 전용 격리');
const parseErrors = [];
let ast = null;
try {
  ast = csstree.parse(css, { positions: true, onParseError: e => parseErrors.push(e) });
} catch (e) { parseErrors.push(e); }
ok('sdynotes.css 전체를 파싱 오류 없이 읽는다', parseErrors.length === 0,
  parseErrors.map(e => e.formattedMessage || e.message).join('\n'));
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
ok('분리 전 <style> 태그가 CSS에 남아 있지 않다', !/<\/?style\b/i.test(noComments));
ok('모바일 최종 블록이 파일 마지막에 존재한다', css.includes('17.0 · 모바일 전용 최종 레이아웃'));

const mobileMarkerAt = css.indexOf('17.0 · 모바일 전용 최종 레이아웃');
const mobileAt = mobileMarkerAt >= 0 ? css.lastIndexOf('/*', mobileMarkerAt) : -1;
const mobileSource = mobileAt >= 0 ? css.slice(mobileAt) : '';
const mobileErrors = [];
let mobileAst = null;
try {
  mobileAst = csstree.parse(mobileSource, { positions: true, onParseError: e => mobileErrors.push(e) });
} catch (e) { mobileErrors.push(e); }
ok('모바일 최종 블록도 독립적으로 파싱된다', mobileErrors.length === 0);
const topLevel = mobileAst ? [...mobileAst.children] : [];
ok('최종 블록의 선언은 전부 @media 안에만 있다',
  topLevel.length >= 3 && topLevel.every(n => n.type === 'Atrule' && n.name === 'media'),
  topLevel.map(n => `${n.type}:${n.name || ''}`).join(', '));
const queries = topLevel.map(n => n.prelude ? csstree.generate(n.prelude) : '');
ok('모든 최종 쿼리가 좁은 폭 또는 coarse-pointer 휴대폰만 대상으로 한다',
  queries.length >= 3 && queries.every(q =>
    /max-width:(?:380|640)px/.test(q) ||
    (/max-height:560px/.test(q) && /pointer:coarse/.test(q))), queries.join('\n'));
ok('휴대폰 가로 방향도 별도 대응한다',
  queries.some(q => /max-height:560px/.test(q) && /pointer:coarse/.test(q) && /orientation:landscape/.test(q)));

/* ── 2. viewport / safe area / 키보드 ───────────────────────── */
console.log('\n[2] 실제 모바일 viewport와 safe area');
ok('viewport-fit=cover와 사용자 확대 허용을 유지한다',
  has(html, /name="viewport"[^>]*user-scalable=yes[^>]*viewport-fit=cover/));
ok('상·하·좌·우 safe-area 변수를 모두 정의한다',
  ['--ph-safe:', '--ph-top:', '--ph-left:', '--ph-right:'].every(v => mobileSource.includes(v)));
ok('동적 visual viewport 높이를 홈·에디터·오버레이에서 쓴다',
  (mobileSource.match(/--sdy-mobile-vh/g) || []).length >= 8);
ok('JS가 visualViewport resize/scroll을 모두 감시한다',
  has(js, /visualViewport\.addEventListener\('resize',tick/) &&
  has(js, /visualViewport\.addEventListener\('scroll',syncViewport/));
ok('주소창/키보드 변화 높이를 CSS 변수로 전달한다',
  has(js, /setProperty\('--sdy-mobile-vh'/));
ok('iOS 자동 확대 방지를 email/url까지 포함한다',
  has(mobileSource, /input\[type=email\][\s\S]{0,100}input\[type=url\][\s\S]{0,180}font-size:16px!important/));

/* ── 3. 홈과 노트 크기 ─────────────────────────────────────── */
console.log('\n[3] 홈·폴더·노트');
ok('헤더를 예측 가능한 두 줄 모바일 레이아웃으로 만든다',
  has(mobileSource, /\.header \.w-full\{[\s\S]{0,180}flex-direction:column/));
ok('헤더 주요 버튼이 42px 터치 타깃이다',
  has(mobileSource, /\.header \.tool-btn[^\{]*\{[\s\S]{0,120}width:42px!important[\s\S]{0,80}height:42px!important/));
ok('PC에서 고른 카드 크기와 무관하게 폰은 2열이다',
  has(mobileSource, /body\.card-l \.note-card[\s\S]{0,280}flex:1 1 calc\(50% - 4px\)/));
ok('노트/폴더 미리보기 비율이 카드 폭을 따른다',
  has(mobileSource, /body \.note-preview,body \.folder-thumb[\s\S]{0,260}aspect-ratio:4\/5/));
ok('노트 메뉴는 터치에서 항상 보이고 40px이다',
  has(mobileSource, /\.card-menu\{display:flex;width:40px;height:40px/));
ok('선택 작업은 2열 하단 작업판이며 버튼은 44px 이상이다',
  has(mobileSource, /\.select-bar\{[\s\S]{0,260}grid-template-columns:1fr 1fr/) &&
  has(mobileSource, /\.select-bar button\{min-height:44px/));
ok('가로 폰은 노트를 4열로 줄여 과대 카드가 되지 않는다',
  has(mobileSource, /orientation:landscape[\s\S]*flex:1 1 calc\(25% - 6px\)/));

/* ── 4. 에디터의 모든 조작면 ───────────────────────────────── */
console.log('\n[4] 에디터');
ok('종이는 화면 폭에 맞고 본문은 양방향 스크롤 가능하다',
  has(js, /availW\/size\.w/) && has(mobileSource, /\.editor-body\{[\s\S]{0,300}touch-action:pan-x pan-y/));
ok('툴바는 손가락 가로 스크롤이며 버튼이 40px이다',
  has(mobileSource, /\.editor-toolbar\{[\s\S]{0,320}overflow-x:auto!important/) &&
  has(mobileSource, /\.editor-toolbar \.tool-btn[^\{]*\{[\s\S]{0,100}width:40px!important/));
ok('에디터 제목 입력은 16px이며 150px 폭을 확보한다',
  has(mobileSource, /\.editor-toolbar #edTitle\{[\s\S]{0,180}150px[\s\S]{0,100}font-size:16px!important/));
ok('더보기 서랍이 toolbar 아래의 전체 폭 시트다',
  has(mobileSource, /\.more-panel\{[\s\S]{0,180}left:0;right:0[\s\S]{0,100}width:100%/));
ok('서식·글꼴·색·즐겨찾기·메모 팝업이 화면 안 하단 시트다',
  has(mobileSource, /\.font-menu\.show,\.color-popover\.show,\.fav-pop\.show,\.tint-pop\.show,\.pin-pop\.show/));
ok('찾기·표·펜 도구가 화면 폭 안에서 스크롤된다',
  ['.find-bar{', '.tbl-bar{', '.draw-toolbar{'].every(s => mobileSource.includes(s)) &&
  has(mobileSource, /\.tbl-bar\{[\s\S]{0,180}overflow-x:auto/));
ok('텍스트/이미지 조절 손잡이를 모바일에서 확대한다',
  has(mobileSource, /\.tb-move\{width:34px;height:34px/) &&
  has(mobileSource, /\.el-del\{width:34px;height:34px/));

/* ── 5. 창/모달/부가 기능 ──────────────────────────────────── */
console.log('\n[5] 모달·보관함·암기카드·발표');
ok('일반 모달은 safe-area를 지키는 하단 시트다',
  has(mobileSource, /\.modal-bg\{[\s\S]{0,160}align-items:flex-end/) &&
  has(mobileSource, /\.modal-box:not\(\.cards-box\)\{[\s\S]{0,220}--sdy-mobile-vh/));
ok('모달 입력/선택은 44px 이상이다',
  has(mobileSource, /\.modal-box select,\.modal-box textarea\{min-height:44px/));
ok('새 노트 프리셋은 폰에서 2열이다',
  has(mobileSource, /#sizePresetGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/));
ok('보관함은 내부 목록만 스크롤하고 툴바는 44px이다',
  has(mobileSource, /\.vault-up,\.vault-tool\{min-width:44px;height:44px/) &&
  has(mobileSource, /\.vault-desk\{flex:1;min-height:180px;max-height:none/));
ok('암기카드 창은 저장된 드래그 좌표를 무시하고 화면 안에 고정된다',
  has(mobileSource, /\.fcard-win,\.fcard-win\.moved\{[\s\S]{0,180}top:auto!important[\s\S]{0,120}transform:none!important/));
ok('발표 화면과 이미지 뷰어도 동적 viewport 안에 맞춘다',
  has(mobileSource, /\.present\{height:var\(--sdy-mobile-vh/) &&
  has(mobileSource, /#viewer img\{max-width:100%!important;max-height:100%!important/));
ok('컨텍스트/곡 메뉴는 길어져도 하단 시트 안에서 스크롤된다',
  has(mobileSource, /\.ctx-menu\.show,\.mpctx\.show,\.pl-mini\{/) &&
  has(mobileSource, /max-height:min\(68dvh,560px\)!important;[\s\S]{0,100}overflow-y:auto/));

/* ── 6. 음악·채팅·집중시계 ─────────────────────────────────── */
console.log('\n[6] 음악·엽스코드·집중시계');
ok('음악바 버튼이 40px, 재생 버튼이 42px이다',
  has(mobileSource, /\.mp-btns button,#mpX\{[\s\S]{0,100}width:40px!important/) &&
  has(mobileSource, /\.mp-btns \.mp-pp\{width:42px!important;height:42px!important/));
ok('음악 목록과 큰 플레이어는 safe-area 하단 시트다',
  has(mobileSource, /\.mp-list\{[\s\S]{0,200}bottom:0!important[\s\S]{0,180}var\(--ph-safe\)/) &&
  has(mobileSource, /\.mpb\{[\s\S]{0,220}--sdy-mobile-vh/));
ok('음악 편집/추가 창과 컨트롤도 모바일 크기를 가진다',
  has(mobileSource, /\.mp-tagm \.[a-z]*box|\.mp-tagm \.box/) &&
  has(mobileSource, /\.mp-addpop\{[\s\S]{0,200}--sdy-mobile-vh/));
ok('음악/채팅 접기 칩은 46px이고 서로 동적으로 쌓인다',
  has(mobileSource, /#mpReopen,#ypReopen\{[^}]*width:46px;height:46px/) &&
  has(mobileSource, /body\.has-mpbar\{--ph-stack:72px/) &&
  has(js, /classList\.toggle\('has-mpbar'/));
ok('엽스코드 창은 viewport 안에 있고 헤더/음성/입력이 40px 이상이다',
  has(mobileSource, /#ypApp\{[\s\S]{0,420}--sdy-mobile-vh/) &&
  has(mobileSource, /#ypApp #ypHead button[^\{]*\{width:40px;height:40px/) &&
  has(mobileSource, /\.ypv-join,\.ypv-mute,\.ypv-icon,\.ypv-gear\{width:40px;height:40px/));
ok('채팅 입력은 iOS 확대 없는 16px이고 이모지는 6열이다',
  has(mobileSource, /\.yp-input textarea\{min-height:42px;font-size:16px!important/) &&
  has(mobileSource, /\.yp-emoji\{[^}]*grid-template-columns:repeat\(6,1fr\)/));
ok('집중시계 모드/버튼/링이 작은 화면 안에 맞는다',
  has(mobileSource, /#focusClock\{[\s\S]{0,120}--sdy-mobile-vh/) &&
  has(mobileSource, /#focusClock \.fc-modes button\{min-height:42px/) &&
  has(mobileSource, /\.fc-ring\{width:min\(42dvh,82vw,330px\)/));

/* ── 7. 모든 주요 기능 root가 HTML과 모바일 계약에 남아 있는가 ── */
console.log('\n[7] 주요 기능 표면 누락 방지');
const roots = [
  'mainView','noteGrid','editorView','moreSheet','fmtBar','selectBar',
  'setModal','trashModal','createModal','vaultModal','adminModal','folderStyleModal',
  'keyModal','delModal','pwModal','exportModal','importProg','infoModal','stickerModal',
  'latexModal','cardsModal','srvPop','notifPop','findBar','tblBar','pinPop','presentView',
  'cpModal','musicPlayer','musicListPop','mpBig','mpTagModal','mpAddPop','focusClock',
  'sdyAuthWrap','ypGate','ypApp'
];
const missingRoots = roots.filter(id => !new RegExp(`id=["']${id}["']`).test(html));
ok(`주요 기능 root ${roots.length}개가 모두 HTML에 있다`, missingRoots.length === 0, missingRoots.join(', '));
const surfaceTokens = [
  '#mainView', '.note-grid', '.editor-toolbar', '.more-panel', '#fmtBar', '.select-bar',
  '.modal-bg', '.modal-box', '#vaultModal', '.fcard-win', '.notif-pop', '.srv-pop',
  '.find-bar', '.tbl-bar', '.pin-pop', '.present', '.mp-list', '.mpb', '.mp-tagm',
  '.mp-addpop', '#focusClock', '.sa-card', '.ypg-card', '#ypApp'
];
const missingTokens = surfaceTokens.filter(s => !mobileSource.includes(s));
ok(`모바일 최종 블록이 기능 표면 ${surfaceTokens.length}종을 모두 다룬다`, missingTokens.length === 0, missingTokens.join(', '));

/* ── 8. 회전/리사이즈/데스크톱 보존 ───────────────────────── */
console.log('\n[8] 회전과 데스크톱 홈 복원');
ok('PC 홈은 카드 더미를 끄고 폴더·노트·추가 카드를 원래 격자로 렌더한다',
  has(js, /17\.1 · 홈 복원[\s\S]{0,500}const isHomeStack=false;/) &&
  has(js, /if\(!searchQuery&&!isHomeStack\)\{[\s\S]{0,100}childFolders\(curFolder\)/) &&
  has(js, /filtered\.forEach\(nb=>\{ g\.appendChild\(_makeCard\(nb\)\); \}\)/));
ok('기본 PC note-grid의 중앙 정렬·줄바꿈 규칙을 유지한다',
  has(css, /\.note-grid\{\s*display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;/));
ok('JS 모바일 판별은 세로 폭 + 가로 coarse pointer를 함께 쓴다',
  has(js, /PHONE_QUERY='\(max-width:640px\), \(max-height:560px\) and \(pointer:coarse\)'/));
ok('폰에서 엽스코드의 드래그 인라인 좌표를 지운다',
  has(js, /if\(PHONE\(\)\)\{[\s\S]{0,160}app\.style\.left='';app\.style\.top=''/));
ok('resize와 orientationchange 모두 재배치한다',
  has(js, /addEventListener\('resize',tick/) && has(js, /addEventListener\('orientationchange'/));
ok('PC에서는 드래그 좌표를 보존하고 화면 안으로만 clamp한다',
  has(js, /else if\(app\.classList\.contains\('open'\)\)[\s\S]{0,320}Math\.min\(innerWidth-w-8,l\)/));
ok('모바일 최종 소스에 데스크톱 min-width 규칙이 없다', !/min-width:\s*641px/.test(mobileSource));

console.log(`\n모바일 레이아웃 계약: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
