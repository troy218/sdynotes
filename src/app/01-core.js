/* === src/app/01-core.js ===
   sandbox · SDB · 문서모델 · 팔레트 · toast/esc/uid
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:01-core.js:BEGIN */
/* === script block 3 === */

    // ============ 9.4 · 시험 모드 (개발/테스트 격리) ============
    //  ?sandbox=1 로 열면 이 탭은 '연습용'이 된다.
    //   · localStorage 를 sdybox: 접두사가 붙은 별도 공간에 쓴다
    //   · 서버 설정 동기화는 __settings_sandbox__ 네임스페이스로 간다
    //   · Supabase(실제 노트 DB)에는 아예 연결하지 않는다
    //  → 앞으로 어떤 테스트도 실제 북마크·재생목록·폴더를 건드릴 수 없다.
    const SANDBOX=(()=>{ try{
        return /[?&]sandbox=1/.test(location.search)||sessionStorage.getItem('sdy_sandbox')==='1';
    }catch(e){ return false; } })();
    try{ window.SANDBOX=SANDBOX; }catch(e){}
    if(SANDBOX){
        try{ sessionStorage.setItem('sdy_sandbox','1'); }catch(e){}
        // 눈에 보이는 표시 — 이 탭이 연습용임을 착각하지 않게
        addEventListener('DOMContentLoaded',()=>{
            const d=document.createElement('div');
            d.textContent='시험 모드 · 실제 데이터와 분리된 연습용 화면입니다';
            d.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;'+
                'background:#7c3aed;color:#fff;font-size:12px;text-align:center;'+
                'padding:5px 8px;letter-spacing:.02em;pointer-events:none;';
            document.body.appendChild(d);
        });
        // localStorage 를 접두사 공간으로 격리 (실제 데이터와 물리적으로 분리)
        (function(){
            const P='sdybox:', real=window.localStorage;
            const box={
                getItem:k=>real.getItem(P+k),
                setItem:(k,v)=>real.setItem(P+k,v),
                removeItem:k=>real.removeItem(P+k),
                clear:()=>{ Object.keys(real).filter(k=>k.indexOf(P)===0).forEach(k=>real.removeItem(k)); },
                key:i=>{ const ks=Object.keys(real).filter(k=>k.indexOf(P)===0); return ks[i]?ks[i].slice(P.length):null; },
                get length(){ return Object.keys(real).filter(k=>k.indexOf(P)===0).length; }
            };
            try{ Object.defineProperty(window,'localStorage',{configurable:true,get:()=>box}); }catch(e){}
        })();
    }
    // ============ 로컬 DB (오라클 서버 /api/db) ============
    // 14.12 · 노트 목록/본문(notebooks·memos·images)을 예전엔 Supabase 에
    // 브라우저에서 직접 저장했지만, 이제 이 서버의 /api/db/query 가 담당한다.
    // 기존 코드가 그대로 동작하도록 supabase-js 와 같은 체인(select/eq/in/
    // order/limit/insert/update/delete/single)을 쿼리 descriptor 로 직렬화한다.
    let SB=null;
    const SDB={
        createClient(){
            const from=(table)=>{
                const q={table,op:'select',columns:null,filters:[],order:null,
                         limit:0,values:null,single:false,returning:false};
                let _p=null;
                const run=()=>{
                    if(_p) return _p;
                    _p=(async()=>{
                        try{
                            const r=await fetch('/api/db/query',{
                                method:'POST',
                                headers:{'Content-Type':'application/json','x-sdy-db':'1'},
                                body:JSON.stringify(q)
                            });
                            let j=null;
                            try{ j=await r.json(); }catch(e){}
                            if(!r.ok||!j) return {data:null,error:{message:(j&&j.error&&j.error.message)||('HTTP '+r.status)}};
                            return {data:(j.data===undefined?null:j.data),error:j.error||null};
                        }catch(e){ return {data:null,error:{message:String(e&&e.message||e)}}; }
                    })();
                    return _p;
                };
                const c={
                    select(cols){
                        if(q.op==='insert'||q.op==='update'){ q.returning=true; return c; }
                        q.op='select';
                        q.columns=(typeof cols==='string')?cols.split(',').map(s=>s.trim()).filter(Boolean):null;
                        return c;
                    },
                    single(){ q.single=true; return c; },
                    eq(f,v){ q.filters.push({op:'eq',field:f,value:v}); return c; },
                    in(f,arr){ q.filters.push({op:'in',field:f,value:arr}); return c; },
                    order(f,opts){ q.order={field:f,asc:!(opts&&opts.ascending===false)}; return c; },
                    limit(n){ q.limit=parseInt(n,10)||0; return c; },
                    insert(rows){ q.op='insert'; q.values=rows; return c; },
                    update(vals){ q.op='update'; q.values=vals; return c; },
                    delete(){ q.op='delete'; return c; },
                    then(onF,onR){ return run().then(onF,onR); },
                    catch(onR){ return run().catch(onR); },
                    finally(fn){ return run().finally(fn); }
                };
                return c;
            };
            return {from};
        }
    };
    try{
        if(!SANDBOX){    // 시험 모드에서는 실제 노트 DB에 연결하지 않는다
            SB=SDB.createClient();
        }
    }catch(err){ console.warn('로컬 DB 초기화 실패:',err); }

    const SIZE_PRESETS={
        a4_portrait:{label:'A4 세로',w:800,h:1100},
        a4_landscape:{label:'A4 가로',w:1100,h:800},
        mobile_portrait:{label:'모바일 세로',w:520,h:1100},
        mobile_landscape:{label:'모바일 가로',w:1100,h:520},
        square:{label:'정사각',w:900,h:900},
        wide:{label:'와이드',w:1280,h:720}
    };
    // 선택 가능한 글꼴 — ko: 한국어 이름, en: 영어 이름.
    //   글꼴 메뉴는 ko + en 을 '해당 글꼴 자체'로 그린다 (예시 문구 abc 가나다 대신).
    //   label 은 툴바·토스트용 짧은 이름 (한국어 우선, 영어 글꼴은 영어).
    const FONTS=[
        {id:'pretendard',label:'프리텐다드',ko:'프리텐다드',en:'Pretendard',css:"'Pretendard Variable','Pretendard',sans-serif"},
        {id:'gaegu',  label:'개구쟁이',ko:'개구쟁이',en:'Gaegu',css:"'Gaegu','Pretendard Variable',cursive"},
        {id:'jua',    label:'주아',ko:'주아',en:'Jua',css:"'Jua','Pretendard Variable',sans-serif"},
        {id:'pen',    label:'나눔손글씨',ko:'나눔손글씨',en:'Nanum Pen Script',css:"'Nanum Pen Script','Pretendard Variable',cursive"},
        {id:'dohyeon',label:'도현',ko:'도현',en:'Do Hyeon',css:"'Do Hyeon','Pretendard Variable',sans-serif"},
        {id:'gowun',  label:'고운돋움',ko:'고운돋움',en:'Gowun Dodum',css:"'Gowun Dodum','Pretendard Variable',sans-serif"},
        {id:'poor',   label:'푸어스토리',ko:'푸어스토리',en:'Poor Story',css:"'Poor Story','Pretendard Variable',cursive"},
        {id:'blackhan',label:'검은고딕',ko:'검은고딕',en:'Black Han Sans',css:"'Black Han Sans','Pretendard Variable',sans-serif"},
        {id:'myeongjo',label:'나눔명조',ko:'나눔명조',en:'Nanum Myeongjo',css:"'Nanum Myeongjo',serif"},
        // ※ 실제 글꼴 이름을 먼저, 번들 대체(유사)글꼴은 뒤에 두어, OS 에 그 글꼴이
        //   있으면 진짜 그 글꼴로 그린다(라벨=실제 모습 일치). 없으면 아래 유사글꼴로 대체.
        {id:'times',  label:'Times New Roman',ko:'타임스 뉴 로먼',en:'Times New Roman',css:"'Times New Roman','Liberation Serif','SDY Times','Nanum Myeongjo',serif"},
        {id:'cmroman',label:'Computer Modern',ko:'컴퓨터 모던',en:'Computer Modern',css:"'SDY Computer Modern','Latin Modern Roman','Times New Roman',serif"},
        {id:'arial',label:'Arial / Helvetica',ko:'에어리얼',en:'Arial / Helvetica',css:"'Arial','Helvetica','Liberation Sans','SDY Helvetica',sans-serif"},
        {id:'coding', label:'코딩체',ko:'코딩체',en:'Nanum Gothic Coding',css:"'Nanum Gothic Coding',monospace"},
        {id:'inter',  label:'Inter',ko:'인터',en:'Inter',css:"'Inter','Pretendard Variable',sans-serif"},
        {id:'playfair',label:'Playfair',ko:'플레이페어',en:'Playfair Display',css:"'Playfair Display',serif"},
        {id:'caveat', label:'Caveat',ko:'카베아트',en:'Caveat',css:"'Caveat',cursive"},
        {id:'mono',   label:'Roboto Mono',ko:'로보토 모노',en:'Roboto Mono',css:"'Roboto Mono',monospace"}
    ];
    function fontCSS(id){ const f=FONTS.find(x=>x.id===id); return f?f.css:FONTS[0].css; }
    let curFont='pretendard';

    const PAGE_GAP=40;      // 페이지 사이 간격(종이 좌표)
    const ADD_ZONE_H=120;   // 새 페이지 추가 영역 높이

    let notebooks=[],curNB=null,curMemo=null;
    let S=JSON.parse(localStorage.getItem('sdy3')||'null')||{theme:'pro',defPaper:'blank',defFS:16,defFont:'pretendard',accent:'#4f6ef7',appTitle:'',cardSize:'l'};
    // 14.47 · 테마 이전 — 예전 S.dark(true/false)는 S.theme('pro'/'classic')으로 합쳐졌다.
    //   저장된 값이 없으면 새 기본인 'pro'로 시작한다. (다크 모드 토글은 설정에서
    //   테마 선택으로 대체됨) 14.48 · 'pro' = 밝은 '워크' 전문 디자인(더 이상 다크 아님)
    if(!S.theme||(S.theme!=='pro'&&S.theme!=='classic')){
        S.theme='pro';
        try{ delete S.dark; }catch(e){}
    }
    // 현재 테마 ('pro' | 'classic') — 비교는 이 함수로 통일한다
    function sdyTheme(){ return S.theme==='classic'?'classic':'pro'; }
    function saveS(){localStorage.setItem('sdy3',JSON.stringify(S));}

    // ===== 문서 모델 =====
    // doc = { paper, sizePreset, emoji, pages:[ {id, els:[...]} ] }
    // el  = {type:'text'|'image'|'stroke'|'latex', ...}
    let doc=null;
    let curPageIdx=0;
    // ── 번역 모듈 브릿지: src/translate.js 에서 읽기 전용으로 참조 ──
    window._sdy={}; Object.defineProperties(window._sdy,{ doc:{get(){return doc},set(v){doc=v}}, curNB:{get(){return curNB},set(v){curNB=v}}, curPageIdx:{get(){return curPageIdx},set(v){curPageIdx=v}} });
    let history=[]; let redoStack=[];
    // 14.15 · 빠른 연속 작업 가드
    //  - _sdyOpenSeq: 다른 노트 열기가 겹칠 때 이전 openNB 의 뒤늦은 이어짐을 무효화
    //  - _docId: 현재 doc 객체가 어느 노트의 것인지 기록 → 저장 타이머가 노트 교체
    //    중에 이전 본문을 새 노트에 덮어쓰지 못하게 한다.
    //  - _saveNoteId: saveDoc 을 예약할 당시 노트 → 예약이 노트 교체를 넘어가면 무시
    let _sdyOpenSeq=0, _docId=null, _saveNoteId=null;

    function blankPage(){ return {id:'p_'+Math.random().toString(36).slice(2,9), els:[]}; }
    function blankDoc(preset){
        return {paper:S.defPaper, sizePreset:preset||'a4_portrait', emoji:'', pages:[blankPage()]};
    }
    function paperSize(d){ const p=SIZE_PRESETS[(d||doc).sizePreset]||SIZE_PRESETS.a4_portrait; return {w:p.w,h:p.h}; }

    // 14.29.5 · 기본 팔레트를 '선명한 표준색'으로 되돌린다.
    //   14.18.4 의 차분한(어두운) 톤은 종이 위에서 잘 안 보인다는 피드백.
    //   글자색 · 펜색 · 형광펜 셋 다 눈에 잘 띄는 값으로 맞춘다.
    //   각 배열의 [0] 이 아무것도 안 고른 초기 상태에서 쓰이는 기본색이다.
    const CLASSIC_DRAW_COLORS=['#000000','#e74c3c','#3498db','#27ae60','#f39c12','#9b59b6'];
    const CLASSIC_TEXT_COLORS=['#000000','#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c','#3498db','#9b59b6','#e84393','#7f8c8d'];
    const CLASSIC_HL_COLORS=['#ffff00','#a8ff60','#7bfdff','#ff9cf5','#ffb3c1','#9cc9ff','#ffc98b','#dfe4ea','#b6ff8c','#ffd700'];
    // 예전에는 이 표로 '저장된 색'을 그릴 때마다 어두운 톤으로 바꿔치기했다.
    // 그래서 빨강으로 써 둔 글씨가 다시 열면 검붉게 보였다 — 사용자가 고른 색을
    // 화면이 멋대로 바꾸는 셈이라, 표를 비워 **저장된 색을 그대로** 보여 준다.
    // (표만 비우면 되고 호출부는 그대로다. 나중에 다시 매핑이 필요하면 여기에만
    //  넣으면 된다. 비어 있으면 _classicPaletteColor 는 입력을 그대로 돌려준다.)
    const DRAW_COLOR_ALIASES={};
    const TEXT_COLOR_ALIASES={};
    const HL_COLOR_ALIASES={};
    // 매핑이 하나도 없으면 색 정규화는 통째로 건너뛴다 (여는 속도에도 이득).
    const PALETTE_REMAP_ON=!!(Object.keys(DRAW_COLOR_ALIASES).length
        ||Object.keys(TEXT_COLOR_ALIASES).length
        ||Object.keys(HL_COLOR_ALIASES).length);
    function _paletteColorKey(v){
        v=String(v||'').trim().toLowerCase();
        if(!v||v==='inherit'||v==='initial') return '';
        if(v==='transparent'||v==='rgba(0, 0, 0, 0)'||v==='rgba(0,0,0,0)') return 'transparent';
        if(/^#[0-9a-f]{3}$/i.test(v)) return '#'+v.slice(1).split('').map(ch=>ch+ch).join('').toLowerCase();
        if(/^#[0-9a-f]{6}$/i.test(v)) return v;
        const m=v.match(/^rgba?\(([^)]+)\)$/i);
        if(m){
            const parts=m[1].split(',').map(x=>x.trim());
            if(parts.length>=4 && parseFloat(parts[3])===0) return 'transparent';
            const nums=parts.slice(0,3).map(x=>Math.max(0,Math.min(255,parseInt(x,10)||0)));
            return '#'+nums.map(n=>n.toString(16).padStart(2,'0')).join('');
        }
        return v;
    }
    function _classicPaletteColor(kind,v){
        if(!PALETTE_REMAP_ON) return v;      // 저장된 색을 그대로 쓴다
        const key=_paletteColorKey(v);
        const map=kind==='draw'?DRAW_COLOR_ALIASES:(kind==='text'?TEXT_COLOR_ALIASES:HL_COLOR_ALIASES);
        return key&&map[key]?map[key]:v;
    }
    // 색 치환은 색 지정이 실제로 들어 있는 html 에서만 의미가 있다.
    // 큰 문서를 열 때 이 함수가 쪽마다 수천 번 불리는데, 대부분의 글상자는
    // 색 지정이 없다 → 그런 html 은 DOM 파싱 없이 그대로 돌려준다.
    // (style.color / style.backgroundColor(=background 단축) / data-*color /
    //  data-highlight / <font color> — 전부 'color' 또는 'background' 를 포함한다)
    const _PAL_RE=/color|background|highlight/i;
    function _normalizePaletteHtml(html){
        if(!html||typeof document==='undefined') return html;
        if(!PALETTE_REMAP_ON) return html;   // 바꿀 매핑이 없으면 파싱조차 하지 않는다
        if(!_PAL_RE.test(html)) return html;
        const box=document.createElement('div');
        box.innerHTML=String(html||'');
        box.querySelectorAll('*').forEach(node=>{
            if(node.style){
                const tc=_classicPaletteColor('text',node.style.color||'');
                const bg=_classicPaletteColor('hl',node.style.backgroundColor||'');
                if(tc&&tc!==node.style.color) node.style.color=tc;
                if(bg&&bg!=='transparent'&&bg!==node.style.backgroundColor) node.style.backgroundColor=bg;
            }
            if(node.getAttribute){
                ['data-text-color','data-color'].forEach(attr=>{
                    if(node.hasAttribute(attr)) node.setAttribute(attr,_classicPaletteColor('text',node.getAttribute(attr)));
                });
                ['data-highlight','data-background-color'].forEach(attr=>{
                    if(node.hasAttribute(attr)) node.setAttribute(attr,_classicPaletteColor('hl',node.getAttribute(attr)));
                });
                if(node.tagName==='FONT'&&node.hasAttribute('color'))
                    node.setAttribute('color',_classicPaletteColor('text',node.getAttribute('color')));
            }
        });
        return box.innerHTML;
    }
    function _normalizeDocPalette(d){
        if(!d||!Array.isArray(d.pages)) return d;
        if(!PALETTE_REMAP_ON) return d;      // 저장된 색을 건드리지 않는다
        d.pages.forEach(pg=>{
            (pg&&pg.els||[]).forEach(el=>{
                if(!el||typeof el!=='object') return;
                if(el.type==='stroke'&&el.color) el.color=_classicPaletteColor('draw',el.color);
                if(el.type==='text'){
                    if(el.textColor) el.textColor=_classicPaletteColor('text',el.textColor);
                    if(el.cellBg) el.cellBg=_classicPaletteColor('hl',el.cellBg);
                    if(el.html) el.html=_normalizePaletteHtml(el.html);
                }
            });
        });
        return d;
    }

    // 구버전(단일 페이지 + 비트맵 그림) → 신버전 자동 마이그레이션
    function migrate(cfg, nbId){
        const d=blankDoc(cfg.sizePreset||(cfg.orient==='landscape'?'a4_landscape':'a4_portrait'));
        d.paper=cfg.paper||S.defPaper;
        d.emoji=cfg.emoji||'';
        d.glossary=cfg.glossary||{};
        if(Array.isArray(cfg.pages)&&cfg.pages.length){
            d.pages=cfg.pages.map(p=>{
                // 배열은 반드시 복사본으로 넘긴다. getCfg 가 파싱 결과를 캐시하므로
                // 원본 배열을 그대로 쓰면 편집(push/splice)이 '디스크에 저장된 값'
                // 캐시까지 함께 바꿔 버려, 빈 저장 방지 가드가 무력화된다.
                const np={id:p.id||blankPage().id,
                          els:Array.isArray(p.els)?p.els.slice():[],
                          tables:Array.isArray(p.tables)?p.tables.slice():[],
                          notes:Array.isArray(p.notes)?p.notes.slice():[]};
                // ★ '아직 안 받은 쪽' 표시를 보존한다.
                //   메모리에서 내려놓은(evict) 쪽은 원래 id 를 그대로 쓰므로
                //   id 모양(lazy_N)만으로는 알 수 없다 → 저장된 표시를 믿는다.
                if(p.__lazy!=null) np.__lazy=1;
                return np;
            });
            d.tint=cfg.tint||'';
            d.favPages=Array.isArray(cfg.favPages)?cfg.favPages:[];
            return _normalizeDocPalette(d);
        }
        const els=[];
        (cfg.textBoxes||[]).forEach(tb=>{
            const t=(tb.html||tb.text||'').trim();
            if(!t) return;
            els.push({type:'text',id:tb.id||uid('t'),x:tb.x||0,y:tb.y||0,
                      w:tb.w||160,h:tb.h||44,html:tb.html||esc(tb.text||''),fontSize:tb.fontSize||16});
        });
        (cfg.previewImgs||[]).forEach(it=>{
            const url=typeof it==='string'?it:it.url; const id=typeof it==='string'?null:it.id;
            if(!url) return;
            let m={}; if(id){ try{m=JSON.parse(localStorage.getItem('img_'+id)||'{}');}catch(e){} }
            els.push({type:'image',id:id||uid('i'),url,x:m.x??48,y:m.y??48,w:m.width??200,h:m.height??150});
        });
        const legacy=cfg.drawing||localStorage.getItem('draw_'+nbId);
        if(legacy) els.push({type:'legacyDraw',id:uid('d'),url:legacy});
        d.pages=[{id:blankPage().id, els}];
        return _normalizeDocPalette(d);
    }

    function uid(p){ return p+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
    function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
    /* 14.28.2 · 해돌이 말풍선용 아주 작은 마크다운 렌더러.
       #/##/### 제목 · **굵게** · *기울임* · \`코드\` · $수식$은 그대로 보존 ·
       -/1. 목록 · 링크 깡통 무시 · 나머지는 모두 이스케이프.
       XSS 방지 위해 태그·스크립트는 전부 이스케이프한다. */
    /* $…$ / $$…$$ 한 조각 → KaTeX HTML. KaTeX 가 없거나 문법이 틀리면 원문 그대로. */
    function mathHTML(src){
      const raw=String(src||'');
      const dbl=/^\$\$([\s\S]+)\$\$$/.exec(raw), sng=dbl?null:/^\$([\s\S]+)\$$/.exec(raw);
      const body=(dbl?dbl[1]:(sng?sng[1]:'')).trim();
      if(!body) return esc(raw);
      try{
        if(window.katex) return '<span class="md-math'+(dbl?' md-math-block':'')+'">'
          +katex.renderToString(body,{displayMode:!!dbl,throwOnError:false,strict:'ignore',output:'html'})
          +'</span>';
      }catch(e){}
      return esc(raw);
    }
    function mdToHtml(s){
      s=String(s==null?'':s);
      // $...$ / $$...$$ 수식은 내부에 마크다운이 들어오지 않게 임시 치환
      const maths=[];
      s=s.replace(/\$\$[^$\n]+\$\$|\$[^$\n]+\$/g,(m)=>{const i=maths.length;maths.push(m);return'\u0000'+i+'\u0000';});
      const lines=s.split('\n'), out=[];
      let inList=false, listType='', listIndent=0;
      const closeList=()=>{ if(inList){ out.push(listType==='ol'?'</ol>':'</ul>'); inList=false; } };
      const inline=(t)=>{
        t=esc(t);
        // **굵게**
        t=t.replace(/\*\*([^*\n]+?)\*\*/g,'<strong>$1</strong>');
        // *기울임* (단어 경계 안, 공백 뒤)
        t=t.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?:;]|$)/g,'$1<em>$2</em>');
        // `코드`
        t=t.replace(/`([^`\n]+?)`/g,'<code>$1</code>');
        // 수식 복원 — 14.29.2 · 문장 안에 섞인 $수식$ 도 KaTeX 로 그린다
        //   (예전에는 $x^2$ 라는 맨 글자 그대로 보였다)
        t=t.replace(/\u0000(\d+)\u0000/g,(_,i)=>mathHTML(maths[+i]||''));
        return t;
      };
      for(const raw of lines){
        const line=raw.replace(/\s+$/,'');
        if(!line.trim()){ closeList(); out.push('<div class="md-blank"></div>'); continue; }
        // 제목
        let m=/^(#{1,3})\s+(.*)$/.exec(line);
        if(m){ closeList();
          const lv=m[1].length;
          out.push(`<h${lv} class="md-h md-h${lv}">${inline(m[2])}</h${lv}>`); continue;
        }
        // 순서 없는 목록  "- "/"* "/"＋ "/"• "
        m=/^(\s*)([-*+•])\s+(.*)$/.exec(line);
        let mo=/^(\s*)(\d+)\.\s+(.*)$/.exec(line);
        if(m||mo){
          const indent=(m?m[1]:mo[1]).length, num=m?0:parseInt(mo[2],10);
          const cont=m?m[3]:mo[3];
          const type=m?'ul':'ol';
          if(!inList||listType!==type){ closeList(); out.push(type==='ol'?'<ol>':'<ul>'); inList=true; listType=type; }
          listIndent=indent;
          out.push(`<li>${inline(cont)}</li>`);
          continue;
        }
        closeList();
        out.push(`<p>${inline(line)}</p>`);
      }
      closeList();
      return out.join('\n');
    }
    function toast(m,ms=2000){ if(!document) return; const t=document.getElementById('toast'); if(!t) return; t.textContent=m;t.classList.add('show');setTimeout(()=>{ if(t.isConnected) t.classList.remove('show'); },ms);}
    try{ window.toast=toast; window.esc=esc; }catch(e){}
    // 색을 밝게/어둡게 (p<0 어둡게, p>0 밝게)
    function shade(hex,p){
        try{
            const n=parseInt(String(hex).replace('#',''),16);
            let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
            if(p<0){ r=Math.round(r*(1+p)); g=Math.round(g*(1+p)); b=Math.round(b*(1+p)); }
            else { r=Math.round(r+(255-r)*p); g=Math.round(g+(255-g)*p); b=Math.round(b+(255-b)*p); }
            return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
        }catch(e){ return String(hex); }
    }
    function applyTheme(){
        // 14.48 · 테마 적용 — 'pro'(기본·밝은 '워크' 전문 디자인) / 'classic'(기존 라이트)
        const th=sdyTheme();
        S.theme=th;
        const root=document.documentElement;
        try{ root.dataset.theme=th; }catch(e){}
        root.classList.toggle('theme-pro',th==='pro');
        root.classList.toggle('theme-classic',th!=='pro');
        // 14.48 · 프로 테마는 '워크' 밝은 전문 디자인으로 바뀌어 .dark 별칭을
        //   더 이상 쓰지 않는다. 프로 = 기본(라이트) 규칙 + html.theme-pro 오버라이드.
        //   (기존 다크 프로 시절 .dark 의존 규칙 70여 곳 — 플리커·에디터 크롬 등 —
        //    이제 클래식(라이트) 스타일로 돌아와도 양쪽 모두 정상 동작.)
        root.classList.remove('dark');
        try{ document.body.classList.toggle('theme-pro',th==='pro'); }catch(e){}
        try{ document.body.classList.toggle('theme-classic',th!=='pro'); }catch(e){}
        // 강조색
        const acc=S.accent||'#4f6ef7';
        document.documentElement.style.setProperty('--accent',acc);
        document.documentElement.style.setProperty('--accent2',shade(acc,-0.18));
        // 설정창의 테마 선택 UI도 함께 갱신 (열려 있을 때)
        try{ if(typeof paintThemePicks==='function') paintThemePicks(); }catch(e){}
        // 14.49 · PRO 앱 셸 — 프로/클래식에 따라 브랜드·브레드크럼 자리를 갈아엎는다
        try{ if(typeof _proShellSwap==='function') _proShellSwap(); }catch(e){}
        // 앱 제목
        const t=(S.appTitle&&String(S.appTitle).trim())?S.appTitle.trim():'SDYnotes';
        const h1=document.querySelector('.app-brand h1');
        if(h1) h1.textContent=t;
        document.title=t;
        // 카드 크기
        document.body.classList.toggle('card-s',S.cardSize==='s');
        document.body.classList.toggle('card-l',S.cardSize==='l');
        // 기본 글꼴
        curFont=FONTS.some(f=>f.id===S.defFont)?S.defFont:'pretendard';   // 옛 defFont 'noto' 는 폴백으로 프리텐다드
        // 배경 사진
        applyWallpaper();
        try{ if(typeof applyProCollapsed==='function') applyProCollapsed(); }catch(e){}
    }
    // ── 14.52-T · PRO 사이드바 접기/펼치기 — 좁은 화면(레일)은 무조건 접힘이므로 저장값과 무관
    function applyProCollapsed(){
        var collapsed=false;
        try{ collapsed=localStorage.getItem('proSideCollapsed')==='1'; }catch(e){}
        var pro=(typeof sdyTheme==='function'&&sdyTheme()==='pro');
        // 좁은 화면에서는 레일이 기본이라 collapsed 와 무관하게 토글이 숨겨지나(html 로 control),
        // 상태 클래스는 1024+에서만 의미가 있다. 그래도 pro 아닐 때는 꺼 둔다.
        document.documentElement.classList.toggle('pro-collapsed', !!(pro&&collapsed));
        var btn=document.getElementById('proSideToggle');
        if(btn){
            var isCollapsed=document.documentElement.classList.contains('pro-collapsed');
            btn.setAttribute('aria-label', isCollapsed?'사이드바 펼치기':'사이드바 접기');
            btn.title=isCollapsed?'사이드바 펼치기':'사이드바 접기';
            try{ btn.querySelector('i').className=isCollapsed?'ri-arrow-right-double-line':'ri-arrow-left-double-line'; }catch(e){}
        }
    }
    function toggleProSide(){
        var cur=false;
        try{ cur=localStorage.getItem('proSideCollapsed')==='1'; }catch(e){}
        try{ localStorage.setItem('proSideCollapsed', cur?'0':'1'); }catch(e){}
        applyProCollapsed();
    }
    try{ window.applyProCollapsed=applyProCollapsed; window.toggleProSide=toggleProSide; }catch(e){}


/* APP-PART:01-core.js:END */
