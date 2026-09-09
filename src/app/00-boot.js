/* === src/app/00-boot.js ===
   글꼴 지연로드 · FLOAT-BOUNDS · 음악 칩
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:00-boot.js:BEGIN */
/* 분리된 JS */

/*
   번역/AI 편집 도우미는 원래 별도 src/translate.js 에서 노출된다.
   sdynotes.js 는 오프라인·단일 파일로도 먼저 실행될 수 있으므로, 번역
   스크립트가 아직 로드되지 않은 순간에도 앱 파트가 ReferenceError 로
   죽지 않게 작은 지연 브리지를 둔다. translate.js 가 준비되면 같은
   이름의 window.* 구현으로 자동 위임한다.
*/
function sdyTranslateBridge(name,args,fallback){
    try{
        const fn=window[name];
        if(typeof fn==='function') return fn.apply(window,args||[]);
    }catch(e){}
    return typeof fallback==='function'?fallback():undefined;
}
function sdyFallbackHtmlText(value){
    const raw=String(value==null?'':value);
    try{
        const box=document.createElement('div'); box.innerHTML=raw;
        return String(box.textContent||'').replace(/\u00a0/g,' ');
    }catch(e){ return raw.replace(/<br\s*\/?>(?=.)/gi,'\n').replace(/<[^>]*>/g,''); }
}
const plainTextFromHtml=(value)=>sdyTranslateBridge('plainTextFromHtml',[value],()=>sdyFallbackHtmlText(value));
const tightTextFromHtml=(value)=>sdyTranslateBridge('tightTextFromHtml',[value],()=>sdyFallbackHtmlText(value));
const tightSelectionText=(selection)=>sdyTranslateBridge('tightSelectionText',[selection],()=>String(selection||''));
const fitTranslated=(...args)=>sdyTranslateBridge('fitTranslated',args,()=>{});
const collectPageEls=(...args)=>sdyTranslateBridge('collectPageEls',args,()=>[]);
const aiEditStrokeBox=(el)=>sdyTranslateBridge('aiEditStrokeBox',[el],()=>{
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    (el&&el.pts||[]).forEach(pt=>{
        if(!pt||!Number.isFinite(+pt[0])||!Number.isFinite(+pt[1])) return;
        x1=Math.min(x1,+pt[0]); y1=Math.min(y1,+pt[1]);
        x2=Math.max(x2,+pt[0]); y2=Math.max(y2,+pt[1]);
    });
    if(!Number.isFinite(x1)) x1=y1=x2=y2=0;
    const dx=+(el&&el.dx)||0,dy=+(el&&el.dy)||0;
    return {x:x1+dx,y:y1+dy,w:Math.max(0,x2-x1),h:Math.max(0,y2-y1),baseX:x1,baseY:y1};
});
const aiEditBox=(el)=>sdyTranslateBridge('aiEditBox',[el],()=>{
    if(el&&el.type==='stroke') return aiEditStrokeBox(el);
    return {x:+(el&&el.x)||0,y:+(el&&el.y)||0,w:+(el&&el.w)||0,h:+(el&&el.h)||0};
});
const aiEditText=(el)=>sdyTranslateBridge('aiEditText',[el],()=>{
    if(!el) return '';
    return el.type==='latex'?String(el.latex||''):
        el.type==='text'?plainTextFromHtml(el.html):'';
});
const aiEditSnapshot=(...args)=>sdyTranslateBridge('aiEditSnapshot',args,()=>{
    const d=window._sdy&&window._sdy.doc;
    if(!d||!Array.isArray(d.pages)) return '';
    const lines=[];
    d.pages.forEach((pg,pi)=>{
        (pg&&pg.els||[]).forEach(el=>{
            if(!el||!el.id) return;
            const b=aiEditBox(el);
            const kind=el.type==='stroke'?'그림획':(el.type==='image'?'사진':(el.type==='latex'?'수식':'글상자'));
            lines.push('  id='+el.id+' type='+kind+' x='+Math.round(b.x)+' y='+Math.round(b.y)
                +' w='+Math.round(b.w)+' h='+Math.round(b.h)
                +(el.type==='text'?' text='+JSON.stringify(aiEditText(el)):'')
                +(el.type==='stroke'&&el.color?' pen='+el.color:''));
        });
        if(!pg||!(pg.els||[]).length) lines.push('  ('+(pi+1)+'쪽 빈 쪽)');
    });
    return lines.join('\\n');
});
const aiEditRevision=(...args)=>sdyTranslateBridge('aiEditRevision',args,()=>{
    try{ return String(JSON.stringify(window._sdy&&window._sdy.doc)||''); }catch(e){ return ''; }
});

