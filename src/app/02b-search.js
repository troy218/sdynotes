/* === src/app/02b-search.js ===
   스트로크 SVG · 검색/이모지 · 노트 목록
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:02b-search.js:BEGIN */
    // ============ 스트로크 → SVG path (에디터/미리보기/내보내기 공용) ============
    function strokePath(pts,sharp){
        if(!pts||pts.length<2) return pts&&pts.length===1?`M ${pts[0][0]} ${pts[0][1]} l 0.01 0`:'';
        if(sharp){
            // 도형: 스무딩 없이 꺾은선 → 모서리가 뭉개지지 않음
            return 'M '+pts.map(p=>`${p[0]} ${p[1]}`).join(' L ');
        }
        let d=`M ${pts[0][0]} ${pts[0][1]}`;
        for(let i=1;i<pts.length-1;i++){
            const mx=(pts[i][0]+pts[i+1][0])/2, my=(pts[i][1]+pts[i+1][1])/2;
            d+=` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
        }
        const last=pts[pts.length-1];
        d+=` L ${last[0]} ${last[1]}`;
        return d;
    }
    function isEllipsePts(pts){ return pts&&pts.length>20; }
    function strokeBBox(s){
        let x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
        (s.pts||[]).forEach(([x,y])=>{ if(x<x1)x1=x; if(y<y1)y1=y; if(x>x2)x2=x; if(y>y2)y2=y; });
        const pad=(s.size||2)/2+1;
        return {x:x1-pad,y:y1-pad,w:(x2-x1)+pad*2,h:(y2-y1)+pad*2};
    }

    // 페이지 하나를 정적 HTML로 렌더 (미리보기 + 내보내기 = 에디터와 100% 동일)
    // 종이 무늬를 SVG 로 생성 (CSS repeating-gradient 는 축소 시 1px 선이
    // 반올림되며 간격/두께가 뭉개진다 → 미리보기에서 비율이 어긋나 보임)
    function paperPatternSVG(type,size){
        if(!type||type==='blank') return '';
        let d='';
        if(type==='lined'){
            for(let y=47.5;y<size.h;y+=32)
                d+=`<line x1="0" y1="${y}" x2="${size.w}" y2="${y}"/>`;
            return `<svg class="pv-bg" viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" `+
                   `preserveAspectRatio="none" style="position:absolute;left:0;top:0;z-index:1;pointer-events:none;">`+
                   `<g stroke="var(--line)" stroke-width="1" shape-rendering="crispEdges">${d}</g></svg>`;
        }
        if(type==='grid'){
            for(let y=0.5;y<size.h;y+=32) d+=`<line x1="0" y1="${y}" x2="${size.w}" y2="${y}"/>`;
            for(let x=0.5;x<size.w;x+=32) d+=`<line x1="${x}" y1="0" x2="${x}" y2="${size.h}"/>`;
            return `<svg class="pv-bg" viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" `+
                   `preserveAspectRatio="none" style="position:absolute;left:0;top:0;z-index:1;pointer-events:none;">`+
                   `<g stroke="var(--line)" stroke-width="1" shape-rendering="crispEdges">${d}</g></svg>`;
        }
        if(type==='dotted'){
            for(let y=12;y<size.h;y+=24)
                for(let x=12;x<size.w;x+=24) d+=`<circle cx="${x}" cy="${y}" r="1"/>`;
            return `<svg class="pv-bg" viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" `+
                   `preserveAspectRatio="none" style="position:absolute;left:0;top:0;z-index:1;pointer-events:none;">`+
                   `<g fill="var(--dot)">${d}</g></svg>`;
        }
        return '';
    }

    function renderPageStatic(page, size, paperCls){
        let html='';
        const strokes=[];
        // 카드 축소판은 '편집 화면의 확대율'을 따라가지 않는다.
        // --bw 는 1.6/배율 이라 노트를 보고 나온 뒤에는 그 값이 #pagesStage 에 남아
        // 같은 노트가 다른 테두리·다른 배치로 다시 그려진다(= 홈이 새로고침된 것처럼 보인다).
        // 안쪽 조립(_expTextInner/_expLatexInner)은 화면과 그대로 공유하고 테두리만 고정한다.
        const bw=2;
        (page.els||[]).forEach(el=>{
            if(el.type==='image'){
                html+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${bw}px solid transparent;box-sizing:border-box;border-radius:2px;z-index:2;transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;">`+
                      `<img src="${el.url||el.localURL||''}" style="width:100%;height:100%;object-fit:fill;display:block;border-radius:2px;"></div>`;
            }else if(el.type==='legacyDraw'){
                html+=`<img src="${el.url}" style="position:absolute;left:0;top:0;width:${size.w}px;height:${size.h}px;z-index:3;">`;
            }else if(el.type==='stroke'){ strokes.push(el); }
        });
        if(strokes.length){
            html+=`<svg viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" `+
                  `style="position:absolute;left:0;top:0;z-index:3;overflow:visible;pointer-events:none;">`+
                  strokes.map(s=>{
                      const tr=strokeTransform(s);
                      const d=strokePath(s.pts,s.sharp&&!isEllipsePts(s.pts));
                      return (s.fillColor?`<path d="${d}" fill="${_classicPaletteColor('draw',s.fillColor)}" fill-opacity="${s.fillOpacity==null?0.58:s.fillOpacity}" fill-rule="evenodd"${tr?` transform="${tr}"`:''}/>`:'')+
                      `<path d="${d}" fill="none" stroke="${_classicPaletteColor('draw',s.color)}" stroke-width="${s.size}" `+
                      `${s.opacity!=null?`stroke-opacity="${s.opacity}" `:''}`+
                      `stroke-linecap="round" stroke-linejoin="round"${tr?` transform="${tr}"`:''}/>`;
                  }).join('')+
                  `</svg>`;
        }
        (page.els||[]).forEach(el=>{
            if(el.type==='latex'){
                // 화면과 같은 상자·안쪽 배치 (미리보기라 맞춤 측정은 생략 — 카드 축소판이라 차이 없음)
                html+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`+
                      `z-index:5;transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;">`+
                      `<div style="${_expLatexInner(el,bw,el.fontSize||20,'var(--text1)')}">${latexHTML(el.latex||'',!!el.displayMath)}</div></div>`;
                return;
            }
            if(el.type!=='text') return;
            html+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;z-index:4;transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;">`+
                  `<div style="${_expTextInner(el,bw,'var(--text1)')}">${el.html||''}</div></div>`;
        });
        // .ppv = 미리보기 전용 컨테이너 (에디터 .paper 스크립트와 충돌 방지)
        const pat=paperPatternSVG((paperCls||'').replace('paper-',''),size);
        return `<div class="ppv" data-paper="${(paperCls||'').replace('paper-','')}" `+
               `style="position:absolute;left:0;top:0;width:${size.w}px;height:${size.h}px;`+
               `background:var(--card);outline:1px solid var(--border);border-radius:3px;`+
               `overflow:hidden;box-sizing:border-box;">${pat}${html}</div>`;
    }

    // ============ Search / Emoji ============
    let searchQuery='';
    function searchNotes(q){ searchQuery=(q||'').trim().toLowerCase(); renderGrid(); }
    function docText(d){
        let t='';
        (d.pages||[]).forEach(p=>(p.els||[]).forEach(e=>{
            if(e.type==='text'){ const tmp=document.createElement('div'); tmp.innerHTML=e.html||'';
                // 14.40 · 논문 상자 줄(.sdy-tl) 경계에 공백이 없으면 줄 사이 낱말이 합쳐진다
                tmp.querySelectorAll('.sdy-tl').forEach(x=>x.append(' '));
                t+=' '+tmp.textContent; }
            else if(e.type==='latex') t+=' '+(e.latex||'');
        }));
        return t.toLowerCase();
    }
    function getFiltered(){
        // 검색 중이면 폴더 무시하고 전체에서 찾는다 (단, 잠긴 폴더 안의 노트는 숨긴다)
        const visible=notebooks.filter(n=>{
            if(isTrashed(n.id)) return false;   // 휴지통 노트는 홈 화면에서 숨김 (설정에서 관리)
            const fid=noteFolder(n.id);
            if(!fid) return true;
            // 잠금 자체가 걸린 폴더는 이번 세션에서 열어 본 적이 있어도 검색 대상에서 제외.
            // 검색창을 통해 잠금 폴더 제목/본문이 새어 나오지 않게 한다.
            const path=folderPath(fid);
            if(!path.length) return false;
            if(searchQuery) return path.every(f=>!isFolderLocked(f.id));
            return path.every(f=>isFolderOpen(f.id));
        });
        // ★ 항상 visible(휴지통·잠긴 폴더 제외) 기준으로 필터 — notebooks 직접 참조 금지
        const base=visible.filter(n=>searchQuery || noteFolder(n.id)===curFolder);
        if(!searchQuery) return base;
        return base.filter(nb=>{
            if((nb.title||'').toLowerCase().includes(searchQuery)) return true;
            if(isLocked(nb.id)&&!isUnlocked(nb.id)) return false;   // 아직 안 푼 노트만 제외
            try{ return docText(loadDoc(nb.id)).includes(searchQuery); }catch(e){ return false; }
        });
    }
    const EMOJI_LIST=['😀','😊','🥰','😎','🤔','😢','😤','🔥','⭐','💡','✅','❤️','💜','🎯','📌','🎉','🌟','🍀','☕','📝','🎨','🎵','💪','👍'];
    function buildEmojiPicker(id){ return EMOJI_LIST.map(e=>`<div class="emoji-opt" onclick="event.stopPropagation();setNoteEmoji('${id}','${e}')">${e}</div>`).join(''); }
    function closeAllEmojiPickers(){
        document.querySelectorAll('.emoji-picker.open').forEach(p=>p.classList.remove('open'));
    }
    function toggleEmojiPicker(badge){
        const picker=badge&&badge.nextElementSibling;
        const wasOpen=picker&&picker.classList.contains('open');
        closeAllEmojiPickers();
        if(picker&&!wasOpen) picker.classList.add('open');
    }
    // 9.1 · 이모지 동기화 정리
    //  예전엔 이모지가 두 경로로 동시에 오갔다.
    //    ① 설정 채널 (emoji:<id> · rev 기반, 정확함)
    //    ② 문서 본문 채널 (applyServerState 의 st.emoji · 낡은 값이 섞임)
    //  ②가 나중에 도착하면 방금 고른 이모지를 옛 값으로 되돌려 버려서
    //  "바꿔도 원래대로 돌아간다 / 다른 기기에 안 간다" 처럼 보였다.
    //  이제 설정 채널을 유일한 주인으로 삼고, 문서 채널의 이모지는
    //  더 최신인 로컬 값이 있으면 무시한다 (emojiTs 로 판정).
    function emojiStamp(nbId){ return +(getCfg(nbId).emojiTs||0); }
    function shouldKeepLocalEmoji(nbId){
        // 아직 서버로 못 보낸 내 변경이 있으면 원격 본문 값으로 덮지 않는다
        if(_stOut['emoji:'+nbId]) return true;
        // 방금(90초 이내) 내가 바꾼 것도 보호한다
        return (Date.now()-emojiStamp(nbId))<90000;
    }
    function paintEmojiBadge(nbId,em){
        const card=document.querySelector(`.note-card[data-nb-id="${nbId}"] .emoji-badge`);
        if(!card) return false;
        card.classList.toggle('has-emoji',!!em);
        card.innerHTML=em||'<span style="font-size:16px;opacity:.35;">◌</span>';
        return true;
    }
    function setNoteEmoji(nbId,em){
        const cfg=getCfg(nbId); const d=migrate(cfg,nbId);
        d.emoji=(d.emoji===em)?'':em;
        persistDoc(nbId,d);
        // persistDoc 뒤에 찍어야 저장 과정에서 덮이지 않는다
        const c2=getCfg(nbId);
        if(d.emoji) c2.emoji=d.emoji; else delete c2.emoji;
        c2.emojiTs=Date.now();
        setCfg(nbId,c2);
        if(curNB&&curNB.id===nbId&&doc) doc.emoji=d.emoji;
        paintEmojiBadge(nbId,d.emoji);
        closeAllEmojiPickers();
        queueSync(nbId);
        pushSettingsNow();        // 이모지도 실시간 동기화 (설정 키 emoji:<id>)
    }
    // 피커 바깥을 누르면 닫는다 (점박이 동그라미/피커 내부는 제외)
    document.addEventListener('click',e=>{
        if(!e.target.closest('.emoji-picker')&&!e.target.closest('.emoji-badge')) closeAllEmojiPickers();
    });

    let _impSaveTimer=null, _impSaving=false;
    function queueImportedSave(){
        if(!doc||!doc.__ref) return;
        clearTimeout(_impSaveTimer);
        _impSaveTimer=setTimeout(flushImportedSave, 700);
    }
    async function flushImportedSave(){
        if(!doc||!doc.__ref) return;
        // 이미 저장 중이면 끝날 때까지 기다렸다가 남은 dirty 를 이어서 보낸다.
        // (닫기/번역 완료와 디바운스 저장이 겹치면 번역분이 유실되던 구멍)
        while(_impSaving){
            await new Promise(r=>setTimeout(r,80));
            if(!doc||!doc.__ref) return;
        }
        const n=(doc.pages||[]).length;
        const slices=new Set();
        (doc.pages||[]).forEach((pg,i)=>{
            if(pg&&pg.__dirty&&pg.__lazy==null) slices.add(Math.floor(i/LAZY_SLICE)*LAZY_SLICE);
        });
        if(!slices.size) return;
        _impSaving=true;
        try{
            for(const s0 of slices){
                if(!doc||!doc.__ref) break;
                // 14.6 · 슬라이스 일부가 lazy(내려놓음)라도 나머지를 불러와 온전히 저장한다.
                //  예전엔 한 쪽이라도 lazy면 통째로 건너뛰어, dirty 쪽의 번역/편집이
                //  서버에 안 올라가고 스크롤·재진입 때 원문으로 되돌아갔다.
                let hasLazy=false;
                for(let i=s0;i<Math.min(n,s0+LAZY_SLICE);i++){
                    if(doc.pages[i]&&doc.pages[i].__lazy!=null){ hasLazy=true; break; }
                }
                if(hasLazy){
                    try{ await loadBatch(s0); }catch(e){}
                }
                const chunk=[];
                let incomplete=false;
                for(let i=s0;i<Math.min(n,s0+LAZY_SLICE);i++){
                    const pg=doc.pages[i];
                    if(!pg||pg.__lazy!=null){ incomplete=true; break; }
                    chunk.push({id:pg.id, els:sanitizePageEls(pg.els||[]), tables:pg.tables||[], notes:pg.notes||[],
                                ...(pg.edited?{edited:1}:{})});
                }
                if(incomplete||!chunk.length) continue;
                let ok=false;
                for(let attempt=0; attempt<3 && !ok; attempt++){
                    try{
                        const r=await fetch('/api/import/docfile/'+encodeURIComponent(doc.__ref),{
                            method:'POST', headers:{'Content-Type':'application/json'},
                            body:JSON.stringify({from:s0, pages:chunk, total:n, sizePreset:doc.sizePreset||'a4_portrait'})
                        });
                        const d=await r.json().catch(()=>({}));
                        if(r.ok&&d.ok){
                            for(let i=s0;i<s0+chunk.length && i<n;i++){
                                if(doc.pages[i]) doc.pages[i].__dirty=false;
                            }
                            try{ if(d.version) doc.__ver=d.version; }catch(e){}
                            ok=true;
                        }
                    }catch(e){}
                    if(!ok) await new Promise(res=>setTimeout(res, 280*(attempt+1)));
                }
            }
        }catch(e){ console.warn('가져온 문서 저장 실패',e); }
        finally{ _impSaving=false; }
    }
    function persistDoc(nbId,d){
        const cfg=getCfg(nbId);
        // 잠긴 노트: 평문을 디스크에 남기지 않고 암호문만 저장
        if(cfg.lock&&cfg.lock.enc&&sessionKeys.has(nbId)){
            const key=sessionKeys.get(nbId);
            cfg.paper=d.paper; cfg.sizePreset=d.sizePreset; cfg.emoji=d.emoji;
            delete cfg.pages;
            encryptDoc(d,key).then(blob=>{
                const c2=getCfg(nbId);
                c2.paper=d.paper; c2.sizePreset=d.sizePreset; c2.emoji=d.emoji;
                c2.encBlob=blob; delete c2.pages;
                c2.orient=paperSize(d).w>paperSize(d).h?'landscape':'portrait';
                setCfg(nbId,c2);
            }).catch(e=>console.warn('암호화 실패',e));
            cfg.orient=paperSize(d).w>paperSize(d).h?'landscape':'portrait';
            delete cfg.textBoxes; delete cfg.previewImgs; delete cfg.drawing;
            setCfg(nbId,cfg);
            return;
        }
        // (관리자가 연 '평문 잠금' 노트도 여기로 온다.
        //  원래 평문이었으므로 그대로 평문 저장하되 lock 표시는 유지된다)
        cfg.paper=d.paper; cfg.sizePreset=d.sizePreset; cfg.emoji=d.emoji;
        try{
            if(Array.isArray(d.pages)){
                // 22.1 · 저장할 때마다 '전 쪽'을 다시 정리하지 않는다.
                //   sanitize 는 겹침 O(n²) 비교를 포함하는데, 이 루프는 오토세이브
                //   (400ms)마다 문서 전체 요소 ×쪽 수 만큼 돌아 '글상자를 두드리는
                //   동안 계속' 밀렸다. 렌더/프리세니타이즈가 이미 정리한 쪽은
                //   _sanDone 으로 알고 있으므로 건너뛰고, 정리가 필요한 쪽만 돌린다.
                //   ★ 드롭이 없으면 배열 신원을 그대로 둔다 — 새 배열로 덮으면
                //     WeakSet 캐시가 매번 어긋나 이 최적화가 무의미해진다.
                d.pages.forEach(pg=>{
                    if(!pg||!Array.isArray(pg.els)||!pg.els.length) return;
                    const keep=pg.els;
                    if(_sanDone.has(keep)) return;
                    const n=sanitizePageEls(keep);
                    _sanDone.add(n); _sanDone.add(keep);
                    if(n.length!==keep.length){ pg.__dirty=true; pg.els=n; }
                });
            }
        }catch(e){}
        if(d.__ref){
            // ★ 가져온 대용량 문서: 서버 보관본 참조를 반드시 함께 저장한다.
            //   이걸 빠뜨리면 다시 열었을 때 아직 안 받은 쪽(lazy)을 받아올
            //   주소가 사라져서 "첫 8쪽만 나오고 나머지는 전부 백지"가 된다.
            cfg.__ref=d.__ref;
            cfg.serverDoc=d.__ref;
            cfg.__loadedTo=d.__loadedTo||0;
            // 14.30.0 · 로컬 저장은 '편집(더티) 쪽만 실제 내용'으로, 나머지는
            //   lazy 스텁으로만 남긴다. 예전엔 d.pages 전체(프리필로 받은 전 쪽)
            //   를 localStorage 에 통째로 써서 — 수 MB~수십 MB 문서를 열 때마다
            //   저장이 쿼터에 걸리고, 저장 실패 처리(전 노트 훑기)까지 매번 돌아
            //   타이핑마다 버벅였다. 열 때는 어차피 서버 슬라이스에서 다시 받는다.
            cfg.pages=d.pages.map((pg,i)=>{
                if(pg&&pg.__dirty&&pg.__lazy==null){
                    const copy={id:pg.id,
                        els:Array.isArray(pg.els)?pg.els.slice():[],
                        tables:Array.isArray(pg.tables)?pg.tables.slice():[],
                        notes:Array.isArray(pg.notes)?pg.notes.slice():[]};
                    copy.__dirty=1;
                    if(pg.edited) copy.edited=1;
                    return copy;
                }
                return {id:(pg&&pg.id)||('lazy_'+i),els:[],tables:[],__lazy:1};
            });
        }else{
            cfg.pages=d.pages;
        }
        cfg.favPages=Array.isArray(d.favPages)?d.favPages:[];
        cfg.tint=d.tint||'';
        cfg.glossary=d.glossary||{};
        // 6.2: 관리자가 평문 복원으로 연 노트는 소유자의 옛 암호문 보존
        if(!(adminMode&&adminPlainUnlocked.has(nbId)&&cfg.encBlob)) delete cfg.encBlob;
        cfg.orient=paperSize(d).w>paperSize(d).h?'landscape':'portrait';
        delete cfg.textBoxes; delete cfg.previewImgs; delete cfg.drawing;
        try{ localStorage.removeItem('draw_'+nbId); }catch(e){}
        const saved=setCfg(nbId,cfg);
        // 편집분은 '요소 단위 연산'으로 동기화 → 전체 덮어쓰기로 씹히는 일 없음.
        // 18.8 · persistDoc 은 '열려 있지 않은 노트'에도 쓰인다(닫힌 노트 삭제/그림
        //   업로드 완료 등). 이때 queueOps 는 '지금 열린 노트'의 op 를 만들어 이
        //   노트(nbId)로 엉뚱하게 보낼 수 있으므로, '열려 있는 바로 그 노트'일 때만
        //   실행한다. 닫힌 노트는 명시적 pushOpsFor/이미지 메타 outbox 가 담당한다.
        if(curNB&&curNB.id===nbId&&doc) queueOps();
        // 노트 설정(종이·크기·배경색·즐겨찾는 쪽·사전)도 함께 공유
        try{ pushSettings(); }catch(e){}
        return saved;
    }

    function sortNBs(list){
        return [...(list||[])].sort((a,b)=>{
            const pa=getCfg(a.id).pinned?1:0, pb=getCfg(b.id).pinned?1:0;
            if(pa!==pb) return pb-pa;                       // 고정 노트 먼저
            return new Date(a.created_at||0)-new Date(b.created_at||0);
        });
    }

    async function loadNBs(){
        try{ migrateTrashFolder(); }catch(e){}  // 옛 휴지통 폴더 → 새 방식으로 정리
        try{ purgeTrash(); }catch(e){}          // 30일 지난 휴지통 항목 정리
        if(!SB){
            notebooks=sortNBs(JSON.parse(localStorage.getItem('sdy_local_nbs')||'[]'));
            renderGrid();
            try{ await pullSettings(); }catch(e){}
            _nbsLoaded=true;
            return;
        }
        syncStart();
        try{
            const{data,error}=await SB.from('notebooks').select('*').order('created_at',{ascending:true});
            if(error) throw error;
            const local=JSON.parse(localStorage.getItem('sdy_local_nbs')||'[]');
            // 영구 삭제한 노트는 서버 재조회 때도 되살아나지 않게 제외 (tombstone)
            const gone=getTombstones().notebooks||{};
            const server=(data||[]).filter(nb=>{
                if(nb.title===SETTINGS_TITLE){ settingsNbId=nb.id; return false; }  // 설정 저장용 숨김 노트
                if(gone[nb.id]) return false;                                       // 영구 삭제분 제외
                return true;
            });
            notebooks=sortNBs([...server, ...local]);   // 로컬 전용 노트도 함께 표시
            renderGrid();
            // ── 목록이 뜨면 사용자는 이미 쓸 수 있다.
            //    나머지(밀린 전송·설정·미리보기)는 화면을 막지 않고 뒤에서 처리한다.
            //    예전엔 이걸 전부 await 로 줄세워서 첫 화면이 그만큼 늦었다.
            (async()=>{
                try{
                    // 서버 설정을 먼저 복원한 뒤에만 밀린 데이터를 전송한다.
                    // 이전 기기의 오래된 localStorage가 최신 폴더/북마크를 덮어쓰던 경쟁 상태를 막는다.
                    await pullSettings().catch(()=>{});
                    await Promise.all([
                        flushOutbox(true).catch(()=>{}),
                        restoreAdmin().catch(()=>{}),
                    ]);
                    await preloadPreviews();
                    if(adminMode){ await adminUnlockAll(); renderGrid(); }
                }catch(e){}
            })();
        }catch(err){
            console.warn('서버 연결 실패 - 로컬 모드:',err);
            notebooks=sortNBs(JSON.parse(localStorage.getItem('sdy_local_nbs')||'[]'));
            renderGrid();
            await restoreAdmin();
        }finally{ syncEnd(); _nbsLoaded=true; }
    }

    async function preloadPreviews(){
        if(!SB) return;
        // 미리보기가 없는 노트만 추린다
        const need=notebooks.filter(nb=>{
            const cfg=getCfg(nb.id);
            if(cfg.trashed_at) return false;
            return !(Array.isArray(cfg.pages)&&cfg.pages.length);
        });
        if(!need.length) return;
        // 예전엔 노트를 '한 개씩 차례로' 받아서, 20개면 왕복 20번이었다
        // (첫 화면이 눈에 띄게 느려지는 주범) → 한 번에 몰아서 받는다.
        try{
            const ids=need.map(nb=>nb.id);
            const out=[];
            for(let i=0;i<ids.length;i+=40){          // URL 길이 안전선
                const{data,error}=await SB.from('memos')
                    .select('notebook_id,content,created_at')
                    .in('notebook_id',ids.slice(i,i+40))
                    .order('created_at');
                if(error) throw error;
                if(data) out.push(...data);
            }
            const first=new Map();
            out.forEach(m=>{ if(!first.has(m.notebook_id)) first.set(m.notebook_id,m.content); });
            // ★ 받아온 사이에 그 노트에 본문이 생겼을 수도 있다(가져오기 직후 등).
            //   그런 노트에 서버 내용을 덮으면 저장 공간이 꽉 차서 '다른 노트의
            //   본문'까지 밀려난다 → 반드시 아직 비어 있는 노트만 채운다.
            first.forEach((content,nbId)=>{
                if(!content) return;
                const c=getCfg(nbId);
                if(Array.isArray(c.pages)&&c.pages.some(pg=>(pg&&pg.els||[]).length)) return;
                applyServerState(nbId,content);
            });
            // 최초 목록 렌더 뒤에 미리보기 본문이 도착한다. _gridSig 는 의도적으로
            // 카드 메타만 포함하므로 일반 renderGrid() 는 "변경 없음"으로 빠지고,
            // 기존 카드의 _render 클로저는 로딩 전의 빈 d 를 계속 가리키게 된다.
            // 데이터 의존성이 바뀐 이 지점에서는 반드시 카드를 다시 만들어 새 문서를
            // 캡처한다 (React라면 preview data/revision을 effect 의존성에 넣는 것과 동일).
            renderGrid(true);
            return;
        }catch(e){ console.warn('미리보기 일괄 로드 실패 → 개별 로드',e); }
        // 실패 시에만 예전 방식 (동시 6개씩)
        let k=0;
        const worker=async()=>{
            while(k<need.length){
                const nb=need[k++];
                try{
                    const{data:ms}=await SB.from('memos').select('*')
                        .eq('notebook_id',nb.id).order('created_at').limit(1);
                    if(ms&&ms.length&&ms[0].content) applyServerState(nb.id,ms[0].content);
                }catch(e){}
            }
        };
        await Promise.all(Array.from({length:Math.min(6,need.length)},worker));
        // fallback 로드도 최초 카드가 캡처한 빈 문서 참조를 교체해야 한다.
        renderGrid(true);
    }

    function applyServerState(nbId, raw){
        let st=null;
        try{ st=JSON.parse(raw); }catch(e){ return; }
        if(!st||typeof st!=='object') return;
        const cfg=getCfg(nbId);
        // 휴지통에 있는 노트는 서버 상태로 덮어쓰지 않는다 (부활 방지)
        if(cfg.trashed_at) return;
        // 로컬에 더 최신(미전송) 편집이 있으면 서버의 옛 내용으로 덮어쓰지 않는다
        if(hasPendingLocal(nbId)) return;
        // 대용량 가져온 문서 마커: 본문은 서버에서 받아온다 (어느 기기든)
        if(st.serverDoc){
            cfg.serverDoc=st.serverDoc;
            if(st.sizePreset) cfg.sizePreset=st.sizePreset;
            if(st.paper) cfg.paper=st.paper;
            if(st.glossary) cfg.glossary=st.glossary;      // 6.1 용어 사전 공유
            if(!(cfg.pages||[]).some(p=>(p.els||[]).length)) delete cfg.pages;  // 옛 빈화면 캐시 제거
            setCfg(nbId,cfg);
            return;
        }
        // 서버 쪽이 비어 있는데 기기에 내용이 있으면 덮어쓰지 않는다.
        // (가져오기 직후 등, 아직 서버에 안 올라간 본문이 사라지는 것을 막는다)
        try{
            const cnt=(arr)=>(arr||[]).reduce((n,pg)=>n+((pg&&pg.els)||[]).length,0);
            const srvN=cnt(st.pages), locN=cnt(cfg.pages);
            const srvT=(st.pages||[]).reduce((n,pg)=>n+((pg&&pg.tables)||[]).length,0);
            if(!st.encBlob && srvN===0 && srvT===0 && locN>0) return;
        }catch(e){}
        if(st.locked&&st.encBlob){
            cfg.lock={salt:st.lock&&st.lock.salt, escrow:(st.lock&&st.lock.escrow)||undefined, enc:true};
            cfg.encBlob=st.encBlob;
            cfg.paper=st.paper||cfg.paper; cfg.sizePreset=st.sizePreset||cfg.sizePreset;
            // 9.1 · 설정 채널이 이모지의 주인. 내 최신 변경은 본문 값으로 덮지 않는다.
            if(st.emoji!==undefined && !shouldKeepLocalEmoji(nbId)) cfg.emoji=st.emoji;
            delete cfg.pages;
            setCfg(nbId,cfg);
            return;
        }
        if(Array.isArray(st.pages)){
            cfg.pages=st.pages; cfg.paper=st.paper||cfg.paper;
            cfg.sizePreset=st.sizePreset||cfg.sizePreset;
            // 9.1 · 설정 채널이 이모지의 주인. 내 최신 변경은 본문 값으로 덮지 않는다.
            if(st.emoji!==undefined && !shouldKeepLocalEmoji(nbId)) cfg.emoji=st.emoji;
            if(st.glossary) cfg.glossary=st.glossary;
            delete cfg.textBoxes; delete cfg.previewImgs; delete cfg.drawing;
            const okSet=setCfg(nbId,cfg);
            if(!okSet&&st.serverDoc){
                // 용량 초과 → 참조만 저장(열 때 서버에서 슬라이스로 로드)
                // ★ trashed_at 등 기존 플래그를 보존해야 부활/상태유실이 없다
                const rc={serverDoc:st.serverDoc,paper:cfg.paper,
                          sizePreset:cfg.sizePreset,emoji:cfg.emoji,
                          folder:cfg.folder, trashed_at:cfg.trashed_at,
                          __prevFolder:cfg.__prevFolder, pinned:cfg.pinned,
                          lock:cfg.lock, encBlob:cfg.encBlob, glossary:cfg.glossary};
                setCfg(nbId,rc);
            }
        }else{
            if(Array.isArray(st.textBoxes)) cfg.textBoxes=st.textBoxes;
            if(st.paper) cfg.paper=st.paper;
            if(st.sizePreset) cfg.sizePreset=st.sizePreset;
            // 9.1 · 설정 채널이 이모지의 주인. 내 최신 변경은 본문 값으로 덮지 않는다.
            if(st.emoji!==undefined && !shouldKeepLocalEmoji(nbId)) cfg.emoji=st.emoji;
            if(typeof st.drawing==='string'&&st.drawing) cfg.drawing=st.drawing;
            setCfg(nbId,cfg);
            persistDoc(nbId, migrate(getCfg(nbId), nbId));
        }
    }

    function renderBreadcrumb(){
        const bc=document.getElementById('breadcrumb');
        if(!bc) return;
        if(!curFolder){ bc.style.display='none'; return; }
        const path=folderPath(curFolder);
        const f=path[path.length-1];
        bc.style.display='flex';
        let trail=`<button onclick="openFolder(null)"><i class="ri-home-4-line"></i> 전체 노트</button>`;
        // 조상 폴더들 → 눌러서 그 층으로 바로 이동
        path.slice(0,-1).forEach(a=>{
            trail+=`<span style="color:var(--text3)">/</span>`+
                   `<button onclick="openFolder('${a.id}')">`+
                   `<i class="${a.icon||'ri-folder-3-fill'}" style="color:${a.color||'var(--accent)'}"></i> ${esc(a.name)}</button>`;
        });
        bc.innerHTML=trail+
            `<span style="color:var(--text3)">/</span>`+
            `<span style="font-weight:600;color:var(--text1)"><i class="${(f&&f.icon)||'ri-folder-fill'}" style="color:${(f&&f.color)||'var(--accent)'}"></i> ${esc(f?f.name:'폴더')}</span>`+
            `<button onclick="createSubFolder()" title="이 안에 새 폴더"><i class="ri-folder-add-line"></i></button>`+
            `<button onclick="renameFolder('${curFolder}')" title="이름 변경"><i class="ri-edit-line"></i></button>`+
            `<button onclick="openFolderStyle('${curFolder}')" title="색 · 아이콘"><i class="ri-palette-line"></i></button>`+
            `<button onclick="toggleFolderLock('${curFolder}')" title="${isFolderLocked(curFolder)?'폴더 잠금 해제':'폴더 잠그기'}">`+
              `<i class="${isFolderLocked(curFolder)?'ri-lock-2-fill':'ri-lock-unlock-line'}"></i></button>`+
            `<button onclick="removeFolder('${curFolder}')" title="폴더 삭제" style="color:#e74c3c"><i class="ri-delete-bin-line"></i></button>`;
    }
    function createSubFolder(){
        const name=prompt('새 폴더 이름','새 폴더');
        if(name===null) return;
        const nf=createFolder((name||'').trim()||'새 폴더',[]);
        renderGrid();
        playFolderCreateAnim(nf.id);
        toast(`'${nf.name}' 폴더를 안에 만들었습니다`,1800);
    }
    async function openFolder(fid, skipNav){
        if(fid){
            // 위쪽 조상까지 차례로 확인 (잠긴 폴더 안의 하위 폴더 보호)
            for(const f of folderPath(fid)){
                if(!(await tryOpenFolder(f.id))) return;
            }
        }else{
            // 홈(최상위)에 들어오면 두 노트 줄부터 보여 주고, 클래식 새 노트
            // 버튼은 그 바로 위에 숨겨 둔다.
            _homeEnterScroll=true;
        }
        curFolder=fid; cancelSelect(); renderGrid();
        if(!skipNav) openNav(()=>openFolder(folderParent(fid), true));   // 뒤로가기 → 상위 폴더로
    }
    const FOLDER_COLORS=['#4f6ef7','#e74c3c','#f39c12','#27ae60','#16a085','#8e44ad','#e91e63','#795548','#607d8b','#111827'];
    const FOLDER_ICONS=['ri-folder-3-fill','ri-briefcase-4-fill','ri-book-2-fill','ri-heart-3-fill',
                        'ri-star-smile-fill','ri-lightbulb-flash-fill','ri-flask-fill','ri-plane-fill',
                        'ri-home-4-fill','ri-shopping-bag-3-fill','ri-music-2-fill','ri-camera-lens-fill'];

    function openFolderMenu(e,fid){
        ctxNB=null;
        const f=getFolders().find(x=>x.id===fid); if(!f) return;
        const m=document.getElementById('ctxMenu');
        m.innerHTML=`
            <div class="ctx-item" onclick="closeCtxMenu();openFolder('${fid}')"><i class="ri-folder-open-line"></i> 열기</div>
            <div class="ctx-item" onclick="closeCtxMenu();renameFolder('${fid}')"><i class="ri-edit-line"></i> 이름 변경</div>
            <div class="ctx-item" onclick="closeCtxMenu();openFolderStyle('${fid}')"><i class="ri-palette-line"></i> 색 · 아이콘 변경</div>
            <div class="ctx-sep"></div>
            <div class="ctx-item" onclick="closeCtxMenu();toggleFolderLock('${fid}')">
                <i class="ri-lock-2-line"></i> ${isFolderLocked(fid)?'폴더 잠금 해제':'폴더 잠그기'}</div>
            <div class="ctx-item" onclick="closeCtxMenu();openFolderMoveMenu(event,'${fid}')"><i class="ri-folder-transfer-line"></i> 다른 폴더로 옮기기</div>
            <div class="ctx-item" onclick="closeCtxMenu();emptyFolder('${fid}')"><i class="ri-inbox-unarchive-line"></i> 노트 모두 꺼내기</div>
            <div class="ctx-item danger" onclick="closeCtxMenu();removeFolder('${fid}')"><i class="ri-delete-bin-6-line"></i> 폴더 삭제</div>`;
        m.classList.add('show');
        // fixed 메뉴 — 화면 px → CSS px 로 바꿔야 배율(90%)만큼 밀리지 않는다
        m.style.left=Math.min(window.sdyUiCss(e.clientX),window.sdyUiCss(window.innerWidth)-210)+'px';
        m.style.top=Math.min(window.sdyUiCss(e.clientY),window.sdyUiCss(window.innerHeight)-230)+'px';
    }

    let styleFid=null;
    function openFolderStyle(fid){
        const f=getFolders().find(x=>x.id===fid); if(!f) return;
        styleFid=fid;
        const cur=f.color||'#4f6ef7', ci=f.icon||'ri-folder-3-fill';
        document.getElementById('fsColors').innerHTML=FOLDER_COLORS.map(c=>
            `<div class="fcolor-dot ${c===cur?'on':''}" style="background:${c}" data-c="${c}"
                  onclick="pickFolderColor('${c}')">${c===cur?'<i class="ri-check-line"></i>':''}</div>`).join('');
        document.getElementById('fsIcons').innerHTML=FOLDER_ICONS.map(ic=>
            `<div class="ficon-btn ${ic===ci?'on':''}" onclick="pickFolderIcon('${ic}')"><i class="${ic}"></i></div>`).join('');
        document.getElementById('fsPreviewName').textContent=f.name;
        updateFolderPreview();
        document.getElementById('folderStyleModal').style.display='flex';
        openNav(closeFolderStyle);
    }
    function closeFolderStyle(){ document.getElementById('folderStyleModal').style.display='none'; styleFid=null; navDrop(closeFolderStyle); }
    // 14.65 · 폴더 색·아이콘을 바꾸면 **그 자리에서** 두 화면(홈 카드 · 프로 사이드바)을
    //   다시 그린다. 예전엔 홈 그리드의 '같으면 건너뛰기' 시그니처가 색·아이콘을 안 봐서
    //   새로고침 전까지 옛 색이 남았고, 사이드바는 아예 다시 그리지 않았다.
    function refreshFolderLook(){
        try{ renderGrid(); }catch(e){}
        try{ if(typeof paintProSide==='function') paintProSide(); }catch(e){}
    }
    function pickFolderColor(c){
        const f=getFolders().find(x=>x.id===styleFid); if(!f) return;
        f.color=c; saveFolders(getFolders().map(x=>x.id===styleFid?f:x));
        openFolderStyleRefresh(); refreshFolderLook();
    }
    function pickFolderIcon(ic){
        const f=getFolders().find(x=>x.id===styleFid); if(!f) return;
        f.icon=ic; saveFolders(getFolders().map(x=>x.id===styleFid?f:x));
        openFolderStyleRefresh(); refreshFolderLook();
    }
    function openFolderStyleRefresh(){
        const f=getFolders().find(x=>x.id===styleFid); if(!f) return;
        const cur=f.color||'#4f6ef7', ci=f.icon||'ri-folder-3-fill';
        document.querySelectorAll('#fsColors .fcolor-dot').forEach(d=>{
            const on=d.dataset.c===cur;
            d.classList.toggle('on',on); d.innerHTML=on?'<i class="ri-check-line"></i>':'';
        });
        document.querySelectorAll('#fsIcons .ficon-btn').forEach(bn=>{
            bn.classList.toggle('on', bn.querySelector('i').className===ci);
        });
        updateFolderPreview();
    }
    function updateFolderPreview(){
        const f=getFolders().find(x=>x.id===styleFid); if(!f) return;
        const c=f.color||'#4f6ef7', ic=f.icon||'ri-folder-3-fill';
        const pv=document.getElementById('fsPreview');
        pv.style.background=hexA(c,.10);
        pv.innerHTML=`<i class="${ic}" style="font-size:52px;color:${c};filter:drop-shadow(0 4px 10px ${hexA(c,.3)})"></i>`;
    }
    function emptyFolder(fid){
        // 9.3 · 잠긴 폴더는 내용물을 꺼낼 수 없다.
        //  (잠금을 안 풀고도 노트를 밖으로 빼내면 잠금이 무의미해진다)
        if(isFolderLocked(fid)&&!isFolderOpen(fid)){
            toast('🔒 잠긴 폴더에서는 노트를 꺼낼 수 없습니다',2400); return;
        }
        const list=notebooks.filter(n=>noteFolder(n.id)===fid);
        if(!list.length){ toast('폴더가 비어 있습니다',1400); return; }
        if(!confirm(`${list.length}개 노트를 폴더 밖으로 꺼낼까요? (노트는 삭제되지 않습니다)`)) return;
        list.forEach(n=>setNoteFolder(n.id,null));
        renderGrid(); toast(`${list.length}개 노트를 꺼냈습니다`);
    }

    function renameFolder(fid){
        if(isTrashFolder(fid)){ toast('휴지통 폴더는 이름을 바꿀 수 없습니다',2000); return; }
        const f=getFolders(); const t=f.find(x=>x.id===fid);
        const n=prompt('폴더 이름',t?t.name:'');
        if(n&&n.trim()){ t.name=n.trim(); saveFolders(f); refreshFolderLook(); toast('이름 변경됨'); }
    }
/* APP-PART:02b-search.js:END */
