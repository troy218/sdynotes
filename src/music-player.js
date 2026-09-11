(function(){
if(window.__sdyMusicInit) return; window.__sdyMusicInit=true;
const P={list:[],idx:-1,mode:'bar',pos:null,repeat:0,lq:'',lpage:0,collapsed:true,
         plMode:false, artMode:false, queue:null, sort:'recent', plays:{}, played:[]};
// 12.6: 음악 탐색 상태를 기억해 가사·가수·전체곡을 오가도 보던 위치를 유지합니다.
try{ Object.assign(P,JSON.parse(sessionStorage.getItem('sdy_music_view')||'{}')); P.plays=JSON.parse(localStorage.getItem('sdy_music_plays')||'{}')||{}; }catch(e){}
function saveMusicView(){ try{ sessionStorage.setItem('sdy_music_view',JSON.stringify({lpage:P.lpage,plPage:P.plPage||0,artPage:P.artPage||0,plMode:!!P.plMode,artMode:!!P.artMode,sort:P.sort||'recent'})); }catch(e){} }
function logMusicPlay(id){
  if(!id)return;
  P.plays[id]=(P.plays[id]||0)+1;
  const tr=P.list&&P.list.find(x=>x.id===id);
  if(tr) tr.play_count=(+tr.play_count||0)+1;
  try{localStorage.setItem('sdy_music_plays',JSON.stringify(P.plays));}catch(e){}
  // 추천 순서도 기기마다 이어지도록 서버에 재생 횟수를 남긴다.
  try{fetch('/api/music/play',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id}),keepalive:true}).catch(()=>{});}catch(e){}
}
const A=new Audio(); A.preload='metadata';
const $=id=>document.getElementById(id);
const pl=$('musicPlayer');
function _isPro(){ try{ return typeof sdyTheme==='function'&&sdyTheme()==='pro'; }catch(e){ return false; } }
function _setMpChip(show){
  var c=document.getElementById('mpReopen'); if(!c) return;
  if(_isPro()){ c.style.display='none'; return; }
  c.style.display=show?'flex':'none';
}
try{ window._mpSetCollapsed=function(v){ P.collapsed=!!v; _setMpChip(P.collapsed); if(!P.collapsed) try{ pl.style.display='flex'; }catch(e){} }; }catch(e){}
try{ window._isProMp=function(){ return _isPro(); }; }catch(e){}
try{ new MutationObserver(function(){ _setMpChip(P.collapsed); }).observe(document.documentElement,{attributes:true,attributeFilter:['class']}); }catch(e){}
try{ P.repeat=+(localStorage.getItem('mp_repeat')||0); P.vol=+(localStorage.getItem('mp_vol')??100)/100; }
catch(e){ P.vol=1; }
if(isNaN(P.vol))P.vol=1; A.volume=P.vol;
// 기본 커버(LP 디스크)는 앱 강조색·테마를 따라가도록 동적으로 만든다
let DEF_COVER='';
function readAccent(){ try{ const a=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); return a||'#4f6ef7'; }catch(e){ return '#4f6ef7'; } }
function hexA(c){ return /^#[0-9a-f]{6}$/i.test(c)? c : '#4f6ef7'; }
function makeDefCover(){
  const a=hexA(readAccent());
  const b='#8e5cf7';                       // 보조색(고정)
  DEF_COVER='data:image/svg+xml;utf8,'+encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><defs>'+
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+a+'"/>'+
    '<stop offset="1" stop-color="'+b+'"/></linearGradient></defs>'+
    '<circle cx="48" cy="48" r="44" fill="url(#g)"/>'+
    '<circle cx="48" cy="48" r="14" fill="#fff" opacity=".25"/>'+
    '<text x="48" y="62" font-size="40" text-anchor="middle" fill="#fff">\u266a</text></svg>');
}
makeDefCover();
function fmt(t){ if(!isFinite(t))return'0:00'; t=Math.max(0,Math.round(t));
  return Math.floor(t/60)+':'+String(t%60).padStart(2,'0'); }
function esc2(s){ return (s||'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
function isAdm(){
  try{
    return !!((typeof adminToken!=='undefined'&&adminToken)||
              sessionStorage.getItem('sdy_admin')||
              localStorage.getItem('sdy_admin')||
              localStorage.getItem('sdy_admin_tok'));
  }catch(e){ return false; }
}
function admTok(){
  try{
    return (typeof adminToken!=='undefined'&&adminToken)||
           sessionStorage.getItem('sdy_admin')||
           localStorage.getItem('sdy_admin')||
           localStorage.getItem('sdy_admin_tok')||'';
  }catch(e){ return (typeof adminToken!=='undefined'&&adminToken)||''; }
}
function curList(){ return P.queue||P.list; }
function cur(){
  const L=curList();
  if(!L||!L.length) return null;
  const activeId=(A&&A._trackId)||P.currentId;
  if(activeId){
    const idx=L.findIndex(t=>t.id===activeId);
    if(idx>=0){
      if(P.idx!==idx) P.idx=idx;
      return L[idx];
    }
    const inAll=(P.list||[]).find(t=>t.id===activeId);
    if(inAll) return inAll;
  }
  if(P.idx>=0&&P.idx<L.length) return L[P.idx];
  P.idx=Math.max(0,Math.min(L.length-1,P.idx||0));
  return L[P.idx]||null;
}
// ═══════════ 14.14 · 멜론식 대기열 엔진 ═══════════
//  · 대기열(재생목록)이 유일한 진실이다. 곡을 고르면 '화면에 보인 그 순서'가
//    통째로 대기열이 된다. (예전엔 원본 목록 인덱스로 재생해 정렬과 '다음 곡'이 어긋났다)
//  · 섞기는 대기열을 뒤섞지 않는다. 순서는 그대로 두고 '아직 안 들은 곡 중 무작위'로 고른다.
//    → 껐다 켜도 원래 순서가 그대로 남아 있고, 한 바퀴 안에 같은 곡이 두 번 나오지 않는다.
//  · 이전 곡은 실제로 들은 기록(history)을 거슬러 간다.
//  · 반복: 0 끄기(끝나면 정지) · 1 전체 반복 · 2 한 곡 반복
function _qTracks(){ return curList()||[]; }
function _qHistory(){ if(!Array.isArray(P.played)) P.played=[]; return P.played; }
function _qMarkPlayed(id){
  if(!id) return;
  const h=_qHistory();
  const k=h.indexOf(id);
  if(k>=0) h.splice(k,1);
  h.push(id);
  if(h.length>500) h.splice(0,h.length-500);
}
function _qResetCycle(keepId){
  P.played=keepId?[keepId]:[];
}
// 대기열 전체를 '보인 순서 그대로' 갈아 끼운다.
function setQueue(tracks,plName){
  const q=(tracks||[]).filter(Boolean);
  P.queue=q.length?q.slice():null;
  P.plName=plName||'';
  _qResetCycle();
  return P.queue;
}
try{ window.sdySetQueue=setQueue; }catch(e){}
// 섞기 켜짐: 이번 바퀴에 아직 안 들은 곡 중 하나. 다 들었으면 -1.
function _qShuffleNext(){
  const L=_qTracks(); if(!L.length) return -1;
  const h=new Set(_qHistory());
  const curId=cur()&&cur().id;
  const pool=[];
  L.forEach((t,i)=>{ if(t&&t.id!==curId&&!h.has(t.id)) pool.push(i); });
  if(!pool.length) return -1;
  return pool[(Math.random()*pool.length)|0];
}
// auto=true 는 곡이 끝나서 저절로 넘어가는 경우 (반복 끄기면 정지)
function _qNextIndex(auto){
  const L=_qTracks(); if(!L.length) return -1;
  if(P._forceNext){                       // '다음에 재생'으로 끼워 넣은 곡 우선
    const k=L.findIndex(t=>t.id===P._forceNext);
    P._forceNext='';
    if(k>=0) return k;
  }
  if(P.shuffle){
    const n=_qShuffleNext();
    if(n>=0) return n;
    // 한 바퀴 다 돌았다
    if(P.repeat===1||!auto){ _qResetCycle(); return _qShuffleNext(); }
    return -1;
  }
  const next=P.idx+1;
  if(next<L.length) return next;
  if(P.repeat===1||!auto) return 0;     // 전체 반복이거나 사용자가 직접 누른 경우
  return -1;                            // 반복 꺼짐 + 자동 → 정지
}
function _qPrevIndex(){
  const L=_qTracks(); if(!L.length) return -1;
  const curId=cur()&&cur().id;
  if(P.shuffle){
    const h=_qHistory();
    for(let i=h.length-1;i>=0;i--){
      if(h[i]===curId) continue;
      const k=L.findIndex(t=>t.id===h[i]);
      if(k>=0) return k;
    }
    return P.idx>=0?P.idx:0;
  }
  const prev=P.idx-1;
  if(prev>=0) return prev;
  return (P.repeat===1)?L.length-1:0;
}
// 멜론처럼: 3초 넘게 들었으면 '이전'은 곡 처음으로
function playPrev(){
  if(A&&A.src&&isFinite(A.currentTime)&&A.currentTime>3){
    try{ A.currentTime=0; }catch(e){}
    if(A.paused) A.play().catch(()=>{});
    return;
  }
  const i=_qPrevIndex();
  if(i>=0){
    if(P.shuffle){ const h=_qHistory(); const curId=cur()&&cur().id;
      // 되돌아간 곡은 기록에서 빼 '다음'을 눌렀을 때 다시 앞으로 갈 수 있게
      const k=h.lastIndexOf(curId); if(k>=0) h.splice(k,1); }
    playIdx(i);
  }
}
function playNext(auto){
  const L=_qTracks();
  const i=_qNextIndex(!!auto);
  if(i<0||!L.length){
    // 대기열 끝 — 멈추고 처음 곡을 물고 대기 (멜론과 동일)
    try{ A.pause(); A.currentTime=0; }catch(e){}
    _qResetCycle();
    $('mpPP').innerHTML='<i class="ri-play-fill"></i>';
    const bPP=$('mpBPP'); if(bPP) bPP.innerHTML='<i class="ri-play-fill"></i>';
    paintProg(0); saveMusicState(true);
    return;
  }
  playIdx(i);
}
// 대기열·재생 기록에서 사라진 곡을 지운다 (삭제·목록 갱신 뒤)
// 화면에 보인 목록(tracks)을 그대로 대기열로 삼고 그중 id 곡을 튼다.
function playFrom(tracks,id,plName){
  const q=(tracks||[]).filter(Boolean);
  if(!q.length){
    const i=(P.list||[]).findIndex(t=>t.id===id);
    if(i>=0){ setQueue(P.list,''); playIdx(i); }
    return;
  }
  let at=q.findIndex(t=>t.id===id);
  if(at<0) at=0;
  setQueue(q,plName||'');
  playIdx(at);
}
try{ window.sdyPlayFrom=playFrom; }catch(e){}
// 새로 올린 곡은 '그 곡'이 바로 틀려야 한다. 예전엔 전체 목록(P.list) 인덱스로
// playIdx 를 불렀는데, 대기열(P.queue)이 있으면 그 인덱스가 대기열의 엉뚱한
// 자리(보통 첫 곡)를 가리켜 대기열 첫 노래가 재생됐다. 이제 대기열이 있으면
// 현재 곡 바로 뒤에 끼워 넣고 정확히 그 자리를 튼다.
function playNewTrack(id){
  const t=(P.list||[]).find(x=>x.id===id);
  if(!t) return false;
  if(P.queue){
    if(!P.queue.some(x=>x.id===id)){
      const at=Math.max(0,Math.min((P.idx|0)+1,P.queue.length));
      P.queue.splice(at,0,t);
    }
    const k=P.queue.findIndex(x=>x.id===id);
    if(k>=0){ playIdx(k); return true; }
  }
  const i=(P.list||[]).findIndex(x=>x.id===id);
  if(i>=0){ playIdx(i); return true; }
  return false;
}
function pruneQueue(){
  const alive=new Set((P.list||[]).map(t=>t.id));
  if(P.queue){
    P.queue=P.queue.filter(t=>alive.has(t.id));
    if(!P.queue.length){ P.queue=null; P.plName=''; }
  }
  P.played=_qHistory().filter(id=>alive.has(id));
  const L=_qTracks();
  const curId=(A&&A._trackId)||P.currentId;
  const k=curId?L.findIndex(t=>t.id===curId):-1;
  if(k>=0) P.idx=k;
  else P.idx=Math.max(0,Math.min(L.length-1,P.idx));
}
let _musicStateSaveT=null, _musicStateLast=0;
function _musicStateObject(){
  const t=cur();
  return {queue:P.queue?P.queue.map(x=>x.id):null, idx:P.idx,
    current:t&&t.id||P.currentId||'', plName:P.plName||'', position:A&&isFinite(A.currentTime)?A.currentTime:0,
    played:(P.played||[]).slice(-500),
    repeat:P.repeat||0, shuffle:!!P.shuffle, rate:P.rate||1, vol:Math.round((P.vol||0)*100)};
}
// 14.14 · 부팅 중(복원 전)에는 저장하지 않는다.
//   setVol()·updateRep() 같은 초기화가 '빈 상태'를 먼저 써 버려서 지난 곡 기록이
//   지워지고, 결국 목록 첫 곡부터 시작하던 버그를 막는다.
let _mpRestored=false;
function saveMusicState(push){
  if(!_mpRestored) return;
  try{ localStorage.setItem('sdy_music_state',JSON.stringify(_musicStateObject())); }catch(e){}
  clearTimeout(_musicStateSaveT);
  _musicStateSaveT=setTimeout(()=>{ try{ if(push&&window.pushSettings) window.pushSettings(); }catch(e){} },push?80:700);
}
// 14.14 · 재생 '환경'만 반영한다 (다른 기기/탭에서 온 설정 동기화용).
//   대기열·현재곡·재생 위치는 절대 건드리지 않는다.
function _applyMusicPrefs(d){
  if(!d||typeof d!=='object') return;
  if(d.repeat!==undefined) P.repeat=Math.max(0,Math.min(2,+d.repeat||0));
  if(d.shuffle!==undefined) P.shuffle=!!d.shuffle;
  if(d.rate!==undefined) P.rate=+d.rate||1;
  if(d.vol!==undefined) P.vol=Math.max(0,Math.min(1,(+d.vol||0)/100));
  try{ updateRep(); updateShuf(); applyRate(); setVol(P.vol); }catch(e){}
}
function _applyMusicStateObject(d,opts){
  if(!d||typeof d!=='object') return;
  const force=!!(opts&&opts.force);
  // 14.14 · 이 기기가 이미 곡을 물고 있으면(재생 중이든 일시정지든) 남의·옛 상태로
  //   갈아끼우지 않는다. → 탭 전환·설정 동기화 때 듣던 곡이 대기열 첫 곡으로
  //   튀던 버그 방지. 곡·대기열은 기기마다 자기 것을 지킨다.
  const busy=!force&&!!((A&&A.src)||P.currentId||P.queue);
  _applyMusicPrefs(d);
  if(!busy){
    if(Array.isArray(d.queue)){
      const q=d.queue.map(id=>P.list.find(t=>t.id===id)).filter(Boolean);
      P.queue=q.length?q:null;
    }
    if(d.plName!==undefined) P.plName=d.plName||'';
    if(Array.isArray(d.played)) P.played=d.played.filter(x=>typeof x==='string');
    if(d.idx!==undefined&&P.queue) P.idx=Math.max(0,Math.min(P.queue.length-1,+d.idx||0));
    if(d.current){
      P.currentId=d.current;
      if(A) A._trackId=d.current;
      const L=curList();
      const k=(L||[]).findIndex(t=>t.id===d.current);
      if(k>=0) P.idx=k;
    }
  }
  try{ localStorage.setItem('sdy_music_state',JSON.stringify(_musicStateObject())); }catch(e){}
  try{
    const t=cur();
    if(t&&!A.src){
      A.src=t.stream_url||('/api/music/file/'+t.id);
      A._trackId=t.id; P.currentId=t.id;
      const pos=Math.max(0,+d.position||0);
      if(pos>0) A.addEventListener('loadedmetadata',()=>{try{A.currentTime=Math.min(pos,A.duration||pos);}catch(e){}},{once:true});
    }
    renderTitle();
  }catch(e){}
}
// 부팅 복원 — 저장된 '이전에 듣던 곡'을 그대로 되살린다 (대기열 첫 곡이 아니라)
function restoreMusicState(){
  let d=null;
  try{ d=JSON.parse(localStorage.getItem('sdy_music_state')||'null'); }catch(e){}
  _mpRestored=true;                      // 이 시점부터 저장을 연다
  try{ if(d) _applyMusicStateObject(d,{force:true}); }catch(e){}
  try{
    const t=cur();
    if(t&&!A.src){
      A.src=t.stream_url||('/api/music/file/'+t.id);
      A._trackId=t.id; P.currentId=t.id;
    }
  }catch(e){}
}
try{
  window.sdyApplyMusicPrefs=_applyMusicPrefs;
  window.sdyApplyMusicState=_applyMusicStateObject;
  window.sdyApplyMusicPositions=(d)=>{
    try{
      if(d&&d.music) P.pos=d.music;
      if(d&&d.musicBig&&mpbEl){ mpbEl.style.left=(+d.musicBig.x||0)+'px'; mpbEl.style.top=(+d.musicBig.y||72)+'px'; }
    }catch(e){}
  };
}catch(e){}
async function loadList(opts){
  // 10.3 · no-store: 배포 직후 서버 기동 전 요청이 실패/캐시돼 옛 목록만
  //   보이던 문제(곡을 하나 올려야 전부 뜨던 버그) 방지
  // 11.4 · 실패하면 그 사실을 기억해 두고(P.listErr) 화면에 '다시 불러오기'를 띄운다
  P.loading=true; if(!(opts&&opts.quiet)) renderLoadState();
  try{
    const url=(opts&&opts.rescan)?'/api/music/rescan':'/api/music/list';
    const r=await fetch(url,{method:(opts&&opts.rescan)?'POST':'GET',cache:'no-store'});
    if(!r.ok) throw new Error('http '+r.status);
    const d=await r.json();
    const prev=new Map((P.list||[]).map(t=>[t.id,t]));
    P.list=(d.tracks||[]).map(t=>{                 // 받아 둔 가사 본문은 그대로 물려준다
      const o=prev.get(t.id);
      if(o&&o.lyrics!==undefined&&o.has_lyrics===t.has_lyrics&&o.has_sync===t.has_sync){
        t.lyrics=o.lyrics; t.lyrics_plain=o.lyrics_plain;
        t.lyrics_src=o.lyrics_src; t.lyrics_tries=o.lyrics_tries;
      }
      return t;
    });
    P.listDirty=false; P.listErr=0;
    // 새 노래 추가 시 최신 곡이 재생되도록 기본값 설정
    if(P.list&&P.list.length&&!P.currentId){ P.currentId=P.list[P.list.length-1].id; P.idx=P.list.length-1; }
    P.tagging=!!d.tagging;                       // 서버 백필(재태깅) 진행 중?
    P.lastLoad=Date.now();
    if(opts&&opts.rescan) P.restored=d.added||0;
    // 13.3 · 목록을 다시 받아도 실제 재생 중인 곡 ID(A._trackId / P.currentId)를 대기열/전체곡 모두에서 정확히 보존
    let targetTrackId=(A&&A._trackId)||P.currentId||'';
    if(!targetTrackId&&A&&A.src){
      const m=A.src.match(/\/api\/music\/file\/([0-9a-zA-Z_\-]+)/);
      if(m) targetTrackId=m[1];
      else {
        const found=P.list.find(t=>(t.stream_url&&t.stream_url===A.src)||(t.id&&A.src.includes(t.id)));
        if(found) targetTrackId=found.id;
      }
    }
    if(!targetTrackId){
      const curBefore=cur();
      if(curBefore&&curBefore.id) targetTrackId=curBefore.id;
    }
    if(targetTrackId){
      P.currentId=targetTrackId;
      if(A) A._trackId=targetTrackId;
    }
    if(P.queue){
      // 곡 객체는 새로 받은 것으로 바꿔 끼우되 대기열 '순서'는 지킨다
      P.queue=P.queue.map(t=>P.list.find(x=>x.id===t.id)).filter(Boolean);
      if(!P.queue.length){ P.queue=null; P.plName=''; }
      else if(targetTrackId){
        const k=P.queue.findIndex(t=>t.id===targetTrackId);
        if(k>=0) P.idx=k;
      }
    } else if(targetTrackId){
      const k=P.list.findIndex(t=>t.id===targetTrackId);
      if(k>=0) P.idx=k;
    }
    // 사라진 곡은 섞기 기록에서도 정리
    try{
      const alive=new Set((P.list||[]).map(t=>t.id));
      P.played=(Array.isArray(P.played)?P.played:[]).filter(id=>alive.has(id));
    }catch(e){}
  }catch(e){ P.listDirty=true; P.listErr=(P.listErr||0)+1; }
  P.loading=false;
  renderTitle(); renderLoadState();
  // 11.4 · 목록이 비어 있으면(서버가 200 인데 0곡) 한 번은 스스로 복구해 본다
  if(!P.listDirty && !P.list.length && !(opts&&opts.rescan) && !P._healed){
    P._healed=true;
    try{ await loadList({rescan:true,quiet:true}); }catch(e){}
    if(P.list.length){ try{ toast('노래 목록을 되살렸어요 · '+P.list.length+'곡',2600); }catch(e){} }
  }
  return P.list.length; }
// 11.4 · 목록/오류 상태를 화면에 반영 (버튼 회전 + 빈 화면 안내)
function renderLoadState(){
  const spin=P.loading;
  [$('mpBRefresh')].forEach(b=>{
    if(!b) return;
    b.classList.toggle('spin',!!spin);
    b.disabled=!!spin;
  });
  try{ if($('mpBig').classList.contains('open')) renderBigList(); }catch(e){}
  try{ if($('musicListPop').style.display==='flex') renderListPop(); }catch(e){}
}
// 11.4 · '새로고침' — 목록을 다시 받고, 비어 있으면 서버에서 파일까지 다시 훑는다
let _refreshing=false;
async function refreshMusic(deep){
  if(_refreshing) return;
  _refreshing=true;
  P._healed=false;
  try{
    await loadList();
    if(deep||!P.list.length){
      const before=P.list.length;
      await loadList({rescan:true});
      const add=P.list.length-before;
      if(add>0) toast('노래 '+add+'곡을 되살렸어요 (전체 '+P.list.length+'곡)',3000);
      else if(P.list.length) toast('목록을 새로 받았어요 · '+P.list.length+'곡',2000);
      else toast('서버에서 노래를 찾지 못했어요 · 잠시 뒤 다시 시도해 주세요',3200);
    }else if(deep!==false){
      toast('목록을 새로 받았어요 · '+P.list.length+'곡',1800);
    }
  }catch(e){ toast('목록을 받지 못했어요 · 잠시 뒤 다시 시도해 주세요',2600); }
  finally{ _refreshing=false; renderLoadState(); }
}
try{ window.sdyRefreshMusic=refreshMusic; }catch(e){}
function coverURL(t){ if(!t||!t.cover) return DEF_COVER;
  if(t.cover_url) return t.cover_url;
  return '/api/music/cover/'+t.id+'?v='+(t.cover_v||1)+'_'+(P.coverV||'1')+'&s=512'; }
function setCover(t){ const im=$('mpCover');
  im.onerror=()=>{ im.onerror=null; im.src=DEF_COVER; };
  im.src=coverURL(t); }
function renderTitle(){ const t=cur();
  // 10.1 · 가수를 알면 '가수 · 제목' 으로 보여준다 (스포티파이 풍)
  $('mpTitle').textContent=t?((t.artist&&String(t.artist).trim())?t.artist+' · '+t.title:t.title):'재생 중인 곡 없음';
  $('mpTitle').title=t?((t.artist?t.artist+' — ':'')+t.title):'';
  setCover(t);
  $('mpDel').style.display=(isAdm()&&t)?'flex':'none';
  pl.classList.toggle('nocur',!t);
  // 재생목록으로 듣는 중이면 이름 + 몇 번째인지 보여 준다
  const b=$('mpBadge');
  if(b){
    if(P.queue&&P.plName){
      b.textContent=P.plName+' '+(P.idx+1)+'/'+P.queue.length;
      b.style.display='';
    }else b.style.display='none';
  }
  // 잠금화면·이어폰 버튼에서도 조작되게 (OS 미디어 컨트롤)
  try{
    if('mediaSession' in navigator && t){
      navigator.mediaSession.metadata=new MediaMetadata({
        title:t.title||'', artist:t.artist||P.plName||'SDYnotes', album:t.album||'SDYnotes'});
      navigator.mediaSession.setActionHandler('play',()=>A.play());
      navigator.mediaSession.setActionHandler('pause',()=>smoothPause());
      navigator.mediaSession.setActionHandler('previoustrack',()=>playPrev());
      navigator.mediaSession.setActionHandler('nexttrack',()=>playNext(false));
    }
  }catch(e){}
  try{ renderBig(); }catch(e){}
}
function updateRep(){
  const set=(b)=>{ if(!b)return; b.classList.toggle('on',P.repeat>0);
    b.innerHTML=P.repeat===2?'<i class="ri-repeat-one-fill"></i>':'<i class="ri-repeat-line"></i>';
    b.title=P.repeat===0?'반복 꺼짐':P.repeat===1?'전체 반복':'한 곡 반복'; };
  set($('mpRep')); set($('mpBRep')); }
let _playTok=0;
function playIdx(i){ const L=curList(); if(!L.length)return;
  P.idx=(i+L.length)%L.length; const t=L[P.idx]; if(!t) return;
  A._trackId=t.id; P.currentId=t.id;
  _qMarkPlayed(t.id);                 // 14.14 · 섞기 한 바퀴/이전 곡 기록
  logMusicPlay(t.id); saveMusicView();
  const tok=++_playTok;
  A.src=t.stream_url||('/api/music/file/'+t.id); saveMusicState(true); renderTitle();
  // 14.11 · '재생'은 재생만 한다. 곡 정보/가사 재탐색은 재생에 연쇄하지
  // 않는다 — 사용자가 뭔가를 하면 한 번에 한 기능만 실행되도록:
  //   · 자동 정보 채우기: 서버 백필(유휴 시)·업로드 파이프라인
  //   · 정보 다시 찾기: '자동 찾기' 버튼  · 가사: '가사 찾기/싱크 가사' 버튼
  //   · 표지: '표지만 찾기' 버튼  · 소리 인식: '소리 인식' 버튼
  // (예전엔 재생만 해도 자동 태그 + 가사 검색이 몰려 서버가 바빴다)
  if(!$('mpBig').classList.contains('open')){ pl.style.display='flex'; }
  P.collapsed=false;
  A.play().catch(e=>{
    // 10.5 · 빨리 넘기다가 src가 바뀐 건 무시 (형식 미지원 오탐 방지)
    if(tok!==_playTok) return;
    // 12.0 · 자동재생 차단(NotAllowedError)과 중복 재생(AbortError)은 오류가 아니다.
    //   곡 추가 직후의 자동 재생은 브라우저가 막을 수 있는데, 이걸
    //   '재생할 수 없어요' 로 잘못 알리던 문제 수정. (곡은 정상 추가·선택돼 있고,
    //   아래 바의 ▶ 를 한 번만 누르면 재생된다)
    if(e && (e.name==='NotAllowedError' || e.name==='AbortError')) return;
    if(A.error&&A.src&&A.src.indexOf(t.id)<0) return;
    if(window.toast)toast('재생할 수 없어요 — 파일을 확인해 주세요',2600);
  }); }
let _fadeT=null;
function smoothPause(){
  // 10.5 · 바로 끊지 않고 0.22초에 걸쳐 볼륨을 줄였다가 멈춘 뒤 원복
  if(A.paused) return;
  if(_fadeT){ clearInterval(_fadeT); A.volume=P.vol; }
  const v0=A.volume, t0=performance.now();
  _fadeT=setInterval(()=>{
    const k=Math.min(1,(performance.now()-t0)/220);
    A.volume=v0*(1-k);
    if(k>=1){ clearInterval(_fadeT); _fadeT=null; A.pause(); A.volume=P.vol; }
  },40);
}
// 16.x · 첫 진입 직후 재생을 누르면 아직 노래 목록을 서버에서 받는 중일 수 있다.
//   예전엔 P.list 가 비어 있어 '곡을 선택해야만' 재생되던 버그가 있었다.
//   목록을 기다렸다가 첫 곡부터 재생한다.
// 18.4 · '소스 없음' 판정은 A.src 를 직접 보지 않는다. src='' 로 지우면 브라우저가
//   페이지 URL 로 해석해 truthy 가 되어, 크로스바 X → 플로팅 버튼 → 재생을 눌러도
//   그 페이지 URL 을 재생하려다 소리가 나지 않았다.
function _audioSrcLive(){
  const s=String(A&&A.src||'');
  if(!s) return '';
  try{
    if(s===location.href) return '';
    const o=(location&&location.origin)||'';
    if(o&&(s===o+'/'||s===o)) return '';
  }catch(e){}
  return s;
}
let _ppWait=null;
function pp(){
  if(!_audioSrcLive()){
    const t=cur();
    if(t){
      const L=curList();
      const k=(L||[]).findIndex(x=>x.id===t.id);
      playIdx(k>=0?k:(P.idx>=0&&P.idx<L.length?P.idx:0));
      return;
    }
    // 14.14 · 아무것도 안 물려 있으면 대기열(없으면 라이브러리)의 현재 자리부터
    const L=curList();
    if(L&&L.length){ playIdx(P.idx>=0&&P.idx<L.length?P.idx:0); return; }
    // 사용자 제스처 컨텍스트에서 오디오를 언락해 둔다
    try{ A.play().then(()=>A.pause()).catch(()=>{}); }catch(e){}
    // 목록이 아직 비어 있으면(부팅 중 또는 이전 로드 실패) 로딩이 끝나기를 기다렸다가 자동으로 튼다
    if(_ppWait) return;
    // 이전 로드가 실패했으면(P.listDirty) 다시 시도
    if(P.listDirty && !P.loading){
      P.listDirty=false;
      loadList({quiet:true}).then(()=>{
        const L2=curList();
        if(L2&&L2.length){ playIdx(P.idx>=0&&P.idx<L2.length?P.idx:0); }
      }).catch(()=>{});
    }
    toast('노래 목록을 불러오는 중이에요…',1200);
    let tries=0;
    _ppWait=setInterval(()=>{
      tries++;
      const L2=curList();
      if(L2&&L2.length){
        clearInterval(_ppWait); _ppWait=null;
        playIdx(P.idx>=0&&P.idx<L2.length?P.idx:0);
      } else if(tries>60){
        clearInterval(_ppWait); _ppWait=null;
        toast('노래 목록을 아직 받지 못했어요 · 잠시 뒤 다시 눌러 주세요',2200);
      }
    },250);
    return;
  }
  if(A.paused)A.play(); else smoothPause(); }
A.addEventListener('play',()=>{ $('mpPP').innerHTML='<i class="ri-pause-fill"></i>';
  const bPP=$('mpBPP'); if(bPP) bPP.innerHTML='<i class="ri-pause-fill"></i>';
  $('mpCover').classList.add('spin');
  const bW=$('mpBCwrap'); if(bW) bW.classList.remove('playing');
  void (bW&&bW.offsetWidth); if(bW) bW.classList.add('playing');   // LP 연출 리스타트
  // 10.5 · 큰 플레이어가 열려 있으면 아래 바가 같이 튀어나오지 않게
  if(P.mode==='float' && !P.collapsed
     && !$('mpBig').classList.contains('open')){
    pl.style.display='flex';
    _setMpChip(false);
  } });
A.addEventListener('pause',()=>{ saveMusicState(true); $('mpPP').innerHTML='<i class="ri-play-fill"></i>';
  const bPP=$('mpBPP'); if(bPP) bPP.innerHTML='<i class="ri-play-fill"></i>';
  $('mpCover').classList.remove('spin');
  const bW=$('mpBCwrap'); if(bW) bW.classList.remove('playing'); });
A.addEventListener('ended',()=>{
  if(A.duration && (A.duration - A.currentTime > 1.5)){ return; }
  if(!_qTracks().length) return;
  if(P.repeat===2){ A.currentTime=0; A.play(); return; }        // 한 곡 반복
  playNext(true);                                               // 14.14 · 멜론식 대기열 진행
});
// ── 진행 표시 (드래그 중에는 손가락 위치를 우선) ──
let _seek=null, _seekOwner='', _showLeft=false;   // _seekOwner: 드래그 주인('bar'|'big') 구분
function paintProg(cur){
  const d=A.duration||0;
  const t=(cur==null?A.currentTime:cur);
  const pct=d?Math.max(0,Math.min(100,t/d*100)):0;
  $('mpFill').style.width=pct+'%';
  $('mpKnob').style.left=pct+'%';
  $('mpCur').textContent=fmt(t);
  $('mpDur').textContent=(_showLeft&&d)?('-'+fmt(Math.max(0,d-t))):fmt(d);
  try{
    const bf=$('mpBFill'), bk=$('mpBKnob'), bc=$('mpBCur'), bd=$('mpBDur');
    if(bf){ bf.style.width=pct+'%'; bk.style.left=pct+'%'; bc.textContent=fmt(t);
      // 큰 플레이어의 시간은 평소 숨어 있고, 재생 위치를 잡을 때만 '현재 | 전체'로 뜬다.
      bd.textContent=fmt(d); }
  }catch(e){}
  if(P.mode==='float')
    pl.style.background='conic-gradient(var(--accent) '+pct+'%, var(--bg2) 0)';
}
A.addEventListener('timeupdate',()=>{
  if(_seek==null) paintProg();
  if(Date.now()-_musicStateLast>5000){ _musicStateLast=Date.now(); saveMusicState(false); }
});
A.addEventListener('loadedmetadata',()=>{ paintProg(); });
A.addEventListener('progress',()=>{                       // 받아둔 구간 표시
  try{
    if(!A.duration||!A.buffered.length) return;
    $('mpBuf').style.width=(A.buffered.end(A.buffered.length-1)/A.duration*100)+'%';
  }catch(e){}
});
// 남은 시간 ↔ 전체 길이 전환
$('mpDur').onclick=e=>{ e.stopPropagation(); _showLeft=!_showLeft; paintProg(); };
$('mpPP').onclick=pp;
$('mpPrev').onclick=()=>playPrev();
$('mpNext').onclick=()=>playNext(false);
// 좁은 폰에서 더보기 안에 나타나는 같은 기능 버튼
$('mpPrev2').onclick=()=>{ playPrev(); $('mpXtra').classList.remove('show'); };
$('mpNext2').onclick=()=>{ playNext(false); $('mpXtra').classList.remove('show'); };
$('mpRep').onclick=e=>{
  if(e) e.stopPropagation();
  P.repeat=(P.repeat+1)%3;
  try{localStorage.setItem('mp_repeat',P.repeat);}catch(e){}
  updateRep(); saveMusicState(true);
  toast(P.repeat===0?'반복 꺼짐':P.repeat===1?'전체 반복':'한 곡 반복',1300);
};

// ── 섞기 ──────────────────────────────────────────────
// 원래 순서를 따로 보관했다가 끄면 그대로 되돌린다.
function updateShuf(){
  const s=$('mpShuf'), bs=$('mpBShuf');
  if(s){
    s.classList.toggle('on',!!P.shuffle);
    s.title=P.shuffle?'섞기 켜짐 (무작위 순서)':'섞기';
    s.innerHTML=P.shuffle?'<i class="ri-shuffle-fill"></i>':'<i class="ri-shuffle-line"></i>';
  }
  if(bs){
    bs.classList.toggle('on',!!P.shuffle);
    bs.title=P.shuffle?'섞기 켜짐 (무작위 순서)':'섞기';
    bs.innerHTML=P.shuffle?'<i class="ri-shuffle-fill"></i>':'<i class="ri-shuffle-line"></i>';
  }
}
$('mpShuf').onclick=e=>{
  if(e) e.stopPropagation();
  P.shuffle=!P.shuffle;
  try{localStorage.setItem('mp_shuffle',P.shuffle?'1':'0');}catch(e){}
  // 14.14 · 멜론과 같은 방식: 대기열 순서는 그대로 두고 '다음 곡을 고르는 방법'만 바꾼다.
  //   (예전엔 배열을 통째로 섞어 화면 순서가 뒤집히고, 끄면 원래 순서를 잃었다)
  const now=cur();
  _qResetCycle(now&&now.id);
  if(now){ const k=curList().findIndex(t=>t.id===now.id); if(k>=0) P.idx=k; }
  updateShuf(); renderListPop();
  try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(err){}
  saveMusicState(true);
  toast(P.shuffle?'무작위로 재생합니다':'순서대로 재생합니다',1400);
};
try{ P.shuffle=localStorage.getItem('mp_shuffle')==='1'; }catch(e){}
updateShuf();

// ── 재생 속도 (강의 녹음·팟캐스트용) ───────────────────
const RATES=[1,1.25,1.5,1.75,2,0.75];
function applyRate(){
  A.playbackRate=P.rate||1;
  $('mpRate').textContent=(P.rate||1)+'×';
  $('mpRate').classList.toggle('on',(P.rate||1)!==1);
  const br=$('mpBRate'); if(br){ br.textContent=(P.rate||1)+'×';
    br.classList.toggle('on',(P.rate||1)!==1); }
}
try{ P.rate=parseFloat(localStorage.getItem('mp_rate')||'1')||1; }catch(e){ P.rate=1; }
applyRate();
$('mpRate').onclick=e=>{
  if(e) e.stopPropagation();
  const i=RATES.indexOf(P.rate);
  P.rate=RATES[(i+1)%RATES.length];
  try{localStorage.setItem('mp_rate',P.rate);}catch(e){}
  applyRate(); saveMusicState(true);
};
// 볼륨: 슬라이스 + 플레이어 위 마우스 스크롤
function setVol(v){ P.vol=Math.max(0,Math.min(1,v)); A.volume=P.vol;
  $('mpVolSlider').value=Math.round(P.vol*100);
  const bv=$('mpBVol'); if(bv) bv.value=Math.round(P.vol*100);
  const bi=$('mpBVolIco'); if(bi) bi.className=P.vol===0?'ri-volume-mute-line':
    P.vol<0.5?'ri-volume-down-line':'ri-volume-up-line';
  $('mpVol').innerHTML=P.vol===0?'<i class="ri-volume-mute-line"></i>':
    P.vol<0.5?'<i class="ri-volume-down-line"></i>':'<i class="ri-volume-up-line"></i>';
  try{localStorage.setItem('mp_vol',Math.round(P.vol*100));}catch(e){} saveMusicState(true); }
setVol(P.vol);
$('mpVolSlider').oninput=e=>setVol(e.target.value/100);
$('mpVol').onclick=e=>{ e.stopPropagation(); $('mpVolPop').classList.toggle('show'); };
// 부가 버튼(반복·볼륨·올리기) 펼치기 — 평소엔 숨겨 바를 단순하게
$('mpMore').onclick=e=>{ e.stopPropagation();
  const x=$('mpXtra'); const on=x.classList.toggle('show');
  $('mpMore').classList.toggle('on',on);
  if(!on) $('mpVolPop').classList.remove('show'); };
document.addEventListener('click',e=>{
  const inXtra=(e.composedPath&&e.composedPath().some(el=>el===$('mpXtra')||el===$('mpMore')))||
               (e.target&&(e.target.closest&&(e.target.closest('#mpXtra')||e.target.closest('#mpMore'))));
  if(!inXtra){
    $('mpXtra').classList.remove('show');
    $('mpMore').classList.remove('on');
  }
});
pl.addEventListener('wheel',e=>{ e.preventDefault();
  setVol(P.vol+(e.deltaY<0?0.05:-0.05)); },{passive:false});

// ── 키보드 단축키 ─────────────────────────────────────
// 글을 쓰는 중이거나 입력칸에 있을 땐 절대 가로채지 않는다.
document.addEventListener('keydown',e=>{
  // 10.1 · 플레이어가 꺼져 있으면 무시 (큰 플레이어가 열려 있을 때는 동작)
  const bigEl=$('mpBig');
  if(pl.style.display==='none'&&!(bigEl&&bigEl.classList.contains('open'))) return;
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  const el=document.activeElement;
  if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable)) return;
  if(document.querySelector('#pagesStage .tb.edit')) return;
  // 10.1 · 편집기에서 사진·수식 같은 '요소를 선택한 채' 방향키로 옮길 때는
  //   음악 단축키가 절대 가로채지 않는다 (사진 이동이 노래 탐색·트랙 이동으로
  //   새어 들어가던 문제). 요소 선택이 없을 때만 음악 단축키로 동작한다.
  if(document.querySelector('#pagesStage .sel, #pagesStage .msel')) return;
  const k=e.key;
  if(k===' '){ e.preventDefault(); pp(); }
  else if(k==='ArrowRight'&&e.shiftKey){ e.preventDefault(); playNext(false); }
  else if(k==='ArrowLeft' &&e.shiftKey){ e.preventDefault(); playPrev(); }
  else if(k==='ArrowRight'){ if(A.duration){ e.preventDefault(); A.currentTime=Math.min(A.duration,A.currentTime+5); } }
  else if(k==='ArrowLeft' ){ if(A.duration){ e.preventDefault(); A.currentTime=Math.max(0,A.currentTime-5); } }
  else if(k==='ArrowUp'  ){ e.preventDefault(); setVol(P.vol+0.05); }
  else if(k==='ArrowDown'){ e.preventDefault(); setVol(P.vol-0.05); }
});
// 관리자 삭제
$('mpDel').onclick=async()=>{ const t=cur(); if(!t)return;
  if(!isAdm()){
    if(typeof openAdminModal==='function') openAdminModal();
    toast('노래 삭제는 관리자만 가능합니다',2400);
    return;
  }
  if(!confirm('"'+t.title+'" 곡을 삭제할까요?'))return;
  try{ const r=await fetch('/api/music/delete',{method:'POST',
    headers:{'Content-Type':'application/json',
             'Authorization':'Bearer '+admTok()},
    body:JSON.stringify({id:t.id})});
    const d=await r.json();
    if(!r.ok||!d.ok){ if(window.toast)toast(d.error||'삭제 실패',2200); return; }
    // 18.4 · src='' 는 페이지 URL 로 해석되므로 속성 자체를 지운다(진짜 '빈 src').
    //   _trackId/currentId 도 비워 다음 재생이 남은 목록의 현재 자리부터 시작하게.
    A.pause(); A.removeAttribute('src'); try{ A.load(); }catch(e){}
    A._trackId=''; P.currentId='';
    await loadList(); P.idx=-1; renderTitle(); renderListPop();
    if(window.toast)toast('삭제됨',1400);
  }catch(e){ if(window.toast)toast('삭제 실패',2000); } };