/* === script block 1 === */

    // 장식 글꼴(손글씨·제목용 12종)은 첫 화면을 그린 뒤에 받는다.
    // head 에서 한꺼번에 받으면 폰에서 시작이 눈에 띄게 느려진다.
    // (글꼴 메뉴를 먼저 열면 buildFontMenu 가 sdyLoadUiFonts() 로 즉시 당겨 온다)
    (function(){
      var href='https://fonts.googleapis.com/css2'
        +'?family=Gaegu:wght@400;700&family=Jua&family=Nanum+Pen+Script'
        +'&family=Nanum+Myeongjo:wght@400;700&family=Do+Hyeon&family=Gowun+Dodum'
        +'&family=Poor+Story&family=Black+Han+Sans&family=Nanum+Gothic+Coding'
        +'&family=Inter:wght@400;600;700&family=Roboto+Mono'
        +'&family=Playfair+Display:wght@400;700&family=Caveat:wght@400;700&display=swap';
      var done=false;
      function load(){
        if(done) return; done=true;
        var l=document.createElement('link');
        l.rel='stylesheet'; l.href=href; document.head.appendChild(l);
      }
      window.sdyLoadUiFonts=load;   // 글꼴 메뉴가 열릴 때 필요하면 즉시 부른다 (멱등)
      if('requestIdleCallback' in window) requestIdleCallback(load,{timeout:2500});
      else addEventListener('load',function(){ setTimeout(load,300); });
    })();
    

/* === script block 2 === */

/* ══ 플로팅 창 공용 · '모니터 안쪽' 경계 규칙 ═════════════════════════════
   엽스코드 · 단어카드 · 음악플레이어 … 모든 플로팅 창은 position:fixed 이고
   style.left/top 에 'UI CSS px' 라는 단위를 쓴다. 데스크톱은 html{zoom:.9} 를
   쓰기 때문에 이 단위가 화면 px(clientX·getBoundingClientRect) 와 0.9:1 로
   어긋난다. 창과 화면을 같은 단위로 맞춰 재야 하는 이유다.

   예전엔 화면 폭·높이를 window.innerWidth / documentElement.clientWidth /
   visualViewport 를 섞어 '추정'했다. 이 셋의 단위는 브라우저·배율·스크롤바·
   pinch 에 따라 제각각이라, 추정치가 실제보다 작아지면 오른쪽(아래) 10% 가량이
   창이 갈 수 없는 영역으로 남았다. → 추정을 버리고 직접 잰다.
   창과 똑같은 position:fixed 좌표계에 자 두 개를 붙인다.
       · 100px 자     : 화면 px ↔ UI CSS px 배율을 그때그때 직접 잰다
       · 화면 가득 자 : 창들이 실제로 다닐 수 있는 사각형
   두 자는 같은 공간에서 재므로 브라우저가 zoom 을 어느 API 에 반영하든 비율이
   맞는다. 그래서 배율·브라우저·디바이스 종류와 무관하게 이동범위는 항상
   모니터(뷰포트) 안쪽 전체이고, 밖으로는 한 픽셀도 나가지 않는다.

   ▼ FLOAT-BOUNDS 마커는 test/floating_window_bounds_zoom_sim.mjs 가 이 블록만
     뽑아 가짜 브라우저 환경(엔진마다 단위가 다른 상황)에서 돌린다.
     마커를 지우거나 사이를 뜯어내면 테스트가 실패한다. */
/* FLOAT-BOUNDS:BEGIN */

window.sdyUiCssZoom=(function(){
    var probe=null;
    return function(){
        try{
            if(!probe||!probe.isConnected){
                probe=document.getElementById('uiZoomProbeGlobal');
                if(!probe){
                    probe=document.createElement('div');
                    probe.id='uiZoomProbeGlobal';
                    probe.setAttribute('aria-hidden','true');
                    probe.style.cssText='position:fixed;left:0;top:0;width:100px;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
                    (document.body||document.documentElement).appendChild(probe);
                }
            }
            var w=probe.getBoundingClientRect().width;
            var k=w?w/100:1;
            return (k>0.05&&k<20)?k:1;
        }catch(e){ return 1; }
    };
})();
/* 화면 px → 창이 쓰는 UI CSS px */
window.sdyUiCss=function(v){ return (Number(v)||0)/window.sdyUiCssZoom(); };

/* 창이 다닐 수 있는 화면 사각형 {w,h}. 단위: 창과 동일한 UI CSS px.
   rect 실측과 offsetWidth 중 큰 쪽을 쓴다 — 어떤 엔진은 offsetWidth 에 배율을
   씌워 리포트하므로 둘 중 하나는 반드시 '창이 쓰는 단위' 이다.
   짧게 재서 오른쪽이 잘리는 것이 가장 나쁜 실패다. */
