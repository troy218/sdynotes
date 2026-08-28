// 14.13.5 · jsdom 테스트 해체(guard) 헬퍼 — 여러 런타임 계약 테스트가 공유한다.
//
// 문제: 앱의 동기화 체인(queueSync → 250ms debounce → fetch 왕복 → syncEnd → 450ms
// 꼬리 타이머)이 window.close() 후에 계속 부분(continuation)을 돌리면 document 가
// 이미 꺼진 상태라 'Cannot read properties of undefined' 로 테스트 프로세스 전체가
// 크래시했다. (종이 스크롤·노트 전환 같은 테스트에서는 2~3회 중 1회 빈도)
//
// 사용:
//   import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
//   // JSDOM 옵션 beforeParse:
//   beforeParse(window) { installWindowGuard(window); ... }
//   // finally:
//   await closeDoms([domA, domB]);
//   child.kill('SIGTERM');

// window 의 타이머를 전부 추적하도록 감싸서 close 전에 일괄 정리할 수 있게 한다.
export function installWindowGuard(window) {
  if (window.__sdyGuardInstalled) return;
  window.__sdyGuardInstalled = true;
  const live = new Set();
  const rawSet = window.setTimeout.bind(window);
  const rawClear = window.clearTimeout.bind(window);
  window.__sdyClearTimers = () => { for (const id of live) rawClear(id); live.clear(); };
  window.setTimeout = (fn, ms, ...a) => { const id = rawSet(fn, ms, ...a); live.add(id); return id; };
  window.clearTimeout = (id) => { live.delete(id); return rawClear(id); };
}

// close 전: 진행 중인 동기화 체인(싱크바 'on' 이 꺼질 때까지)을 기다리고 남은
// 타이머를 정리한 뒤 각 window 를 안전하게 닫는다.
export async function closeDoms(doms, { syncDrainMs = 3000, tailMs = 500 } = {}) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + syncDrainMs;
  for (const d of doms) {
    if (!d || !d.window) continue;
    while (Date.now() < deadline) {
      let bar = null;
      try { bar = d.window.document && d.window.document.getElementById('syncBar'); } catch { break; }
      if (!bar || !bar.classList.contains('on')) break;
      await wait(150);
    }
  }
  await wait(tailMs); // syncEnd 의 450ms 꼬리 타이머까지 포함
  for (const d of doms) {
    if (!d || !d.window) continue;
    try { d.window.__sdyClearTimers && d.window.__sdyClearTimers(); } catch {}
    try { d.window.close(); } catch {}
  }
}
