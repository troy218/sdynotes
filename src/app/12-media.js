/* === src/app/12-media.js ===
   이미지 · 내보내기 · 스티커 · 해돌이 문서브릿지
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:12-media.js:BEGIN */
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

    // ============ 내보내기 ============
    const dataUrlCache=new Map();
    async function toDataURL(url){
        if(!url||url.startsWith('data:')) return url||'';
        if(dataUrlCache.has(url)) return dataUrlCache.get(url);
        const p=(async()=>{
            try{
                const r=await fetch(url,{mode:'cors',cache:'force-cache'});
                if(r.ok){
                    const b=await r.blob();
                    return await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(b);});
                }
            }catch(e){}
            try{
                const im=new Image(); im.crossOrigin='anonymous';
                await new Promise((res,rej)=>{im.onload=res;im.onerror=rej;im.src=url;});
                const c=document.createElement('canvas');
                c.width=im.naturalWidth;c.height=im.naturalHeight;
                c.getContext('2d').drawImage(im,0,0);
                return c.toDataURL('image/png');
            }catch(e){ return ''; }
        })();
        dataUrlCache.set(url,p); return p;
    }

    function paperCSSForExport(type){
        if(type==='lined') return 'background-color:#fff;background-image:repeating-linear-gradient(transparent,transparent 31px,#e8e8e8 31px,#e8e8e8 32px);background-position:0 16px;';
        if(type==='grid') return 'background-color:#fff;background-image:linear-gradient(#e8e8e8 1px,transparent 1px),linear-gradient(90deg,#e8e8e8 1px,transparent 1px);background-size:32px 32px;';
        if(type==='dotted') return 'background-color:#fff;background-image:radial-gradient(circle,#cfcfcf 1px,transparent 1px);background-size:24px 24px;';
        return 'background-color:#fff;';
    }

    // 페이지 1장을 캔버스로 (화면 배율과 무관하게 항상 원본 크기)
    // HTML → XHTML 로 정규화.
    // foreignObject 는 '엄격한 XML' 만 받는다. contentEditable 이 만드는
    // <br>, &nbsp;, 안 닫힌 태그 때문에 내보내기가 통째로 실패하던 문제를 여기서 차단한다.
    function htmlToXhtml(html){
        const box=document.createElement('div');
        box.innerHTML=html||'';
        // XMLSerializer 는 항상 well-formed XML 을 만들어 준다
        let xml=new XMLSerializer().serializeToString(box);
        xml=xml.replace(/^<div[^>]*>/,'').replace(/<\/div>$/,'');
        // 숫자 참조만 남기고 명명 엔티티(&nbsp; 등)는 XML 에서 미정의라 치환
        xml=xml.replace(/&nbsp;/g,'\u00a0');
        return xml;
    }
    function escXml(t){
        return String(t==null?'':t)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
    }

    // SVG <img> documents cannot use the editor's loaded web fonts. Bundle only
    // the PDF families actually referenced, using same-origin cached WOFF2 data.
    const _pdfSvgFonts=new Map();
    async function _pdfSvgFontCSS(svg){
        const rules=[];
        for(const sheet of document.styleSheets){
            let list; try{ list=sheet.cssRules; }catch(e){ continue; }
            for(const rule of list||[]){
                if(rule.type!==5) continue;
                const family=rule.style.fontFamily.replace(/['"]/g,'');
                if(!family.startsWith('SDY ')||!svg.includes(family)) continue;
                const text=rule.cssText, match=text.match(/url\(["']?([^"')]+)["']?\)/);
                if(!match) continue;
                const url=new URL(match[1],sheet.href||location.href).href;
                if(!_pdfSvgFonts.has(url)) _pdfSvgFonts.set(url,toDataURL(url));
                const data=await _pdfSvgFonts.get(url);
                if(data) rules.push(text.replace(match[0], 'url("'+data+'")'));
            }
        }
        return rules.join('\n');
    }
    async function _pdfLoadExportFonts(els){
        if(!document.fonts) return;
        const faces=new Map();
        for(const el of els){
            if(!el.pdfText||!el.tight) continue;
            const c=document.createElement('div'); c.innerHTML=el.html||'';
            for(const s of c.querySelectorAll(':scope > span[data-pdf-w]')){
                const st=s.style, fs=parseFloat(st.fontSize)||el.fontSize||parseFloat(s.dataset.fs)||14;
                const font=[st.fontStyle||'normal',st.fontWeight||'400',fs+'px',st.fontFamily||fontCSS(el.font)].join(' ');
                if(!faces.has(font)) faces.set(font,new Set());
                const chars=faces.get(font);
                for(const ch of s.textContent||'') if(chars.size<1024) chars.add(ch);
            }
        }
        await Promise.all([...faces].map(([font,chars])=>document.fonts.load(font,[...chars].join('')).catch(()=>{})));
    }
    function _pdfStaticHtml(el){
        if(!el.pdfText||!el.tight) return el.html||'';
        const c=document.createElement('div'); c.innerHTML=el.html||'';
        c.style.fontFamily=fontCSS(el.font||'times');
        for(const s of c.querySelectorAll(':scope > span[data-pdf-w]')){
            const fs=parseFloat(s.style.fontSize)||el.fontSize||parseFloat(s.dataset.fs)||14;
            const m=_pdfSpanMetrics(s,c,fs), width=parseFloat(s.dataset.pdfW), base=parseFloat(s.dataset.pdfBase);
            if(m&&m.w>0&&width>0){ s.style.transform='scaleX('+(width/m.w)+')'; s.style.transformOrigin='left center'; }
            if(m&&Number.isFinite(base)) s.style.top=(base-m.baseline)+'px';
        }
        c.querySelectorAll('.zsp').forEach(n=>n.style.fontSize='0px');
        return c.innerHTML;
    }
    let _katexSvgFonts;
    async function _katexSvgCSS(){
        if(_katexSvgFonts) return _katexSvgFonts;
        _katexSvgFonts=(async()=>{
            const link=document.querySelector('link[rel="stylesheet"][href*="katex"]');
            if(!link) return '';
            const response=await fetch(link.href,{cache:'force-cache'});
            if(!response.ok) return '';
            let css=await response.text();
            const faces=[...css.matchAll(/@font-face\s*\{[^}]+\}/g)].map(m=>m[0]);
            const embedded=await Promise.all(faces.map(async face=>{
                const m=face.match(/url\(["']?([^"')]+\.woff2)["']?\)/);
                if(!m) return '';
                const data=await toDataURL(new URL(m[1],link.href).href);
                return data?face.replace(/src:[^;}]*/, 'src:url("'+data+'") format("woff2")'):'';
            }));
            faces.forEach((face,i)=>css=css.replace(face,embedded[i]));
            return css+'\n.katex{font-size:1em;line-height:1.05}.katex-display{margin:0}';
        })().catch(()=>{ _katexSvgFonts=null; return ''; });
        return _katexSvgFonts;
    }
    async function svgToImage(svg){
        const fonts=(svg.includes('SDY ')?await _pdfSvgFontCSS(svg):'')+
                    (svg.includes('katex')?await _katexSvgCSS():'');
        if(fonts) svg=svg.replace(/(<svg\b[^>]*>)/,'$1<style><![CDATA['+fonts+']]></style>');
        const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
        const img=new Image();
        await new Promise((res,rej)=>{
            img.onload=res;
            img.onerror=()=>rej(new Error('svg render fail'));
            img.src=url;
        });
        if(img.decode){ try{ await img.decode(); }catch(e){} }
        return img;
    }

    // 다크모드에서 저장된 밝은 글자색을 인쇄용으로 어둡게 보정
    function fixDarkColors(html){
        if(!html) return html;
        const box=document.createElement('div');
        box.innerHTML=html;
        box.querySelectorAll('[style]').forEach(n=>{
            const c=n.style.color;
            if(!c) return;
            const m=c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if(m){
                const lum=(+m[1]*0.299 + +m[2]*0.587 + +m[3]*0.114);
                if(lum>210) n.style.color='#111111';   // 흰색 계열 → 검정
            }else if(/^#(fff|ffffff|eee|eeeeee)$/i.test(c.trim())){
                n.style.color='#111111';
            }
        });
        return box.innerHTML;
    }

    // ===== 선택한 것들을 스티커(SVG 벡터)로 만들기 =====
    // 14.16.7 · PNG 래스터 대신 SVG 로 굽는다 — 아무리 확대해도 선·글자가 깨지지 않는다.
    //   내보내기·화면 렌더가 검증된 조립을 그대로 쓴다:
    //     · 펜 획  → <path>      (화면 렌더와 같은 strokePath 지오메트리)
    //     · 글자   → <foreignObject> + htmlToXhtml (서식 유지)
    //     · 이미지 → <image>     (가능하면 data: 로 인라인 — SVG 안에서는 외부 참조가 안 열린다)
    //     · 수식   → KaTeX HTML (화면과 같은 마크업)
    //   SVG 굽기가 실패하면 예전 캔버스 PNG 경로로 저장한다(폴백).
    async function bakeStickerSVG(items,pi,rx,ry,rw,rh){
        const ids=new Set(items.map(i=>i.id));
        const list=(doc.pages[pi].els||[]).filter(e=>ids.has(e.id));
        let drew=0, imgs='', paths='', body='';
        for(const el of list){
            if(el.type==='image'&&el.url){
                // SVG 는 <img> 로 열면 외부 그림을 못 가져오므로 data: 로 인라인한다
                const href=await toDataURL(el.url);
                if(!href) continue;
                const ia=normalizedRotation(el.rotation), icx=el.x+el.w/2, icy=el.y+el.h/2;
                imgs+=`<image x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}"`+
                      (ia?` transform="rotate(${ia} ${icx} ${icy})"`:'')+
                      ` href="${escXml(href)}" xlink:href="${escXml(href)}"/>`;
                drew++;
            }else if(el.type==='stroke'){
                const d=strokePath(el.pts, el.sharp&&!isEllipsePts(el.pts));
                if(!d) continue;
                const tr=strokeTransform(el);
                if(el.fillColor) paths+=`<path d="${d}" fill="${escXml(el.fillColor)}" fill-opacity="${el.fillOpacity==null?0.58:el.fillOpacity}" fill-rule="evenodd"${tr?` transform="${tr}"`:''}/>`;
                paths+=`<path d="${d}" fill="none" stroke="${escXml(el.color||'#111111')}"`+
                       ` stroke-width="${el.size||2}" stroke-linecap="round" stroke-linejoin="round"`+
                       (tr?` transform="${tr}"`:'')+
                       (el.opacity!=null?` opacity="${el.opacity}"`:'')+`/>`;
                drew++;
            }
        }
        // 글자·수식 — 내보내기와 같은 foreignObject 조립 (좌표는 스티커 영역 기준)
        const texts=list.filter(e=>e.type==='text'&&(e.html||'').trim());
        const formulas=list.filter(e=>e.type==='latex'&&(e.latex||'').trim());
        texts.forEach(el=>{
            const inner=el.tight
                ? `width:100%;height:100%;padding:0;box-sizing:border-box;`+
                  `font-size:${el.fontSize||16}px;line-height:1;color:${el.__c||'#111111'};`+
                  `overflow:visible;font-family:${fontCSS(el.font||'pretendard')};`+
                  `text-align:${el.align||'left'};position:relative;`
                : `width:100%;height:100%;padding:8px 12px;box-sizing:border-box;`+
                  `font-size:${el.fontSize||16}px;line-height:1.5;color:${el.__c||'#111111'};white-space:pre-wrap;`+
                  `word-break:break-word;overflow:hidden;font-family:${fontCSS(el.font||'pretendard')};`+
                  `text-align:${el.align||'left'};`;
            body+=`<div style="position:absolute;left:${el.x-rx}px;top:${el.y-ry}px;width:${el.w}px;height:${el.h}px;transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;">`+
                  `<div style="${inner}">`+
                  htmlToXhtml(fixDarkColors(imathExpandHtml(el.html)))+`</div></div>`;
            drew++;
        });
        formulas.forEach(el=>{
            let mh;
            try{ mh=window.katex?katex.renderToString(el.latex||'',{displayMode:!!el.displayMath,throwOnError:false,strict:'ignore',output:'html'}):esc(el.latex||''); }
            catch(e){ mh=esc(el.latex||''); }
            const imp=!!el.imported;
            const bw=imp?(el.inkW||el.w):el.w, bh=imp?(el.inkH||el.h):el.h;
            const k=imp?Math.min(1,(latexFitScale(el)||1)):1;
            const fs=Math.max(6,(el.fontSize||20)*k);
            body+=`<div style="position:absolute;left:${el.x-rx}px;top:${el.y-ry}px;width:${bw}px;height:${bh}px;`+
                  `transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;display:flex;align-items:center;${el.displayMath?'justify-content:center;':''}font-size:${fs}px;`+
                  `line-height:1.05;font-family:'Times New Roman',serif;color:#111;`+
                  `overflow:${imp?'hidden':'visible'};">${htmlToXhtml(mh)}</div>`;
            drew++;
        });
        if(!drew) throw new Error('스티커로 만들 내용이 없다');
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`+
            ` width="${Math.max(1,Math.round(rw))}" height="${Math.max(1,Math.round(rh))}" viewBox="${rx} ${ry} ${rw} ${rh}">`+
            imgs+paths+
            (body?`<foreignObject x="${rx}" y="${ry}" width="${rw}" height="${rh}">`+
                  `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${rw}px;height:${rh}px;position:relative;">${body}</div>`+
                  `</foreignObject>`:'')+
            `</svg>`;
        return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    }
    async function makeSticker(){
        const items=selEntries();
        if(!items.length){ toast('먼저 요소를 선택해 주세요',1800); return; }
        const pi=items[0].pageIdx;
        const bb=unionBBox(items,pi);
        if(!bb||bb.w<2||bb.h<2){ toast('선택 영역이 너무 작습니다',1800); return; }

        const pad=8;
        const rx=Math.max(0,Math.round(bb.x-pad)), ry=Math.max(0,Math.round(bb.y-pad));
        const rw=Math.round(bb.w+pad*2), rh=Math.round(bb.h+pad*2);
        toast('스티커를 만드는 중…',1200);
        let url='', isSvg=true;
        try{
            url=await bakeStickerSVG(items,pi,rx,ry,rw,rh);
        }catch(e){ console.warn('SVG 스티커 굽기 실패 → PNG 폴백',e); }
        if(!url){
            // 폴백: 예전 캔버스 PNG 굽기 — SVG 를 못 만드는 환경에서도 스티커는 남는다
            try{
                const ids=new Set(items.map(i=>i.id));
                const full=await renderPageCanvas(pi,{onlyIds:ids,transparent:true});
                const sc=full.width/paperSize().w;
                const out=document.createElement('canvas');
                out.width=Math.max(1,Math.round(rw*sc));
                out.height=Math.max(1,Math.round(rh*sc));
                const octx=out.getContext('2d');
                octx.drawImage(full, Math.round(rx*sc), Math.round(ry*sc),
                                     out.width, out.height,
                                     0,0, out.width, out.height);
                url=out.toDataURL('image/png'); isSvg=false;
            }catch(e){
                console.error(e); toast('스티커 만들기 실패',2200); return;
            }
        }

        // 14.18.4 · "스티커로 만들기"는 이제 종이에 한 번 붙였다가 저장하는 동작이 아니라,
        //   보관함에만 바로 넣는다. 원본 선택 요소는 그대로 두고, 필요할 때 사용자가
        //   보관함에서 다시 골라 붙인다.
        try{
            const r=await fetch('/api/stickers/save',{method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({data:url,name:'스티커'})});
            const d=await r.json().catch(()=>null);
            if(!r.ok||!d||!d.ok){
                toast('스티커 보관함 저장 실패',2200);
                return;
            }
            toast(isSvg
                ? '스티커함에 저장됨 · 벡터라 확대해도 안 깨져요'
                : '스티커함에 저장됨 · 보관함에서 꺼내 쓸 수 있어요',2600);
        }catch(e){
            console.error(e);
            toast('스티커 보관함 저장 실패',2200);
        }
    }

    // 노트 정보 (용량·페이지·시간)
    function showNoteInfo(nb){
        const cfg=getCfg(nb.id);
        const d=loadDoc(nb.id);
        let bytes=0;
        try{ bytes=new Blob([localStorage.getItem('nb_'+nb.id)||'']).size; }catch(e){}
        const els=(d.pages||[]).reduce((t,p)=>t+((p.els||[]).length),0);
        const imgs=(d.pages||[]).reduce((t,p)=>t+((p.els||[]).filter(e=>e.type==='image').length),0);
        const txts=(d.pages||[]).reduce((t,p)=>t+((p.els||[]).filter(e=>e.type==='text').length),0);
        const strs=(d.pages||[]).reduce((t,p)=>t+((p.els||[]).filter(e=>e.type==='stroke').length),0);
        const fmtT=(v)=>v?new Date(v).toLocaleString('ko-KR',
            {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}):'-';
        const peers=livePeerCount[nb.id]||0;
        const row=(k,v)=>`<div style="display:flex;justify-content:space-between;gap:16px;
            padding:7px 0;border-bottom:1px solid var(--border);">
            <span style="color:var(--text3);font-size:12.5px;">${k}</span>
            <span style="font-size:12.5px;font-weight:600;text-align:right;">${v}</span></div>`;
        const m=document.getElementById('infoModal');
        document.getElementById('infoBody').innerHTML=
            row('제목',esc(nb.title||'제목 없음'))+
            row('용량',fmtBytes(bytes))+
            row('페이지',(d.pages||[]).length+'쪽')+
            row('요소',`${els}개 (글 ${txts} · 그림 ${imgs} · 펜 ${strs})`)+
            row('종이',({blank:'빈 종이',lined:'줄 노트',grid:'격자',dotted:'도트'})[d.paper]||d.paper)+
            row('만든 날짜',fmtT(nb.created_at))+
            row('마지막 수정',fmtT(nb.updated_at||nb.created_at))+
            row('잠금',(cfg.lock&&cfg.lock.enc)?'🔒 설정됨':'없음')+
            (peers>1?row('현재 접속',peers+'명이 함께 보는 중'):'');
        m.style.display='flex';
        openNav(closeNoteInfo);
    }
    function closeNoteInfo(){ document.getElementById('infoModal').style.display='none'; navDrop(closeNoteInfo); }

    // ============ 스티커 보관함 ============
    let stickerList=[];
    // 빈 종이 우클릭 → '스티커 넣기' 로 열었을 때 그 자리(pageIdx·문서 px).
    // 툴바로 열면 null — 스티커를 기본 자리(80,100)에 붙인다.
    let _stickerAnchor=null;
    async function openStickers(){
        document.getElementById('stickerModal').style.display='flex';
        openNav(closeStickers);
        const box=document.querySelector('#stkList .vault-grid');
        box.innerHTML='<div class="vault-empty">불러오는 중…</div>';
        try{
            const r=await fetch('/api/stickers/list',{cache:'no-store'});
            const d=await r.json();
            stickerList=(d&&d.stickers)||[];
            renderStickers();
        }catch(e){ box.innerHTML='<div class="vault-empty">서버에 연결할 수 없습니다</div>'; }
    }
    function closeStickers(){
        document.getElementById('stickerModal').style.display='none';
        _stickerAnchor=null;                 // 닫으면 기억한 자리도 버린다
        navDrop(closeStickers);
    }
    function renderStickers(){
        const box=document.querySelector('#stkList .vault-grid');
        document.getElementById('stkCount').textContent=
            stickerList.length?stickerList.length+'개':'';
        if(!stickerList.length){
            box.innerHTML='<div class="vault-empty"><i class="ri-sticky-note-line"></i>'+
                '스티커가 없습니다<br><span style="font-size:11.5px">'+
                '여러 개를 선택하고 우클릭 → 스티커로 만들기</span></div>';
            return;
        }
        box.innerHTML=stickerList.map(s=>
            `<div class="v-file" title="${esc(s.name||'')}" onclick="useSticker('${s.id}')"
                  oncontextmenu="event.preventDefault();delSticker('${s.id}')">
                <img class="v-thumb" src="${esc(s.url)}" alt="" loading="lazy">
                <div class="v-name">${esc(s.name||'스티커')}</div>
                <div class="v-size">${fmtBytes(s.bytes||0)}</div>
            </div>`).join('');
    }
    function useSticker(id){
        const s=stickerList.find(x=>x.id===id); if(!s) return;
        if(!doc){ toast('노트를 먼저 열어주세요',1800); return; }
        const im=new Image();
        im.onload=()=>{
            pushHistory();
            // SVG 스티커는 내부 크기(width/height 속성)가 곧 자연 크기다 —
            // 못 구하면 기본 300px 폭으로 시작해도 벡터라 확대 시 깨지지 않는다
            const iw=Math.max(1,im.width||0), ih=Math.max(1,im.height||0);
            const sc=Math.min(1,300/Math.max(iw,ih));
            const w=Math.round(iw*sc)||300, h=Math.round(ih*sc)||200;
            // 우클릭 자리를 기억한 상태(빈 종이 → 스티커 넣기)면 그 자리 중앙에 붙이고,
            // 아니면(툴바) 기본 자리에 붙는다. 우클릭한 페이지에 붙는다.
            let pi=curPageIdx, x=80, y=100;
            if(_stickerAnchor&&doc.pages[_stickerAnchor.pageIdx]){
                pi=_stickerAnchor.pageIdx;
                const c=clampEl(_stickerAnchor.x-w/2,_stickerAnchor.y-h/2,w,h);
                x=Math.round(c.x); y=Math.round(c.y);
            }
            doc.pages[pi].els.push({type:'image',id:uid('i'),url:s.url,
                x,y,w,h,sticker:true});
            markPageEdited(pi); renderPageEls(pi); saveDoc();
            closeStickers(); toast('스티커를 붙였습니다',1600);
        };
        im.onerror=()=>toast('스티커를 불러오지 못했습니다',2000);
        im.src=s.url;
    }
    async function delSticker(id){
        const s=stickerList.find(x=>x.id===id); if(!s) return;
        if(!confirm('이 스티커를 보관함에서 지울까요?')) return;
        try{
            await fetch('/api/stickers/delete',{method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({id})});
            stickerList=stickerList.filter(x=>x.id!==id);
            renderStickers(); toast('삭제됨',1400);
        }catch(e){ toast('삭제 실패',1800); }
    }

    // ── 14.25.0 · 똑똑한 해돌이 도우미 ──────────────────────────────────
    // 색이름 → 실제 팔레트. 화면의 글자색·형광펜·펜 목록(CLASSIC_*_COLORS)과
    // 같은 값이라, AI가 고른 색이 도구막대 색과 어긋나지 않는다.
    const AI_TEXT_COLOR_NAMES={검정:'#000000',검은색:'#000000',까망:'#000000',
        빨강:'#e74c3c',빨간색:'#e74c3c',주황:'#e67e22',주황색:'#e67e22',갈색:'#e67e22',
        노랑:'#f1c40f',노란색:'#f1c40f',초록:'#2ecc71',초록색:'#2ecc71',녹색:'#2ecc71',
        청록:'#1abc9c',파랑:'#3498db',파란색:'#3498db',남색:'#3498db',하늘:'#3498db',
        보라:'#9b59b6',보라색:'#9b59b6',분홍:'#e84393',분홍색:'#e84393',핑크:'#e84393',
        회색:'#7f8c8d',회색빛:'#7f8c8d',흰색:'#ffffff',하양:'#ffffff',하얀색:'#ffffff'};
    const AI_HL_COLOR_NAMES={노랑:'#ffff00',노란색:'#ffff00',연두:'#a8ff60',연두색:'#a8ff60',
        하늘:'#7bfdff',하늘색:'#7bfdff',파랑:'#9cc9ff',파란색:'#9cc9ff',
        보라:'#ff9cf5',보라색:'#ff9cf5',분홍:'#ffb3c1',분홍색:'#ffb3c1',핑크:'#ffb3c1',
        빨강:'#ffb3c1',빨간색:'#ffb3c1',주황:'#ffc98b',주황색:'#ffc98b',
        초록:'#b6ff8c',초록색:'#b6ff8c',회색:'#dfe4ea',황금:'#ffd700',금색:'#ffd700'};
    const AI_CLEAR_WORDS={없음:1,지우기:1,지워:1,투명:1,none:1,clear:1,off:1};
    function aiEditColor(value,hl){
        let v=String(value==null?'':value).trim().toLowerCase();
        if(!v) return null;
        if(AI_CLEAR_WORDS[v]) return '';
        if(/^#[0-9a-f]{3}$/.test(v))
            return '#'+v.slice(1).split('').map(ch=>ch+ch).join('');
        if(/^#[0-9a-f]{6}$/.test(v)) return v;
        const map=hl?AI_HL_COLOR_NAMES:AI_TEXT_COLOR_NAMES;
        v=String(value==null?'':value).trim().replace(/색$/,'');
        if(AI_CLEAR_WORDS[v.toLowerCase()]) return '';
        if(hl&&map[v]) return map[v];
        if(!hl&&map[v]) return map[v];
        // 형광펜에 글자색 이름을 적었으면 글자색 팔레트에서도 찾아본다(관대하게).
        if(hl&&AI_TEXT_COLOR_NAMES[v]) return AI_TEXT_COLOR_NAMES[v];
        return null;
    }
    // 글꼴 id·라벨 모두 받는다 ("개구쟁이체"처럼 체가 붙어도 된다).
    function aiEditFont(value){
        const v=String(value==null?'':value).trim().toLowerCase();
        if(!v) return null;
        let hit=FONTS.find(f=>f.id.toLowerCase()===v);
        if(hit) return hit.id;
        const bare=v.replace(/체$/,'');
        hit=FONTS.find(f=>f.label.toLowerCase()===v||f.label.toLowerCase()===bare
            ||f.label.replace(/체$/,'').toLowerCase()===bare);
        return hit?hit.id:null;
    }
    const AI_ON_WORDS={on:1,true:1,1:1,켜:1,켜기:1,적용:1,yes:1};
    const AI_OFF_WORDS={off:1,false:1,0:1,꺼:1,끄기:1,해제:1,없음:1,no:1};
    function aiEditBool(value){
        const v=String(value==null?'':value).trim().toLowerCase();
        if(AI_ON_WORDS[v]) return true;
        if(AI_OFF_WORDS[v]) return false;
        return null;
    }
    // @st 서식 문자열("font=gaegu, fs=20, bold=on") → 검증된 변경 목록.
    // 모르는 속성은 버리고(rule: 조용히 버리되 전부 못 알아들으면 실패),
    // 값 검증을 통과한 것만 돌려준다.
    function aiEditStyleOps(style){
        const out=[];
        String(style==null?'':style).split(/[,;]/).forEach(piece=>{
            const m=/^\s*([^=:]+?)\s*[=：:]\s*(.+?)\s*$/.exec(piece);
            if(!m) return;
            let key=String(m[1]).trim().toLowerCase(), val=String(m[2]).trim();
            if(!key||!val) return;
            key=key.replace(/\s+/g,'');
            if(key==='font'||key==='글꼴'){
                const id=aiEditFont(val);
                if(id) out.push({k:'font',v:id});
            }else if(key==='fs'||key==='size'||key==='fontsize'||key==='크기'
                     ||key==='글자크기'||key==='글씨크기'){
                const n=Number(String(val).replace(/px$/i,''));
                if(Number.isFinite(n)) out.push({k:'fs',v:Math.max(2,Math.min(200,Math.round(n)))});
            }else if(key==='fg'||key==='color'||key==='textcolor'||key==='색'
                     ||key==='글자색'||key==='글씨색'){
                const c=aiEditColor(val,false);
                if(c!=null) out.push({k:'fg',v:c});
            }else if(key==='hl'||key==='bg'||key==='background'||key==='backgroundcolor'
                     ||key==='형광펜'||key==='형광'||key==='배경'||key==='배경색'){
                const c=aiEditColor(val,true);
                if(c!=null) out.push({k:'hl',v:c});
            }else if(key==='bold'||key==='굵게'||key==='굵기'){
                const b=aiEditBool(val);
                if(b!=null) out.push({k:'bold',v:b});
            }else if(key==='italic'||key==='기울임'||key==='기울기'){
                const b=aiEditBool(val);
                if(b!=null) out.push({k:'italic',v:b});
            }else if(key==='underline'||key==='밑줄'){
                const b=aiEditBool(val);
                if(b!=null) out.push({k:'underline',v:b});
            }else if(key==='strike'||key==='strikethrough'||key==='취소선'){
                const b=aiEditBool(val);
                if(b!=null) out.push({k:'strike',v:b});
            }else if(key==='align'||key==='정렬'){
                const a=val.toLowerCase();
                if(a==='left'||a==='왼쪽') out.push({k:'align',v:'left'});
                else if(a==='center'||a==='middle'||a==='가운데'||a==='중앙') out.push({k:'align',v:'center'});
                else if(a==='right'||a==='오른쪽') out.push({k:'align',v:'right'});
            }else if(key==='pencolor'||key==='펜색'||key==='펜'){
                const c=aiEditColor(val,false);
                if(c) out.push({k:'pencolor',v:c});
            }else if(key==='pensize'||key==='굵기px'){
                const n=Number(val);
                if(Number.isFinite(n)) out.push({k:'pensize',v:Math.max(0.5,Math.min(30,n))});
            }
        });
        return out;
    }
    function aiEditDecodeEntities(s){
        try{
            const ta=document.createElement('textarea');
            ta.innerHTML=String(s==null?'':s);
            return ta.value;
        }catch(e){ return String(s==null?'':s); }
    }
    // 서식을 살린 부분 바꾸기(@rp). html을 태그·글·줄바꿈 토큰으로 나눈 뒤
    // 글 토큰 위에서 찾을 글을 찾아 바꾼다 — 굵기·색 span은 그대로 남는다.
    // 찾을 글이 span 경계를 가로질러도(앞 토큰 끝+뒤 토큰 앞) 이어서 찾는다.
    function aiEditReplaceHtml(html,find,repl){
        const src=String(html==null?'':html);
        const needle=String(find==null?'':find);
        const rep=String(repl==null?'':repl);
        if(!needle) return {html:src,count:0};
        const raws=src.split(/(<[^>]*>)/g);
        const toks=[];
        raws.forEach(part=>{
            if(!part) return;
            if(part.charAt(0)==='<'){
                if(/^<br\s*\/?>$/i.test(part)) toks.push({t:'br'});
                else toks.push({t:'tag',s:part});
            }else{
                toks.push({t:'txt',s:aiEditDecodeEntities(part)});
            }
        });
        let joined='';
        const pos=[];
        toks.forEach((tk,i)=>{
            if(tk.t==='txt'){
                for(let k=0;k<tk.s.length;k++){ pos.push({i,o:k}); }
                joined+=tk.s;
            }else if(tk.t==='br'){ pos.push({i,o:-1}); joined+='\n'; }
        });
        const spans=[];
        let from=0;
        for(;;){
            const at=joined.indexOf(needle,from);
            if(at<0||spans.length>=50) break;
            spans.push([at,at+needle.length]);
            from=at+Math.max(1,needle.length);
        }
        if(!spans.length) return {html:src,count:0};
        // 뒤에서부터 고쳐 앞쪽 오프셋이 밀리지 않게 한다.
        for(let s=spans.length-1;s>=0;s--){
            const a=spans[s][0],b=spans[s][1];
            const pA=pos[a],pB=b<pos.length?pos[b]:null;
            const endTok=pB?pB.i:toks.length, endOff=pB?(pB.o<0?0:pB.o):0;
            const stTok=pA.i, stOff=pA.o<0?0:pA.o;
            for(let i=stTok+1;i<endTok;i++){
                if(toks[i].t==='txt') toks[i].s='';
                else if(toks[i].t==='br') toks[i].dead=true;
            }
            if(pA.o<0){
                // 줄바꿈부터 시작 — <br>을 지우고 그 앞에 바꾼 글을 넣는다.
                toks[stTok].dead=true;
                toks.splice(stTok,0,{t:'txt',s:rep});
                if(endTok<toks.length-1&&toks[endTok+1]&&toks[endTok+1].t==='txt')
                    toks[endTok+1].s=toks[endTok+1].s.slice(endOff);
            }else if(stTok===endTok){
                toks[stTok].s=toks[stTok].s.slice(0,stOff)+rep+toks[stTok].s.slice(stOff+(b-a));
            }else{
                toks[stTok].s=toks[stTok].s.slice(0,stOff)+rep;
                if(endTok<toks.length&&toks[endTok]&&toks[endTok].t==='txt')
                    toks[endTok].s=toks[endTok].s.slice(endOff);
            }
        }
        let out='';
        toks.forEach(tk=>{
            if(tk.dead) return;
            if(tk.t==='tag') out+=tk.s;
            else if(tk.t==='br') out+='<br>';
            else if(tk.t==='txt') out+=esc(tk.s).replace(/\n/g,'<br>');
        });
        return {html:out,count:spans.length};
    }

    // ── 14.27.0 · 형광펜(부분 강조) ──────────────────────────────────────
    // 해돌이가 형광펜을 못 알아듣던 이유는 '상자 전체 배경(el.cellBg)'밖에
    // 못 건드렸기 때문이다. 이제 저장 포맷과 같은 글자 span(background-color)으로
    // 글귀 단위로 칠하고, 스냅샷에도 칠해진 곳을 ⟦…⟧ 로 보여 준다.
    const AI_HL_MARK=['\u27e6','\u27e7'];               // ⟦ ⟧ — 스냅샷의 형광펜 표시
    const AI_HL_DEFAULT='#ffff00';                     // 색을 안 적으면 노랑 형광펜
    const AI_HL_BG_RE=/background(?:-color)?\s*:\s*[^;"']+\s*;?/gi;
    const AI_VOID_TAGS={br:1,hr:1,img:1,input:1,meta:1,link:1,area:1,base:1,col:1,
        embed:1,source:1,track:1,wbr:1};
    // span·font 같은 글자 꾸밈 태그에 형광펜(배경색)이 들어 있는가.
    function aiEditTagBg(tagStr){
        const s=String(tagStr||'');
        const m=/background(?:-color)?\s*:\s*([^;"']+)/i.exec(s);
        if(m){
            // rgb(…)·이름으로 적혀 있어도 알아본다(가져온 문서에 그런 경우가 있다).
            let raw=String(m[1]).trim();
            try{
                if(typeof _colorToHex==='function'){
                    const hx=_colorToHex(raw);
                    if(hx&&hx!=='transparent') raw=hx;
                }
            }catch(e){}
            const c=aiEditColor(raw,true);
            if(c) return c;
        }
        const d=/data-(?:highlight|background-color)\s*=\s*"([^"]+)"/i.exec(s);
        if(d){
            const c2=aiEditColor(d[1],true);
            if(c2) return c2;
        }
        return '';
    }
    // 태그 문자열에서 배경색만 걷어낸다(다른 서식은 그대로).
    function aiEditStripBg(tagStr){
        return String(tagStr||'')
            .replace(/(<[a-zA-Z][^>]*?\sstyle\s*=\s*")([^"]*)(")/gi,(all,pre,css,post)=>{
                const next=css.replace(AI_HL_BG_RE,'').replace(/;;+/g,';')
                    .replace(/^\s*;|;\s*$/g,'').trim();
                return pre+next+post;
            })
            .replace(/\sdata-(?:highlight|background-color)\s*=\s*"[^"]*"/gi,'');
    }
    // 스냅샷 미리보기 — 칠해진 글귀를 ⟦…⟧ 로 감싸 모델에게 보여 준다.
    function aiEditHlPreview(html){
        const parts=String(html==null?'':html).split(/(<[^>]*>)/g);
        const stack=[]; let out='',open=false;
        parts.forEach(part=>{
            if(!part) return;
            if(part.charAt(0)==='<'){
                if(/^<br\s*\/?>$/i.test(part)){ if(open){ out+=AI_HL_MARK[1]; open=false; } out+='\n'; return; }
                const m=/^<\s*(\/?)\s*([a-zA-Z][0-9]*)([^>]*?)(\/?)\s*>$/.exec(part);
                if(!m) return;
                const tag=m[2].toLowerCase();
                if(m[1]){
                    for(let k=stack.length-1;k>=0;k--){
                        if(stack[k].tag===tag){ stack.length=k; break; }
                    }
                    return;
                }
                if(m[4]||AI_VOID_TAGS[tag]) return;
                stack.push({tag:tag,bg:tag==='mark'||!!aiEditTagBg(part)});
                return;
            }
            let bg=false;
            for(const s of stack){ if(s.bg){ bg=true; break; } }
            const txt=aiEditDecodeEntities(part).replace(/\s+/g,' ');
            if(!txt) return;
            if(bg&&!open){ out+=AI_HL_MARK[0]; open=true; }
            else if(!bg&&open){ out+=AI_HL_MARK[1]; open=false; }
            out+=txt.replace(/</g,'‹').replace(/>/g,'›');
        });
        if(open) out+=AI_HL_MARK[1];
        return out.replace(/\s+/g,' ').trim();
    }
    // 모델이 스냅샷의 ⟦⟧ 표시를 그대로 베껴 와도 찾을 수 있게 털어 낸다.
    function aiEditLooseFind(value){
        const mark=new RegExp('['+AI_HL_MARK[0]+AI_HL_MARK[1]+']','g');
        return String(value==null?'':value).replace(mark,'').replace(/\s+/g,' ').trim();
    }
    // 글귀에 형광펜 span을 씌운다. 기존 굵기·색 span과 어긋나게 중첩되지 않도록
    // 글 토큰 단위로 감싼다(태그를 반쯤 걸친 span을 만들지 않는다).
    function aiEditMarkHtml(html,find,color){
        const src=String(html==null?'':html);
        const needle=String(find==null?'':find);
        if(!needle) return {html:src,count:0};
        const toks=[];
        src.split(/(<[^>]*>)/g).forEach(part=>{
            if(!part) return;
            if(part.charAt(0)==='<'){
                if(/^<br\s*\/?>$/i.test(part)) toks.push({t:'br'});
                else toks.push({t:'tag',s:part});
            }else toks.push({t:'txt',s:aiEditDecodeEntities(part)});
        });
        let joined=''; const pos=[];
        toks.forEach((tk,i)=>{
            if(tk.t==='txt'){ for(let k=0;k<tk.s.length;k++) pos.push({i:i,o:k}); joined+=tk.s; }
            else if(tk.t==='br'){ pos.push({i:i,o:-1}); joined+='\n'; }
        });
        const spans=[]; let from=0;
        for(;;){
            const at=joined.indexOf(needle,from);
            if(at<0||spans.length>=50) break;
            spans.push([at,at+needle.length]);
            from=at+Math.max(1,needle.length);
        }
        if(!spans.length) return {html:src,count:0};
        const open='<span style="background-color:'+color+'">';
        for(let s=spans.length-1;s>=0;s--){
            const a=spans[s][0],b=spans[s][1];
            const hit=[];
            for(let k=a;k<b;k++){
                const p=pos[k];
                if(!p||p.o<0) continue;                 // 줄바꿈은 건너뛴다(줄별로 칠한다)
                if(!hit.length||hit[hit.length-1].i!==p.i) hit.push({i:p.i,from:p.o,to:p.o});
                else hit[hit.length-1].to=p.o;
            }
            for(let k=hit.length-1;k>=0;k--){
                const i=hit[k].i,tk=toks[i];
                if(!tk||tk.t!=='txt') continue;
                const mid=tk.s.slice(hit[k].from,hit[k].to+1);
                if(!mid) continue;
                const before=tk.s.slice(0,hit[k].from),after=tk.s.slice(hit[k].to+1);
                const parts=[];
                if(before) parts.push({t:'txt',s:before});
                parts.push({t:'raw',s:open},{t:'txt',s:mid},{t:'raw',s:'</span>'});
                if(after) parts.push({t:'txt',s:after});
                toks.splice.apply(toks,[i,1].concat(parts));
            }
        }
        let out='';
        toks.forEach(tk=>{
            if(tk.t==='tag'||tk.t==='raw') out+=tk.s;
            else if(tk.t==='br') out+='<br>';
            else if(tk.t==='txt') out+=esc(tk.s).replace(/\n/g,'<br>');
        });
        return {html:out,count:spans.length};
    }
    // 형광펜을 지운 자리에 남는 빈 꾸밈 span은 털어 낸다(문서가 지저분해지지 않게).
    function aiEditDropEmptyTags(html){
        let out=String(html==null?'':html),prev='';
        for(let i=0;i<3&&out!==prev;i++){
            prev=out;
            out=out.replace(/<(span|b|strong|i|em|u|font)\b[^>]*>\s*<\/\1>/gi,'');
            // 배경만 있던 span은 빈 style="" 이 남는다 — 속성을 지우고,
            // 속성 없는 span 은 알맹이만 남긴다(안에 태그가 있으면 건드리지 않는다).
            out=out.replace(/(<[a-zA-Z][a-zA-Z0-9]*)\s+style=""(?=[\s>])/g,'$1');
            out=out.replace(/<span>((?:(?!<)[\s\S])*)<\/span>/gi,'$1');
        }
        return out;
    }
    // 형광펜 지우기 — 찾을 글이 있으면 그 글귀만, 없으면 상자 전체.
    // 글귀 지우기는 그 글귀를 감싸고 있던 span을 경계에서 끊고 다시 이어 붙인다:
    //   <span S>AB CD</span> 에서 AB만 지우면 <span S></span><span S′>AB</span><span S> CD</span>
    //   (S′=S에서 배경색만 뺀 것) → 나머지 글의 형광펜·서식은 그대로 남는다.
    function aiEditUnmarkHtml(html,find){
        const src=String(html==null?'':html);
        const needle=String(find==null?'':find);
        const toks=[];
        src.split(/(<[^>]*>)/g).forEach(part=>{
            if(!part) return;
            if(part.charAt(0)==='<'){
                if(/^<br\s*\/?>$/i.test(part)) toks.push({t:'br'});
                else toks.push({t:'tag',s:part});
            }else toks.push({t:'txt',s:aiEditDecodeEntities(part)});
        });
        let touched=0;
        if(!needle){
            toks.forEach(tk=>{
                if(tk.t!=='tag') return;
                const next=aiEditStripBg(tk.s);
                if(next!==tk.s){ tk.s=next; touched++; }
            });
        }else{
            let joined=''; const pos=[];
            toks.forEach((tk,i)=>{
                if(tk.t==='txt'){ for(let k=0;k<tk.s.length;k++) pos.push({i:i,o:k}); joined+=tk.s; }
                else if(tk.t==='br'){ pos.push({i:i,o:-1}); joined+='\n'; }
            });
            const spans=[]; let from=0;
            for(;;){
                const at=joined.indexOf(needle,from);
                if(at<0||spans.length>=50) break;
                spans.push([at,at+needle.length]);
                from=at+Math.max(1,needle.length);
            }
            if(!spans.length) return {html:src,count:0};
            for(let s=spans.length-1;s>=0;s--){
                const a=spans[s][0],b=spans[s][1];
                const pA=pos[a]; if(!pA) continue;
                const pB=b<pos.length?pos[b]:null;
                const stTok=pA.i, endTok=pB?pB.i:toks.length;
                // ① 이 범위를 감싸고 있는 span(형광펜이 있는 것만)
                const stack=[],wrap=[];
                for(let i=0;i<stTok;i++){
                    const tk=toks[i];
                    if(tk.t!=='tag') continue;
                    const m=/^<\s*(\/?)\s*([a-zA-Z][0-9]*)([^>]*?)(\/?)\s*>$/.exec(tk.s);
                    if(!m) continue;
                    const tag=m[2].toLowerCase();
                    if(m[1]){
                        for(let k=stack.length-1;k>=0;k--){
                            if(stack[k].tag===tag){ stack.length=k; break; }
                        }
                    }else if(!m[4]&&!AI_VOID_TAGS[tag]) stack.push({tag:tag,i:i,s:tk.s});
                }
                stack.forEach(o=>{ if(aiEditTagBg(o.s)) wrap.push(o); });
                // ② 범위 안에 들어 있는 태그의 배경색도 지운다
                let inside=0;
                for(let i=stTok;i<endTok&&i<toks.length;i++){
                    if(toks[i].t!=='tag') continue;
                    const next=aiEditStripBg(toks[i].s);
                    if(next!==toks[i].s){ toks[i].s=next; inside++; }
                }
                if(!wrap.length&&!inside) continue;      // 이 글귀엔 칠해진 곳이 없다
                const closeAll=wrap.map(function(){ return '<'+'/span>'; }).join('');
                const reopen=arr=>arr.map(o=>o.s).join('');
                const plain=wrap.map(o=>({s:aiEditStripBg(o.s)}));
                // 찾은 글귀는 '배경 없는 span'으로, 그 앞뒤는 원래 배경으로 이어 붙인다.
                const head=closeAll+reopen(plain);
                const tail=closeAll+reopen(wrap);
                // ③ 글 토큰을 잘라 경계를 넣는다(뒤에서부터 — 앞쪽 색인은 그대로)
                const hit=[];
                for(let k=a;k<b;k++){
                    const p=pos[k];
                    if(!p||p.o<0) continue;
                    if(!hit.length||hit[hit.length-1].i!==p.i) hit.push({i:p.i,from:p.o,to:p.o});
                    else hit[hit.length-1].to=p.o;
                }
                for(let k=hit.length-1;k>=0;k--){
                    const i=hit[k].i,tk=toks[i];
                    if(!tk||tk.t!=='txt') continue;
                    const mid=tk.s.slice(hit[k].from,hit[k].to+1);
                    if(!mid) continue;
                    const before=tk.s.slice(0,hit[k].from),after=tk.s.slice(hit[k].to+1);
                    const parts=[];
                    if(before) parts.push({t:'txt',s:before});
                    parts.push({t:'raw',s:head},{t:'txt',s:mid},{t:'raw',s:tail});
                    if(after) parts.push({t:'txt',s:after});
                    toks.splice.apply(toks,[i,1].concat(parts));
                }
                touched+=hit.length+inside;
            }
        }
        if(!touched) return {html:src,count:0};
        let out='';
        toks.forEach(tk=>{
            if(tk.t==='tag'||tk.t==='raw') out+=tk.s;
            else if(tk.t==='br') out+='<br>';
            else if(tk.t==='txt') out+=esc(tk.s).replace(/\n/g,'<br>');
        });
        return {html:aiEditDropEmptyTags(out),count:touched};
    }

    // ── 14.27.0 · 사람이 보기 좋은 배치 ────────────────────────────────
    // 모델이 준 좌표를 그대로 쓰면 상자마다 왼쪽 끝이 다르고 서로 겹친다.
    // 그래서 ① 8px 격자에 맞추고 ② 이웃·본문 왼쪽 끝에 붙이고 ③ 새 요소는
    // 겹치지 않는 첫 빈자리로 내린다. 명시 좌표(@mv·@bx)는 ①·②만 적용해
    // '옮겨 달라'는 요청을勝手に 뒤집지 않는다.
    const AI_GRID=8, AI_EDGE=28, AI_GAP=12, AI_MARGIN=40;
    /* 14.31.0 · 펜 그림 기본 크기 — 예전엔 본문 폭의 62%로 그려 "그림이 너무
       크다"는 말이 많았다. 이제 본문 폭의 40% · 최대 320px · 높이 360px 로
       담백하게 잡는다(요청에 크기가 있으면 그 값을 쓴다). */
    const AI_DRAW_W_RATIO=0.40, AI_DRAW_MAX_W=320, AI_DRAW_MIN_W=150, AI_DRAW_MAX_H=360;
    // 쪽에서 자리를 차지하는 상자들(표 테두리 획은 표 상자로 한 번만 센다).
    function aiEditOccupied(pi,skipId){
        const out=[];
        const pg=doc&&doc.pages&&doc.pages[pi];
        if(!pg) return out;
        (pg.els||[]).forEach(el=>{
            if(!el||el.id===skipId) return;
            if(el.type==='stroke'&&el.tbl) return;
            const b=aiEditBox(el);
            if(b.w>0||b.h>0) out.push({x:b.x,y:b.y,w:b.w,h:b.h,id:el.id});
        });
        (pg.tables||[]).forEach(t=>{
            if(!t||t.id===skipId) return;
            const s=tblSize(t);
            out.push({x:+t.x||0,y:+t.y||0,w:s.w,h:s.h,id:t.id});
        });
        return out;
    }
    const aiEditHits=(a,b,pad)=>a.x<b.x+b.w+pad&&b.x<a.x+a.w+pad
        &&a.y<b.y+b.h+pad&&b.y<a.y+a.h+pad;
    // 본문이 쓰는 왼쪽 끝·너비 — 새 상자를 이 값에 맞춘다(문서가 정돈돼 보인다).
    function aiEditMargins(pi){
        const boxes=aiEditOccupied(pi).filter(b=>b.w>10&&b.h>6);
        const count=(list,key)=>{
            const map={};
            list.forEach(b=>{ const k=Math.round(b[key]/AI_GRID)*AI_GRID; map[k]=(map[k]||0)+1; });
            let best=null,n=0;
            for(const k in map){ if(map[k]>n){ n=map[k]; best=+k; } }
            return best;
        };
        const texts=boxes.filter(b=>b.w<aiEditPageSize().w-8);
        return {
            left:count(texts.length?texts:boxes,'x'),
            width:count(texts,'w'),
            top:boxes.length?Math.min.apply(null,boxes.map(b=>b.y)):AI_MARGIN,
        };
    }
    const aiEditPageSize=()=>paperSize();
    // 겹치지 않는 첫 빈자리 — 위부터 훑고, 왼쪽 끝 → 가운데 → 오른쪽 순으로 본다.
    function aiEditFreeSpot(pi,w,h,startY){
        const size=aiEditPageSize();
        const m=aiEditMargins(pi);
        const list=aiEditOccupied(pi);
        const left=m.left==null?AI_MARGIN:Math.min(m.left,Math.max(0,size.w-w));
        // 후보 자리도 격자에 맞춘다 — 본문 왼쪽 끝 → 가운데 → 오른쪽 순.
        // 왼쪽 줄을 먼저 훑어야 새 상자가 본문과 왼쪽이 맞아 정돈돼 보인다.
        const xs=[left,Math.round(Math.max(0,size.w-w)/2),Math.max(0,size.w-w-left)]
            .map(v=>Math.max(0,Math.min(Math.round(v/AI_GRID)*AI_GRID,Math.max(0,size.w-w))));
        const yEnd=Math.max(AI_MARGIN,Math.round(size.h-h));
        const y0=Math.max(AI_MARGIN,Math.min(Math.round(+startY)||AI_MARGIN,yEnd));
        const scan=(from,to)=>{
            for(let i=0;i<xs.length;i++){
                for(let y=from;y<=to;y+=AI_GRID){
                    const box={x:xs[i],y:y,w:w,h:h};
                    if(!list.some(o=>aiEditHits(box,o,AI_GAP))) return box;
                }
            }
            return null;
        };
        // 요청한 높이부터 아래로 훑고, 없으면 페이지 맨 위부터 다시 본다.
        const hit=scan(y0,yEnd)||scan(AI_MARGIN,yEnd);
        if(hit) return hit;
        // 빈자리가 없으면 맨 아래 내용 밑에 둔다(그래도 페이지 안).
        let bottom=AI_MARGIN;
        list.forEach(o=>{ bottom=Math.max(bottom,o.y+o.h+AI_GAP); });
        return {x:left,y:Math.max(AI_MARGIN,Math.min(bottom,yEnd)),w:w,h:h};
    }
    // 격자·왼쪽 끝 맞추기(+ 필요하면 겹침 피하기). 페이지 밖으로 나가지 않는다.
    function aiEditNeat(pi,x,y,w,h,opt){
        const size=aiEditPageSize();
        const o=opt||{};
        const d={w:Math.max(20,Math.min(Math.round(w),size.w)),
                 h:Math.max(20,Math.min(Math.round(h),size.h))};
        const m=aiEditMargins(pi);
        let nx=Math.round(+x||0),ny=Math.round(+y||0);
        // 격자는 새 요소에만 — '그 좌표로 옮겨 달라'는 요청은 좌표를 존중한다.
        if(o.snap){
            nx=Math.round(nx/AI_GRID)*AI_GRID;
            ny=Math.round(ny/AI_GRID)*AI_GRID;
        }
        if(o.align!==false&&m.left!=null&&Math.abs(nx-m.left)<=AI_EDGE) nx=m.left;
        let box={x:nx,y:ny,w:d.w,h:d.h};
        if(o.avoid){
            const list=aiEditOccupied(pi,o.skipId);
            let guard=0;
            while(list.some(ob=>aiEditHits(box,ob,AI_GAP))&&guard++<400){
                const clash=list.filter(ob=>aiEditHits(box,ob,AI_GAP));
                const below=Math.min.apply(null,clash.map(ob=>ob.y+ob.h+AI_GAP));
                const ny2=Math.round(below/AI_GRID)*AI_GRID;
                if(ny2<=box.y||ny2+d.h>size.h) break;
                box={x:box.x,y:ny2,w:d.w,h:d.h};
            }
        }
        box.x=Math.max(0,Math.min(box.x,Math.max(0,size.w-box.w)));
        box.y=Math.max(0,Math.min(box.y,Math.max(0,size.h-box.h)));
        return box;
    }
    // 새 상자의 높이 어림 — 글이 상자 밖으로 새는 게 제일 보기 나쁘다.
    // 한글은 1자, 영숫자는 0.55자 폭으로 세고 줄 간격 1.5 + 위아래 여백을 더한다.
    function aiEditGuessH(text,w,fontSize){
        const size=aiEditPageSize();
        const fs=Math.max(8,Math.min(200,+fontSize||16));
        const bw=Math.max(40,Math.min(+w||size.w-2*AI_MARGIN,size.w-8))-16;
        const perLine=Math.max(4,Math.floor(bw/fs));
        let lines=0;
        String(text==null?'':text).split('\n').forEach(line=>{
            let units=0;
            for(const ch of line){
                units+=/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch)?1:0.55;
            }
            lines+=Math.max(1,Math.ceil(units/perLine));
        });
        return Math.max(28,Math.min(size.h-8,Math.round(lines*fs*1.5+18)));
    }
    const aiEditIsAuto=v=>{
        const s=String(v==null?'':v).trim().toLowerCase();
        return s==='auto'||s==='자동'||s==='알아서'||s==='-'||s==='*'||s==='?';
    };
    // @goto·@newpage 뒤 화면 이동 — addPage와 같은 규칙(교체된 노트면 무시).
    function aiEditScrollToPage(pi){
        try{
            const d=doc,_pi=pi;
            setTimeout(()=>{
                if(doc!==d||!curNB) return;
                // AI가 먼 쪽으로 이동해도 중간 페이지를 연쇄 로드하지 않는다(즉시 이동).
                try{ maintainPageWindow(_pi,true); }catch(e){}
                try{ scrollPageIntoView(_pi,'auto'); }catch(e){}
            },60);
        }catch(e){}
    }
    function aiEditApply(ops,expectedRevision){
        const res={applied:0,failed:0,notes:[],stale:false};
        const note=msg=>{ if(msg&&res.notes.length<4&&res.notes.indexOf(msg)<0) res.notes.push(msg); };
        const bad=msg=>{ res.failed++; note(msg); };
        if(!doc||!curNB){ bad('열린 노트가 없어요'); return res; }
        if(!Array.isArray(ops)||!ops.length) return res;
        // 모델을 기다리는 동안 사용자가 타이핑한 글도 먼저 doc에 반영한 뒤 비교한다.
        try{ commitEditingText(); }catch(e){}
        if(expectedRevision&&expectedRevision!==aiEditRevision()){
            res.stale=true;
            note('기다리는 동안 문서가 바뀌어서 오래된 편집 계획은 적용하지 않았어요 · 다시 요청해 주세요');
            return res;
        }
        const size=paperSize();
        const finite=v=>v!==''&&v!=null&&Number.isFinite(Number(v));
        const round=v=>Math.round(Number(v));
        const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
        const text=v=>String(v==null?'':v).slice(0,AI_EDIT_MAX_TEXT);
        const html=v=>esc(text(v)).replace(/\n/g,'<br>');
        const findAny=id=>{
            id=String(id||'').trim();
            if(!id) return null;
            for(let pi=0;pi<doc.pages.length;pi++){
                const pg=doc.pages[pi]; if(!pg||pg.__lazy!=null) continue;
                const el=(pg.els||[]).find(item=>item&&item.id===id);
                if(el) return {el,pi};
            }
            return null;
        };
        const findTblAny=tid=>{
            tid=String(tid||'').trim();
            if(!tid) return null;
            for(let pi=0;pi<doc.pages.length;pi++){
                const pg=doc.pages[pi]; if(!pg||pg.__lazy!=null) continue;
                const t=(pg.tables||[]).find(item=>item&&item.id===tid);
                if(t) return {t,pi};
            }
            return null;
        };
        const touched=new Set(); let historyStarted=false;
        const beforeChange=()=>{
            if(historyStarted) return;
            // 첫 유효 명령이 확인된 뒤에만 선택을 접고 undo 지점을 만든다.
            // 전부 잘못된 계획은 사용자의 편집 상태조차 건드리지 않는다.
            try{ deselectAll(true); clearMulti(); selected=null; }catch(e){}
            pushHistory(true); historyStarted=true;
        };
        const boxSize=(w,h)=>({
            w:clamp(round(w),20,Math.max(20,size.w)),
            h:clamp(round(h),20,Math.max(20,size.h)),
        });
        // 좌표 다듬기. 새 요소(opt.snap·opt.avoid)는 격자에 맞추고 겹치지 않는
        // 자리로 내린다. 옮기기(@mv·@bx)는 '그 자리로 옮겨 달라'는 요청이라
        // 격자까지는 씌우지 않고 본문 왼쪽 끝과 가까울 때만 붙인다.
        const place=(x,y,w,h,opt)=>{
            const d=boxSize(w,h);
            const o=opt||{};
            const pi=(o.pi==null)?(curPageIdx|0):o.pi;
            if(o.neat===false)
                return {x:clamp(round(x),0,Math.max(0,size.w-d.w)),
                    y:clamp(round(y),0,Math.max(0,size.h-d.h)),w:d.w,h:d.h};
            return aiEditNeat(pi,x,y,d.w,d.h,{snap:!!o.snap,avoid:!!o.avoid,
                align:o.align!==false,skipId:o.skipId});
        };
        // 표 전체 삭제 — 칸·테두리 획까지 함께 지운다(@del·@tdel 모두).
        const dropTable=tf=>{
            beforeChange();
            doc.pages[tf.pi].tables=(doc.pages[tf.pi].tables||[]).filter(x=>x!==tf.t);
            doc.pages[tf.pi].els=(doc.pages[tf.pi].els||[])
                .filter(e=>!(e&&e.tbl&&e.tbl.tid===tf.t.id));
            try{ clearActiveTbl(); }catch(e){}
            touched.add(tf.pi);
            try{ if(renderedPages.has(tf.pi)) renderTblDivs(tf.pi); }catch(e){}
        };
        const limited=ops.slice(0,AI_EDIT_MAX_OPS);
        if(ops.length>AI_EDIT_MAX_OPS){
            res.failed+=ops.length-AI_EDIT_MAX_OPS;
            note('명령이 많아 앞의 '+AI_EDIT_MAX_OPS+'개만 확인했어요');
        }
        limited.forEach(op=>{
            const cmd=String(op&&op.cmd||'').toLowerCase();
            // ── 쪽·제목·표 — 요소 id 없이 쪽 단위로 돈다 ──
            if(cmd==='goto'){
                if(!finite(op.page)||!Number.isInteger(Number(op.page))){
                    bad('이동할 쪽 번호가 올바르지 않아요'); return;
                }
                const page=round(op.page);
                if(page<1||page>doc.pages.length){
                    bad('그런 쪽은 없어요 · 총 '+doc.pages.length+'쪽이에요'); return;
                }
                // 화면만 옮긴다 — 문서·undo에 손대지 않는다.
                curPageIdx=page-1;
                try{ updatePageInfo(); }catch(e){}
                aiEditScrollToPage(page-1);
                res.applied++; return;
            }
            if(cmd==='newpage'){
                if(doc.pages.length>=200){ bad('쪽이 너무 많아 더 만들지 않았어요'); return; }
                beforeChange();
                doc.pages.push(blankPage());
                curPageIdx=doc.pages.length-1;
                try{ updatePageInfo(); }catch(e){}
                try{ renderPages(); }catch(e){}
                aiEditScrollToPage(curPageIdx);
                touched.add(curPageIdx); res.applied++; return;
            }
            // 14.27.0 · @tidy — 쪽을 보기 좋게 정돈한다. ① 8px 격자에 맞추고
            //   ② 본문 왼쪽 끝에 가까운 상자는 그 끝에 붙이고 ③ 절반 넘게
            //   겹친 상자만 아래로 내린다(나란히 세운 두 칸은 건드리지 않는다).
            if(cmd==='tidy'){
                let tpi=curPageIdx|0;
                if(finite(op.page)){
                    if(!Number.isInteger(Number(op.page))){
                        bad('정돈할 쪽 번호가 올바르지 않아요'); return;
                    }
                    tpi=round(op.page)-1;
                }
                const tpg=doc.pages[tpi];
                if(tpi<0||tpi>=doc.pages.length||!tpg||tpg.__lazy!=null){
                    bad('그 쪽을 찾거나 불러오지 못했어요'); return;
                }
                const tleft=(aiEditMargins(tpi).left);
                const margin=tleft==null?AI_MARGIN:tleft;
                const items=[];
                (tpg.els||[]).forEach(el=>{
                    if(!el||el.locked||el.tbl) return;
                    if(!['text','image','latex','stroke'].includes(el.type)) return;
                    const b=aiEditBox(el);
                    if(b.w<=0&&b.h<=0) return;
                    let nx=Math.round(b.x/AI_GRID)*AI_GRID,ny=Math.round(b.y/AI_GRID)*AI_GRID;
                    if(Math.abs(nx-margin)<=Math.round(AI_EDGE*1.5)) nx=margin;
                    nx=clamp(nx,0,Math.max(0,size.w-Math.round(b.w)));
                    ny=clamp(ny,0,Math.max(0,size.h-Math.round(b.h)));
                    items.push({el:el,base:b,box:{x:nx,y:ny,w:b.w,h:b.h}});
                });
                items.sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
                const placed=[];
                items.forEach(item=>{
                    let guard=0;
                    for(;;){
                        const clash=placed.find(o=>{
                            if(!aiEditHits(item.box,o.box,AI_GAP/2)) return false;
                            const ow=Math.min(item.box.x+item.box.w,o.box.x+o.box.w)
                                -Math.max(item.box.x,o.box.x);
                            const oh=Math.min(item.box.y+item.box.h,o.box.y+o.box.h)
                                -Math.max(item.box.y,o.box.y);
                            return ow*oh>0.5*Math.min(item.box.w*item.box.h,o.box.w*o.box.h);
                        });
                        if(!clash||guard++>60) break;
                        const below=Math.round((clash.box.y+clash.box.h+AI_GAP)/AI_GRID)*AI_GRID;
                        if(below<=item.box.y) break;
                        item.box.y=Math.min(below,Math.max(0,size.h-Math.round(item.box.h)));
                    }
                    placed.push(item);
                });
                const moves=items.filter(item=>Math.round(item.base.x)!==item.box.x
                    ||Math.round(item.base.y)!==item.box.y);
                // 표도 같은 규칙으로(칸은 rebuildTable이 따라온다).
                const tbls=[];
                (tpg.tables||[]).forEach(t=>{
                    if(!t||!Array.isArray(t.cw)||!Array.isArray(t.ch)) return;
                    const ts=tblSize(t);
                    let nx=Math.round((+t.x||0)/AI_GRID)*AI_GRID;
                    if(Math.abs(nx-margin)<=Math.round(AI_EDGE*1.5)) nx=margin;
                    nx=clamp(nx,0,Math.max(0,size.w-ts.w));
                    const ny=clamp(Math.round((+t.y||0)/AI_GRID)*AI_GRID,
                        0,Math.max(0,size.h-ts.h));
                    if(Math.round(+t.x||0)!==nx||Math.round(+t.y||0)!==ny)
                        tbls.push({t:t,x:nx,y:ny});
                });
                if(!moves.length&&!tbls.length){ bad('이미 정돈돼 있어요'); return; }
                beforeChange();
                moves.forEach(item=>{
                    if(item.el.type==='stroke'){
                        item.el.dx=item.box.x-item.base.baseX;
                        item.el.dy=item.box.y-item.base.baseY;
                    }else{ item.el.x=item.box.x; item.el.y=item.box.y; }
                });
                tbls.forEach(item=>{
                    item.t.x=item.x; item.t.y=item.y;
                    try{ rebuildTable(tpi,item.t.id,{quiet:true}); }catch(e){}
                });
                if(tbls.length){ try{ if(renderedPages.has(tpi)) renderTblDivs(tpi); }catch(e){} }
                touched.add(tpi); res.applied++; return;
            }
            if(cmd==='title'){
                const t=text(op.text).replace(/\s+/g,' ').trim().slice(0,100);
                if(!t){ bad('노트 제목이 비어 있어요'); return; }
                const input=document.getElementById('edTitle');
                if(!input){ bad('제목 입력칸을 찾지 못했어요'); return; }
                // 기존 change 리스너가 노트 이름 저장·동기화를 맡는다.
                input.value=t;
                try{ input.dispatchEvent(new Event('change',{bubbles:true})); }
                catch(e){ try{ if(curNB){ curNB.title=t; queueSync(curNB.id); } }catch(e2){} }
                res.applied++; return;
            }
            if(cmd==='tbl'){
                const posOk=v=>finite(v)||aiEditIsAuto(v);
                if(!finite(op.page)||!Number.isInteger(Number(op.page))
                   ||!posOk(op.x)||!posOk(op.y)||!finite(op.rows)||!finite(op.cols)){
                    bad('표를 만들 위치나 크기가 올바르지 않아요'); return;
                }
                const page=round(op.page),pi=page-1,pg=doc.pages[pi];
                if(page<1||page>doc.pages.length||!pg||pg.__lazy!=null){
                    bad('해당 페이지를 찾거나 불러오지 못했어요'); return;
                }
                const body=String(op.text==null?'':op.text).slice(0,8000);
                const grid=body.split('\n').map(line=>line.split('|').map(c=>c.trim()));
                // 내용이 선언보다 많으면 행·열을 자동으로 늘린다.
                let rows=Math.max(clamp(Math.round(Number(op.rows)),1,20),
                    Math.min(20,grid.filter(r=>r.some(c=>c)).length||0));
                let cols=clamp(Math.round(Number(op.cols)),1,12);
                grid.forEach(r=>{ cols=Math.max(cols,Math.min(12,r.length)); });
                rows=Math.max(1,rows); cols=Math.max(1,cols);
                // 칸 글 길이에 맞춰 너비·높이를 어림잡는다.
                const cw=[],ch=[];
                for(let c=0;c<cols;c++){
                    let mx=0;
                    for(let r=0;r<rows;r++) mx=Math.max(mx,(((grid[r]||[])[c])||'').length);
                    cw.push(clamp(60+mx*9,60,260));
                }
                for(let r=0;r<rows;r++){
                    let mx=0;
                    for(let c=0;c<cols;c++) mx=Math.max(mx,(((grid[r]||[])[c])||'').length);
                    ch.push(mx>28?60:40);
                }
                let tw=cw.reduce((a,b)=>a+b,0),th=ch.reduce((a,b)=>a+b,0);
                const maxW=Math.max(120,size.w-16),maxH=Math.max(80,size.h-16);
                if(tw>maxW){ const k=maxW/tw; for(let i=0;i<cw.length;i++) cw[i]=Math.max(TBL_MINW,Math.round(cw[i]*k)); tw=cw.reduce((a,b)=>a+b,0); }
                if(th>maxH){ const k=maxH/th; for(let i=0;i<ch.length;i++) ch[i]=Math.max(TBL_MINH,Math.round(ch[i]*k)); th=ch.reduce((a,b)=>a+b,0); }
                // 14.27.0 · auto면 겹치지 않는 빈자리를 고르고, 좌표를 주면
                // 격자·본문 왼쪽 끝에 맞춰 정돈된 자리에 둔다.
                let ox,oy;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)){
                    const spot=aiEditFreeSpot(pi,tw,th,aiEditIsAuto(op.y)?0:round(op.y));
                    ox=spot.x; oy=spot.y;
                }else{
                    const neat=aiEditNeat(pi,clamp(round(op.x),8,Math.max(8,size.w-tw-8)),
                        clamp(round(op.y),8,Math.max(8,size.h-th-8)),tw,th,{snap:true,avoid:false});
                    ox=neat.x; oy=neat.y;
                }
                beforeChange();
                if(!Array.isArray(pg.tables)) pg.tables=[];
                const tid='tb_'+Math.random().toString(36).slice(2,9);
                pg.tables.push({id:tid,x:ox,y:oy,cw:cw.slice(),ch:ch.slice(),
                    color:'#9aa1ab',lw:1.2,group:'g_'+tid});
                try{ rebuildTable(pi,tid,{quiet:true}); }
                catch(e){
                    pg.tables=pg.tables.filter(t=>t.id!==tid);
                    bad('표를 만들지 못했어요'); return;
                }
                const list=doc.pages[pi].els||[];
                for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
                    const v=(((grid[r]||[])[c])||'').slice(0,500);
                    if(!v) continue;
                    const cell=list.find(e=>e&&e.type==='text'&&e.tbl
                        &&e.tbl.tid===tid&&e.tbl.r===r&&e.tbl.c===c);
                    if(cell) cell.html=aiMdToHtml(v,cell.fontSize||16);   // 14.29.2 · 칸 안의 **굵게**·$수식$
                }
                touched.add(pi);
                try{ if(renderedPages.has(pi)) renderTblDivs(pi); }catch(e){}
                res.applied++; return;
            }
            if(cmd==='tsz'||cmd==='tmv'){
                const tf=findTblAny(op&&op.id);
                if(!tf){ bad('그런 표를 찾지 못했어요'); return; }
                if(cmd==='tsz'&&(!finite(op.w)||!finite(op.h))){
                    bad('표 크기가 올바르지 않아요'); return;
                }
                if(cmd==='tmv'&&(!finite(op.x)||!finite(op.y))){
                    bad('표 위치가 올바르지 않아요'); return;
                }
                beforeChange();
                if(cmd==='tsz'){
                    const old=tblSize(tf.t);
                    if(old.w<1||old.h<1){ bad('표 크기를 읽지 못했어요'); return; }
                    const kw=clamp(round(op.w),40,size.w)/old.w;
                    const kh=clamp(round(op.h),20,size.h)/old.h;
                    tf.t.cw=tf.t.cw.map(v=>Math.max(TBL_MINW,Math.round(v*kw)));
                    tf.t.ch=tf.t.ch.map(v=>Math.max(TBL_MINH,Math.round(v*kh)));
                }else{
                    const s=tblSize(tf.t);
                    tf.t.x=clamp(round(op.x),0,Math.max(0,size.w-s.w));
                    tf.t.y=clamp(round(op.y),0,Math.max(0,size.h-s.h));
                }
                const now=tblSize(tf.t);
                tf.t.x=clamp(Math.round(tf.t.x),0,Math.max(0,size.w-now.w));
                tf.t.y=clamp(Math.round(tf.t.y),0,Math.max(0,size.h-now.h));
                try{ rebuildTable(tf.pi,tf.t.id,{quiet:true}); }catch(e){}
                touched.add(tf.pi);
                try{ if(renderedPages.has(tf.pi)) renderTblDivs(tf.pi); }catch(e){}
                res.applied++; return;
            }
            if(cmd==='tcell'){
                const tf=findTblAny(op&&op.id);
                if(!tf){ bad('그런 표를 찾지 못했어요'); return; }
                if(!finite(op.r)||!finite(op.c)
                   ||!Number.isInteger(Number(op.r))||!Number.isInteger(Number(op.c))){
                    bad('표 칸 위치가 올바르지 않아요'); return;
                }
                const r=round(op.r)-1,c=round(op.c)-1;
                if(r<0||c<0||r>=tf.t.ch.length||c>=tf.t.cw.length){
                    bad('표에 그런 칸은 없어요'); return;
                }
                const cell=(doc.pages[tf.pi].els||[]).find(e=>e&&e.type==='text'
                    &&e.tbl&&e.tbl.tid===tf.t.id&&e.tbl.r===r&&e.tbl.c===c);
                if(!cell){ bad('표 칸을 찾지 못했어요'); return; }
                if(cell.locked){ bad('잠긴 요소는 고칠 수 없어요'); return; }
                beforeChange();
                cell.html=aiMdToHtml(text(op.text),cell.fontSize||16);   // 14.29.2
                delete cell.fit; delete cell.fitDown; delete cell.trFS; delete cell.trLS; delete cell.trFW;
                touched.add(tf.pi); res.applied++; return;
            }
            if(cmd==='add'){
                const numOk=v=>finite(v)||aiEditIsAuto(v);
                if(!finite(op.page)||!Number.isInteger(Number(op.page))
                   ||!numOk(op.x)||!numOk(op.y)||!numOk(op.w)||!numOk(op.h)){
                    bad('새 글상자의 페이지나 위치가 올바르지 않아요'); return;
                }
                const page=round(op.page),pi=page-1,pg=doc.pages[pi];
                if(page<1||page>doc.pages.length||!pg||pg.__lazy!=null){
                    bad('해당 페이지를 찾거나 불러오지 못했어요'); return;
                }
                if(!text(op.text).trim()){ bad('내용이 없는 새 글상자는 만들지 않았어요'); return; }
                // ~id 가 있으면 그 상자의 글꼴·서식을 물려받아 이웃과 어울리게 한다.
                let font=curFont||'pretendard',fontSize=curFontSize||16,styleSrc=null;
                if(op.inherit){
                    const src=findAny(op.inherit);
                    if(src&&src.el&&src.el.type==='text'){
                        font=src.el.font||font; fontSize=src.el.fontSize||fontSize;
                        styleSrc=src.el;
                    }
                }
                // 14.27.0 · auto 크기·자리 — 본문 너비를 따르고, 글이 넘치지
                // 않을 만큼 높이를 잡은 뒤 겹치지 않는 첫 빈자리에 둔다.
                const body=aiMdPlain(text(op.text));
                const mg=aiEditMargins(pi);
                const wide=Math.max(120,Math.min(size.w-2*AI_MARGIN,
                    (mg.width&&mg.width>=120)?mg.width:(size.w-2*AI_MARGIN)));
                const bw=aiEditIsAuto(op.w)?wide:clamp(round(op.w),20,size.w);
                const guess=aiEditGuessH(body,bw,fontSize)+aiMdTitleExtra(text(op.text),fontSize);
                const bh=clamp(aiEditIsAuto(op.h)?guess
                    :Math.max(round(op.h),guess),20,size.h);
                let p;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)){
                    p=aiEditFreeSpot(pi,bw,bh,aiEditIsAuto(op.y)?0:round(op.y));
                    p.w=bw; p.h=bh;
                }else p=place(op.x,op.y,bw,bh,{pi:pi,snap:true,avoid:true});
                beforeChange(); pg.els=pg.els||[];
                const body0=text(op.text);
                // 14.29.2 · 제목과 본문을 상자 안에서 갈라 쓴다.
                //   · 글 전체가 제목 한 줄이면 → 상자째 크게·굵게(가운데)
                //   · 제목+본문이 섞여 오면 → 제목 줄만 크게·굵게, 본문은 보통 굵기
                //   · **중요어** 는 그 낱말만 굵게, 문장 안 $수식$ 은 인라인 수식으로
                const rich=aiMdBox(body0,fontSize);
                let useHtml=rich.html, useFs=fontSize, useFont=font,
                    useAlign=rich.align||null, useBold=!!rich.bold;
                if(rich.level) useFs=rich.fs;
                else if(pg.els.length===0&&pi===0&&body0.length<=60&&body0.indexOf('\n')<0
                        &&p.y<=AI_MARGIN+AI_GRID+1){
                    // 첫 쪽 맨 위 짧은 한 줄 = 노트 제목으로 본다(예전 규칙 유지)
                    useHtml='<b>'+aiMdInline(body0)+'</b>';
                    useFs=28; useBold=true; useAlign='center';
                }
                const nel={type:'text',id:uid('t'),x:p.x,y:p.y,w:p.w,h:p.h,
                    html:useHtml,fontSize:useFs,font:useFont};
                if(useAlign) nel.align=useAlign;
                if(useBold) nel.fontWeight='700';

                if(styleSrc){
                    if(styleSrc.align) nel.align=styleSrc.align;
                    if(styleSrc.textColor) nel.textColor=styleSrc.textColor;
                    if(styleSrc.cellBg) nel.cellBg=styleSrc.cellBg;
                    // 14.29.2 · 본문 상자는 이웃의 '굵게'까지 물려받지 않는다 —
                    //   제목 옆에 쓴 본문이 통째로 굵어져 제목과 안 구분되던 문제.
                    if(styleSrc.fontWeight&&(rich.level||useBold)) nel.fontWeight=styleSrc.fontWeight;
                    if(styleSrc.fontStyle) nel.fontStyle=styleSrc.fontStyle;
                    if(styleSrc.textDecoration) nel.textDecoration=styleSrc.textDecoration;
                }
                pg.els.push(nel);
                touched.add(pi); res.applied++; return;
            }
            // @math — 새 수식(LaTeX) 상자
            if(cmd==='math'||cmd==='ltx'||cmd==='formula'){
                const numOkM=v=>finite(v)||aiEditIsAuto(v);
                if(!finite(op.page)||!Number.isInteger(Number(op.page))
                   ||!numOkM(op.x)||!numOkM(op.y)||!numOkM(op.w)||!numOkM(op.h)){
                    bad('새 수식의 페이지나 위치가 올바르지 않아요'); return;
                }
                const page=round(op.page),pi=page-1,pg=doc.pages[pi];
                if(page<1||page>doc.pages.length||!pg||pg.__lazy!=null){
                    bad('해당 페이지를 찾거나 불러오지 못했어요'); return;
                }
                const latex=String(op.latex==null?'':op.latex).trim().slice(0,2000);
                if(!latex){ bad('LaTeX 수식이 비어 있어요'); return; }
                const isDisplay=!!op.display||latex.length>40||/\\(int|sum|prod|lim|frac|sqrt|begin|matrix)/.test(latex);
                const estW=()=>{
                    const approx=Math.max(60,Math.min(size.w-2*AI_MARGIN,Math.round(10+latex.length*(isDisplay?9:7))));
                    return isDisplay?Math.min(size.w-2*AI_MARGIN,Math.max(200,approx)):Math.min(size.w/2,approx);
                };
                const estH=()=>isDisplay?Math.max(48,Math.min(140,Math.round(40+(latex.match(/\\(frac|sqrt)|\^|_/g)||[]).length*6))):44;
                const mg=aiEditMargins(pi);
                const wideM=Math.max(200,Math.min(size.w-2*AI_MARGIN,(mg.width&&mg.width>=200)?mg.width:(size.w-2*AI_MARGIN)));
                const bw=aiEditIsAuto(op.w)?(isDisplay?wideM:estW()):clamp(round(op.w),40,size.w);
                const bh=aiEditIsAuto(op.h)?estH():clamp(round(op.h),28,size.h);
                let p;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)){
                    p=aiEditFreeSpot(pi,bw,bh,aiEditIsAuto(op.y)?0:round(op.y));
                    p.w=bw; p.h=bh;
                }else p=place(op.x,op.y,bw,bh,{pi:pi,snap:true,avoid:true});
                beforeChange(); pg.els=pg.els||[];
                const nm={type:'latex',id:uid('m'),x:p.x,y:p.y,w:p.w,h:p.h,
                    latex:latex,fontSize:isDisplay?22:18,displayMath:isDisplay?1:0};
                pg.els.push(nm);
                touched.add(pi); res.applied++; return;
            }
            // 14.30.0 · @img(→addimg) — 서버가 찾아 저장한 사진(/api/img/…)을 넣는다.
            //   모델은 검색어만 주고(파서가 cmd:'img'로 바꿈), bridge.apply 가
            //   /api/ai/imgadd 로 사진을 받아온 뒤 이 addimg 명령으로 바꿔 부른다.
            if(cmd==='addimg'){
                if(!finite(op.page)||!Number.isInteger(Number(op.page))){
                    bad('사진을 넣을 쪽 번호가 올바르지 않아요'); return;
                }
                const page=round(op.page),pi=page-1,pg=doc.pages[pi];
                if(page<1||page>doc.pages.length||!pg||pg.__lazy!=null){
                    bad('해당 페이지를 찾거나 불러오지 못했어요'); return;
                }
                const url=String(op.url||'').trim();
                if(!url||!/^(?:\/api\/img\/|https?:\/\/)/i.test(url)){
                    bad('사진 주소가 올바르지 않아요'); return;
                }
                const natW=Math.max(1,Number(op.natW)||4), natH=Math.max(1,Number(op.natH)||3);
                const mg=aiEditMargins(pi);
                const wide=Math.max(140,Math.min(size.w-2*AI_MARGIN,
                    (mg.width&&mg.width>=140)?mg.width:(size.w-2*AI_MARGIN)));
                let bw,bh;
                if(aiEditIsAuto(op.w)||aiEditIsAuto(op.h)){
                    bw=Math.max(120,Math.min(Math.round(size.w*0.52),Math.round(wide*0.94)));
                    bh=Math.round(bw*natH/natW);
                    if(bh>size.h*0.55){ bh=Math.round(size.h*0.55); bw=Math.max(80,Math.round(bh*natW/natH)); }
                    bw=clamp(bw,60,Math.max(60,size.w-8));
                    bh=clamp(bh,40,Math.max(40,size.h-8));
                }else{
                    bw=clamp(round(op.w),40,size.w);
                    bh=clamp(round(op.h),30,size.h);
                }
                let p;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)){
                    p=aiEditFreeSpot(pi,bw,bh,aiEditIsAuto(op.y)?0:round(op.y));
                }else p=place(op.x,op.y,bw,bh,{pi:pi,snap:true,avoid:true});
                beforeChange(); pg.els=pg.els||[];
                const nel={type:'image',id:uid('i'),url:url,
                    x:Math.round(p.x),y:Math.round(p.y),w:Math.round(p.w),h:Math.round(p.h)};
                if(op.public_id) nel.public_id=String(op.public_id);
                pg.els.push(nel);
                touched.add(pi); res.applied++; return;
            }
            // 14.30.0 · @draw op — SVG에서 만든 펜 획 묶음을 종이에 그린다.
            //   좌표는 svg 좌표계라서 요청 크기(또는 기본 폭)로 스케일한 뒤
            //   auto/지정 자리에 옮긴다. 획마다 별도 요소(실제 펜과 동일 모델).
            if(cmd==='draw'){
                const sts=Array.isArray(op&&op.strokes)
                    ?op.strokes.filter(s=>s&&Array.isArray(s.pts)&&s.pts.length>=2):[];
                if(!sts.length){ bad('그릴 그림 획을 만들지 못했어요'); return; }
                let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
                sts.forEach(s=>s.pts.forEach(pt=>{
                    const px=Number(pt&&pt[0]),py=Number(pt&&pt[1]);
                    if(!Number.isFinite(px)||!Number.isFinite(py)) return;
                    if(px<x1)x1=px; if(py<y1)y1=py; if(px>x2)x2=px; if(py>y2)y2=py;
                }));
                if(!Number.isFinite(x1)||x2<=x1||y2<=y1){ bad('그릴 그림 좌표가 이상해요'); return; }
                const rawW=x2-x1,rawH=y2-y1;
                const aW=Math.max(80,size.w-2*AI_MARGIN), aH=Math.max(60,size.h-2*AI_MARGIN);
                // 14.31.0 · 쪽을 반이나 차지하지 않게 — 본문 폭의 40% · 최대
                //   320px · 높이 360px. 요청에 폭이 있으면 그 값을 존중한다.
                const capW=Math.min(aW,AI_DRAW_MAX_W), capH=Math.min(aH,AI_DRAW_MAX_H);
                let tw;
                if(finite(op.w)&&Number(op.w)>0) tw=clamp(round(op.w),60,aW);
                else tw=Math.max(AI_DRAW_MIN_W,Math.min(capW,Math.round(aW*AI_DRAW_W_RATIO)));
                let th=tw*rawH/rawW;
                if(th>capH){ th=capH; tw=Math.max(AI_DRAW_MIN_W,Math.round(th*rawW/rawH)); }
                if(tw>capW){ tw=capW; th=Math.round(tw*rawH/rawW); }
                const tpi=(op.page!=null&&Number.isInteger(Number(op.page)))
                    ?clamp(round(op.page)-1,0,doc.pages.length-1):(curPageIdx|0);
                const tpg=doc.pages[tpi];
                if(!tpg||tpg.__lazy!=null){ bad('그 페이지를 찾거나 불러오지 못했어요'); return; }
                let p;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)||op.x==null||op.y==null){
                    p=aiEditFreeSpot(tpi,Math.round(tw),Math.round(th),0);
                }else p=place(op.x,op.y,tw,th,{pi:tpi,snap:true,avoid:true});
                const k=tw/rawW;
                const ox=(p.x||0)-x1*k, oy=(p.y||0)-y1*k;
                const r1=v=>Math.round(v*10)/10;
                beforeChange(); tpg.els=tpg.els||[];
                let added=0;
                sts.forEach(s=>{
                    const sz=Math.max(0.7,Math.min(22,(Number(s.size)||3)*k));
                    const pts=s.pts.map(pt=>[r1(Number(pt[0])*k+ox),r1(Number(pt[1])*k+oy)])
                        .filter((pt,i,arr)=>i===0||pt[0]!==arr[i-1][0]||pt[1]!==arr[i-1][1]);
                    if(pts.length<2) return;
                    const col=String(s.color||'#1a1a1a').trim();
                    tpg.els.push({type:'stroke',id:uid('s'),pts:pts,
                        color:/^#[0-9a-fA-F]{3,8}$/.test(col)?col:'#1a1a1a',
                        size:r1(sz),dx:0,dy:0,closed:s.closed?1:0});
                    added++;
                });
                if(!added){ bad('그릴 획을 만들지 못했어요'); return; }
                touched.add(tpi); res.applied++; return;
            }
            const found=findAny(op&&op.id);

            if(!found){
                // 표 id로 지우면 표 전체(칸·테두리)를 함께 지운다.
                if(cmd==='del'){
                    const tf=findTblAny(op&&op.id);
                    if(tf){ dropTable(tf); res.applied++; return; }
                }
                bad('문서 상태에 없는 요소라 건너뛰었어요'); return;
            }
            const {el,pi}=found;
            if(el.locked){ bad('잠긴 요소는 고칠 수 없어요'); return; }
            // 14.27.0 · 표 칸이나 테두리 획을 지우라는 말은 '그 표를 지워 달라'로
            //   알아듣는다 — 칸만 떼어 지우면 테두리가 남아 결국 표 전체 삭제다.
            if(cmd==='del'&&el.tbl){
                const tf=findTblAny(el.tbl.tid);
                if(tf){ dropTable(tf); note('표 칸이라 표 전체를 지웠어요'); res.applied++; return; }
                bad('표를 찾지 못했어요 · 다시 요청해 주세요'); return;
            }
            // 표 테두리 선은 표를 고치면 자동 재생성되니 직접 건드리지 않는다.
            if(el.type==='stroke'&&el.tbl){ bad('표 테두리는 표 명령(@tsz·@tmv)으로만 다룰 수 있어요'); return; }
            if(cmd==='del'){
                if(el.tbl){ bad('표 칸은 낱개로 지울 수 없어요 · 표 전체는 표 id로 지워요'); return; }
                beforeChange();
                doc.pages[pi].els=(doc.pages[pi].els||[]).filter(item=>item!==el);
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='tx'){
                if(el.tbl){ bad('표 칸 내용은 @tcell로 바꿔 주세요'); return; }
                if(el.type!=='text'){ bad('글상자만 내용을 바꿀 수 있어요'); return; }
                // 14.29.2 · **중요어**·# 제목 줄·문장 안 $수식$ 을 노트 서식으로 옮긴다
                beforeChange(); el.html=aiMdToHtml(text(op.text),el.fontSize||16);
                delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='mtx'||cmd==='latex'){
                if(el.type!=='latex'){ bad('@mtx는 수식 요소에만 쓸 수 있어요'); return; }
                const newLatex=String(op.latex==null?'':op.latex).trim().slice(0,2000);
                if(!newLatex){ bad('바꿀 LaTeX 수식이 비어 있어요'); return; }
                beforeChange();
                el.latex=newLatex;
                if(op.display==1||op.display===true) el.displayMath=1;
                else if(op.display===0||op.display===false) el.displayMath=0;
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='rp'){
                if(el.tbl){ bad('표 칸 내용은 @tcell로 바꿔 주세요'); return; }
                if(el.type!=='text'){ bad('글상자만 내용을 바꿀 수 있어요'); return; }
                const find=text(op.find),repl=text(op.repl);
                if(!find){ bad('찾을 글이 비어 있어 바꿀 곳을 찾지 못했어요'); return; }
                const got=aiEditReplaceHtml(el.html,find,repl);
                if(!got.count){ bad('상자에서 찾을 글을 찾지 못했어요'); return; }
                beforeChange(); el.html=got.html;
                delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='ap'){
                if(el.tbl){ bad('표 칸은 @tcell로 내용을 바꿔 주세요'); return; }
                if(el.type!=='text'){ bad('글상자에만 덧붙일 수 있어요'); return; }
                const body=text(op.text);
                if(!body.trim()){ bad('덧붙일 글이 비어 있어요'); return; }
                const front=/^(앞|앞쪽|prepend|pre|start|top|first)/i.test(String(op.dir||'뒤'));
                const piece=aiMdToHtml(body,el.fontSize||16);   // 14.29.2 · 마크다운 표시를 서식으로
                beforeChange();
                el.html=!aiEditText(el).trim()?piece
                    :(front?piece+'<br>'+(el.html||''):(el.html||'')+'<br>'+piece);
                delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                touched.add(pi); res.applied++; return;
            }
            // 14.27.0 · @hl — 형광펜. 글귀를 주면 '그 글귀만' 칠한다(저장 포맷과
            //   같은 background-color span). 글귀가 없으면 상자 전체 배경이다.
            //   색을 안 적으면 노랑, '없음·지우기'면 지우기다.
            if(cmd==='hl'){
                if(el.type!=='text'){ bad('형광펜은 글상자(표 칸 포함)에만 칠할 수 있어요'); return; }
                let find=aiEditLooseFind(op.find);
                let colorV=String(op.color==null?'':op.color).trim();
                // "@hl id | 노랑" 처럼 값 하나만 오면 색으로, 아니면 찾을 글로 본다.
                if(op.single&&find
                   &&(aiEditColor(find,true)!=null||AI_CLEAR_WORDS[find.toLowerCase()])){
                    colorV=find; find='';
                }
                // "@hl id | 노랑 | 중요한 글" 처럼 순서가 뒤집혀 오면 바꿔 준다.
                if(find&&colorV&&aiEditColor(colorV,true)==null
                   &&!AI_CLEAR_WORDS[colorV.toLowerCase()]&&aiEditColor(find,true)!=null){
                    const swap=find; find=colorV; colorV=swap;
                }
                const whole=!find||find==='*'||find==='전체'||find==='모두'||find==='all';
                const clearing=!!colorV&&!!AI_CLEAR_WORDS[colorV.toLowerCase()];
                const color=aiEditColor(colorV,true)||AI_HL_DEFAULT;
                if(clearing){
                    if(whole){
                        const had=!!el.cellBg||/background(?:-color)?\s*:/i.test(String(el.html||''));
                        if(!had){ bad('지울 형광펜이 없어요'); return; }
                        beforeChange();
                        delete el.cellBg;
                        el.html=aiEditUnmarkHtml(el.html,'').html;
                    }else{
                        const got=aiEditUnmarkHtml(el.html,find);
                        if(!got.count){ bad('상자에서 찾을 글을 찾지 못했어요'); return; }
                        beforeChange();
                        el.html=got.html;
                        if(el.cellBg){ delete el.cellBg; note('상자 전체 배경 형광펜도 함께 지웠어요'); }
                    }
                }else if(whole){
                    beforeChange();
                    el.cellBg=color;
                }else{
                    const got=aiEditMarkHtml(el.html,find,color);
                    if(!got.count){ bad('상자에서 찾을 글을 찾지 못했어요'); return; }
                    beforeChange();
                    el.html=got.html;
                }
                delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='st'){
                const changes=aiEditStyleOps(op.style);
                if(!changes.length){ bad('알 수 없는 서식이라 건너뛰었어요'); return; }
                if(el.type==='text'){
                    const use=changes.filter(ch=>['font','fs','fg','hl','bold','italic',
                        'underline','strike','align'].indexOf(ch.k)>=0);
                    if(!use.length){ bad('이 상자에는 적용할 서식이 없어요'); return; }
                    beforeChange();
                    use.forEach(ch=>{
                        if(ch.k==='font') el.font=ch.v;
                        else if(ch.k==='fs') el.fontSize=ch.v;
                        else if(ch.k==='fg'){ if(ch.v) el.textColor=ch.v; else delete el.textColor; }
                        else if(ch.k==='hl'){ if(ch.v) el.cellBg=ch.v; else delete el.cellBg; }
                        else if(ch.k==='bold'){ if(ch.v) el.fontWeight='700'; else delete el.fontWeight; }
                        else if(ch.k==='italic'){ if(ch.v) el.fontStyle='italic'; else delete el.fontStyle; }
                        else if(ch.k==='underline'||ch.k==='strike'){
                            const tok=ch.k==='underline'?'underline':'line-through';
                            const cur=String(el.textDecoration||'').split(/\s+/)
                                .filter(t=>t&&t!=='none'&&t!==tok);
                            if(ch.v) cur.push(tok);
                            if(cur.length) el.textDecoration=cur.join(' ');
                            else delete el.textDecoration;
                        }
                        else if(ch.k==='align') el.align=ch.v;
                    });
                    delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                    touched.add(pi); res.applied++; return;
                }
                if(el.type==='stroke'){
                    let did=false;
                    changes.forEach(ch=>{
                        if((ch.k==='fg'||ch.k==='pencolor')&&ch.v){ el.color=ch.v; did=true; }
                        else if(ch.k==='fs'||ch.k==='pensize'){
                            el.size=Math.max(0.5,Math.min(30,Number(ch.v)||el.size||2)); did=true;
                        }
                    });
                    if(!did){ bad('그림획은 펜색·굵기만 바꿀 수 있어요'); return; }
                    beforeChange(); touched.add(pi); res.applied++; return;
                }
                if(el.type==='latex'){
                    const fs=changes.find(ch=>ch.k==='fs');
                    if(!fs){ bad('수식은 글자 크기만 바꿀 수 있어요'); return; }
                    beforeChange(); el.fontSize=Math.max(5,Math.min(200,fs.v));
                    touched.add(pi); res.applied++; return;
                }
                bad('이 요소에는 서식을 적용할 수 없어요'); return;
            }
            // 표 칸은 내용(@tcell)·서식(@st)까지만 — 위치·크기·삭제는 표가 깨진다.
            if(el.tbl){ bad('표 칸은 @tcell·@st로만 다룰 수 있어요'); return; }
            if(cmd!=='mv'&&cmd!=='sz'&&cmd!=='bx'){
                bad('알 수 없는 편집 명령을 건너뛰었어요'); return;
            }
            if(!['text','image','latex','stroke','legacyDraw'].includes(el.type)){
                bad('지원하지 않는 요소 종류라 건너뛰었어요'); return;
            }
            if(el.type==='legacyDraw'){
                bad('배경그림은 이동하거나 크기를 바꿀 수 없어요'); return;
            }
            if(el.type==='stroke'&&cmd!=='mv'){
                bad('그림획은 이동만 할 수 있어요'); return;
            }
            if((cmd==='mv'||cmd==='bx')&&(!finite(op.x)||!finite(op.y))){
                bad('이동 좌표가 올바르지 않아요'); return;
            }
            if((cmd==='sz'||cmd==='bx')&&(!finite(op.w)||!finite(op.h))){
                bad('크기가 올바르지 않아요'); return;
            }
            if(el.type==='stroke'){
                const b=aiEditStrokeBox(el);
                const x=clamp(round(op.x),0,Math.max(0,size.w-b.w));
                const y=clamp(round(op.y),0,Math.max(0,size.h-b.h));
                beforeChange(); el.dx=x-b.baseX; el.dy=y-b.baseY;
                touched.add(pi); res.applied++; return;
            }
            const b=aiEditBox(el);
            let p;
            if(cmd==='mv') p=place(op.x,op.y,Math.max(20,b.w),Math.max(20,b.h),{pi:pi,skipId:el.id});
            else if(cmd==='sz'){
                // 크기만 바꾸라는 요청은 x/y를 움직이지 않는다. 가장자리까지 남은
                // 폭이 20px보다 작으면 그 여유만큼까지 허용해 페이지 밖으로 새지 않게 한다.
                if(!finite(b.x)||!finite(b.y)||b.x<0||b.y<0||b.x>=size.w||b.y>=size.h){
                    bad('요소의 현재 위치가 페이지 밖이라 크기를 바꾸지 않았어요'); return;
                }
                const maxW=Math.max(1,size.w-b.x),maxH=Math.max(1,size.h-b.y);
                p={x:b.x,y:b.y,w:clamp(round(op.w),Math.min(20,maxW),maxW),
                    h:clamp(round(op.h),Math.min(20,maxH),maxH)};
            }else p=place(op.x,op.y,op.w,op.h,{pi:pi,skipId:el.id});
            beforeChange();
            if(cmd!=='sz'){ el.x=p.x; el.y=p.y; }
            if(cmd!=='mv'){ el.w=p.w; el.h=p.h; }
            touched.add(pi); res.applied++;
        });
        if(res.applied>0){
            touched.forEach(pi=>{
                try{ markPageEdited(pi); }catch(e){}
                try{ if(renderedPages.has(pi)) renderPageEls(pi); }catch(e){}
            });
            // @goto·@title은 화면·노트 이름만 건드린다 — 문서 저장은 실제 변경 때만.
            if(historyStarted){
                try{ syncBoost(); }catch(e){}
                saveDoc(); queueOps();
            }
        }
        return res;
    }

    // 20.1 · 해돌이에게 넘길 노트 글 캐시.
    //   text('doc') 는 문서 전체(논문이면 수백 쪽 × 상자 수백 개)를 훑는다.
    //   해돌이의 warm 예약·버튼 상태 칠하기가 스크롤·DOM 변화마다 이걸 다시 부르면
    //   메인 스레드가 통째로 잠긴다. 문서가 실제로 바뀔 때만 다시 만든다.
    //
    // 20.2 · 쪽 단위로 쪼개 캐시한다. 문서 전체 글은 '쪽 글'을 이어 붙인 것이므로
    //   ① 한 쪽만 고쳐도 그 쪽만 다시 뽑으면 되고,
    //   ② 처음 만들 때도 한 번에 다 하지 않고 조금씩 나눠 만들 수 있다.
    let _aiTextSeq=0;
    let _aiPageText=[];          // 쪽 글 (인덱스별) — 이 노트/이 seq 의 것
    let _aiPageOwner='';         // 어느 노트·어느 seq 의 캐시인지
    function _aiOwner(){ return (curNB&&curNB.id||'')+'|'+_aiTextSeq; }
    function _aiReset(){ _aiPageText=[]; _aiPageOwner=_aiOwner(); }
    function bumpAiText(){ _aiTextSeq++; _aiReset(); }
    // 20.2 · 고친 쪽 하나만 버린다. 글자를 칠 때마다 문서 전체를 버리면
    //   쪽 캐시를 둔 의미가 없다(논문에서 다시 전부 뽑게 된다).
    function aiInvalidatePage(i){
        if(_aiPageOwner!==_aiOwner()){ _aiReset(); return; }
        i=+i; if(i>=0) _aiPageText[i]=null;
    }
    try{ window.__sdyBumpAiText=bumpAiText; }catch(e){}

    // 쪽 하나의 글 — 캐시가 있으면 그대로, 없으면 뽑아서 저장.
    function aiPageText(i){
        if(_aiPageOwner!==_aiOwner()) _aiReset();
        const c=_aiPageText[i];
        if(c!=null) return c;
        const out=[];
        try{ collectPageEls(i).forEach(o=>{ if(o.src) out.push(o.src); }); }catch(e){}
        const s=out.join('\n');
        _aiPageText[i]=s;
        return s;
    }
    // 아직 안 뽑은 쪽이 있나?
    function aiTextPending(){
        if(!doc||!doc.pages) return 0;
        if(_aiPageOwner!==_aiOwner()) return doc.pages.length;
        let n=0;
        for(let i=0;i<doc.pages.length;i++) if(_aiPageText[i]==null) n++;
        return n;
    }
    /* 20.2 · 문서 전체 글을 '조금씩' 만들어 둔다.
       노트를 연 직후 해돌이가 전체 요약을 준비하려면 결국 모든 쪽을 읽어야 하는데,
       그걸 한 번에 하면 논문에서 1초 가까이 메인 스레드가 잠긴다(첫 동작이 굼뜬 이유).
       한 번에 몇 쪽씩만, 그것도 브라우저가 한가할 때만 뽑아 두면
       버튼을 누를 즈음엔 이미 다 준비돼 있고 화면은 한 프레임도 멎지 않는다.
       보고 있는 쪽 주변부터 채운다 — 사용자가 실제로 먼저 물어볼 곳이다. */
    let _aiFillTok=0;
    function aiFillDocText(){
        const tok=++_aiFillTok;
        const owner=_aiOwner();
        const idle=(cb)=>{
            if(typeof requestIdleCallback==='function') requestIdleCallback(cb,{timeout:2000});
            else setTimeout(()=>cb({timeRemaining:()=>8}),32);
        };
        const step=(dl)=>{
            if(tok!==_aiFillTok||!doc||!doc.pages||_aiOwner()!==owner) return;   // 노트가 바뀌었다 → 중단
            const n=doc.pages.length;
            // 보고 있는 쪽에서 바깥으로 퍼져 나가며 채운다
            const cur=Math.max(0,Math.min(n-1,curPageIdx|0));
            let did=0;
            for(let r=0;r<n;r++){
                for(const i of (r===0?[cur]:[cur-r,cur+r])){
                    if(i<0||i>=n) continue;
                    if(_aiPageText[i]!=null) continue;
                    aiPageText(i); did++;
                    // 한가한 시간이 남아 있는 동안만, 최대 4쪽씩 (프레임 예산 보호)
                    const left=(dl&&typeof dl.timeRemaining==='function')?dl.timeRemaining():0;
                    if(did>=4||left<3){ idle(step); return; }
                }
            }
            if(did) paintOutlineReadySafe();      // 다 채워졌으면 버튼 표시를 한 번 갱신
        };
        idle(step);
    }
    function paintOutlineReadySafe(){
        try{ if(typeof window.sdyAiPaintReady==='function') window.sdyAiPaintReady(); }catch(e){}
    }
    try{ window.__sdyAiFillText=aiFillDocText; window.__sdyAiTextPending=aiTextPending; }catch(e){}
    try{
        window.__sdyAiBridge={
            text:(scope)=>{
                try{
                    if(!doc||!doc.pages||!doc.pages.length) return '';
                    if(scope==='page') return aiPageText(Math.max(0,Math.min(doc.pages.length-1,curPageIdx|0)));
                    const out=[];
                    for(let i=0;i<doc.pages.length;i++){
                        const s=aiPageText(i);
                        if(s) out.push(s);
                    }
                    return out.join('\n');
                }catch(e){ return ''; }
            },
            // 20.2 · 아직 안 뽑은 쪽이 없을 때만 문서 전체 글을 준다.
            //   해돌이 warm(미리 준비)은 이걸 써서 '조용히 다 준비된 뒤'에만 서버로 간다 —
            //   준비가 덜 됐으면 억지로 다 뽑지 않고(=멈춤 없이) 다음 기회로 미룬다.
            textIfReady:(scope)=>{
                try{
                    if(!doc||!doc.pages||!doc.pages.length) return null;
                    if(scope==='page') return aiPageText(Math.max(0,Math.min(doc.pages.length-1,curPageIdx|0)));
                    if(aiTextPending()>0){ aiFillDocText(); return null; }
                    return window.__sdyAiBridge.text('doc');
                }catch(e){ return null; }
            },
            title:()=>String((document.getElementById('edTitle')||{}).value||'').trim(),
            snapshot:()=>{ try{ commitEditingText(); return aiEditSnapshot(); }catch(e){ return ''; } },
            capture:()=>{
                try{
                    commitEditingText();
                    return {text:aiEditSnapshot(),revision:aiEditRevision()};
                }catch(e){ return {text:'',revision:''}; }
            },
            apply:(ops,revision)=>{
                try{
                    const list=Array.isArray(ops)?ops:[];
                    const needsClip=list.some(o=>o&&(o.cmd==='clip'||o.cmd==='clipin'||o.cmd==='copy'));
                    const needsImg=list.some(o=>o&&String(o.cmd||'').toLowerCase()==='img');
                    // 클립보드·사진(@img)이 없으면 동기 그대로 — 있으면 읽어/받아
                    // @add·@addimg로 바꾼 뒤 적용한다.
                    if(!needsClip&&!needsImg) return aiEditApply(list,revision);
                    return (async()=>{
                        let preFailed=0; const preNotes=[];
                        // 14.30.0 · @img — 서버(/api/ai/imgadd)가 사진을 찾아
                        //   저장소에 받아 주소를 돌려준다(캐시됨). 실패한 장만 센다.
                        const imgOps=list.filter(o=>o&&String(o.cmd||'').toLowerCase()==='img');
                        const imgGot={};
                        for(const io of imgOps.slice(0,3)){
                            try{
                                const iq=String(io.q||'').trim().slice(0,160);
                                if(!iq) throw new Error('찾을 사진 검색어가 비어 있어요');
                                const ir=await fetch('/api/ai/imgadd',{method:'POST',
                                    headers:{'Content-Type':'application/json'},
                                    body:JSON.stringify({q:iq})});
                                const ij=await ir.json().catch(()=>null);
                                if(!ir.ok||!ij||!ij.ok||!ij.url)
                                    throw new Error((ij&&ij.error)||'사진을 찾지 못했어요');
                                imgGot[io]=ij;
                            }catch(e){
                                preFailed++;
                                const em=String((e&&e.message)||e||'사진을 찾지 못했어요');
                                if(preNotes.indexOf(em)<0&&preNotes.length<4) preNotes.push(em);
                            }
                        }
                        let clip='',clipErr='';
                        if(list.some(o=>o&&(o.cmd==='clip'||o.cmd==='clipin'))){
                            try{
                                if(navigator.clipboard&&navigator.clipboard.readText)
                                    clip=String(await navigator.clipboard.readText()||'');
                                else clipErr='이 브라우저에서는 클립보드를 읽지 못해요';
                            }catch(e){ clipErr='클립보드를 읽지 못했어요 · 복사 권한을 확인해 주세요'; }
                            clip=clip.slice(0,AI_EDIT_MAX_TEXT);
                            if(!clip&&!clipErr) clipErr='클립보드가 비어 있어요 · 먼저 복사해 주세요';
                        }
                        const mapped=[];
                        const copies=[];
                        list.forEach(o=>{
                            const cmd=String(o&&o.cmd||'').toLowerCase();
                            if(cmd==='img'){
                                const jj=imgGot[o];
                                if(!jj){ return; }          // 실패는 위에서 이미 세었다
                                mapped.push({cmd:'addimg',page:o.page,x:o.x,y:o.y,w:o.w,h:o.h,
                                    url:jj.url,public_id:jj.public_id||'',
                                    natW:jj.width||null,natH:jj.height||null});
                                return;
                            }
                            if(cmd==='clip'){
                                if(!clip){ preFailed++; if(preNotes.indexOf(clipErr)<0) preNotes.push(clipErr); return; }
                                mapped.push({cmd:'add',page:o.page,x:o.x,y:o.y,w:o.w,h:o.h,
                                    text:clip,inherit:o.inherit});
                            }else if(cmd==='clipin'){
                                if(!clip){ preFailed++; if(preNotes.indexOf(clipErr)<0) preNotes.push(clipErr); return; }
                                mapped.push({cmd:'ap',id:o.id,dir:o.dir,text:clip});
                            }else if(cmd==='copy'){ copies.push(o); }
                            else mapped.push(o);
                        });
                        const res=aiEditApply(mapped,revision);
                        res.failed+=preFailed;
                        preNotes.forEach(m=>{ if(m&&res.notes.length<4&&res.notes.indexOf(m)<0) res.notes.push(m); });
                        // 복사는 문서 변경 뒤 최종 글 기준으로 내보낸다.
                        for(const cp of copies){
                            const found=(()=>{ 
                                const id=String(cp&&cp.id||'').trim();
                                if(!id) return null;
                                for(let pi=0;pi<doc.pages.length;pi++){
                                    const el=((doc.pages[pi]||{}).els||[]).find(item=>item&&item.id===id);
                                    if(el) return el;
                                }
                                return null;
                            })();
                            if(!found||(found.type!=='text'&&found.type!=='latex')){
                                res.failed++;
                                if(res.notes.length<4) res.notes.push('복사할 글상자를 찾지 못했어요');
                                continue;
                            }
                            try{
                                if(!(navigator.clipboard&&navigator.clipboard.writeText))
                                    throw new Error('no clipboard');
                                await navigator.clipboard.writeText(aiEditText(found));
                                res.applied++;
                            }catch(e){
                                res.failed++;
                                if(res.notes.length<4&&res.notes.indexOf('클립보드에 복사하지 못했어요')<0)
                                    res.notes.push('클립보드에 복사하지 못했어요');
                            }
                        }
                        return res;
                    })();
                }
                catch(e){ return {applied:0,failed:Array.isArray(ops)?ops.length:0,stale:false,
                    notes:['적용 중 오류 · '+String(e&&e.message||'다시 시도해 주세요')]}; }
            },
        };
    }catch(e){}
    /* ============ /6.1 번역 ============ */

    // 가져온(tight) 상자에서 복사 시: 절대스팬 사이 줄바꿈을 공백으로 정돈해
    // 외부에 붙여넣어도 깔끔한 문장으로 나가게 한다.
    document.addEventListener('copy',e=>{
        try{
            const sel=window.getSelection();
            if(!sel||sel.isCollapsed) return;
            const n=sel.anchorNode
                ? (sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement)
                : null;
            const host=n&&n.closest('.tb-content');
            if(!host||!host.closest('.tight')) return;
            // 외부(구글 등) 붙여넣기용: 공백 재조립 + 줄바꿈→공백
            const clean=tightSelectionText(sel).replace(/\n+/g,' ').replace(/\s{2,}/g,' ').trim();
            if(!clean) return;
            e.clipboardData.setData('text/plain',clean);
            e.preventDefault();
        }catch(err){}
    });


/* APP-PART:12-media.js:END */
