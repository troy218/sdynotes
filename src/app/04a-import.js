/* === src/app/04a-import.js ===
   PDF/Word 가져오기
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:04a-import.js:BEGIN */
    // ============ 문서 가져오기 (PDF / Word → 편집 가능한 노트) ============
    // 진행률은 '절대 뒤로 가지 않게' 한 곳에서만 만진다.
    // (예전엔 업로드 10% → 변환 0% 로 되돌아가 보였다)
    function setImpPct(v){
        const p=Math.max(0,Math.min(100,v));
        window.__impPct=Math.max(window.__impPct||0,p);
        const shown=window.__impPct;
        const ib=document.getElementById('impBar'); if(ib) ib.style.width=shown+'%';
        const ip=document.getElementById('impPct'); if(ip) ip.textContent=Math.round(shown)+'%';
    }
    async function importDoc(file){
        if(!file) return;
        const ext=(file.name.split('.').pop()||'').toLowerCase();
        if(!['pdf','docx','docm'].includes(ext)){
            toast('PDF 또는 Word(.docx) 파일만 가져올 수 있습니다',2800); return;
        }
        closeCreateModal();
        const prog=document.getElementById('importProg');
        const msg=document.getElementById('importMsg');
        const sub=document.getElementById('importSub');
        prog.style.display='flex';
        msg.textContent=(ext==='pdf'?'PDF':'Word')+' 를 읽는 중…';
        sub.textContent='파일이 크면 조금 걸릴 수 있습니다';

        try{
            // 큰 파일도 되게: 2MB 청크로 나눠 올린 뒤 변환 요청
            window.__convT0=0; window.__convP0=0; window.__convEta=null;
            window.__convTot=0; window.__impPct=0;
            const CH=8*1024*1024;
            const tot=Math.max(1,Math.ceil(file.size/CH));
            const uid='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
            for(let i=0;i<tot;i++){
                const fu=new FormData();
                fu.append('uploadId',uid);
                fu.append('chunk',String(i));
                fu.append('total',String(tot));
                fu.append('name',file.name||'document.pdf');
                fu.append('file',file.slice(i*CH,(i+1)*CH),file.name||'blob');
                setImpPct((i/tot)*10);
                sub.textContent=`올리는 중 ${Math.round((i/tot)*100)}%`;
                const ur=await fetch('/api/import/upload',{method:'POST',body:fu});
                const ud=await ur.json().catch(()=>({}));
                if(!ur.ok||!ud.ok){
                    prog.style.display='none';
                    toast('업로드 실패: '+(ud.error||('HTTP '+ur.status)),4200);
                    return;
                }
            }
            const fd=new FormData();
            fd.append('uploadId',uid);
            fd.append('name',file.name||'document.pdf');
            const r=await fetch('/api/import/doc',{method:'POST',body:fd});
            const d=await r.json().catch(()=>({}));
            if(!r.ok||!d.ok){
                prog.style.display='none';
                let why=d.error||'';
                if(!why){
                    if(r.status===502||r.status===504) why='서버가 응답하지 않습니다 (파일이 너무 큰지 확인해 주세요)';
                    else if(r.status===413) why='파일이 너무 큽니다';
                    else if(r.status===500) why='서버에서 변환에 실패했습니다';
                    else why='서버 오류 ('+r.status+')';
                }
                toast('가져오기 실패: '+why,5200);
                console.error('[import] 실패',r.status,d);
                return;
            }

            // 비동기 잡: 1초마다 진행 상황을 받아온다.
            // → 아무리 긴 변환도 타임아웃으로 죽지 않고, 쪽 수가 보인다.
            if(d.job){
                let done=null;
                while(true){
                    await new Promise(rs=>setTimeout(rs,1000));
                    const sr=await fetch('/api/import/status?id='+encodeURIComponent(d.job),{cache:'no-store'});
                    const sd=await sr.json().catch(()=>({}));
                    if(sr.ok&&sd.status==='working'){
                        msg.textContent=(ext==='pdf'?'PDF':'Word')+' 변환 중…';
                        const pgN=sd.page||0;
                        // 총 쪽수를 아직 모르면(0) 이전에 알던 값을 쓴다 →
                        // 분모가 흔들려 막대가 뒤로 가는 일이 없다
                        if(sd.total>0) window.__convTot=sd.total;
                        const totN=Math.max(1, window.__convTot||sd.total||1);
                        setImpPct(10+90*pgN/totN);
                        // 남은 시간: 최근 속도로만 재고(초반 튐 방지), 표시값은
                        // 한 번 정해지면 크게 늘지 않도록 부드럽게 깎는다.
                        if(pgN>0){
                            if(!window.__convT0){ window.__convT0=Date.now(); window.__convP0=pgN; }
                            const el=(Date.now()-window.__convT0)/1000;
                            const dp=pgN-(window.__convP0||0);
                            if(el>1.2&&dp>0){
                                const raw=(totN-pgN)/(dp/el);
                                const prev=window.__convEta;
                                // 이전 예상보다 커지려 하면 아주 조금만 반영 (오락가락 방지)
                                window.__convEta = (prev==null) ? raw
                                    : (raw>prev ? prev*0.9+raw*0.1 : prev*0.6+raw*0.4);
                            }
                        }
                        const etaS=window.__convEta;
                        const eta = etaS==null ? ''
                            : ` · ${etaS>=60?Math.ceil(etaS/60)+'분':Math.max(1,Math.round(etaS))+'초'} 남음`;
                        sub.textContent=`${pgN}/${totN}쪽${eta}`;
                        continue;
                    }
                    if(sr.ok&&sd.status==='done'){ done=sd; break; }
                    prog.style.display='none';
                    const why=(sd.status==='gone')
                        ? '서버가 변환 도중 재시작되었습니다 (파일이 서버 메모리보다 큰 경우가 많아요). 쪽수를 나눠서 올려주세요'
                        : (sd.error||'서버에서 변환에 실패했습니다');
                    toast('가져오기 실패: '+why,6000);
                    if(sd.detail) console.error('[import] 상세 원인',sd.detail);
                    return;
                }
                Object.assign(d,done);
                setImpPct(100);
            }

            msg.textContent='노트를 만드는 중…';
            sub.textContent='본문 조립 중…';

            // 잡은 본문 대신 참조만 준다 → 서버에서 첫 슬라이스를 받아 온다
            if(!Array.isArray(d.pages)&&d.docRef){
                try{
                    const rr=await fetch('/api/import/docfile/'
                        +encodeURIComponent(d.docRef)+'?from=0&to='+LAZY_SLICE,
                        {cache:'no-store'});
                    const dd=await rr.json().catch(()=>({}));
                    if(rr.ok&&dd.ok!==false&&Array.isArray(dd.pages)){
                        d.pages=dd.pages;
                        d.__total=dd.total||dd.pages.length;
                    }
                }catch(e){}
            }
            if(!Array.isArray(d.pages)||!d.pages.length){
                prog.style.display='none';
                toast('가져온 본문을 받지 못했습니다. 다시 시도해 주세요',3000);
                return;
            }
            const totalP=Math.max(d.pages.length,d.__total||0);
            for(let i=d.pages.length;i<totalP;i++)
                d.pages.push({id:'lazy_'+i,els:[],tables:[],__lazy:1});
            sub.textContent=`${d.pages.length}쪽 로드 · 전체 ${totalP}쪽 · 요소 ${d.count}개`;
            const doc2={paper:'blank', sizePreset:d.sizePreset||'a4_portrait',
                        emoji:'', pages:d.pages};
            if(d.docRef){ doc2.__ref=d.docRef; doc2.__loadedTo=d.pages.length; }
            const title=uniqueTitle(d.title||'가져온 문서');
            const colors=['#4f6ef7','#e74c3c','#27ae60','#f39c12','#8e44ad','#2c3e50'];
            const c=colors[Math.floor(Math.random()*colors.length)];

            const finish=(nb)=>{
                const okP=persistDoc(nb.id,doc2);
                // 기기 저장소가 너무 작아 실패 → 서버 보관본 참조만 저장
                if(!okP&&d.docRef){
                    setCfg(nb.id,{serverDoc:d.docRef,paper:doc2.paper,
                        sizePreset:doc2.sizePreset,emoji:doc2.emoji||'',
                        orient:paperSize(doc2).w>paperSize(doc2).h?'landscape':'portrait',
                        favPages:[],tint:''});
                    toast('문서가 커서 서버에 보관했습니다 · 열 때 자동으로 불러와요',2800);
                }
                if(curFolder) setNoteFolder(nb.id,curFolder);
                notebooks.push(nb); notebooks=sortNBs(notebooks);
                prog.style.display='none';
                renderGrid();
                toast(`${d.pages.length}쪽을 가져왔습니다 · 바로 편집할 수 있어요`,3000);
                openNB(nb);
            };

            if(!SB){
                finish({id:'local_'+Date.now(),title,color:c,
                        created_at:new Date().toISOString(),
                        updated_at:new Date().toISOString()});
                return;
            }
            try{
                const{data,error}=await SB.from('notebooks').insert([{title,color:c}]).select().single();
                if(error||!data){
                    finish({id:'local_'+Date.now(),title,color:c,
                            created_at:new Date().toISOString(),
                            updated_at:new Date().toISOString()});
                    return;
                }
                // 본문을 먼저 기기에 저장한 뒤, 그 내용 그대로 서버에 넣는다.
                persistDoc(data.id,doc2);
                let content='';
                try{ content=serializeDoc(doc2,data.id); }catch(e){ content=''; }
                // 대용량은 본문 대신 '서버 보관본 참조' 마커만 동기화 →
                // 어떤 기기에서 열어도 서버에서 본문을 받아온다.
                const marker=d.docRef? JSON.stringify({serverDoc:d.docRef,
                    sizePreset:doc2.sizePreset,paper:doc2.paper}) : '';
                if(d.docRef) content=marker;   // 대용량 본문은 서버에만 둔다
                let saved=false;
                try{
                    const{error:me}=await SB.from('memos').insert([{notebook_id:data.id,
                        content:content, font_size:S.defFS}]);
                    saved=!me;
                    if(me) console.error('[import] 서버 저장 실패',me);
                }catch(e){ console.error('[import] 서버 저장 예외',e); }
                if(!saved&&marker&&content!==marker){
                    try{
                        const{error:me2}=await SB.from('memos').insert([{notebook_id:data.id,
                            content:marker, font_size:S.defFS}]);
                        saved=!me2;
                    }catch(e){}
                }
                if(!saved){
                    // 서버에 못 올렸다. 그대로 두면 다음에 열 때 백지가 되므로
                    // 기기 전용 노트로 바꿔 내용을 지킨다.
                    try{ await SB.from('notebooks').delete().eq('id',data.id); }catch(e){}
                    const lid='local_'+Date.now();
                    persistDoc(lid,doc2);
                    toast('문서가 커서 이 기기에만 저장했습니다',3600);
                    finish({id:lid,title,color:c,
                            created_at:new Date().toISOString(),
                            updated_at:new Date().toISOString()});
                    return;
                }
                finish(data);
            }catch(e){
                finish({id:'local_'+Date.now(),title,color:c,
                        created_at:new Date().toISOString(),
                        updated_at:new Date().toISOString()});
            }
        }catch(e){
            prog.style.display='none';
            toast('가져오기 실패 · 서버(app.py)가 실행 중인지 확인해 주세요',3400);
        }
    }

    // 9.4 · 새 노트 폭주 방지.
    //  버튼 연타·자동화(테스트 스크립트)·이벤트 중복 바인딩으로 createNB 가
    //  연달아 호출되면 노트가 끝없이 만들어졌다. 만드는 동안에는 잠그고,
    //  직전 생성으로부터 900ms 안의 재호출은 무시한다.
    let _mkNBBusy=false, _mkNBLast=0;
    async function createNB(preset='a4_portrait'){
        const now=Date.now();
        if(_mkNBBusy||now-_mkNBLast<900){ closeCreateModal(); return; }
        _mkNBBusy=true; _mkNBLast=now;
        try{ return await _createNB(preset); }
        finally{ _mkNBBusy=false; _mkNBLast=Date.now(); }
    }
    async function _createNB(preset='a4_portrait'){
        closeCreateModal();
        const colors=['#4f6ef7','#e74c3c','#27ae60','#f39c12','#8e44ad','#2c3e50'];
        const c=colors[Math.floor(Math.random()*colors.length)];
        const title=uniqueTitle('새 노트');
        const mk=(id)=>{
            persistDoc(id, blankDoc(preset));
            if(curFolder) setNoteFolder(id,curFolder);   // 폴더 안에서 만들면 그 폴더에 담기
        };
        const local=()=>{
            const nb={id:'local_'+Date.now(),title,color:c,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
            notebooks.push(nb); notebooks=sortNBs(notebooks); saveLocalNBs(); mk(nb.id);
            renderGrid();
            const _card=document.querySelector('.note-card[data-nb-id="'+nb.id+'"]');
            playClawDrop(_card, ()=>openNB(nb));
        };
        if(!SB){ local(); return; }
        syncStart();
        try{
            const{data,error}=await SB.from('notebooks').insert([{title,color:c}]).select().single();
            if(error||!data){ local(); return; }
            await SB.from('memos').insert([{notebook_id:data.id,content:'',font_size:S.defFS}]);
            notebooks.push(data); notebooks=sortNBs(notebooks); mk(data.id);
            renderGrid();
            const _card=document.querySelector('.note-card[data-nb-id="'+data.id+'"]');
            playClawDrop(_card, ()=>openNB(data));
        }catch(err){ local(); }
        finally{ syncEnd(); }
    }


/* APP-PART:04a-import.js:END */