// ── 진행바: 눌러서 이동 + 드래그로 구간 찾기 (마우스·터치 공용) ──
(function(){
  const bar=$('mpProg');
  const at=cx=>{
    const r=bar.getBoundingClientRect();
    return Math.max(0,Math.min(1,(cx-r.left)/r.width))*(A.duration||0);
  };
  const tip=(t)=>{
    const r=bar.getBoundingClientRect();
    const pct=(A.duration? t/A.duration:0);
    const el=$('mpSeekTip');
    el.textContent=fmt(t);
    el.style.left=Math.max(18,Math.min(r.width-18,pct*r.width))+'px';
  };
  const down=e=>{
    if(!A.duration) return;
    e.preventDefault();
    const cx=e.touches?e.touches[0].clientX:e.clientX;
    _seek=at(cx); _seekOwner='bar'; bar.classList.add('seeking');
    paintProg(_seek); tip(_seek);
    bar.setPointerCapture&&e.pointerId!=null&&bar.setPointerCapture(e.pointerId);
  };
  const move=e=>{
    if(_seek==null||_seekOwner!=='bar') return;
    e.preventDefault();
    const cx=e.touches?e.touches[0].clientX:e.clientX;
    _seek=at(cx); paintProg(_seek); tip(_seek);
  };
  const up=()=>{
    if(_seek==null||_seekOwner!=='bar') return;
    A.currentTime=_seek; _seek=null; _seekOwner='';
    bar.classList.remove('seeking'); paintProg();
  };
  bar.addEventListener('pointerdown',down);
  addEventListener('pointermove',move);
  addEventListener('pointerup',up);
  addEventListener('pointercancel',up);
  bar.addEventListener('touchstart',down,{passive:false});
  addEventListener('touchmove',move,{passive:false});
  addEventListener('touchend',up);
})();
$('mpUp').onclick=e=>{ e.stopPropagation(); openAddPop($('mpUp')); };
// 12.5 · 여러 곡을 병렬(3개씩)로 올린다.
let _mpUpBusy=false;
async function _upOne(f){
  const fd=new FormData(); fd.append('file',f);
  const auH=window.sdyAuthHeaders?window.sdyAuthHeaders():{};
  try{
    const r=await fetch('/api/music/upload',{method:'POST',body:fd,headers:auH});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok) return {ok:false,name:f.name};
    return {ok:true,id:d.id,name:f.name};
  }catch(err){ return {ok:false,name:f.name}; }
}
$('musicFile').onchange=async e=>{
  const files=[...(e.target.files||[])]; e.target.value='';
  if(!files.length) return;
  if(_mpUpBusy){ if(window.toast)toast('이미 올리는 중이에요',1800); return; }
  _mpUpBusy=true;
  const tooBig=files.filter(f=>f.size>50*1024*1024);
  const list=files.filter(f=>f.size<=50*1024*1024);
  if(tooBig.length&&window.toast)
    toast(`${tooBig.length}곡은 50MB를 넘어 건너뜁니다`,2600);
  if(!list.length){ _mpUpBusy=false; return; }
  if(window.toast) toast(`업로드 중… 0/${list.length}`,list.length>1?30000:1500);
  let done=0, fail=0, firstId=null;
  try{
    // 병렬 3개씩
    const PAR=3;
    for(let i=0;i<list.length;i+=PAR){
      const chunk=list.slice(i,i+PAR);
      const res=await Promise.all(chunk.map(_upOne));
      for(const r of res){
        if(r.ok){ done++; if(!firstId) firstId=r.id; } else fail++;
      }
      if(window.toast) toast(`업로드 중… ${done+fail}/${list.length}`,3000);
    }
    await loadList();
    startTagPolling();
    if(firstId){
      // 방금 올린 그 곡을 바로 튼다 (대기열이 있어도 첫 곡이 아니라 이 곡)
      if(playNewTrack(firstId)) gotoTrackPage(firstId);
    }
    if(window.toast){
      if(done&&!fail)      toast(`${done}곡 업로드 완료 🎵`,2200);
      else if(done&&fail)  toast(`${done}곡 완료 · ${fail}곡 실패`,3000);
      else                 toast('업로드 실패',2400);
    }
  } finally { _mpUpBusy=false; }
};
// 18.4 · X 는 '바를 숨기고 일시정지'만 한다. A.src='' 로 지우면 브라우저가
//   src 를 페이지 URL 로 해석해(truthy) 다시 열고 재생(pp)을 눌러도
//   노래가 나오지 않았다. src 를 남기면 재생 시 바로 이어서 튼다.
$('mpX').onclick=()=>{ A.pause();
  pl.style.display='none'; _setMpChip(true); P.collapsed=true; };
