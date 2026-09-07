/* 13.0 · 유휴 상태(Idle) 감지 및 적극적인 백그라운드 작업 처리 (음악 태그/가사 백필 및 아웃박스 동기화) */
(function(){
  let _idleTimer = null;
  let _isIdle = false;
  const IDLE_TIMEOUT_MS = 8000;

  function onUserActive(){
    if(_idleTimer) clearTimeout(_idleTimer);
    _isIdle = false;
    _idleTimer = setTimeout(triggerIdleWork, IDLE_TIMEOUT_MS);
  }

  function triggerIdleWork(){
    _isIdle = true;
    const run = ()=>{
      try {
        if(typeof flushOutbox === 'function') flushOutbox(false);
      } catch(e){}
      try {
        if(typeof fetch === 'function'){
          fetch('/api/music/background-work', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({idle: true})
          }).catch(()=>{});
        }
      } catch(e){}
      if(_isIdle){
        _idleTimer = setTimeout(triggerIdleWork, 35000);
      }
    };

    if('requestIdleCallback' in window){
      requestIdleCallback(run, {timeout: 3000});
    } else {
      setTimeout(run, 150);
    }
  }

  ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach(evt=>{
    window.addEventListener(evt, onUserActive, {passive: true});
  });

  _idleTimer = setTimeout(triggerIdleWork, 6000);
})();

