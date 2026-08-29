/* 14.13.8 · 플로팅 창 이동범위(엽스코드 · 단어카드 · 음악플레이어) 환경별 검증
   ---------------------------------------------------------------------------
   창은 position:fixed 로 style.left/top 에 'UI CSS px' 를 놓고, 화면 좌표는
   html{zoom:.9} 때문에 화면 px 를 쓴다. 문제는 브라우저마다(같은 브라우저도
   배율에 따라) window.innerWidth / clientWidth / visualViewport / offsetWidth /
   getBoundingClientRect 가 리포트하는 단위가 제각각이라는 것. 예전 경계 코드는
   그 값들을 섞어 화면 폭을 '추정'했고, 추정치가 작으면 오른쪽 10% 가량이 창이
   갈 수 없는 영역으로 남았다.

   지금은 추정 대신 '창과 같은 좌표계의 자' 로 직접 잰다. 이 테스트는 그 자를
   각기 다르게 리포트하는 가짜 브라우저 6종을 만들어 전부 같은 결과가 나오는지
   본다 — 즉 "환경 유형과 무관하게, 이동범위는 모니터 안쪽 전체".

   sdynotes.js 의 FLOAT-BOUNDS 블록만 뽑아 그대로 eval 하므로, 실제로 배포되는
   코드가 검증된다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const BEGIN = '/* FLOAT-BOUNDS:BEGIN */';
const END = '/* FLOAT-BOUNDS:END */';
const i0 = js.indexOf(BEGIN), i1 = js.indexOf(END);
assert.ok(i0 > 0 && i1 > i0,
  'FLOAT-BOUNDS 마커가 sdynotes.js 맨 앞 블록을 감싸고 있어야 한다');
const block = js.slice(i0 + BEGIN.length, i1);

/* ── 가짜 브라우저 ───────────────────────────────────────────────────────
   rectMode   : 'zoomed'   → getBoundingClientRect 가 배율을 반영 (화면 px)
                'unzoomed' → 반영하지 않 (레이아웃 px) — WebKit 의 오래된 동작
   offsetMode : 'unzoomed' → offsetWidth = 창이 쓰는 단위
                'zoomed'   → offsetWidth 에 배율을 씌워 줌
   *Mode      : 그 API 가 리포트하는 단위 ('screen' | 'ui')                    */
function makeEnv(e) {
  const K = e.K;                                    // 화면 px = UI px × K
  const uiW = Math.round(e.screenW / K), uiH = Math.round(e.screenH / K);
  const rectUnit = e.rectMode === 'zoomed' ? K : 1; // rect 값 = UI px × rectUnit
  const offUnit = e.offsetMode === 'zoomed' ? K : 1;
  const pick = (mode, ui, screen) => mode === 'ui' ? ui : screen;

  const probeFor = (id, wUi, hUi) => ({
    id, isConnected: true, style: {},
    setAttribute() { },
    getBoundingClientRect: () => ({
      left: 0, top: 0, width: wUi * rectUnit, height: hUi * rectUnit,
      right: wUi * rectUnit, bottom: hUi * rectUnit,
    }),
    offsetWidth: Math.round(wUi * offUnit), offsetHeight: Math.round(hUi * offUnit),
  });

  const els = new Map();
  if (e.probes !== false) {
    els.set('uiZoomProbeGlobal', probeFor('uiZoomProbeGlobal', 100, 0));
    els.set('uiViewportProbeGlobal', probeFor('uiViewportProbeGlobal', uiW, uiH));
  }
  const document = {
    body: els.size ? { appendChild() { } } : null,
    documentElement: e.noDoc ? null : {
      clientWidth: pick(e.clientWidthMode, uiW, e.screenW),
      clientHeight: pick(e.clientHeightMode, uiH, e.screenH),
      appendChild() { },
    },
    getElementById: id => els.get(id) || null,
    createElement: () => ({ style: {}, setAttribute() { } }),
  };
  const window = {
    innerWidth: pick(e.innerWidthMode, uiW, e.screenW),
    innerHeight: pick(e.innerHeightMode, uiH, e.screenH),
    visualViewport: e.vv === false ? null : {
      width: pick(e.vv, uiW, e.screenW), height: pick(e.vv, uiH, e.screenH),
    },
  };
  new Function('window', 'document', block)(window, document);

  /* 창 하나 — w·h 는 '창이 쓰는 단위'(UI px), x·y 는 지금 놓인 위치. */
  const win = (w, h, x = 0, y = 0) => ({
    offsetWidth: Math.round(w * offUnit), offsetHeight: Math.round(h * offUnit),
    getBoundingClientRect: () => ({
      left: x * rectUnit, top: y * rectUnit,
      width: w * rectUnit, height: h * rectUnit,
      right: (x + w) * rectUnit, bottom: (y + h) * rectUnit,
    }),
  });

  return { K, uiW, uiH, screenW: e.screenW, screenH: e.screenH, win, window, document };
}

