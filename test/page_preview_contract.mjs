/* 20.0 · '읽기 우선(어크로뱃 방식)' 쪽 미리보기 계약
 *
 * 가져온 문서를 읽을 때는 쪽 그림 <img> 한 장만 띄우고, 편집 요소 DOM 은
 * 사용자가 그 쪽을 실제로 건드릴 때만 만든다. 쪽 '안'의 요소 수(논문은 글상자
 * 수백 개 + 단어 span 수천 개)에 비례하던 비용을 읽기 경로에서 걷어내는 것이
 * 이 구조의 전부다. 아래 계약이 깨지면 그 비용이 그대로 되돌아온다.
 *
 * 안전(절대 깨지면 안 되는 것)
 *   · 문서 데이터(doc.pages)는 미리보기 경로 어디서도 바뀌지 않는다.
 *   · 편집한 쪽은 원본 그림으로 되돌아가지 않는다(편집분이 가려지면 안 된다).
 *   · 그림을 못 받는 문서는 자동으로 예전 요소 렌더로 폴백한다.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(root, 'sdynotes.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sdynotes.css'), 'utf8');
const py = fs.readFileSync(path.join(root, 'worker/sdynotes_worker/importer.py'), 'utf8');
const idx = fs.readFileSync(path.join(root, 'server/src/index.js'), 'utf8');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
const fnSrc = (name) => {
  const at = js.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' 함수가 있어야 한다');
  const end = js.indexOf('\n    }', at);
  return js.slice(at, end > 0 ? end + 6 : at + 4000);
};

// ── 워커: 쪽 래스터 엔드포인트 ────────────────────────────────────────
ok('워커가 쪽 미리보기 엔드포인트를 제공한다',
  /@app\.route\("\/api\/import\/page\/<ref>\/<int:pno>"/.test(py));
ok('미리보기 파일 이름은 (ref, 쪽, 폭) 의 순수 함수다 (영구 캐시 가능)',
  /def _preview_name\(ref, pno, width\)/.test(py)
  && /hashlib\.sha1\(key\)/.test(py));
ok('요청 폭은 정해진 단계로 스냅해 캐시 적중률을 지킨다',
  /PREVIEW_WIDTHS = \(/.test(py)
  && /min\(PREVIEW_WIDTHS, key=lambda w: abs\(w - width\)\)/.test(py));
ok('같은 쪽을 동시에 요청해도 한 번만 굽는다 (쪽별 락 + 이중 확인)',
  /def _preview_lock\(name\)/.test(py)
  && /with _preview_lock\(name\):[\s\S]{0,120}if not os\.path\.exists\(path\)/.test(py));
ok('미리보기는 원본 그대로 렌더한다 (redact 없이)',
  /def _render_preview\(src, pno, width, out_path\)/.test(py)
  && !/add_redact_annot/.test(py.slice(py.indexOf('def _render_preview'),
                                       py.indexOf('def import_page_preview'))));
ok('구운 그림은 원자적으로 저장한다 (반쯤 쓴 파일이 캐시되지 않게)',
  // 14.32.3 · 임시 이름도 반드시 .jpg 로 끝나야 한다 — Pixmap.save 는 '확장자'로
  //   저장 형식을 정하므로 확장자 없는 tmp 꼬리는 항상 500 이었다(미리보기 전멸).
  /tmp = "%s\.tmp\.%s\.jpg" % \(out_path/.test(py) && /os\.replace\(tmp, out_path\)/.test(py));
ok('미리보기는 영구 캐시 헤더로 나간다',
  /public, max-age=31536000, immutable/.test(py));
ok('메인 서버가 미리보기 경로를 워커로 프록시한다',
  /'\/api\/import\/page\/:ref\/:pno'/.test(idx));

// ── 프런트: 읽기/편집 두 상태 ─────────────────────────────────────────
ok('종이 셸에 미리보기 레이어가 있다',
  /class="layer layer-preview"/.test(js) && /mountPagePreview\(paper,i\)/.test(js));
ok('미리보기 레이어는 편집 요소보다 뒤에 깔린다',
  /\.layer-preview\{z-index:1;/.test(css) && /\.layer-img\{z-index:2;\}/.test(css)
  && /\.page-preview-img\{/.test(css));

const mount = fnSrc('mountPagePreview');
ok('미리보기는 가져온 문서에서만, 이미 깨운 쪽에는 붙이지 않는다',
  /previewCapable\(\)/.test(mount) && /activatedPages\.has\(pi\)/.test(mount));
ok('편집된 쪽에는 원본 그림을 절대 붙이지 않는다',
  /if\(pageEdited\(pi\)\) return false;/.test(mount));
ok('그림을 못 받으면 예전 요소 렌더로 자동 폴백한다',
  /img\.onerror=/.test(mount) && /_pvFailed\.add\(pi\)/.test(mount)
  && /renderPageEls\(pi\)/.test(mount));
ok('폴백이 몇 번 반복되면 그 문서는 통째로 예전 경로를 쓴다',
  /_pvUnsupported=true/.test(mount));

const maintain = fnSrc('maintainPageWindow');
ok('읽기만 하는 쪽은 편집 요소를 만들지 않는다',
  /const needEls=/.test(maintain)
  && /if\(needEls\(center\)\)\{/.test(maintain));
ok('편집 도구가 켜져 있으면 읽기 쪽도 요소를 그린다',
  /editingModeOn\(\)/.test(maintain));
ok('읽기 상태에서는 이웃 쪽 예열도 하지 않는다',
  /if\(!needEls\(center\)\) return;/.test(maintain));

const act = fnSrc('activatePage');
ok('쪽을 깨우면 편집 요소를 그린다',
  /activatedPages\.add\(pi\)/.test(act) && /renderPageEls\(pi\)/.test(act));
ok('그림은 요소가 다 올라온 뒤에 걷는다 (깜빡임 없이 교대)',
  /if\(activatedPages\.has\(idx\)\) dropPagePreview\(idx\)/.test(js));

ok('종이를 누르면 그 쪽이 편집 상태가 된다',
  /try\{ activatePage\(pageIdx\); \}catch\(_e\)\{\}/.test(js)
  && /try\{ activatePage\(i\); \}catch\(_e\)\{\}/.test(js));
ok('새로 올라오는 종이도 편집 도구가 켜져 있으면 편집 상태를 물려받는다',
  /if\(activatedPages\.has\(i\)\|\|editingModeOn\(\)\) activatePage\(i\)/.test(js));
ok('펜·글상자·메모·찾기·단어분석은 보이는 쪽을 깨운다',
  (js.match(/activateVisiblePages\(\)/g) || []).length >= 5);

// ── 편집분 보호 ───────────────────────────────────────────────────────
ok('편집한 쪽은 문서 데이터에 표시가 남는다 (재열람에도 유지)',
  /function markPageEdited\(pi\)/.test(js) && /pg\.edited=1;/.test(js)
  && /if\(pg\.edited\) copy\.edited=1;/.test(js)
  && /\.\.\.\(pg\.edited\?\{edited:1\}:\{\}\)/.test(js));
ok('편집 커밋 경로가 __dirty 직접 대입 대신 markPageEdited 를 쓴다',
  !/doc\.pages\[\+w\.dataset\.pageIdx\]\.__dirty=true/.test(js));
ok('한 번 깨운 쪽은 요소를 회수해도 그림으로 되돌아가지 않는다',
  !/activatedPages\.delete\(/.test(js));

// ── 안전: 문서 데이터 불변 ────────────────────────────────────────────
for (const fn of ['mountPagePreview', 'dropPagePreview', 'previewURL', 'previewWidth']) {
  const src = fnSrc(fn);
  assert.ok(!/doc\.pages\[[^\]]*\]\s*=/.test(src) && !/\.els\s*=/.test(src),
    fn + ' 은 문서 데이터를 건드리면 안 된다');
}
ok('미리보기 경로 어디서도 문서 데이터를 쓰지 않는다', true);

console.log(`\n쪽 미리보기(읽기 우선): PASS ${pass}`);