// ===== 목록 + 검색 + 페이지 =====
const PER=10;
// ══════════════════════════════════════════════════════════
//  11.5 · 곡 찾기 정확도 개선
//   웹 검색(Apple Music·Deezer·MusicBrainz)으로 채워 둔 제목·가수·앨범을
//   최대한 활용한다. 띄어쓰기·문장부호를 무시하고, 한글 초성('아이유'→'ㅇㅇㅇ')
//   과 원래 올린 파일 이름까지 함께 보며, 잘 맞는 순서로 정렬해 준다.
// ══════════════════════════════════════════════════════════
function _sNorm(s){
  s=String(s||'');
  try{ s=s.normalize('NFKC'); }catch(e){}
  return s.toLowerCase().replace(/[\s\-_,.'"“”‘’`()\[\]{}!?~·・:;|/\\]/g,'');
}
const _CHO='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function _sCho(s){
  let o='';
  for(const ch of String(s||'')){
    const c=ch.charCodeAt(0);
    if(c>=0xAC00&&c<=0xD7A3) o+=_CHO[Math.floor((c-0xAC00)/588)];
    else o+=ch.toLowerCase();
  }
  return o.replace(/\s+/g,'');
}
function _sSub(hay,needle){            // 글자가 순서대로 들어 있는가
  let i=0;
  for(const ch of needle){ i=hay.indexOf(ch,i); if(i<0) return false; i++; }
  return true;
}
function trackScore(t,qn,qc){
  if(!qn) return 1;
  const ti=_sNorm(t.title), ar=_sNorm(t.artist), al=_sNorm(t.album),
        og=_sNorm(t.orig_title);
  if(ti===qn) return 100;
  if(ar===qn) return 92;
  if(ti.indexOf(qn)===0) return 84;
  if(ar.indexOf(qn)===0) return 74;
  if(ti.indexOf(qn)>0) return 66;
  if(ar.indexOf(qn)>0) return 54;
  if(al.indexOf(qn)>=0) return 42;
  if(og.indexOf(qn)>=0) return 38;     // 예전(올릴 때) 이름으로도 찾힌다
  if(qc.length>=2){
    if(_sCho(t.title).indexOf(qc)>=0) return 34;
    if(_sCho(t.artist).indexOf(qc)>=0) return 26;
  }
  if(qn.length>=3&&_sSub(ti,qn)) return 18;
  if(String(t.year||'')===qn) return 14;
  if(_sNorm(t.genre).indexOf(qn)>=0&&qn.length>=2) return 12;
  return 0;
}
function searchTracks(list,q){
  const raw=String(q||'').trim();
  if(!raw) return list;
  const toks=raw.split(/\s+/).filter(Boolean);
  const wn=_sNorm(raw), wc=_sCho(raw);
  const out=[];
  (list||[]).forEach((t,i)=>{
    const whole=trackScore(t,wn,wc);
    let sum=0, all=true;
    for(const tk of toks){
      const sc=trackScore(t,_sNorm(tk),_sCho(tk));
      if(!sc){ all=false; break; }
      sum+=sc;
    }
    let score=0;
    if(whole) score=whole+12;                       // 통째로 맞으면 가장 우대
    if(all&&toks.length>1) score=Math.max(score,Math.round(sum/toks.length)+6);
    else if(all&&toks.length===1) score=Math.max(score,sum);
    if(score) out.push([score,-i,t]);
  });
  out.sort((a,b)=>(b[0]-a[0])||(b[1]-a[1]));
  return out.map(x=>x[2]);
}
try{ window.sdySearchTracks=searchTracks; }catch(e){}
function filtered(){
  const a=searchTracks(P.list,P.lq).slice(), mode=P.sort||'recent';
  const txt=x=>String(x||'').localeCompare(String(y||''),'ko');
  if(mode==='title') a.sort((x,y)=>String(x.title||'').localeCompare(String(y.title||''),'ko'));
  else if(mode==='artist') a.sort((x,y)=>String(x.artist||'미분류').localeCompare(String(y.artist||'미분류'),'ko')||String(x.title||'').localeCompare(String(y.title||''),'ko'));
  else if(mode==='played') a.sort((x,y)=>(P.plays[y.id]||0)-(P.plays[x.id]||0)||String(y.created_at||'').localeCompare(String(x.created_at||'')));
  else a.sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')));
  return a;
}
function musicDiscover(list){
  if(P.lq||P.plMode||P.artMode||P.lpage) return '';
  const most=list.slice().sort((a,b)=>_playCount(b)-_playCount(a)).filter(t=>_playCount(t)>0).slice(0,6);
  const seed=cur();
  const rec=seed?_recoTracks(list,'artist',6,new Set([seed.id])):list.filter(t=>_playCount(t)>0).slice(0,6);
  const cards=(arr,empty)=>arr.length?arr.map(t=>`<button class="mp-rec-card" data-rec="${t.id}"><img src="${coverURL(t)}" onerror="this.src=DEF_COVER"><span>${esc2(t.title)}</span><em>${esc2(t.artist||'가수 미상')}</em></button>`).join(''):empty;
  return `<section class="mp-discover"><div class="mp-dis-head"><b>지금의 음악</b><span>내 라이브러리</span></div><div class="mp-rec-title">자주 들은 곡</div><div class="mp-rec-row">${cards(most,'<span class="mp-rec-empty">재생한 곡이 쌓이면 여기서 다시 만나요.</span>')}</div>${rec.length?`<div class="mp-rec-title">‘${esc2(seed?seed.artist||seed.title:'')}’ 와(과) 어울려요</div><div class="mp-rec-row">${cards(rec,'')}</div>`:''}</section>`;
}
function renderListPop(){
  $('mpTabAll').classList.toggle('on',!P.plMode&&!P.artMode);
  $('mpTabPL').classList.toggle('on',P.plMode);
  const tabArt=$('mpTabArt'); if(tabArt) tabArt.classList.toggle('on',!!P.artMode);
  if(P.plMode){ renderPL(); return; }
  if(P.artMode){ renderArtGroups(); return; }
  $('mpSearch').style.display='';
  const list=filtered();
  const pages=Math.max(1,Math.ceil(list.length/PER));
  P.lpage=Math.max(0,Math.min(P.lpage,pages-1));
  const slice=list.slice(P.lpage*PER,P.lpage*PER+PER);
  const jump=$('mpPgJump'); if(jump){ jump.max=pages; jump.value=P.lpage+1; }
  _paintList($('mpLBody'),musicDiscover(list)+slice.map(t=>{
    const i=P.list.indexOf(t);
    return `<div class="mp-li" data-i="${i}" data-tid="${t.id}" draggable="true">`+
      `<span><i class="nowic ri-volume-up-fill mp-cur" style="display:none"></i>${esc2(t.title)}</span>`+
      (t.artist?`<em>${esc2(t.artist)}</em>`:'')+
      (t.uploader?`<span class="mp-upmark" title="${esc2(t.uploader)} 님이 올린 곡"><i class="ri-user-3-fill"></i>${esc2(t.uploader)}</span>`:'')+
      `<i class="ri-price-tag-3-line" data-tag="${t.id}" title="태그·표지 편집" style="color:var(--text3);font-size:13px;flex:none;padding:2px;cursor:pointer;font-style:normal;"></i>`+
      `<i class="pl-add" data-pladd="${t.id}" title="재생목록에 담기">＋</i>`+
      (isAdm()?`<i class="mp-del ri-delete-bin-line" data-del="${t.id}" title="삭제"></i>`:'')+
      `</div>`;
  }).join('')||_emptyBox('l'));
  $('mpPgInfo').textContent=list.length+'곡'+(pages>1?` · ${P.lpage+1}/${pages}`:'');
  $('mpPgPrev').style.visibility=pages>1?'':'hidden';
  $('mpPgNext').style.visibility=pages>1?'':'hidden';
}
// 11.3 · 내용이 그대로면 다시 그리지 않는다 (스크롤·드래그가 끊기지 않게)
function _paintList(box,html){
  if(!box) return;
  if(box._html!==html){
    const keep=box.scrollTop;
    box._html=html; box.innerHTML=html; box.scrollTop=keep;
  }
  const t=cur(), id=t&&t.id;
  box.querySelectorAll('.mp-li[data-tid]').forEach(el=>{
    const on=(el.dataset.tid===id);
    if(el.classList.contains('on')!==on) el.classList.toggle('on',on);
    const ic=el.querySelector('.nowic');
    if(ic){ const want=on?'':'none'; if(ic.style.display!==want) ic.style.display=want; }
  });
}
// ===== 재생목록 =====
function getPL(){
  try{ return window.sdyGetPlaylists?window.sdyGetPlaylists():JSON.parse(localStorage.getItem('sdy_playlists')||'[]'); }
  catch(e){ return []; }
}
function savePL(a){
  try{ if(window.sdySavePlaylists) window.sdySavePlaylists(a);
       else localStorage.setItem('sdy_playlists',JSON.stringify(a)); }catch(e){}
  try{ if(window.pushSettingsNow) window.pushSettingsNow(); }catch(e){} }
let PL_OPEN={};
function plAddTrack(plId, trackId){
  const arr=getPL(); const p=arr.find(x=>x.id===plId); if(!p)return;
  const t=P.list.find(x=>x.id===trackId); if(!t)return;
  p.tracks=p.tracks||[];
  if(p.tracks.includes(trackId)){ p.tracks=p.tracks.filter(x=>x!==trackId); toast('재생목록에서 뺐습니다',1300); }
  else{ p.tracks.push(trackId); toast('"'+p.name+'" 에 담았습니다 ♫',1400); }
  savePL(arr); renderListPop();
}
function renderPL(){
  $('mpSearch').style.display='none';
  const pls=getPL();
  if(!pls.length){
    $('mpLBody')._html=null; $('mpLBody').innerHTML='<div class="mp-plempty">재생목록이 없습니다<em>＋ 로 만들어 보세요</em></div>';
    $('mpPgInfo').textContent='';
    $('mpPgPrev').style.visibility='hidden'; $('mpPgNext').style.visibility='hidden';
    return;
  }
  // 10.3 · 재생목록도 8개씩 페이지로
  const PER_P=8;
  const pages=Math.max(1,Math.ceil(pls.length/PER_P));
  P.plPage=Math.max(0,Math.min(P.plPage||0,pages-1));
  $('mpPgInfo').textContent=pls.length+'개'+(pages>1?` · ${P.plPage+1}/${pages}`:'');
  $('mpPgPrev').style.visibility=pages>1?'':'hidden';
  $('mpPgNext').style.visibility=pages>1?'':'hidden';
  let html='';
  pls.slice(P.plPage*PER_P,P.plPage*PER_P+PER_P).forEach(p=>{
    const n=(p.tracks||[]).length;
    const open=!!PL_OPEN[p.id];
    html+=`<div class="mp-pl${open?' open':''}" data-drop="${p.id}">
      <i class="pl-exp ri-arrow-right-s-line" data-plexp="${p.id}"></i>
      <b data-plexp="${p.id}">${esc2(p.name)}</b><em>${n}</em>
      <i class="pl-play ri-play-fill" data-plplay="${p.id}" title="재생"></i>
      <i class="ri-more-2-fill" data-plmenu="${p.id}" title="이름 변경 · 삭제"></i></div>`;
    if(open){
      const tracks=(p.tracks||[]).map(tid=>P.list.find(t=>t.id===tid)).filter(Boolean);
      if(!tracks.length) html+='<div class="mp-plsub empty">곡이 없습니다 · 전체 곡에서 ＋ 로 담아보세요</div>';
      else tracks.forEach((t,k)=>{
        html+=`<div class="mp-plsub" data-plgo="${p.id}" data-tid="${t.id}">`+
              `<span>${esc2(t.title)}</span>`+
              `<i class="pl-rm ri-close-line" data-plrm="${p.id}" data-tid="${t.id}" title="빼기"></i></div>`;
      });
    }
  });
  $('mpLBody')._html=null; $('mpLBody').innerHTML=html;
}

// ── 목록 클릭은 '위임' 으로 한 번만 묶는다 ──────────────────
// 예전엔 그릴 때마다 각 줄에 onclick 을 새로 달았는데, 클릭하면
// renderPL() 이 그 줄을 지워 버려서 → 바깥클릭 감지기가 '팝업 밖을
// 눌렀다' 고 오판하고 창을 닫아 버렸다. (재생목록 펼치기가 안 되던 원인)
(function(){
  const body=$('mpLBody');
  if(!body) return;
  body.addEventListener('click',e=>{
    e.stopPropagation();
    const hit=sel=>e.target.closest('['+sel+']');
    let el;
    if((el=hit('data-plexp'))){
      const id=el.dataset.plexp; PL_OPEN[id]=!PL_OPEN[id]; renderPL(); return;
    }
    if((el=hit('data-plplay'))){ playPlaylist(el.dataset.plplay); return; }
    if((el=hit('data-plmenu'))){
      const id=el.dataset.plmenu, arr=getPL(), p=arr.find(x=>x.id===id); if(!p) return;
      plMenu(el,p,arr); return;
    }
    if((el=hit('data-plrm'))){
      const arr=getPL(), p=arr.find(x=>x.id===el.dataset.plrm); if(!p) return;
      p.tracks=(p.tracks||[]).filter(x=>x!==el.dataset.tid);
      savePL(arr); renderPL(); return;
    }
    if((el=hit('data-plgo'))){        // 재생목록 안의 곡 → 그 목록으로 재생
      playPlaylist(el.dataset.plgo, el.dataset.tid); return;
    }
    if((el=hit('data-pladd'))){ addToPlaylist(el.dataset.pladd); return; }
    if((el=hit('data-tag'))){ openTagEditor(el.dataset.tag); return; }
    if((el=hit('data-artexp'))){ P.artOpen[el.dataset.artexp]=!P.artOpen[el.dataset.artexp]; renderArtGroups(); return; }
    if((el=hit('data-artplay'))){ playArtist(el.dataset.artplay); return; }
    if((el=hit('data-artgo'))){
      // 14.14 · 화면에 보인 그 가수의 곡 순서가 그대로 대기열이 된다
      const id=el.dataset.artgo;
      const t0=(P.list||[]).find(t=>t.id===id);
      const aName=(t0&&t0.artist&&String(t0.artist).trim())||'미분류';
      const g=bucketArtists(filtered()).find(x=>x.name===aName);
      playFrom(g?g.tracks:[t0],id,aName);
      renderListPop(); return; }
    if((el=hit('data-del'))){ delTrack(el.dataset.del); return; }
    // 18.3 · 작은 목록에서 곡을 눌러도 '대기열에 담고 바로 재생'이다
    //   (가수별 재생은 예전처럼 그 가수 회차를 대기열로 세운다 — data-artgo)
    if((el=hit('data-rec'))){ queueAdd(el.dataset.rec); return; }
    if((el=hit('data-i'))){ queueAdd(el.dataset.tid||((P.list[+el.dataset.i]||{}).id)); renderListPop(); return; }
  });
  // 드래그로 담기
  body.addEventListener('dragstart',e=>{
    const el=e.target.closest('.mp-li[data-i]'); if(!el) return;
    const t=P.list[+el.dataset.i]; if(!t) return;
    e.dataTransfer.setData('text/sdy-track',t.id);
    e.dataTransfer.effectAllowed='copy'; el.classList.add('dragsrc');
  });
  body.addEventListener('dragend',e=>{
    const el=e.target.closest('.mp-li'); if(el) el.classList.remove('dragsrc');
  });
  body.addEventListener('dragover',e=>{
    const el=e.target.closest('[data-drop]'); if(!el) return;
    e.preventDefault(); el.classList.add('drop');
  });
  body.addEventListener('dragleave',e=>{
    const el=e.target.closest('[data-drop]'); if(el) el.classList.remove('drop');
  });
  body.addEventListener('drop',e=>{
    const el=e.target.closest('[data-drop]'); if(!el) return;
    e.preventDefault(); el.classList.remove('drop');
    const tid=e.dataTransfer.getData('text/sdy-track');
    if(tid) plAddTrack(el.dataset.drop,tid);
  });
})();

// 재생목록 이름변경/삭제 작은 메뉴
function plMenu(anchor,p,arr){
  const old=document.getElementById('plMiniMenu'); if(old) old.remove();
  const m=document.createElement('div');
  m.id='plMiniMenu'; m.className='pl-mini';
  m.innerHTML='<button data-a="ren">이름 변경</button><button data-a="del" class="d">삭제</button>';
  document.body.appendChild(m);
  const r=anchor.getBoundingClientRect();
  m.style.left=Math.max(8,Math.min(innerWidth-140,r.right-130))+'px';
  m.style.top=(r.bottom+4)+'px';
  m.addEventListener('click',ev=>{
    ev.stopPropagation();
    const a=ev.target.dataset.a; if(!a) return;
    if(a==='ren'){
      const nm=prompt('재생목록 이름',p.name);
      if(nm&&nm.trim()){ p.name=nm.trim(); savePL(arr); renderPL(); }
    }else{
      if(confirm(`"${p.name}" 을(를) 삭제할까요? (곡은 안 지워집니다)`)){
        delete PL_OPEN[p.id];
        savePL(arr.filter(x=>x.id!==p.id)); renderPL();
      }
    }
    m.remove();
  });
  setTimeout(()=>{
    const off=ev=>{ if(!ev.target.closest('#plMiniMenu')){ m.remove(); document.removeEventListener('click',off,true); } };
    document.addEventListener('click',off,true);
  },0);
}

async function delTrack(id){
  const t=P.list.find(x=>x.id===id);
  if(!isAdm()){
    if(typeof openAdminModal==='function') openAdminModal();
    toast('노래 삭제는 관리자만 가능합니다',2400);
    return;
  }
  if(!confirm('"'+(t&&t.title)+'" 삭제?')) return;
  try{
    const r=await fetch('/api/music/delete',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+admTok()},
      body:JSON.stringify({id})});
    const d=await r.json();
    if(r.ok&&d.ok){ await loadList();
      pruneQueue();                        // 14.14 · 대기열·재생 기록에서도 뺀다
      renderListPop();
      try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(err){}
      if(P.idx>=0&&curList()[P.idx]===undefined){P.idx=-1;}
      renderTitle(); saveMusicState(true);
      if(window.toast)toast('삭제됨',1400); }
    else if(window.toast)toast(d.error||'삭제 실패',2000);
  }catch(err){}
}
function playPlaylist(id,startTid){
  const p=getPL().find(x=>x.id===id); if(!p||!(p.tracks||[]).length){ toast('이 재생목록은 비어 있습니다',1800); return; }
  // 담은 순서를 그대로 지킨다 (예전엔 전체 목록 순서로 섞였다)
  const q=(p.tracks||[]).map(tid=>P.list.find(t=>t.id===tid)).filter(Boolean);
  if(!q.length){ toast('재생목록의 곡을 찾을 수 없습니다',2000); return; }
  const at=startTid? Math.max(0,q.findIndex(t=>t.id===startTid)) : 0;
  setQueue(q,p.name); P.plMode=false; renderListPop(); playIdx(at);
  if(window.toast)toast('▶ '+p.name,1400);
}
function addToPlaylist(trackId){
  const t=P.list.find(x=>x.id===trackId); if(!t)return;
  const pls=getPL();
  let pop=document.getElementById('plPickPop');
  if(!pop){ pop=document.createElement('div'); pop.id='plPickPop'; document.body.appendChild(pop); }
  let html='<div class="plpick-item new" data-pl="__new__"><i class="ri-play-list-add-line"></i> 새 재생목록 만들기</div>';
  pls.forEach(p=>{
    const has=(p.tracks||[]).includes(trackId);
    html+=`<div class="plpick-item${has?' on':''}" data-pl="${p.id}"><i class="ri-play-list-line"></i><b>${esc2(p.name)}</b><em>${(p.tracks||[]).length}곡</em>${has?' ✓':''}</div>`;
  });
  if(!pls.length) html+='<div class="plpick-item"><b style="color:var(--text3)">재생목록이 없습니다</b></div>';
  pop.innerHTML=html;
  pop.querySelectorAll('[data-pl]').forEach(el=>el.onclick=e=>{
    e.stopPropagation();
    const id=el.dataset.pl;
    pop.style.display='none';
    if(id==='__new__'){
      const nm=prompt('새 재생목록 이름','재생목록 '+(getPL().length+1)); if(!nm||!nm.trim())return;
      const arr=getPL(); arr.push({id:'pl_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), name:nm.trim(), tracks:[trackId]});
      savePL(arr); renderListPop(); toast('"'+nm.trim()+'" 생성 후 담았습니다',1600);
      return;
    }
    plAddTrack(id, trackId);
  });
  pop.style.display='block';
  const r=document.querySelector(`[data-pladd="${trackId}"]`);
  const br=r?r.getBoundingClientRect():null;
  let left=br?br.right-8:innerWidth-290;
  let top=br?br.bottom+4:innerHeight-330;
  left=Math.max(8,Math.min(left,innerWidth-pop.offsetWidth-8));
  top=Math.max(8,Math.min(top,innerHeight-pop.offsetHeight-8));
  pop.style.left=left+'px'; pop.style.top=top+'px';
}
document.addEventListener('click',e=>{
  const pop=document.getElementById('plPickPop');
  if(pop&&!e.target.closest('#plPickPop')&&!e.target.closest('[data-pladd]')) pop.style.display='none';
});
$('mpTabAll').onclick=()=>{ P.plMode=false; P.artMode=false; P.queue=null; saveMusicView(); renderListPop(); };
$('mpTabPL').onclick=()=>{ P.plMode=true; P.artMode=false; saveMusicView(); renderListPop(); };
const _tabArt=$('mpTabArt');
if(_tabArt) _tabArt.onclick=()=>{ P.plMode=false; P.artMode=true; saveMusicView(); renderListPop(); };
$('mpAddPL').onclick=()=>{
  const nm=prompt('새 재생목록 이름','재생목록 '+(getPL().length+1)); if(!nm||!nm.trim())return;
  const arr=getPL(); arr.push({id:'pl_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), name:nm.trim(), tracks:[]});
  savePL(arr); P.plMode=true; renderListPop(); toast('재생목록 "'+nm.trim()+'" 생성됨',1600);
};
$('mpList').onclick=e=>{ e.stopPropagation();
  closeBig();                                  // 큰 플레이어와 겹치지 않게
  const pop=$('musicListPop');
  if(pop.style.display==='flex'){ pop.style.display='none'; return; }
  $('mpSearch').value=P.lq||''; saveMusicView();
  renderListPop(); pop.style.display='flex';
  loadList().then(()=>renderListPop());        // 10.3 · 열 때마다 새 목록
};
$('mpSearch').oninput=e=>{ P.lq=e.target.value; P.lpage=0; saveMusicView(); renderListPop(); };
// ── 14.14 · 정렬: 큼직한 select 대신 작은 아이콘 버튼 하나로 (크로스바·확장 공통) ──
//   누를 때마다 최근 추가 → 제목순 → 가수순 → 많이 들은 순 으로 돌아간다.
const SORT_MODES=[
  ['recent','최근 추가','ri-time-line'],
  ['title','제목순','ri-sort-alphabet-asc'],
  ['artist','가수순','ri-user-3-line'],
  ['played','많이 들은 순','ri-fire-line']
];
function _sortDef(){ return SORT_MODES.find(m=>m[0]===(P.sort||'recent'))||SORT_MODES[0]; }
function updateSortBtn(){
  const [key,label,icon]=_sortDef();
  [$('mpSort'),$('mpBSort')].forEach(b=>{
    if(!b) return;
    b.innerHTML='<i class="'+icon+'"></i>';
    b.title='정렬 · '+label+' (눌러서 바꾸기)';
    b.setAttribute('aria-label','정렬 '+label);
    b.dataset.sort=key;
    b.classList.toggle('on',key!=='recent');
  });
}
function cycleSort(){
  const i=SORT_MODES.findIndex(m=>m[0]===(P.sort||'recent'));
  const [key,label]=SORT_MODES[(i+1)%SORT_MODES.length];
  P.sort=key; P.lpage=0; P.bigPage=0;
  saveMusicView(); updateSortBtn();
  try{ renderListPop(); }catch(e){}
  try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(e){}
  toast('정렬 · '+label,1200);
}
$('mpSort').onclick=e=>{ e.stopPropagation(); cycleSort(); };
updateSortBtn();
$('mpPgJump').onkeydown=e=>{ if(e.key==='Enter'){ const n=+e.target.value; const list=filtered(), pages=Math.max(1,Math.ceil(list.length/PER)); P.lpage=Math.max(0,Math.min(pages-1,(n||1)-1)); saveMusicView(); renderListPop(); e.target.blur(); } };
function pageShift(d){                 // 10.3 · 탭별 페이지 변수 한번에 처리
  if(P.plMode) P.plPage=(P.plPage||0)+d;
  else if(P.artMode) P.artPage=(P.artPage||0)+d;
  else P.lpage+=d;
  saveMusicView();
  renderListPop();
}
$('mpPgPrev').onclick=()=>pageShift(-1);
$('mpPgNext').onclick=()=>pageShift(1);
document.addEventListener('click',e=>{
  if(!e.target.closest('#musicListPop')&&!e.target.closest('#mpList')){
    $('musicListPop').style.display='none'; $('mpVolPop').classList.remove('show'); }
});
// ===== 모드 전환(노트 안 → 플로팅) & 드래그 =====
function setMode(m){ if(P.mode===m)return; P.mode=m;
  pl.classList.toggle('mp-float',m==='float');
  pl.classList.toggle('mp-bar',m==='bar');
  if(m==='float'){
    pl.style.right=(innerWidth<=640?'8px':'10px');
    pl.style.top=((P.pos&&P.pos.y)||64)+'px';
    const playing=!!(A.src&&!A.paused);
    // 접힌 상태는 화면을 오가도 유지 — PRO 에서는 칩 대신 사이드바 음악 항목을 쓴다
    if(playing && !P.collapsed){ pl.style.display='flex'; _setMpChip(false); }
    else { pl.style.display='none'; _setMpChip(true); }
  }
  else{ pl.style.top=''; pl.style.right=''; pl.style.background='';
    if(P.collapsed){ pl.style.display='none'; _setMpChip(true); }
    else { pl.style.display='flex'; _setMpChip(false); } } }
const ev0=$('editorView');
if(ev0) new MutationObserver(()=>{
  setMode(ev0.classList.contains('open')?'float':'bar');
  renderTitle();
}).observe(ev0,{attributes:true,attributeFilter:['class']});
let drag=null;
pl.addEventListener('pointerdown',e=>{
  if(P.mode!=='float')return;
  if(e.target.closest('button')||e.target.closest('.mp-prog'))return;
  const r=pl.getBoundingClientRect();
  drag={sx:e.clientX,sy:e.clientY,top:window.sdyUiCss(r.top)};
  try{ pl.setPointerCapture(e.pointerId); }catch(err){}
});
pl.addEventListener('pointermove',e=>{
  if(!drag)return;
  // 화면 px 델타를 zoom 된 fixed UI px로 바꾼다. 그대로 더하면 90% 화면에서
  // 플레이어가 포인터보다 느리게 따라오며 매번 위치가 조금씩 어긋났다.
  // 아래·오른쪽 제한도 같은 단위여야 한다. 예전엔 innerHeight(화면 px)에서
  // 바 높이를 빼지 않고 80으로 대충 잡았기 때문에 90% 배율에서 화면 아래쪽
  // 10% 가량에 바를 놓을 수 없었다. 공용 경계 함수(실측 기반)에 맡긴다.
  const c=window.sdyClampFloatingRect(pl,
      window.sdyUiCss(pl.getBoundingClientRect().left),
      drag.top+window.sdyUiCss(e.clientY-drag.sy));
  const y=Math.max(56,c.y);          // 56: 상단 헤더에 겹치지 않게 지켜야 하는 최소치
  pl.style.top=y+'px';
  P.pos={y};
});
pl.addEventListener('pointerup',()=>{ drag=null;
  try{ localStorage.setItem('mp_pos',JSON.stringify(P.pos)); }catch(e){} try{if(window.pushSettings)window.pushSettings();}catch(e){} });
try{ const p=JSON.parse(localStorage.getItem('mp_pos')||'null'); if(p)P.pos=p; }catch(e){}
// 12.0 · 칩은 <body> 첫머리에서 이미 만들어져 로딩 중에도 바로 보인다. 여기선 재활용만.
const chip=document.getElementById('mpReopen');
chip.title='음악 켜기';
chip.onclick=()=>{
  pl.style.display='flex'; _setMpChip(false); P.collapsed=false;
  const t=cur();
  if(t&&!A.src){
    A.src=t.stream_url||('/api/music/file/'+t.id);
    A._trackId=t.id; P.currentId=t.id;
  }
  renderTitle();
};
pl.style.display='none';
// 로딩 중 사용자가 칩을 눌러 바를 열었으면 그 상태를 지킨다 — PRO 에서는 칩을 숨긴다
if(window.__mpChipOpened){ _setMpChip(false); pl.style.display='flex'; }
else _setMpChip(true);
updateRep();
// 6.12: 처음 진입 시 음악 컨트롤바는 '오른쪽 아래 접힌 칩'으로만 표시
// (곡이 있어도 펼치지 않는다 — 칩을 눌러야 바가 열린다)
// 12.0 · 칩은 로딩을 기다리지 않는다. 목록은 뒤에서 차면 된다.
loadList().then(()=>{
  restoreMusicState();
  if(P.mode!=='bar') P.mode='bar';  // 노트 안이어도 진입 시엔 접힌 상태 유지
  // 처음 접속(저장된 대기열 없음) — 랜덤 20곡을 대기열에 미리 꽂아 둔다.
  //   듣던 곡이 있으면 그 곡을 맨 앞에 두고 나머지 19곡을 무작위로 채운다.
  if(!P.queue&&(P.list||[]).length){
    try{
      const cur0=cur();
      const pool=P.list.filter(t=>!cur0||t.id!==cur0.id);
      for(let i=pool.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; const tmp=pool[i]; pool[i]=pool[j]; pool[j]=tmp; }
      const mix=(cur0?[cur0]:[]).concat(pool).slice(0,20);
      if(mix.length){
        setQueue(mix,'랜덤 믹스');
        P.idx=0; P.currentId=mix[0].id;
        if(A) A._trackId=mix[0].id;
        saveMusicState(false);
      }
    }catch(e){}
  }
  const t=cur();
  if(t&&!A.src){
    A.src=t.stream_url||('/api/music/file/'+t.id);
    A._trackId=t.id; P.currentId=t.id;
  }
  renderTitle();
  startTagPolling();              // 서버가 아직 태그 정리 중이면 이어서 반영
});
// 10.3 · 목록 받기 실패(배포 직후·서버 과부하 등)면 스스로 재시도
// 11.4 · '못 받았을 때' 뿐 아니라 '한 곡도 없을 때'도 계속 지켜본다.
//   (서버가 살아나면 아무것도 안 눌러도 목록이 돌아온다)
(async()=>{ let d=1500;
  for(let i=0;i<40;i++){
    await new Promise(r=>setTimeout(r,d));
    if(!P.listDirty && P.list.length) break;
    if(!isOnline()||document.hidden){ d=4000; continue; }
    await loadList({quiet:true});
    d=Math.min(30000,Math.round(d*1.7));   // 1.5s→2.5s→4s→… 최대 30초
  }
})();
// 탭으로 돌아오거나 인터넷이 붙으면, 목록이 비어 있을 때 한 번 더 받아 본다

// 13.3 · 백그라운드 탭 복귀 및 창 전환 시 실제 오디오와 UI 표시 곡(P.idx/제목/재생버튼) 완벽 일치 보정
function syncAudioUI(){
  try{
    if(!A) return;
    const isPlaying=!A.paused&&!A.ended&&A.currentTime>0;
    if(A.src){
      const L=curList();
      let matchedIdx=-1;
      const activeId=A._trackId||P.currentId;
      if(activeId){
        matchedIdx=L.findIndex(t=>t.id===activeId);
      }
      if(matchedIdx<0){
        matchedIdx=L.findIndex(t=>t.stream_url&&(t.stream_url===A.src||A.src.includes(t.stream_url)));
      }
      if(matchedIdx<0){
        const m=A.src.match(/\/api\/music\/file\/([0-9a-zA-Z_\-]+)/);
        if(m) matchedIdx=L.findIndex(t=>t.id===m[1]);
      }
      if(matchedIdx<0){
        matchedIdx=L.findIndex(t=>t.id&&A.src.includes(t.id));
      }
      if(matchedIdx>=0){
        P.idx=matchedIdx;
        A._trackId=L[matchedIdx].id;
        P.currentId=L[matchedIdx].id;
      }
    }
    const ppIcon=isPlaying?'<i class="ri-pause-fill"></i>':'<i class="ri-play-fill"></i>';
    const miniPP=$('mpPP');
    if(miniPP&&miniPP.innerHTML!==ppIcon) miniPP.innerHTML=ppIcon;
    const bigPP=$('mpBPP');
    if(bigPP&&bigPP.innerHTML!==ppIcon) bigPP.innerHTML=ppIcon;
    renderTitle();
    paintProg();
    markNowPlaying();
    if($('mpBig')&&$('mpBig').classList.contains('open')){
      renderBig();
      renderBigList();
    }
    if($('musicListPop')&&$('musicListPop').style.display==='flex') renderListPop();
  }catch(e){}
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden) return;
  syncAudioUI();
  if(!isOnline()) return;
  if(P.listDirty||!P.list.length){ P._healed=false; loadList({quiet:true}); }
});
window.addEventListener('focus',()=>{ syncAudioUI(); });
// 13.0 · 날씨는 20분마다 백그라운드에서 자동 갱신
setInterval(()=>{
  if(!document.hidden&&isOnline()){
    try{ loadRecoWeather(false); }catch(e){}
  }
}, 20*60*1000);
window.addEventListener('online',()=>{
  setTimeout(()=>{ if(P.listDirty||!P.list.length){ P._healed=false; loadList({quiet:true}); } },900);
});
// 다른 기기에서 재생목록이 바뀌면 열려 있는 목록도 즉시 다시 그린다.
document.addEventListener('sdy-playlists-updated',()=>{
  try{ if($('musicListPop').style.display==='flex'||P.plMode) renderListPop(); }catch(e){}
});
// 테마(프로/클래식·강조색)가 바뀌면 음악 플레이어·LP 디스크도 즉시 따라간다
try{
  const _themeKey=()=>document.documentElement.dataset.theme||(document.documentElement.classList.contains('theme-pro')?'pro':'classic');
  let _lastAccent=readAccent(), _lastTheme=_themeKey();
  const _syncTheme=()=>{
    const acc=readAccent();
    const th=_themeKey();
    if(acc===_lastAccent && th===_lastTheme) return;
    _lastAccent=acc; _lastTheme=th;
    makeDefCover();               // LP 디스크(기본 커버) 색 갱신
    renderTitle();                // 컨트롤바 커버·상태 재반영
  };
  new MutationObserver(_syncTheme).observe(document.documentElement,
    {attributes:true, attributeFilter:['class','style','data-theme']});
}catch(e){}

// ═══════════════════════════════════════════════════════════
//  10.1 · 큰 플로팅 뮤직플레이어 + 태그/표지 편집 + 자동 태깅
//  · 컨트롤바의 ⌃ 버튼(노트 안에서는 LP 디스크 표지 누르기)으로 열기
//  · 머리말을 잡아 끌면 화면 어디로든 이동(위치는 저장)
//  · 대기열 / 가수별 / 전체 곡 탭, 앨범·연도·장르·출처 표시
//  · '정보 편집' 으로 제목·가수·앨범·연도·장르·표지 직접 수정(서버 저장)
//  · '자동으로 찾기' 는 서버가 웹(Apple Music→Deezer→MusicBrainz)에서
//    다시 찾아 정리 — 수동 편집한 곡은 덮지 않는다
// ═══════════════════════════════════════════════════════════
P.bigTab='d'; P.artOpen={}; P.coverV=''; P.bq=''; P.recoFilter='all'; P.weather=null;
const mpbEl=$('mpBig');

// ── 열기/닫기/이동 ──
function clampMpb(){
  // 전체 화면(진짜/가짜) 중에는 위치를 건드리지 않는다.
  // (모핑 중 폭이 100vw 라 계산하면 왼쪽 벽에 붙어 버린다)
  if(mpbEl.classList.contains('mpb-fs')||mpbFsEl()===mpbEl) return;
  const r=mpbEl.getBoundingClientRect();
  // 창→창 복귀 모핑 중에는 실측 대신 목표 크기(인라인 width/height)를 쓴다
  const w=parseFloat(mpbEl.style.width)||r.width;
  const h=parseFloat(mpbEl.style.height)||r.height;
  let x=parseFloat(mpbEl.style.left); let y=parseFloat(mpbEl.style.top);
  if(!isFinite(x)){
    // 처음 열 때 공용 실측으로 화면 가운데 (배율·브라우저와 무관)
    const vp=sdyViewportBox();
    x=Math.round((((vp.w||window.innerWidth)||1024)-(w||0))/2);
    // 14.51 · 프로 테마: 좌측 사이드바/레일을 뺀 콘텐츠 영역 중앙
    try{
      if(typeof sdyTheme==='function'&&sdyTheme()==='pro'){
        const side=document.getElementById('proSide');
        if(side){ x+=Math.round((side.getBoundingClientRect().width||0)/2); }
      }
    }catch(e){}
  }
  if(!isFinite(y)){
    const vp=sdyViewportBox();
    y=Math.max(8,Math.round((((vp.h||window.innerHeight)||768)-(h||0))/2));
  }
  const c=sdyClampFloatingRect(mpbEl,x,y);
  mpbEl.style.left=Math.round(c.x)+'px'; mpbEl.style.top=Math.round(c.y)+'px';
}
function _barShouldShow(){
  // 현재 모드에서 아래 바(LP 디스크)가 보여야 하는가
  if(P.collapsed) return false;
  if(P.mode==='float') return !!(A.src&&!A.paused);
  return true;
}
function refreshBarVis(){
  if(_barShouldShow()){ pl.style.display='flex'; _setMpChip(false); }
  else { pl.style.display='none'; _setMpChip(true); }
}
function _applyBigSize(){
  // 12.10.1 · 하단 추천/목록이 잘리지 않도록 세로를 늘린다.
  //   기존 황금비 1:1.618보다 세로형인 1:1.36으로 조정했다.
  //   창의 외곽은 화면 안에 맞추고, 내부 목록은 남은 공간에서 스크롤한다.
  //   화면 크기도 창이 쓰는 단위(UI CSS px)로 재야 한다 — innerWidth(화면 px)를
  //   그대로 쓰면 90% 배율에서 창이 화면보다 10% 작게 잡혀 오른쪽·아래가 논다.
  const ratio=1.36;
  const vp=sdyViewportBox();
  const vw=vp.w||innerWidth, vh=vp.h||innerHeight;
  let w=Math.min(880,vw-16);
  let h=Math.round(w/ratio);
  if(h>vh-24){ h=vh-24; w=Math.min(w,Math.round(h*ratio)); }
  mpbEl.style.width=Math.round(w)+'px'; mpbEl.style.height=Math.round(h)+'px';
}
function openBig(){
  // 큰 플레이어가 열리면 작은 목록 팝업과 아래 컨트롤바는 숨긴다 (겹침 제거)
  const lp0=$('musicListPop'); if(lp0) lp0.style.display='none';
  P._barWasShown=pl.style.display!=='none';
  pl.style.display='none';
  if(!mpbEl.classList.contains('open')){
    try{ const p=JSON.parse(localStorage.getItem('mp_big_pos')||'null');
      if(p&&isFinite(p.x)&&isFinite(p.y)){ mpbEl.style.left=p.x+'px'; mpbEl.style.top=p.y+'px'; }
    }catch(e){}
    _applyBigSize();
    mpbEl.classList.add('open');
  }
  requestAnimationFrame(clampMpb);
  syncAudioUI();
  renderBig(); renderBigList();
  try{ mpbFullIcon(); }catch(e){}   // 전체 화면 아이콘 상태 동기화
}
let _mpbDrag=null;
(function(){
  const head=$('mpBigHead'); if(!head) return;
  head.addEventListener('pointerdown',e=>{
    if(e.target.closest('button')) return;
    clampMpb();
    _mpbDrag={sx:e.clientX,sy:e.clientY,
              ox:parseFloat(mpbEl.style.left)||0,oy:parseFloat(mpbEl.style.top)||72};
    try{ head.setPointerCapture(e.pointerId); }catch(err){}
  });
  head.addEventListener('pointermove',e=>{
    if(!_mpbDrag) return;
    const dx=window.sdyUiCss(e.clientX-_mpbDrag.sx), dy=window.sdyUiCss(e.clientY-_mpbDrag.sy);
    const c=sdyClampFloatingRect(mpbEl,_mpbDrag.ox+dx,_mpbDrag.oy+dy);
    mpbEl.style.left=Math.round(c.x)+'px'; mpbEl.style.top=Math.round(c.y)+'px';
  });
  const end=()=>{ if(!_mpbDrag) return; _mpbDrag=null;
    try{ localStorage.setItem('mp_big_pos',JSON.stringify({
      x:parseFloat(mpbEl.style.left),y:parseFloat(mpbEl.style.top)})); }catch(e){} try{if(window.pushSettings)window.pushSettings();}catch(e){} };
  head.addEventListener('pointerup',end);
  head.addEventListener('pointercancel',end);
  addEventListener('resize',()=>{
    if(!mpbEl.classList.contains('open')) return;
    const r=mpbEl.getBoundingClientRect();
    const c=sdyClampFloatingRect(mpbEl,
      isFinite(parseFloat(mpbEl.style.left))?parseFloat(mpbEl.style.left):window.sdyUiCss(r.left),
      isFinite(parseFloat(mpbEl.style.top))?parseFloat(mpbEl.style.top):window.sdyUiCss(r.top));
    mpbEl.style.left=Math.round(c.x)+'px'; mpbEl.style.top=Math.round(c.y)+'px';
  });
})();

// ── 15.0 → 16.0 · 확대 플레이어 전체 화면 ──
//   · 창→전체화면은 css transition 모핑(.mpb-anim)으로 부드럽게 커지고,
//     데스크톱은 같은 자리에서 진짜 Fullscreen API 까지 붙인다.
//   · 아이폰 사파리 등 Fullscreen API 가 없으면 css 전체 화면 하나로 같은 모양.
//   · 달라붙는 동안 스테이지·표지·앰비언트 배경이 시차를 두고 떠오른다.
function mpbFsEl(){ return (document.fullscreenElement||document.webkitFullscreenElement)||null; }
function mpbIsFs(){ return mpbFsEl()===mpbEl||mpbEl.classList.contains('mpb-fs'); }
function mpbFullIcon(){
  const b=$('mpBFull'); if(!b) return;
  b.innerHTML=mpbIsFs()?'<i class="ri-fullscreen-exit-line"></i>':'<i class="ri-fullscreen-line"></i>';
  b.title=mpbIsFs()?'전체 화면 끄기 (Esc)':'전체 화면 (F)';
}
let _mpbFsT=null,_mpbRealFs=false,_mpbPrePos=null;
function _mpbAnimKick(){           // 모핑 transition 은 켜질/꺼질 때만 잠깐 붙인다 (드래그 간섭 방지)
  mpbEl.classList.add('mpb-anim');
  clearTimeout(_mpbFsT);
  _mpbFsT=setTimeout(()=>mpbEl.classList.remove('mpb-anim'),620);
}
function _mpbSavedPos(){
  try{ const p=JSON.parse(localStorage.getItem('mp_big_pos')||'null');
    if(p&&isFinite(p.x)&&isFinite(p.y)) return {x:p.x,y:p.y};
  }catch(e){}
  return null;
}
function mpbFakeFs(on){
  if(on){
    // 전체 화면으로 가기 전 '창 위치'를 확실히 만들어 두고 기억한다 (돌아올 자리).
    //   처음 열 때 가운데로 놓인 창도 style.left/top 이 아직 없을 수 있으므로
    //   clampMpb() 를 먼저 돌려 위치를 확정한 뒤 저장해야 전체 화면에서 내려올 때
    //   왼쪽 벽에 달라붙지 않는다.
    try{ clampMpb(); }catch(e){}
    const x=parseFloat(mpbEl.style.left), y=parseFloat(mpbEl.style.top);
    if(isFinite(x)&&isFinite(y)){
      _mpbPrePos={x,y};
      try{ localStorage.setItem('mp_big_pos',JSON.stringify(_mpbPrePos)); }catch(e){}
    }
    _mpbAnimKick();
    // 클래스 css(100vw/100vh)가 !important 로 인라인 크기를 덮으므로
    // 한 박자 늦게 붙여 현재 창 위치에서 화면 가득으로 자라나는 모핑이 보이게 한다
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      mpbEl.classList.add('mpb-fs');
      try{ mpbFsListTab(); }catch(e){}
    }));
  }else{
    _mpbAnimKick();
    mpbEl.classList.remove('mpb-fs','show-drawer');
    // 창 크기를 되돌린 뒤 원래 자리로 — 이 순서를 지키지 않으면
    // 폭이 아직 100vw 라 왼쪽 벽에 달라붙는다.
    _applyBigSize();
    const p=_mpbPrePos||_mpbSavedPos();
    _mpbPrePos=null;
    if(p){ mpbEl.style.left=Math.round(p.x)+'px'; mpbEl.style.top=Math.round(p.y)+'px'; }
    // 클램프(화면 안으로 잡아두기)는 모핑(0.52s)이 끝난 뒤에만 실행한다.
    //   모핑 중에는 창이 아직 100vw 로 보여 clampMpb 가 '창이 화면보다 크다'고
    //   판단해 위치를 (0,0)으로 꽂아 버린다 — 그래서 전체 화면에서 나오면
    //   창이 과소 자리가 아니라 고정된 왼쪽 위로 줄어들던 버그가 생겼다.
    //   드래그·리사이즈 경로의 clampMpb 는 그대로 두고 이 복귀 경로만 늦춘다.
    setTimeout(()=>{
      if(mpbEl.classList.contains('mpb-fs')||mpbFsEl()===mpbEl) return;  // 다시 전체화면이면 취소
      if(p){ mpbEl.style.left=Math.round(p.x)+'px'; mpbEl.style.top=Math.round(p.y)+'px'; }
      try{ clampMpb(); }catch(e){}
      // clampMpb 로 확정된 자리를 저장해, 그 다음 열림·리사이즈가 이 자리를 쓴다
      try{ localStorage.setItem('mp_big_pos',JSON.stringify({
        x:parseFloat(mpbEl.style.left),y:parseFloat(mpbEl.style.top)})); }catch(e){}
      try{ if(window.pushSettings) window.pushSettings(); }catch(e){}
    },600);
  }
  mpbFullIcon();
}
function mpbToggleFull(){
  if(!mpbEl.classList.contains('open')) openBig();   // 접힌 상태에서 눌러도 열리며 전체화면
  if(mpbIsFs()){
    const fs=mpbFsEl();
    if(fs===mpbEl){ try{ (document.exitFullscreen||document.webkitExitFullscreen||function(){}).call(document); }catch(e){} }
    mpbFakeFs(false);
    return;
  }
  mpbFakeFs(true);
  // 데스크톱: css 모핑이 그려진 뒤 같은 자리에서 진짜 전체 화면으로 올라간다 (브라우저 크롬까지 사라짐)
  const req=mpbEl.requestFullscreen||mpbEl.webkitRequestFullscreen;
  if(req){
    try{
      const p=req.call(mpbEl);
      _mpbRealFs=true;
      if(p&&p.catch) p.catch(()=>{ _mpbRealFs=false; });
    }catch(e){ _mpbRealFs=false; }
  }
}
(function(){
  const b=$('mpBFull'); if(!b) return;
  b.addEventListener('click',e=>{ e.stopPropagation(); mpbToggleFull(); });
  ['fullscreenchange','webkitfullscreenchange'].forEach(ev=>
    document.addEventListener(ev,()=>{
      mpbFullIcon();
      // 브라우저가 전체 화면을 풀었다(Esc·제스처) → css 전체 화면도 함께 거둔다
      if(mpbFsEl()!==mpbEl){
        if(_mpbRealFs&&mpbEl.classList.contains('mpb-fs')) mpbFakeFs(false);
        _mpbRealFs=false;
      }
    }));
  // 가짜 전체 화면에서는 Esc 로 나간다 (진짜 전체 화면은 브라우저가 처리)
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&mpbEl.classList.contains('mpb-fs')&&!_mpbRealFs) mpbFakeFs(false);
  });
  // 스테이지 빈 곳 더블클릭 = 전체 화면 해제 (버튼·슬라이더·서랍·헤더 위는 무시)
  mpbEl.addEventListener('dblclick',e=>{
    if(!mpIsFsNow()) return;
    // 17.4 · 진행바(.mpb-prog/#mpBProg · 컨트롤바 .mp-prog) 위의 빠른 두 번
    //   잡기는 위치 조정이지 더블클릭이 아니므로 전체 화면을 풀지 않는다.
    if(e.target.closest('button,input,a,canvas,select,textarea,.mpb-drawer,.mp-eqpop,.mpb-head,#mpBSearch,.mpb-prog,#mpBProg,.mp-prog,#mpProg')) return;
    mpbToggleFull();
  });
})();

// ═══════════════════════════════════════════════════════════
// 16.0 · 전체 화면 꾸미기 — 앰비언트 표지·패럴 럭스·서랍·타이머·이퀄라이저
// ═══════════════════════════════════════════════════════════
// 재생 상태를 body 클래스로 — 목록/머리의 막대 애니메이션이 멈출 때 같이 멈춘다
A.addEventListener('play',()=>{ try{ document.body.classList.add('mpb-playing'); }catch(e){} });
A.addEventListener('pause',()=>{ try{ document.body.classList.remove('mpb-playing'); }catch(e){} });
if(!A.paused){ try{ document.body.classList.add('mpb-playing'); }catch(e){} }

