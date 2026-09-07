/* === src/app/12a-image.js ===
   이미지 업로드·배치·레거시 복구
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:12a-image.js:BEGIN */
    // ============ 이미지 ============
    let _imgPickAnchor=null;   // 우클릭 '사진 넣기'로 연 경우: 그 지점(문서 좌표)
    function triggerImgUpload(anchor){
        if(penActive) finishDrawing();
        setTextTool(false); deselectAll();
        cancelPlaceMode(); if(tablePlace) cancelTablePlacement();
        _imgPickAnchor=(anchor&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y))?anchor:null;
        document.getElementById('imgInput').click();
    }
    // 파일 선택 결과: 우클릭 지점이 잡혀 있으면 그 자리에 바로, 아니면 배치 모드로.
    // 예전에는 도구막대에서 고륜 파일이 항상 쪽 한가욤데에 들어가 커서와 동떨어져 보였다.
    async function onImgPicked(input){
        const anchor=_imgPickAnchor; _imgPickAnchor=null;
        try{
            const items=await filesToImgItems(input?input.files:null);
            if(!items.length||!doc) return;
            if(anchor&&doc.pages[anchor.pageIdx]){
                for(let i=0;i<items.length;i++)
                    placeImgItem(items[i],anchor.pageIdx,anchor.x+i*16,anchor.y+i*16);
                commitImagesNow();
                toast(items.length>1?`${items.length}장을 넣었습니다`:'그림을 넣었습니다',1300);
            }else{
                beginImgPlacement(items);
            }
        }finally{ if(input) input.value=''; }
    }

    // 원본 비율 그대로 배치 (정사각 고정 제거)
    function fitBox(nw,nh){
        const s=paperSize();
        const maxW=s.w*0.5, maxH=s.h*0.4;
        let w=nw||200, h=nh||150;
        const r=Math.min(maxW/w, maxH/h, 1);
        return {w:Math.max(24,Math.round(w*r)), h:Math.max(24,Math.round(h*r))};
    }
    function imageNaturalSize(src){
        return new Promise(res=>{
            const i=new Image();
            i.onload=()=>res({w:i.naturalWidth||200,h:i.naturalHeight||150});
            i.onerror=()=>res({w:200,h:150});
            i.src=src;
        });
    }

    // ═════════ 이미지 저장 방식 v3 · 업로드-선행(단순·확실) ═════════
    // 원칙: "서버에 올라가 다시 읽힌 사진"만 노트에 존재한다.
    //   ① 사진을 넣으면 배치보다 먼저 /api/upload 로 올린다 (그동안 배지로 진행 표시).
    //   ② 서버가 준 url(/api/img/…)을 실제 GET 으로 검증한다 — "저장됐다"는
    //      말이 아니라 "다시 읽힌다"를 확인한 주소만 쓴다.
    //   ③ 요소는 그 검증된 url 로만 만든다. pending/blob:/data:/IndexedDB/
    //      백그라운드 큐/자가복구 어느 것도 새 업로드에는 없다.
    //   ④ 업로드가 실패하면 아무것도 놓지 않고 실패를 알린다 — 어떤 기기에도
    //      '깨진 자리'가 생길 수 없다 (없거나, 어디서든 보이거나 둘 중 하나).
    //   ⑤ 배치 직후 즉시 저장·즉시 push 한다 (디바운스 대기 없음).
    // 옛 저장물(data: localURL 레거시)은 렌더 호환 + 열 때 1회 재업로드로 복구한다.
    let uploadDone=0, uploadTotal=0;

    function updateUploadBadge(){
        const el=document.getElementById('uploadBadge');
        if(!el) return;
        const left=uploadTotal-uploadDone;
        if(left>0){
            el.style.display='flex';
            el.querySelector('span').textContent=`이미지 업로드 ${uploadDone}/${uploadTotal}`;
        }else{
            el.style.display='none';
            uploadDone=uploadTotal=0;
        }
    }

    // 옛 방식 data: URL → File (레거시 복구 전용)
    function dataURLToFile(dataUrl,name){
        try{
            const [head,b64]=String(dataUrl||'').split(',');
            if(!/^data:/.test(head||'')) return null;
            const mime=(head.match(/^data:([^;]+)/)||[])[1]||'image/png';
            const bin=atob(b64||'');
            const bytes=new Uint8Array(bin.length);
            for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
            return new File([bytes], name, {type:mime});
        }catch(e){ return null; }
    }

    // 한 장을 확실하게 올린다: 최대 3회 시도, 성공 후 반드시 재-다운로드 검증.
    // 성공 → {url,public_id} / 실패 → null (호출자는 아무것도 배치하지 않는다)
    async function uploadImageStrict(file){
        let f=file;
        for(let attempt=0;attempt<3;attempt++){
            try{
                const fd=new FormData();
                fd.append('file',f); fd.append('quality','78'); fd.append('max_width','1920');
                const r=await fetch('/api/upload',{method:'POST',body:fd});
                if(r.ok){
                    const j=await r.json().catch(()=>null);
                    const url=j&&String(j.url||'');
                    if(url&&!/^(blob|data):/i.test(url)){
                        // 검증: 준 주소가 정말 읽히는지 서버에서 다시 받아본다.
                        try{
                            const v=await fetch(url,{cache:'no-store'});
                            if(v.ok){
                                const b=await v.blob();
                                if(b&&b.size>0) return {url,public_id:j.public_id||''};
                            }
                        }catch(e){}
                    }
                }
            }catch(e){}
            // 원본이 너무 커서 실패했을 수 있다 → 두 번째 시도부터는 압축본으로.
            if(attempt===0){ try{ const c=await compressImg(f); if(c&&c.size) f=c; }catch(e){} }
            await new Promise(res=>setTimeout(res,600*(attempt+1)));
        }
        return null;
    }

    // 파일 목록 → 배치 준비물. **여기서 업로드가 끝난다.**
    // 반환된 item 은 이미 검증된 서버 주소(/api/img/…)를 갖는다.
    async function filesToImgItems(files){
        const list=Array.from(files||[]).filter(f=>f&&f.type&&f.type.startsWith('image/'));
        if(!list.length) return [];
        const items=[]; let failed=0;
        uploadTotal+=list.length; updateUploadBadge();
        for(const f of list){
            const up=await uploadImageStrict(f);
            uploadDone++; updateUploadBadge();
            if(!up){ failed++; continue; }
            const nat=await imageNaturalSize(up.url);
            items.push({url:up.url,public_id:up.public_id,box:fitBox(nat.w,nat.h)});
        }
        if(failed) toast(failed>1
            ?`사진 ${failed}장 업로드 실패 — 네트워크를 확인하고 다시 넣어 주세요`
            :'사진 업로드 실패 — 네트워크를 확인하고 다시 넣어 주세요',3200);
        return items;
    }

    // 배치를 취소한 업로드는 서버에서도 지운다 (고아 파일 방지 — 실패해도 무해)
    function discardImgItems(items){
        (items||[]).forEach(it=>{
            if(!it||!it.url) return;
            try{
                fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({url:it.url,public_id:it.public_id||''})});
            }catch(e){}
        });
    }

    // 그림 한 장을 문서 좌표 (cx,cy) 중심에 둔다. item.url 은 이미 확정 주소다.
    function placeImgItem(item,pageIdx,cx,cy){
        pushHistory();
        const c=clampEl(cx-item.box.w/2,cy-item.box.h/2,item.box.w,item.box.h);
        const el={type:'image',id:uid('i'),url:item.url,
            x:Math.round(c.x),y:Math.round(c.y),w:item.box.w,h:item.box.h};
        if(item.public_id) el.public_id=item.public_id;
        doc.pages[pageIdx].els.push(el);
        markPageEdited(pageIdx);
        renderPageEls(pageIdx);
        return el;
    }

    // 배치 직후: 로컬 저장·서버 memo·요소 op 를 디바운스 없이 바로 확정한다.
    function commitImagesNow(){
        try{ flushSaveDoc(); }catch(e){ try{ saveDoc(); }catch(e2){} }
        try{ clearTimeout(opsTimer); pushOps(); }catch(e){}
        try{ if(pendingNB) flushSync(); }catch(e){}
    }

    async function uploadImgs(files,atPoint){
        if(!doc||!curNB) return;
        const _d0=doc,_nb0=curNB.id;
        const items=await filesToImgItems(files);      // ← 업로드-선행
        if(!items.length) return;
        // 업로드 대기 중 노트가 바뀌었으면 엉뚱한 노트에 놓지 않는다.
        if(doc!==_d0||!curNB||curNB.id!==_nb0){ discardImgItems(items); return; }
        const s=paperSize();
        for(let i=0;i<items.length;i++){
            const it=items[i];
            if(atPoint){
                // 붙여넣기면 마우스 위치에 연달아 살짝씩 어긋나게
                const pt=pastePoint(it.box.w,it.box.h);
                placeImgItem(it,pt.pageIdx,pt.x+it.box.w/2+i*16,pt.y+it.box.h/2+i*16);
            }else{
                // 지정 지점이 없으면 현재 페이지 위쪽에 차례로
                placeImgItem(it,curPageIdx,s.w/2,60+i*24+it.box.h/2);
            }
        }
        commitImagesNow();
        const inp=document.getElementById('imgInput'); if(inp) inp.value='';
    }

    // ── 레거시 복구: 옛 저장물에 남은 data: 원본(pending)을 열 때 1회 재업로드 ──
    //   새 방식에서는 생길 수 없는 상태다. 복구도 같은 확실한 경로(uploadImageStrict)로만 한다.
    const _legacyImgFixed=new Set();
    async function repairLegacyImages(){
        if(!doc||!curNB) return;
        const _d0=doc,_nb0=curNB.id;
        const jobs=[];
        (doc.pages||[]).forEach((pg,pi)=>((pg&&pg.els)||[]).forEach(el=>{
            if(!el||el.type!=='image'||_imgRealURL(el)) return;
            const l=String(el.localURL||'');
            if(!l.startsWith('data:image/')) return;
            if(_legacyImgFixed.has(el.id)) return;
            jobs.push({id:el.id,dataUrl:l});
        }));
        if(!jobs.length) return;
        let fixed=0;
        for(const job of jobs){
            if(doc!==_d0||!curNB||curNB.id!==_nb0) return;
            _legacyImgFixed.add(job.id);
            const f=dataURLToFile(job.dataUrl,`repair-${job.id}.png`);
            if(!f) continue;
            const up=await uploadImageStrict(f);
            if(!up){ _legacyImgFixed.delete(job.id); continue; }
            if(doc!==_d0||!curNB||curNB.id!==_nb0) return;
            const loc=findElLoc(job.id); if(!loc) continue;
            const el=doc.pages[loc.i].els[loc.k];
            el.url=up.url; if(up.public_id) el.public_id=up.public_id;
            delete el.pending; delete el.failed; delete el.localURL;
            fixed++;
            if(renderedPages.has(loc.i)){ try{ renderPageEls(loc.i); }catch(e){} }
            try{
                doc.__lastHash.set(el.id,JSON.stringify(el));
                const rev=_nbNow(); doc.__localRev.set(el.id,rev);
                pushOpsFor(_nb0,[{id:el.id,kind:'put',page:loc.i,rev,data:serverImageElement(el),dev:SYNC_DEV}]);
            }catch(e){}
        }
        if(fixed) commitImagesNow();
    }

    function compressImg(file){
        return new Promise(resolve=>{
            if(file.size<500000&&/jpe?g/.test(file.type)){ resolve(file); return; }
            const r=new FileReader();
            r.onload=e=>{
                const img=new Image();
                img.onload=()=>{
                    const c=document.createElement('canvas');
                    let w=img.width,h=img.height;
                    if(w>1920){h=Math.round(h*1920/w);w=1920;}
                    if(h>1920){w=Math.round(w*1920/h);h=1920;}
                    c.width=w;c.height=h;
                    c.getContext('2d').drawImage(img,0,0,w,h);
                    if(file.type==='image/png') c.toBlob(b=>resolve(new File([b],file.name||'image.png',{type:'image/png'})),'image/png');
                    else c.toBlob(b=>resolve(new File([b],(file.name||'image').replace(/\.\w+$/,'')+'.jpg',{type:'image/jpeg'})),'image/jpeg',0.85);
                };
                img.onerror=()=>resolve(file);
                img.src=e.target.result;
            };
            r.onerror=()=>resolve(file);
            r.readAsDataURL(file);
        });
    }

    // 붙여넣기
    document.addEventListener('paste',async e=>{
        if(!doc||!document.getElementById('editorView').classList.contains('open')) return;
        if(document.querySelector('.tb.edit')) return;   // 텍스트 편집 중엔 기본 동작
        // 입력칸(해돌이 검색창 #aiQ · 찾기칸 · 설정 입력칸…)에 붙여넣을 때는
        //   노트에 글상자를 만들지 않는다 — 안 그러면 칸에 붙여야 할 글이
        //   노트 한가운데 상자로 생기면서 정작 칸에는 아무것도 안 들어간다.
        {
            const _tag=((document.activeElement||{}).tagName)||'';
            if(_tag==='INPUT'||_tag==='TEXTAREA'||_tag==='SELECT') return;
        }

        const files=[];
        const items=e.clipboardData?.items||[];
        for(const it of items){
            if(it.type&&it.type.startsWith('image/')){
                const f=it.getAsFile();
                if(f) files.push(new File([f],`paste-${Date.now()}.${(it.type.split('/')[1]||'png')}`,{type:it.type}));
            }
        }
        if(files.length){
            e.preventDefault();
            await uploadImgs(files,true);      // 마우스 위치에 배치
            return;
        }

        // 텍스트 붙여넣기 → 자동으로 텍스트 상자 생성
        const html=e.clipboardData?.getData('text/html');
        const plain=e.clipboardData?.getData('text/plain');
        // 22.2 · 방금 '요소 복사/잘라내기'를 했는데 OS 클립보드 쓰기가 실패했다면
        //   지금 클립보드에 뭐가 들어 있는지 알 수 없다. 이때는 잠깐(60초) 동안
        //   Ctrl+V 를 요소 붙여넣기로 우선 처리한다 — 안 그러면 클립보드에 남아
        //   있던 예전 글자가 새 글상자로 붙어 복사한 요소가 사라진 것처럼 보인다.
        //   (쓰기에 성공했으면 아래 글자 일치 판정이 정확하므로 이 창은 쓰지 않는다)
        if(clipboardEls.length&&!_elsOsWrite&&Date.now()-_elsCopyAt<_ELS_PASTE_WIN){
            e.preventDefault(); pasteElements(); return;
        }
        // 18.9 · 앱에서 복사한 상자를 그대로 붙여넣기 (글꼴·크기·서식·크기 유지)
        if(clipboardEls.length&&plain&&_lastCopyText&&plain.trim()===_lastCopyText.trim()){
            e.preventDefault(); pasteElements(); return;
        }
        if(plain&&plain.trim()){
            e.preventDefault();
            let content;
            if(html&&html.trim()){
                const box=document.createElement('div');
                box.innerHTML=html;
                box.querySelectorAll('script,style,meta,link').forEach(n=>n.remove());
                box.querySelectorAll('*').forEach(n=>{
                    // 서식은 색/굵기/기울임/밑줄/배경만 유지
                    const c=n.style.color,bg=n.style.backgroundColor,
                          fw=n.style.fontWeight,fs=n.style.fontStyle,td=n.style.textDecoration;
                    n.removeAttribute('style'); n.removeAttribute('class'); n.removeAttribute('id');
                    if(c) n.style.color=c;
                    if(bg&&bg!=='transparent'&&!/rgba\(0, 0, 0, 0\)/.test(bg)) n.style.backgroundColor=bg;
                    if(fw&&(fw==='bold'||+fw>=600)) n.style.fontWeight='bold';
                    if(fs==='italic') n.style.fontStyle='italic';
                    if(td&&td.includes('underline')) n.style.textDecoration='underline';
                });
                content=box.innerHTML;
            }else{
                content=esc(plain).replace(/\n/g,'<br>');
            }
            // 글자 수에 따라 상자 크기 어림
            const s=paperSize();
            const lines=plain.split(/\n/).length;
            const w=Math.min(s.w-96, Math.max(220, Math.min(560, plain.length*11)));
            const h=Math.min(s.h-96, Math.max(52, lines*(curFontSize*1.5)+26));
            const pt=pastePoint(w,h);
            pushHistory();
            const el={type:'text',id:uid('t'),x:pt.x,y:pt.y,w:Math.round(w),h:Math.round(h),
                      html:content,fontSize:curFontSize,font:curFont};
            doc.pages[pt.pageIdx].els.push(el);
            markPageEdited(pt.pageIdx);
            renderPageEls(pt.pageIdx);
            saveDoc();
            const node=paperQ(pt.pageIdx,`.tb[data-id="${el.id}"]`);
            if(node){ deselectAll(); node.classList.add('sel'); _ensureTbControls(node); selected={type:'text',el:node}; }
            toast('텍스트 붙여넣음',1200);
            return;
        }
        // OS 클립보드가 비어 있으면 앱 내부에서 복사한 요소를 붙여넣기
        if(clipboardEls.length){ e.preventDefault(); pasteElements(); }
    });

/* APP-PART:12a-image.js:END */
