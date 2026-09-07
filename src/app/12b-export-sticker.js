/* === src/app/12b-export-sticker.js ===
   내보내기 · 스티커 만들기/보관함
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:12b-export-sticker.js:BEGIN */
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

/* APP-PART:12b-export-sticker.js:END */
