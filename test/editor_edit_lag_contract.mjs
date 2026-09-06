// 22.1 · '글상자를 누르는 순간 멈춤' 회귀 방지 계약 (정적 검사)
//
// 똥컴 경량 모드(22.0)로 열람·스크롤은 가벼워졌지만, 편집에 들어가는 순간에는
// 다른 종류의 비용이 몰려 있었다. 이 계약은 그 원인들이 되돌아오지 않게 지킨다.
//
//   ① 편집 진입 스냅샷 — doc 전체 JSON.stringify → '그 상자'만 기억하는 패치로
//      (되돌리기/다시 실행도 같은 패치를 적용한다)
//   ② 오토세이브 에코 루프 — 커밋 → saveDoc → 400ms → 커밋 … 이 편집 중 계속 돌았다
//      · 그리고 save 마다 doc 을 통째로 복제하던 동기화 스냅샷도 전송 직전 한 번으로
//   ③ save 마다 전(全) 쪽 sanitize(O(n²) 겹침 비교 포함) 재실행 → _sanDone 재사용
//   ④ 글상자당 테두리 4 + 손잡이 8 = 12개 장식을 쪽을 그릴 때 전부 생성 → 선택할 때만
//      (이미지에는 18.13 에 같은 방법이 적용돼 있었다)
//   ⑤ 형광펜 띠: 배경이 없는 상자까지 관찰자+레이아웃 재기를 했다 → 띠가 생길 때만
//   ⑥ clearTextSelection 이 모든 글상자에 inline 스타일을 다시 썼다 → 허용한 상자만
//   ⑦ 실시간 커서: 편집 중 40ms 마다 캐럿 좌표(레이아웃 읽기)를 재고 ping 을 보냈다
//
// 실행: node test/editor_edit_lag_contract.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(path.join(REPO, 'sdynotes.js'), 'utf8');
const css = fs.readFileSync(path.join(REPO, 'sdynotes.css'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};
// 소스에서 함수 본문(들여쓰기 4칸 function 선언 ~ 같은 깊이 폐괄호)을 뽑는다.
function body(name) {
  const re = new RegExp(`^    (?:async )?function ${name}\\(([^\\n]*)\\) \\{|^    (?:async )?function ${name}\\(`, 'm');
  const m = re.exec(js);
  if (!m) return '';
  let i = m.index, depth = 0, started = false;
  for (; i < js.length; i++) {
    const ch = js[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return js.slice(m.index, i + 1); }
  }
  return '';
}
// 주석(설계 설명)은 검사에서 뺀다 — '예전엔 이렇게 했다'는 문장이 소스에 남아
//   있으면 '이제 그러면 안 된다' 검사에 걸리기 때문이다.
function code(b) {
  return String(b).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

console.log('\n편집 진입 렉 제거 계약 (22.1)');

/* ── ① 편집 스냅샷 = 그 상자만 ───────────────────────────────────────── */
{
  const b = code(body('markEditSnapshot'));
  ok('편집 진입 스냅샷은 doc 전체를 직렬화하지 않는다', !!b && !/JSON\.stringify\(doc\)/.test(b));
  ok('편집 스냅샷은 눌러 준 그 상자의 필드만 복사한다', b.includes('_snapEl(el)') && b.includes('_editPatch('));
  ok('_snapEl 은 중첩 객체(표 셀 정보 등)만 본따서 복제한다',
    /function _snapEl\(el\)[\s\S]{0,600}JSON\.parse\(JSON\.stringify\(v\)\)/.test(js));
  ok('인자 없이 불리면(20.3 · 타이핑 체크포인트) 지금 편집 중인 상자를 기억한다',
    /_activeEditBox\(\)/.test(b));
  const be = body('enterEdit');
  ok('enterEdit 가 스냅샷에 자기 상자를 넘긴다', /markEditSnapshot\(w\)/.test(be));
  // 히스토리 한 칸 = {snap, patch, remote, remotePages}. 20.3 은 협업 안전성을,
  //   22.1 은 그 칸의 크기를 담당한다 — 글상자 편집은 snap 대신 patch 만 담긴다.
  ok('히스토리 칸은 스냅샷과 패치를 같이 담는 그릇이다',
    /function _histEntry\(snap,patch\)\{ return \{snap:patch\?null:snap,patch:patch\|\|null,/.test(js));
  const bc = code(body('commitEditSnapshot'));
  ok('첫 타이핑 기록은 문서 스냅샷 대신 패치 칸으로 쌓인다',
    /history\.push\(_histEntry\(null,_editSnap\)\)/.test(bc) && /return true;/.test(bc));
  const ba = code(body('_histApply')), bp = code(body('_histApplyPatch'));
  ok('되돌리기가 패치 칸을 알아보고 전용 경로로 보낸다',
    /const isPatch=!!\(entry&&entry\.patch\)/.test(ba) && /if\(isPatch\) return _histApplyPatch\(entry\)/.test(ba));
  ok('패치 칸을 되돌릴 때는 문서 전체를 직렬화하지 않는다',
    /const before=isPatch\?null:JSON\.stringify\(doc\)/.test(ba) && !/JSON\.stringify\(doc\)/.test(bp));
  ok('되돌린 쪽만 다시 그리고 동기화 큐에 올린다 (저장·전송은 그대로)',
    /renderPageEls\(pt\.pi\)/.test(bp) && /queueOps\(\)/.test(bp));
  ok('되돌리기 실패(쪽·상자 소실)는 문서를 통째로 덮어쓰지 않고 칸을 건너뛴다',
    /if\(!r\) return null;/.test(bp) && /if\(!r\) continue;/.test(code(body('_histStep'))));
  ok('다시 실행도 같은 사다리를 올라간다',
    /function undo\(\)\{ _histStep\(history,redoStack,'되돌림'\); \}/.test(js)
    && /function redo\(\)\{ _histStep\(redoStack,history,'다시 실행'\); \}/.test(js));
  const bap = code(body('_applyEditPatch'));
  ok('패치 적용은 쪽·상자가 없으면 조용히 실패한다 (없으면 되돌리지 않는다)',
    /if\(!pg\|\|!Array\.isArray\(pg\.els\)\) return null;/.test(bap) && /if\(!el\) return null;/.test(bap));
  ok('그 사이 남이 고친 상자는 되돌리기가 덮어쓰지 않는다 (20.3 협업 안전성)',
    /if\(remote&&remote\.has\(pt\.id\)\) return null;/.test(bap));
  ok('이미 그 상태라면 헛되이 다시 그리지 않는다', /changed:false/.test(bap));
  ok('패치 적용은 쪽을 더러움 표시하고 반대 방향 상태를 돌려준다',
    /markPageEdited\(pt\.pi\)/.test(bap) && /cur:cur,changed:true/.test(bap));
  ok('되돌리기 기록 깊이가 문서·기기에 맞게 줄어든다 (GC·메모리)',
    /function histMax\(\)/.test(js) && /history\.length>histMax\(\)/.test(js) && /history\.length>60/.test(js) === false);
  ok('pushHistory · 다시 실행 스택도 같은 상한을 쓴다',
    /if\(history\.length>histMax\(\)\) history\.shift\(\);/.test(code(body('pushHistory')))
    && /to\.length>histMax\(\)/.test(code(body('_histStep'))));
}

/* ── ② 오토세이브 에코 루프 ─────────────────────────────────────────── */
{
  const b = code(body('commitEditingText'));
  ok('커밋은 바뀐 상자가 없으면 저장을 다시 예약하지 않는다',
    /if\(changed\)\{[\s\S]{0,200}?else saveDoc\(\);/.test(b));
  ok('오토세이브 안에서 커밋돼도 AI 글 캐시는 무효화한다 (저장만 생략)',
    /_commitFromSave\)\{ try\{ bumpAiText\(\); \}catch\(e\)\{\} \}/.test(b));
  ok('커밋은 내용·글자 크기를 비교해서 쓸 때만 문서를 더럽힌다',
    /if\(nh!==el\.html\|\|nfs!==el\.fontSize\)/.test(b) && /changed=true/.test(b));
  const bf = code(body('flushSaveDoc'));
  ok('오토세이브 안의 커밋은 saveDoc 을 되걸지 못한다 (_commitFromSave)',
    /_commitFromSave=true; commitEditingText\(\); \}catch\(e\)\{\} finally\{ _commitFromSave=false; \}/.test(bf));
  const bq = code(body('queueSync'));
  ok('동기화 페이로드용 doc 복제를 큐 시점이 아닌 전송 직전으로 미룬다',
    !/JSON\.parse\(JSON\.stringify\(doc\)\)/.test(bq) && /_snap:_syncD\?null:'1'/.test(bq));
  const bfl = code(body('flushSync'));
  ok('flushSync 가 미뤄 둔 스냅샷을 전송 직전 한 번만 굽는다',
    /if\(p\._snap\)/.test(bfl) && /JSON\.parse\(JSON\.stringify\(doc\)\)/.test(bfl));
}

/* ── ③ save 마다 전 쪽 sanitize 금지 ───────────────────────────────── */
{
  const b = code(body('persistDoc'));
  ok('저장 시 이미 정리된 쪽은 중복 정리를 건너뛴다', /if\(_sanDone\.has\(keep\)\) return;/.test(b));
  ok('드롭이 없으면 요소 배열 신원을 지킨다 (캐시가 매번 어긋나지 않게)',
    !/pg\.els=n;\s*\}\)/.test(b) && /if\(n\.length!==keep\.length\)\{ pg\.__dirty=true; pg\.els=n; \}/.test(b));
}

/* ── ④ 글상자 장식은 선택할 때만 ───────────────────────────────────── */
{
  const bt = code(body('buildTextEl')), bl = code(body('buildLatexEl'));
  ok('글상자 렌더가 테두리·손잡이를 만들지 않는다', !/tb-edge/.test(bt) && !/className='handle/.test(bt));
  ok('수식 렌더도 같다', !/tb-edge/.test(bl) && !/className='handle/.test(bl));
  ok('_ensureTbControls 가 장식을 한 번만 붙인다',
    /function _ensureTbControls\(w\)\{[\s\S]{0,120}w\._ctl/.test(js) && /if\(w\.classList\.contains\('in-tbl'\)\) return w;/.test(js));
  ok('표 칸은 장식을 아예 만들지 않는다 (CSS 가 display:none !important)', /in-tbl'\)\) return w;/.test(js));
  ok('SVG 요소(그획)에 HTML 장식을 넣지 않는다', /namespaceURI!==\'http:\/\/www\.w3\.org\/1999\/xhtml\'/.test(js));
  const uses = (js.match(/_ensureTbControls\(/g) || []).length;
  ok('선택·편집 경로가 장식을 붙인다 (호출 ≥ 12곳)', uses >= 12, `calls=${uses}`);
  ok('편집 진입 자체가 장식을 확보한다', /_ensureTbControls\(w\)/.test(body('enterEdit')));
  ok('쪽 관찰자가 안전망이다 (class 가 바뀐 상자가 고려지면 장식 확보)',
    /_ensureTbControls\(t\)/.test(js) && /contains\('sel'\)\|\|t\.classList\.contains\('msel'\)/.test(js));
  ok('장식 표시 규칙은 CSS 가 여전히 sel/edit 만 보인다',
    /\.tb\.sel \.handle,\.tb\.edit \.handle\{display:block;\}/.test(css.replace(/\s+/g, ''))
    || /\.tb\.sel\s*\.handle,\.tb\.edit\s*\.handle\{display:block;\}/.test(css));
}

/* ── ⑤ 형광펜 띠는 칠해진 상자만 잰다 ──────────────────────────────── */
{
  ok('_hlMayHave 로 계산 대상인지 먼저 가린다', /function _hlMayHave\(c,w\)\{/.test(js));
  ok('렌더 시점에는 관찰자를 붙이지 않는다', !/_hlWatch\(c,w\)/.test(body('buildTextEl')));
  ok('_hlSchedule 이 게이트를 지난다', /if\(!_hlMayHave\(c,w\)&&!\(w\.querySelector/.test(body('_hlSchedule')));
  ok('띠가 처음 생긴 상자는 그때부터 관찰된다 (서식 변경 재그림 유지)',
    /if\(!c\._sdyHlMO\)\{ try\{ _hlWatch\(c,w\); \}catch\(_e\)\{\} \}/.test(body('_hlPaint')));
  ok('띠가 모두 사라진 상자는 관찰도 멈춘다', /c\._sdyHlMO\.disconnect\(\)/.test(body('_hlPaint')));
  ok('편집 중인 상자는 항상 계산 대상', /w\.classList\.contains\('edit'\)\) return true;/.test(js));
  ok('웹폰트 대기는 상자가 아니라 한 번만 (Promise 폭주 방지)',
    !/document\.fonts\.ready\.then/.test(body('buildTextEl')) && /function _onFontsReady\(cb\)/.test(js));
}

/* ── ⑥ 선택 해제를 '허락한 상자'만 ────────────────────────────────── */
{
  const b = code(body('clearTextSelection'));
  ok('모든 글상자를 훑어 inline 스타일을 지우지 않는다',
    !/querySelectorAll\('#pagesStage \.tb-content'\)/.test(b));
  ok('허락 받은 상자를 Set 으로 기억해 그 것만 되돌린다',
    /_selOnHosts/.test(b) && /_selOnHosts\.add\(c\)/.test(js) && /_selOnHosts\.delete\(c\)/.test(js));
  ok('편집 상자의 선택 허락은 그대로 둔다', /classList\.contains\('edit'\)\) return;/.test(b));
}

/* ── ⑦ 실시간 커서: 편집 중에는 천천히, 헛재기 금지 ────────────────── */
{
  const bt = code(body('liveFastTick'));
  ok('편집 중에는 LIVE_EDIT_MS 로만 보낸다 (40ms 진동 해제)',
    /need=act\?LIVE_EDIT_MS:LIVE_RATE_MS/.test(bt) && /if\(!liveMoved && now-_liveLastPoll<need\) return;/.test(bt));
  ok('LIVE_EDIT_MS 는 똥컴에서 더 길다', /const LIVE_EDIT_MS=\(typeof sdyTurbo==='function'&&sdyTurbo\(\)\)\?700:250;/.test(js));
  const bc = code(body('liveCaretPos'));
  ok('캐럿 좌표는 선택이 안 바뀌면 다시 재지 않는다', /if\(key===_caretKey&&_caretVal\) return _caretVal;/.test(bc));
  ok('좌표 열쇠에 선택 문자열 직렬화를 쓰지 않는다 (문서 전체 훑기)', !/sel\.toString\(\)/.test(bc));
  ok('종이를 통째로 훑지 않고 편집 상자의 종이만 잰다', /content\.closest\('\.paper'\)/.test(bc));
  ok('입력(input)이 캐시 무효화 신호를 올린다', /w\._caretV=\(w\._caretV\|\|0\)\+1;/.test(js));
  const bd = code(body('drawPeers'));
  ok('보여 줄 커서도 이미 떠 있는 것도 없으면 DOM 을 건드리지 않는다',
    /!document\.getElementById\('liveLayer'\)&&!document\.getElementById\('liveLegend'\)\) return;/.test(bd));
  ok('그 판단에 class 전수 조사를 쓰지 않는다', !/querySelector\('\.live-cur'\)/.test(bd));
}

console.log(`\n편집 진입 렉 제거 계약: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