function mpIsFsNow(){ try{ return mpbIsFs(); }catch(e){ return false; } }
function _bumpEl(el,cls){ if(!el||!cls) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

// ── 곡이 바뀌면 배경·표지·제목에 작은 반응(전환 범프)을 준다 ──
//   (renderBig 은 함수 선언이라 이 파일 안에서는 같은 바인딩 — 덮어써도 이후 모든 호출은 최신 함수를 본다)
(function(){
  const _renderBigOrig=renderBig;
  renderBig=function(){
    const r=_renderBigOrig.apply(this,arguments);
    try{
      mpbAmbience();
      if(mpIsFsNow()){
        _bumpEl($('mpBTitle'),'bump');
        _bumpEl($('mpBCwrap'),'bump');
      }
    }catch(e){}
    return r;
  };
})();

// ── 앰비언트 배경: 표지를 크게 흐려 깔고 표지 색 두 개로 오로라를 만든다 ──
const _ambCache=new Map();   // 표지 URL → [평균색, 채도 높은 포인트 색]
function mpbAmbience(){
  const holder=$('mpAmbImg'); if(!holder) return;
  const t=cur();
  const url=t?coverURL(t):DEF_COVER;
  if(holder.dataset.cur===url) return;
  holder.dataset.cur=url;
  holder.classList.remove('on');
  holder.onload=()=>{ holder.classList.add('on'); };
  holder.onerror=()=>{ holder.onerror=null; holder.src=DEF_COVER; holder.classList.add('on'); };
  holder.src=url;
  _ambApplyColor(url);
}
function _ambApplyColor(url){
  if(_ambCache.has(url)){ _ambPaint(_ambCache.get(url)); return; }
  let done=false;
  const finish=(cols)=>{ if(done) return; done=true;
    _ambCache.set(url,cols);
    const holder=$('mpAmbImg');
    if(holder&&holder.dataset.cur===url) _ambPaint(cols); };
  setTimeout(()=>finish(null),2600);            // 느리면 강조색 평백으로
  try{
    const im=new Image(); im.crossOrigin='anonymous'; im.decoding='async';
    im.onload=()=>{
      try{
        const cv=document.createElement('canvas'); cv.width=cv.height=24;
        const cx=cv.getContext('2d',{willReadFrequently:true});
        if(!cx){ finish(null); return; }
        cx.drawImage(im,0,0,24,24);
        const d=cx.getImageData(0,0,24,24).data;
        let r=0,g=0,b=0,n=0,bs=-1,best=null;
        for(let i=0;i<d.length;i+=4){
          const R=d[i],G=d[i+1],B=d[i+2]; r+=R;g+=G;b+=B;n++;
          const mx=Math.max(R,G,B),mn=Math.min(R,G,B);
          const score=(mx-mn)*(mx>52&&mx<232?1:.35);   // 채도 있는 중간 밝기를 포인트로
          if(score>bs){ bs=score; best=[R,G,B]; }
        }
        const jy=v=>Math.max(34,Math.min(222,v));
        finish(['rgb('+jy(r/n|0)+','+jy(g/n|0)+','+jy(b/n|0)+')',
                'rgb('+(best?best[0]:142)+','+(best?best[1]:92)+','+(best?best[2]:247)+')']);
      }catch(e){ finish(null); }     // 캔버스 오염(외부 표지) → 평백
    };
    im.onerror=()=>finish(null);
    im.src=url;
  }catch(e){ finish(null); }
}
function _ambPaint(cols){
  const c1=cols?cols[0]:readAccent();
  const c2=cols?cols[1]:'#8e5cf7';
  try{
    mpbEl.style.setProperty('--amb1',c1);
    mpbEl.style.setProperty('--amb2',c2);
  }catch(e){}
}

// ── 표지 마우스 패럴 럭스 (전체 화면 + 정밀 포인터) ──
(function(){
  const stage=$('mpBStage'); if(!stage) return;
  const mm=window.matchMedia?window.matchMedia.bind(window):null;
  const fine=mm?mm('(pointer:fine)'):{matches:true};
  const reduced=mm?mm('(prefers-reduced-motion: reduce)'):{matches:false};
  stage.addEventListener('pointermove',e=>{
    if(!mpIsFsNow()||!fine.matches||reduced.matches) return;
    const r=stage.getBoundingClientRect();
    const dx=(e.clientX-r.left)/r.width-.5, dy=(e.clientY-r.top)/r.height-.5;
    const cw=$('mpBCwrap'); if(!cw) return;
    cw.style.setProperty('--tiltx',(dx*4.2).toFixed(2)+'deg');
    cw.style.setProperty('--tilty',(-dy*3.6).toFixed(2)+'deg');
  });
  stage.addEventListener('pointerleave',()=>{
    const cw=$('mpBCwrap'); if(!cw) return;
    cw.style.setProperty('--tiltx','0deg'); cw.style.setProperty('--tilty','0deg');
  });
})();

// ── 전체 화면 목록 서랍 · 가사 바로가기 (스트리밍 앱처럼 옆에서 슬라이드) ──
function mpbLastPlayTab(){
  const t=P._listTab;
  return (t && t!=='y' && t!=='d') ? t : 'q';
}
function mpbFsListTab(){
  if(!mpIsFsNow() && !mpbEl.classList.contains('mpb-fs')) return;
  if(P.bigTab==='d'){ P.bigTab=mpbLastPlayTab(); renderBigList(); }
}
function mpbDrawerBtns(){
  const on=mpbEl.classList.contains('show-drawer');
  const b=$('mpBList'); if(b) b.classList.toggle('on',on&&P.bigTab!=='y');
  const yb=$('mpBLyrBtn'); if(yb) yb.classList.toggle('on',on&&P.bigTab==='y');
}
function mpbDrawer(open){
  const on=open===undefined?!mpbEl.classList.contains('show-drawer'):!!open;
  mpbEl.classList.toggle('show-drawer',on);
  mpbDrawerBtns();
}
(function(){
  const lb=$('mpBList');
  if(lb) lb.onclick=e=>{
    e.stopPropagation();
    const open=mpbEl.classList.contains('show-drawer');
    if(open && P.bigTab!=='y'){ mpbDrawer(false); return; }
    if(P.bigTab==='y' || (mpIsFsNow() && P.bigTab==='d')){
      P.bigTab=mpbLastPlayTab(); renderBigList();
    }
    mpbDrawer(true);
  };
  const yb=$('mpBLyrBtn');
  if(yb) yb.onclick=e=>{
    e.stopPropagation();
    const open=mpbEl.classList.contains('show-drawer');
    if(open && P.bigTab==='y'){ mpbDrawer(false); return; }
    if(P.bigTab!=='y') P._listTab=P.bigTab;
    P.bigTab='y'; mpbDrawer(true); renderBigList();
  };
  // 전체 화면에서 검색을 열 땐 서랍도 같이 연다 (결과가 목록에 보이므로)
  const fb=$('mpBFind');
  if(fb){
    const _orig=fb.onclick;
    fb.onclick=e=>{
      const willOpen=!$('mpBSearchBar').classList.contains('show');
      if(_orig) _orig.call(fb,e);
      if(willOpen&&mpIsFsNow()) mpbDrawer(true);
    };
  }
  // 폰에서는 서랍에서 곡을 고륨 서랍이 낮게 접혀 물대가 보이게
  $('mpBBody').addEventListener('click',e=>{
    if(!mpIsFsNow()||innerWidth>760) return;
    if(e.target.closest('[data-bl],[data-bq],.mpb-reco-card,.mpb-album-card')){
      setTimeout(()=>mpbDrawer(false),180);
    }
  });
})();

// ── 검색창 예쁘게: 결과 배지(몇 곡 찾았는지) ──
(function(){
  const inp=$('mpBSearch'); if(!inp) return;
  const upd=()=>{ const c=$('mpBSearchCnt'); if(!c) return;
    const q=(inp.value||'').trim();
    if(!q){ c.textContent=''; return; }
    try{ c.textContent=searchTracks(P.list,q).length+'곡'; }catch(e){ c.textContent=''; } };
  inp.addEventListener('input',upd);
  const _cbs=closeBigSearch;
  closeBigSearch=function(){
    const r=_cbs.apply(this,arguments);
    const c=$('mpBSearchCnt'); if(c) c.textContent='';
    return r;
  };
})();

// ── 수면 타이머: 끄기 → 15 → 30 → 45 → 60분 → 이번 곡까지만 ──
const SLEEP_STEPS=[0,15,30,45,60,'곡'];
P._sleep={step:0,at:0};
function mpbSleepPaint(){
  const b=$('mpBSleep'); if(!b) return;
  const s=P._sleep, on=s.step>0;
  b.classList.toggle('live',on);
  const em=b.querySelector('em');
  if(!on){
    b.title='수면 타이머 — 누를 때마다 15·30·45·60분·이번 곡';
    if(em) em.textContent='';
    return;
  }
  if(SLEEP_STEPS[s.step]==='곡'){
    b.title='이번 곡이 끝나면 재생을 멈춥니다';
    if(em) em.textContent='곡';
  }else{
    const left=Math.max(0,Math.ceil((s.at-Date.now())/60000));
    b.title='수면 타이머 · 약 '+left+'분 뒤 정지 (다시 누르시면 변경)';
    if(em) em.textContent=left+'′';
  }
}
function mpbSleepStop(quiet){
  P._sleep={step:0,at:0}; mpbSleepPaint();
  if(!quiet) toast('수면 타이머가 꺼졌어요',1300);
}
$('mpBSleep').onclick=e=>{
  e.stopPropagation();
  const s=P._sleep;
  s.step=(s.step+1)%SLEEP_STEPS.length;
  if(s.step===0){ mpbSleepStop(); return; }
  const v=SLEEP_STEPS[s.step];
  if(v==='곡'){ s.at=0; toast('이번 곡이 끝나면 멈춥니다',1700); }
  else{ s.at=Date.now()+v*60000; toast('수면 타이머 · '+v+'분 뒤 재생을 멈춥니다',1900); }
  mpbSleepPaint();
};
setInterval(()=>{
  const s=P._sleep; if(!s.step) return;
  mpbSleepPaint();
  if(s.at&&Date.now()>=s.at){
    mpbSleepStop(true);
    if(!A.paused) smoothPause();
    toast('수면 타이머로 재생을 멈췄어요 · 좋은 밤 되세요',2600);
  }
},10000);
A.addEventListener('ended',()=>{
  if(P._sleep.step===SLEEP_STEPS.length-1){          // '이번 곡까지'
    mpbSleepStop(true);
    setTimeout(()=>{ if(!A.paused) A.pause(); },60);  // 다음 곡이 트는 즉시 대기 상태로
    toast('이번 곡까지 듣고 멈췄어요',2300);
  }
});

// ── 전체 화면 단축키: F = 전체 화면, / = 노래 검색 ──
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  const el=document.activeElement;
  if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable)) return;
  const open=mpbEl.classList.contains('open');
  if(!open&&pl.style.display==='none') return;
  if(e.key==='f'||e.key==='F'){ e.preventDefault(); mpbToggleFull(); }
  else if(e.key==='/'&&open&&mpIsFsNow()){
    e.preventDefault();
    try{ $('mpBFind').click(); }catch(err){}
  }
});

