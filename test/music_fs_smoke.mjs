// 전체화면·이퀄라이저·서랍 스모크 (jsdom) — 운영 번들을 고치지 않고 검증만 한다.
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const fullHtml = html.includes('<script src="sdynotes.js"')
  ? html.replace(/<script src="sdynotes\.js"[^>]*><\/script>/, '<script>' + js + '</script>')
  : html;
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.log('  ✗', name)); if(cond) console.log('  ✓', name); };

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (error) => {
  if (!/Could not load (script|link|style)/.test(error.message)) errors.push(error);
});

const TRACKS = [1,2,3].map(i => ({
  id:'t'+i, title:'Song '+i, artist:'Art '+i, album:'Alb', duration:100+i, cover:1,
  lyrics:'[00:01.00]가사 '+i+' 첫줄\n[00:02.00]가사 '+i+' 둘째줄', yt:null,
}));

const dom = new JSDOM(fullHtml, {
  url: 'http://sdynotes.test/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window){
    window.fetch = async (url) => {
      const body = String(url).includes('/api/music/list')
        ? { ok:true, tracks:TRACKS, count:TRACKS.length } : { ok:true, tracks:[] };
      return new Response(JSON.stringify(body), { status:200, headers:{'content-type':'application/json'} });
    };
    window.confirm = () => true; window.prompt = () => null; window.alert = () => {};
    window.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    window.IntersectionObserver = class { observe(){} disconnect(){} unobserve(){} };
    window.ResizeObserver = class { observe(){} disconnect(){} };
    window.HTMLCanvasElement.prototype.getContext = () => ({
      setTransform(){}, clearRect(){}, fillRect(){}, beginPath(){}, arc(){}, fill(){},
      stroke(){}, moveTo(){}, lineTo(){}, save(){}, restore(){}, translate(){},
      scale(){}, rotate(){}, fillText(){},
      createLinearGradient(){ return { addColorStop(){} }; },
    });
    window.HTMLElement.prototype.scrollTo = function(options){ this.scrollTop = (typeof options==='object' ? options.top : options) || 0; };
    window.HTMLMediaElement.prototype.play = function(){ this.dispatchEvent(new window.Event('play')); return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function(){ this.dispatchEvent(new window.Event('pause')); };
    window.HTMLMediaElement.prototype.load = function(){};
  },
});

await new Promise(r => setTimeout(r, 600));
const { window } = dom;
const { document } = window;
const $ = id => document.getElementById(id);

if (errors.length) { console.log('페이지 평가 오류:\n' + errors.map(e=>e.stack).join('\n')); process.exit(1); }

// 재생 시작 + 확대 플레이어 열기
window.sdyPlayFrom(TRACKS, 't1', '');
$('mpExpand').click();
await new Promise(r => setTimeout(r, 60));
const mpb = $('mpBig');
ok('확대 플레이어가 열린다', mpb.classList.contains('open'));
ok('표지 앰비언트 배경이 채워진다', $('mpAmbImg').dataset.cur && $('mpAmbImg').dataset.cur.includes('/api/music/cover/t1'));

// ── 전체 화면 ──
$('mpBFull').click();
await new Promise(r => setTimeout(r, 140));   // 모핑 rAF 대기
ok('전체 화면 클래스가 붙는다', mpb.classList.contains('mpb-fs'));
ok('커진 동안 모핑 transition 클래스가 붙는다', mpb.classList.contains('mpb-anim'));

// 더블클릭으로 닫기
mpb.dispatchEvent(new window.MouseEvent('dblclick', { bubbles:true }));
await new Promise(r => setTimeout(r, 60));
ok('더블클릭으로 전체 화면을 빠져나온다', !mpb.classList.contains('mpb-fs'));

// 다시 진입 후 나머지 검사
$('mpBFull').click();
await new Promise(r => setTimeout(r, 140));
ok('다시 전체 화면 진입', mpb.classList.contains('mpb-fs'));

// ── 서랍 · 가사 ──
ok('전체 화면 전용 버튼이 있다', !!$('mpBList') && !!$('mpBLyrBtn'));
$('mpBList').click();
ok('목록 서랍이 열린다', mpb.classList.contains('show-drawer'));
$('mpBLyrBtn').click();
await new Promise(r => setTimeout(r, 30));
ok('가사 탭 + 서랍으로 가사가 보인다', !!document.querySelector('#mpBLyr .ll'));
ok('목록은 스트리밍 앱처럼 어두운 서랍 안에 있다', !!$('mpBDrawer'));

// ── 검색 배지 ──
$('mpBSearch').value = 'song';
$('mpBSearch').dispatchEvent(new window.Event('input', { bubbles:true }));
await new Promise(r => setTimeout(r, 30));
ok('검색 배지에 곡 수가 뜬다', /3곡/.test($('mpBSearchCnt').textContent));

// ── 이퀄라이저 ──
$('mpBEq').click();
await new Promise(r => setTimeout(r, 60));
pop_sw: { const sw = $('mpEqPop').querySelector('.eq-sw'); if (sw) sw.click(); }
await new Promise(r => setTimeout(r, 80));
const pop = $('mpEqPop');
ok('이퀄라이저가 눌러야만 살짝 보인다', !pop.hidden && pop.classList.contains('show'));
ok('10밴드 슬라이더가 있다', pop.querySelectorAll('[data-eqb]').length === 10);
ok('프리셋이 여러 개다', pop.querySelectorAll('[data-eqp]').length >= 8);
ok('jsdom(미지원)에서는 조용히 거절 안내를 보인다',
  $('mpEqNote').classList.contains('show') && !!$('mpEqNote').textContent);
// 슬라이더를 움직이면 사용자 설정으로 저장된다
const sl = pop.querySelector('[data-eqb="2"]');
sl.value = 6; sl.dispatchEvent(new window.Event('input', { bubbles:true }));
const saved = JSON.parse(window.localStorage.getItem('mp_eq1'));
ok('밴드 움직임이 저장된다', saved && Math.abs(saved.gains[2]-6) < 1e-6);

// ── 수면 타이머 ──
$('mpBSleep').click();
ok('수면 타이머 배지에 남은 분이 뜬다', /15′/.test($('mpBSleepLeft').textContent));
await new Promise(r => setTimeout(r, 30));
for (let k=0;k<5;k++) $('mpBSleep').click();   // 한 바퀴 → 끄기
ok('다시 누륨 사이클로 끌 수 있다', $('mpBSleepLeft').textContent === '');

// ── 곡 바뀜: 배경·타이틀 반응 ──
const before = $('mpAmbImg').dataset.cur;
window.sdyPlayFrom(TRACKS, 't2', '');
await new Promise(r => setTimeout(r, 60));
ok('곡이 바뀌면 앰비언트 배경도 바뀐다', $('mpAmbImg').dataset.cur !== before && $('mpAmbImg').dataset.cur.includes('/api/music/cover/t2'));
$('mpBTabL').click();
await new Promise(r => setTimeout(r, 60));
ok('목록의 재생 표시가 막대 애니메이션이다', !!document.querySelector('.mpb-li .mp-eqbars'));

// 몸 상태 클래스
ok('재생 상태가 body 클래스에 실린다', document.body.classList.contains('mpb-playing'));

console.log(`\n전체 화면 스모크: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