window.sdyViewportBox=(function(){
    var probe=null, cached=null, cachedAt=-1e9;
    /* 화면 px 로 리포트되는 값인지 UI CSS px 로 리포트되는 값인지 알 수 없는
       신호(innerWidth) 는 두 해석 중 큰 쪽을 택한다. */
    function toUi(v){
        v=Number(v)||0;
        if(!(v>0)) return 0;
        return Math.max(v,v/window.sdyUiCssZoom());
    }
    return function(){
        /* 드래그 중엔 pointermove 때마다 불린다. 레이아웃 읽기를 최대 1 프레임
           (8ms) 만 재사용한다 — 판정이 매 이동 다시 돌므로 어긋남이 누적되지 않는다. */
        var now=(window.performance&&window.performance.now)?window.performance.now():Date.now();
        if(cached&&now-cachedAt<8) return cached;
        var w=0,h=0;
        try{
            if(!probe||!probe.isConnected){
                probe=document.getElementById('uiViewportProbeGlobal');
                if(!probe){
                    probe=document.createElement('div');
                    probe.id='uiViewportProbeGlobal';
                    probe.setAttribute('aria-hidden','true');
                    probe.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;'+
                        'margin:0;padding:0;border:0;overflow:hidden;visibility:hidden;pointer-events:none;';
                    (document.body||document.documentElement).appendChild(probe);
                }
            }
            var r=probe.getBoundingClientRect();
            w=Math.max(Math.round(window.sdyUiCss(r.width)),Math.round(probe.offsetWidth)||0);
            h=Math.max(Math.round(window.sdyUiCss(r.height)),Math.round(probe.offsetHeight)||0);
        }catch(e){}
        if(!(w>0)||!(h>0)){
            /* 아직 레이아웃이 안 잡힌 첫 프레임·프로브 미지원 엔진에서만 여기 온다. */
            var de=document.documentElement, vv=window.visualViewport;
            if(!(w>0)) w=Math.max(toUi(window.innerWidth),toUi(vv&&vv.width),(de&&de.clientWidth)||0);
            if(!(h>0)) h=Math.max(toUi(window.innerHeight),toUi(vv&&vv.height),(de&&de.clientHeight)||0);
        }
        cached={w:Math.round(w)||0,h:Math.round(h)||0}; cachedAt=now;
        return cached;
    };
})();

/* 창 하나를 화면 안으로 잡아둔다. x,y 는 창이 쓰려는 style.left/top(UI CSS px),
   반환도 같은 단위. 벗어나는 벽만 되돌리므로 창이 화면 밖으로 나가도
   드래그 한 번으로 도로 잡을 수 있다. 폭·높이는 창 자신의 실측을 쓰므로
   창이 화면보다 크면(저 해상도·전체화면 모핑) 양 벽에 눌리지 않고 0 부터 닮는다.
   재는 데 실패하면 손대지 않고 그대로 돌려준다 — 0 으로 붙이면 창이 왼쪽
   벽에 달라붙는 별개의 버그가 된다. */
window.sdyClampFloatingRect=function(el,x,y,gap){
    gap=Number.isFinite(gap)?Math.max(0,gap):8;
    var vp=window.sdyViewportBox(), vw=vp.w, vh=vp.h;
    var out={x:Number(x)||0,y:Number(y)||0};
    if(!(vw>0)||!(vh>0)) return out;
    var r=el?el.getBoundingClientRect():null;
    var w=Math.max(el?(el.offsetWidth||0):0,r?Math.round(window.sdyUiCss(r.width)):0);
    var h=Math.max(el?(el.offsetHeight||0):0,r?Math.round(window.sdyUiCss(r.height)):0);
    var minX=w+gap*2<=vw?gap:0, minY=h+gap*2<=vh?gap:0;
    var maxX=Math.max(minX,vw-w-minX), maxY=Math.max(minY,vh-h-minY);
    return {x:Math.max(minX,Math.min(maxX,out.x)),
            y:Math.max(minY,Math.min(maxY,out.y))};
};
/* FLOAT-BOUNDS:END */


/* 12.0 · 음악 플로팅 칩을 페이지 첫 페인트 때 바로 띄운다 (로딩·곡 목록과 무관).
   본문 맨 뒤의 뮤직플레이어 스크립트가 돌기 전에 칩이 먼저 보여야 한다. */
(function(){
  var chip=document.createElement('button');
  chip.id='mpReopen'; chip.title='음악 켜기';
  chip.innerHTML='<i class="ri-music-2-fill"></i>';
  chip.onclick=function(){
    var pl=document.getElementById('musicPlayer');
    if(pl) pl.style.display='flex';
    chip.style.display='none';
    try{ window.__mpChipOpened=true; }catch(e){}
  };
  document.body.appendChild(chip);
  chip.style.display='flex';
})();


/* APP-PART:00-boot.js:END */