// ═══════════════════════════════════════════════════════════
// 16.0 · 이퀄라이저 (Web Audio 10밴드 — 작은 아이콘 뒤에 조용히)
//   · MediaElementSource 로 한 번 물리면 그 오디오는 끝까지 그래프를
//     타므로, CORS 없는 외부 스트림(cloudinary 구형 라이브러리 등)에는
//     무음이 되지 않도록 '만들기 전에' 검사하고, 안 되면 이유를 보여 준다.
//   · 설정은 mp_eq1 에 저장 — 다음 방문 때도 그대로.
// ═══════════════════════════════════════════════════════════
const EQ_FREQS=[32,64,125,250,500,1000,2000,4000,8000,16000];
const EQ_PRESETS=[
  ['원음',        [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['베이스 부스트',[ 8, 6, 4, 2, 0, 0, 0, 0, 1, 1]],
  ['보컬 강조',   [-2,-3,-2, 1, 4, 5, 4, 2, 0,-1]],
  ['팝',          [-1, 2, 4, 4, 2, 0,-1,-1, 0, 1]],
  ['록',          [ 4, 3, 1,-1,-2,-1, 2, 4, 5, 5]],
  ['힙합',        [ 7, 6, 3, 1,-1,-1, 1, 1, 2, 3]],
  ['R&B',         [ 4, 6, 5, 2,-1,-2, 1, 2, 3, 3]],
  ['클래식',      [ 4, 3, 0, 0, 0, 0,-3,-3,-2, 2]],
  ['재즈',        [ 3, 2, 1, 2,-2,-2, 0, 1, 2, 3]],
  ['일렉트로닉',  [ 6, 5, 2, 0,-2, 1, 1, 2, 5, 6]],
];
const EQ={on:false,preset:0,gains:EQ_FREQS.map(()=>0)};
try{
  const saved=JSON.parse(localStorage.getItem('mp_eq1')||'null');
  if(saved){ EQ.on=!!saved.on; EQ.preset=+saved.preset||0;
    if(Array.isArray(saved.gains)) saved.gains.slice(0,10).forEach((v,i)=>{ EQ.gains[i]=+v||0; }); }
}catch(e){}
let _eqCtx=null,_eqChain=[],_eqAnalyser=null,_eqBuilt=false,_eqBusy=false;
const _eqCorsMiss=new Set();   // 이번 세션에서 실패한 origin (성공만 디스크에 남긴다)

// 라이브러리·현재 곡의 외부 스트림 origin 별로 CORS 통과 여부 검사
async function _eqStreamsPass(){
  const byOrigin=new Map();
  const add=u=>{ try{ const o=new URL(u,location.href).origin;
    if(o&&o!=='null'&&o!==location.origin&&!byOrigin.has(o)) byOrigin.set(o,u); }catch(e){} };
  (P.list||[]).forEach(t=>{ if(t&&t.stream_url) add(t.stream_url); });
  add(A.currentSrc||A.src||'');
  for(const [o,u] of byOrigin){
    if(_eqCorsMiss.has(o)) return false;
    const ck='mp_eqcors_'+o;
    try{ if(localStorage.getItem(ck)==='1') continue; }catch(e){}
    let okc=false;
    try{
      const ctl=new AbortController();
      const tm=setTimeout(()=>ctl.abort(),4500);
      const r=await fetch(u,{mode:'cors',headers:{Range:'bytes=0-0'},signal:ctl.signal});
      clearTimeout(tm);
      okc=!!(r&&(r.ok||r.status===206));
      try{ r.body&&r.body.cancel&&r.body.cancel(); }catch(e){}
    }catch(e){ okc=false; }
    if(okc){ try{ localStorage.setItem(ck,'1'); }catch(e){} }
    else { _eqCorsMiss.add(o); return false; }
  }
  return true;
}
async function eqBuild(){
  if(_eqCtx) return true;
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) return false;
  if(!(await _eqStreamsPass())) return false;      // 외부 스트림은 무음 위험 → 만들지 않는다
  try{ A.crossOrigin='anonymous'; }catch(e){}
  _eqCtx=new AC();
  const src=_eqCtx.createMediaElementSource(A);
  let node=src;
  _eqChain=EQ_FREQS.map((f,i)=>{
    const q=_eqCtx.createBiquadFilter();
    q.type=i===0?'lowshelf':i===EQ_FREQS.length-1?'highshelf':'peaking';
    q.frequency.value=f; q.Q.value=1.05; q.gain.value=0;
    node.connect(q); node=q; return q;
  });
  _eqAnalyser=_eqCtx.createAnalyser();
  // 15.1 · 버츄얼라이저 구동부 — 시중 스펙트럼 바처럼 '읽는 창'부터 잡는다.
  //   fft 올려 대역 해상도를 확보하고, 스묭 량을 낮춰 타격음이 뭉개지지 않게
  //   하며(눌림은 아래의 공격/낙하 봉투가 맡는다), dB 창을 음악용(-85~-25)으로
  //   좁혀 막대가 화면 전체를 쓰게 한다. 기본 창(-100~-30)은 조용한 구간이
  //   바닥 가까이 몰려 막대가 죽어 보였다.
  _eqAnalyser.fftSize=1024; _eqAnalyser.smoothingTimeConstant=.5;
  _eqAnalyser.minDecibels=-85; _eqAnalyser.maxDecibels=-25;
  node.connect(_eqAnalyser); _eqAnalyser.connect(_eqCtx.destination);
  _eqBuilt=true;
  eqApplyGains(true);
  _eqReloadKeep();
  return true;
}
function _eqReloadKeep(){
  // crossOrigin 을 켠 뒤에는 자원을 다시 받아야 그래프가 소리를 받는다 — 자리를 지키며 재장전
  if(!A.src) return;
  const t0=A.currentTime||0, wasPlaying=!A.paused;
  const onMeta=()=>{
    A.removeEventListener('loadedmetadata',onMeta);
    try{ if(t0>1) A.currentTime=t0; }catch(e){}
    if(wasPlaying) A.play().catch(()=>{});
  };
  A.addEventListener('loadedmetadata',onMeta);
  try{ A.load(); }catch(e){ A.removeEventListener('loadedmetadata',onMeta); }
}
function eqApplyGains(instant){
  if(!_eqCtx||!_eqChain.length) return;
  const tc=_eqCtx.currentTime;
  _eqChain.forEach((q,i)=>{
    const v=EQ.on?EQ.gains[i]:0;          // 꺼짐 = 플랫 우회 (무음 방지로 연결은 언제나 유지)
    try{
      q.gain.cancelScheduledValues(tc);
      if(instant) q.gain.value=v; else q.gain.setTargetAtTime(v,tc,.03);
    }catch(e){}
  });
}

// ── 팝오버 구축 (열 때 딱 한 번) ──
function _eqBuildPop(){
  const pop=$('mpEqPop'); if(!pop) return null;
  if(pop.dataset.built) return pop;
  pop.dataset.built='1';
  pop.innerHTML=
    '<div class="eq-top"><i class="ri-equalizer-line"></i><b>이퀄라이저</b>' +
    '<span class="eq-preset-name" id="mpEqPName"></span><span class="sp"></span>' +
    '<button type="button" class="eq-mini" id="mpEqReset">초기화</button>' +
    '<button type="button" class="eq-sw" id="mpEqSw" role="switch" aria-label="이퀄라이저 켜기"><span></span></button></div>' +
    '<canvas id="mpEqCv" width="760" height="108"></canvas>' +
    '<div class="eq-presets" id="mpEqPresets"></div>' +
    '<div class="eq-bands" id="mpEqBands"></div>' +
    '<div class="eq-note" id="mpEqNote"></div>';
  pop.querySelector('#mpEqPresets').innerHTML=
    EQ_PRESETS.map((p,i)=>'<button type="button" data-eqp="'+i+'">'+p[0]+'</button>').join('');
  pop.querySelector('#mpEqBands').innerHTML=EQ_FREQS.map((f,i)=>{
    const lab=f>=1000?(f/1000)+'K':String(f);
    return '<div class="eq-band"><b id="mpEqV'+i+'">0</b>' +
      '<input type="range" min="-12" max="12" step="0.5" value="0" data-eqb="'+i+'" orient="vertical" aria-label="'+lab+'Hz">' +
      '<em>'+lab+'</em></div>';
  }).join('');
  pop.querySelector('#mpEqBands').addEventListener('input',e=>{
    const i=+(e.target.dataset&&e.target.dataset.eqb);
    if(isNaN(i)) return;
    EQ.gains[i]=+e.target.value;
    EQ.preset=-1;                                   // 손대면 '사용자 설정'
    _eqSave(); eqApplyGains(); _eqPaintPop();
  });
  pop.querySelector('#mpEqBands').addEventListener('dblclick',e=>{      // 밴드 더블클릭 = 0으로
    const i=+(e.target.dataset&&e.target.dataset.eqb);
    if(isNaN(i)) return;
    e.target.value=0; EQ.gains[i]=0; _eqSave(); eqApplyGains(); _eqPaintPop();
  });
  pop.querySelector('#mpEqPresets').addEventListener('click',e=>{
    const b=e.target.closest('[data-eqp]'); if(!b) return;
    const i=+b.dataset.eqp;
    _eqSetPreset(i);
  });
  pop.querySelector('#mpEqSw').onclick=e=>{ e.stopPropagation(); _eqToggleOn(); };
  pop.querySelector('#mpEqReset').onclick=e=>{ e.stopPropagation(); _eqReset(); };
  return pop;
}
function _eqSave(){ try{ localStorage.setItem('mp_eq1',JSON.stringify(EQ)); }catch(e){} }
function _eqPaintPop(){
  const pop=$('mpEqPop'), btn=$('mpBEq');
  if(btn) btn.classList.toggle('on',EQ.on&&_eqBuilt);
  if(!pop||!pop.dataset.built) return;
  pop.classList.toggle('off',!EQ.on||!_eqBuilt);
  const sw=pop.querySelector('#mpEqSw'); if(sw) sw.classList.toggle('on',EQ.on&&_eqBuilt);
  pop.querySelectorAll('[data-eqp]').forEach(b=>b.classList.toggle('on',+b.dataset.eqp===EQ.preset));
  EQ_FREQS.forEach((f,i)=>{
    const inp=pop.querySelector('[data-eqb="'+i+'"]');
    if(inp&&+inp.value!==EQ.gains[i]) inp.value=EQ.gains[i];
    const v=pop.querySelector('#mpEqV'+i);
    if(v){ const g=EQ.gains[i]; v.textContent=(g>0?'+':'')+(+g).toFixed(1).replace(/\.0$/,''); }
  });
  const nm=pop.querySelector('#mpEqPName');
  if(nm) nm.textContent=!_eqBuilt?'연결 안 됨':EQ.on?(EQ.preset<0?'사용자 설정':EQ_PRESETS[EQ.preset][0]):'꺼짐';
}

function _eqFindPreset(nameOrIdx){
  if(nameOrIdx == null) return -1;
  if(typeof nameOrIdx === 'number'){
    if(nameOrIdx >= 0 && nameOrIdx < EQ_PRESETS.length) return nameOrIdx;
    return -1;
  }
  const s = String(nameOrIdx).trim().toLowerCase().replace(/[\s\-_]/g, '');
  if(!s) return -1;
  const alias = {
    '원음': 0, '플랫': 0, 'flat': 0, 'default': 0, '기본': 0, '초기화': 0, 'reset': 0, 'original': 0,
    '베이스': 1, '베이스부스트': 1, '저음': 1, 'bass': 1, 'bassboost': 1, '저음강조': 1,
    '보컬': 2, '보컬강조': 2, '목소리': 2, 'vocal': 2, 'vocalboost': 2,
    '팝': 3, 'pop': 3,
    '록': 4, '락': 4, 'rock': 4,
    '힙합': 5, 'hiphop': 5, 'hip-hop': 5,
    'r&b': 6, 'rnb': 6, '알앤비': 6, 'randb': 6,
    '클래식': 7, 'classic': 7, 'classical': 7,
    '재즈': 8, 'jazz': 8,
    '일렉트로닉': 9, '일렉': 9, '전자음악': 9, 'electronic': 9, 'electro': 9
  };
  if(alias.hasOwnProperty(s)) return alias[s];
  for(let i = 0; i < EQ_PRESETS.length; i++){
    const pName = EQ_PRESETS[i][0].toLowerCase().replace(/[\s\-_]/g, '');
    if(pName.indexOf(s) >= 0 || s.indexOf(pName) >= 0) return i;
  }
  return -1;
}

async function _eqTurnOn(){
  if(EQ.on && _eqBuilt){
    return true;
  }
  const okk = await eqBuild();
  if(!okk){
    _eqPaintPop();
    const note = $('mpEqNote');
    if(note){ note.textContent='외부 스트리밍 음원이나 이 브라우저에서는 이퀄라이저를 켤 수 없어요.'; note.classList.add('show'); }
    return false;
  }
  const note = $('mpEqNote'); if(note) note.classList.remove('show');
  if(_eqCtx && _eqCtx.state === 'suspended'){ try{ await _eqCtx.resume(); }catch(e){} }
  EQ.on = true;
  eqApplyGains();
  _eqSave();
  _eqPaintPop();
  toast('이퀄라이저 켜짐 · ' + (EQ.preset >= 0 && EQ_PRESETS[EQ.preset] ? EQ_PRESETS[EQ.preset][0] : '사용자 설정'), 1500);
  return true;
}

function _eqTurnOff(){
  EQ.on = false;
  eqApplyGains();
  _eqSave();
  _eqPaintPop();
  toast('이퀄라이저 꺼짐 · 원음으로 들려드려요', 1300);
  return true;
}

async function _eqToggleOn(){
  if(EQ.on){
    return _eqTurnOff();
  }
  return _eqTurnOn();
}

async function _eqSetPreset(nameOrIdx){
  const idx = _eqFindPreset(nameOrIdx);
  if(idx < 0) return false;
  EQ.preset = idx;
  EQ_PRESETS[idx][1].forEach((g, k) => { EQ.gains[k] = g; });
  _eqSave();
  if(!EQ.on || !_eqBuilt){
    const okk = await eqBuild();
    if(!okk){
      _eqPaintPop();
      const note = $('mpEqNote');
      if(note){ note.textContent='외부 스트리밍 음원이나 이 브라우저에서는 이퀄라이저를 켤 수 없어요.'; note.classList.add('show'); }
      return false;
    }
    const note = $('mpEqNote'); if(note) note.classList.remove('show');
    if(_eqCtx && _eqCtx.state === 'suspended'){ try{ await _eqCtx.resume(); }catch(e){} }
    EQ.on = true;
  }
  eqApplyGains();
  _eqSave();
  _eqPaintPop();
  toast('이퀄라이저 · ' + EQ_PRESETS[idx][0], 1500);
  return true;
}

function _eqReset(){
  EQ.gains = EQ_FREQS.map(() => 0);
  EQ.preset = 0;
  _eqSave();
  eqApplyGains();
  _eqPaintPop();
  toast('이퀄라이저 초기화 · 원음', 1300);
  return true;
}

async function _eqOpenPop(){
  const pop = _eqBuildPop();
  if(!pop) return false;
  pop.hidden = false;
  requestAnimationFrame(() => pop.classList.add('show'));
  _eqPaintPop();
  if(EQ.on && !_eqBuilt && !_eqBusy){
    _eqBusy = true;
    try { await eqBuild(); } catch(err){}
    if(!_eqBuilt) EQ.on = false;
    _eqBusy = false;
    _eqPaintPop();
  }
  eqViz();
  return true;
}

function _eqClosePop(){
  const pop = $('mpEqPop');
  if(!pop || pop.hidden) return false;
  pop.classList.remove('show');
  setTimeout(() => { pop.hidden = true; }, 220);
  return true;
}

function _eqGetState(){
  return {
    on: !!EQ.on,
    preset: EQ.preset,
    presetName: EQ.on ? (EQ.preset < 0 ? '사용자 설정' : (EQ_PRESETS[EQ.preset] ? EQ_PRESETS[EQ.preset][0] : '사용자 설정')) : '꺼짐',
    gains: [...EQ.gains],
    built: !!_eqBuilt
  };
}

const sdyEqObj = {
  on: _eqTurnOn,
  off: _eqTurnOff,
  toggle: _eqToggleOn,
  preset: _eqSetPreset,
  reset: _eqReset,
  open: _eqOpenPop,
  close: _eqClosePop,
  state: _eqGetState,
  findPreset: _eqFindPreset,
  presets: EQ_PRESETS,
  freqs: EQ_FREQS
};
window.sdyEq = sdyEqObj;

// 팝오버 열고 닫기 — 이퀄라이저는 눌러야만 살짝 보인다
(function(){
  const b=$('mpBEq'); if(!b) return;
  b.addEventListener('click',async e=>{
    e.stopPropagation();
    const pop=$('mpEqPop')||_eqBuildPop(); if(!pop) return;
    const willOpen=pop.hidden||!pop.classList.contains('show');
    if(willOpen){
      _eqOpenPop();
    }else{
      _eqClosePop();
    }
  });
  document.addEventListener('pointerdown',e=>{
    const pop=$('mpEqPop');
    if(!pop||pop.hidden) return;
    if(e.target.closest('#mpEqPop,#mpBEq')) return;
    _eqClosePop();
  });
})();
// 자동재생 정책: 제스처 안에서만 그래프를 만든다 — 켜둔 상태라면 첫 재생 때 부활
A.addEventListener('play',async()=>{
  if(!EQ.on||_eqCtx||_eqBusy) return;
  _eqBusy=true;
  try{
    if(await eqBuild()){ eqApplyGains(true); _eqPaintPop(); }
    else { EQ.on=false; _eqSave(); _eqPaintPop(); }
  }finally{ _eqBusy=false; }
});
// AudioContext 가 잠들면 다음 터치 때 깨운다
document.addEventListener('pointerdown',()=>{
  try{ if(_eqCtx&&_eqCtx.state==='suspended') _eqCtx.resume(); }catch(e){}
},true);

// ── 실시간 스펙트럼 (팝오버가 열린 동안만 그린다) ──
// 15.1 · 시중 플레이어 버츄얼라이저와 같은 구동 매커니즘:
//   ① 읽는 창: 음악용 dB 범위(-85~-25)로 좁혀 신호가 0~1 전체를 쓰게 한다
//   ② 감마 곡선으로 작은 차이도 크게 보이게 (역동성)
//   ③ 공격/낙하 봉투: 올라갈 땐 즉시, 낄땐 초당 일정 속도로 미끄러진다
//   ④ 피크 홀드 캡: 정점이 잠깐 머물다 천천히 낙하 — 스펙트럼 바의 상징
//   ⑤ 자동 이득(AGC): 조용히 마스터된 곡도 화면 가득 춤추게 (과증폭 방지 상한)
let _eqVizRaf=0, _eqEnv=null, _eqPeak=null, _eqHold=null, _eqBandMax=null, _eqVizLast=0, _eqBuf=null, _eqFBuf=null;
function eqViz(){
  const cv=$('mpEqCv'); if(!cv) return;
  let ctx2=null;
  try{ ctx2=cv.getContext('2d'); }catch(e){}
  if(!ctx2) return;
  cancelAnimationFrame(_eqVizRaf);
  let grad='#4f6ef7';
  try{
    if(typeof ctx2.createLinearGradient==='function'){
      grad=ctx2.createLinearGradient(0,cv.height,0,0);
      try{ grad.addColorStop(0,readAccent()); grad.addColorStop(1,'#8e5cf7'); }catch(e){}
    }
  }catch(e){}
  const N=64;
  if(!_eqEnv||_eqEnv.length!==N){
    _eqEnv=new Float32Array(N); _eqPeak=new Float32Array(N); _eqHold=new Float32Array(N);
    _eqBandMax=new Float32Array(N).fill(1);
  }
  const FALL=2.2, PEAK_FALL=.75, HOLD=.22, RANGE=80;
  const tick=(now)=>{
    const pop=$('mpEqPop');
    if(!pop||pop.hidden||document.hidden){ _eqVizRaf=0; _eqVizLast=0; return; }
    _eqVizRaf=requestAnimationFrame(tick);
    const dt=Math.min(.05,Math.max(.001,((now||0)-(_eqVizLast||(now||0)-16))/1000));
    _eqVizLast=now||0;
    ctx2.clearRect(0,0,cv.width,cv.height);
    if(!_eqAnalyser){
      const n=48, w=cv.width/n;
      ctx2.fillStyle=grad; ctx2.globalAlpha=.3;
      for(let i=0;i<n;i++){ const h=3+Math.abs(Math.sin(i*.7))*4;
        ctx2.fillRect(i*w+2,cv.height/2-h,w-4,h*2); }
      ctx2.globalAlpha=1; return;
    }
    const binCount=_eqAnalyser.frequencyBinCount||1024;
    if(!_eqBuf||_eqBuf.length!==binCount){ _eqBuf=new Uint8Array(binCount); _eqFBuf=new Float32Array(binCount); }
    if(typeof _eqAnalyser.getByteFrequencyData==='function') _eqAnalyser.getByteFrequencyData(_eqBuf);
    for(let i=0;i<binCount;i++) _eqFBuf[i]=_eqBuf[i]/255;
    const sr=(_eqCtx&&_eqCtx.sampleRate)||44100;
    const nyq=Math.max(1000,sr/2);
    const lo=40, hi=Math.min(18000,nyq*.92);
    const n=N, w=cv.width/n;
    ctx2.fillStyle=grad;
    let envMax=0;
    const aMin=_eqAnalyser.minDecibels, aMax=_eqAnalyser.maxDecibels, aRange=aMax-aMin||60;
    for(let i=0;i<n;i++){
      const f=lo*Math.pow(hi/lo,i/(n-1));
      const c=Math.round(f/nyq*(binCount-1));
      const half=Math.max(1,Math.round(c*.12+2));
      let ss=0,cnt=0;
      for(let j=Math.max(0,c-half);j<=Math.min(binCount-1,c+half);j++){ ss+=_eqFBuf[j]; cnt++; }
      let raw=ss/cnt;
      const db=aMin+raw*aRange;
      let v=(db-(aMax-RANGE))/RANGE;
      const tilt=Math.min(1.12,0.72+0.4*Math.sqrt(f/12000));
      v*=tilt;
      if(v>_eqBandMax[i]) _eqBandMax[i]=v*0.95+_eqBandMax[i]*0.05;
      else _eqBandMax[i]=Math.max(0.15,_eqBandMax[i]*0.9985+v*0.0015);
      const norm=Math.max(0.25,_eqBandMax[i]);
      v=Math.min(1, v/norm*0.85);
      v=Math.pow(Math.max(0,v),0.82);
      if(v>_eqEnv[i]) _eqEnv[i]=v;
      else _eqEnv[i]=Math.max(v,_eqEnv[i]-FALL*dt);
      const e=_eqEnv[i];
      if(e>envMax) envMax=e;
      if(e>=_eqPeak[i]){ _eqPeak[i]=e; _eqHold[i]=HOLD; }
      else{ _eqHold[i]=Math.max(0,_eqHold[i]-dt);
            if(_eqHold[i]<=0) _eqPeak[i]=Math.max(e,_eqPeak[i]-PEAK_FALL*dt); }
      const h=Math.max(2,e*(cv.height-8));
      const y=cv.height-h-3;
      ctx2.globalAlpha=.42+e*.58;
      if(ctx2.roundRect){ ctx2.beginPath(); ctx2.roundRect(i*w+2,y,w-4,h,3); ctx2.fill(); }
      else ctx2.fillRect(i*w+2,y,w-4,h);
      if(_eqPeak[i]>.02){
        const ph=Math.max(2.5,_eqPeak[i]*(cv.height-8));
        const py=cv.height-ph-3;
        ctx2.globalAlpha=Math.min(1,.55+_eqPeak[i]*.55);
        ctx2.fillRect(i*w+2,py,w-4,3);
      }
    }
    if(envMax>0.02){
      const target=0.85/Math.max(0.1,envMax);
      let _eqGain=1; _eqGain+=(target-_eqGain)*.028;
      const desired=aMax+(0.6-envMax)*14;
      _eqAnalyser.maxDecibels=aMax+(desired-aMax)*0.05;
      _eqAnalyser.minDecibels=_eqAnalyser.maxDecibels-RANGE;
      _eqAnalyser.maxDecibels=Math.max(-20,Math.min(-5,_eqAnalyser.maxDecibels));
      _eqAnalyser.minDecibels=Math.max(-105,Math.min(-72,_eqAnalyser.minDecibels));
    }
    ctx2.globalAlpha=1;
  };
  if(!_eqVizRaf) _eqVizRaf=requestAnimationFrame(tick);
}

// 첫 화면: 현재 곡 색으로 앰비언트 준비
try{ mpbAmbience(); mpbSleepPaint(); }catch(e){}
// ── 지금 재생 정보 ──
const LOSSLESS={flac:1,alac:1,wav:1,aiff:1};
function renderBig(){
  const t=cur(); if(!t) return;
  const im=$('mpBCover');
  im.onerror=()=>{ im.onerror=null; im.src=DEF_COVER; };
  im.src=coverURL(t);
  $('mpBTitle').textContent=t.title||'—';
  $('mpBArtist').textContent=(t.artist&&String(t.artist).trim())||'가수 미상';
  $('mpBAlbum').textContent=t.album?('앨범 · '+t.album):'';
  const chips=[];
  const ext=(t.ext||'').toLowerCase();
  if(ext) chips.push('<span class="fmt'+(LOSSLESS[ext]?' lossless':'')+'" title="음원 형식">'
    +(LOSSLESS[ext]?ext.toUpperCase()+' 무손실':ext.toUpperCase())+'</span>');
  if(t.year) chips.push('<span>'+esc2(t.year)+'</span>');
  if(t.genre) chips.push('<span>'+esc2(t.genre)+'</span>');
  if(t.tag_state==='pending') chips.push('<span class="src">태그 찾는 중…</span>');
  // 10.9 · '출처' 칩은 없앤다. 이름을 자동으로 찾아 고친 곡은 체크표시 하나만.
  if(t.orig_title&&t.orig_title!==t.title)
    chips.push('<span class="src ok" title="자동으로 찾은 곡 정보 · 원래 파일 이름: '
      +esc2(t.orig_title)+'"><i class="ri-check-line"></i></span>');
  $('mpBChips').innerHTML=chips.join('');
  $('mpBPP').innerHTML=A.paused?'<i class="ri-play-fill"></i>':'<i class="ri-pause-fill"></i>';
  const bw=$('mpBCwrap'); if(bw) bw.classList.toggle('playing',!A.paused&&!!A.src);
  paintProg();
  if(mpbEl.classList.contains('open')) renderBigList();
}
// ── 큰 플레이어 목록 (대기열/가수별/전체) ──
function bucketArtists(list){
  const g=new Map();
  list.forEach(t=>{ const a=(t.artist&&String(t.artist).trim())||'미분류';
    if(!g.has(a)) g.set(a,[]); g.get(a).push(t); });
  return [...g.entries()].sort((x,y)=>x[0].localeCompare(y[0],'ko'))
    .map(([name,tracks])=>({name,tracks}));
}

// ═══════════════════════════════════════════════════════════
// 12.8 · 1,000곡 라이브러리용 Apple Music 스타일 발견 화면
//   서버에 추천 결과를 저장하지 않는다. 곡의 장르·제목·가수·앨범·재생 기록을
//   현재 기분/시간/날씨와 빠르게 계산해 상위 몇 장만 그린다 → 1,000곡이어도
//   DOM에는 수십 개 카드만 존재한다.
// ═══════════════════════════════════════════════════════════
// ════════════════════ 13.3 · 스마트 추천 알고리즘 (템포/무드/보컬/국내외 분류 고도화) ════════════════════
function _playCount(t){ return Math.max(+t.play_count||0,+P.plays[t.id]||0); }
function _recoHash(s){ let h=2166136261; for(const c of String(s||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);} return h>>>0; }
function _recoText(t){ return ((t.genre||'')+' '+(t.title||'')+' '+(t.artist||'')+' '+(t.album||'')+' '+(t.lyrics_plain||t.lyrics||'').slice(0,300)).toLowerCase(); }

function _trackFeatures(t){
  if(!t) return {korean:false, foreign:true, tempo:'mid', moods:['calm'], artistStyles:[]};
  const title = (t.title||'').toLowerCase();
  const artist = (t.artist||'').toLowerCase();
  const album = (t.album||'').toLowerCase();
  const genre = (t.genre||'').toLowerCase();
  const lyrics = (t.lyrics_plain||t.lyrics||'').toLowerCase();
  const text = (title+' '+artist+' '+album+' '+genre+' '+lyrics.slice(0,300)).toLowerCase();

  // 1) 한국 노래 vs 외국 노래 (국내/해외 구분)
  const hasHangul = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(t.title||'') || /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(t.artist||'') || /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(lyrics.slice(0,200));
  const isKpopGenre = /k.?pop|가요|한국|국내|트로트|아이돌|인디|발라드|korean/.test(genre);
  const korean = hasHangul || isKpopGenre;
  const foreign = !korean;

  // 2) 빠르기 / 템포 (Fast / Mid / Slow)
  let tempo = 'mid';
  const isFast = /dance|edm|house|techno|club|fast|rock|punk|metal|hype|speed|hyper|신나는|빠른|댄스|파티|질주|달리기|페스티벌|비트|일렉|파워/.test(text) || /dance|rock|electronic|edm|punk|metal/.test(genre);
  const isSlow = /ballad|lofi|lo-fi|slow|acoustic|piano|calm|chill|ambient|classical|sleep|발라드|잔잔|조용한|느린|수면|피아노|어쿠스틱|클래식|명상|자장가|위로/.test(text) || /ballad|classical|ambient|acoustic|lo-fi/.test(genre);
  if(isFast && !isSlow) tempo = 'fast';
  else if(isSlow && !isFast) tempo = 'slow';
  else tempo = 'mid';

  // 3) 분위기 / 무드
  const moods = [];
  if(/calm|chill|relax|acoustic|ballad|healing|warm|piano|잔잔|발라드|따뜻|힐링|위로|어쿠스틱|편안|감성/.test(text)) moods.push('calm');
  if(/energy|dance|party|summer|bright|upbeat|fresh|hype|power|신나는|활기|청량|여름|에너지|시원|파티|응원|질주/.test(text)) moods.push('energy');
  if(/study|focus|lofi|lo-fi|work|instrumental|coffee|cafe|독서|집중|공부|작업|연주|카페|배경음악/.test(text)) moods.push('focus');
  if(/night|dawn|midnight|deep|sentimental|dark|moon|새벽|밤|감성|센치|달|야간|어두운|쓸쓸/.test(text)) moods.push('night');
  if(/rain|snow|winter|cloud|storm|fog|비|빗소리|눈|겨울|흐림|장마|안개|우산/.test(text)) moods.push('weather_wet');
  if(/spring|autumn|breeze|sun|sunny|drive|walk|봄|가을|햇살|바람|드라이브|산책|소풍|여행/.test(text)) moods.push('weather_dry');
  if(/ost|soundtrack|cinematic|drama|movie|anime|드라마|영화|애니|게임|테마곡/.test(text)) moods.push('cinema');
  if(!moods.length) moods.push('calm');

  // 4) 가수의 특징 / 스타일
  const artistStyles = [];
  if(/iu|아이유|taeyeon|태연|heize|헤이즈|bol4|볼빨간|younha|윤하|yerin|백예린|taylor|swift|ariana|billie|newjeans|ive|aespa|le sserafim|twice|blackpink|female|여성|소녀|권진아|로제|지수|제니|조유리|이하이/.test(artist)) artistStyles.push('female_vocal');
  if(/성시경|박효신|이적|폴킴|임영웅|잔나비|10cm|김동률|sheeran|bruno|mars|bieber|charlie|puth|bts|seventeen|day6|nct|male|남성|소년|정국|지민|뷔|황민현|도경수|임한별/.test(artist)) artistStyles.push('male_vocal');
  if(/day6|잔나비|lucy|실리카겔|yb|넬|coldplay|imagine|dragons|maroon|queen|oasis|band|rock|밴드|락|밴드음악/.test(artist+' '+genre)) artistStyles.push('band');
  if(/지코|빈지노|창모|ph-1|기리보이|eminem|drake|post|malone|kendrick|rap|hiphop|힙합|랩|사이퍼/.test(artist+' '+genre)) artistStyles.push('hiphop');
  if(/yiruma|hisaishi|조성진|iruma|piano|instrumental|연주|피아노/.test(artist+' '+title)) artistStyles.push('instrumental');

  return {korean, foreign, tempo, moods, artistStyles};
}

function _recoFeatureSimilarity(a,b){
  if(!a||!b) return 0;
  const fa=_trackFeatures(a), fb=_trackFeatures(b);
  let n=0;
  if(fa.korean===fb.korean) n+=12;
  if(fa.tempo===fb.tempo) n+=22;
  const moods=fa.moods.filter(m=>fb.moods.includes(m));
  n+=Math.min(36,moods.length*14);
  const styles=fa.artistStyles.filter(x=>fb.artistStyles.includes(x));
  n+=Math.min(24,styles.length*12);
  const ga=String(a.genre||'').trim().toLowerCase(), gb=String(b.genre||'').trim().toLowerCase();
  if(ga&&gb&&ga===gb) n+=18;
  if(a.artist&&b.artist&&String(a.artist).trim()===String(b.artist).trim()) n+=16;
  return n;
}
function _recoFeatureKey(t){
  const ft=_trackFeatures(t);
  const mood=(ft.moods||[])[0]||'calm';
  return (ft.korean?'kr':'global')+'|'+ft.tempo+'|'+mood;
}
function _recoFeatureLabel(key){
  const [loc,tempo,mood]=String(key||'').split('|');
  const L={kr:'국내',global:'글로벌'}[loc]||'믹스';
  const T={fast:'빠른 템포',mid:'미드 템포',slow:'느린 템포'}[tempo]||'비슷한 템포';
  const M={calm:'잔잔한 감성',energy:'에너지',focus:'집중',night:'밤 감성',weather_wet:'비·눈 감성',weather_dry:'맑은 날',cinema:'OST·시네마'}[mood]||'비슷한 무드';
  return `${L} · ${T} · ${M}`;
}
function _recoClass(t){
  return _trackFeatures(t).moods;
}

function _recoTime(){
  const h=new Date().getHours();
  if(h<6) return {key:'night',label:'깊은 밤',keys:['calm','focus','night']};
  if(h<11) return {key:'morning',label:'아침',keys:['calm','energy','weather_dry']};
  if(h<17) return {key:'day',label:'낮',keys:['focus','energy','weather_dry']};
  if(h<22) return {key:'evening',label:'저녁',keys:['energy','cinema','calm']};
  return {key:'night',label:'밤',keys:['calm','night','cinema']};
}

function _recoWeather(){
  const w=P.weather||{}; const c=+w.code;
  if(c>=51&&c<=67 || c>=80&&c<=82) return {key:'rain',label:'비 오는 날',keys:['calm','weather_wet','cinema']};
  if(c>=71&&c<=77 || c>=85&&c<=86) return {key:'snow',label:'눈 내리는 날',keys:['calm','weather_wet','cinema']};
  if(c>=95) return {key:'storm',label:'흐림·비',keys:['calm','focus','weather_wet']};
  if(c>=45&&c<=48) return {key:'fog',label:'안개 자욱한 날',keys:['calm','focus']};
  return {key:'clear',label:w.temp!=null?((+w.temp).toFixed(0)+'° · 맑음'):'맑은 날',keys:['energy','weather_dry','focus']};
}

function _recoScore(t,mode,seed,curT){
  const ft=_trackFeatures(t), tm=_recoTime(), we=_recoWeather();
  let n=Math.log1p(_playCount(t))*9;

  if(mode==='korean'){
    if(ft.korean) n+=45; else n-=30;
  }else if(mode==='foreign'){
    if(ft.foreign) n+=45; else n-=30;
  }else if(mode==='fast'){
    if(ft.tempo==='fast') n+=48;
    else if(ft.tempo==='mid') n+=20;
    else n-=25;
    if(ft.moods.includes('energy')) n+=20;
  }else if(mode==='slow'){
    if(ft.tempo==='slow') n+=48;
    else if(ft.tempo==='mid') n+=18;
    else n-=25;
    if(ft.moods.includes('calm')) n+=20;
  }else if(mode==='focus'){
    if(ft.moods.includes('focus')) n+=45;
    if(ft.tempo==='slow'||ft.tempo==='mid') n+=15;
  }else if(mode==='energy'){
    if(ft.moods.includes('energy')) n+=45;
    if(ft.tempo==='fast') n+=20;
  }else if(mode==='night'){
    if(ft.moods.includes('night')||ft.moods.includes('calm')) n+=45;
    if(ft.tempo==='slow') n+=15;
  }else if(mode==='weather'){
    if(we.keys.some(k=>ft.moods.includes(k))) n+=40;
  }else if(mode==='artist'){
    if(curT){
      const curFt=_trackFeatures(curT);
      if(t.artist&&curT.artist&&t.artist===curT.artist) n+=65;
      if(ft.artistStyles.some(s=>curFt.artistStyles.includes(s))) n+=30;
      if(ft.korean===curFt.korean) n+=18;
      if(ft.tempo===curFt.tempo) n+=15;
      if(ft.moods.some(m=>curFt.moods.includes(m))) n+=15;
    }else{
      n+=30;
    }
  }else if(mode==='time'){
    if(tm.keys.some(k=>ft.moods.includes(k))) n+=35;
  }

  // 현재 재생곡이 있으면 모든 추천 모드에서 곡의 자동 특징(템포·무드·보컬 스타일)을
  // 살짝 반영한다. 그래서 같은 특성의 곡들이 한 묶음처럼 자연스럽게 모인다.
  if(curT&&t.id!==curT.id) n+=_recoFeatureSimilarity(t,curT)*0.38;

  if((t.artist||'').trim()) n+=4;
  if((t.cover_url||t.cover)) n+=3;
  if(t.has_sync||(t.lyrics&&String(t.lyrics).includes('['))) n+=3;

  n+=(_recoHash(String(seed)+'|'+t.id)%1000)/1000*16;
  return n;
}

function _recoTracks(list,mode,count,exclude){
  const curT=cur();
  const seed=new Date().toISOString().slice(0,10)+'|'+mode+'|'+(P.recoSeed||0);
  const ex=exclude||new Set();
  const sorted=(list||[]).filter(t=>!ex.has(t.id)).map(t=>[_recoScore(t,mode,seed,curT),t])
    .sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  const out=[], artists=new Set();
  for(const t of sorted){
    if(out.length>=count) break;
    const artKey=(t.artist||'').trim()||t.id;
    if(!artists.has(artKey)||out.length>=count-3){
      out.push(t);
      artists.add(artKey);
    }
  }
  return out;
}

function _recoAlbumScore(g,mode,seed,curT){
  const tracks=g.tracks||[];
  if(!tracks.length) return 0;
  const base=tracks.reduce((s,t)=>s+_recoScore(t,mode||'time',seed,curT),0)/tracks.length;
  let sim=0, pairs=0;
  for(let i=0;i<tracks.length&&i<8;i++){
    for(let j=i+1;j<tracks.length&&j<8;j++){
      sim+=_recoFeatureSimilarity(tracks[i],tracks[j]); pairs++;
    }
  }
  const cohesion=pairs?sim/pairs:0;
  const curBoost=curT?Math.max(...tracks.map(t=>_recoFeatureSimilarity(t,curT)))*0.55:0;
  const fullAlbum=Math.min(26,Math.log1p(tracks.length)*10);
  return base+cohesion*0.42+curBoost+fullAlbum+Math.log1p(g.plays||0)*3+(_recoHash(seed+'|album|'+g.key)%1000)/1000*10;
}
function _recoAlbums(list,count,mode='time'){
  const groups=new Map();
  (list||[]).forEach(t=>{
    const artist=(t.artist||'미분류').trim()||'미분류';
    const album=(t.album||'').trim();
    const key=artist+'|'+(album||'single:'+t.id);
    if(!groups.has(key)) groups.set(key,{key,artist,album:album||'싱글',tracks:[],plays:0,cover:t});
    const g=groups.get(key); g.tracks.push(t); g.plays+=_playCount(t);
    if((!g.cover.cover_url&&!g.cover.cover&&t.cover_url)||(!g.cover.cover&&t.cover)) g.cover=t;
  });
  const curT=cur();
  const seed=new Date().toISOString().slice(0,10)+'|album|'+(mode||'time')+'|'+(P.recoSeed||0);
  return [...groups.values()].filter(g=>g.tracks.length>1||g.album!=='싱글')
    .map(g=>({_score:_recoAlbumScore(g,mode,seed,curT),...g}))
    .sort((a,b)=>(b._score-a._score)||(b.tracks.length-a.tracks.length)||a.album.localeCompare(b.album,'ko'))
    .slice(0,count);
}
function _recoImg(t){ return t&&t.cover?(t.cover_url||('/api/music/cover/'+t.id+'?v='+(t.cover_v||1))):''; }
function _recoDataKey(s){ try{ return encodeURIComponent(String(s||'')); }catch(e){ return String(s||''); } }
function _recoCard(t){
  const src=_recoImg(t);
  return `<button class="mpb-reco-card" data-bl="${esc2(t.id)}" title="${esc2(t.title||'')}" aria-label="${esc2(t.title||'')} 재생">`+
    `<span class="mpb-reco-art">${src?`<img src="${src}" alt="" loading="lazy">`:'<i class="ri-music-2-fill"></i>'}<i class="mpb-reco-play ri-play-fill"></i></span>`+
    `<b>${esc2(t.title||'제목 없음')}</b><em>${esc2(t.artist||'가수 미상')}</em></button>`;
}
function _recoAlbumCard(g){
  const t=g.cover||g.tracks[0];
  return `<button class="mpb-album-card" data-reco-album="${_recoDataKey(g.key)}" title="${esc2(g.album)} 전체 재생">`+
    `<span class="mpb-album-art">${_recoImg(t)?`<img src="${_recoImg(t)}" alt="" loading="lazy">`:'<i class="ri-album-fill"></i>'}<i class="mpb-reco-play ri-play-fill"></i></span>`+
    `<b>${esc2(g.album)}</b><em>${esc2(g.artist)} · ${g.tracks.length}곡</em><small>대기열 교체</small></button>`;
}
function _recoPlaylistCard(g){
  const t=g.cover||g.tracks[0];
  return `<button class="mpb-album-card mpb-playlist-card" data-reco-playlist="${_recoDataKey(g.id)}" title="${esc2(g.name)} 전체 재생">`+
    `<span class="mpb-album-art">${_recoImg(t)?`<img src="${_recoImg(t)}" alt="" loading="lazy">`:'<i class="ri-play-list-2-fill"></i>'}<i class="mpb-reco-play ri-play-fill"></i></span>`+
    `<b>${esc2(g.name)}</b><em>${esc2(g.sub||'플레이리스트')} · ${g.tracks.length}곡</em><small>대기열 교체</small></button>`;
}
function _recoRow(title,sub,tracks,kind='track'){
  if(!tracks||!tracks.length) return '';
  const html=kind==='album'?tracks.map(_recoAlbumCard).join(''):
    kind==='playlist'?tracks.map(_recoPlaylistCard).join(''):tracks.map(_recoCard).join('');
  return `<section class="mpb-reco-section"><div class="mpb-reco-head"><b>${title}</b><span>${sub||''}</span></div><div class="mpb-reco-row">${html}</div></section>`;
}
function _recoAutoMixes(list,count,mode='time'){
  const groups=new Map();
  (list||[]).forEach(t=>{
    const key=_recoFeatureKey(t);
    if(!groups.has(key)) groups.set(key,{id:'auto:'+key,name:_recoFeatureLabel(key),sub:'자동 특징 믹스',tracks:[],cover:t,plays:0});
    const g=groups.get(key); g.tracks.push(t); g.plays+=_playCount(t);
    if((!g.cover.cover_url&&!g.cover.cover&&t.cover_url)||(!g.cover.cover&&t.cover)) g.cover=t;
  });
  const curT=cur(), seed=new Date().toISOString().slice(0,10)+'|mix|'+mode+'|'+(P.recoSeed||0);
  return [...groups.values()].filter(g=>g.tracks.length>=2)
    .map(g=>{
      const score=g.tracks.reduce((s,t)=>s+_recoScore(t,mode,seed,curT),0)/Math.max(1,g.tracks.length)
        +Math.min(30,g.tracks.length*3)+(_recoHash(seed+'|'+g.id)%1000)/1000*8;
      g.tracks=g.tracks.slice().sort((a,b)=>_recoScore(b,mode,seed,curT)-_recoScore(a,mode,seed,curT)).slice(0,36);
      return {_score:score,...g};
    })
    .sort((a,b)=>b._score-a._score)
    .slice(0,count);
}
function _recoPlaylists(list,count,mode='time'){
  const byId=new Map((list||[]).map(t=>[t.id,t]));
  const curT=cur(), seed=new Date().toISOString().slice(0,10)+'|playlist|'+mode+'|'+(P.recoSeed||0);
  const saved=(getPL()||[]).map(p=>{
    const tracks=(p.tracks||[]).map(id=>byId.get(id)).filter(Boolean);
    if(!tracks.length) return null;
    const score=tracks.reduce((s,t)=>s+_recoScore(t,mode,seed,curT),0)/tracks.length
      +Math.min(26,tracks.length*2)+(_recoHash(seed+'|'+p.id)%1000)/1000*8;
    return {id:'pl:'+p.id,name:p.name||'재생목록',sub:'저장한 재생목록',tracks,cover:tracks.find(_recoImg)||tracks[0],_score:score};
  }).filter(Boolean);
  return saved.concat(_recoAutoMixes(list,Math.max(1,count),mode))
    .sort((a,b)=>b._score-a._score)
    .slice(0,count);
}
function _rememberRecoCollections(albums,playlists){
  P._recoAlbumMap={}; P._recoPlaylistMap={};
  (albums||[]).forEach(g=>{ P._recoAlbumMap[_recoDataKey(g.key)]={name:g.album,tracks:(g.tracks||[]).map(t=>t.id)}; });
  (playlists||[]).forEach(g=>{ P._recoPlaylistMap[_recoDataKey(g.id)]={name:g.name,tracks:(g.tracks||[]).map(t=>t.id)}; });
}
function _queueRecoIds(ids,name){
  const seen=new Set();
  const q=(ids||[]).map(id=>(P.list||[]).find(t=>t.id===id)).filter(t=>t&&!seen.has(t.id)&&seen.add(t.id));
  if(!q.length){ toast('추천 목록의 곡을 찾을 수 없어요',1800); return; }
  P._forceNext='';
  playFrom(q,q[0].id,name||'추천 플레이리스트');
  try{ renderListPop(); }catch(e){}
  try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(e){}
  if(window.toast) toast('대기열을 비우고 ‘'+(name||'추천 플레이리스트')+'’만 담았어요',1900);
}
function _playRecoAlbum(key){
  const g=P._recoAlbumMap&&P._recoAlbumMap[key];
  if(g) _queueRecoIds(g.tracks,g.name);
}
function _playRecoPlaylist(key){
  const g=P._recoPlaylistMap&&P._recoPlaylistMap[key];
  if(g) _queueRecoIds(g.tracks,g.name);
}
try{ window.sdyQueueRecoAlbum=_playRecoAlbum; window.sdyQueueRecoPlaylist=_playRecoPlaylist; }catch(e){}
// ── 랜덤 믹스: 아무 곡이나 n곡을 뽑아 대기열을 통째로 갈아 끼우고 튼다 ──
function playRandomMix(n){
  const pool=(P.list||[]).slice();
  if(!pool.length){ toast('라이브러리가 비어 있어요',1600); return; }
  for(let i=pool.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; const tmp=pool[i]; pool[i]=pool[j]; pool[j]=tmp; }
  const q=pool.slice(0,Math.max(1,+n||20));
  P._forceNext='';
  playFrom(q,q[0].id,'랜덤 믹스');
  try{ renderListPop(); }catch(e){}
  try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(e){}
  if(window.toast) toast('랜덤으로 '+q.length+'곡을 대기열에 담았어요 🎲',1900);
}
try{ window.sdyPlayRandomMix=playRandomMix; }catch(e){}
// ── 서버 태그 추천 — 백엔드가 태그를 왕창 뽑아 묶어 준 결과(sims/groups)를 받아 온다.
//    태그 자체는 서버가 노출하지 않으므로 여기서도 묶음 이름·곡 목록만 쓴다.
let _recoFetchAt=0,_recoFetchBusy=false;
async function loadServerReco(force){
  if(_recoFetchBusy) return;
  const n=(P.list||[]).length;
  if(!n) return;
  if(!force&&P.reco&&P.reco._n===n&&Date.now()-_recoFetchAt<5*60*1000) return;
  _recoFetchBusy=true;
  try{
    const r=await fetch('/api/music/reco',{cache:'no-store'});
    const d=await r.json();
    if(r.ok&&d&&d.ok){
      P.reco={sims:d.sims||{},groups:d.groups||[],_n:n};
      _recoFetchAt=Date.now();
      try{ if(mpbEl&&mpbEl.classList.contains('open')&&P.bigTab==='d') renderDiscoverBig(); }catch(e){}
    }
  }catch(e){}
  _recoFetchBusy=false;
}
// 서버 그룹(id 목록) → 지금 목록의 곡 객체 묶음
function _serverRecoGroups(list){
  const byId=new Map((list||[]).map(t=>[t.id,t]));
  return ((P.reco&&P.reco.groups)||[]).map(g=>{
    const tracks=(g.ids||[]).map(id=>byId.get(id)).filter(Boolean);
    if(tracks.length<3) return null;
    return {id:'srv:'+g.id,name:g.name||'추천 믹스',sub:'태그 매칭 자동 믹스',tracks,
            cover:tracks.find(_recoImg)||tracks[0]};
  }).filter(Boolean);
}
// 현재 곡의 서버 유사곡 (없으면 빈 배열)
function _serverSimilar(curT,list,count){
  if(!curT||!P.reco||!P.reco.sims) return [];
  const ids=P.reco.sims[curT.id]||[];
  const byId=new Map((list||[]).map(t=>[t.id,t]));
  return ids.map(id=>byId.get(id)).filter(Boolean).slice(0,count||10);
}
function _recoMatch(t,mode){
  const ft=_trackFeatures(t), tm=_recoTime(), we=_recoWeather();
  if(mode==='korean') return ft.korean;
  if(mode==='foreign') return ft.foreign;
  if(mode==='fast') return ft.tempo==='fast'||ft.moods.includes('energy');
  if(mode==='slow') return ft.tempo==='slow'||ft.moods.includes('calm');
  if(mode==='focus') return ft.moods.includes('focus');
  if(mode==='energy') return ft.moods.includes('energy');
  if(mode==='night') return ft.moods.includes('night')||ft.moods.includes('calm');
  if(mode==='weather') return we.keys.some(k=>ft.moods.includes(k));
  if(mode==='time') return tm.keys.some(k=>ft.moods.includes(k));
  if(mode==='artist') return true;
  return true;
}
    function _recoGroups(list){
  const defs=[
    ['korean','한국 노래 🇰🇷','ri-flag-fill'],
    ['foreign','해외 팝 🌍','ri-earth-line'],
    ['fast','신나는 비트 ⚡','ri-flashlight-line'],
    ['slow','잔잔한 감성 ☕','ri-cup-line'],
    ['focus','집중·작업 🎧','ri-focus-3-line'],
    ['night','새벽 감성 🌙','ri-moon-line'],
    ['weather','날씨에 맞춰 ⛅','ri-cloudy-line'],
    ['artist','비슷한 감성 🎙️','ri-mic-line']
  ];
  const rows=defs.map(([k,label,icon])=>{
    const n=(list||[]).filter(t=>_recoMatch(t,k)).length;
    return {k,label,icon,n};
  });
  // 14.0 · 데스크톱에서 칩이 한 줄로 넘치지 않게, 새로고침마다 3개만 무작위로 보여 준다.
  const seed=String(P.recoSeed||0);
  const hash=s=>{ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; };
  const ranked=rows.slice().sort((a,b)=>{
    const da=hash(seed+'|'+a.k), db=hash(seed+'|'+b.k);
    if(a.k===P.recoFilter) return -1;
    if(b.k===P.recoFilter) return 1;
    if((b.n>0)-(a.n>0)) return (b.n>0)-(a.n>0);
    return da-db;
  });
  const pick=ranked.slice(0,3);
  return pick.map(r=>{
    const on=(P.recoFilter===r.k)?' on':'';
    return `<button class="mpb-group-chip${on}" data-reco-filter="${r.k}"><i class="${r.icon}"></i><span>${r.label}</span><em>${r.n}</em></button>`;
  }).join('');
}
function _recoWeatherText(){
  const w=P.weather, tm=_recoTime(), we=_recoWeather();
  return `${tm.label} · ${w&&w.label?esc2(w.label):we.label}`;
}
function renderDiscoverBig(){
  const body=$('mpBBody'); if(!body) return;
  body.classList.add('discover-mode'); body._html=null;
  const list=P.list||[], tm=_recoTime(), we=_recoWeather(), curT=cur();
  const filter=P.recoFilter||'all';
  P._recoAlbumMap={}; P._recoPlaylistMap={};
  try{ loadServerReco(); }catch(e){}            // 백엔드 태그 추천은 뒤에서 채워진다
  let content='';
  if(!list.length){
    content='<div class="mpb-reco-empty"><i class="ri-music-2-line"></i><b>라이브러리가 비어 있어요</b><span>＋ 올리기에서 음악을 추가해 보세요</span></div>';
  }else if(filter==='all'){
    // 맨 처음: 랜덤 20곡 믹스 — 누를 때마다 새로운 조합으로 대기열을 채운다
    const rndHero='<section class="mpb-reco-section"><button class="mpb-random-hero" data-reco-random="20">'
      +'<span class="mrh-ic"><i class="ri-dice-5-line"></i></span>'
      +'<span class="mrh-tx"><b>랜덤 믹스</b><em>아무 곡이나 20곡 · 누르면 대기열 교체 후 바로 재생</em></span>'
      +'<i class="ri-play-circle-fill mrh-play"></i></button></section>';
    const top=_recoTracks(list,'time',10,new Set());
    const seen=new Set(top.map(t=>t.id));
    const korean=_recoTracks(list,'korean',10,seen);
    korean.forEach(t=>seen.add(t.id));
    const foreign=_recoTracks(list,'foreign',10,seen);
    foreign.forEach(t=>seen.add(t.id));
    const fast=_recoTracks(list,'fast',10,seen);
    fast.forEach(t=>seen.add(t.id));
    const slow=_recoTracks(list,'slow',10,seen);
    slow.forEach(t=>seen.add(t.id));
    const weather=_recoTracks(list,'weather',10,seen);
    weather.forEach(t=>seen.add(t.id));
    // 현재 곡과 비슷한 곡 — 서버 태그 매칭이 있으면 그걸 먼저 쓴다
    let similar=null;
    if(curT){
      similar=_serverSimilar(curT,list,10);
      if(!similar.length) similar=_recoTracks(list,'artist',10,new Set([curT.id]));
    }
    const albums=_recoAlbums(list,8,'artist');
    const playlists=_recoPlaylists(list,8,'artist');
    _rememberRecoCollections(albums,playlists);
    // 백엔드가 태그로 묶어 준 '나를 위한 믹스' — 누르면 묶음 전체로 대기열 교체
    const srvGroups=_serverRecoGroups(list).slice(0,8);
    srvGroups.forEach(g=>{ P._recoPlaylistMap[_recoDataKey(g.id)]={name:g.name,tracks:g.tracks.map(t=>t.id)}; });
    const most=list.slice().sort((a,b)=>_playCount(b)-_playCount(a)).slice(0,10);

    content=rndHero
      +_recoRow('오늘의 맞춤 믹스',_recoWeatherText(),top)
      +_recoRow('나를 위한 추천 믹스 🎯','비슷한 곡끼리 자동으로 묶었어요 · 누르면 대기열 교체',srvGroups,'playlist')
      +(similar&&similar.length?_recoRow(`‘${esc2(curT.artist||curT.title)}’ 비슷한 감성`,'현재 재생 기반 큐레이션',similar):'')
      +(korean.length?_recoRow('한국 노래 베스트 🇰🇷','K-Pop · 발라드 · 인디',korean):'')
      +(foreign.length?_recoRow('해외 팝 & 글로벌 믹스 🌍','Billboard · Pop · Rock',foreign):'')
      +(fast.length?_recoRow('신나는 비트 & 드라이브 ⚡','빠른 템포 · 에너지',fast):'')
      +(slow.length?_recoRow('잔잔한 감성 & 힐링 ☕','어쿠스틱 · 편안한 휴식',slow):'')
      +_recoRow('날씨에 맞춰 ⛅',we.label,weather)
      +_recoRow('추천 앨범 💿','비슷한 특징으로 고른 앨범 · 누르면 대기열 교체',albums,'album')
      +_recoRow('추천 플레이리스트 📚','저장 목록 + 자동 특징 믹스 · 누르면 대기열 교체',playlists,'playlist')
      +_recoRow('가장 많이 들은 곡 🏆','모든 기기 누적 재생',most);
  }else if(filter==='korean'){
    content=_recoRow('한국 노래 컬렉션 🇰🇷','K-Pop · 가요 · 국내 명곡',_recoTracks(list,'korean',30,new Set()));
  }else if(filter==='foreign'){
    content=_recoRow('해외 팝 & 글로벌 트랙 🌍','Pop · R&B · Rock · 해외 명곡',_recoTracks(list,'foreign',30,new Set()));
  }else if(filter==='fast'){
    content=_recoRow('신나는 비트 & 에너지 ⚡','빠른 템포 · 댄스 · 락 · 드라이브',_recoTracks(list,'fast',30,new Set()));
  }else if(filter==='slow'){
    content=_recoRow('잔잔한 감성 & 힐링 ☕','느린 템포 · 어쿠스틱 · 발라드',_recoTracks(list,'slow',30,new Set()));
  }else if(filter==='focus'){
    content=_recoRow('집중 & 작업 모드 🎧','공부 · 독서 · Lo-Fi · 인스트루멘탈',_recoTracks(list,'focus',30,new Set()));
  }else if(filter==='night'){
    content=_recoRow('새벽 감성 & 깊은 밤 🌙','차분하고 센치한 무드',_recoTracks(list,'night',30,new Set()));
  }else if(filter==='weather'){
    content=_recoRow('실시간 날씨 큐레이션 ⛅',we.label,_recoTracks(list,'weather',30,new Set()));
  }else if(filter==='artist'){
    const sub=curT?`‘${esc2(curT.artist||curT.title)}’ 기반 맞춤`:'유사 스타일 추천';
    // 서버 태그 매칭 유사곡을 먼저 깔고, 모자라면 로컬 특징 추천으로 채운다
    const srvSim=_serverSimilar(curT,list,30);
    const ex=new Set((curT?[curT.id]:[]).concat(srvSim.map(t=>t.id)));
    const rest=_recoTracks(list,'artist',Math.max(0,30-srvSim.length),ex);
    content=_recoRow('비슷한 감성 & 아티스트 🎙️',sub,srvSim.concat(rest).slice(0,30));
  }
  if(list.length&&filter!=='all'){
    const albums=_recoAlbums(list,6,filter);
    const playlists=_recoPlaylists(list,6,filter);
    _rememberRecoCollections(albums,playlists);
    content+=_recoRow('이 추천에 맞는 앨범 💿','앨범 단위로 대기열 교체',albums,'album')
      +_recoRow('이 추천에 맞는 플레이리스트 📚','저장 목록 + 자동 특징 믹스',playlists,'playlist');
  }

  const current=curT?`<div class="mpb-reco-current"><div class="mpb-reco-current-art">${_recoImg(curT)?`<img src="${_recoImg(curT)}" alt="">`:'<i class="ri-music-2-fill"></i>'}</div><div><small>지금 재생 중</small><b>${esc2(curT.title||'')}</b><span>${esc2(curT.artist||'')}</span></div><button data-bl="${esc2(curT.id)}" title="다시 재생"><i class="ri-play-fill"></i></button></div>`:'';
  body.innerHTML=`<div class="mpb-reco-top"><div><small>SDYnotes MUSIC</small><h2>오늘의 맞춤 라이브러리</h2><p>${esc2(_recoWeatherText())} · ${list.length.toLocaleString()}곡</p></div><button class="mpb-reco-refresh" data-reco-refresh title="추천 새로고침"><i class="ri-refresh-line"></i></button></div>`+
    current+`<div class="mpb-group-row"><button class="mpb-group-chip${filter==='all'?' on':''}" data-reco-filter="all"><i class="ri-apps-2-line"></i><span>전체</span><em>${list.length.toLocaleString()}</em></button>${_recoGroups(list)}</div>`+content;
  body.querySelectorAll('.mpb-reco-art img,.mpb-album-art img,.mpb-reco-current-art img').forEach(im=>im.addEventListener('error',()=>{im.style.opacity='.12';},{once:true}));
  if(!P.weather || Date.now()-(P.weather.updatedAt||0)>30*60*1000) loadRecoWeather();
}
async function loadRecoWeather(force=false){
  if(!force&&P.weather&&Date.now()-(P.weather.updatedAt||0)<30*60*1000) return;
  let pos={latitude:37.785,longitude:127.045,label:'양주'};
  try{
    if(navigator.geolocation){
      const got=await new Promise(resolve=>navigator.geolocation.getCurrentPosition(resolve,()=>resolve(null),{timeout:1800,maximumAge:3600000}));
      if(got&&got.coords) pos={latitude:got.coords.latitude,longitude:got.coords.longitude,label:'현재 위치'};
    }
  }catch(e){}
  try{
    const u='https://api.open-meteo.com/v1/forecast?latitude='+pos.latitude+'&longitude='+pos.longitude+'&current=temperature_2m,weather_code,is_day&timezone=auto';
    const d=await (await fetch(u,{cache:'no-store'})).json(), c=d.current||{};
    P.weather={code:c.weather_code,temp:c.temperature_2m,isDay:c.is_day,label:pos.label,updatedAt:Date.now()};
    try{localStorage.setItem('sdy_music_weather',JSON.stringify(P.weather));}catch(e){}
    if($('mpBig')&&$('mpBig').classList.contains('open')&&P.bigTab==='d') renderDiscoverBig();
  }catch(e){ P.weather=P.weather||{code:0,label:'',updatedAt:Date.now()}; }
}
try{ P.weather=JSON.parse(localStorage.getItem('sdy_music_weather')||'null'); }catch(e){ P.weather=null; }

function renderBigList(){
  const body=$('mpBBody'); if(!body) return;
  // 11.2 · 목록을 다시 그려도 보던 자리를 지킨다.
  //   (곡을 고르면 목록이 맨 위로 튀어 올라가던 문제)
  const _viewKey=P.bigTab+'|'+(P.bigPage||0)+'|'+((P.bq||'').trim());
  const _keep=(body._vkey===_viewKey)?body.scrollTop:0;
  body._vkey=_viewKey;
  const tabD=$('mpBTabD'); if(tabD) tabD.classList.toggle('on',P.bigTab==='d');
  $('mpBTabQ').classList.toggle('on',P.bigTab==='q');
  $('mpBTabA').classList.toggle('on',P.bigTab==='a');
  $('mpBTabL').classList.toggle('on',P.bigTab==='l');
  const yTab=$('mpBTabY'); if(yTab) yTab.classList.toggle('on',P.bigTab==='y');
  if(P.bigTab && P.bigTab!=='y') P._listTab=P.bigTab;
  try{ mpbDrawerBtns(); }catch(e){}
  body.classList.toggle('lyrmode',P.bigTab==='y');   // 10.6 · 가사 모드: 세로 플렉스
  body.classList.toggle('discover-mode',P.bigTab==='d');
  const pagerEl=$('mpBPager');
  if(pagerEl) pagerEl.style.display='none';           // 추천/가사 탭엔 이전/다음 없음
  const curId=cur()&&cur().id;
  if(P.bigTab==='d'){
    const sb=$('mpBSearchBar');
    if(sb&&sb.classList.contains('show')){ sb.classList.remove('show'); const fb=$('mpBFind'); if(fb) fb.classList.remove('on'); P.bq=''; }
    renderDiscoverBig(); return;
  }
  if(P.bigTab==='y'){
    // 가사 화면에서는 검색칸을 접어 둔다
    const sb=$('mpBSearchBar');
    if(sb&&sb.classList.contains('show')){
      sb.classList.remove('show'); const fb=$('mpBFind'); if(fb) fb.classList.remove('on');
      P.bq=''; const si=$('mpBSearch'); if(si) si.value='';
    }
    renderLyrics(); return;
  }
  // 11.3 · 행 HTML에는 '지금 재생 중' 표시를 넣지 않는다.
  //   → 곡을 골라도 목록 HTML이 그대로라 다시 그리지 않고, 스크롤 위치가
  //     1px도 움직이지 않는다. 표시는 markNowPlaying() 이 클래스만 바꾼다.
  const row=(t,attr)=>`<div class="mpb-li" data-tid="${t.id}" ${attr}>`+
    `<span><span class="nowic mp-eqbars" style="display:none;margin-right:6px"><i></i><i></i><i></i></span>${esc2(t.title)}</span>`+
    (t.artist?`<em>${esc2(t.artist)}</em>`:'')+
    (t.album?`<em style="max-width:150px">${esc2(t.album)}</em>`:'')+`</div>`;
  // 10.9 · 확장 플레이어 안 검색 — 검색어가 있으면 어떤 탭이든 결과를 보여 준다
  const bq=(P.bq||'').trim().toLowerCase();
  if(bq){
    const hits=searchTracks(P.list,P.bq);
    const perS=14;
    const pagesS=Math.max(1,Math.ceil(hits.length/perS));
    P.bigPage=Math.max(0,Math.min(P.bigPage||0,pagesS-1));
    const st=P.bigPage*perS;
    _paintBigList(body,hits.slice(st,st+perS).map(t=>row(t,'data-bl="'+t.id+'"')).join('')
      ||'<div class="mpb-empty">‘'+esc2(P.bq)+'’ 과(와) 맞는 곡이 없어요</div>',_keep);
    const pg=$('mpBPager'), pi=$('mpBPgInfo'), pj=$('mpBPgJump');
    if(pi) pi.textContent=hits.length+'곡 찾음'+(pagesS>1?` · ${P.bigPage+1}/${pagesS}`:'');
    if(pj){ pj.max=pagesS; pj.value=(P.bigPage||0)+1; }
    if(pg){ pg.style.display=pagesS>1?'flex':'none';
      const pv0=$('mpBPgPrev'), nx0=$('mpBPgNext');
      if(pv0) pv0.disabled=(P.bigPage<=0);
      if(nx0) nx0.disabled=(P.bigPage>=pagesS-1); }
    return;
  }
  // 10.3 · 목록이 길면 페이지로 넘긴다 (무한 스크롤 제거)
  const per=(P.bigTab==='a')?4:14;
  let total=0, start=0, html='';
  const pager=$('mpBPager'), pinfo=$('mpBPgInfo');
  if(P.bigTab==='q'){
    const L=curList(); total=L.length;
    const pages=Math.max(1,Math.ceil(total/per));
    P.bigPage=Math.max(0,Math.min(P.bigPage||0,pages-1));
    start=P.bigPage*per;
    const curId2=cur()&&cur().id;
    // 18.3 · 대기열 행에는 관리 버튼(위로·아래로·다음에 재생·빼기)을 붙인다
    const qrow=(t,k,abs)=>`<div class="mpb-li mpb-li-q" data-tid="${t.id}" data-bq="${abs}">`+
      `<span><span class="nowic mp-eqbars" style="display:none;margin-right:6px"><i></i><i></i><i></i></span>${esc2(t.title)}</span>`+
      (t.artist?`<em>${esc2(t.artist)}</em>`:'')+
      (t.album?`<em style="max-width:150px">${esc2(t.album)}</em>`:'')+
      `<span class="mpb-qops">`+
        `<button class="mpb-qop" data-qop="up" data-bqidx="${abs}" title="위로" aria-label="위로"><i class="ri-arrow-up-line"></i></button>`+
        `<button class="mpb-qop" data-qop="down" data-bqidx="${abs}" title="아래로" aria-label="아래로"><i class="ri-arrow-down-line"></i></button>`+
        `<button class="mpb-qop" data-qop="next" data-bqidx="${abs}" title="다음에 재생" aria-label="다음에 재생"><i class="ri-skip-forward-line"></i></button>`+
        `<button class="mpb-qop del" data-qop="del" data-bqidx="${abs}" title="대기열에서 빼기" aria-label="대기열에서 빼기"><i class="ri-close-line"></i></button>`+
      `</span></div>`;
    html=(total?`<div class="mpb-qhead"><span>${total}곡 대기 중${curId2?' · '+esc2(curId2):''}</span><button class="mpb-qclear" data-qclear="1"><i class="ri-delete-bin-6-line"></i> 전체 비우기</button></div>`:'')
      +L.slice(start,start+per).map((t,k)=>qrow(t,k,start+k)).join('')
      ||_emptyBox('q');
    if(pinfo) pinfo.textContent=total+'곡'+(pages>1?` · ${P.bigPage+1}/${pages}`:'');
  }else if(P.bigTab==='a'){
    // 현재 곡의 가수명을 누른 경우에는 그 가수의 곡만 보인다. 가수별 탭을
    // 직접 누르면(bigArtist를 비우면) 전체 가수 목록으로 돌아간다.
    const allGroups=bucketArtists(P.list);
    const gs=P.bigArtist ? allGroups.filter(g=>g.name===P.bigArtist) : allGroups;
    total=gs.length;
    const pages=Math.max(1,Math.ceil(total/per));
    P.bigPage=Math.max(0,Math.min(P.bigPage||0,pages-1));
    start=P.bigPage*per;
    html=gs.slice(start,start+per).map(g=>
      `<div class="mpb-artgrp"><i class="ri-user-3-fill"></i>${esc2(g.name)}<em>${g.tracks.length}곡</em></div>`+
      g.tracks.map(t=>row(t,'data-bl="'+t.id+'"')).join('')).join('')
      ||_emptyBox('a');
    if(pinfo) pinfo.textContent=total+'명'+(pages>1?` · ${P.bigPage+1}/${pages}`:'');
  }else{
    const list=filtered(); total=list.length;
    const pages=Math.max(1,Math.ceil(total/per));
    P.bigPage=Math.max(0,Math.min(P.bigPage||0,pages-1));
    start=P.bigPage*per;
    html=list.slice(start,start+per).map(t=>row(t,'data-bl="'+t.id+'"')).join('')
      ||_emptyBox('l');
    if(pinfo) pinfo.textContent=total+'곡'+(pages>1?` · ${P.bigPage+1}/${pages}`:'');
  }
  _paintBigList(body,html,_keep);
  if(pager){
    const pages=Math.max(1,Math.ceil(total/per));
    pager.style.display=pages>1?'flex':'none';
    const pj=$('mpBPgJump');
    if(pj){ pj.max=pages; pj.value=(P.bigPage||0)+1; }
    const pv=$('mpBPgPrev'), nx=$('mpBPgNext');
    if(pv) pv.disabled=(P.bigPage<=0);
    if(nx) nx.disabled=(P.bigPage>=pages-1);
  }
}
function _emptyBox(where){
  // 11.4 · 노래가 하나도 없을 때: 그냥 비워 두지 않고 상태와 복구 버튼을 보여 준다
  if(P.loading) return '<div class="mp-emptybox"><b>목록을 불러오는 중…</b></div>';
  if(P.listDirty) return '<div class="mp-emptybox"><b>목록을 받지 못했어요</b>'+
      '서버가 바쁘거나 잠시 끊겼을 수 있어요.'+
      '<br><button onclick="sdyRefreshMusic(true)"><i class="ri-refresh-line"></i> 다시 불러오기</button>'+
      '<div class="sub">잠시 뒤 자동으로도 다시 시도합니다</div></div>';
  return '<div class="mp-emptybox"><b>노래가 없습니다</b>'+
      (where==='q'?'대기열이 비어 있어요 · 전체 곡에서 골라 담아보세요'
                  :'＋ 올리기로 추가하거나, 서버에서 목록을 다시 받아 보세요')+
      '<br><button onclick="sdyRefreshMusic(true)"><i class="ri-refresh-line"></i> 목록 새로고침</button>'+
      '<div class="sub">서버에 파일이 남아 있으면 그대로 되살립니다</div></div>';
}
// 11.3 · 내용이 그대로면 DOM을 건드리지 않는다 (스크롤·터치가 끊기지 않게)
function _paintBigList(body,html,keep){
  if(body._html!==html){
    body._html=html;
    body.innerHTML=html;
    body.scrollTop=keep;
  }
  markNowPlaying();
}
function markNowPlaying(){
  const body=$('mpBBody'); if(!body||P.bigTab==='y') return;
  const t=cur(), id=t&&t.id;
  body.querySelectorAll('.mpb-li').forEach(el=>{
    const on=(el.dataset.tid===id);
    if(el.classList.contains('on')!==on) el.classList.toggle('on',on);
    const ic=el.querySelector('.nowic');
    if(ic){ const want=on?'':'none'; if(ic.style.display!==want) ic.style.display=want; }
  });
}
$('mpBBody').addEventListener('click',e=>{
  e.stopPropagation();
  const rf=e.target.closest('[data-reco-filter]');
  if(rf){ P.recoFilter=rf.dataset.recoFilter||'all'; if(P.bigTab!=='d') P.bigTab='d'; renderBigList(); return; }
  if(e.target.closest('[data-reco-refresh]')){
    const rfBtn=e.target.closest('[data-reco-refresh]');
    if(rfBtn){ rfBtn.classList.add('spin'); setTimeout(()=>{ try{ rfBtn.classList.remove('spin'); }catch(err){} },500); }
    P.recoSeed=Date.now();
    if(!P.weather||Date.now()-(P.weather.updatedAt||0)>20*60*1000) loadRecoWeather(false);
    renderDiscoverBig();
    return;
  }
  // 추천 앨범/플레이리스트는 한 곡이 아니라 묶음 전체를 재생한다.
  // 사용자가 고른 추천 묶음이 '현재 대기열의 전부'가 되도록 기존 queue를 교체한다.
  const recoRandom=e.target.closest('[data-reco-random]');
  if(recoRandom){ e.preventDefault(); e.stopPropagation(); playRandomMix(+recoRandom.dataset.recoRandom||20); return; }
  const recoAlbum=e.target.closest('[data-reco-album]');
  if(recoAlbum){ e.preventDefault(); e.stopPropagation(); _playRecoAlbum(recoAlbum.dataset.recoAlbum); return; }
  const recoPlaylist=e.target.closest('[data-reco-playlist]');
  if(recoPlaylist){ e.preventDefault(); e.stopPropagation(); _playRecoPlaylist(recoPlaylist.dataset.recoPlaylist); return; }
  // 18.3 · 대기열 관리 버튼(위로/아래로/다음에 재생/빼기)과 전체 비우기가 먼저
  const qop=e.target.closest('[data-qop]');
  if(qop&&qop.dataset.bqidx!=null){
    e.preventDefault(); e.stopPropagation();
    const i=+qop.dataset.bqidx, op=qop.dataset.qop;
    if(op==='up') queueMove(i,-1);
    else if(op==='down') queueMove(i,1);
    else if(op==='del') queueRemove(i);
    else if(op==='next'){
      const q=curList(); const t=q&&q[i];
      if(t) queueNext(t.id);
    }
    return;
  }
  if(e.target.closest('[data-qclear]')){
    queueClear(); return;
  }
  const el=e.target.closest('[data-bq],[data-bl]'); if(!el) return;
  // 대기열 탭에서 고른 곡: 대기열은 그대로, 그 자리만 재생
  if(el.dataset.bq!=null){ playIdx(+el.dataset.bq); return; }
  const id=el.dataset.bl;
  // 18.3 · 곡을 누르면 '보이는 순서'로 대기열을 갈아끼우지 않고
  //   그 곡을 대기열에 담아 바로 재생한다 (다음 곡 = 진짜 대기열 순서)
  queueAdd(id);
});
// 지금 확장 플레이어 목록에 '보이는' 곡들을 화면 순서 그대로 돌려준다
function _bigVisibleTracks(id){
  const bq=(P.bq||'').trim();
  if(bq) return searchTracks(P.list,P.bq);
  if(P.bigTab==='a'){
    const t0=(P.list||[]).find(t=>t.id===id);
    const aName=(t0&&t0.artist&&String(t0.artist).trim())||'미분류';
    const g=bucketArtists(P.list).find(x=>x.name===aName);
    if(g) return g.tracks;
  }
  if(P.bigTab==='d'){                      // 추천 화면은 라이브러리 정렬 순서로
    return filtered();
  }
  return filtered();
}

// ── 큰 플레이어 진행바 ──
// 17.4 · 아래 컨트롤 바와 똑같이 잡아서 옮긴다: 손가락/마우스가 막대를 벗어나
//   옆으로 움직여도(포인터 캡처가 풀려도) 창(window) 단위 추적으로 놓치지
//   않는다. 빠른 두 번 잡기가 더블클릭으로 번져 전체 화면이 풀리지도 않게
//   한다(전체화면 dblclick 제외 목록에 .mpb-prog 추가).
(function(){
  const bar=$('mpBProg'); if(!bar) return;
  // 시간(현재 | 전체)은 재생 위치를 잡는 동안에만 보여 준다.
  let hideT=null;
  const showTime=()=>{ const el=$('mpBTime'); if(!el) return;
    clearTimeout(hideT); el.classList.add('show'); };
  const hideTime=(delay)=>{ const el=$('mpBTime'); if(!el) return;
    clearTimeout(hideT); hideT=setTimeout(()=>el.classList.remove('show'),delay==null?900:delay); };
  const at=cx=>{ const r=bar.getBoundingClientRect();
    return Math.max(0,Math.min(1,(cx-r.left)/r.width))*(A.duration||0); };
  const down=e=>{
    if(!A.duration) return;
    e.preventDefault();
    const cx=e.touches?e.touches[0].clientX:e.clientX;
    _seek=at(cx); _seekOwner='big'; bar.classList.add('seeking'); showTime(); paintProg(_seek);
    bar.setPointerCapture&&e.pointerId!=null&&bar.setPointerCapture(e.pointerId);
  };
  const move=e=>{
    if(_seek==null||_seekOwner!=='big') return;
    e.preventDefault();
    const cx=e.touches?e.touches[0].clientX:e.clientX;
    _seek=at(cx); showTime(); paintProg(_seek);
  };
  const up=()=>{ if(_seek==null||_seekOwner!=='big') return;
    A.currentTime=_seek; _seek=null; _seekOwner=''; bar.classList.remove('seeking'); paintProg(); hideTime(); };
  bar.addEventListener('pointerdown',down);
  addEventListener('pointermove',move);
  addEventListener('pointerup',up);
  addEventListener('pointercancel',up);
  bar.addEventListener('touchstart',down,{passive:false});
  addEventListener('touchmove',move,{passive:false});
  addEventListener('touchend',up);
  // 마우스를 올려 가늠할 때는 잠깐 보여 주지 않음 — 위치 잡을 때만 표시
})();

// ── 버튼 연결 ──
$('mpExpand').onclick=e=>{ e.stopPropagation(); openBig(); };
$('mpBX').onclick=closeBig;
$('mpBCwrap').onclick=()=>{ const t=cur(); if(t) openTrackMenu(innerWidth/2,120,t.id); };
$('mpBArtist').onclick=()=>{ const t=cur(); if(t){
  // '이 가수의 곡 보기'는 가수별 목록 전체가 아니라 현재 가수만 보여 준다.
  P.bigTab='a'; P.bigPage=0; P.bigArtist=(t.artist||'').trim();
  if(mpbEl.classList.contains('open')) renderBigList();
} };
$('mpBPP').onclick=pp;
$('mpBPrev').onclick=()=>playPrev();
$('mpBNext').onclick=()=>playNext(false);
$('mpBShuf').onclick=()=>{ try{$('mpShuf').click();}catch(e){} };
$('mpBRep').onclick=()=>{ try{$('mpRep').click();}catch(e){} };
$('mpBRate').onclick=()=>{ try{$('mpRate').click();}catch(e){} };
$('mpBUp').onclick=e=>{ e.stopPropagation(); openAddPop($('mpBUp')); };
// ═════════ 12.0 · 노래 추가 팝업 (파일 or 유튜브 링크 → mp3 320kbps) ═════════
function openAddPop(anchor){
  const pop=$('mpAddPop'); if(!pop||!anchor) return;
  if(pop.classList.contains('show')&&pop._anchor===anchor){ closeAddPop(); return; }
  pop.classList.add('show'); pop._anchor=anchor;
  const r=anchor.getBoundingClientRect();
  let left=Math.max(8,Math.min(r.right-pop.offsetWidth, innerWidth-pop.offsetWidth-8));
  let top=r.bottom+8;
  if(top+pop.offsetHeight>innerHeight-8) top=Math.max(8, r.top-pop.offsetHeight-8);
  pop.style.left=left+'px'; pop.style.top=top+'px';
  refreshYtReady();
  setTimeout(()=>{ try{$('mpYtInput').focus();}catch(e){} },60);
}
// 12.5 · 준비 상태(쿠키/도구)를 동그라미 체크 + 카드로 예쁘게 표시
function setYtReady(state, msg){
  const dot=$('mpReadyDot'), card=$('mpYtCard'), ic=$('mpYtCheck'), t=$('mpYtHint'), up=$('mpYtCookies'), del=$('mpYtCookiesDel');
  if(!dot||!card) return;
  dot.className='ready '+(state==='ok'?'ok':state==='no'?'no':'');
  ic.className='ytcheck '+(state==='ok'?'ok':state==='no'?'no':'');
  ic.innerHTML = state==='ok'?'<i class="ri-check-line"></i>'
    : state==='no'?'<i class="ri-alert-line"></i>'
    : '<i class="ri-loader-4-line mp-spin"></i>';
  if(t) t.innerHTML=msg||'';
  const admin=isAdm();
  if(up){
    up.textContent = state==='ok'?'다시 올리기':'쿠키 업로드';
    up.classList.toggle('ok', state==='ok');
    up.style.display = admin?'inline-block':'none';
  }
  if(del){ del.style.display = (admin&&state==='ok')?'inline-flex':'none'; }
  card.classList.toggle('has', state==='ok');
}
async function refreshYtReady(){
  setYtReady('load','확인 중…');
  try{
    const st=await (await fetch('/api/music/youtube/status',{cache:'no-store'})).json();
    _ytReady=!!st.ok; _ytHasCookie=!!(st.cookies&&st.cookies_valid);
    if(!st.ok){
      setYtReady('no','<b>준비 안 됨</b><br>서버에 yt-dlp 가 없어요 (apply.sh 재실행)');
    }else if(st.cookies && !st.cookies_valid){
      setYtReady('no','<b>쿠키 파일이 이상해요</b><br>다시 내보내 올리세요 (youtube.com 전체 쿠키)');
    }else if(st.cookies){
      // deno/PO토큰까지 있으면 클라우드 IP도 잘 뚫림
      setYtReady('ok','<b>준비됨</b><br>쿠키 등록됨'+(st.pot?' · 봇검사 우회 켜짐':'')+' · 링크를 붙여넣으세요');
    }else if(isAdm()){
      setYtReady('no','<b>쿠키가 필요해요</b><br>확장 <b>Get cookies.txt LOCALLY</b>로 youtube.com 쿠키를 내보내 올리세요');
    }else{
      setYtReady('no','<b>관리자 설정 필요</b><br>관리자가 유튜브 쿠키를 등록해야 해요');
    }
  }catch(e){
    setYtReady('no','<b>서버 연결 실패</b>');
  }
}
function closeAddPop(){ const p=$('mpAddPop'); if(p){ p.classList.remove('show'); p._anchor=null; } }
$('mpAddX').onclick=closeAddPop;
$('mpAddFile').onclick=()=>{ closeAddPop(); $('musicFile').click(); };
// 12.0 · 유튜브 쿠키 업로드 (봇 차단 해제)
$('mpYtCookies').onclick=()=>$('mpYtCookiesFile').click();
$('mpYtCookiesDel').onclick=async()=>{
  try{
    const r=await fetch('/api/music/youtube/cookies',{method:'DELETE',
      headers:{'Authorization':'Bearer '+admTok()}});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.ok){ _ytHasCookie=false; refreshYtReady(); if(window.toast)toast('쿠키를 지웠습니다',1600); }
    else if(window.toast)toast(d.error||'쿠키 삭제 실패',2200);
  }catch(e){ if(window.toast)toast('쿠키 삭제 실패',2000); }
};
$('mpYtCookiesFile').onchange=async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value='';
  if(!f) return;
  const fd=new FormData(); fd.append('file',f);
  try{
    setYtReady('load','쿠키 올리는 중…');
    const r=await fetch('/api/music/youtube/cookies',{method:'POST',
      headers:{'Authorization':'Bearer '+admTok()},body:fd});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.ok){ _ytHasCookie=true; refreshYtReady(); if(window.toast)toast('쿠키 등록 완료 ✓',2200); }
    else{ refreshYtReady(); if(window.toast)toast(d.error||'쿠키 업로드 실패',2800); }
  }catch(err){ refreshYtReady(); if(window.toast)toast('쿠키 업로드 실패',2000); }
};
// 12.2 · add 팝업 바깥을 눌러 닫을 때, 드래그(텍스트 선택) 중이면
//   닫지 않는다. 편집창에서 글자를 끌어 선택하다 마우스를 창 밖에서 놓으면
//   창이 꺼지던 문제 해결.
let _addDragOff=false;
document.addEventListener('pointerdown',e=>{
  const p=$('mpAddPop');
  if(p&&p.classList.contains('show')){
    _addDragOff=e.button===0;
  } else _addDragOff=false;
  setTimeout(()=>{ _addDragOff=false; },0);
},true);
document.addEventListener('pointerup',e=>{
  const p=$('mpAddPop');
  if(!p||!p.classList.contains('show')) return;
  if(_addDragOff && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||
     window.getSelection&&String(window.getSelection()).length)){
    _addDragOff=false; return;
  }
  _addDragOff=false;
  if(!e.target.closest('#mpAddPop')&&!e.target.closest('#mpUp,#mpBUp'))
    closeAddPop();
},true);
// ════════ 12.5 · 유튜브 링크 큐 (병렬 2개 + 진행 게이지바) ════════
let _ytJobs=[], _ytRun=0;
const _YT_PAR=2;                  // 동시에 2개씩 받는다
let _ytHasCookie=null, _ytReady=null;
function _ytTitleOf(u){
  try{ const x=new URL(u); const v=x.searchParams.get('v'); return v?('youtube.com/...'+v.slice(-4)):x.hostname; }
  catch(e){ return String(u).slice(0,30); }
}
function renderYtQueue(){
  const box=$('mpYtStatus'), list=$('mpYtList'), fill=$('mpYtFill'), prog=$('mpYtProg'), cur=$('mpYtCur');
  if(!_ytJobs.length){ box.style.display='none'; list.innerHTML=''; return; }
  box.style.display='flex';
  const total=_ytJobs.length;
  const done=_ytJobs.filter(j=>j.status==='ok'||j.status==='fail').length;
  const run=_ytJobs.filter(j=>j.status==='run').length;
  fill.style.width=(total?Math.round(done/total*100):0)+'%';
  prog.textContent=done+'/'+total+(run?(' · 진행 '+run):'');
  const running=_ytJobs.find(j=>j.status==='run');
  cur.textContent=running?('받는 중: '+_ytTitleOf(running.url)):'';
  list.innerHTML='';
  for(const j of _ytJobs){
    const d=document.createElement('div');
    d.className='qitem '+(j.status||'');
    const ico = j.status==='ok'?'<i class="ri-check-line"></i>'
      : j.status==='fail'?'<i class="ri-close-line"></i>'
      : j.status==='run'?'<i class="ri-loader-4-line mp-spin"></i>'
      : '<i class="ri-time-line"></i>';
    let label=_ytTitleOf(j.url);
    if(j.status==='ok'&&j.title) label=j.title;
    if(j.status==='fail'&&j.error) label+=' — '+j.error;
    d.innerHTML='<span class="qi">'+ico+'</span><span class="qt">'+esc2(label)+'</span>';
    list.appendChild(d);
  }
}
async function _ytRunOne(j){
  j.status='run'; renderYtQueue();
  try{
    const r=await fetch('/api/music/youtube',{method:'POST',
      headers:Object.assign({'Content-Type':'application/json'},window.sdyAuthHeaders?window.sdyAuthHeaders():{}),
      body:JSON.stringify({url:j.url})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok) throw new Error(d.error||('오류 '+r.status));
    j.status='ok'; j.title=String(d.title||'').slice(0,60); j.id=d.id;
  }catch(err){
    j.status='fail'; j.error=(err.message||'실패').slice(0,80);
  }
  renderYtQueue();
}
async function _ytPump(){
  if(_ytRun>=_YT_PAR) return;
  _ytRun++;
  try{
    let firstOk=null;
    while(true){
      const j=_ytJobs.find(x=>x.status==='wait');
      if(!j) break;
      await _ytRunOne(j);
      if(j.status==='ok'&&!firstOk) firstOk=j;
    }
    if(_ytJobs.length&&_ytJobs.every(x=>x.status==='ok'||x.status==='fail')){
      await loadList({quiet:true});
      const ok=_ytJobs.filter(x=>x.status==='ok').length;
      const fail=_ytJobs.filter(x=>x.status==='fail').length;
      if(firstOk){
        const i=P.list.findIndex(t=>t.id===firstOk.id);
        if(i>=0){ if(!P.plMode&&!P.artMode)P.lpage=Math.max(0,Math.floor(i/PER));
          renderTitle();renderListPop();
          // 방금 받은 그 곡을 바로 튼다 (대기열이 있어도 첫 곡이 아니라 이 곡)
          if(playNewTrack(firstOk.id)) gotoTrackPage(firstOk.id); }
      }
      const errs=_ytJobs.filter(x=>x.status==='fail').map(x=>x.error);
      if(ok&&!fail) toast(ok+'곡 추가 완료 🎵',2200);
      else if(ok&&fail) toast(ok+'곡 완료 · '+fail+'곡 실패',3200);
      else toast('실패: '+(errs[0]||'') ,3800);
      // 결과를 3초 보여주고 정리
      setTimeout(()=>{ if(!_ytJobs.some(x=>x.status==='wait'||x.status==='run')){ _ytJobs=[]; renderYtQueue(); } },3500);
    }
  } finally { _ytRun--; }
}
function pushYtLinks(){
  const raw=$('mpYtInput').value.trim();
  if(!raw) return;
  const urls=raw.split(/[\s]+/).filter(t=>/^https?:\/\//i.test(t));
  if(!urls.length){ toast('http(s):// 링크를 넣어 주세요',2000); return; }
  if(_ytReady===false){ toast('서버에 yt-dlp/ffmpeg 가 없어요',3000); return; }
  if(!_ytHasCookie){
    toast(isAdm()?'먼저 쿠키를 올려 주세요':'관리자가 쿠키를 등록해야 해요',2600);
    refreshYtReady(); return;
  }
  $('mpYtInput').value='';
  for(const u of urls) _ytJobs.push({url:u,status:'wait'});
  renderYtQueue();
  // 병렬로 두 개 띄운다
  _ytPump(); _ytPump();
}
$('mpYtGo').onclick=pushYtLinks;
$('mpYtInput').onkeydown=e=>{
  e.stopPropagation();
  if(e.key==='Enter'){ e.preventDefault(); pushYtLinks(); }
};
$('mpBVol').oninput=e=>setVol(e.target.value/100);
$('mpBTabD').onclick=()=>{ P.bigTab='d'; P.bigPage=0; P.recoFilter='all'; renderBigList(); };
$('mpBTabQ').onclick=()=>{ P.bigTab='q'; P.bigPage=0; renderBigList(); };
$('mpBTabA').onclick=()=>{ P.bigTab='a'; P.bigPage=0; P.bigArtist=''; renderBigList(); };
$('mpBTabL').onclick=()=>{ P.bigTab='l'; P.bigPage=0; renderBigList(); };
$('mpBTabY').onclick=()=>{ P.bigTab='y'; renderBigList(); };
// ── 10.9 · 확장 플레이어 검색 (아이콘 버튼) ──
function closeBigSearch(){
  P.bq=''; const i=$('mpBSearch'); if(i) i.value='';
  const b=$('mpBSearchBar'); if(b) b.classList.remove('show');
  const f=$('mpBFind'); if(f) f.classList.remove('on');
  P.bigPage=0; renderBigList();
}
$('mpBRefresh').onclick=e=>{ e.stopPropagation(); refreshMusic(true); };
$('mpBSort').onclick=e=>{ e.stopPropagation(); cycleSort(); };
try{ updateSortBtn(); }catch(e){}
$('mpBFind').onclick=e=>{
  e.stopPropagation();
  const bar=$('mpBSearchBar');
  if(bar.classList.contains('show')){ closeBigSearch(); return; }
  bar.classList.add('show'); $('mpBFind').classList.add('on');
  if(P.bigTab==='y'||P.bigTab==='d'){ P.bigTab='l'; }      // 가사/추천 화면에서는 목록 검색으로 바꿔 준다
  P.bigPage=0; renderBigList();
  setTimeout(()=>{ try{ $('mpBSearch').focus(); }catch(err){} },50);
};
$('mpBSearchX').onclick=e=>{ e.stopPropagation(); closeBigSearch(); };
$('mpBSearch').oninput=e=>{ P.bq=e.target.value; P.bigPage=0; renderBigList(); };
$('mpBSearch').onkeydown=e=>{
  e.stopPropagation();
  if(e.key==='Escape'){ e.preventDefault(); closeBigSearch(); }
  if(e.key==='Enter'){
    const first=$('mpBBody').querySelector('[data-bl]');
    if(first) first.click();
  }
};
$('mpBPgPrev').onclick=()=>{ if(P.bigPage>0){ P.bigPage--; renderBigList(); } };
$('mpBPgNext').onclick=()=>{ P.bigPage++; renderBigList(); };
(function(){
  const jumpEl=$('mpBPgJump');
  if(jumpEl){
    const doJump=(val)=>{
      const n=parseInt(val,10);
      if(isNaN(n)||n<1) return;
      const bq=(P.bq||'').trim().toLowerCase();
      let totalPages=1;
      if(bq){
        const hits=searchTracks(P.list,P.bq);
        totalPages=Math.max(1,Math.ceil(hits.length/14));
      }else if(P.bigTab==='q'){
        totalPages=Math.max(1,Math.ceil(curList().length/14));
      }else if(P.bigTab==='a'){
        totalPages=Math.max(1,Math.ceil(bucketArtists(P.list).length/4));
      }else{
        totalPages=Math.max(1,Math.ceil(filtered().length/14));
      }
      P.bigPage=Math.max(0,Math.min(totalPages-1,n-1));
      renderBigList();
    };
    jumpEl.onkeydown=e=>{
      if(e.key==='Enter'){
        e.preventDefault();
        doJump(e.target.value);
        e.target.blur();
      }
    };
    jumpEl.onchange=e=>{
      doJump(e.target.value);
    };
  }
})();
// 노트 편집 중(LP 디스크 모드)에는 표지를 눌러 큰 플레이어를 연다
pl.addEventListener('click',e=>{
  if(P.mode==='float'&&e.target.id==='mpCover') openBig();
});

// ── 태그·표지 편집 창 ──
let TAG_EDIT=null, _menuAutoFindId=null;
function openTagEditor(id,opts){
  opts=opts||{};
  if(!opts.hidden&&_menuAutoFindId){
    toast('우클릭 자동 찾기가 끝난 뒤 편집할 수 있어요',2200); return;
  }
  const t=P.list.find(x=>x.id===id)||cur(); if(!t) return;
  TAG_EDIT=id;
  $('mpTagTitle').value=t.title||''; $('mpTagArtist').value=t.artist||'';
  $('mpTagAlbum').value=t.album||''; $('mpTagYear').value=t.year||'';
  $('mpTagGenre').value=t.genre||'';
  $('mpTagLyrics').value=t.lyrics||t.lyrics_plain||'';
  if(t.lyrics===undefined&&(t.has_lyrics||t.has_sync)){
    // 숨은 자동 찾기에서는 안내 문구를 실제 가사로 오해하지 않게 빈칸 유지.
    $('mpTagLyrics').value=opts.hidden?'':'가사 불러오는 중…';
    ensureLyrics(t).then(()=>{ if(TAG_EDIT===id) $('mpTagLyrics').value=t.lyrics||t.lyrics_plain||''; });
  }
  const im=$('mpTagCover');
  im.onerror=()=>{ im.onerror=null; im.src=DEF_COVER; };
  im.src=t.cover?('/api/music/cover/'+id+(P.coverV?('?v='+P.coverV):'')):DEF_COVER;
  // 10.9 · '출처' 표기는 없앤다 (자동으로 찾았는지만 알려 준다)
  $('mpTagHint').textContent=
    (t.orig_title?('원래 파일 이름: '+t.orig_title+' · '):'')+
    (t.tag_src?'자동으로 찾은 곡 정보':'자동 분류 결과 없음');
  $('mpTagSave').style.display='';   // 노래 내용 편집은 누구나 가능
  _tagAlt=0; _coverAlt=0;         // 창을 열면 '처음 결과'부터 다시
  recogStatus().then(st=>{
    const b=$('mpTagRecog'); if(!b) return;
    const ready=!!(st&&st.ready);
    b.classList.toggle('off',!ready);
    b.title=ready?'소리 지문으로 인식 (0.85점 이상만 적용)':
      (st&&!st.fpcalc?'fpcalc 없음 (apply.sh 재실행)':'AcoustID 키 필요 (관리자)');
  });
  // 우클릭 메뉴의 자동 찾기도 이 편집기의 입력칸을 같은 작업 버퍼로 쓴다.
  // 그 경우에는 창을 띄우거나 숨은 입력칸으로 포커스를 옮기지 않는다.
  if(!opts.hidden){
    $('mpTagModal').classList.add('show');
    setTimeout(()=>{ try{ $('mpTagTitle').focus(); }catch(e){} },60);
  }
}
let _scrapedCoverUrl=null;
async function scrapeTrackUrl(){
  const input=$('mpTagUrlInput');
  const url=(input&&input.value||'').trim();
  if(!url){ toast('노래 정보 링크를 입력해 주세요',2000); return; }
  const btn=$('mpTagUrlBtn'); const origHtml=btn?btn.innerHTML:'';
  if(btn){ btn.innerHTML='<i class="ri-loader-4-line mp-spin"></i> 불러오는 중'; btn.disabled=true; }
  try{
    const r=await fetch('/api/music/from_url',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({url,id:TAG_EDIT})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){
      toast(d.error||'링크에서 정보를 가져오지 못했어요',2600);
      return;
    }
    if(d.title) $('mpTagTitle').value=d.title;
    if(d.artist) $('mpTagArtist').value=d.artist;
    if(d.album) $('mpTagAlbum').value=d.album;
    if(d.year) $('mpTagYear').value=d.year;
    if(d.genre) $('mpTagGenre').value=d.genre;
    if(d.lyrics) $('mpTagLyrics').value=d.lyrics;
    if(d.cover_url){
      _scrapedCoverUrl=d.cover_url;
      const im=$('mpTagCover');
      im.onerror=()=>{ im.onerror=null; im.src=DEF_COVER; };
      im.src=d.cover_url;
    }
    $('mpTagHint').textContent=(d.src?`'${d.src}'`:'웹 링크')+' 에서 노래 정보를 불러왔습니다';
    toast((d.src?`'${d.src}'`:'링크')+' 정보를 불러왔습니다 ✓',2000);
    if(input) input.value='';
  }catch(e){
    toast('링크 분석 실패',2200);
  }finally{
    if(btn){ btn.innerHTML=origHtml; btn.disabled=false; }
  }
}
function closeTagModal(){
  $('mpTagModal').classList.remove('show');
  TAG_EDIT=null; _tagAlt=0; _coverAlt=0; _scrapedCoverUrl=null;
  if($('mpTagUrlInput')) $('mpTagUrlInput').value='';
}
$('mpTagX').onclick=closeTagModal;
if($('mpTagUrlBtn')) $('mpTagUrlBtn').onclick=scrapeTrackUrl;
if($('mpTagUrlInput')) $('mpTagUrlInput').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); scrapeTrackUrl(); } };
// 12.2 · 태그 편집창 텍스트를 끌어 선택하다 마우스를 창 밖에서 떼면
//   창이 닫히던 문제. 드래그로 텍스트가 선택 중이면 닫지 않는다.
let _tagDragOff=false;
$('mpTagModal').addEventListener('pointerdown',e=>{
  if(e.button!==0) return;
  _tagDragOff=!!window.getSelection||e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA';
},true);
$('mpTagModal').addEventListener('click',e=>{
  const sel=window.getSelection?String(window.getSelection()):'';
  if(e.target.id==='mpTagModal' && !(_tagDragOff && sel)) closeTagModal();
  _tagDragOff=false;
});
// 음악 변이 API가 worker에서 멈추면 버튼이 영원히 로딩 상태가 되지 않도록
// 프론트에서도 제한 시간을 둔다. (인식은 음원 다운로드 때문에 더 길게 사용)
async function musicApiFetch(url, opts, timeoutMs=120000){
  const ac=new AbortController();
  const tm=setTimeout(()=>ac.abort(),timeoutMs);
  try { return await fetch(url,{...(opts||{}),signal:ac.signal}); }
  finally { clearTimeout(tm); }
}

