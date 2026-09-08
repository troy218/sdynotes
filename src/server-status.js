/* 서버 상태 계기판 + 알림 센터 — sdynotes.js 에서 분리
   의존: window.esc · window.pullSettings · window.flushCardGrades · window.SET_DEV */
(function(){
  if(window.__sdyServerStatusInit) return; window.__sdyServerStatusInit=true;
  if(typeof window.esc!=='function'){
    window.esc=function(s){ var d=document.createElement('div'); d.textContent=s==null?'':s; return d.innerHTML; };
  }

// ===== 서버 상태 계기판 =====
// 점수(0~100)를 자동차 계기판처럼 바늘+색으로 보여 준다.
let _srvTimer=null, _srvLast=null;
function srvPaint(d){
    _srvLast=d;
    const g=document.getElementById('srvGauge');
    if(!g) return;
    const score=Math.max(0,Math.min(100,d&&d.score!=null?d.score:0));
    const lvl=(d&&d.level)||'bad';
    g.classList.toggle('good',lvl==='good');
    g.classList.toggle('warn',lvl==='warn');
    g.classList.toggle('bad', lvl==='bad');
    // 반원(180°) 위에서 점수 위치로 바늘을 돌린다.
    // 0점=왼쪽 끝(-90°), 100점=오른쪽 끝(+90°)
    const nd=document.getElementById('srvNeedle');
    if(nd) nd.style.transform='rotate('+(-90+score*1.8).toFixed(1)+'deg)';
    g.title=`서버 ${score}점 · ${(d&&d.reason)||''}`;
    // 팝오버가 열려 있으면 같이 갱신
    if(document.getElementById('srvPop').classList.contains('show')) srvFill(d);
}
function srvFill(d){
    d=d||{};
    const pop=document.getElementById('srvPop');
    const lvl=d.level||'bad';
    pop.classList.toggle('warn',lvl==='warn');
    pop.classList.toggle('bad', lvl==='bad');
    document.getElementById('srvTitle').textContent=
        lvl==='good'?'서버 원활':lvl==='warn'?'서버 다소 바쁨':'서버 부하 높음';
    document.getElementById('srvReason').textContent=
        (d&&d.reason?d.reason:'')+(d&&d.score!=null?` · ${d.score}점`:'');
    const set=(bar,val,pct,txt)=>{
        const b=document.getElementById(bar), v=document.getElementById(val);
        if(!b||!v) return;
        const raw=Number(pct);
        const p=Number.isFinite(raw)?Math.max(0,Math.min(100,raw)):0;
        b.style.setProperty('--srv-pct',String(p/100));
        b.dataset.value=String(Math.round(p));
        const track=b.parentElement;
        if(track){
            track.setAttribute('role','progressbar');
            track.setAttribute('aria-valuemin','0');
            track.setAttribute('aria-valuemax','100');
            track.setAttribute('aria-valuenow',String(Math.round(p)));
        }
        b.classList.toggle('w',p>=70&&p<88);
        b.classList.toggle('b',p>=88);
        v.textContent=txt;
    };
    set('srvCpuBar','srvCpuVal',d.cpu, d.cpu==null?'–':d.cpu+'%');
    set('srvMemBar','srvMemVal',d.mem,
        d.mem==null?'–':(d.memTotalGB?`${d.mem}% / ${d.memTotalGB}GB`:d.mem+'%'));
    set('srvDiskBar','srvDiskVal',d.disk,
        d.disk==null?'–':(d.diskFreeGB!=null?`${d.diskFreeGB}GB 남음`:d.disk+'%'));
    const up=d.uptime||0;
    const upTxt=up>86400?Math.floor(up/86400)+'일':up>3600?Math.floor(up/3600)+'시간':Math.floor(up/60)+'분';
    document.getElementById('srvExtra').textContent=
        `변환 ${d.jobs||0}건 · 분당 요청 ${d.rpm||0} · 접속 ${_notifOnline||1}명 · 가동 ${upTxt}`;
}
// 14.39.4 · '창이 닫힌 뒤 깨어난 폴링' 방어.
//   이 모듈은 setInterval/await 로 혼자 계속 돈다. 화면(문서)이 사라진 뒤에
//   그 이어서 실행(continuation)이 깨어나면 document 가 undefined 라
//   TypeError 가 나고, jsdom 런타임 테스트에서는 프로세스 자체가 죽어
//   다 통과한 그룹이 간헐적으로 실패(= CI 깜빡임)로 잡혔다.
//   화면이 없으면 아무것도 그리지 않고 조용히 돌아온다.
function _docGone(){ return typeof document==='undefined'||!document; }
async function srvPoll(){
    try{
        const r=await fetch('/api/server/stat',{cache:'no-store'});
        const d=await r.json();
        if(_docGone()) return;
        if(d&&d.ok) srvPaint(d);
    }catch(e){
        if(_docGone()) return;
        srvPaint({score:0,level:'bad',reason:'서버에 연결할 수 없습니다',jobs:0,rpm:0});
    }
}
function openSrvPop(e){
    e&&e.stopPropagation();
    const cm=document.getElementById('cardsModal');
    if(cm&&cm.style.display==='flex') return;   // 암기 카드가 떠 있으면 무시
    const pop=document.getElementById('srvPop');
    document.getElementById('notifPop').classList.remove('show');
    if(pop.classList.contains('show')){ pop.classList.remove('show'); return; }
    if(_srvLast) srvFill(_srvLast);
    pop.classList.add('show');
    const g=document.getElementById('srvGauge').getBoundingClientRect();
    const w=pop.offsetWidth, h=pop.offsetHeight;
    pop.style.left=Math.max(8,Math.min(g.right-w, window.innerWidth-w-8))+'px';
    pop.style.top =Math.min(g.bottom+8, window.innerHeight-h-8)+'px';
    srvPoll();
}
document.addEventListener('click',e=>{
    if(!e.target.closest('#srvPop')&&!e.target.closest('#srvGauge'))
        document.getElementById('srvPop').classList.remove('show');
});
// 화면이 보일 때만 확인한다 (안 보이면 쉰다 → 배터리·부하 절약)
function srvStart(){
    clearInterval(_srvTimer);
    srvPoll();
    _srvTimer=setInterval(()=>{ if(!_docGone()&&!document.hidden) srvPoll(); },20000);
}
document.addEventListener('visibilitychange',()=>{ if(!_docGone()&&!document.hidden) srvPoll(); });

// ===== 알림 센터 + 현재 접속자 =====
let _notifItems=[], _notifOnline=1, _notifBusy=false;
function notifIcon(k){
    return ({study:'ri-brain-line',achievement:'ri-sparkling-2-line',convert:'ri-file-transfer-line',
        convert_done:'ri-file-check-line',pdf:'ri-file-pdf-2-line',error:'ri-error-warning-line',server:'ri-server-line',
        login:'ri-user-smile-line'})[k]||'ri-notification-3-line';
}
function notifAgo(ts){
    const s=Math.max(0,Date.now()/1000-(+ts||0));
    if(s<60) return '방금'; if(s<3600) return Math.floor(s/60)+'분 전';
    if(s<86400) return Math.floor(s/3600)+'시간 전';
    if(s<604800) return Math.floor(s/86400)+'일 전';
    try{ return new Date(ts*1000).toLocaleDateString('ko-KR',{month:'short',day:'numeric'}); }catch(e){ return ''; }
}
function renderNotifications(){
    const list=document.getElementById('notifList'); if(!list) return;
    if(!_notifItems.length){
        list.innerHTML='<div class="notif-empty"><i class="ri-notification-off-line" style="font-size:28px"></i><br>아직 알림이 없습니다</div>'; return;
    }
    list.innerHTML=_notifItems.map(n=>`<div class="notif-item ${n.read?'':'unread'}" data-kind="${window.esc(n.kind||'info')}">
      <div class="notif-ico"><i class="${notifIcon(n.kind)}"></i></div>
      <div class="notif-copy"><b>${window.esc(n.title||'알림')}</b>${n.message?`<p>${window.esc(n.message)}</p>`:''}<time>${notifAgo(n.ts)}</time></div>
      <button class="notif-del" onclick="deleteNotification(event,'${n.id}')" title="삭제"><i class="ri-close-line"></i></button>
    </div>`).join('');
}
async function notifPoll(){
    if(_docGone()||_notifBusy||document.hidden) return; _notifBusy=true;
    try{
        const ping=fetch('/api/presence/ping',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({device:(window.SET_DEV||'web')})}).then(r=>r.json()).catch(()=>null);
        const data=fetch('/api/notifications',{cache:'no-store'}).then(r=>r.json()).catch(()=>null);
        const [p,d]=await Promise.all([ping,data]);
        if(_docGone()) return;      // 받는 사이에 창이 닫혔다 — 그리지 않는다
        if(p&&p.ok) _notifOnline=p.online||1;
        if(d&&d.ok){ _notifItems=d.items||[]; _notifOnline=Math.max(_notifOnline,d.online||0,1); }
        const unread=_notifItems.filter(x=>!x.read).length;
        const b=document.getElementById('notifBadge');
        if(b){ b.textContent=unread>99?'99+':String(unread); b.style.display=unread?'flex':'none'; }
        const btn=document.getElementById('notifBtn'); if(btn) btn.title='알림';
        if(document.getElementById('notifPop').classList.contains('show')) renderNotifications();
    }finally{ _notifBusy=false; }
}
async function toggleNotifications(e){
    e&&e.stopPropagation();
    const pop=document.getElementById('notifPop');
    if(pop.classList.contains('show')){ pop.classList.remove('show'); return; }
    document.getElementById('srvPop').classList.remove('show');
    pop.classList.add('show');
    const r=document.getElementById('notifBtn').getBoundingClientRect();
    pop.style.left=Math.max(8,Math.min(r.right-(pop.offsetWidth||380),innerWidth-(pop.offsetWidth||380)-8))+'px';
    pop.style.top=Math.min(r.bottom+8,innerHeight-(pop.offsetHeight||500)-8)+'px';
    await notifPoll();
    // 알림창에 들어온 순간 모두 읽음. 기록은 지우지 않는다.
    _notifItems.forEach(x=>x.read=true); renderNotifications();
    const b=document.getElementById('notifBadge'); if(b) b.style.display='none';
    fetch('/api/notifications/read',{method:'POST'}).catch(()=>{});
}
async function deleteNotification(e,id){
    e&&e.stopPropagation();
    _notifItems=_notifItems.filter(x=>x.id!==id); renderNotifications();
    await fetch('/api/notifications/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}).catch(()=>{});
}
async function clearReadNotifications(){
    _notifItems=_notifItems.filter(x=>!x.read); renderNotifications();
    await fetch('/api/notifications/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clear_read:true})}).catch(()=>{});
}
document.addEventListener('click',e=>{
    if(!e.target.closest('#notifPop')&&!e.target.closest('#notifBtn')) document.getElementById('notifPop').classList.remove('show');
});
setInterval(()=>{ if(!_docGone()&&!document.hidden) notifPoll(); },25000);
document.addEventListener('visibilitychange',()=>{ if(!_docGone()&&!document.hidden){ notifPoll(); window.flushCardGrades&&window.flushCardGrades(); window.pullSettings&&window.pullSettings(); } });
setTimeout(notifPoll,1200);

// ── 외부 노출 ──
try{ window.openSrvPop=openSrvPop; }catch(e){}
try{ window.srvStart=srvStart; }catch(e){}
try{ window.srvPoll=srvPoll; }catch(e){}
try{ window.srvPaint=srvPaint; }catch(e){}
try{ window.srvFill=srvFill; }catch(e){}
try{ window.toggleNotifications=toggleNotifications; }catch(e){}
try{ window.notifPoll=notifPoll; }catch(e){}
try{ window.deleteNotification=deleteNotification; }catch(e){}
try{ window.clearReadNotifications=clearReadNotifications; }catch(e){}
try{ window.renderNotifications=renderNotifications; }catch(e){}
})();