const ENVS = [
  ['chrome · 90% 사이트 배율', {
    K: 0.9, screenW: 1920, screenH: 1080, rectMode: 'zoomed', offsetMode: 'unzoomed',
    innerWidthMode: 'screen', clientWidthMode: 'ui', vv: 'screen',
  }],
  ['레거시 엔진 · clientWidth 마저 화면 px (visualViewport 없음)', {
    K: 0.9, screenW: 1920, screenH: 1080, rectMode: 'zoomed', offsetMode: 'unzoomed',
    innerWidthMode: 'screen', clientWidthMode: 'screen', vv: false,
  }],
  ['webkit 계열 · gBCR 이 zoom 을 반영하지 않 (배율 자동 1.0)', {
    K: 0.9, screenW: 1920, screenH: 1080, rectMode: 'unzoomed', offsetMode: 'unzoomed',
    innerWidthMode: 'screen', clientWidthMode: 'screen', vv: 'screen',
  }],
  ['offsetWidth 에 배율을 씌워 리포트하는 엔진', {
    K: 0.9, screenW: 1920, screenH: 1080, rectMode: 'zoomed', offsetMode: 'zoomed',
    innerWidthMode: 'screen', clientWidthMode: 'screen', vv: 'screen',
  }],
  ['폰 · 배율 100%', {
    K: 1, screenW: 390, screenH: 844, rectMode: 'zoomed', offsetMode: 'unzoomed',
    innerWidthMode: 'screen', clientWidthMode: 'ui', vv: 'screen',
  }],
  ['프로브가 아직 레이아웃되기 전 (첫 프레임) → 추정 폴백', {
    /* 프로브도 100px 자도 아직 못 재는 순간. innerWidth 계열은 화면 px,
       documentElement.clientWidth/Height 는 UI px 로 리포트되는(크롬) 환경을
       가정한다 — 폴백은 '어느 쪽인지 모른 채 큰 해석' 을 택한다. */
    K: 0.9, screenW: 1920, screenH: 1080, rectMode: 'zoomed', offsetMode: 'unzoomed',
    innerWidthMode: 'screen', innerHeightMode: 'screen',
    clientWidthMode: 'ui', clientHeightMode: 'ui', vv: 'screen', probes: false,
  }],
];

const pass = [];
const check = (name, cond, extra) => {
  assert.ok(cond, name + (extra ? ' — ' + extra : ''));
  pass.push(name);
};

/* 대표 창 크기: 단어카드 760×640 · 음악플레이어 880×647 · 엽스코드 370×580 · 작은 팝업 */
const WINS = [[760, 640], [880, 647], [370, 580], [200, 120]];

for (const [label, spec] of ENVS) {
  const env = makeEnv(spec);
  const box = env.window.sdyViewportBox();
  check(`${label} · 화면 사각형`, Math.abs(box.w - env.uiW) <= 1 && Math.abs(box.h - env.uiH) <= 1,
    `측정 ${box.w}×${box.h} / 실제 ${env.uiW}×${env.uiH}`);

  for (const [w, h] of WINS) {
    const el = env.win(w, h);
    const tag = `${label} · ${w}×${h}`;

    /* 화면보다 큰 축(저해상도 폰·전체화면 모핑)은 '왼쪽 위 0' 에 붙이는 것이
       최선이다 — 무리하게 양쪽 벽에 끼우면 창이 통째로 잘려 보이지 않는다. */
    const fitsW = w + 16 <= env.uiW, fitsH = h + 16 <= env.uiH;

    // ① 오른쪽(아래) 끝까지 갈 수 있다 — 경계가 '화면 폭 − 창 폭' 으로 계산돼야 한다.
    const far = env.window.sdyClampFloatingRect(el, 999999, 999999);
    const rightGap = env.uiW - (far.x + w), bottomGap = env.uiH - (far.y + h);
    check(`${tag} · 우측 도달`,
      fitsW ? (rightGap <= 8.5 && rightGap >= 7) : far.x === 0,
      `오른쪽 여유 ${rightGap.toFixed(1)}px (창 ${w} / 화면 ${env.uiW})`);
    check(`${tag} · 하단 도달`,
      fitsH ? (bottomGap <= 8.5 && bottomGap >= 7) : far.y === 0);

    // ② 들어갈 수 있는 창은 모니터 밖으로 한 픽셀도 나가지 않는다.
    if (fitsW && fitsH)
      check(`${tag} · 화면 안`, far.x >= 8 && far.y >= 8 &&
        far.x + w <= env.uiW + 0.5 && far.y + h <= env.uiH + 0.5,
        `x=${far.x} 오른쪽 끝=${far.x + w} / 화면=${env.uiW}`);

    // ③ 왼쪽·위쪽도 같은 안전 여백.
    const near = env.window.sdyClampFloatingRect(el, -999999, -999999);
    check(`${tag} · 좌측 도달`, near.x === (fitsW ? 8 : 0) && near.y === (fitsH ? 8 : 0));

    // ④ 이미 밖으로 나간 창은 가장 가까운 벽으로 되돌아온다 (잡으면 바로 보인다).
    if (fitsW) {
      const out = env.win(w, h, env.uiW + 400, 40);
      const back = env.window.sdyClampFloatingRect(out, env.uiW + 400, 40);
      check(`${tag} · 밖에서 되돌아오기`, back.x + w <= env.uiW + 0.5 && back.x >= 8);
    }
  }

  // ⑤ 창이 화면보다 크면(전체화면 모핑·저해상도) 양 벽에 눌리지 않는다.
  const big = env.window.sdyClampFloatingRect(env.win(env.uiW + 300, 200), 5000, 5000);
  check(`${label} · 화면보다 큰 창`, big.x >= 0 && big.y >= 0, `x=${big.x}`);
}

/* ⑥ 아무 것도 잴 수 없는 환경(백그라운드 탭·비정상 DOM)에서는 창을 0 으로
      붙이지 않는다 — '창이 왼쪽 벽에 달라붙는' 회귀의 원인. */
{
  const env = makeEnv({
    K: 1, screenW: 0, screenH: 0, rectMode: 'zoomed', offsetMode: 'unzoomed',
    innerWidthMode: 'screen', clientWidthMode: 'screen', vv: false, probes: false, noDoc: true,
  });
  const c = env.window.sdyClampFloatingRect(env.win(300, 200), 412, 77);
  check('재지 못하면 좌표 보존', c.x === 412 && c.y === 77, JSON.stringify(c));
}

console.log(`floating window bounds · ${pass.length}건 ok (${ENVS.length}개 환경 × ${WINS.length}종 창)`);