// 12.2 · '초기화' — 제목만 되돌리는 게 아니라, 웹으로 붙은 모든 정보
//   (제목·가수·앨범·연도·장르·가사·표지)를 처음 올렸을 때 상태로 되돌린다 (누구나 가능).
$('mpTagOrigBtn').onclick=async()=>{
  const id=TAG_EDIT; if(!id||_tagBusy) return;
  if(!confirm('태그·가사·표지를 모두 처음 올렸을 때로 되돌릴까요?')) return;
  _tagBusy=true;
  const btn=$('mpTagOrigBtn'); const html=btn.innerHTML;
  btn.innerHTML='<i class="ri-loader-4-line mp-spin"></i> 초기화 중';
  try{
    const r=await musicApiFetch('/api/music/reset',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+admTok()},
      body:JSON.stringify({id})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){ toast(d.error||'초기화 실패',2200); return; }
    P.coverV=Date.now();
    await loadList(); renderTitle(); renderListPop();
    _syncTagEditor(P.list.find(x=>x.id===id));
    toast('초기화했습니다',1500);
  }catch(e){ toast('초기화 실패',2000); }
  finally{ btn.innerHTML=html; _tagBusy=false; }
};

// 12.2 · 싱크 가사만 다시 찾기 (제목·가수는 안 건드림)
$('mpTagSyncLrc').onclick=async()=>{
  const id=TAG_EDIT; if(!id||_tagBusy) return;
  _tagBusy=true;
  const btn=$('mpTagSyncLrc'); const html=btn.innerHTML;
  btn.innerHTML='<i class="ri-loader-4-line mp-spin"></i> 가사 찾는 중';
  try{
    const r=await musicApiFetch('/api/music/synced-lyrics',{method:'POST',
      headers:{'Content-Type':'application/json'},
      // 14.13 · 편집창에 적어둔 제목/가수로 검색 — 저장 전 이름(인식 결과
      //   확인 중 등)으로 눌러도 그 이름의 가사를 찾아 반영한다.
      body:JSON.stringify({id,
        q_title:$('mpTagTitle').value.trim(),
        q_artist:$('mpTagArtist').value.trim()})});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.ok){
      await loadList(); renderTitle();
      const t=P.list.find(x=>x.id===id);
      if(t&&TAG_EDIT===id) $('mpTagLyrics').value=d.lyrics;
      toast('싱크 가사를 찾았어요',1800);
    }else toast(d.error||'싱크 가사를 찾지 못했어요',2400);
  }catch(e){ toast('가사 찾기 실패',2000); }
  finally{ btn.innerHTML=html; _tagBusy=false; }
};
$('mpTagSave').onclick=async()=>{
  // 저장은 다른 검색 작업이 꼬여 있어도 항상 실행할 수 있어야 한다.
  // 기존에는 _tagBusy가 남아 있으면 클릭 자체가 무시됐다.
  const id=TAG_EDIT; if(!id) return;

  // 14.10 · 지금 화면에 보이는 수정사항을 먼저 로컬 상태에 반영한다.
  // 서버 저장이 끝나기를 기다리는 동안에도 제목/가수/가사가 즉시 보이고,
  // 늦게 도착한 자동 찾기 결과가 방금 누른 저장값을 덮어쓰지 못하게 한다.
  const payload={id,
    title:$('mpTagTitle').value, artist:$('mpTagArtist').value,
    album:$('mpTagAlbum').value, year:$('mpTagYear').value,
    genre:$('mpTagGenre').value,
    lyrics:$('mpTagLyrics').value};
  const local=(P.list||[]).find(x=>x.id===id);
  if(local){
    local.title=payload.title; local.artist=payload.artist;
    local.album=payload.album; local.year=payload.year; local.genre=payload.genre;
    local.lyrics=payload.lyrics;
    if(/\[\d{1,2}:\d{1,2}/.test(payload.lyrics||'')){ local.has_sync=true; }
    if((payload.lyrics||'').trim()){ local.has_lyrics=true; }
    try{ renderTitle(); renderListPop(); }catch(e){}
  }

  // 저장을 누르면 이전 '정보 찾기' 요청은 취소한다.
  if(_lookupAbort) try{ _lookupAbort.abort(); }catch(e){}
  _tagBusy=false;
  const btn=$('mpTagSave'); const html=btn.innerHTML;
  btn.innerHTML='<i class="ri-check-line"></i> 저장됨';
  toast('수정한 내용을 저장했습니다',900);
  try{
    const r=await musicApiFetch('/api/music/meta',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+admTok()},
      body:JSON.stringify(payload)},15000);
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){ toast(d.error||'저장 실패',2200); return; }
    if(_scrapedCoverUrl){
      try{
        await fetch('/api/music/cover',{method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+admTok()},
          body:JSON.stringify({id, url:_scrapedCoverUrl})});
        P.coverV=Date.now();
      }catch(e){}
      _scrapedCoverUrl=null;
    }
    await loadList(); renderTitle(); renderListPop();
    closeTagModal();
  }catch(e){ toast(e&&e.name==='AbortError'?'저장 시간이 초과됐어요 · worker 상태를 확인해 주세요':'저장 실패',2600); }
  finally{ if(btn) btn.innerHTML=html; }
};
$('mpTagCoverPick').onclick=()=>$('mpCoverFile').click();
$('mpCoverFile').onchange=async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value='';
  if(!f||!TAG_EDIT) return;
  toast('표지 올리는 중…',1600);
  const fd=new FormData(); fd.append('id',TAG_EDIT); fd.append('file',f);
  try{
    const r=await fetch('/api/music/cover',{method:'POST',
      headers:{'Authorization':'Bearer '+admTok()},body:fd});
    const d=await r.json();
    if(!r.ok||!d.ok){ toast(d.error||'표지 저장 실패',2200); return; }
    P.coverV=Date.now();
    await loadList(); renderTitle(); renderListPop();
    const t=P.list.find(x=>x.id===TAG_EDIT);
    const im=$('mpTagCover');
    im.onerror=()=>{ im.onerror=null; im.src=DEF_COVER; };
    im.src=(t&&t.cover)?('/api/music/cover/'+TAG_EDIT+'?v='+P.coverV):DEF_COVER;
    if(cur()&&cur().id===TAG_EDIT) setCover(cur());
    toast('표지를 바꿨습니다',1500);
  }catch(err){ toast('표지 저장 실패',2000); }
};
$('mpTagCoverReset').onclick=async()=>{
  if(!TAG_EDIT) return;
  try{
    const r=await fetch('/api/music/cover',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+admTok()},
      body:JSON.stringify({id:TAG_EDIT,remove:true})});
    const d=await r.json();
    if(!r.ok||!d.ok){ toast(d.error||'실패',2000); return; }
    P.coverV=Date.now();
    await loadList(); renderTitle(); renderListPop();
    $('mpTagCover').src=DEF_COVER;
    toast('표지를 지웠습니다',1400);
  }catch(e){}
};

