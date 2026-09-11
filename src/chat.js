/* === script block 10 === */

(function(){
  if(window.__ypInit) return; window.__ypInit = true;
  // The chat module is also bundled for single-file/offline clients. Keep it
  // harmless when a consumer evaluates the shared frontend without the chat
  // markup (for example, an AI-only surface or an embedded editor).
  if(!document.getElementById('ypApp')) return;
  var $=function(id){return document.getElementById(id);};
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
  var TTEK='<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.2 V12.6"/><path d="M9.2 12.6 H14.8"/><path d="M9.2 12.6 V9.2"/><path d="M12 12.6 V8.6"/><path d="M14.8 12.6 V9.2"/><rect x="5.6" y="7.4" width="12.8" height="4.2" rx="2.1" fill="#ef4444"/><rect x="5.6" y="7.4" width="12.8" height="1.2" rx="0.6" fill="#fca5a5" opacity=".55"/></svg>';
  var REFRESH='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
  // ── 18.3 · 해돌이 임티 (카톡 미모티콘식) ──────────────────────────────
  //   유니코드 이모지 대신 #ypStickerDefs 의 <template data-stk=…> 블록을 쓴다.
  //   새 채팅은 텍스트와 별도 stickers 배열로 저장·전송해 입력창에 코드가 보이지 않는다.
  //   예전 [hd:아이디] 텍스트도 계속 그림으로 렌더한다.
  //   (새 임티를 추가하면 선택창·반응이 자동으로 따라간다 — server REACTIONS 는
  //    hd: 접두사면 어떤 아이디든 받는다)
  var REACTIONS=['hd:hello','hd:love','hd:idea','hd:read','hd:coffee','hd:sleep'];
  var STK_CODE=/^hd:([a-z0-9_-]{1,24})$/;
  var STK_ID=/^[a-z0-9_-]{1,24}$/;
  var STK_TEXT=/\[hd:([a-z0-9_-]{1,24})\]/g;
  var YP_STK=(function(){
    var box=document.getElementById('ypStickerDefs');
    function defs(){ return box?box.querySelectorAll('template[data-stk]'):[]; }
    function list(){
      var out=[]; defs().forEach(function(t){
        out.push({id:t.getAttribute('data-stk'), label:t.getAttribute('data-label')||t.getAttribute('data-stk')});
      }); return out;
    }
    function node(id){
      if(!box) return null;
      var t=null; defs().forEach(function(x){ if(x.getAttribute('data-stk')===id) t=x; });
      if(!t) return null;
      var el=t.content.cloneNode(true).firstElementChild;
      return el||null;
    }
    function svg(id,cls){
      var el=node(id); if(!el) return null;
      // 템플릿에 붙어 있던 동작 클래스(om-w-mail · om-w-sleep …)는 꼭 지켜야
      // 채팅에서도 실제로 움직이는 SVG 로 보인다. yp-stk/크기 클래스만 더한다.
      el.classList.add('yp-stk');
      if(cls) cls.split(/\s+/).forEach(function(c){ if(c) el.classList.add(c); });
      return el;
    }
    return { list:list, node:node, svg:svg,
             code:function(id){ return '[hd:'+id+']'; } };
  })();
  // 텍스트 안의 예전 [hd:…] 코드와 새 stickers 배열을 임티 그림으로 바꾼다 (혼합 메시지용)
  function ypStkRenderText(el,text,stickers){
    el.textContent='';
    text=String(text||'');
    var last=0, m;
    STK_TEXT.lastIndex=0;
    while((m=STK_TEXT.exec(text))){
      if(m.index>last) el.appendChild(document.createTextNode(text.slice(last,m.index)));
      var s=YP_STK.svg(m[1],'yp-stk-inline');
      if(s) el.appendChild(s); else el.appendChild(document.createTextNode(m[0]));
      last=m.index+m[0].length;
    }
    if(last<text.length) el.appendChild(document.createTextNode(text.slice(last)));
    ypStkIds(stickers).forEach(function(id){
      if(el.childNodes.length) el.appendChild(document.createTextNode(' '));
      var s=YP_STK.svg(id,'yp-stk-inline');
      if(s) el.appendChild(s); else el.appendChild(document.createTextNode('[임티]'));
    });
  }
  // 메시지 전체가 임티 하나면 큰 스티커로 보여 준다 (카톡 미모티콘처럼)
  function ypStkOnly(msgOrText){
    if(msgOrText && typeof msgOrText==='object'){
      var ids=ypStkIds(msgOrText.stickers);
      if(ids.length===1 && !String(msgOrText.text||'').trim()) return ids[0];
      return null;
    }
    var m=(msgOrText||'').trim().match(/^\[hd:([a-z0-9_-]{1,24})\]$/);
    return m?m[1]:null;
  }
  function ypStkReact(id){
    var m=STK_CODE.exec(id); STK_CODE.lastIndex=0;
    if(!m) return null;
    var el=YP_STK.svg(m[1],'yp-stk-chip');
    return el;
  }
  function ypStkIds(v){
    var src=Array.isArray(v)?v:(v?[v]:[]), out=[];
    src.forEach(function(raw){
      var id=String(raw||'').trim().toLowerCase();
      if(STK_ID.test(id)&&out.indexOf(id)<0&&out.length<6) out.push(id);
    });
    return out;
  }
  function ypSameStickers(a,b){
    a=ypStkIds(a); b=ypStkIds(b);
    if(a.length!==b.length) return false;
    for(var i=0;i<a.length;i++){ if(a[i]!==b[i]) return false; }
    return true;
  }
  function ypMsgStickers(m){ return ypStkIds(m&&m.stickers); }
  // 테스트·디버그용 훅 (기존 __ypReact/__ypEnter 와 같은 패턴)
  window.__ypStk={list:YP_STK.list,svg:YP_STK.svg,code:YP_STK.code,only:ypStkOnly,render:ypStkRenderText,ids:ypStkIds};
  var LIVE_ADJ=['연보라','복숭아빛','민트색','하늘색','살구색','라벤더','코랄빛','레몬색','장미빛','청포도','피치','시나몬','솜사탕','아이보리','라일락','청옥','버터','멜론','구름빛','연분홍'];
  var LIVE_ANI=['까치','참새','박새','멧비둘기','직박구리','제비','백로','왜가리','뻐꾸기','물총새','두루미','기러기','청둥오리','저어새','꾀꼬리','동박새','오목눈이','수리부엉이','팔색조','호반새','파랑새','후투티','원앙','종달새'];
  var YP={
    uid:(function(){try{var v=sessionStorage.getItem('sdy_yp_uid');if(!v){v='yp_'+Math.random().toString(36).slice(2,10);sessionStorage.setItem('sdy_yp_uid',v);}return v;}catch(e){return 'yp_'+Math.random().toString(36).slice(2,10);}})(),
    name:'', me:null, msgs:[], members:new Map(), ttl:86400, joined:false,
    es:null, ping:null, inVoice:false, joiningVoice:false, muted:false, localStream:null,
    conn:new Map(), speaking:new Map(), actx:null, open:false,
    seen:new Set(), bgm:null, stick:true, draftStickers:[], _lastSendKey:null, _lastSendAt:0,
    // 서버 릴레이 음성 상태
    relayWs:null, relayNodes:null, relayRx:{}, relayOn:false, _relayStop:false, _relayRT:null,
    _relayUrl:null, _relayHb:null, _relayDest:null, _relayEl:null
  };
  var YPS=(function(){
    var d={nick:'',sound:true,sys:true,desk:true};
    try{ var v=localStorage.getItem('sdy_yp_settings'); if(v){ var o=JSON.parse(v); for(var k in d){ if(k in o) d[k]=o[k]; } } }catch(e){}
    return d;
  })();
  function ypsSave(){ try{ localStorage.setItem('sdy_yp_settings', JSON.stringify(YPS)); }catch(e){} }

  function ypName(){
    // 16.2 · 로그인 중이면 무조건 회원 고정닉 (서버도 강제한다)
    try{ var au=window.sdyUser&&window.sdyUser(); if(au&&au.nick) return String(au.nick).trim().slice(0,24); }catch(e){}
    if(YPS.nick && YPS.nick.trim()) return String(YPS.nick).trim().slice(0,24);
    try{ if(typeof liveName==='function'){ var n=liveName(); if(n&&n.trim()) return n; } }catch(e){}
    try{ var v=localStorage.getItem('sdy_uname_v2'); if(v&&v.trim()) return v; }catch(e){}
    return '익명 새';
  }
  function ypNewBird(){ var a=LIVE_ADJ[(Math.random()*LIVE_ADJ.length)|0], b=LIVE_ANI[(Math.random()*LIVE_ANI.length)|0]; return a+' '+b; }
  function ypNearBottom(){ var b=$('ypBody'); return b.scrollHeight-b.scrollTop-b.clientHeight < 110; }
  function ypTime(ts){ var d=new Date(ts*1000); return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }
  function ypSize(n){ if(n>=1048576) return (n/1048576).toFixed(1)+' MB'; if(n>=1024) return Math.round(n/1024)+' KB'; return n+' B'; }

  function ypGetActx(){
    try{ var AC=window.AudioContext||window.webkitAudioContext; if(!AC) return null;
      if(!YP.actx) YP.actx=new AC();
      if(YP.actx.state==='suspended') YP.actx.resume().catch(function(){});
      return YP.actx;
    }catch(e){ return null; }
  }
  function ypBeep(type){
    try{
      var ctx=ypGetActx(); if(!ctx) return;
      var t=ctx.currentTime;
      if(type==='msg'){
        var o=ctx.createOscillator(), g=ctx.createGain();
        o.type='sine'; o.frequency.value=920;
        g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.07,t+0.012); g.gain.exponentialRampToValueAtTime(0.0001,t+0.13);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t+0.15);
      } else if(type==='knock'){
        [0,0.19].forEach(function(d){
          var o2=ctx.createOscillator(), g2=ctx.createGain();
          o2.type='square'; o2.frequency.value=170;
          g2.gain.setValueAtTime(0.0001,t+d); g2.gain.exponentialRampToValueAtTime(0.14,t+d+0.012); g2.gain.exponentialRampToValueAtTime(0.0001,t+d+0.1);
          o2.connect(g2); g2.connect(ctx.destination); o2.start(t+d); o2.stop(t+d+0.12);
        });
      }
    }catch(e){}
  }
  // 16.x · 데스크톱 알림은 빨리 사라지게 — 노크·톡 알림이 한참 남아 있지 않도록
  //   기본 Notification 은 브라우저가 알아서 치우지만, 그게 너무 길다.
  //   requireInteraction 을 끄고, 2.5초 뒤에 직접 닫는다.
  function ypNotify(title, body){
    try{
      if(!('Notification' in window) || Notification.permission!=='granted') return;
      var n=new Notification(title,{body:body,tag:'yp-'+Date.now(),renotify:false,silent:false});
      var closed=false;
      var close=function(){ if(closed) return; closed=true; try{n.close();}catch(e){} };
      setTimeout(close,2500);
      try{ n.onclick=function(){ window.focus(); close(); }; }catch(e){}
    }catch(e){}
  }
  // 16.x · 카카오 보이스톡처럼 통화 이벤트를 음성으로 피드백한다
  //   - 내가 통화에 들어가면: "통화에 연결되었습니다"
  //   - 다른 사람이 통화에 들어오면: "○○ 님이 들어왔어요"
  //   - 다른 사람이 통화를 나가면: "○○ 님이 나갔어요"
  //   - 통화를 끊으면: "통화가 종료되었습니다"
  //   - 통화가 끊겼다 다시 붙으면: "통화를 다시 연결했어요"
  //   통화 중이 아니면 말하지 않는다(입장·퇴장과 혼동되지 않게).
  //   사용자가 음성 피드백을 끌 수 있게 설정의 '입장·퇴장 알림' 스위치를 공유한다.
  var _ypSayTok=0;
  function ypSay(text){
    try{
      if(!text) return;
      if(!YPS.sys) return;
      if(!('speechSynthesis' in window)) return;
      if(!window.SpeechSynthesisUtterance) return;
      // 이전 음성을 빨리 끊고 새 음성을 바로 말한다 (쌓이지 않게)
      try{ window.speechSynthesis.cancel(); }catch(e){}
      var u=new SpeechSynthesisUtterance(text);
      u.lang='ko-KR'; u.rate=1.05; u.pitch=1.0; u.volume=1.0;
      // 크롬에서 한국어 음성이 있으면 고른다
      try{
        var vs=window.speechSynthesis.getVoices();
        if(vs&&vs.length){
          var ko=vs.filter(function(v){ return v.lang && /^ko(-|_)/i.test(v.lang); });
          if(ko.length){ u.voice=ko[0]; }
        }
      }catch(e){}
      var tok=++_ypSayTok;
      u.onend=function(){ if(tok===_ypSayTok) return; };
      window.speechSynthesis.speak(u);
    }catch(e){}
  }
  // 통화에 들어갔을 때 이미 통화 중인 사람 이름을 말해 준다 (카톡 보이스톡처럼)
  function ypAnnouncePeers(){
    try{
      if(!YP.inVoice) return;
      var names=[];
      YP.members.forEach(function(m){
        if(m.uid!==YP.uid && m.voice) names.push(m.name||'익명');
      });
      if(!names.length) return;
      if(names.length===1) ypSay(names[0]+' 님과 통화 중이에요');
      else ypSay(names.slice(0,3).join(', ')+(names.length>3?' 외 '+(names.length-3)+'명':'')+' 와 통화 중이에요');
    }catch(e){}
  }
  function ypAskNotify(){
    try{ if('Notification' in window && Notification.permission==='default') Notification.requestPermission(); }catch(e){}
  }

  // ── 렌더 ──
  function ypSys(text){
    YP.msgs.push({kind:'sys',text:text,ts:Date.now()/1000});
    if(YP.msgs.length>200) YP.msgs.shift();
    ypRender(true);
  }
  function ypAddMsg(m){
    if(!m) return;
    for(var i=0;i<YP.msgs.length;i++){ if(YP.msgs[i].id===m.id) return; }
    // 서버가 준 진짜 메시지가 오면 같은 내용의 임시 메시지를 먼저 찾아 치환한다.
    // (SSE echo 와 POST 응답 중 먼저 도착하는 쪽이 처리하고, 나중 쪽은 id 중복으로 무시)
    // 14.57.0 · 임티만 전송(text='') 시 m.text가 falsy여서 임시 치환이 건너뛰어
    // SSE가 POST보다 먼저 오면 temp+real 두 개가 남던 버그 수정 — stickers까지 검사
    if(!m.temp && m.uid && (String(m.text||'').trim() || ypMsgStickers(m).length)){
      var j=ypFindTemp(m);
      if(j>=0){ YP.msgs.splice(j,1,m); if(YP.msgs.length>200) YP.msgs.shift(); ypRender(true); return; }
    }
    YP.msgs.push(m);
    if(YP.msgs.length>200) YP.msgs.shift();
    ypRender(true);
  }
  function ypGroupMsgs(){
    var groups=[], cur=null;
    YP.msgs.forEach(function(m){
      if(m.kind==='sys'){ groups.push({kind:'sys',text:m.text}); cur=null; return; }
      var same = cur && cur.kind==='msgs' && cur.uid===m.uid && (m.ts-(cur.lastTs||0)) <= 60;
      if(same){ cur.msgs.push(m); cur.lastTs=m.ts; }
      else { cur={kind:'msgs',uid:m.uid,name:m.name,color:m.color,msgs:[m],lastTs:m.ts,verified:!!m.verified}; groups.push(cur); }
    });
    return groups;
  }
  function ypReactChips(m){
    var r=m.reactions||{}; var keys=Object.keys(r); if(!keys.length) return null;
    var d=document.createElement('div'); d.className='yp-reacts';
    keys.forEach(function(e){
      var n=(r[e]||[]).length; var on=(r[e]||[]).indexOf(YP.uid)>=0;
      var b=document.createElement('button'); b.className=on?'on':''; b.setAttribute('data-e',e); b.setAttribute('data-mid',m.id);
      var stk=ypStkReact(e);
      if(stk) b.appendChild(stk); else b.textContent=e;   // 18.3 · 해돌이 임티는 그림으로
      var c=document.createElement('span'); c.className='cnt'; c.textContent=n; b.appendChild(c);
      d.appendChild(b);
    });
    return d;
  }
  function ypBubbleEl(m){
    var wrap=document.createElement('div'); wrap.className='yp-bwrap';
    var inner;
    if(m.kind==='img'){
      inner=document.createElement('img'); inner.className='yp-img'; inner.loading='lazy';
      inner.src='/api/chat/file/'+m.file.id; inner.alt='사진';
      inner.onclick=function(){ window.__ypZoom(m.file.id); };
      inner.onload=function(){ if(YP.stick){ var b=$('ypBody'); b.scrollTop=b.scrollHeight; } };
    } else if(m.kind==='file'){
      inner=document.createElement('a'); inner.className='yp-file';
      inner.href='/api/chat/file/'+m.file.id; inner.target='_blank'; inner.rel='noopener';
      inner.setAttribute('download',m.file.name);
      inner.innerHTML='<span class="fi"><i class="ri-file-3-line"></i></span>'+
        '<span class="fm"><span class="fn"></span><span class="fs"></span></span>'+
        '<i class="ri-download-2-line" style="color:#8b93a5;font-size:14px"></i>';
      inner.querySelector('.fn').textContent=m.file.name;
      inner.querySelector('.fs').textContent=ypSize(m.file.size);
    } else {
      var stkOnly=ypStkOnly(m);
      if(!stkOnly) stkOnly=ypStkOnly(m.text);
      if(stkOnly){
        // 18.3/16.4 · 임티 하나만 온 메시지 — 말풍선 없이 큰 해돌이 스티커로
        inner=document.createElement('div'); inner.className='yp-stkmsg';
        var stk=YP_STK.svg(stkOnly,'yp-stk-big');
        if(stk) inner.appendChild(stk);
        else { inner.className='yp-bub'; inner.textContent=m.text||''; }
      }else{
        inner=document.createElement('div'); inner.className='yp-bub';
        ypStkRenderText(inner,m.text||'',m.stickers);
      }
    }
    if(!YP.seen.has(m.id)){ YP.seen.add(m.id); inner.classList.add('anim'); }
    if(YP.seen.size>400) YP.seen.clear();
    wrap.appendChild(inner);
    var chips=ypReactChips(m); if(chips) wrap.appendChild(chips);
    if(m.uid===YP.uid){
      var del=document.createElement('button'); del.className='yp-del'; del.title='메시지 삭제';
      del.setAttribute('data-del',m.id);
      del.innerHTML='<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/></svg>';
      wrap.appendChild(del);
    }
    return wrap;
  }
  function ypGroupEl(g){
    var mine=g.uid===YP.uid;
    var line=document.createElement('div'); line.className='yp-line'+(mine?' me':'');
    line.setAttribute('data-mid', g.msgs[g.msgs.length-1].id);
    if(!mine){
      var ava=document.createElement('div'); ava.className='yp-ava';
      ava.style.background=g.color||'#e2e8f0'; ava.textContent=(g.name||'?').slice(0,2); line.appendChild(ava);
    }
    var stack=document.createElement('div'); stack.className='yp-stack';
    if(!mine){ var who=document.createElement('div'); who.className='yp-who'; who.textContent=g.name||'익명';
      if(g.verified){ var vb=document.createElement('span'); vb.className='yp-verified'; vb.title='회원 · 고정 닉네임'; vb.innerHTML='<i class="ri-verified-badge-fill"></i>'; who.appendChild(vb); }
      stack.appendChild(who); }
    g.msgs.forEach(function(m){ stack.appendChild(ypBubbleEl(m)); });
    var tm=document.createElement('div'); tm.className='yp-time'; tm.textContent=ypTime(g.lastTs); stack.appendChild(tm);
    line.appendChild(stack);
    return line;
  }
  function ypRender(smooth){
    var body=$('ypBody'), empty=$('ypEmpty');
    var stick=YP.stick;
    var nodes=body.querySelectorAll('.yp-line,.yp-sys');
    for(var i=0;i<nodes.length;i++) nodes[i].parentNode.removeChild(nodes[i]);
    if(empty) empty.style.display=YP.msgs.length?'none':'block';
    var frag=document.createDocumentFragment();
    ypGroupMsgs().forEach(function(g){
      if(g.kind==='sys'){ var s=document.createElement('div'); s.className='yp-sys'; s.textContent=g.text; frag.appendChild(s); }
      else frag.appendChild(ypGroupEl(g));
    });
    body.appendChild(frag);
    if(stick){
      if(smooth) body.scrollTo({top:body.scrollHeight,behavior:'smooth'});
      else body.scrollTop=body.scrollHeight;
    }
  }

  function ypRenderStatus(){
    var join=$('ypVJoin'), mute=$('ypVMute'), voice=$('ypVoice');
    if(voice) voice.classList.toggle('invoice', YP.inVoice);
    if(join){
      join.classList.toggle('loading',YP.joiningVoice);
      join.setAttribute('aria-busy',YP.joiningVoice?'true':'false');
      if(YP.joiningVoice){ join.classList.remove('off'); join.title='마이크 연결 중'; join.innerHTML='<i class="ri-loader-4-line"></i><span class="ypv-cnt" id="ypVCnt"></span>'; }
      else if(YP.inVoice){ join.classList.remove('off'); join.title='나가기'; join.innerHTML='<i class="ri-phone-fill"></i><span class="ypv-cnt" id="ypVCnt"></span>'; }
      else { join.classList.add('off'); join.title='음성 참가'; join.innerHTML='<i class="ri-mic-line"></i><span class="ypv-cnt" id="ypVCnt"></span>'; }
      var cnt=$('ypVCnt'), othersV=0;
      YP.members.forEach(function(m){ if(m.uid!==YP.uid&&m.voice) othersV++; });
      if(cnt){ cnt.textContent=othersV; cnt.style.display=othersV>0?'inline-flex':'none'; }
    }
    if(mute){
      if(YP.inVoice){ mute.style.display='inline-flex'; mute.classList.toggle('on',YP.muted);
        mute.innerHTML=YP.muted?'<i class="ri-mic-off-fill"></i>':'<i class="ri-mic-fill"></i>'; }
      else mute.style.display='none';
    }
    var bgmBtn=$('ypBgmBtn'); if(bgmBtn) bgmBtn.classList.toggle('on', BGM.on);
    // 14.14 · 배경음악 바가 떠 있으면 유리 음성바 밑으로 채팅을 밀어 넣지 않는다.
    //   그 외에는 음성바의 실제 높이를 재서 채팅이 정확히 그 밑으로 흐르게 한다.
    try{
      var bgmBar=$('ypBgm'), app=$('ypApp'), vbar=$('ypVoice');
      if(app) app.classList.toggle('yp-has-bgm', !!(bgmBar && bgmBar.style.display!=='none'));
      if(app&&vbar){
        var vh=vbar.offsetHeight||0;
        if(vh>0){
          app.style.setProperty('--ypv-h', vh+'px');
          app.style.setProperty('--ypv-neg', (-vh)+'px');
          app.style.setProperty('--ypv-pad', (vh+12)+'px');
        }
      }
    }catch(e){}
    var chips=$('ypVChips');
    if(chips){
      var inV=[]; YP.members.forEach(function(m){ if(m.voice) inV.push(m); });
      chips.innerHTML=inV.map(function(m){
        var self=m.uid===YP.uid, spk=YP.speaking.get(m.uid);
        var conn=YP.conn.get(m.uid);
        var st = self ? '' : (conn==='connected'?'<span class="st ok">연결됨</span>':
                              (conn==='failed'?'<span class="st" style="color:#ef4444">연결 안 됨</span>':
                              (conn==='candidate-error'?'<span class="st" style="color:#f59e0b">네트워크 문제</span>':
                               (conn?'<span class="st">연결 중</span>':''))));
        var nm=self?('나('+(m.name||'익명')+')'):(m.name||'익명');
        return '<span class="yp-vchip '+(self?'self':'')+(spk?' spk':'')+'">'+
          '<span class="dot" style="background:'+(m.color||'#cbd5e1')+'"></span>'+
          '<span class="nm">'+esc(nm)+(m.verified?'<span class="yp-verified" title="회원"><i class="ri-verified-badge-fill"></i></span>':'')+(m.mute?' <i class="ri-mic-off-line"></i>':'')+'</span>'+st+'</span>';
      }).join('');
    }
    // 접힌 아이콘: 음성참가자(나 제외) 초록 글로우 배지만 표시
    var v=$('ypChipVoice');
    var vc=0; YP.members.forEach(function(m){ if(m.voice&&m.uid!==YP.uid) vc++; });
    if(v){ v.innerHTML='<i class="ri-mic-fill"></i>'+vc; v.style.display=vc>0?'flex':'none'; }
    var pv=$('proYpBadgeVoice'); if(pv){ pv.innerHTML='<i class="ri-mic-fill"></i> '+vc; pv.style.display=vc>0?'inline-flex':'none'; }
  }
  function ypMembersFrom(arr){
    var prev=new Map();
    YP.members.forEach(function(m,uid){ prev.set(uid,{voice:!!m.voice,name:m.name}); });
    var next=new Map();
    (arr||[]).forEach(function(m){ next.set(m.uid,{uid:m.uid,name:m.name,color:m.color,voice:!!m.voice,mute:!!m.mute}); });
    if(YP.joined && YPS.sys){
      next.forEach(function(m,uid){
        if(uid===YP.uid) return;
        var was=prev.get(uid);
        if(!was){
          ypSys((m.name||'익명')+' 님이 들어왔어요');
        } else {
          // 16.x · 통화 음성 참가 변화 — 보이스톡처럼 음성으로 알려 준다
          if(YP.inVoice){
            if(m.voice && !was.voice) ypBeep('msg');
            else if(!m.voice && was.voice) ypBeep('msg');
          }
        }
      });
      prev.forEach(function(o,uid){
        if(!next.has(uid)&&uid!==YP.uid){
          ypSys((o.name||'익명')+' 님이 나갔어요');
          // 16.x · 통화 중이던 사람이 방 자체를 나가면 통화에서도 빠진 것으로 본다
          if(YP.inVoice && o.voice) ypBeep('msg');
        }
      });
    }
    YP.members=next;
    ypRenderStatus();
  }

  // ── 음성 (서버 릴레이 WebSocket) ──
  //   마이크 → 16kHz μ-law → /api/chat/voice-ws 가 참가자에게 중계.
  //   WebRTC/TURN/STUN 없음. 채팅이 열리는 망이면 통화도 된다.
  function ypWatchStream(uid,stream){
    try{
      var ctx=ypGetActx(); if(!ctx) return;
      var src=ctx.createMediaStreamSource(stream);
      var an=ctx.createAnalyser(); an.fftSize=512; an.smoothingTimeConstant=0.4;
      src.connect(an);
      var buf=new Uint8Array(an.frequencyBinCount);
      (function tick(){
        try{ an.getByteTimeDomainData(buf); }catch(e){ return; }
        var sum=0; for(var i=0;i<buf.length;i++){ var vv=(buf[i]-128)/128; sum+=vv*vv; }
        var rms=Math.sqrt(sum/buf.length);
        var spk=rms>0.045;
        if(YP.speaking.get(uid)!==spk){ YP.speaking.set(uid,spk); ypRenderStatus(); }
        requestAnimationFrame(tick);
      })();
    }catch(e){}
  }
  var RELAY_SR=16000;            // 음성 샘플레이트 (16kHz = 광대역 음질)
  var RELAY_CHUNK=1600;          // 한 프레임 샘플 수 = 100ms
  var RELAY_JBUF=0.28;           // 수신 지터 버퍼(초) — 지지직 방지 위해 확대
  var RELAY_HB=20000;            // 프록시가 유휴 WS 를 끊지 않게 핑
  var _relayLastFrame={};        // 프레임 손실 은닉용 마지막 프레임 보관
  // G.711 μ-law 디코딩 테이블 (수신측)
  var MULAW_D=(function(){
    var t=new Float32Array(256);
    for(var i=0;i<256;i++){
      var u=(~i)&0xff;
      var v=((((u&0x0f)<<3)+0x84)<<((u&0x70)>>4));
      t[i]=((u&0x80)?(0x84-v):(v-0x84))/32768;
    }
    return t;
  })();
  function ypLin2Ulaw(v){
    var pcm=Math.round((v>1?1:(v<-1?-1:v))*32768)>>2, mask;
    if(pcm<0){ pcm=-pcm; mask=0x7F; } else mask=0xFF;
    if(pcm>8159) pcm=8159;
    pcm+=0x21;
    var seg=0, segEnd=[0xFF,0x1FF,0x3FF,0x7FF,0xFFF,0x1FFF,0x3FFF,0x7FFF];
    while(seg<8&&pcm>segEnd[seg]) seg++;
    if(seg>=8) return 0x7F^mask;
    return ((seg<<4)|((pcm>>(seg+3))&0x0F))^mask;
  }
  var RELAY_WORKLET_SRC=
    'class SdyVoiceCapture extends AudioWorkletProcessor{'+
    'constructor(){super();this.r=sampleRate/'+RELAY_SR+';this.f=0;this.b=new Uint8Array('+RELAY_CHUNK+');this.n=0;}'+
    'e(v){var p=Math.round((v>1?1:(v<-1?-1:v))*32768)>>2,m;if(p<0){p=-p;m=127}else m=255;'+
    'if(p>8159)p=8159;p+=33;var s=0,E=[255,511,1023,2047,4095,8191,16383,32767];'+
    'while(s<8&&p>E[s])s++;if(s>=8)return 127^m;return((s<<4)|((p>>(s+3))&15))^m;}'+
    'process(ins){var ch=ins[0]&&ins[0][0];if(!ch)return true;'+
    'for(var i=0;i<ch.length;i++){this.f+=1;if(this.f>=this.r){this.f-=this.r;'+
    'this.b[this.n++]=this.e(ch[i]);if(this.n>=this.b.length){this.n=0;'+
    'this.port.postMessage(this.b.slice(0));}}}'+
    'return true;}}'+
    'registerProcessor("sdy-voice-capture",SdyVoiceCapture);';
  function ypRelaySendFrame(d){
    var ws=YP.relayWs;
    if(!ws||ws.readyState!==1||YP.muted||!YP.inVoice) return;
    try{
      var f=new Uint8Array(d.length+1); f[0]=0x01; f.set(d,1);
      ws.send(f);
    }catch(e){}
  }
  function ypRelayOut(){
    var ctx=ypGetActx(); if(!ctx) return null;
    if(YP._relayDest) return YP._relayDest;
    try{
      var dest=ctx.createMediaStreamDestination();
      var el=document.getElementById('ypRelayOut')||document.createElement('audio');
      el.id='ypRelayOut'; el.autoplay=true; el.muted=false; el.playsInline=true;
      el.setAttribute('playsinline',''); el.setAttribute('webkit-playsinline','');
      el.srcObject=dest.stream;
      if(!el.parentNode) document.body.appendChild(el);
      el.play().catch(function(){});
      YP._relayDest=dest; YP._relayEl=el;
      return dest;
    }catch(e){ return ctx.destination; }
  }
  function ypRelayCapture(ctx,stream){
    return new Promise(function(resolve,reject){
      var src;
      try{ src=ctx.createMediaStreamSource(stream); }catch(e){ return reject(new Error('마이크를 열 수 없어요')); }
      var done=function(node){
        var zero=ctx.createGain(); zero.gain.value=0;
        src.connect(node); node.connect(zero); zero.connect(ctx.destination);
        YP.relayNodes={src:src,node:node,zero:zero};
        resolve();
      };
      var fallback=function(){
        try{
          var sp=ctx.createScriptProcessor(2048,1,1);
          var ratio=ctx.sampleRate/RELAY_SR, frac=0, buf=new Uint8Array(RELAY_CHUNK), n=0;
          sp.onaudioprocess=function(e){
            var ch=e.inputBuffer.getChannelData(0);
            for(var i=0;i<ch.length;i++){
              frac+=1;
              if(frac>=ratio){ frac-=ratio;
                buf[n++]=ypLin2Ulaw(ch[i]);
                if(n>=buf.length){ n=0; ypRelaySendFrame(buf); buf=new Uint8Array(RELAY_CHUNK); }
              }
            }
          };
          done(sp);
        }catch(e){ reject(new Error('마이크 캡처를 시작할 수 없어요')); }
      };
      if(ctx.audioWorklet&&typeof Blob!=='undefined'&&typeof URL!=='undefined'&&URL.createObjectURL){
        var url;
        try{ url=URL.createObjectURL(new Blob([RELAY_WORKLET_SRC],{type:'application/javascript'})); }
        catch(e){ return fallback(); }
        YP._relayUrl=url;
        ctx.audioWorklet.addModule(url).then(function(){
          try{ if(url) URL.revokeObjectURL(url); }catch(e){}
          YP._relayUrl=null;
          try{
            var node=new AudioWorkletNode(ctx,'sdy-voice-capture',{numberOfInputs:1,numberOfOutputs:1});
            node.port.onmessage=function(e){
              var d=e.data;
              ypRelaySendFrame(d instanceof Uint8Array?d:new Uint8Array(d));
            };
            done(node);
          }catch(e){ fallback(); }
        }).catch(function(){ try{ if(url) URL.revokeObjectURL(url); }catch(e){} fallback(); });
        return;
      }
      fallback();
    });
  }
  function ypRelayEvent(m){
    if(!m||!m.t) return;
    if(m.t==='welcome'){
      (m.peers||[]).forEach(function(p){ if(p.uid&&p.uid!==YP.uid) YP.conn.set(p.uid,'connected'); });
      ypRenderStatus();
    } else if(m.t==='join'){
      if(m.uid&&m.uid!==YP.uid){
        YP.conn.set(m.uid,'connected');
        ypRenderStatus();
      }
    } else if(m.t==='leave'){
      if(m.uid){
        YP.conn.delete(m.uid); YP.speaking.delete(m.uid);
        if(YP.relayRx[m.uid]) delete YP.relayRx[m.uid];
        ypRenderStatus();
      }
    } else if(m.t==='mute'){
      var mm=YP.members.get(m.uid);
      if(mm){ mm.mute=!!m.mute; ypRenderStatus(); }
    }
  }
  function ypRelayAudio(data){
    var u8=new Uint8Array(data);
    if(u8.length<3||u8[0]!==0x01) return;
    var nl=u8[1]; if(nl<=0||2+nl>=u8.length) return;
    var uid=''; for(var i=0;i<nl;i++) uid+=String.fromCharCode(u8[2+i]);
    if(!uid||uid===YP.uid) return;
    var ctx=ypGetActx(); if(!ctx) return;
    YP.conn.set(uid,'connected');
    var pay=u8.subarray(2+nl);
    var f=new Float32Array(pay.length), sum=0;
    for(var j=0;j<pay.length;j++){ var v=MULAW_D[pay[j]]; f[j]=v; sum+=v*v; }
    var spk=Math.sqrt(sum/pay.length)>0.03;
    if(YP.speaking.get(uid)!==spk){ YP.speaking.set(uid,spk); ypRenderStatus(); }
    var st=YP.relayRx[uid]||(YP.relayRx[uid]={next:0});
    var ab=ctx.createBuffer(1,f.length,RELAY_SR);
    try{ ab.copyToChannel(f,0); }catch(e){ ab.getChannelData(0).set(f); }
    var now=ctx.currentTime;
    if(st.next<now+0.02||st.next>now+1.2) st.next=now+RELAY_JBUF;
    var src=ctx.createBufferSource(); src.buffer=ab;
    var dest=ypRelayOut()||ctx.destination;
    src.connect(dest);
    try{ src.start(st.next); }catch(e){}
    st.next+=ab.duration;
  }
  function ypRelayDropSocket(){
    if(YP._relayHb){ try{ clearInterval(YP._relayHb); }catch(e){} YP._relayHb=null; }
    var ws=YP.relayWs;
    if(ws){ try{ ws.onclose=null; }catch(e){} try{ ws.close(); }catch(e){} }
    YP.relayWs=null;
  }
  function ypRelayCleanup(full){
    ypRelayDropSocket();
    if(full){
      var n=YP.relayNodes;
      if(n){
        try{ if(n.node&&n.node.port) n.node.port.onmessage=null; }catch(e){}
        try{ n.node&&n.node.disconnect(); }catch(e){}
        try{ n.zero&&n.zero.disconnect(); }catch(e){}
        try{ n.src&&n.src.disconnect(); }catch(e){}
      }
      YP.relayNodes=null;
      if(YP._relayUrl){ try{ URL.revokeObjectURL(YP._relayUrl); }catch(e){} YP._relayUrl=null; }
      if(YP._relayEl){ try{ YP._relayEl.pause(); YP._relayEl.srcObject=null; }catch(e){} }
      YP._relayDest=null;
    }
    Object.keys(YP.relayRx).forEach(function(k){ delete YP.relayRx[k]; });
    YP.speaking.forEach(function(v,k){ if(k!==YP.uid) YP.speaking.delete(k); });
    YP.conn.clear();
    ypRenderStatus();
  }
  function ypRelayReconnect(){
    if(!YP.inVoice||!YP.relayOn||YP._relayStop||YP._relayRT) return;
    var tries=0;
    var go=function(){
      if(!YP.inVoice||!YP.relayOn||YP._relayStop){ YP._relayRT=null; return; }
      ypRelayCleanup(false);
      ypRelayStart(YP.localStream).then(function(){
        YP._relayRT=null;
        toast('음성 연결을 다시 이었어요',1600);
        try{ ypBeep('msg'); }catch(e){}
      }).catch(function(){
        tries++;
        if(tries>=6){ YP._relayRT=null; ypLeaveVoice(); toast('음성 연결을 되살리지 못했어요',2600); return; }
        setTimeout(go,700*tries);
      });
    };
    YP._relayRT=1;
    setTimeout(go,500);
  }
  function ypRelayStart(stream){
    var ctx=ypGetActx();
    if(!ctx) return Promise.reject(new Error('이 브라우저에서 오디오를 쓸 수 없어요'));
    if(ctx.state==='suspended') ctx.resume().catch(function(){});
    var cap=YP.relayNodes ? Promise.resolve() : ypRelayCapture(ctx,stream);
    return cap.then(function(){
      return new Promise(function(resolve,reject){
        var proto=(location.protocol==='https:')?'wss:':'ws:';
        var ws;
        try{ ws=new WebSocket(proto+'//'+location.host+'/api/chat/voice-ws?uid='+encodeURIComponent(YP.uid)); }
        catch(e){ return reject(new Error('음성 연결을 만들 수 없어요')); }
        ws.binaryType='arraybuffer';
        var opened=false;
        var tm=setTimeout(function(){
          if(!opened){ try{ ws.onclose=null; ws.close(); }catch(e){} reject(new Error('음성 서버 응답이 없어요')); }
        },9000);
        ws.onmessage=function(ev){
          if(typeof ev.data==='string'){
            var m; try{ m=JSON.parse(ev.data); }catch(e){ return; }
            if(m&&m.t==='welcome'&&!opened){ opened=true; clearTimeout(tm); resolve(); }
            ypRelayEvent(m);
            return;
          }
          if(opened) ypRelayAudio(ev.data);
        };
        ws.onclose=function(ev){
          clearTimeout(tm);
          var wasOpen=opened;
          YP.relayWs=null;
          if(YP._relayHb){ try{ clearInterval(YP._relayHb); }catch(e){} YP._relayHb=null; }
          if(!wasOpen){ reject(new Error('음성 서버에 연결하지 못했어요'+(ev&&ev.code?' ('+ev.code+')':''))); return; }
          if(YP.inVoice&&YP.relayOn&&!YP._relayStop) ypRelayReconnect();
        };
        ws.onerror=function(){};
        YP.relayWs=ws; YP._relayStop=false;
        if(YP._relayHb){ try{ clearInterval(YP._relayHb); }catch(e){} }
        YP._relayHb=setInterval(function(){
          if(YP.relayWs&&YP.relayWs.readyState===1){
            try{ YP.relayWs.send(JSON.stringify({t:'ping'})); }catch(e){}
          }
        },RELAY_HB);
      });
    });
  }
  function ypRelayStop(){
    YP._relayStop=true;
    ypRelayCleanup(true);
    YP.relayOn=false;
  }
  function ypReconcileVoice(){
    if(!YP.inVoice) return;
    ypRenderStatus();
  }
  function ypMicErr(err){
    var n=(err&&err.name)||'';
    var msg=(err&&err.message)||'';
    if(n==='NotAllowedError'||n==='PermissionDeniedError'||n==='SecurityError')
      toast('마이크 권한이 차단됐어요 · 주소창 자물쇠 → 마이크 허용',3200);
    else if(n==='NotFoundError'||n==='DevicesNotFoundError')
      toast('마이크를 찾을 수 없어요 · 장치를 확인해 주세요',3000);
    else if(n==='NotReadableError'||n==='TrackStartError')
      toast('마이크가 다른 앱에서 사용 중이에요',3000);
    else if(msg) toast(msg,3000);
    else toast('마이크를 켤 수 없어요 · 권한을 확인해 주세요',2800);
  }
  function ypJoinVoice(){
    if(YP.inVoice||YP.joiningVoice) return;
    var localHost=location.hostname==='localhost'||location.hostname==='127.0.0.1'||location.hostname==='::1';
    if(window.isSecureContext===false&&!localHost){
      toast('통화는 HTTPS 접속이 필요해요 · http:// 대신 https:// 주소로 접속해 주세요',4200);
      return;
    }
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ toast('이 브라우저는 마이크를 지원하지 않아요',2400); return; }
    YP.joiningVoice=true; ypRenderStatus();
    navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
      .then(function(st){
        return ypRelayStart(st).then(function(){ return st; });
      }).then(function(st){
        YP.localStream=st; YP.inVoice=true; YP.joiningVoice=false; YP.relayOn=true;
        ypWatchStream(YP.uid,st);
        ypReconcileVoice(); ypRenderStatus();
        if(YP.bgm && YP.bgm.action!=='stop') ypBgmApply(YP.bgm);
        try{ ypBeep('msg'); }catch(e){}
        toast('통화 시작 · 이어폰을 쓰면 에코가 줄어요',2400);
      }).catch(function(err){
        YP.joiningVoice=false; ypRenderStatus();
        ypRelayStop();
        if(YP.localStream){ try{YP.localStream.getTracks().forEach(function(t){t.stop();});}catch(e){} YP.localStream=null; }
        ypMicErr(err);
      });
  }
  function ypLeaveVoice(){
    if(!YP.inVoice && !YP.joiningVoice) return;
    var wasInVoice=YP.inVoice;
    YP.inVoice=false;
    ypRelayStop();
    if(YP.localStream){ try{YP.localStream.getTracks().forEach(function(t){t.stop();});}catch(e){} }
    YP.localStream=null;
    YP.speaking.clear(); YP.conn.clear();
    fetch('/api/chat/voice',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({uid:YP.uid,on:false})}).catch(function(){});
    if(BGM.on){ BGM.on=false; try{BGM.audio&&BGM.audio.pause();}catch(e){} ypBgmCast('stop'); }
    var bgm=$('ypBgm'); if(bgm) bgm.style.display='none';
    ypRenderStatus();
    if(wasInVoice){ try{ ypBeep('msg'); }catch(e){} }
  }
  function ypToggleMute(){
    YP.muted=!YP.muted;
    if(YP.localStream){ YP.localStream.getAudioTracks().forEach(function(t){ t.enabled=!YP.muted; }); }
    if(YP.inVoice && YP.relayWs && YP.relayWs.readyState===1){
      try{ YP.relayWs.send(JSON.stringify({t:'mute',mute:YP.muted})); }catch(e){}
    }
    ypRenderStatus();
  }

  // ── 배경음악 (음성참가 · 검색 기반 · 같이 듣기 · 고른 곡 반복) ──
  // 같이 듣기의 규칙은 두 가지다.
  //   ① 고른 곡 하나만 끝없이 반복 — 다음 곡으로 넘어가지 않는다.
  //   ② 멈추면 모두 같은 '시점'에서 멈춘다 — 멈춘 위치를 그대로 실어 보내고
  //      받는 쪽은 그 위치로 이동해 멈춘다. 다시 켤 때도 같은 시점에서 이어진다.
  var BGM={list:[],on:false,audio:null,loaded:false,owner:null,track:null};
  var BGM_PAUSED=false;
  function ypBgmAudio(){
    if(!BGM.audio){
      BGM.audio=new Audio(); BGM.audio.volume=0.15;
      // loop 이면 onended 가 오지 않는다 → 각 기기에서 같은 곡만 계속 돈다.
      BGM.audio.loop=true;
    }
    return BGM.audio;
  }
  // 일시정지 모양(버튼)을 맞춘다 — 내가 눌러도, 상대가 눌러도 같은 상태가 된다
  function ypBgmSetPaused(on){
    BGM_PAUSED=!!on;
    var btn=$('ypBgmPause');
    if(btn){
      btn.innerHTML=BGM_PAUSED?'<i class="ri-play-fill"></i>':'<i class="ri-pause-fill"></i>';
      btn.title=BGM_PAUSED?'재생':'일시정지';
    }
  }
  // 새 곡으로 바꾼 직후에는 메타가 뜰 때 한 번만 시점을 맞춘다.
  // (불러오기 전 seek 은 브라우저가 무시해 '같은 시점' 약속이 깨진다)
  function ypBgmSeekWhenReady(a,pos){
    if(!(pos>0)) return;
    if(typeof a.addEventListener!=='function'){ try{ a.currentTime=pos; }catch(e){} return; }
    var once=function(){ try{ a.currentTime=pos; }catch(e){} a.removeEventListener('loadedmetadata',once); };
    a.addEventListener('loadedmetadata',once);
  }
  function ypBgmPause(){
    if(!BGM.audio||!BGM.on) return;
    var pos=BGM.audio.currentTime||0;
    if(BGM_PAUSED){
      BGM.audio.play().catch(function(){});
      ypBgmSetPaused(false);
      // 이어 들을 시점과 지금 곡을 그대로 — 상대도 같은 지점에서 다시 돈다
      ypBgmCast('play', BGM.track, pos);
    } else {
      BGM.audio.pause();
      ypBgmSetPaused(true);
      // 멈춘 '그 시점'을 함께 보낸다 — 상대도 같은 시점에서 멈춘다
      ypBgmCast('pause', BGM.track, pos);
    }
  }
  function ypBgmLoadList(cb){
    if(BGM.loaded && BGM.list.length){ cb&&cb(); return; }
    fetch('/api/music/list').then(function(r){return r.json();}).then(function(d){
      BGM.list=(d&&d.tracks)||[]; BGM.loaded=true; cb&&cb();
    }).catch(function(){ toast('음악 목록을 불러오지 못했어요',2200); });
  }
  function hideRes(){ var r=$('ypBgmRes'); if(r) r.style.display='none'; }
  function ypBgmToggleBar(){
    var bar=$('ypBgm');
    if(!bar) return;
    if(bar.style.display==='none'){
      if(!YP.inVoice){ toast('먼저 음성참가를 해 주세요 — 같이 듣는 배경음악이에요',2600); return; }
      bar.style.display='flex'; ypBgmLoadList();
    } else { bar.style.display='none'; hideRes(); }
    ypRenderStatus();
  }
  function ypBgmCast(action, track, pos){
    // 곡 정보가 비면 서버가 'pause' 를 거절한다(= 상대가 안 멈춘다). 그럴 때는
    // 지금 돌고 있는 src 에서 곡 id 를 되찾아 함께 보낸다.
    if(action!=='stop' && !(track&&track.id) && BGM.audio){
      var mid=/\/api\/music\/file\/([^/?#]+)/.exec(BGM.audio.getAttribute('src')||'');
      if(mid) track={id:mid[1],title:(BGM.track&&BGM.track.title)||'',artist:(BGM.track&&BGM.track.artist)||''};
    }
    fetch('/api/chat/bgm',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({uid:YP.uid, action:action, pos:pos||0,
        track:action==='stop'?null:(track?{id:track.id,title:track.title||'',artist:track.artist||''}:null)})}).catch(function(){});
  }
  function ypBgmPlayLocal(t){
    var a=ypBgmAudio(); a.src='/api/music/file/'+t.id; a.play().catch(function(){});
    BGM.track={id:t.id,title:t.title||'',artist:t.artist||''};
    ypBgmSetPaused(false);
    $('ypBgmTitle').textContent=t.title||'알 수 없는 곡';
    $('ypBgmArtist').textContent=t.artist||'';
  }
  function ypBgmPick(t){
    if(!YP.inVoice){ toast('먼저 음성참가를 해 주세요',2400); return; }
    BGM.on=true; BGM.owner=YP.uid;
    ypBgmPlayLocal(t);
    hideRes(); var s=$('ypBgmSearch'); if(s) s.value='';
    ypBgmCast('play', t, 0); ypRenderStatus();
  }
  function ypBgmSearch(){
    var q=($('ypBgmSearch').value||'').trim().toLowerCase();
    var res=$('ypBgmRes');
    if(!q){ hideRes(); return; }
    var hits=BGM.list.filter(function(t){
      return (t.title||'').toLowerCase().indexOf(q)>=0 || (t.artist||'').toLowerCase().indexOf(q)>=0;
    }).slice(0,8);
    if(!hits.length){ res.innerHTML='<div class="yp-bgm-empty">검색 결과가 없어요</div>'; res.style.display='block'; return; }
    res.innerHTML=hits.map(function(t){
      return '<button data-id="'+esc(t.id)+'"><b>'+esc(t.title||'알 수 없는 곡')+'</b><em>'+esc(t.artist||'')+'</em></button>';
    }).join('');
    res.style.display='block';
  }
  function ypBgmApply(m){
    try{
      if(!m || m.action==='stop'){
        BGM.on=false; BGM.track=null; $('ypBgm').style.display='none';
        try{BGM.audio&&BGM.audio.pause();}catch(e){}
        ypRenderStatus(); return;
      }
      if(!m.track || !m.track.id) return;
      BGM.on=true; BGM.owner=(m.from&&m.from.uid)||YP.uid;
      BGM.track={id:m.track.id,title:m.track.title||'',artist:m.track.artist||''};
      var a=ypBgmAudio();
      // 멈춤은 '보낸 사람이 멈춘 바로 그 시점'이 약속이다. 흐른 시간을 더하지
      // 않고 그 값으로 맞춘다(재생일 때만 전송 지연만큼 앞당겨 계산한다).
      var paused=(m.action==='pause');
      var pos=(m.pos||0) + (paused?0:Math.max(0,(Date.now()/1000-(m.ts||Date.now()/1000))));
      var src='/api/music/file/'+m.track.id;
      if(a.getAttribute('src')!==src){ a.src=src; ypBgmSeekWhenReady(a,pos); }
      // 멈춤은 시점이 곧 약속이므로 어긋남 허용을 2초 → 0.25초로 좁혀 맞춘다.
      else if(Math.abs((a.currentTime||0)-pos)>(paused?0.25:2)){ try{ a.currentTime=pos; }catch(e){} }
      $('ypBgmTitle').textContent=m.track.title||'알 수 없는 곡';
      $('ypBgmArtist').textContent=m.track.artist||'';
      if(paused){ try{ a.pause(); }catch(e){} }
      else { a.play().catch(function(){}); }
      ypBgmSetPaused(paused);
      $('ypBgm').style.display='flex';
      ypRenderStatus();
    }catch(e){}
  }

  // ── 노크 ──
  function ypKnock(){
    ypBeep('knock');
    fetch('/api/chat/knock',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({uid:YP.uid})}).catch(function(){});
  }
  function ypChipShake(){ var c=$('ypReopen'); if(c){ c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); } var p=$('proYpBtn'); if(p){ p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake'); } }

  // ── 메시지/파일 ──
  // 즉시 전송: 내 메시지는 서버 왕복을 기다리지 않고 먼저 화면에 띄우고,
  // 서버가 내려준 진짜 메시지(id)가 오면 임시 메시지를 그걸로 치환한다.
  function ypTempId(){ return 'tmp_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
  function ypFindTemp(m){
    if(!m) return -1;
    for(var i=0;i<YP.msgs.length;i++){
      var x=YP.msgs[i];
      if(x.temp && x.uid===m.uid && x.text===m.text && ypSameStickers(x.stickers,m.stickers)) return i;
    }
    return -1;
  }
  function ypResolveTemp(m){
    var i=ypFindTemp(m);
    if(i<0) return;
    YP.msgs.splice(i,1,m);
    if(YP.msgs.length>200) YP.msgs.shift();
    ypRender(true);
  }
  function ypDropTemp(m){
    for(var i=0;i<YP.msgs.length;i++){
      if(YP.msgs[i].id===m.id){ YP.msgs.splice(i,1); ypRender(true); return; }
    }
  }
  function ypRenderDraftStickers(){
    var box=$('ypDraftStickers'); if(!box) return;
    var ids=ypStkIds(YP.draftStickers); YP.draftStickers=ids;
    box.innerHTML='';
    ids.forEach(function(id,i){
      var chip=document.createElement('span'); chip.className='yp-draft-chip'; chip.setAttribute('data-i',String(i)); chip.title='보낼 임티 미리보기';
      var s=YP_STK.svg(id,'yp-stk-draft');
      if(s) chip.appendChild(s); else chip.textContent='임티';
      var x=document.createElement('button'); x.type='button'; x.setAttribute('data-rm',String(i)); x.setAttribute('aria-label','임티 제거'); x.textContent='×';
      chip.appendChild(x); box.appendChild(chip);
    });
    box.style.display=ids.length?'flex':'none';
  }
  function ypDraftAsLegacyText(text,stickers){
    var t=String(text||'').trim();
    ypStkIds(stickers).forEach(function(id){ t+=(t&&!/\s$/.test(t)?' ':'')+YP_STK.code(id); });
    return t;
  }
  function ypClearDraft(ta){ YP.draftStickers=[]; ypRenderDraftStickers(); if(ta){ ta.value=''; ypAutoGrow(ta); ta.focus(); } }
  function ypSendText(){
    var ta=$('ypTxt'); var t=ta.value.trim(); var stickers=ypStkIds(YP.draftStickers);
    if(!t&&!stickers.length) return;
    // 14.57.0 · 연속 더블 클릭/터치로 같은 임티가 두 번 POST되는 것 방지 — 900ms 내 동일 내용 무시
    var now=Date.now(); var key=t+'|'+stickers.join(',')+'|'+YF.view;
    if(YP._lastSendKey===key && now-(YP._lastSendAt||0)<900) return;
    YP._lastSendKey=key; YP._lastSendAt=now;
    // 16.3 · 1:1 대화(DM) 화면에서는 친구에게로 간다. DM 서버는 텍스트 기반이라
    // 미리보기 임티를 전송 직전에만 예전 코드로 바꾼다(입력창에는 보이지 않음).
    if(YF.view==='dm'){
      var dt=ypDraftAsLegacyText(t,stickers);
      ypClearDraft(ta);
      yfSendText(dt);
      return;
    }
    ypClearDraft(ta);
    var local={id:ypTempId(),kind:'txt',uid:YP.uid,name:YP.name||'나',
      color:(YP.me&&YP.me.color)||'#a5b4fc',text:t,stickers:stickers,reactions:{},ts:Date.now()/1000,temp:true};
    ypAddMsg(local);
    fetch('/api/chat/msg',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({uid:YP.uid,text:t,stickers:stickers})})
      .then(function(r){return r.json();})
      .then(function(d){
        if(d&&d.ok&&d.msg){ ypResolveTemp(d.msg); ypAddMsg(d.msg); }
        else { ypDropTemp(local); if(d&&d.error) toast(d.error,2000); }
      })
      .catch(function(){ ypDropTemp(local); toast('보내지 못했어요 · 연결을 확인해 주세요',2000); });
  }
  function ypDeleteMsg(id){
    fetch('/api/chat/del',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({uid:YP.uid,id:id})})
      .then(function(r){return r.json();})
      .then(function(d){ if(d&&!d.ok){ toast(d.error||'지우지 못했어요',2200); } })
      .catch(function(){ toast('지우지 못했어요',2000); });
  }
  function ypUpload(file){
    if(!file) return;
    // 16.3 · DM 화면에서는 친구에게 파일을 보낸다
    if(YF.view==='dm'){ yfUploadDm(file); return; }
    var kind=file.type&&file.type.indexOf('image/')===0?'img':'file';
    var cap=kind==='img'?8*1024*1024:20*1024*1024;
    if(file.size>cap){ toast(kind==='img'?'사진은 8MB 이하만 가능해요':'파일은 20MB 이하만 가능해요',2400); return; }
    // uid 를 파일보다 먼저 넣어 multipart 파서가 입장 정보를 즉시 읽게 한다.
    var fd=new FormData(); fd.append('uid',YP.uid); fd.append('file',file,file.name||'file');
    fetch('/api/chat/upload',{method:'POST',body:fd})
      .then(function(r){return r.json();})
      .then(function(d){ if(d&&d.ok&&d.msg) ypAddMsg(d.msg); else if(d&&d.error) toast(d.error,2400); })
      .catch(function(){ toast('올리지 못했어요 · 연결을 확인해 주세요',2400); });
  }
  function ypAutoGrow(ta){ ta.style.height='auto'; ta.style.height=Math.min(80,ta.scrollHeight)+'px'; }

  // ── SSE / 접속 ──
  function ypHandle(m){
    if(!m||!m.type) return;
    if(m.type==='hello'){ return; }
    if(m.type==='msg'){
      var mine=m.msg&&m.msg.uid===YP.uid;
      ypAddMsg(m.msg);
      if(!mine){
        if(YPS.sound&&(!YP.open||!document.hasFocus())) ypBeep('msg');
        if(YPS.desk&&(!YP.open||!document.hasFocus())) ypNotify('엽스코드', (m.msg.name||'')+': '+(m.msg.text||(ypMsgStickers(m.msg).length?'[임티]':(m.msg.kind==='img'?'[사진]':'[파일]'))));
      }
      return;
    }
    if(m.type==='react'){ var x=YP.msgs.find(function(v){return v.id===m.id;}); if(x){ x.reactions=m.reactions; ypRender(false); } return; }
    if(m.type==='del'){ YP.msgs=YP.msgs.filter(function(v){return v.id!==m.id;}); ypRender(false); return; }
    if(m.type==='bgm'){ YP.bgm=m; if(YP.inVoice) ypBgmApply(m); return; }
    if(m.type==='presence'){ ypMembersFrom(m.members||[]); ypReconcileVoice(); return; }
    if(m.type==='knock'){ if(m.from&&m.from.uid!==YP.uid){ ypBeep('knock'); if(YPS.desk) ypNotify('엽스코드 🚪', (m.from.name||'누군가')+' 님이 노크했어요'); ypChipShake(); } return; }
    if(m.type==='reset'){ YP.msgs=[]; YP.seen.clear(); ypSys('💥 대화가 펑 하고 사라졌어요 · 새로 시작해요'); return; }
    if(m.type==='bye'){ if(YP.ping){ clearInterval(YP.ping); YP.ping=null; } ypJoin(); return; }
  }
  function ypConnect(){
    if(YP.es) return;
    var es=new EventSource('/api/chat/stream?uid='+encodeURIComponent(YP.uid));
    YP.es=es;
    es.addEventListener('yp',function(e){ var m; try{m=JSON.parse(e.data);}catch(_){return;} ypHandle(m); });
    es.onerror=function(){ try{es.close();}catch(_){} YP.es=null; clearTimeout(YP._reT); YP._reT=setTimeout(ypConnect,1200); };
  }
  function ypStartPing(){
    if(YP.ping) return;
    YP.ping=setInterval(function(){
      fetch('/api/chat/ping',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({uid:YP.uid})}).catch(function(){});
    },25000);
  }
  function ypJoin(){
    var jh={'Content-Type':'application/json'};
    try{ var jt=window.sdyAuthToken&&window.sdyAuthToken(); if(jt) jh['x-sdy-auth']=jt; }catch(e){}
    fetch('/api/chat/join',{method:'POST',headers:jh,
      body:JSON.stringify({uid:YP.uid,name:ypName()})})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status,d:j}; }); })
      .then(function(res){
        var d=res.d;
        // 16.2 · 비회원 이름이 회원 고정닉과 겹치면 새 이름으로 갈아입고 재시도
        if(res.s===409 && d && d.nickname_protected){
          YPS.nick=ypNewBird(); ypsSave();
          return ypJoin();
        }
        if(!d||!d.ok) throw new Error(d&&d.error||'입장 실패');
        YP.me=d.me; YP.msgs=(d.msgs||[]).slice(); YP.ttl=d.ttl||86400; YP.name=d.me&&d.me.name;
        YP.bgm=d.bgm||null;
        (d.msgs||[]).forEach(function(m){ YP.seen.add(m.id); });
        YP.members.clear();
        ypMembersFrom(d.members||[]);
        YP.joined=true;
        if(!YP._welcomed){
          YP._welcomed=true;
          var wu=null; try{ wu=window.sdyUser&&window.sdyUser(); }catch(e){}
          ypSys(wu&&wu.nick ? '회원 고정닉 "'+wu.nick+'" 으로 입장했어요' : '비회원으로 입장했어요 · ⚙ 설정에서 이름을 바꿀 수 있어요');
        }
        YP.stick=true;
        ypRender(false);
        var b=$('ypBody'); b.scrollTop=b.scrollHeight;
        ypRenderStatus();
        ypConnect(); ypStartPing();
        if(YPS.desk) ypAskNotify();
      })
      .catch(function(){ ypSys('서버에 연결하지 못했어요 · 잠시 뒤 다시 시도해요'); setTimeout(ypJoin,5000); });
  }

  // ── 설정 UI ──
  function ypBuildSettings(){
    var box=$('ypSettings'); if(!box) return;
    var me=null; try{ me=window.sdyUser&&window.sdyUser(); }catch(e){}
    box.innerHTML=
      '<div class="yp-set-title">사용자</div>'+
      (me
        ? '<div class="yp-set-row yp-set-member"><label><span class="yp-verified" title="회원 · 고정 닉네임"><i class="ri-verified-badge-fill"></i></span> '+esc(me.nick)+'<span class="sub">회원 고정닉 · 로그인 중</span></label>'+
          '<button class="yp-set-btn" id="ypSetAcc" title="내 계정 (이메일 · 닉네임)"><i class="ri-user-3-line"></i></button></div>'
        : '<div class="yp-set-row"><input type="text" id="ypSetNick" placeholder="닉네임 (빈 값 = 새 이름)" value="'+esc(YPS.nick)+'">'+
          '  <button class="yp-set-btn yp-set-refresh" id="ypSetBird" title="새 닉네임">'+REFRESH+'</button></div>'+
          '<div class="yp-set-row"><button class="yp-set-login" id="ypSetLogin"><i class="ri-user-3-line"></i> 로그인 · 고정 닉네임 쓰기</button></div>')+
      '<div class="yp-set-title">알림</div>'+
      '<div class="yp-set-row"><label>알림 소리<span class="sub">새 메시지가 오면 소리</span></label><span class="yp-switch '+(YPS.sound?'on':'')+'" data-k="sound"><i></i></span></div>'+
      '<div class="yp-set-row"><label>입장·퇴장 알림<span class="sub">들어오고 나가는 안내</span></label><span class="yp-switch '+(YPS.sys?'on':'')+'" data-k="sys"><i></i></span></div>'+
      '<div class="yp-set-row"><label>데스크톱 알림<span class="sub">노크·새 메시지 창 알림</span></label><span class="yp-switch '+(YPS.desk?'on':'')+'" data-k="desk"><i></i></span></div>'+
      '<div class="yp-set-row"><label>음성<span class="sub">서버 릴레이 방식으로 연결돼요</span></label><span class="sub">서버 릴레이</span></div>';
  }
  function ypSettingsClick(e){
    if(e.target.closest&&e.target.closest('#ypSetAcc')){ if(window.sdyAuthOpen) window.sdyAuthOpen(); return; }
    if(e.target.closest&&e.target.closest('#ypSetLogin')){ if(window.sdyAuthOpen) window.sdyAuthOpen(); return; }
    var sw=e.target.closest&&e.target.closest('.yp-switch');
    if(sw){ var k=sw.getAttribute('data-k'); YPS[k]=!YPS[k]; ypsSave(); if(k==='desk'&&YPS[k]) ypAskNotify(); ypBuildSettings(); return; }
    if(e.target.closest&&e.target.closest('.yp-set-refresh')){
      YPS.nick=ypNewBird(); ypsSave();
      var inp=$('ypSetNick'); if(inp) inp.value=YPS.nick;
      var btn=e.target.closest('.yp-set-refresh');
      if(btn){ btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin'); }
      ypRename(YPS.nick);
      return;
    }
  }
  function ypRename(name){
    YP.name=String(name||ypName()).slice(0,24);
    if(YP.me) YP.me.name=YP.name;
    fetch('/api/chat/join',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({uid:YP.uid,name:YP.name})})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status,d:j}; }); })
      .then(function(res){
        if(res.s===409&&res.d&&res.d.nickname_protected){
          var prev=YP.name; YPS.nick=ypNewBird(); ypsSave(); YP.name=YPS.nick;
          if(YP.me) YP.me.name=YP.name;
          if(window.toast) toast('그 닉네임은 회원 고정닉이에요. 새 이름으로 바꿨어요',2600);
          var inp=$('ypSetNick'); if(inp) inp.value=YPS.nick;
          ypRename(YP.name);
        }
      })
      .catch(function(){});
  }
  function ypSetNickCommit(){
    var inp=$('ypSetNick'); if(!inp) return;
    YPS.nick=inp.value.trim().slice(0,24); ypsSave();
    ypRename(ypName()); ypBuildSettings();
  }

  // ── UI ──
  function ypOpen(){
    var app=$('ypApp'), chip=$('ypReopen');
    app.classList.remove('closing');
    app.classList.add('open'); YP.open=true;
    if(chip) chip.style.display='none';
    var pb=$('proYpBtn'); if(pb) pb.classList.add('on');
    var b=$('ypBody'); b.scrollTop=b.scrollHeight;
    try{ $('ypTxt').focus(); }catch(e){}
  }
  var _ypClosing=false;
  function ypClose(){
    var app=$('ypApp'), chip=$('ypReopen');
    if(_ypClosing||!app.classList.contains('open')) return;
    _ypClosing=true;
    var pb=$('proYpBtn'); if(pb) pb.classList.remove('on');
    app.classList.add('closing');
    var row=$('ypReactRow'), em=$('ypEmoji'), st=$('ypSettings');
    if(row)row.classList.remove('open'); if(em)em.classList.remove('open'); if(st)st.classList.remove('open');
    hideRes();
    setTimeout(function(){
      app.classList.remove('open'); app.classList.remove('closing'); _ypClosing=false; YP.open=false;
      if(chip) chip.style.display='flex';
    }, 235);
  }
  function ypDrag(){
    var head=$('ypHead'), app=$('ypApp');
    var sx=0,sy=0,ox=0,oy=0,drag=false;
    head.addEventListener('pointerdown',function(e){
      if(e.target.closest&&e.target.closest('button')) return;
      drag=true; head.style.cursor='grabbing';
      sx=e.clientX; sy=e.clientY;
      var r=app.getBoundingClientRect(); ox=window.sdyUiCss(r.left); oy=window.sdyUiCss(r.top);
      e.preventDefault();
    });
    window.addEventListener('pointermove',function(e){
      if(!drag) return;
      var nx=ox+window.sdyUiCss(e.clientX-sx), ny=oy+window.sdyUiCss(e.clientY-sy);
      var c=sdyClampFloatingRect(app,nx,ny);
      // 14.62 · 인라인도 !important 로 — 기본(프로) 테마는 #ypApp 위치를
      //   left:292px!important 등으로 고정해 두어, 보통 인라인 스타일로는
      //   밀어도 시각적으로 안 움직였다(캐주얼에서만 되던 이유). 인라인
      //   !important 는 스타일시트 !important 보다 강해 어느 테마에서도 움직인다.
      app.style.setProperty('left',c.x+'px','important');
      app.style.setProperty('top',c.y+'px','important');
      app.style.setProperty('right','auto','important');
      app.style.setProperty('bottom','auto','important');
    });
    window.addEventListener('pointerup',function(){ drag=false; head.style.cursor=''; });
  }
  function ypShowReactRow(mid,x,y){
    var app=$('ypApp'), row=$('ypReactRow');
    if(!app||!row) return;
    row.innerHTML='';
    REACTIONS.forEach(function(id){                       // 18.3 · 해돌이 임티 반응
      var b=document.createElement('button'); b.setAttribute('data-e',id);
      var s=ypStkReact(id);
      if(s) b.appendChild(s);
      row.appendChild(b);
    });
    row.setAttribute('data-mid',mid);
    var r=app.getBoundingClientRect();
    row.style.left=Math.max(6,Math.min(x-r.left-60,r.width-96))+'px';
    row.style.top=Math.max(6,y-r.top-36)+'px';
    row.classList.add('open');
    setTimeout(function(){ row.classList.remove('open'); },3500);
  }
  window.__ypReact=function(id,emoji){
    fetch('/api/chat/react',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({uid:YP.uid,id:id,emoji:emoji})}).catch(function(){});
    var row=$('ypReactRow'); if(row) row.classList.remove('open');
  };
  window.__ypZoom=function(id){
    var ov=$('ypZoom');
    if(!ov){
      ov=document.createElement('div'); ov.id='ypZoom';
      ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9990;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
      ov.onclick=function(){ ov.parentNode&&ov.parentNode.removeChild(ov); };
      document.body.appendChild(ov);
    }
    ov.innerHTML='<img src="/api/chat/file/'+id+'" alt="" style="max-width:92vw;max-height:92vh;border-radius:10px;">';
  };

  /* ═══════════════════ 16.3 · 친구 + 1:1 대화(DM) ═══════════════════
     로그인한 회원끼리 친구를 맺고(고정 닉네임으로 요청 → 상대가 수락)
     1:1 대화를 나눈다.
       · 친구 관계·대화 내용은 서버 디스크에 남는다 (공용방과 달리 '펑' 없음,
         다만 대화는 30일 지나면 지워지고 사진/파일은 256MB 예산)
       · 실시간 전파는 회원 SSE(/api/dm/stream) — 엽스코드를 열지 않아도 수신
       · 뷰: room(공용방) ↔ friends(친구 목록·요청·추가) ↔ dm(1:1 대화)      */
  var YF={
    view:'room', peer:null,
    friends:[], reqIn:[], reqOut:[],
    threads:{}, msgs:{}, more:{}, peerRead:{},
    es:null, _esT:null, _esBack:1500,
    stickDm:true, _readSent:{}, _loadingOlder:false, _lastDmKey:null, _lastDmAt:0,
  };
  function yfToken(){ try{ return window.sdyAuthToken&&window.sdyAuthToken(); }catch(e){} return ''; }
  function yfUser(){ try{ return window.sdyUser&&window.sdyUser(); }catch(e){} return null; }
  function yfAuthed(){ var u=yfUser(); return !!(yfToken()&&u&&u.uid); }
  function yfApi(path,opt){
    opt=opt||{}; opt.headers=Object.assign({},opt.headers);
    var tk=yfToken(); if(tk) opt.headers['x-sdy-auth']=tk;
    return fetch(path,opt).then(function(r){
      return r.json().then(function(d){ return {s:r.status,d:d}; }).catch(function(){ return {s:r.status,d:{ok:false}}; });
    });
  }
  function yfColor(uid){
    var cols=['#f9a8d4','#fda4af','#fdba74','#fcd34d','#bef264','#6ee7b7','#5eead4','#7dd3fc','#a5b4fc','#c4b5fd','#d8b4fe','#f0abfc'];
    var h=0,s=String(uid||''); for(var i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0;
    return cols[h%cols.length];
  }
  function yfEsc(s){ return esc(s); }
  function yfSize(n){ return ypSize(n); }

  // ── 뷰 전환 (공용방 ↔ 친구 ↔ 1:1) ──
  function yfViewShow(view){
    YF.view=view;
    var b=$('ypBody'), fb=$('ypFriends'), db=$('ypDmBody');
    var foot=null; try{ foot=document.querySelector('#ypApp .yp-foot'); }catch(e){}
    var back=$('ypBack'), ttl=$('ypTtlTxt'), ta=$('ypTxt');
    if(b) b.style.display=view==='room'?'flex':'none';
    if(fb) fb.style.display=view==='friends'?'flex':'none';
    if(db) db.style.display=view==='dm'?'flex':'none';
    if(back) back.style.display=view==='room'?'none':'inline-flex';
    if(foot) foot.style.display=view==='friends'?'none':'';
    if(ttl){
      ttl.textContent = view==='room' ? '엽스코드'
        : view==='friends' ? '친구 · 1:1 대화'
        : (YF.peer ? ((YF.peer.online?'🟢 ':'')+YF.peer.nick) : '대화');
    }
    if(ta) ta.placeholder = (view==='dm'&&YF.peer) ? (YF.peer.nick+' 님에게 메시지…') : '메시지 보내기…';
    if(view==='friends') yfRenderFriends();
    if(view==='dm'){ YF.stickDm=true; yfRenderDm(false); if(YF.peer) yfReadLatest(YF.peer.uid); }
  }
  function yfToggleFriends(){
    if(YF.view==='friends'){ yfViewShow('room'); return; }
    yfViewShow('friends');
    if(yfAuthed()){ yfFriendsLoad(); yfThreadsLoad(); }
  }

  function yfOpenDm(uid){
    var f=null;
    for(var i=0;i<YF.friends.length;i++){ if(YF.friends[i].uid===uid){ f=YF.friends[i]; break; } }
    if(!f && YF.threads[uid]) f={uid:uid,nick:YF.threads[uid].nick||'친구',online:YF.threads[uid].online};
    if(!f) f={uid:uid,nick:'친구',online:false};
    YF.peer={uid:f.uid,nick:f.nick,online:!!f.online};
    yfViewShow('dm');
    yfHistoryLoad(uid,false);
  }

  // ── 데이터 읽기 ──
  function yfFriendsLoad(){
    if(!yfAuthed()){ yfRenderFriends(); return; }
    yfApi('/api/friends/list').then(function(res){
      if(res.d&&res.d.ok){
        YF.friends=res.d.friends||[];
        YF.reqIn=(res.d.requests&&res.d.requests.incoming)||[];
        YF.reqOut=(res.d.requests&&res.d.requests.outgoing)||[];
        if(YF.peer){ var f=null; for(var i=0;i<YF.friends.length;i++){ if(YF.friends[i].uid===YF.peer.uid){ f=YF.friends[i]; break; } } if(f){ YF.peer.nick=f.nick; YF.peer.online=!!f.online; if(YF.view==='dm') yfViewShow('dm'); } }
      }
      if(YF.view==='friends') yfRenderFriends();
      yfBadgeRefresh();
    }).catch(function(){});
  }
  function yfThreadsLoad(){
    if(!yfAuthed()) return;
    yfApi('/api/dm/threads').then(function(res){
      if(res.d&&res.d.ok){
        var nt={};
        (res.d.threads||[]).forEach(function(t){ nt[t.uid]=t; });
        YF.threads=nt;
      }
      if(YF.view==='friends') yfRenderFriends();
      yfBadgeRefresh();
    }).catch(function(){});
  }
  function yfHistoryLoad(uid, older){
    if(!yfAuthed()||!uid) return;
    var list=YF.msgs[uid]||[];
    var p='/api/dm/history/'+encodeURIComponent(uid);
    if(older && list.length && list[0].id) p+='?before='+encodeURIComponent(list[0].id)+'&limit=60';
    yfApi(p).then(function(res){
      if(!res.d||!res.d.ok){
        if(res.d&&res.d.code==='not_friends'){ toast('친구가 아니에요 · 먼저 친구를 맺어 주세요',2400); yfViewShow('friends'); }
        return;
      }
      var cur=YF.msgs[uid]||[];
      var merged;
      if(older) merged=res.d.msgs.concat(cur);
      else{
        // 서버 목록 + 아직 서버에 없는(방금 보낸) 임시 메시지 유지
        merged=res.d.msgs.slice();
        for(var i=0;i<cur.length;i++){ if(cur[i].temp) merged.push(cur[i]); }
      }
      YF.msgs[uid]=merged;
      YF.more[uid]=!!res.d.more;
      YF.peerRead[uid]=res.d.peer_read||0;
      if(res.d.peer){ if(YF.peer&&YF.peer.uid===uid){ YF.peer.nick=res.d.peer.nick||YF.peer.nick; YF.peer.online=!!res.d.peer.online; if(YF.view==='dm'){ var ttl=$('ypTtlTxt'); if(ttl) ttl.textContent=(YF.peer.online?'🟢 ':'')+YF.peer.nick; } } }
      if(YF.view==='dm'&&YF.peer&&YF.peer.uid===uid){
        if(older){
          var bodyEl=$('ypDmBody'); var oldH=bodyEl?bodyEl.scrollHeight:0;
          yfRenderDm(false);
          if(bodyEl) bodyEl.scrollTop=bodyEl.scrollHeight-oldH;
        }else yfRenderDm(false);
        yfReadLatest(uid);
      }
    }).catch(function(){});
  }
  function yfLoadOlder(){
    if(YF._loadingOlder||!YF.peer||!YF.more[YF.peer.uid]) return;
    YF._loadingOlder=true;
    yfHistoryLoad(YF.peer.uid,true);
    setTimeout(function(){ YF._loadingOlder=false; },600);
  }

  // ── 친구 액션 ──
  function yfReqAction(path, body, doneMsg){
    return yfApi(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})
      .then(function(res){
        if(res.d&&res.d.ok){ if(doneMsg) toast(doneMsg(res.d),2100); yfFriendsLoad(); yfThreadsLoad(); return true; }
        toast((res.d&&res.d.error)||'실패했어요',2200);
        return false;
      }).catch(function(){ toast('서버에 연결하지 못했어요',2000); return false; });
  }
  function yfAddFriend(){
    var inp=$('ypFrAddInp'); if(!inp) return;
    var nick=inp.value.trim(); if(!nick){ toast('닉네임을 입력해 주세요',1800); return; }
    yfReqAction('/api/friends/request',{nick:nick},function(d){
      inp.value='';
      return d.auto_accepted ? ('서로 요청해서 바로 친구가 됐어요 · '+d.user.nick) : (d.user.nick+' 님에게 친구 요청을 보냈어요');
    });
  }

  // ── 읽음 처리 ──
  function yfReadLatest(uid){
    if(!yfAuthed()) return;
    var list=YF.msgs[uid]||[]; if(!list.length) return;
    var last=0; for(var i=list.length-1;i>=0;i--){ if(typeof list[i].id==='number'){ last=list[i].id; break; } }
    if(!last) return;
    if((YF._readSent[uid]||0)>=last) return;
    YF._readSent[uid]=last;
    yfApi('/api/dm/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:uid,id:last})})
      .then(function(){ if(YF.threads[uid]){ YF.threads[uid].unread=0; yfBadgeRefresh(); } })
      .catch(function(){});
  }

  // ── 뱃지 ──
  function yfBadgeRefresh(){
    var total=0;
    for(var k in YF.threads){ total+=YF.threads[k].unread||0; }
    var reqs=YF.reqIn.length;
    var chip=$('ypChipDm');
    if(chip){
      chip.classList.toggle('yp-badge', total>0);
      chip.style.display=total>0?'flex':'none';
      chip.textContent=total>99?'99+':String(total);
    }
    var pd=$('proYpBadgeDm'); if(pd){ pd.textContent=total>99?'99+':String(total); pd.style.display=total>0?'inline-flex':'none'; }
    var fd=$('ypFrDot');
    if(fd){ fd.style.display=(total+reqs)>0?'inline-block':'none'; fd.textContent=String(Math.min(99,total+reqs)); }
  }

  // ── 친구 화면 렌더 ──
  function yfRenderFriends(){
    var box=$('ypFriends'); if(!box) return;
    if(!yfAuthed()){
      box.innerHTML=
        '<div class="ypfr-login"><b>친구와 1:1로 대화해요</b>'+
        '로그인하면 고정 닉네임으로 친구를 맺고<br>둘만의 대화를 나눌 수 있어요<br>'+
        '<button id="ypFrLoginBtn"><i class="ri-user-3-line"></i> 로그인하고 친구 만들기</button></div>';
      return;
    }
    var me=yfUser();
    var h='';
    h+='<div class="ypfr-ttl">친구 추가</div>';
    h+='<div class="ypfr-add"><input type="text" id="ypFrAddInp" maxlength="16" placeholder="친구의 고정 닉네임" spellcheck="false">'+
       '<button id="ypFrAddBtn"><i class="ri-user-add-line"></i>요청</button></div>';
    if(YF.reqIn.length){
      h+='<div class="ypfr-ttl">받은 요청 <span class="cnt hot">'+YF.reqIn.length+'</span></div>';
      YF.reqIn.forEach(function(r){
        h+='<div class="ypfr-item" data-uid="'+yfEsc(r.uid)+'">'+
          '<div class="ypfr-ava" style="background:'+yfColor(r.uid)+'">'+yfEsc((r.nick||'?').slice(0,2))+'</div>'+
          '<div class="ypfr-meta"><b>'+yfEsc(r.nick)+'<span class="yp-verified"><i class="ri-verified-badge-fill"></i></span></b><span>친구 요청을 보냈어요</span></div>'+
          '<button class="ypfr-btn main" data-act="accept" data-uid="'+yfEsc(r.uid)+'">수락</button>'+
          '<button class="ypfr-btn ghost" data-act="decline" data-uid="'+yfEsc(r.uid)+'">거절</button></div>';
      });
    }
    h+='<div class="ypfr-ttl">친구 <span class="cnt">'+YF.friends.length+'</span></div>';
    if(!YF.friends.length){
      h+='<div class="ypfr-empty">아직 친구가 없어요<br>위에서 <b>고정 닉네임</b>으로 친구 요청을 보낸 뒤<br>상대가 수락하면 1:1 대화를 할 수 있어요</div>';
    }
    YF.friends.forEach(function(f){
      var t=YF.threads[f.uid]||{};
      var last=t.last? (t.last.kind==='img'?'[사진]':t.last.kind==='file'?'[파일]':(t.last.text||'')) : (f.online?'온라인 · 대화를 시작해 보세요':'대화를 시작해 보세요');
      h+='<div class="ypfr-item" data-open="'+yfEsc(f.uid)+'" data-nick="'+yfEsc(f.nick)+'">'+
        '<div class="ypfr-ava" style="background:'+yfColor(f.uid)+'">'+yfEsc((f.nick||'?').slice(0,2))+
          '<span class="on-dot'+(f.online?' on':'')+'"></span></div>'+
        '<div class="ypfr-meta"><b>'+yfEsc(f.nick)+'<span class="yp-verified"><i class="ri-verified-badge-fill"></i></span></b>'+
          '<span class="last">'+yfEsc(String(last).slice(0,40))+'</span></div>'+
        ((t.unread||0)>0?'<span class="ypfr-unread">'+Math.min(99,t.unread)+'</span>':'')+
        '<button class="ypfr-btn ghost" data-act="remove" data-uid="'+yfEsc(f.uid)+'" title="친구 삭제"><i class="ri-close-line"></i></button></div>';
    });
    if(YF.reqOut.length){
      h+='<div class="ypfr-ttl">보낸 요청 <span class="cnt">'+YF.reqOut.length+'</span></div>';
      YF.reqOut.forEach(function(r){
        h+='<div class="ypfr-item">'+
          '<div class="ypfr-ava" style="background:'+yfColor(r.uid)+'">'+yfEsc((r.nick||'?').slice(0,2))+'</div>'+
          '<div class="ypfr-meta"><b>'+yfEsc(r.nick)+'</b><span class="dim">수락을 기다리는 중…</span></div>'+
          '<button class="ypfr-btn ghost" data-act="cancel" data-uid="'+yfEsc(r.uid)+'">취소</button></div>';
      });
    }
    h+='<div class="ypfr-empty" style="padding-top:6px">내 고정 닉네임: <b>'+yfEsc(me&&me.nick||'')+'</b> · 친구에게 이 닉네임을 알려 주세요</div>';
    box.innerHTML=h;
  }
  function yfFriendsClick(e){
    if(!yfAuthed()){
      var lb=e.target.closest&&e.target.closest('#ypFrLoginBtn');
      if(lb&&window.sdyAuthOpen) window.sdyAuthOpen();
      return;
    }
    var act=e.target.closest&&e.target.closest('[data-act]');
    if(act){
      var uid=act.getAttribute('data-uid'), a=act.getAttribute('data-act');
      if(a==='accept') yfReqAction('/api/friends/accept',{uid:uid},function(d){ return (d.user?d.user.nick:'')+' 님과 친구가 됐어요'; });
      else if(a==='decline') yfReqAction('/api/friends/decline',{uid:uid},function(){ return '요청을 거절했어요'; });
      else if(a==='cancel') yfReqAction('/api/friends/cancel',{uid:uid},function(){ return '요청을 취소했어요'; });
      else if(a==='remove'){
        var row=act.closest('.ypfr-item'); var nm=row?row.getAttribute('data-nick')||'친구':'친구';
        if(window.confirm(nm+' 님을 친구에서 삭제할까요?\n(대화 내용은 30일 뒤 자동으로 지워져요)'))
          yfReqAction('/api/friends/remove',{uid:uid},function(){ return '친구를 삭제했어요'; });
      }
      return;
    }
    if(e.target.closest&&e.target.closest('#ypFrAddBtn')){ yfAddFriend(); return; }
    var open=e.target.closest&&e.target.closest('[data-open]');
    if(open){ yfOpenDm(open.getAttribute('data-open')); }
  }

  // ── 1:1 대화 렌더 ──
  function yfDmCachePut(uid,msg,render){
    var list=YF.msgs[uid]||(YF.msgs[uid]=[]);
    for(var i=0;i<list.length;i++){ if(list[i].id===msg.id) { if(render&&YF.view==='dm'&&YF.peer&&YF.peer.uid===uid) yfRenderDm(true); return; } }
    // 같은 내용의 임시 버블을 서버 메시지로 치환
    for(var j=list.length-1;j>=0;j--){
      var x=list[j];
      if(x.temp&&x.from===msg.from&&x.text===msg.text){ list.splice(j,1,msg); if(render) yfCondRender(uid,true); return; }
    }
    list.push(msg);
    if(render) yfCondRender(uid,true);
  }
  function yfCondRender(uid,smooth){ if(YF.view==='dm'&&YF.peer&&YF.peer.uid===uid) yfRenderDm(smooth); }
  function yfTempDrop(uid,local){
    var list=YF.msgs[uid]||[];
    for(var i=0;i<list.length;i++){ if(list[i].id===local.id){ list.splice(i,1); break; } }
    yfCondRender(uid,true);
  }
  function yfRenderDm(smooth){
    var body=$('ypDmBody'); if(!body) return;
    var peer=YF.peer; if(!peer){ body.innerHTML=''; return; }
    var me=yfUser(); var myUid=me?me.uid:'';
    var list=YF.msgs[peer.uid]||[];
    var stick=YF.stickDm;
    var h='';
    if(YF.more[peer.uid]) h+='<button class="yp-dm-more">이전 대화 더 보기</button>';
    if(!list.length){
      h+='<div class="yp-empty"><span class="yp-egg">💬</span><b>'+yfEsc(peer.nick)+' 님과의 대화</b><br>첫 메시지를 보낸 보세요 · 사진과 파일도 보낸 수 있어요</div>';
    }
    // 같은 사람의 연속 메시지를 한 줄(그룹)로 묶는다
    var gs=[]; var last=null;
    for(var i=0;i<list.length;i++){
      var m=list[i];
      if(last&&last.from===m.from){ last.msgs.push(m); last.lastTs=m.ts; }
      else{ last={from:m.from,msgs:[m],lastTs:m.ts}; gs.push(last); }
    }
    var readTo=YF.peerRead[peer.uid]||0;
    for(var g=0;g<gs.length;g++){
      var grp=gs[g]; var mine=grp.from===myUid;
      h+='<div class="yp-line'+(mine?' me':'')+'">';
      if(!mine){
        h+='<div class="yp-ava" style="background:'+yfColor(peer.uid)+'">'+yfEsc((peer.nick||'?').slice(0,2))+'</div>';
      }
      h+='<div class="yp-stack">';
      if(!mine) h+='<div class="yp-who">'+yfEsc(peer.nick)+'<span class="yp-verified" title="회원 · 고정 닉네임"><i class="ri-verified-badge-fill"></i></span></div>';
      for(var k=0;k<grp.msgs.length;k++){
        var mm=grp.msgs[k];
        h+='<div class="yp-bwrap">';
        if(mine&&!mm.temp&&typeof mm.id==='number'&&mm.id>readTo) h+='<span class="yp-dm-cnt">1</span>';
        if(mm.kind==='img'&&mm.file){
          h+= mm.file.gone
            ? '<div class="yp-bub" style="opacity:.6">오래돼 사라진 사진이에요 🫥</div>'
            : '<img class="yp-img" loading="lazy" src="/api/dm/file/'+mm.file.id+'?token='+encodeURIComponent(yfToken())+'" alt="사진" data-zoom="'+mm.file.id+'">';
        }else if(mm.kind==='file'&&mm.file){
          h+= mm.file.gone
            ? '<div class="yp-bub" style="opacity:.6">오래돼 사라진 파일이에요 🫥</div>'
            : '<a class="yp-file" href="/api/dm/file/'+mm.file.id+'?token='+encodeURIComponent(yfToken())+'" target="_blank" rel="noopener" download="'+yfEsc(mm.file.name)+'">'+
              '<span class="fi"><i class="ri-file-3-line"></i></span><span class="fm"><span class="fn">'+yfEsc(mm.file.name)+'</span><span class="fs">'+yfSize(mm.file.size||0)+'</span></span>'+
              '<i class="ri-download-2-line" style="color:#8b93a5;font-size:14px"></i></a>';
        }else{
          // 18.3 · 1:1 대화도 해돌이 임티를 그림으로 보여 준다
          var td=document.createElement('div');
          var stkOnly=ypStkOnly(mm.text);
          if(stkOnly){
            td.className='yp-stkmsg';
            var stk=YP_STK.svg(stkOnly,'yp-stk-big');
            if(stk) td.appendChild(stk); else { td.className='yp-bub'; td.textContent=mm.text||''; }
          }else{ td.className='yp-bub'; ypStkRenderText(td,mm.text||''); }
          h+=td.outerHTML;
        }
        if(mine&&!mm.temp){
          h+='<button class="yp-del" title="메시지 삭제" data-dm-del="'+mm.id+'"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/></svg></button>';
        }
        h+='</div>';
      }
      h+='<div class="yp-time">'+ypTime(grp.lastTs)+'</div>';
      h+='</div></div>';
    }
    body.innerHTML=h;
    if(stick){
      if(smooth&&body.scrollTo) body.scrollTo({top:body.scrollHeight,behavior:'smooth'});
      else body.scrollTop=body.scrollHeight;
    }
  }
  function yfDmBodyClick(e){
    var del=e.target.closest&&e.target.closest('[data-dm-del]');
    if(del){
      var id=parseInt(del.getAttribute('data-dm-del'),10);
      if(id) yfDelDm(id);
      return;
    }
    var img=e.target.closest&&e.target.closest('img[data-zoom]');
    if(img){ yfDmZoom(img.getAttribute('data-zoom')); return; }
    if(e.target.closest&&e.target.closest('.yp-dm-more')){ yfLoadOlder(); }
  }
  function yfDmZoom(fid){
    var ov=$('ypZoom');
    if(!ov){
      ov=document.createElement('div'); ov.id='ypZoom';
      ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9990;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
      ov.onclick=function(){ ov.parentNode&&ov.parentNode.removeChild(ov); };
      document.body.appendChild(ov);
    }
    ov.innerHTML='<img src="/api/dm/file/'+fid+'?token='+encodeURIComponent(yfToken())+'" alt="" style="max-width:92vw;max-height:92vh;border-radius:10px;">';
  }
  function yfDelDm(id){
    var peer=YF.peer; if(!peer) return;
    yfApi('/api/dm/del',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:peer.uid,id:id})})
      .then(function(res){
        if(res.d&&res.d.ok){
          var list=YF.msgs[peer.uid]||[];
          for(var i=0;i<list.length;i++){ if(list[i].id===id){ list.splice(i,1); break; } }
          yfRenderDm(false);
        }else toast((res.d&&res.d.error)||'지우지 못했어요',2000);
      }).catch(function(){ toast('지우지 못했어요',2000); });
  }
  function yfSendText(t){
    var peer=YF.peer, me=yfUser(); if(!peer||!me) return;
    // 14.57.0 · DM도 동일 내용 연속 더블 전송 방지 (ypSendText 가드와 이중 보장)
    var now2=Date.now(); var k2=peer.uid+'|'+t;
    if(YF._lastDmKey===k2 && now2-(YF._lastDmAt||0)<900) return;
    YF._lastDmKey=k2; YF._lastDmAt=now2;
    var ta=$('ypTxt'); ta.value=''; ypAutoGrow(ta); ta.focus();
    var local={id:ypTempId(),kind:'txt',from:me.uid,text:t,ts:Date.now()/1000,temp:true};
    (YF.msgs[peer.uid]||(YF.msgs[peer.uid]=[])).push(local);
    YF.stickDm=true; yfRenderDm(true);
    yfApi('/api/dm/msg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:peer.uid,text:t})})
      .then(function(res){
        if(res.d&&res.d.ok&&res.d.msg){
          yfDmCachePut(peer.uid,res.d.msg,true);
          if(YF.threads[peer.uid]){ YF.threads[peer.uid].last={text:res.d.msg.text,kind:'txt',ts:res.d.msg.ts}; }
          yfReadLatest(peer.uid);
        }else{
          yfTempDrop(peer.uid,local);
          toast((res.d&&res.d.error)||'보내지 못했어요',2200);
        }
      })
      .catch(function(){ yfTempDrop(peer.uid,local); toast('보내지 못했어요 · 연결을 확인해 주세요',2000); });
  }
  function yfUploadDm(file){
    var peer=YF.peer; if(!peer) return;
    var kind=file.type&&file.type.indexOf('image/')===0?'img':'file';
    var cap=kind==='img'?8*1024*1024:20*1024*1024;
    if(file.size>cap){ toast(kind==='img'?'사진은 8MB 이하만 가능해요':'파일은 20MB 이하만 가능해요',2400); return; }
    toast(kind==='img'?'사진을 올리는 중…':'파일을 올리는 중…',1400);
    var fd=new FormData(); fd.append('to',peer.uid); fd.append('file',file,file.name||'file');
    fetch('/api/dm/upload',{method:'POST',headers:{'x-sdy-auth':yfToken()},body:fd})
      .then(function(r){return r.json();})
      .then(function(d){
        if(d&&d.ok&&d.msg){ yfDmCachePut(peer.uid,d.msg,true); yfReadLatest(peer.uid); }
        else toast((d&&d.error)||'올리지 못했어요',2400);
      })
      .catch(function(){ toast('올리지 못했어요 · 연결을 확인해 주세요',2400); });
  }

  // ── 회원 SSE (실시간 수신) ──
  function yfHandle(ev){
    if(!ev||!ev.type) return;
    if(ev.type==='hello'){ return; }
    if(ev.type==='dm_msg'){
      var peer=ev.peer, m=ev.msg; if(!peer||!m) return;
      var mine=yfUser()&&m.from===yfUser().uid;
      // 캐시 + 스레드 반영
      var viewing=YF.view==='dm'&&YF.peer&&YF.peer.uid===peer;
      yfDmCachePut(peer,m,viewing&&YP.open);
      if(YF.threads[peer]) YF.threads[peer].last={text:m.text,kind:m.kind,ts:m.ts};
      if(!mine){
        if(typeof ev.unread==='number'){
          if(!YF.threads[peer]) YF.threads[peer]={uid:peer,unread:0};
          YF.threads[peer].unread=ev.unread;
        }
        // DM 화면을 보고 있으면 바로 읽음 처리, 아니면 알림
        if(viewing&&YP.open&&document.visibilityState==='visible'){
          YF.stickDm=YF.stickDm||ypNearBottom();
          yfReadLatest(peer);
        }else{
          if(YPS.sound) ypBeep('msg');
          if(YPS.desk) ypNotify(m.name||'친구', (m.text||(m.kind==='img'?'[사진]':'[파일]')));
          yfChipShakeDm();
        }
      }
      if(YF.view==='friends') yfRenderFriends();
      yfBadgeRefresh();
      return;
    }
    if(ev.type==='dm_read'){
      if(ev.peer){ YF.peerRead[ev.peer]=ev.id||0; if(YF.view==='dm'&&YF.peer&&YF.peer.uid===ev.peer) yfRenderDm(false); }
      return;
    }
    if(ev.type==='dm_del'){
      var uid2=ev.peer; var li=YF.msgs[uid2]||[];
      for(var i=0;i<li.length;i++){ if(li[i].id===ev.id){ li.splice(i,1); break; } }
      yfCondRender(uid2,false);
      return;
    }
    if(ev.type==='presence'){
      if(ev.uid){
        for(var pi=0;pi<YF.friends.length;pi++){ if(YF.friends[pi].uid===ev.uid) YF.friends[pi].online=!!ev.online; }
        if(YF.threads[ev.uid]) YF.threads[ev.uid].online=!!ev.online;
        if(YF.peer&&YF.peer.uid===ev.uid){ YF.peer.online=!!ev.online; if(YF.view==='dm'){ var ttl=$('ypTtlTxt'); if(ttl) ttl.textContent=(YF.peer.online?'🟢 ':'')+YF.peer.nick; } }
        if(YF.view==='friends') yfRenderFriends();
      }
      return;
    }
    if(ev.type==='friend'){
      var u=ev.user||{};
      if(ev.action==='req_in'){ toast((u.nick||'누군가')+' 님이 친구 요청을 보냈어요',2600); if(YPS.sound) ypBeep('msg'); yfChipShakeDm(); }
      else if(ev.action==='accepted'){ toast((u.nick||'상대')+' 님과 친구가 됐어요',2400); if(YPS.sound) ypBeep('msg'); }
      else if(ev.action==='declined'){ toast((u.nick||'상대')+' 님이 친구 요청을 거절했어요',2400); }
      else if(ev.action==='removed'){ toast((u.nick||'상대')+' 님이 친구를 삭제했어요',2400); if(YF.peer&&u.uid===YF.peer.uid&&YF.view==='dm') yfViewShow('friends'); }
      yfFriendsLoad(); yfThreadsLoad();
      return;
    }
  }
  function yfChipShakeDm(){ if(YP.open) return; var c=$('ypReopen'); if(c){ c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); } var p=$('proYpBtn'); if(p){ p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake'); } }
  function yfStream(tk){
    if(YF.es){ try{YF.es.close();}catch(e){} YF.es=null; }
    var es;
    try{ es=new EventSource('/api/dm/stream?token='+encodeURIComponent(tk)); }catch(e){ return; }
    YF.es=es;
    es.addEventListener('dm',function(e){ var m; try{m=JSON.parse(e.data);}catch(_){return;} yfHandle(m); });
    es.onerror=function(){
      try{es.close();}catch(e){}
      if(YF.es!==es) return;
      YF.es=null;
      clearTimeout(YF._esT);
      var wait=YF._esBack; YF._esBack=Math.min(15000,Math.round(YF._esBack*1.7));
      YF._esT=setTimeout(yfStreamStart,wait);
    };
  }
  function yfStreamStart(){
    var tk=yfToken();
    if(!tk){
      if(YF.es){ try{YF.es.close();}catch(e){} YF.es=null; }
      return;
    }
    YF._esBack=1500;
    yfStream(tk);
    yfThreadsLoad();
    yfFriendsLoad();
  }

  // ── 배선 ──
  var chip=document.createElement('button');
  chip.id='ypReopen'; chip.title='엽스코드 · 채팅';
  chip.innerHTML=TTEK+'<span class="yp-badge yp-voice" id="ypChipVoice"></span><span class="yp-dm" id="ypChipDm" style="display:none"></span>';
  chip.onclick=function(){ if(YP.open) ypClose(); else ypEnter(); };
  document.body.appendChild(chip);
  chip.style.display='flex';

  // 16.3 · 친구/1:1 대화 배선
  (function(){
    var frBtn=$('ypFrBtn'), backBtn=$('ypBack'), frBox=$('ypFriends'), dmBody=$('ypDmBody');
    if(frBtn) frBtn.onclick=function(){ yfToggleFriends(); };
    if(backBtn) backBtn.onclick=function(){ yfViewShow('room'); };
    if(frBox){
      frBox.addEventListener('click',yfFriendsClick);
      frBox.addEventListener('keydown',function(e){
        if(e.key==='Enter'&&e.target&&e.target.id==='ypFrAddInp'){ e.preventDefault(); yfAddFriend(); }
      });
    }
    if(dmBody){
      dmBody.addEventListener('click',yfDmBodyClick);
      dmBody.addEventListener('scroll',function(){
        YF.stickDm=dmBody.scrollHeight-dmBody.scrollTop-dmBody.clientHeight<110;
        if(dmBody.scrollTop<30&&YF.more[YF.peer?YF.peer.uid:'']) yfLoadOlder();
      });
    }
    // 로그인 상태 변화 → 스트림·목록 정리
    window.addEventListener('sdy-auth',function(){
      if(yfAuthed()){ yfStreamStart(); }
      else{
        if(YF.es){ try{YF.es.close();}catch(e){} YF.es=null; }
        clearTimeout(YF._esT);
        YF.friends=[];YF.reqIn=[];YF.reqOut=[];YF.threads={};YF.msgs={};YF.peerRead={};
        if(YF.view!=='room') yfViewShow('room');
        yfBadgeRefresh();
      }
    });
    // DM 화면을 보고 있다가 탭으로 돌아오면 읽음 처리
    document.addEventListener('visibilitychange',function(){
      if(document.visibilityState==='visible'&&YF.view==='dm'&&YF.peer) yfReadLatest(YF.peer.uid);
    });
    // 부팅 시 이미 로그인돼 있으면 바로 연결
    if(yfAuthed()) yfStreamStart();
  })();

  var bodyEl=$('ypBody');
  bodyEl.addEventListener('scroll',function(){ YP.stick=ypNearBottom(); });
  bodyEl.addEventListener('click',function(e){
    var btn=e.target.closest&&e.target.closest('.yp-reacts button');
    if(btn){ var mid=btn.getAttribute('data-mid'), em=btn.getAttribute('data-e');
      if(mid&&em) window.__ypReact(parseInt(mid,10),em); return; }
    var del=e.target.closest&&e.target.closest('.yp-del');
    if(del){ var id=parseInt(del.getAttribute('data-del'),10); if(id) ypDeleteMsg(id); }
  });
  var ta=$('ypTxt');
  ta.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); ypSendText(); } });
  ta.addEventListener('input',function(){ ypAutoGrow(ta); });
  $('ypSend').onclick=ypSendText;
  $('ypFold').onclick=ypClose;
  $('ypVJoin').onclick=function(){ if(YP.inVoice) ypLeaveVoice(); else ypJoinVoice(); };
  $('ypVMute').onclick=ypToggleMute;
  $('ypFileBtn').onclick=function(){ $('ypFileInp').click(); };
  $('ypFileInp').onchange=function(){ ypUpload(this.files[0]); this.value=''; };
  $('ypKnockBtn').onclick=ypKnock;
  $('ypBgmBtn').onclick=ypBgmToggleBar;
  $('ypBgmPause').onclick=ypBgmPause;
  $('ypBgmVol').oninput=function(e){ if(BGM.audio) BGM.audio.volume=(+e.target.value)/100; };
  var bgmSearch=$('ypBgmSearch');
  bgmSearch.addEventListener('input',function(){ ypBgmLoadList(ypBgmSearch); });
  bgmSearch.addEventListener('keydown',function(e){
    if(e.key==='Enter'){
      e.preventDefault();
      var first=$('ypBgmRes').querySelector('button');
      if(first){ var t=BGM.list.find(function(x){return String(x.id)===first.getAttribute('data-id');}); if(t) ypBgmPick(t); }
    }
  });
  $('ypBgmRes').addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('button'); if(!b) return;
    var id=b.getAttribute('data-id');
    var t=BGM.list.find(function(x){return String(x.id)===id;});
    if(t) ypBgmPick(t);
  });
  var emo=$('ypEmoji');
  emo.innerHTML='';
  YP_STK.list().forEach(function(s){                      // 18.3 · 해돌이 임티 선택창
    var b=document.createElement('button');
    b.setAttribute('data-e',s.id); b.title=s.label; b.setAttribute('aria-label',s.label);
    var el=YP_STK.svg(s.id,'yp-stk-pick');
    if(el) b.appendChild(el); else b.textContent=s.id;
    emo.appendChild(b);
  });
  emo.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('button'); if(!b) return;
    var id=b.getAttribute('data-e'); if(!id) return;
    if(ypStkIds([id]).length){
      YP.draftStickers.push(id);
      if(YP.draftStickers.length>6) YP.draftStickers=YP.draftStickers.slice(-6);
      ypRenderDraftStickers();
    }
    var t=$('ypTxt'); ypAutoGrow(t); t.focus();
  });
  var draftBox=$('ypDraftStickers');
  if(draftBox){
    draftBox.addEventListener('click',function(e){
      var rm=e.target.closest&&e.target.closest('button[data-rm]'); if(!rm) return;
      var i=parseInt(rm.getAttribute('data-rm'),10);
      if(!isNaN(i)){ YP.draftStickers.splice(i,1); ypRenderDraftStickers(); }
      var t=$('ypTxt'); if(t) t.focus();
    });
  }
  $('ypEmojiBtn').onclick=function(e){ e.stopPropagation(); emo.classList.toggle('open'); var row=$('ypReactRow'); if(row)row.classList.remove('open'); };
  $('ypReactRow').addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('button'); if(!b) return;
    var row=$('ypReactRow'); var mid=parseInt(row.getAttribute('data-mid'),10);
    if(mid) window.__ypReact(mid,b.getAttribute('data-e'));
  });
  var st=$('ypSettings');
  $('ypSetBtn').onclick=function(e){ e.stopPropagation(); ypBuildSettings(); st.classList.toggle('open'); var row=$('ypReactRow'); if(row)row.classList.remove('open'); };
  st.addEventListener('click',ypSettingsClick);
  st.addEventListener('change',function(e){ if(e.target&&e.target.id==='ypSetNick') ypSetNickCommit(); });
  document.addEventListener('pointerdown',function(e){
    if(emo.classList.contains('open')&&!e.target.closest('#ypEmoji,#ypEmojiBtn')) emo.classList.remove('open');
    if(st.classList.contains('open')&&!e.target.closest('#ypSettings,#ypSetBtn')) st.classList.remove('open');
    var res=$('ypBgmRes');
    if(res.style.display!=='none'&&!e.target.closest('#ypBgm')) res.style.display='none';
  });
  document.addEventListener('contextmenu',function(e){
    var line=e.target.closest&&e.target.closest('.yp-line');
    if(!line) return;
    var mid=line.getAttribute('data-mid'); if(!mid) return;
    e.preventDefault(); ypShowReactRow(mid,e.clientX,e.clientY);
  });
  (function(){
    var t=null,tm=null;
    document.addEventListener('touchstart',function(e){
      var line=e.target.closest&&e.target.closest('.yp-line');
      if(!line) return;
      var mid=line.getAttribute('data-mid'); if(!mid) return;
      t={mid:mid,x:e.touches[0].clientX,y:e.touches[0].clientY};
      tm=setTimeout(function(){ if(t) ypShowReactRow(t.mid,t.x,t.y); },450);
    },{passive:true});
    document.addEventListener('touchend',function(){ if(tm){ clearTimeout(tm); tm=null; } t=null; });
    document.addEventListener('touchmove',function(){ if(tm){ clearTimeout(tm); tm=null; } t=null; });
  })();
  window.addEventListener('keydown',function(e){ if(e.key==='Escape'&&YP.open){ ypClose(); } });
  window.addEventListener('pagehide',function(){
    try{ navigator.sendBeacon('/api/chat/leave', new Blob([JSON.stringify({uid:YP.uid})],{type:'application/json'})); }catch(e){}
  });

  // ── 음악바(크로스바) 열고 닫힘 애니메이션 — 엽스코드와 통일 ──
  (function(){
    var pl=$('musicPlayer'); if(!pl) return;
    var chipMp=$('mpReopen');
    var wasShown=false, exiting=false;
    function openAni(){ pl.classList.remove('yp-mp-out'); pl.classList.add('yp-mp-open'); }
    if(chipMp){
      var orig=chipMp.onclick;
      chipMp.onclick=function(ev){ if(pl.classList.contains('mp-bar')) openAni(); if(orig) return orig.call(chipMp,ev); };
    }
    var mo=new MutationObserver(function(){
      if(!pl.classList.contains('mp-bar')) return;
      var shown = pl.style.display && pl.style.display!=='none';
      if(shown && !wasShown){ openAni(); wasShown=true; }
      else if(!shown && wasShown && !exiting){
        exiting=true;
        pl.classList.remove('yp-mp-open'); pl.classList.add('yp-mp-out');
        pl.style.display='flex';
        wasShown=true;
        setTimeout(function(){ pl.style.display='none'; exiting=false; wasShown=false; }, 245);
      }
    });
    mo.observe(pl,{attributes:true,attributeFilter:['style']});
  })();

  // ── 18.0 · 해돌이(해달 마스코트) ──────────────────────────────
  //   노래 해달(.mp-otter)은 #musicPlayer 안에 들어 있어
  //   하단 바가 뜨면 저절로 따라 나온다(표시 제어는 CSS 에 있다).
  //   노트 해달(#noteOtter)은 커서를 올리면(호버) om-idea(전구)로 잠깐
  //   변신했다가 om-doc(문서 내밀기) 모습으로 돌아온다 — CodePen 원본 상태
  //   머신 그대로. 누르는 건 대화기록(AI 블록) 몫 — 여기서 막지 않는다.
  (function(){
    var note=$('noteOtter'); if(!note) return;
    var svg=note.querySelector('svg');
    var t=null;
    function otterIdea(){
      if(!svg) return;
      svg.classList.remove('om-doc','om-idea');
      void svg.getBoundingClientRect();          // 애니메이션 재시작용 reflow
      svg.classList.add('om-idea');
      clearTimeout(t);
      t=setTimeout(function(){
        svg.classList.remove('om-idea');
        void svg.getBoundingClientRect();
        svg.classList.add('om-doc');
      },2800);                                   // eureka 한 바퀴(2.8s) 뒤 원래 모습으로
    }
    note.addEventListener('mouseenter',otterIdea);   // 아이디어는 클릭 말고 호버로
    note.addEventListener('focus',otterIdea);        // 키보드로 찾아와도 반짝
    note.addEventListener('keydown',function(e){     // Enter·Space = 누른 셈 → 대화기록
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        if(typeof window.sdyAiHistToggle==='function') window.sdyAiHistToggle();
      }
    });
    // 그리기 툴바가 하단을 차지하면 해달을 툴바 위로 피신시킨다
    var dt=$('drawToolbar');
    if(dt&&typeof MutationObserver!=='undefined'){
      new MutationObserver(function(){
        note.classList.toggle('draw-on',dt.style.display==='flex');
      }).observe(dt,{attributes:true,attributeFilter:['style']});
    }
  })();

  // ── 18.1 · 노트/노래 해돌이 말풍선 — 가만히 있으면 가끔씩 멘트를 바꿔가며 혼잣말한다 ──
  (function(){
    var note=$('noteOtter'), noteBub=$('noteOtterBubble');
    var mp=$('mpOtterBubble'), mpRoot=document.querySelector('.mp-otter');
    var pl=$('musicPlayer');
    // 18.5 · 싱크 가사 따라 부르기는 '호버'가 아니라 '클릭 토글'이다.
    //   한 번 누르면 다시 누를 때까지 계속 부른다.
    // 14.23.x · 기본값은 '켜짐' — 하단 바가 뜨면 곧바로 따라 부른다.
    //   클릭으로 끄면 다시 클릭할 때까지 꺼져 있다(아래 초기 상태 세팅이 켜짐 값).
    var mpSingOn=true;

    // 말풍선 보여주기 (show 클래스 + 타이머로 자동 숨김)
    function speak(bubble,text,dur){
      if(!bubble||!text) return;
      bubble.textContent=text;
      bubble.classList.add('show');
      if(bubble._t) clearTimeout(bubble._t);
      bubble._t=setTimeout(function(){ bubble.classList.remove('show'); }, dur||2400);
    }
    function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
    function mpVisible(){
      return !!(mp&&mpRoot&&pl&&pl.style.display!=='none'&&pl.classList.contains('mp-bar'));
    }
    function singText(line){
      var t=String(line||'').replace(/\s+/g,' ').trim();
      if(!t) t='♪';
      t=t.replace(/[~～]+$/,'').trim();
      return t+'~';
    }
    function mpActiveLine(){
      try{
        return window.sdyMusic&&window.sdyMusic.syncLine ? window.sdyMusic.syncLine() : null;
      }catch(e){ return null; }
    }
    function mpSinging(){ return mpSingOn; }
    function singCurrentLyric(){
      if(!mpVisible()||!mpSinging()) return;
      var t=null;
      try{ t=window.sdyMusic&&window.sdyMusic.cur ? window.sdyMusic.cur() : null; }catch(e){}
      if(!t){
        if(mp._singKey!=='idle:none'){
          mp._singKey='idle:none';
          speak(mp,'지금은 쉴래 해돌이~',1800);
        }
        return;
      }
      if(t.lyrics===undefined&&(t.has_lyrics||t.has_sync)){
        if(mp._singKey!=='loading:'+t.id){
          mp._singKey='loading:'+t.id;
          speak(mp,'싱크 가사 불러오는 중이해돌이~',1800);
        }
        if(!t._lyrLoading && window.sdyMusic&&window.sdyMusic.ensureLyrics){
          window.sdyMusic.ensureLyrics(t).then(function(){ if(mpSinging()) singCurrentLyric(); }).catch(function(){});
        }
        return;
      }
      var hit=mpActiveLine();
      // 18.6 · 가사가 없는(말 안 하는) 구간 — 말풍선을 접었다가 다음 가사에 다시 띄운다
      if(hit&&hit.gap){
        if(mp._singKey!=='gap'){
          mp._singKey='gap';
          if(mp._t) clearTimeout(mp._t);
          mp.classList.remove('show');
        }
        return;
      }
      if(hit&&hit.line){
        var line=singText(hit.line.s);
        var key=(hit.track&&hit.track.id||'')+'|'+hit.idx+'|'+line;
        if(mp._singKey!==key){
          mp._singKey=key;
          speak(mp,line,Math.max(1600,Math.min(4200,900+line.length*150)));
        }
        return;
      }
      var noKey='nosync:'+(t.id||'');
      if(mp._singKey!==noKey){
        mp._singKey=noKey;
        speak(mp,'이 곡은 아직 싱크 가사가 없해돌이~',1800);
      }
    }
    // 켜기/끄기 — 켜면 즉시 지금 가사부터 부르고, 끌 때까지 계속 부른다.
    function setMpSing(on){
      mpSingOn=!!on;
      if(mpRoot){
        mpRoot.classList.toggle('singing',mpSingOn);
        try{ mpRoot.setAttribute('aria-pressed',mpSingOn?'true':'false'); }catch(e){}
      }
      if(!mp) return;
      mp._singKey='';
      if(mpSingOn){
        singCurrentLyric();
        if(!mp.classList.contains('show')) speak(mp,'따라 부를게 해돌이~ 🎤',1400);
      }else{
        if(mp._t) clearTimeout(mp._t);
        mp.classList.remove('show');
      }
    }

    // ── 노트(문서) 해돌이 ──
    var NOTE_IDLE=[
      '오늘은 뭘 끄적일까 해돌이~?',
      '집중하면 뭐든 돼! 해돌이~',
      '아이디어 떠오르면 날 눌러봐 해돌이!',
      '끄적끄적~ 글 쓰는 거 재밌지? 해돌이~',
      '휴식도 중요해! 물 한 잔 어때 해돌이~?',
      '천천히 써도 괜찮아 해돌이~'
    ];
    var NOTE_TAP=[
      '굿 아이디어! 해돌이~!',
      '오! 멋진 생각이다 해돌이~!',
      '번쩍! 아이디어가 떠올랐해돌이!',
      '역시 너야! 해돌이~'
    ];
    var editor=$('editorView');
    // 14.23.x · AI 말풍선(#aiSay)·대화기록(#aiHist)이 떠 있으면 노래/아이디어
    //   작은 말풍선(#noteOtterBubble)을 띄우지 않는다 — 둘 다 해돌이 머리 위에
    //   붙어 있어 겹쳐 보인다. AI 창이 열려 있는 동안에는 조용히.
    function noteAiOpen(){
      var say=document.getElementById('aiSay'), h=document.getElementById('aiHist');
      return (say&&!say.hidden)||(h&&!h.hidden);
    }
    function noteBubbleTry(t,dur){
      if(noteAiOpen()) return;                    // AI 창이 떠 있으면 겹침 방지 — 조용히
      speak(noteBub,t,dur);
    }
    function hideNoteBubble(){
      if(noteBub){
        if(noteBub._t) clearTimeout(noteBub._t);
        noteBub.classList.remove('show');
      }
    }
    if(note&&noteBub){
      // 아이디어 한마디도 클릭이 아니라 호버에 맞춰 나온다 (클릭은 대화기록 몫)
      note.addEventListener('mouseenter',function(){ noteBubbleTry(pick(NOTE_TAP),1800); });
      setInterval(function(){
        if(editor&&!editor.classList.contains('open')) return;  // 편집기가 닫혀 있으면 조용히
        noteBubbleTry(pick(NOTE_IDLE),2400);
      }, 16000);
      // AI 말풍선/대화기록이 열리는 순간, 떠 있던 작은 말풍선을 바로 접는다.
      //   (안 그러면 둘이 겹쳐 보이고, 호버 말풍선이 어색하게 남는다)
      if(typeof MutationObserver!=='undefined'){
        ['aiSay','aiHist'].forEach(function(id){
          var el=document.getElementById(id);
          if(el) new MutationObserver(function(){
            if(!el.hidden) hideNoteBubble();
          }).observe(el,{attributes:true,attributeFilter:['hidden']});
        });
      }
    }

    // ── 노래 해돌이 ──
    var MP_IDLE=[
      '둠칫둠칫~!',
      '제 이름은 해돌이야. 만나서 반갑해돌이!',
      '이 노래 너무 좋다 해돌이~',
      '볼륨 한 번 올려볼까 해돌이~?',
      '어깨가 절로 들썩이네 해돌이~',
      '나도 같이 흔들고 싶어 해돌이~'
    ];
    function mpSongPhrase(){
      try{
        var t=window.sdyMusic&&window.sdyMusic.cur ? window.sdyMusic.cur() : null;
        if(t&&t.title) return '지금 "'+t.title+'" 같이 들을래 해돌이~?';
      }catch(e){}
      return null;
    }
    if(mpRoot){
      // 클릭(또는 Enter/Space)으로 켜고 끈다 — 재클릭 전까지 계속 부른다.
      var mpToggleSing=function(){ setMpSing(!mpSingOn); };
      mpRoot.addEventListener('click',mpToggleSing);
      mpRoot.addEventListener('keydown',function(e){
        if(e.key==='Enter'||e.key===' '){ e.preventDefault(); mpToggleSing(); }
      });
      // 14.23.x · 기본값 켜짐 — 해돌이가 노래하는 모습(singing 클래스)과
      //   aria-pressed 를 초기 상태부터 맞춰 준다. 여기서는 말풍선을 띄우지
      //   않고(mpVisible() 전) 상태만 세팅하고, 실제 가사는 아래 13초/120ms
      //   주기 루프가 곡이 시작되면 알아서 부른다.
      mpSingOn=true;
      mpRoot.classList.add('singing');
      try{ mpRoot.setAttribute('aria-pressed','true'); }catch(e){}
    }
    if(mp&&pl){
      setInterval(function(){
        if(!mpVisible()) return;                     // 음악바가 안 보이면 조용히
        if(mpSinging()){ singCurrentLyric(); return; }
        var song=mpSongPhrase();
        speak(mp, (song&&Math.random()<0.4)?song:pick(MP_IDLE), 2600);
      }, 13000);
      setInterval(function(){
        if(!mpSinging()) return;
        singCurrentLyric();
        // 부르는 동안에는 말풍선이 꺼지지 않게 계속 붙잡아 둔다
        // 단, 간주(gap) 구간에서는 접어둔 말풍선을 다시 띄우지 않는다
        if(mp._singKey!=='gap'&&mp.textContent&&!mp.classList.contains('show')) mp.classList.add('show');
      }, 120);
    }
  })();

  // ── 18.2 · 해돌이 스쿼드 인터랙션 (Notion '해돌이 스쿼드') ──────────────
  //   편지(엽스코드) · 커피(설정) · 독서(타이머) 해돌이는 누르면
  //   쭈뼛-뾰쪽 + 선물 파티클 + 말풍선(om-say).
  //   비행기 해돌이는 홈 화면에서 아주 가끔(평균 10여 분에 한 번 꼴)
  //   왼쪽 위에서 나타나 오른쪽으로 날아간다.
  (function(){
    var wps=document.querySelectorAll('.om-mini[data-word]');
    for(var i=0;i<wps.length;i++){
      (function(w){
        if(w.getAttribute('data-ombound')==='1') return;
        w.setAttribute('data-ombound','1');
        var say=w.querySelector('.om-say'), hideT=null;
        w.addEventListener('click',function(e){
          // 1) 쭈뼛-뾰쪽 반응
          w.classList.remove('om-got'); void w.offsetWidth;
          w.classList.add('om-got');
          setTimeout(function(){ w.classList.remove('om-got'); },600);
          // 2) 누른 자리에서 선물 파티클
          var gift=w.getAttribute('data-gift')||'⭐';
          var r=w.getBoundingClientRect();
          var g=document.createElement('span');
          g.className='om-gift'; g.textContent=gift;
          g.style.left=(e.clientX?(e.clientX-r.left):(r.width/2))+'px';
          g.style.top=(e.clientY?(e.clientY-r.top):(r.height/2))+'px';
          w.appendChild(g);
          setTimeout(function(){ if(g.parentNode) g.parentNode.removeChild(g); },1250);
          // 3) 말풍선
          if(say){
            say.textContent=w.getAttribute('data-word')||'';
            say.classList.add('om-on');
            if(hideT) clearTimeout(hideT);
            hideT=setTimeout(function(){ say.classList.remove('om-on'); },2400);
          }
        });
      })(wps[i]);
    }

    // ── 홈 화면 위에서만 (에디터·모달·집중시계·엽스코드 열림 = 홈 아님) ──
    var plane=document.getElementById('planeOtter');
    function homeVisible(){
      var ed=document.getElementById('editorView');
      if(ed&&ed.classList.contains('open')) return false;
      var fc=document.getElementById('focusClock');
      if(fc&&fc.classList.contains('show')) return false;
      var yp=document.getElementById('ypApp');
      if(yp&&yp.classList.contains('open')) return false;
      var gate=document.getElementById('ypGate');
      if(gate&&gate.style.display==='flex') return false;
      var auth=document.getElementById('sdyAuthWrap');
      if(auth&&auth.style.display==='flex') return false;
      var mbs=document.querySelectorAll('.modal-bg');
      for(var j=0;j<mbs.length;j++){
        var mb=mbs[j];
        if(mb.style.display==='flex'||mb.style.display==='block') return false;
      }
      return true;
    }
    function planeFly(){
      if(!plane||plane._flying) return;
      try{
        if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      }catch(e){}
      plane._flying=true;
      plane.classList.remove('fly'); void plane.offsetWidth;
      /* 18.3 · 비행기가 홈 화면 가장 오른쪽 끝까지 완전히 빠져나가도록
         종료점을 창 이동 알고리즘(sdyViewportBox)이 쓰는 것과 똑같은
         화면 폭으로 잡는다. left:-240px 에서 시작하므로, 오른쪽 바깥으로
         사라질 때까지 가야 할 거리 = 240px(0점까지) + 화면폭 + 비행기 폭 + 여유 60px.
         html{zoom:.9} 이든 폰이든 해상도가 다르든 화면이 잘리지 않는다. */
      try{
        var vp=window.sdyViewportBox?window.sdyViewportBox():null;
        var vw=(vp&&vp.w>0)?vp.w:Math.max(window.innerWidth||0,document.documentElement.clientWidth||0);
        var pw=plane.offsetWidth||150;
        var dx=240+vw+pw+60;
        plane.style.setProperty('--plane-fly-dx',dx+'px');
      }catch(e){}
      plane.classList.add('fly');
      try{ if(plane._say) plane._say(); }catch(e){}
      setTimeout(function(){ plane.classList.remove('fly'); plane._flying=false; },12500);
    }
    // 아주 가끔: 2분마다 15% 확률 → 평균 약 13분에 한 번
    setInterval(function(){
      if(Math.random()<0.15&&homeVisible()) planeFly();
    },120000);
  })();

  // ── 18.3 · 엽스코드/집중(스톱워치·타이머)/비행기 해돌이 혼잣말 ──
  //   음악 해돌이처럼 가만히 있어도 주기적으로 말풍선(om-say)을 바꿔가며 떠든다.
  //   단, 사용법(졸리는) 해돌이는 건드려야만 말한다 — 여기서 건드리지 않는다.
  (function(){
    var gateOtter=document.querySelector('#ypGate .yp-otter');
    var fcOtter=document.querySelector('#focusClock .fc-otter');
    var plane=document.getElementById('planeOtter');

    function say(root,text,dur){
      var s=root&&root.querySelector('.om-say');
      if(!s||!text) return;
      s.textContent=text;
      s.classList.add('om-on');
      if(s._t) clearTimeout(s._t);
      s._t=setTimeout(function(){ s.classList.remove('om-on'); }, dur||2600);
    }
    function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

    // ── 엽스코드 입장 게이트 (편지 해돌이) ──
    var YP_IDLE=[
      '편지 왔어요! 열어볼래? 해돌이~',
      '로그인해도 되고, 가볍게 들어와도 돼 해돌이~',
      '만나서 반가워요! 해돌이~',
      '이 카드에 편지가 숨어 있어요 해돌이~',
      '두근두근… 소포 배달 해돌이~!'
    ];
    if(gateOtter){
      setInterval(function(){
        var g=document.getElementById('ypGate');
        if(!g||g.style.display!=='flex') return;
        say(gateOtter,pick(YP_IDLE),2600);
      },14000);
    }

    // ── 집중 화면 (독서 해돌이 — 스톱워치·타이머·시계) ──
    var FC_IDLE=[
      '몇 분 집중할래? 해돌이~',
      '시작 버튼만 누르면 돼 해돌이!',
      '물 한 모금 마시고 오자 해돌이~',
      '25분 뽀모도로가 국룰이야 해돌이~',
      '천천히 가도 괜찮아 해돌이~',
      '책장 넘기는 소리가 좋다 해돌이~'
    ];
    if(fcOtter){
      setInterval(function(){
        var fc=document.getElementById('focusClock');
        if(!fc||!fc.classList.contains('show')||fc.classList.contains('idle')) return;
        say(fcOtter,pick(FC_IDLE),2600);
      },12000);
    }

    // ── 비행기 해돌이 — 비행 중에만 말한다 (출발할 때도 한마디) ──
    var FLY_IDLE=[
      '두둥~! 여행 가는 길이야 해돌이~',
      '가끔은 날아다니는 것도 필요하잖아 해돌이~',
      '구름 위는 역시 좋다 해돌이~',
      '잠깐! 나 지금 급해 해돌이~!',
      '비행기 모드 ON! 해돌이~',
      '창밖 구경 한번 할래? 해돌이~'
    ];
    if(plane){
      plane._say=function(){ say(plane,pick(FLY_IDLE),2800); };
      setInterval(function(){
        if(plane.classList.contains('fly')) say(plane,pick(FLY_IDLE),2800);
      },7000);
    }
  })();

  ypDrag();

  // ── 16.2 · 입장 게이트: '로그인' 또는 '비회원' ──
  // 페이지를 열자마자 자동으로 방에 들어가지 않는다. 칩을 눌러 엽스코드에
  // 처음 들어올 때 두 가지 문을 내준다. 로그인 상태면 게이트 없이 바로.
  function ypEnter(){
    if(YP.joined){ ypOpen(); return; }
    var me=null; try{ me=window.sdyUser&&window.sdyUser(); }catch(e){}
    if(me){ ypJoin(); ypOpen(); return; }
    var g=$('ypGate');
    if(!g){ ypJoin(); ypOpen(); return; }
    g.style.display='flex';
  }
  window.__ypEnter=ypEnter;
  window.__ypClose=ypClose;    // 해돌이 앱 실행·단축키·테스트용 — 채팅창을 프로그래밍 방식으로 닫는다
  window.__ypToggle=function(){ if(YP.open) ypClose(); else ypEnter(); };
  (function(){
    var g=$('ypGate'); if(!g) return;
    var hide=function(){ g.style.display='none'; };
    $('ypgLogin').onclick=function(){
      hide();
      // 로그인 모달을 열고, 성공하면 자동으로 엽스코드 입장
      window.__sdyAfterLogin=function(){ window.__sdyAfterLogin=null; ypJoin(); ypOpen(); };
      if(window.sdyAuthOpen) window.sdyAuthOpen();
      else { ypJoin(); ypOpen(); }
    };
    $('ypgGuest').onclick=function(){ hide(); ypJoin(); ypOpen(); };
    g.addEventListener('click',function(e){ if(e.target===g) hide(); });
  })();

  // 로그인/로그아웃 → 닉네임 전환 (회원은 고정닉, 비회원은 저장한 이름)
  window.addEventListener('sdy-auth',function(){
    if(YP.joined) ypJoin();
  });
})();
