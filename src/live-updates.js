(function(){
  // 12.8 · 설정/암기카드/음악은 서버가 살아 있는 동안 SSE로 즉시 알리고,
  // 스트림이 끊기면 각 기능의 기존 폴링/재시도 로직이 이어받는다.
  let es,again,closed=false;
  function on(){
    if(closed||!navigator.onLine) { clearTimeout(again); again=setTimeout(on,5000); return; }
    try{
      es=new EventSource('/api/live');
      es.addEventListener('sdy',e=>{
        let m; try{m=JSON.parse(e.data)}catch(_){return}
        if(m.topic==='settings'&&typeof pullSettings==='function') pullSettings();
        if(m.topic==='notes'){
          try{
            if(typeof curNB!=='undefined'&&curNB&&(m.key===curNB.id||!m.key)&&typeof pullSync==='function'){
              clearTimeout(window.__sdyNotesLiveT);
              window.__sdyNotesLiveT=setTimeout(()=>{ pullSync(false); }, 60);
            }
          }catch(_){}
        }
        if(m.topic==='cards'){
          try{
            const cm=document.getElementById('cardsModal');
            if(cm&&cm.style.display!=='none'&&typeof loadDecks==='function') loadDecks(true);
          }catch(_){}
        }
        if(m.topic==='stickers'){
          try{
            const sm=document.getElementById('stickerModal');
            if(sm&&sm.style.display!=='none'&&typeof openStickers==='function') openStickers();
          }catch(_){}
        }
        if(m.topic==='music'){
          try{
            clearTimeout(window.__sdyMusicLiveT);
            window.__sdyMusicLiveT=setTimeout(()=>{if(window.sdyRefreshMusic) window.sdyRefreshMusic(false);},900);
          }catch(_){}
        }
      });
      es.onerror=()=>{
        try{es.close()}catch(_){}
        clearTimeout(again); again=setTimeout(on,2500);
      };
    }catch(_){ clearTimeout(again); again=setTimeout(on,5000); }
  }
  addEventListener('online',()=>{clearTimeout(again);on()});
  addEventListener('offline',()=>{try{es&&es.close()}catch(_){}});
  addEventListener('pagehide',()=>{closed=true;try{es&&es.close()}catch(_){} });
  on();
})();