// ── 자동 태그 찾기 (서버: Apple Music → Deezer → MusicBrainz) ──
//  11.2 · 같은 버튼을 다시 누르면 '그 다음 후보'가 적용된다.
//        (제목·가수가 같은 다른 곡이 있을 수 있으니)
//        편집창을 닫았다 다시 열면 처음 결과부터 다시.
let _tagAlt=0, _coverAlt=0, _tagBusy=false;
const _lyrAutoTried=new Set();
// 일부 이전/외부 저장소 레코드는 boolean 대신 문자열 "false"를 돌려준다.
// JavaScript에서 그 문자열은 truthy라서, 실제 표지가 없어도 자동 찾기가
// "표지가 있다"고 판단하던 것을 막는다.
function hasTrackCover(t){
  if(!t) return false;
  if(String(t.cover_url||'').trim()) return true;
  const cover=t.cover;
  return cover===true||cover===1||cover==='1'||String(cover).toLowerCase()==='true';
}
function _syncTagEditor(t){
  if(!t||TAG_EDIT!==t.id) return;
  $('mpTagTitle').value=t.title||''; $('mpTagArtist').value=t.artist||'';
  $('mpTagAlbum').value=t.album||''; $('mpTagYear').value=t.year||'';
  $('mpTagGenre').value=t.genre||'';
  $('mpTagLyrics').value=t.lyrics||t.lyrics_plain||'';
  if(t.lyrics===undefined&&(t.has_lyrics||t.has_sync))
    ensureLyrics(t).then(()=>{ if(TAG_EDIT===t.id)
      $('mpTagLyrics').value=t.lyrics||t.lyrics_plain||''; });
  const im=$('mpTagCover');
  im.onerror=()=>{ im.onerror=null; im.src=DEF_COVER; };
  im.src=hasTrackCover(t)?('/api/music/cover/'+t.id+'?r='+Date.now()):DEF_COVER;
}
let _lookupAbort=null;
async function lookupTrack(id,opts){
  if(!id) return;
  opts=opts||{};
  const body={id,force:true,lyrics_only:!!opts.lyricsOnly};
  if(opts.title!=null){ body.q_title=opts.title; body.q_artist=opts.artist||''; }
  if(opts.alt) body.alt=opts.alt;
  if(opts.replaceCover) body.replace_cover=true;
  // 14.10 · '저장'을 누르면 이전 찾기 요청을 취소한다. 같은 곡을 계속
  //  찾고 있을 때 버튼이 영원히 '찾는 중'으로 남거나, 늦게 도착한 자동
  //  태그가 방금 저장한 제목/가수를 덮어쓰는 일을 막는다.
  if(_lookupAbort) try{ _lookupAbort.abort(); }catch(e){}
  const ac=new AbortController();
  _lookupAbort=ac;
  // 14.13 · 버튼에서 누른 찾기는 넉넉한 시간을 준다. 세 출처(Apple·Deezer·
  //   MusicBrainz)를 도는 검색은 30초를 넘기기도 해서, 예전엔 버튼이
  //   '눌렀는데 아무 반응 없음'처럼 보였다. (배경 호출은 기존 30초 유지)
  const tm=setTimeout(()=>ac.abort(),opts.timeoutMs||30000);
  try{
    const r=await fetch('/api/music/lookup',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:ac.signal});
    const d=await r.json();
    if(!r.ok||!d.ok){ if(!opts.silent) toast(d.error||'찾기 실패',2200); return; }
    P.coverV=Date.now();                     // 표지가 바뀌었을 수도 있다
    await loadList(); renderTitle(); renderListPop();
    // 가사 화면을 보고 있었다면 새로 받은 가사를 바로 그려 준다
    try{ if(P.bigTab==='y'&&$('mpBig').classList.contains('open')) renderLyrics(); }catch(err){}
    // 10.5 · 조용히: 결과 토스트 없이 화면에 바로 반영
    _syncTagEditor(P.list.find(x=>x.id===id));
  }catch(e){
    if(e&&e.name!=='AbortError' && !opts.silent) toast('찾기 중 오류가 났어요',2200);
  }finally{
    clearTimeout(tm);
    if(_lookupAbort===ac) _lookupAbort=null;
  }
}
// ── 15.0 · 자동 찾기 = '빈칸만 채우기' ──
//   소리 인식 → 태그 검색 → 싱크 가사 → 표지 순서로, 지금 '비어 있는 칸'에
//   해당하는 단계만 돌린다. 이미 채워진 칸(저장 전 사용자가 적어둔 값
//   포함)은 절대 건드리지 않고, 검색어는 편집창의 기존 제목·가수를 쓴다.
const TAG_FIELDS=[['title','mpTagTitle'],['artist','mpTagArtist'],['album','mpTagAlbum'],
                  ['year','mpTagYear'],['genre','mpTagGenre']];
const TAG_FIELD_NAME={title:'제목',artist:'가수',album:'앨범',year:'연도',genre:'장르'};
$('mpTagAuto').onclick=async()=>{
  if(!TAG_EDIT||_tagBusy) return;
  const id=TAG_EDIT;
  const fromTrackMenu=_menuAutoFindId===id;
  // 저장 전 편집창 스냅숏 — 인식이 실패했을 때 이 값들은 절대 덮지 않는다
  let snap={};
  TAG_FIELDS.forEach(([k,el])=>{ snap[k]=$(el).value.trim(); });
  snap.lyrics=$('mpTagLyrics').value.trim();
  let t0=P.list.find(x=>x.id===id)||{};
  const hadCover=hasTrackCover(t0)||!!_scrapedCoverUrl;
  _tagBusy=true;
  const btn=$('mpTagAuto'); const html=btn.innerHTML;
  const setBtn=t=>{
    btn.innerHTML='<i class="ri-loader-4-line mp-spin"></i> '+t;
    if(fromTrackMenu) toast(t,3200);
  };
  const hintEl=$('mpTagHint');
  const qNow=()=>({title:$('mpTagTitle').value.trim(),artist:$('mpTagArtist').value.trim()});
  const missed=[];
  async function reload(){
    await loadList(); try{ renderTitle(); renderListPop(); }catch(e){}
    return P.list.find(x=>x.id===id)||{};
  }
  // 서버 값을 편집창에 반영 — snap 이 비어 있는 칸만, snap 값은 원상 유지
  function applyServer(t){
    TAG_FIELDS.forEach(([k,el])=>{
      if(snap[k]){ $(el).value=snap[k]; return; }
      const sv=String((t&&t[k])!=null?t[k]:'').trim();
      if(sv&&!$(el).value.trim()) $(el).value=sv;
    });
    if(!snap.lyrics){
      const sl=String(((t&&t.lyrics)||(t&&t.lyrics_plain))||'').trim();
      if(sl&&!$('mpTagLyrics').value.trim()) $('mpTagLyrics').value=sl;
    }
  }
  try{
    // ① [무조건 1순위] 음원 음성 인식(AcoustID)을 먼저 실행
    setBtn('음원 인식 중…');
    if(hintEl) hintEl.textContent='소리 지문으로 음원을 인식하는 중… (최대 1~2분)';
    let recogFound=false;
    try{
      const r=await musicApiFetch('/api/music/recognize',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({id,force:true})},180000);
      const d=await r.json().catch(()=>({}));
      if(r.ok&&d.ok&&d.duplicate_removed){
        await loadList(); pruneQueue(); renderTitle(); renderListPop();
        const kept=d.kept||d.track||{};
        if(kept.id&&!fromTrackMenu){ TAG_EDIT=kept.id; _syncTagEditor(P.list.find(x=>x.id===kept.id)||kept); }
        toast('소리까지 완전히 같은 곡이라 중복 음원을 자동으로 정리했어요',3000);
        return;
      }
      if(r.ok&&d.ok&&d.recog&&(d.recog.title||d.recog.artist)){
        recogFound=true;
        // 음원 인식 결과는 정확하므로 제목·가수를 반영하고 이를 바탕으로 다음 단계를 이어간다
        if(d.recog.title) $('mpTagTitle').value=d.recog.title;
        if(d.recog.artist) $('mpTagArtist').value=d.recog.artist;
        if(d.recog.album&&!$('mpTagAlbum').value.trim()) $('mpTagAlbum').value=d.recog.album;
        if(d.recog.year&&!$('mpTagYear').value.trim()) $('mpTagYear').value=d.recog.year;
        // 인식된 정확한 정보를 스냅숏에 동기화
        snap.title=$('mpTagTitle').value.trim();
        snap.artist=$('mpTagArtist').value.trim();
        await reload();
      }else{
        missed.push('음성 인식');
      }
    }catch(e){ missed.push('음성 인식'); }

    // ② 태그 찾기 — 인식 결과(또는 기존 태그)를 바탕으로 나머지 빈칸(앨범, 연도, 장르 등)을 채운다
    if(TAG_FIELDS.some(([k,el])=>!$(el).value.trim())){
      setBtn('태그 찾는 중…');
      try{
        const qq=qNow();
        const r=await musicApiFetch('/api/music/lookup',{method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id,force:true,fill_only:true,alt:_tagAlt,
            q_title:qq.title,q_artist:qq.artist})},120000);
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.ok) missed.push('기본 태그');
        applyServer(await reload());
        _tagAlt++;                       // 다음 누름 = 다음 후보
      }catch(e){ missed.push('기본 태그'); }
    }

    // ③ 라이브(싱크) 가사 찾기
    if(!$('mpTagLyrics').value.trim()){
      setBtn('가사 찾는 중…');
      const qq=qNow();
      let got=false;
      try{
        const r=await musicApiFetch('/api/music/synced-lyrics',{method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id,q_title:qq.title,q_artist:qq.artist})},60000);
        const d=await r.json().catch(()=>({}));
        if(r.ok&&d.ok&&d.lyrics){ $('mpTagLyrics').value=d.lyrics; got=true; }
      }catch(e){}
      if(!got){
        try{
          const r=await musicApiFetch('/api/music/lookup',{method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({id,lyrics_only:true,force:true,q_title:qq.title,q_artist:qq.artist})},60000);
          if(r.ok){ applyServer(await reload()); got=!!$('mpTagLyrics').value.trim(); }
        }catch(e){}
      }
      if(!got) missed.push('가사');
    }

    // ④ 앨범 표지 찾기 (마지막)
    {
      setBtn('표지 찾는 중…');
      const qq=qNow();
      try{
        const r=await musicApiFetch('/api/music/lookup',{method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id,cover_only:true,alt:_coverAlt,
            q_title:qq.title,q_artist:qq.artist})},90000);
        const d=await r.json().catch(()=>({}));
        if(r.ok&&d.ok&&d.cover){ P.coverV=Date.now(); _coverAlt++; }
        else if(!hadCover) missed.push('표지');
        applyServer(await reload());
      }catch(e){ if(!hadCover) missed.push('표지'); }
    }
    // 마무리 — 화면 최신화
    const t=await reload(); applyServer(t);
    const im=$('mpTagCover');
    im.onerror=()=>{ im.onerror=null; im.src=DEF_COVER; };
    im.src=hasTrackCover(t)?('/api/music/cover/'+id+(P.coverV?('?v='+P.coverV):'')):DEF_COVER;
    if(cur()&&cur().id===id) setCover(cur());
    try{ if(P.bigTab==='y'&&$('mpBig').classList.contains('open')) renderLyrics(); }catch(err){}
    // 무엇이 새로 채워졌는지 알려 준다
    const filled=[];
    TAG_FIELDS.forEach(([k,el])=>{ if(!snap[k]&&$(el).value.trim()) filled.push(TAG_FIELD_NAME[k]); });
    if(!snap.lyrics&&$('mpTagLyrics').value.trim()) filled.push('가사');
    if(!hadCover&&(P.list.find(x=>x.id===id)||{}).cover) filled.push('표지');
    const missTxt=missed.length?(' · 못 찾은 것: '+missed.join(' · ')):'';
    if(hintEl) hintEl.textContent=filled.length
      ? ('빈칸을 채웠어요: '+filled.join(' · ')+missTxt+' — 확인 후 저장해 주세요')
      : ('새 정보를 찾지 못했어요'+missTxt);
    if(filled.length) toast('빈칸을 채웠어요 ✓ '+filled.join(' · ')+missTxt,3200);
    else toast('빈칸에 넣을 정보를 찾지 못했어요'+missTxt,3200);
  } finally { btn.innerHTML=html; _tagBusy=false; }
};

