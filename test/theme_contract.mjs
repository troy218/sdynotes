/* 14.48 · PRO 테마 계약 — '워크' 밝은 전문 디자인 · 배경화면은 클래식 전용 · 종이 흰색
   실행: npm run test:theme (서버를 띄우고 실제 페이지를 jsdom 으로 열어 확인)
   - 프로 = html.theme-pro + 기본(라이트) 규칙 (더 이상 .dark 별칭 없음)
   - 배경화면: 프로에서 body.has-wall 없음·행 숨김, 클래식에서 복원(라운드로트)
   - 종이: 프로에서 --card=#ffffff, html.theme-pro .paper 백그라운드 흰색 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
const { JSDOM, VirtualConsole } = jsdom;

const pass = [];
const check = (name, cond) => { assert.ok(cond, name); pass.push(name); console.log('  ✓ ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const REPO = '/home/user/sdynotes';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-theme-'));
process.env.SDY_BASE_DIR = TMP;
for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
  const from = path.join(REPO, 'src', f), to = path.join(TMP, 'src', f);
  if (fs.statSync(from).isDirectory()) continue;
  fs.copyFileSync(from, to);
}

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: REPO, env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);

function mkBeforeParse(errs, presetLS) {
  return (window) => {
    installWindowGuard(window);
    window.innerWidth = 1280; window.innerHeight = 800;
    if (presetLS) window.localStorage.setItem('sdy3', presetLS);
    window.matchMedia = q => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
    window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
    window.EventSource = class { close(){} addEventListener(){} };
    window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
    window.cancelIdleCallback = clearTimeout;
    window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
    window.cancelAnimationFrame = clearTimeout;
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = function(){};
    window.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){},
      save(){}, restore(){}, scale(){}, translate(){}, setTransform(){}, measureText(){return {width:10}},
      getImageData(){return {data:new Uint8ClampedArray(4)}}, putImageData(){} });
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
    window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} addEventListener(){} removeEventListener(){} };
    window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
    window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
    window.fetch = (input, init) => {
      const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
      return globalThis.fetch(target, init);
    };
    window.addEventListener('error', e => errs.push(e.error?.stack || e.message));
    window.addEventListener('unhandledrejection', e => errs.push('unhandled: ' + (e.reason?.stack || e.reason)));
  };
}

async function loadPage(presetLS) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errs.push(m); });
  vc.on('error', (...a) => errs.push(a.join(' ')));
  const dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse: mkBeforeParse(errs, presetLS),
  });
  const { window } = dom, { document } = window;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (document.querySelector('#noteGrid .home-stack-area,.pro-home') || document.getElementById('splash')?.classList.contains('hide')) break;
    await wait(150);
  }
  await wait(800);
  return { dom, window, document, errs };
}

let dom1, dom2, dom3;
try {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log.slice(-2000));
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(100);
  }

  // ── 1) 첫 방문(저장값 없음) → 프로 기본, .dark 없음, 밝은 워크 토큰 ──
  ({ dom: dom1 } = await loadPage(null));
  const w1 = dom1.window, d1 = dom1.window.document;
  check('첫 진입 data-theme=pro', d1.documentElement.dataset.theme === 'pro');
  check('첫 진입 .theme-pro 있음', d1.documentElement.classList.contains('theme-pro'));
  check('14.48 · 프로에는 .dark 없음', !d1.documentElement.classList.contains('dark'));
  // 14.49 · 프로 앱 셸 — 사이드바 + 평평한 홈 그리드
  const side1 = d1.getElementById('proSide');
  check('14.49 · 사이드바 존재', !!side1);
  check('14.49 · 프로에서 사이드바 보임', side1 && w1.getComputedStyle(side1).display === 'flex');
  check('14.49 · 브랜드가 사이드바로 이동', !!d1.querySelector('#proBrandSlot .app-brand'));
  check('14.49 · 헤더에 브랜드 없음', !d1.querySelector('#mainView .header .app-brand'));
  check('프로 상단바 숨김', w1.getComputedStyle(d1.querySelector('#mainView > .header')).display === 'none');
  check('검색과 액션은 사이드바로 이동', !!d1.querySelector('#proToolsSlot #searchInput') && !!d1.querySelector('#proToolsSlot #notifBtn'));
  check('폴더 경로는 본문에 유지', !!d1.querySelector('#mainView > main > #breadcrumb'));
  check('카드 중복 버튼 숨김', w1.getComputedStyle(d1.querySelector('#proToolsSlot button[onclick="openCards()"]')).display === 'none');
  w1.pickTheme('classic');
  check('캐주얼 전환 시 액션 복원', !!d1.querySelector('#mainView .header #searchInput'));
  w1.pickTheme('pro');
  check('프로 재전환 시 검색 중복 없음', d1.querySelectorAll('#searchInput').length === 1 && !!d1.querySelector('#proToolsSlot #searchInput'));

  check('14.49 · 내비게이션 렌더(파일·휴지통)', d1.querySelectorAll('#proNav .pro-nav-item').length >= 2);
  check('14.49 · 프로 홈 = 평평한 그리드', !!d1.querySelector('#noteGrid .pro-home .pro-grid'));
  check('14.49 · 프로 홈에 스택·펼침 영역 없음', !d1.querySelector('#noteGrid .home-stack-area'));
  check('14.49 · 새 노트 버튼 존재', !!d1.querySelector('#noteGrid .pro-add-note'));
  check('프로 도구에 기능 이름 있음', d1.querySelector('#clockBtn').dataset.proLabel === '집중 시계');
  const bookmarks=d1.getElementById('proBookmarks');
  check('북마크는 로고와 분리된 영역에 있음', !!d1.querySelector('#proBookmarkSlot #linkBar') && !d1.querySelector('.app-brand #linkBar'));
  check('PC 북마크는 처음에 펼쳐짐', bookmarks.open);
  const oldLinks=w1.getLinks();
  const longName='아주 긴 북마크 이름과 공백없는주소'.repeat(10);
  w1.saveLinks(Array.from({length:25},(_,i)=>({name:i?`북마크 ${i}`:longName,url:`https://example.com/${i}`})));
  w1.renderLinks();
  check('많은 북마크도 전부 렌더하고 개수 표시', d1.querySelectorAll('#linkBar .link-chip').length === 25 && d1.getElementById('proBookmarkCount').textContent === '25');
  check('긴 이름 원문과 새 탭 안내 유지', d1.querySelector('#linkBar .link-chip span').textContent === longName && d1.querySelector('#linkBar .link-chip').getAttribute('aria-label').includes('새 탭'));
  check('북마크 이름을 자르지 않고 줄바꿈', w1.getComputedStyle(d1.querySelector('#linkBar .link-chip span')).whiteSpace === 'normal');
  check('북마크 추가 버튼에 이름 있음', d1.querySelector('#linkBar .link-add').getAttribute('aria-label') === '북마크 추가');
  w1.innerWidth=390;w1.dispatchEvent(new w1.Event('resize'));
  check('좁은 화면 진입 시 북마크 접힘', !bookmarks.open);
  bookmarks.open=true;
  bookmarks.dispatchEvent(new w1.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  check('Escape로 닫고 북마크 버튼에 초점 복귀', !bookmarks.open && d1.activeElement === bookmarks.querySelector('summary'));
  bookmarks.open=true;d1.body.click();
  check('바깥 클릭으로 북마크 닫힘', !bookmarks.open);
  w1.innerWidth=1280;w1.dispatchEvent(new w1.Event('resize'));
  check('PC 폭으로 복귀하면 북마크 펼침', bookmarks.open);
  w1.pickTheme('classic');
  check('캐주얼에서 원래 북마크 위치 복원', !!d1.querySelector('.app-brand #linkBar'));
  w1.pickTheme('pro');
  check('테마 재전환 시 북마크 ID 중복 없음', d1.querySelectorAll('#linkBar').length === 1 && !!d1.querySelector('#proBookmarkSlot #linkBar'));
  w1.saveLinks(oldLinks);w1.renderLinks();

  check('검색 입력에 접근성 이름 있음', d1.querySelector('#searchInput').getAttribute('aria-label') === '노트 검색');
  const toolbar=d1.querySelector('.editor-toolbar');
  check('편집 툴바 그룹에 이름 있음', toolbar.getAttribute('aria-label') === '노트 편집 도구');
  check('서식·넣기·그리기·찾기 묶음 구분', [...toolbar.querySelectorAll('.tb-mid [data-tool-group]')].map(el=>el.dataset.toolGroup).join(',') === '글자 서식,넣기,그리기,찾기');
  check('제목·글자 크기·쪽 번호 입력 이름 있음', ['edTitle','fsInput','pgNow'].every(id=>d1.getElementById(id).hasAttribute('aria-label')));
  check('색상 선택과 페이지 이동 버튼 이름 있음', toolbar.querySelectorAll('#textColorWrap button[aria-label],.pg-nav button[aria-label]').length === 4);
  check('더보기·내보내기 텍스트 레이블 있음', toolbar.querySelectorAll('.tb-right .tb-labeled[data-tool-label]').length === 2);
  d1.querySelector('#editorView').classList.add('focus-on');
  check('집중 모드에서는 새 툴바도 숨김', w1.getComputedStyle(toolbar).display === 'none');
  d1.querySelector('#editorView').classList.remove('focus-on');

  // 14.61 · 프로는 타일 대신 pro-add-note 버튼(새 노트 만들기), 캐주얼은 add-card 버튼 —
  // 어느 테마든 '키보드로 누를 수 있는 추가 버튼'이면 계약 통과
  check('추가 타일은 키보드로 누를 수 있는 버튼',
    !!d1.querySelector('#noteGrid button.add-card[aria-label]') || !!d1.querySelector('#noteGrid button.pro-add-note[aria-label]'));
  check('전체 노트 내비에 현재 위치 표시', !!d1.querySelector('#proNav [aria-current="page"]'));
  w1.searchNotes('no-match-ui-regression-92817');
  check('검색 결과 수 표시', !d1.querySelector('#proResults').hidden && d1.querySelector('#proResults').textContent.includes('0개'));
  check('빈 검색 안내 표시', d1.querySelector('#noteGrid .pro-home-empty').textContent.includes('검색 결과가 없습니다'));
  check('검색 중 생성 타일 숨김', !d1.querySelector('#noteGrid .add-card'));
  d1.querySelector('.pro-results-clear').click();
  check('검색 지우기로 홈 복귀', d1.querySelector('#proResults').hidden && !!d1.querySelector('#noteGrid .pro-home'));

  check('sdyTheme()=pro', w1.sdyTheme() === 'pro');
  check('pickTheme/paintThemePicks 전역 노출', typeof w1.pickTheme === 'function' && typeof w1.paintThemePicks === 'function');
  check('구 darkTgl 요소 제거됨', !d1.getElementById('darkTgl'));
  const bg1 = w1.getComputedStyle(d1.documentElement).getPropertyValue('--bg').trim().toLowerCase();
  console.log('    --bg = ' + JSON.stringify(bg1));
  check('프로 --bg 토큰이 밝은 워크값', bg1 === '#f4f5f8');
  const card1 = w1.getComputedStyle(d1.documentElement).getPropertyValue('--card').trim().toLowerCase();
  check('프로 --card 토큰이 흰색(종이)', card1 === '#ffffff');
  const cssText = fs.readFileSync(path.join(TMP, 'sdynotes.css'), 'utf-8');
  check('CSS: 프로 종이 흰색 규칙 존재', /html\.theme-pro \.paper\{[^}]*background:#FFFFFF/.test(cssText));
  // 14.50 · 음악·엽스코드 프로 통합
  check('14.50 · CSS: 음악바 플랫 화이트', /html\.theme-pro \.mp\.mp-bar\{[^}]*background:#FFFFFF/.test(cssText));
  check('14.50 · CSS: 엽스코드 밝은 프레임', /html\.theme-pro #ypApp\{[^}]*background:#FFFFFF/.test(cssText));
  check('14.50 · 음악바·엽스코드·게이트 DOM 존재', !!d1.getElementById('musicPlayer') && !!d1.getElementById('ypApp') && !!d1.getElementById('ypGate'));
  // 14.51 · 플로팅 위치 — 사이드바 기준 재배치 규칙 존재
  check('14.51 · CSS: 선택막대 콘텐츠 중앙 정렬', /html\.theme-pro \.select-bar\{left:calc\(50% \+ 140px\)/.test(cssText));
  check('14.51 · CSS: 모바일 시트가 레일 존 회피', /html\.theme-pro #ypApp\{left:72px!important;\}/.test(cssText));
  // 14.52 · 사각화 + 남은 도구 플랫 + 테마 이름 변경(기본/캐주얼)
  check('14.52 · CSS: fcard 창 사각(10px!important)', /html\.theme-pro \.fcard-win, html\.theme-pro \.fcard-win\.moved,\s*html\.theme-pro \.modal-bg \.modal-box\.cards-box\{border-radius:10px!important;\}/.test(cssText));
  check('14.52 · CSS: fcard 글래스 제거', /html\.theme-pro \.fcard-win\{\s*background:#FFFFFF!important;/.test(cssText));
  check('14.52 · CSS: 컨트롤 6px 스케일(searchInput)', /html\.theme-pro #searchInput\{border-radius:6px!important;\}/.test(cssText));
  check('14.52 · CSS: AI 말풍선 플랫', /html\.theme-pro \.otter-bubble, html\.theme-pro \.otter-bubble-mini\{/.test(cssText));
  check('14.52 · UI: 테마 이름 기본/캐주얼', [...d1.querySelectorAll('.theme-pick .tp-name')].map(b=>b.textContent).join('|') === '기본|캐주얼');
  check('14.52 · UI: 배경화면 행은 캐주얼 전용 표기', /캐주얼 테마 전용/.test(d1.getElementById('setRowWall').textContent));

  // ── 2) 설정창 테마 UI + 배경화면 행은 프로에서 숨김 ──
  w1.openSettings();
  await wait(200);
  check('테마 선택 UI 렌더', !!d1.getElementById('themePicks'));
  check('프로 카드에 .on', !!d1.querySelector('.theme-pick[data-theme=pro].on'));
  check('클래식 카드 .on 없음', !d1.querySelector('.theme-pick[data-theme=classic].on'));
  const wallRow1 = d1.getElementById('setRowWall');
  check('배경화면 행 존재(id=setRowWall)', !!wallRow1);
  check('14.48 · 프로에서 배경화면 행 숨김', wallRow1 && w1.getComputedStyle(wallRow1).display === 'none');

  // ── 3) 클래식으로 전환 ──
  w1.pickTheme('classic');
  await wait(200);
  check('전환 후 data-theme=classic', d1.documentElement.dataset.theme === 'classic');
  check('전환 후 .theme-classic', d1.documentElement.classList.contains('theme-classic'));
  check('14.49 · 클래식에서 사이드바 숨김', side1 && w1.getComputedStyle(side1).display === 'none');
  check('14.49 · 클래식에서 브랜드 헤더로 복원', !!d1.querySelector('#mainView .header .app-brand'));
  check('14.49 · 클래식 홈 = 기존 스택 레이아웃', !!d1.querySelector('#noteGrid .home-stack-area'));
  check('전환 후 .theme-pro/.dark 꺼짐', !d1.documentElement.classList.contains('theme-pro') && !d1.documentElement.classList.contains('dark'));
  check('클래식 카드에 .on 이동', !!d1.querySelector('.theme-pick[data-theme=classic].on'));
  const saved = JSON.parse(w1.localStorage.getItem('sdy3'));
  check('localStorage에 theme=classic 저장', saved && saved.theme === 'classic');
  check('구 S.dark 키 정리됨', !('dark' in saved));
  const bgC = w1.getComputedStyle(d1.documentElement).getPropertyValue('--bg').trim().toLowerCase();
  console.log('    classic --bg = ' + JSON.stringify(bgC));
  check('클래식 --bg 토큰이 라이트값', bgC === '#ffffff');
  check('클래식에서 배경화면 행 보임', wallRow1 && w1.getComputedStyle(wallRow1).display === 'flex');

  // ── 4) 다시 프로로 ──
  w1.pickTheme('pro');
  await wait(200);
  check('복귀 후 pro', d1.documentElement.dataset.theme === 'pro' && w1.sdyTheme() === 'pro');
  check('복귀 후 .dark도 없음', !d1.documentElement.classList.contains('dark'));
  w1.closeSettings();

  // ── 5) 구버전 저장값(S.dark, theme 없음) 이전 ──
  const legacy = JSON.stringify({ dark: true, defPaper: 'blank', defFS: 16, defFont: 'pretendard', accent: '#4f6ef7', appTitle: '', cardSize: 'l' });
  ({ dom: dom2 } = await loadPage(legacy));
  const w2 = dom2.window, d2 = dom2.window.document;
  check('구 dark 저장값도 pro로 시작', d2.documentElement.dataset.theme === 'pro' && w2.sdyTheme() === 'pro');
  check('구 저장값 로드에도 .dark 없음', !d2.documentElement.classList.contains('dark'));

  // ── 6) 14.48 · 배경화면 라운드로트 — 클래식에서 설정값이 프로에서는 안 보임 ──
  const wallPreset = JSON.stringify({
    theme: 'pro', wall: `${base}/files/wallpaper/roundtrip.jpg`, wallVideo: false,
    defPaper: 'blank', defFS: 16, defFont: 'pretendard', accent: '#4f6ef7',
  });
  ({ dom: dom3 } = await loadPage(wallPreset));
  const w3 = dom3.window, d3 = dom3.window.document;
  const b3 = d3.body, wallEl = d3.getElementById('wallLayer');
  check('배경 설정값 있음에도 프로에서는 has-wall 없음', !!b3 && !b3.classList.contains('has-wall'));
  check('배경 설정값 있음에도 프로에서는 배경 url 없음', !!wallEl && !wallEl.style.backgroundImage);
  w3.pickTheme('classic');
  await wait(200);
  check('클래식에서 has-wall 복원', b3.classList.contains('has-wall'));
  check('클래식에서 배경 url 복원', !!wallEl && wallEl.style.backgroundImage.includes('roundtrip.jpg'));
  w3.pickTheme('pro');
  await wait(200);
  check('다시 프로로 가면 배경 사라짐', !b3.classList.contains('has-wall') && !wallEl.style.backgroundImage);

  console.log(`\n✅ theme_smoke — ${pass.length}개 항목 통과`);
} finally {
  try { await closeDoms(); } catch {}
  try { dom1?.window?.close(); } catch {}
  try { dom2?.window?.close(); } catch {}
  try { dom3?.window?.close(); } catch {}
  try { child.kill('SIGKILL'); } catch {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