// 전체 곡 화면의 우클릭 메뉴에서도 편집창의 '자동 찾기'와 완전히 같은
// 파이프라인(소리 인식 → 빈 태그 → 싱크 가사 → 표지)을 실행한다.
// 예전 메뉴는 lookupTrack() 한 번만 불러서, 지난 버전의 좋아진 음원 인식
// 알고리즘을 건너뛰고 있었다. 숨은 편집 버퍼를 준비한 뒤 같은 핸들러를
// 직접 기다리므로 두 진입점의 동작이 앞으로도 갈라지지 않는다.
async function autoFindTrackFromMenu(id){
  if(!id) return;
  if(_tagBusy){ toast('다른 곡 정보를 찾고 있어요',1800); return; }
  const t=P.list.find(x=>x.id===id);
  if(!t) return;
  _menuAutoFindId=id;
  openTagEditor(id,{hidden:true});
  try{
    await $('mpTagAuto').onclick();
  }finally{
    _menuAutoFindId=null;
    // 실제 편집창을 열지 않았으므로 숨은 작업 상태만 정리한다.
    if(TAG_EDIT===id){
      TAG_EDIT=null; _tagAlt=0; _coverAlt=0; _scrapedCoverUrl=null;
    }
  }
}
// ══════════════════════════════════════════════════════════
//  11.6 · 소리로 노래 인식 (AcoustID 지문 → 제목·가수 → 표지·가사까지)
//    이름도 태그도 엉망인 파일을 '소리 자체'로 알아낸다.
// ══════════════════════════════════════════════════════════
let _recogReady=null;
async function recogStatus(){
  if(_recogReady!==null) return _recogReady;
  try{
    const r=await fetch('/api/music/recognize/status',{cache:'no-store'});
    _recogReady=await r.json();
  }catch(e){ _recogReady={ok:false,fpcalc:false,key:false,ready:false}; }
  return _recogReady;
}
async function askAcoustIdKey(){
  if(!isAdm()){ toast('소리 인식을 켜려면 관리자 설정이 필요해요',2600); return false; }
  const k=prompt('AcoustID 키를 붙여넣어 주세요\n(acoustid.org/new-application 에서 무료 발급)','');
  if(!k||!k.trim()) return false;
  try{
    const r=await fetch('/api/music/recognize/key',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+admTok()},
      body:JSON.stringify({key:k.trim()})});
    const d=await r.json();
    if(!r.ok||!d.ok){ toast('키를 저장하지 못했어요',2200); return false; }
    _recogReady=null; toast('소리 인식을 켰습니다',1800); return true;
  }catch(e){ toast('키를 저장하지 못했어요',2200); return false; }
}
$('mpTagRecog').onclick=async()=>{
  if(!TAG_EDIT||_tagBusy) return;
  // 상태 확인과 관리자 키 입력도 네트워크 작업이다. 기존에는 이 작업이
  // 끝날 때까지 버튼 표시가 그대로라서, 클릭이 무시된 것처럼 보였다.
  _tagBusy=true;
  const btn=$('mpTagRecog'); const html=btn.innerHTML;
  btn.innerHTML='<i class="ri-loader-4-line mp-spin"></i> 확인 중…';
  try{
    const st=await recogStatus();
    if(!st||st.ok===false){ toast('인식 서버에 연결할 수 없어요 · worker 상태를 확인해 주세요',3600); return; }
    if(!st.fpcalc){ toast('서버에 인식 도구(fpcalc)가 없어요 · apply.sh 를 다시 실행해 주세요',3600); return; }
    if(!st.key){ if(!await askAcoustIdKey()) return; }
    btn.innerHTML='<i class="ri-loader-4-line mp-spin"></i> 듣는 중…';
    const id=TAG_EDIT;
    const r=await musicApiFetch('/api/music/recognize',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({id})},180000);
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){ toast(d.error||'소리로는 찾지 못했어요',2800); return; }
    if(d.duplicate_removed){
      await loadList(); pruneQueue(); renderTitle(); renderListPop();
      const kept=d.kept||d.track||{};
      if(kept.id){ TAG_EDIT=kept.id; _syncTagEditor(P.list.find(x=>x.id===kept.id)||kept); }
      toast('소리까지 완전히 같은 곡이라 중복 음원을 자동으로 정리했어요',3000);
      return;
    }
    P.coverV=Date.now();
    await loadList(); renderTitle(); renderListPop();
    _syncTagEditor(P.list.find(x=>x.id===id));
    if(cur()&&cur().id===id) setCover(cur());
    const g=d.recog||{};
    // 14.13 · 인식 결과를 화면에 확실히 반영한다. 서버가 이미 적용한 값이지만,
    //   목록 새로고침이 늦거나 실패해도(오프라인 등) 편집창·목록에 남게
    //   응답의 recog 값을 다시 한번 심어 준다. (예전엔 토스트에 결과가 떴는데
    //   편집창은 그대로라 '반영이 안 된다'고 보였던 문제)
    if(TAG_EDIT===id&&(g.title||g.artist)){
      if(g.title){ $('mpTagTitle').value=g.title; }
      if(g.artist){ $('mpTagArtist').value=g.artist; }
      if(g.album&&!$('mpTagAlbum').value){ $('mpTagAlbum').value=g.album; }
      if(g.year&&!$('mpTagYear').value){ $('mpTagYear').value=g.year; }
      const t=P.list.find(x=>x.id===id);
      if(t){ if(g.title)t.title=g.title; if(g.artist)t.artist=g.artist;
             t.tag_src=t.tag_src||'소리 인식(AcoustID)';
             try{ renderTitle(); renderListPop(); }catch(e){} }
      $('mpTagHint').textContent='소리 인식(AcoustID) 으로 찾은 곡 정보';
    }
    // 14.37.1 · 같은 곡으로 인식됐지만 소리가 달라(다른 판본·다른 곡) 지우지 않고 남긴 곡이
    //   있으면 함께 알려 준다. 예전엔 인식 결과만 같으면 파일을 지워 버렸다.
    const apart=(Array.isArray(d.kept_apart)&&d.kept_apart.length)
      ?' · 같은 곡으로 인식된 음원 '+d.kept_apart.length+'곡은 소리가 달라 그대로 두었어요':'';
    // 12.2 · 0.85 미만은 서버가 적용을 안 한다. 안내만.
    if(g.score&&g.score<0.85) toast('다른 곡으로 인식돼 적용하지 않았어요 (점수 '+(g.score*100|0)+'점)',2800);
    else toast('🎧 '+(g.artist?g.artist+' · ':'')+(g.title||'인식 완료')+apart,apart?3600:2400);
  }catch(e){ toast(e&&e.name==='AbortError'?'인식 시간이 초과됐어요 · worker 상태를 확인해 주세요':'인식하지 못했어요',3200); }
  finally{ btn.innerHTML=html; _tagBusy=false; }
};
// 11.2 · 표지만 다시 찾기 — 노래 정보는 그대로, 누를 때마다 다음 표지
$('mpTagCoverFind').onclick=async()=>{
  if(!TAG_EDIT||_tagBusy) return;
  _tagBusy=true;
  const btn=$('mpTagCoverFind'); const html=btn.innerHTML;
  btn.innerHTML='<i class="ri-loader-4-line mp-spin"></i> 찾는 중…';
  const id=TAG_EDIT;
  try{
    const r=await fetch('/api/music/lookup',{method:'POST',
      headers:{'Content-Type':'application/json'},
      // 14.13 · 편집창에 적어둔 제목/가수로 표지 검색 (저장 전 값 우선)
      body:JSON.stringify({id,cover_only:true,alt:_coverAlt,
        q_title:$('mpTagTitle').value.trim(),
        q_artist:$('mpTagArtist').value.trim()})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){ toast(d.error||'표지를 찾지 못했어요',2000); return; }
    _coverAlt++;
    P.coverV=Date.now();
    await loadList(); renderTitle(); renderListPop();
    const t=P.list.find(x=>x.id===id);
    const im=$('mpTagCover');
    im.onerror=()=>{ im.onerror=null; im.src=DEF_COVER; };
    im.src=(t&&t.cover)?('/api/music/cover/'+id+'?r='+Date.now()):DEF_COVER;
    if(cur()&&cur().id===id) setCover(cur());
  }catch(e){ toast('표지를 찾지 못했어요',2000); }
  finally{ btn.innerHTML=html; _tagBusy=false; }
};

// ── 업로드 뒤 서버 자동 태깅이 끝나면 목록에 반영 ──
let _tagPoll=null, _tagPollT=0;
function _needsTag(t){
  // 아직 서버가 한 번도 훑지 않은 곡 (찾아봤지만 못 찾은 'none' 은 제외)
  return !!t && (t.tag_state==='pending' || !t.tag_state);
}
function startTagPolling(){
  // 11.2 · 서버가 뒤에서 정리하는 동안 목록을 계속 살아 있게 갱신한다.
  //   (아직 안 찾은 곡이 남아 있으면 최대 10분까지 지켜본다)
  _tagPollT=Date.now();
  if(_tagPoll) return;
  const stop=()=>{ if(_tagPoll){ clearInterval(_tagPoll); _tagPoll=null; } };
  _tagPoll=setInterval(async()=>{
    try{
      const busy=P.tagging||P.list.some(_needsTag);
      if(!busy||Date.now()-_tagPollT>600000){ stop(); return; }
      await loadList();
      renderListPop();
      if($('mpBig').classList.contains('open')) renderBigList();
      renderTitle();
    }catch(e){}
  },4000);
}

// ── 작은 목록 팝업: 가수별 그룹 ──
function renderArtGroups(){
  $('mpSearch').style.display='none';
  const gs=bucketArtists(filtered());
  if(!gs.length){
    $('mpLBody')._html=null; $('mpLBody').innerHTML='<div class="mp-plempty">곡이 없습니다</div>';
    $('mpPgInfo').textContent=''; $('mpPgPrev').style.visibility='hidden'; $('mpPgNext').style.visibility='hidden';
    return;
  }
  // 10.3 · 가수가 많으면 8명씩 페이지로
  const PER_G=8;
  const pages=Math.max(1,Math.ceil(gs.length/PER_G));
  P.artPage=Math.max(0,Math.min(P.artPage||0,pages-1));
  const slice=gs.slice(P.artPage*PER_G,P.artPage*PER_G+PER_G);
  $('mpPgInfo').textContent=gs.length+'명'+(pages>1?` · ${P.artPage+1}/${pages}`:'');
  $('mpPgPrev').style.visibility=pages>1?'':'hidden';
  $('mpPgNext').style.visibility=pages>1?'':'hidden';
  let html='';
  slice.forEach(g=>{
    const open=!!P.artOpen[g.name];
    html+=`<div class="mp-pl${open?' open':''}" data-artexp="${esc2(g.name)}">`+
      `<i class="pl-exp ri-arrow-right-s-line" data-artexp="${esc2(g.name)}"></i>`+
      `<b data-artexp="${esc2(g.name)}">${esc2(g.name)}</b><em>${g.tracks.length}</em>`+
      `<i class="pl-play ri-play-fill" data-artplay="${esc2(g.name)}" title="이 가수의 곡 재생"></i></div>`;
    if(open) g.tracks.forEach(t=>{
      const isCur=!!(cur()&&cur().id===t.id);
      html+=`<div class="mp-plsub${isCur?' on':''}" data-artgo="${t.id}">`+
        `<span>${esc2(t.title)}</span>`+
        (t.album?`<em style="color:var(--text3);font-style:normal;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;">${esc2(t.album)}</em>`:'')+
        `</div>`;
    });
  });
  $('mpLBody')._html=null; $('mpLBody').innerHTML=html;
}
function playArtist(name){
  const g=bucketArtists(P.list).find(x=>x.name===name);
  if(!g||!g.tracks.length){ toast('이 가수의 곡이 없습니다',1600); return; }
  setQueue(g.tracks,name);
  playIdx(0);
  toast('▶ '+name+' '+g.tracks.length+'곡',1400);
}
// ═════════ 10.3 · 곡 우클릭/길게누르기 메뉴 + 창 크기 조절 ═════════
function closeTrackMenu(){ const m=$('mpCtx'); if(m) m.classList.remove('show'); }
function openTrackMenu(x,y,id){
  const t=P.list.find(z=>z.id===id)||cur(); if(!t) return;
  const m=$('mpCtx'); if(!m) return;
  _menuAt=Date.now();
  let meta=[t.year,t.genre].filter(Boolean).map(esc2).join(' · ');   // 10.9 · 출처 표기 제거
  if(!meta) meta=(t.ext||'')+((t.bytes)?(' · '+(t.bytes/1048576).toFixed(1)+'MB'):'');
  let h=`<div class="cinfo"><b>${esc2(t.title)}</b>`+
        `<span>${esc2(t.artist||'가수 미상')}${t.album?(' · '+esc2(t.album)):''}</span>`+
        (meta?`<span>${meta}</span>`:'')+`</div>`;
  h+=`<div class="ci" data-a="play"><i class="ri-play-fill"></i>재생</div>`;
  h+=`<div class="ci" data-a="next"><i class="ri-skip-forward-line"></i>다음에 재생</div>`;
  h+=`<div class="ci" data-a="pl"><i class="ri-play-list-add-line"></i>재생목록에 담기</div>`;
  h+=`<div class="ci" data-a="find"><i class="ri-magic-line"></i>자동으로 태그 찾기</div>`;
  h+=`<div class="ci" data-a="edit"><i class="ri-edit-2-line"></i>태그·표지 편집</div>`;
  if(isAdm()) h+=`<div class="ci danger" data-a="del"><i class="ri-delete-bin-line"></i>삭제</div>`;
  m.innerHTML=h;
  m.classList.add('show');
  /* x,y 는 우클릭 지점(화면 px), menu.style.left 는 UI CSS px. 단위 두 개를
     한 번에 맞춰야 메뉴가 커서 아래에 뜨고 오른쪽 끝까지 화면 안에 남는다. */
  var vp=window.sdyViewportBox();
  var mr=m.getBoundingClientRect();
  var mw=m.offsetWidth||Math.round(window.sdyUiCss(mr.width)),
      mh=m.offsetHeight||Math.round(window.sdyUiCss(mr.height));
  var vw=vp.w||Math.round(window.sdyUiCss(window.innerWidth)),
      vh=vp.h||Math.round(window.sdyUiCss(window.innerHeight));
  var mx=window.sdyUiCss(x), my=window.sdyUiCss(y);
  if(vw>0) m.style.left=Math.max(8,Math.min(mx,vw-mw-8))+'px';
  else     m.style.left=Math.max(8,mx)+'px';
  if(vh>0) m.style.top =Math.max(8,Math.min(my,vh-mh-8))+'px';
  else     m.style.top =Math.max(8,my)+'px';
  m._tid=t.id;
}
let _menuAt=0;
(function(){
  const m=$('mpCtx'); if(!m) return;
  m.addEventListener('click',e=>{
    e.stopPropagation();
    const el=e.target.closest('.ci'); if(!el) return;
    const a=el.dataset.a, id=m._tid;
    closeTrackMenu();
    if(!id) return;
    const t=P.list.find(z=>z.id===id); if(!t) return;
    if(a==='play'){ playFrom(filtered(),id,''); }
    else if(a==='next'){ queueNext(id); }
    else if(a==='pl'){ addToPlaylist(id); }
    else if(a==='find'){ autoFindTrackFromMenu(id); }
    else if(a==='edit'){ openTagEditor(id); }
    else if(a==='del'){ delTrack(id); }
  });
  // 메뉴가 떠 있는 상태의 첫 클릭은 '메뉴 닫기'로만 쓴다 (재생 방지).
  // 단 메뉴 '안'의 클릭은 메뉴 항목이 처리한다.
  document.addEventListener('click',e=>{
    if(e.target.closest('#mpCtx')) return;
    if(Date.now()-_menuAt<600){ e.preventDefault(); e.stopPropagation(); closeTrackMenu(); return; }
    closeTrackMenu();
  },true);
  // 우클릭: 큰 플레이어 행·표지·제목, 작은 목록의 곡 행
  const SEL='.mpb-li,.mp-li,.mp-plsub,.mpb-cwrap,.mpb-title';
  const tidOf=(el)=>{
    if(!el) return null;
    if(el.dataset&&el.dataset.tid) return el.dataset.tid;
    if(el.dataset&&el.dataset.artgo) return el.dataset.artgo;
    const t=cur(); return t&&t.id;
  };
  document.addEventListener('contextmenu',e=>{
    const el=e.target.closest(SEL); if(!el) return;
    const tid=tidOf(el); if(!tid) return;
    e.preventDefault(); e.stopPropagation();
    openTrackMenu(e.clientX,e.clientY,tid);
  });
  // 폰: 550ms 길게 누르기 (마우스 제외)
  let lp=null,lx=0,ly=0;
  document.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse') return;
    const el=e.target.closest(SEL); if(!el) return;
    lx=e.clientX; ly=e.clientY;
    clearTimeout(lp);
    lp=setTimeout(()=>{
      const tid=tidOf(el); if(!tid) return;
      if(navigator.vibrate) navigator.vibrate(15);
      openTrackMenu(lx,ly,tid);
    },550);
  });
  const lpCancel=()=>clearTimeout(lp);
  document.addEventListener('pointermove',e=>{
    if(lp&&(Math.abs(e.clientX-lx)>8||Math.abs(e.clientY-ly)>8)) lpCancel();
  });
  document.addEventListener('pointerup',lpCancel);
  document.addEventListener('pointercancel',lpCancel);
})();
// ═════════ 10.5 · 싱크 가사 (LRCLIB LRC) ═════════
let _lyrTok=0;
function parseLRC(txt){
  // [mm:ss.xx] 줄태그 → [{t, s}] (여러 태그는 같은 가사로 분리)
  const out=[];
  (String(txt||'')).split(/\r?\n/).forEach(line=>{
    const times=[...line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if(!times.length) return;
    const s=line.replace(/\[[^\]]*\]/g,'').trim();
    times.forEach(m=>{
      const t=(+m[1])*60+(+m[2])+(m[3]?+('0.'+m[3]):0);
      out.push({t,s:s||'♪'});
    });
  });
  out.sort((a,b)=>a.t-b.t);
  return out;
}
// 11.4 · 가사 본문은 목록에 싣지 않는다 (서버 부담↓) → 볼 때 한 번만 받아 둔다
async function ensureLyrics(t){
  if(!t||t.lyrics!==undefined||t._lyrLoading) return false;
  if(!t.has_lyrics&&!t.has_sync) return false;
  t._lyrLoading=true;
  const ac=new AbortController();
  const tm=setTimeout(()=>ac.abort(),120000);
  try{
    const r=await fetch('/api/music/lyrics/'+t.id,{cache:'no-store',signal:ac.signal});
    const d=await r.json();
    if(d&&d.ok){ t.lyrics=d.lyrics||''; t.lyrics_plain=d.lyrics_plain||'';
                 t.lyrics_src=d.lyrics_src||''; t.lyrics_tries=d.lyrics_tries||0; }
    else { t.lyrics=''; t.lyrics_plain=''; t._lyrError=true; }
  }catch(e){
    // 목록의 has_lyrics 플래그만 남고 본문 요청이 멈추면 무한히
    // '가사를 불러오는 중'으로 남던 문제를 막는다.
    t.lyrics=''; t.lyrics_plain=''; t._lyrError=true;
  }finally{
    clearTimeout(tm); t._lyrLoading=false;
  }
  return true;
}
function renderLyrics(){
  const body=$('mpBBody'); if(!body) return;
  body._html=null;                 // 목록 캐시 무효화 (가사가 이 상자를 쓴다)
  const t=cur(); const tok=++_lyrTok;
  if(!t){ body.innerHTML='<div class="mpb-lyrempty">재생 중인 곡이 없어요</div>'; return; }
  if(t.lyrics===undefined&&(t.has_lyrics||t.has_sync)){
    if(!t._lyrLoading){
      body.innerHTML='<div class="mpb-lyrempty">가사를 불러오는 중…</div>';
      ensureLyrics(t).then(()=>{ if(tok===_lyrTok&&P.bigTab==='y') renderLyrics(); });
    }
    return;
  }
  const lrc=t.lyrics&&String(t.lyrics).indexOf('[')>=0?parseLRC(t.lyrics):null;
  if(lrc&&lrc.length){
    const sig=t.id+'|s|'+(t.lyrics||'').length+'|'+(t.lyrics||'').slice(0,40);
    const prev=$('mpBLyr');
    // 같은 가사면 다시 그리지 않는다(스크롤 유지) — 여백·위치만 다시 맞춘다
    if(prev&&prev._sig===sig){ fitLyrPads(prev); syncLyrics(true); return; }
    body.innerHTML='<div class="mpb-lyr" id="mpBLyr">'+
      '<div class="lyrpad"></div>'+
      lrc.map((l,i)=>`<div class="ll" data-lt="${l.t.toFixed(2)}" data-li="${i}">${esc2(l.s)}</div>`).join('')+
      '<div class="lyrpad"></div></div>';
    const el=$('mpBLyr');
    el._sig=sig; el._lastNow=-2;
    el.addEventListener('click',e=>{
      const li=e.target.closest('.ll'); if(!li) return;
      const tt=+li.dataset.lt;
      if(A.duration){ A.currentTime=Math.min(tt,Math.max(0,A.duration-0.5));
                      P._lyrManual=0; syncLyrics(true); }
    });
    // 10.6 · 직접 잡아서 움직이기: 잡는 동안 자동 스크롤을 멈추고,
    //   4초간 손을 떼면 다시 현재 줄 따라가기로 돌아온다
    // 11.2 · 직접 넘기는 동안에는 흐림을 전부 풀어 가사를 또렷하게 읽게 한다
    const grab=()=>{
      P._lyrManual=Date.now();
      el.classList.add('manual');
      clearTimeout(el._manT);
      el._manT=setTimeout(()=>{
        el.classList.remove('manual'); P._lyrManual=0;
        if($('mpBLyr')===el) syncLyrics(true);
      },4000);
    };
    el.addEventListener('pointerdown',grab);
    el.addEventListener('wheel',grab,{passive:true});
    el.addEventListener('touchmove',grab,{passive:true});
    el.addEventListener('scroll',()=>{ if(el._auto) return; grab(); },{passive:true});
    // 위·아래 여백을 창 높이에 맞춰 정확히 절반으로 (첫 줄도 한가운데 온다)
    fitLyrPads(el);
    syncLyrics(true);
    // 창이 막 열려 높이가 아직 0일 수 있다 → 다음 프레임에 한 번 더 맞춘다
    requestAnimationFrame(()=>{ if(tok!==_lyrTok) return; fitLyrPads(el); syncLyrics(true); });
    setTimeout(()=>{ if(tok!==_lyrTok) return; fitLyrPads(el); syncLyrics(true); },260);
    return;
  }
  const plain=(t.lyrics_plain||'').trim()
    || (t.lyrics? String(t.lyrics).replace(/\[[^\]]*\]/g,'').trim() : '');
  if(plain){
    // 싱크(시간표) 가사가 없는 곡 — 그냥 가사 전문을 또렷하게 보여 준다
    const psig=t.id+'|p|'+plain.length;
    const prev2=$('mpBLyr');
    if(prev2&&prev2._sig===psig) return;        // 스크롤 위치 유지
    body.innerHTML='<div class="mpb-lyr plain" id="mpBLyr">'+
      '<div class="lyrpad"></div>'+
      plain.split(/\r?\n/).map(l=>`<div class="ll">${esc2(l||' ')}</div>`).join('')+
      '<div class="lyrpad"></div></div>';
    const el2=$('mpBLyr'); if(el2){ el2._sig=t.id+'|p|'+plain.length; el2._plain=true; }
    return;
  }
  if(!_lyrAutoTried.has(t.id)){
    _lyrAutoTried.add(t.id);
    body.innerHTML='<div class="mpb-lyrempty">가사를 찾는 중…</div>';
    lookupTrack(t.id,{lyricsOnly:true,silent:true,timeoutMs:60000}).then(()=>{
      try{ if(P.bigTab==='y') renderLyrics(); }catch(e){}
    });
    return;
  }
  body.innerHTML='<div class="mpb-lyrempty">가사가 없어요</div>';
}
// 위·아래 빈 자리를 '창 높이의 절반 - 한 줄 높이의 절반' 으로 맞춘다
function fitLyrPads(el){
  if(!el||el._plain) return;
  const pads=el.querySelectorAll('.lyrpad');
  if(!pads.length) return;
  const h=el.clientHeight||0;
  if(h<40) return;                       // 아직 창이 안 그려졌으면 나중에
  const first=el.querySelector('.ll');
  const lh=(first&&first.offsetHeight)||34;
  const pad=Math.max(28,Math.round(h/2-lh/2));
  if(el._pad===pad) return;              // 같은 값이면 건드리지 않는다(스크롤 튐 방지)
  el._pad=pad;
  pads.forEach(p=>{ p.style.height=pad+'px'; p.style.minHeight='0'; });
}
function syncLyrics(force){
  const el=$('mpBLyr'); if(!el||el._plain) return;
  const t=A.currentTime||0;
  const rows=[...el.querySelectorAll('.ll')];
  if(!rows.length) return;
  const last=rows.length-1;
  // 12.1 · 렌더 지연을 보정하는 선행값(ms). 랩·빠른 곡에서도
  //        가사가 박자에 딱 맞게 올라오도록 살짝 앞당겨 판정한다.
  const _LYR_LEAD=0.08;
  const tt=t+_LYR_LEAD;
  let now=-1;
  for(let i=0;i<rows.length;i++){
    if(tt>=+(rows[i].dataset.lt)) now=i; else break;
  }
  // 11.2 · 전주(첫 가사 전) · 간주(가사 사이가 길 때) · 아웃트로(마지막 가사 뒤)
  //   에는 그 부근 줄의 흐림을 풀어 준다.
  const nextT=(now+1<=last)?+(rows[now+1].dataset.lt):(A.duration||1e9);
  const lastT=+(rows[last].dataset.lt||0);
  const intro=(now<0);
  const outro=(now===last)&&(t>lastT+2.5);
  const inter=(now>=0)&&(nextT-t>7);
  rows.forEach((r,i)=>{
    const d=now<0?99:Math.abs(i-now);
    r.classList.toggle('now',d===0);
    r.classList.toggle('n1',d===1);
    r.classList.toggle('n2',d===2);
    r.classList.toggle('n3',d===3);
    r.classList.toggle('past',now>=0&&i<now&&d>1);
    const edge=(intro&&i<=2)||(outro&&i>=last-2)||(inter&&d<=1);
    r.classList.toggle('edge',!!edge);
  });
  // 10.6 · 사용자가 가사를 직접 잡고 있으면 따라가지 않는다 (4초 후 복귀)
  if(P._lyrManual){
    if(Date.now()-P._lyrManual<4000) return;
    P._lyrManual=0; el.classList.remove('manual'); force=true;
  }
  if(now<0){                       // 전주 — 첫 줄이 가운데 오도록 맨 위로
    if(force||el._lastNow!==-1){ el._lastNow=-1; _lyrScroll(el,rows[0],force); }
    return;
  }
  if(force||now!==el._lastNow){
    el._lastNow=now;
    _lyrScroll(el,rows[now],force);
  }
}
// 어떤 줄을 창 한가운데로.
//  11.7 · offsetTop(=내용 맨 위에서의 거리) 로 계산한다. 화면 좌표와 달리
//   스크롤이 굴러가는 중에도 값이 흔들리지 않아 '중심에서 밀리는' 일이 없다.
//   글자 크기도 바뀌지 않으므로(확대는 transform) 줄 높이가 고정이다.
// 어떤 줄을 창 한가운데로.
//  11.7 · offsetTop(=내용 맨 위에서의 거리) 로 계산한다. 화면 좌표와 달리
//   스크롤이 굴러가는 중에도 값이 흔들리지 않아 '중심에서 밀리는' 일이 없다.
//   글자 크기도 바뀌지 않으므로(확대는 transform) 줄 높이가 고정이다.
// 12.1 · 즉시 점프는 딱딱하고, smooth(브라우저)는 랩·빠른 곡에 밀린다.
//   → 짧은 시간(110~240ms) 동안 easeOutCubic 으로 직접 보간해
//     '부드럽되 정확하고 빠르게' 따라온다.
let _lyrRaf=null;
function _lyrAnimate(el, top){
  const from=el.scrollTop, dist=top-from;
  if(Math.abs(dist)<1){ el.scrollTop=top; return; }
  if(_lyrRaf) cancelAnimationFrame(_lyrRaf);
  // 거리에 비례하되 110~240ms 로 제한 — 멀리 뛸 땐 살짝 길게, 가까운 줄은 즉각
  const dur=Math.min(240, Math.max(110, Math.round(Math.abs(dist)*0.45)));
  const t0=performance.now();
  const step=now=>{
    const k=Math.min(1,(now-t0)/dur);
    const e=1-Math.pow(1-k,3);               // easeOutCubic
    el.scrollTop=from+dist*e;
    if(k<1) _lyrRaf=requestAnimationFrame(step);
    else _lyrRaf=null;
  };
  _lyrRaf=requestAnimationFrame(step);
}
function _lyrScroll(el,row,instant){
  if(!el||!row) return;
  const target=Math.round(row.offsetTop+row.offsetHeight/2-el.clientHeight/2);
  const top=Math.max(0,Math.min(el.scrollHeight-el.clientHeight,target));
  el._want=top;
  if(Math.abs(top-el.scrollTop)<2) return;
  el._auto=true;                        // 내가 굴린 스크롤은 '수동'으로 치지 않는다
  clearTimeout(el._autoT);
  el._autoT=setTimeout(()=>{ el._auto=false; },instant?80:900);
  if(instant){                           // 첫 렌더·리사이즈는 바로 (빈 화면이 안 보이게)
    if(_lyrRaf){ cancelAnimationFrame(_lyrRaf); _lyrRaf=null; }
    el.scrollTop=top;
  }else{
    _lyrAnimate(el, top);                // 재생 중에는 부드럽게
  }
}
addEventListener('resize',()=>{ const el=$('mpBLyr');
  if(el&&!el._plain){ el._pad=0; fitLyrPads(el); syncLyrics(true); } });
// 11.7 · 창 크기가 바뀌어도(플레이어 리사이즈·글꼴 로딩) 가운데를 다시 잡는다
try{
  if(window.ResizeObserver){
    const _lyrRO=new ResizeObserver(()=>{
      const el=$('mpBLyr');
      if(el&&!el._plain&&!P._lyrManual){ el._pad=0; fitLyrPads(el); syncLyrics(true); }
    });
    const _bb=document.getElementById('mpBBody');
    if(_bb) _lyrRO.observe(_bb);
  }
}catch(e){}
A.addEventListener('timeupdate',()=>{ if(P.bigTab==='y') syncLyrics(); });
// 12.1 · timeupdate 는 약 250ms 간격이라 랩·빠른 곡에서 가사가 밀린다.
//        가사 탭이 열려 있고 재생 중일 때 100ms 간격으로 한 번 더 맞춰 준다.
setInterval(()=>{
  if(P.bigTab!=='y'||A.paused) return;
  syncLyrics();
},100);

// ── 대기열: 다음에 재생 ──
function queueNext(id){
  const t=P.list.find(x=>x.id===id); if(!t) return;
  const curId=cur()&&cur().id;
  if(!P.queue){
    const base=curList().slice();
    P.queue=base.length?base:[t];
  }
  // 이미 대기열에 있으면 앞으로 당겨온다
  const k=P.queue.findIndex(x=>x.id===id);
  if(k>=0) P.queue.splice(k,1);
  const at=P.queue.findIndex(x=>x.id===curId);
  P.queue.splice(at<0?Math.max(0,P.idx):at+1,0,t);
  const ki=P.queue.findIndex(x=>x.id===curId);
  if(ki>=0) P.idx=ki;
  // 14.14 · '다음에 재생'은 섞기 중에도 바로 다음에 나와야 한다 → 기록에서 빼 둔다
  const h=_qHistory(); const hk=h.indexOf(id); if(hk>=0) h.splice(hk,1);
  P._forceNext=id;
  try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(e){}
  renderListPop(); saveMusicState(true);
  toast('다음에 재생합니다',1300);
}
// ── 18.3 · 곡을 누르면 '대기열에 담고 바로 재생' ──
//   기존 대기열은 그대로 두고, 이 곡을 대기열 끝에 담아 재생한다.
//   (이미 대기열에 있으면 중복 없이 그 자리로 이동해 재생한다)
function queueAdd(id){
  const t=P.list.find(x=>x.id===id); if(!t) return;
  const q=Array.isArray(P.queue)?P.queue.slice():[];
  let k=q.findIndex(x=>x.id===id);
  let added=false;
  if(k<0){ q.push(t); k=q.length-1; added=true; }
  P.queue=q;
  P._forceNext='';        // 수동 선택이므로 예약된 '다음에 재생'을 무시한다
  playIdx(k);
  saveMusicState(true);
  try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(e){}
  try{ renderListPop(); }catch(e){}
  if(added&&window.toast) toast('대기열에 담고 재생할게요',1100);
}
try{ window.sdyQueueAdd=queueAdd; }catch(e){}
// 곡 목록(P.queue)이 바뀐 뒤 현재 곡 인덱스를 다시 맞춘다
function _qSyncIdx(){
  const L=_qTracks();
  const cid=(A&&A._trackId)||P.currentId;
  const k=cid?L.findIndex(t=>t.id===cid):-1;
  P.idx=k>=0?k:Math.max(0,Math.min(L.length-1,P.idx||0));
}
// ── 18.3 · 대기열 관리 (위로 / 아래로 / 빼기) ──
function queueMove(i,d){
  const q=Array.isArray(P.queue)?P.queue.slice():[];
  const at=Math.max(0,Math.min(q.length-1,+i||0));
  const to=at+(+d||0);
  if(!q.length||to<0||to>=q.length) return;
  const t=q.splice(at,1)[0]; q.splice(to,0,t);
  P.queue=q; _qSyncIdx();
  saveMusicState(true);
  try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(e){}
  try{ renderListPop(); }catch(e){}
}
function queueRemove(i){
  const q=Array.isArray(P.queue)?P.queue.slice():[];
  const at=+i||0;
  if(!q.length||at<0||at>=q.length) return;
  q.splice(at,1);
  P.queue=q.length?q:null;
  _qSyncIdx();
  saveMusicState(true);
  try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(e){}
  try{ renderListPop(); }catch(e){}
}
function queueClear(){
  // 재생 중인 곡은 남기고 나머지를 비운다 → '다음 곡'이 라이브러리로 새지 않는다
  const cid=(A&&A._trackId)||P.currentId;
  const keep=(cid&&(P.list||[]).find(t=>t.id===cid))||null;
  P.queue=keep?[keep]:null;
  P.idx=0; _qResetCycle(keep&&keep.id);
  saveMusicState(true);
  try{ if(mpbEl&&mpbEl.classList.contains('open')) renderBigList(); }catch(e){}
  try{ renderListPop(); }catch(e){}
  if(window.toast) toast('대기열을 비웠어요 · 지금 곡은 계속 재생돼요',1600);
}
try{ window.sdyQueueMove=queueMove; window.sdyQueueRemove=queueRemove; window.sdyQueueClear=queueClear; }catch(e){}
// ── 업로드 뒤 그 곡이 있는 페이지로 이동 ──
function gotoTrackPage(id){
  const i=P.list.findIndex(t=>t.id===id); if(i<0) return;
  P.bigTab='l'; P.bigPage=Math.floor(i/14); P.lpage=Math.floor(i/10);
  renderBigList();
}
// ── 큰 플레이어: 닫힘 애니메이션 ──
function closeBig(){
  const b=$('mpBig');
  // 전체 화면이면 같이 끈다 (다음에 열 때 창 모드로)
  try{ if(mpbFsEl()===b) (document.exitFullscreen||document.webkitExitFullscreen||function(){}).call(document); }catch(e){}
  if(b.classList.contains('mpb-fs')) mpbFakeFs(false);
  if(b.classList.contains('open')&&!b.classList.contains('closing')){
    b.classList.add('closing');
    setTimeout(()=>{ b.classList.remove('open','closing'); refreshBarVis(); },250);
    return;
  }
  b.classList.remove('open','closing'); refreshBarVis();
}
// ── 바깥 공간을 누르면 컨트롤 바로 작아지기 ──
document.addEventListener('pointerdown',e=>{
  if(!$('mpBig').classList.contains('open')) return;
  if(e.target.closest('#mpBig,#mpCtx,#mpTagModal,#mpCoverFile,#mpAddPop')) return;
  if(e.target.closest('#musicPlayer,#musicListPop,#mpReopen,#plPickPop,#mpVolPop')) return;
  if(e.target.closest('#ypApp,#ypReopen,#ypZoom')) return;
  closeBig();
},true);

// 외부(테스트·연동)에서 쓸 수 있는 최소 손잡이 — 노출해도 안전한 것만
window.sdyMusic={play:i=>playIdx(i), big:openBig, small:()=>pl, refresh:loadList,
                   list:()=>P.list, cur:()=>cur(), menu:openTrackMenu,
                   audio:()=>A,
                   ensureLyrics:t=>ensureLyrics(t),
                   syncLine:function(){
                     const t=cur();
                     const raw=t&&t.lyrics;
                     if(!(raw&&String(raw).indexOf('[')>=0)) return null;
                     const lrc=parseLRC(raw);
                     if(!lrc||!lrc.length) return null;
                     const tt=(A.currentTime||0)+0.08;
                     let idx=-1;
                     for(let i=0;i<lrc.length;i++){
                       if(tt>=+(lrc[i].t||0)) idx=i; else break;
                     }
                     // 18.6 · '말 안 하는 구간' 판정 —
                     //   ① 첫 줄 전(전주) ② 빈 줄(간주) ③ 그 줄을 다 부르고도
                     //   다음 줄까지 한참 남은 사이(간주). 이때 gap:true 를 주면
                     //   말풍선이 사라졌다가 다음 가사에 다시 뜬다.
                     let gap=false;
                     if(idx<0){ idx=0; gap=true; }
                     else{
                       const st=+(lrc[idx].t||0);
                       const txt=String(lrc[idx].s||'').replace(/\s+/g,' ').trim();
                       const nx=lrc[idx+1]?+(lrc[idx+1].t||0):Infinity;
                       // 그 줄을 부르는 데 걸릴 법한 시간 (글자 수 기준, 1.2~6초)
                       const need=Math.max(1.2,Math.min(6,0.9+txt.length*0.22));
                       const sungTill=Math.min(st+need,nx);
                       if(!txt) gap=true;                       // 빈 줄 = 간주
                       else if(tt>sungTill+0.35) gap=true;      // 다 부르고 남은 사이
                     }
                     return {track:t, idx, line:lrc[idx], lines:lrc, gap:gap};
                   },
                   queueNext:queueNext, gotoPage:gotoTrackPage, toggle:pp,
                   state:()=>({tab:P.bigTab,page:P.bigPage}), tagEditor:openTagEditor,
                   bigList:renderBigList, lyrics:renderLyrics, sync:syncLyrics,
                   // 14.26.0 · 해돌이 앱 실행용 — 일시정지·다음/이전 곡·볼륨·큰 화면 닫기
                   pause:()=>{ smoothPause(); }, next:()=>playNext(), prev:()=>playPrev(),
                   vol:v=>setVol(v), closeBig:()=>closeBig(),
                   eq: sdyEqObj,
                   _state:()=>P};
})();
