/* === src/app/02e-folders.js ===
   스냅정렬 · 멀티선택 · 폴더 · 휴지통 · escrow
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:02e-folders.js:BEGIN */
    // ============ 스마트 정렬 (스냅 가이드) ============
    // 다른 요소의 가장자리/중심, 그리고 종이 중앙에 가까워지면 딱 붙는다.
    const SNAP_TOL=6;            // 스냅이 걸리는 거리 (종이 좌표 기준)
    let snapEnabled=true;

    function toggleSnap(){
        snapEnabled=!snapEnabled;
        const b=document.getElementById('snapBtn');
        if(b) b.classList.toggle('active',snapEnabled);
        clearSnapLines();
        toast(snapEnabled?'정렬 안내선 켜짐':'정렬 안내선 꺼짐',1100);
    }

    // 스냅 후보 좌표 모으기 (자기 자신과 함께 움직이는 것들은 제외)
    function snapTargets(pageIdx,excludeIds){
        const V=[], H=[];
        const sz=paperSize();
        V.push({v:sz.w/2,center:true}); H.push({v:sz.h/2,center:true});   // 종이 중앙
        (doc.pages[pageIdx].els||[]).forEach(el=>{
            if(excludeIds.includes(el.id)) return;
            const bb=elBBox(el,pageIdx);
            if(!bb) return;
            V.push({v:bb.x},{v:bb.x+bb.w/2,center:true},{v:bb.x+bb.w});
            H.push({v:bb.y},{v:bb.y+bb.h/2,center:true},{v:bb.y+bb.h});
        });
        return {V,H};
    }

    // x,y 를 스냅된 좌표로 보정하고, 걸린 안내선을 그린다
    function applySnap(pageIdx,x,y,w,h,excludeIds){
        if(!snapEnabled){ clearSnapLines(); return {x,y}; }
        const {V,H}=snapTargets(pageIdx,excludeIds||[]);
        const lines=[];
        // 가로 위치: 왼쪽 / 가운데 / 오른쪽 세 지점을 후보와 비교
        let bestX=null;
        [[x,0],[x+w/2,w/2],[x+w,w]].forEach(([edge,off])=>{
            V.forEach(t=>{
                const d=Math.abs(edge-t.v);
                if(d<=SNAP_TOL && (!bestX||d<bestX.d)) bestX={d,nx:t.v-off,line:t.v,center:!!t.center};
            });
        });
        let bestY=null;
        [[y,0],[y+h/2,h/2],[y+h,h]].forEach(([edge,off])=>{
            H.forEach(t=>{
                const d=Math.abs(edge-t.v);
                if(d<=SNAP_TOL && (!bestY||d<bestY.d)) bestY={d,ny:t.v-off,line:t.v,center:!!t.center};
            });
        });
        if(bestX){ x=Math.round(bestX.nx); lines.push({dir:'v',pos:bestX.line,center:bestX.center}); }
        if(bestY){ y=Math.round(bestY.ny); lines.push({dir:'h',pos:bestY.line,center:bestY.center}); }
        drawSnapLines(pageIdx,lines);
        return {x,y};
    }

    let _snapLineNodes=[], _snapLineSig='';
    function drawSnapLines(pageIdx,lines){
        const paper=paperAt(pageIdx); if(!paper) return;
        const sig=pageIdx+'|'+(lines||[]).map(l=>l.dir+':'+Math.round(l.pos*10)/10+':' +(l.center?1:0)).join('|');
        if(sig===_snapLineSig) return;
        clearSnapLines();
        _snapLineSig=sig;
        (lines||[]).forEach(l=>{
            const d=document.createElement('div');
            d.className='snap-line '+l.dir+(l.center?' center':'');
            if(l.dir==='v') d.style.left=l.pos+'px'; else d.style.top=l.pos+'px';
            paper.appendChild(d);
            _snapLineNodes.push(d);
        });
    }
    function clearSnapLines(){
        if(!_snapLineNodes.length){ _snapLineSig=''; return; }
        _snapLineNodes.forEach(n=>{ try{ n.remove(); }catch(e){} });
        _snapLineNodes=[]; _snapLineSig='';
    }

    // 선택한 여러 요소를 서로 맞춰 정렬 / 균등 배치
    function alignSelection(mode){
        if(multiSel.length<2){ toast('두 개 이상 선택하세요',1400); return; }
        const pi=multiSel[0].pageIdx;
        const items=multiSel.map(m=>({m,el:findEl(m.pageIdx,m.id)})).filter(o=>o.el);
        const boxes=items.map(o=>({...o,bb:elBBox(o.el,pi)}));
        let x0=Math.min(...boxes.map(b=>b.bb.x));
        let x1=Math.max(...boxes.map(b=>b.bb.x+b.bb.w));
        let y0=Math.min(...boxes.map(b=>b.bb.y));
        let y1=Math.max(...boxes.map(b=>b.bb.y+b.bb.h));
        pushHistory();
        const put=(o,nx,ny)=>{
            if(o.el.type==='stroke'){
                o.el.dx=(o.el.dx||0)+(nx-o.bb.x); o.el.dy=(o.el.dy||0)+(ny-o.bb.y);
                o.m.node.setAttribute('transform',`translate(${o.el.dx},${o.el.dy})`);
            }else{
                const c=clampEl(nx,ny,o.el.w,o.el.h);
                o.el.x=Math.round(c.x); o.el.y=Math.round(c.y);
                o.m.node.style.left=o.el.x+'px'; o.m.node.style.top=o.el.y+'px';
            }
        };
        if(mode==='left')        boxes.forEach(o=>put(o,x0,o.bb.y));
        else if(mode==='right')  boxes.forEach(o=>put(o,x1-o.bb.w,o.bb.y));
        else if(mode==='hcenter'){const cx=(x0+x1)/2; boxes.forEach(o=>put(o,cx-o.bb.w/2,o.bb.y));}
        else if(mode==='top')    boxes.forEach(o=>put(o,o.bb.x,y0));
        else if(mode==='bottom') boxes.forEach(o=>put(o,o.bb.x,y1-o.bb.h));
        else if(mode==='vcenter'){const cy=(y0+y1)/2; boxes.forEach(o=>put(o,o.bb.x,cy-o.bb.h/2));}
        else if(mode==='hdist'||mode==='vdist'){
            if(boxes.length<3){ toast('세 개 이상 선택하세요',1400); return; }
            const hor=mode==='hdist';
            const sorted=[...boxes].sort((a,b)=>hor?a.bb.x-b.bb.x:a.bb.y-b.bb.y);
            const total=hor?(x1-x0):(y1-y0);
            const used=sorted.reduce((t,o)=>t+(hor?o.bb.w:o.bb.h),0);
            const gap=(total-used)/(sorted.length-1);
            let cur=hor?x0:y0;
            sorted.forEach(o=>{
                if(hor){ put(o,cur,o.bb.y); cur+=o.bb.w+gap; }
                else   { put(o,o.bb.x,cur); cur+=o.bb.h+gap; }
            });
        }
        markPageEdited(pi); saveDoc();
        toast('정렬 완료',1000);
    }

    // ============ Multi Select ============
    let selectMode=false,selectedNBs=new Set(),longPressTimer=null;

    // ===== 폴더 =====
    // folders: [{id,name,color,created_at}] / 노트의 폴더는 cfg.folder 에 저장
    function getFolders(){ try{ return JSON.parse(localStorage.getItem('sdy_folders')||'[]'); }catch(e){ return []; } }
    function saveFolders(f){ localStorage.setItem('sdy_folders',JSON.stringify(f)); pushSettingsNow(); }   // 폴더 변경은 즉시 서버 동기화
    let curFolder=null;    // null = 최상위

    // ===== 휴지통 (삭제한 노트가 30일 후 자동 영구 삭제 — 설정에서 관리) =====
    const TRASH_TTL_MS=30*24*60*60*1000;
    function isTrashFolder(fid){ const f=folderById(fid); return !!(f&&f.trash); }   // 옛 버전 잔여 폴더 감지용
    function isTrashed(id){ return !!getCfg(id).trashed_at; }
    // 옛 버전의 '휴지통 폴더'에 담겨 있던 노트를 새 방식(trashed_at)으로 옮긴다
    function migrateTrashFolder(){
        try{
            const fs=getFolders();
            const oldTrash=fs.filter(f=>f.trash||f.id==='f_trash');
            if(!oldTrash.length) return;
            const oldIds=new Set(oldTrash.map(f=>f.id));
            notebooks.forEach(nb=>{
                const fid=noteFolder(nb.id);
                if(fid&&oldIds.has(fid)){
                    const c=getCfg(nb.id);
                    c.__prevFolder=c.__prevFolder||null;
                    if(!c.trashed_at) c.trashed_at=Date.now();
                    setCfg(nb.id,c);
                    if(c.folder===fid){        // 내부 정리 — 잠금 검사 우회 (직접 기록)
                        const pv=c.__prevFolder||null;
                        if(pv) c.folder=pv; else delete c.folder;
                        setCfg(nb.id,c);
                    }
                }
            });
            saveFolders(fs.filter(f=>!oldIds.has(f.id)));
        }catch(e){}
    }
    // 노트를 휴지통으로 (영구 삭제가 아님 — 격자에서만 숨겨짐)
    function moveToTrash(id){
        const c=getCfg(id);
        c.__prevFolder=c.folder||null;   // 복원 위치 기억
        c.trashed_at=Date.now();
        setCfg(id,c);
        pushSettingsNow();               // 휴지통 이동도 즉시 서버 반영
        saveLocalNBs();
    }
    // 휴지통에서 노트 복원. 원래 폴더가 아직 휴지통에 있으면 노트만 먼저
    // 최상위로 꺼낸다. 나중에 그 폴더를 복구하면 폴더의 삭제 스냅샷이 이
    // 노트까지 원래 자리로 다시 데려간다.
    function restoreFromTrash(id){
        const c=getCfg(id);
        const prev=c.__prevFolder||c.folder||null;
        delete c.trashed_at; delete c.__prevFolder;
        const pf=prev&&folderById(prev);
        if(prev&&pf&&!pf.trashed_at) c.folder=prev;
        else delete c.folder;
        setCfg(id,c);
        pushSettingsNow(); saveLocalNBs();
    }
    // 영구 삭제 (서버·기기에서 완전히 제거) — 서버 삭제를 기다린다
    async function permanentDeleteNB(id, purgeImgs){
        if(purgeImgs){
            try{ const d=loadDoc(id); (d.pages||[]).forEach(p=>purgeElements(p.els||[])); }catch(e){}
        }
        // 서버에서 먼저 지우고(await) → 그래야 loadNBs 재조회 때 부활하지 않는다
        if(!String(id).startsWith('local_')&&SB){
            try{ await SB.from('notebooks').delete().eq('id',id); }catch(e){}
        }
        // 혹시 서버 삭제가 실패/지연돼도 재조회 때 되살아나지 않도록 기록(tombstone)
        tombstone('notebooks', id);
        localStorage.removeItem('nb_'+id); localStorage.removeItem('draw_'+id);
        sessionKeys.delete(id); decCache.delete(id); adminPlainUnlocked.delete(id);
        notebooks=notebooks.filter(x=>x.id!==id);
        saveLocalNBs();
    }
    // 휴지통에 있는 폴더의 대표 항목. 하위 폴더도 함께 표시하면 한 번의 삭제가
    // 여러 줄로 보이므로, 사용자가 직접 지운 루트 폴더만 목록에 보여 준다.
    function trashedFolders(){
        return getFolders().filter(f=>f&&f.trashed_at&&f.trash_root)
            .sort((a,b)=>(b.trashed_at||0)-(a.trashed_at||0));
    }
    function _folderTrashIds(root){
        const snap=root&&root.trash_snapshot;
        if(snap&&Array.isArray(snap.folderIds)) return snap.folderIds.slice();
        return getFolders().filter(f=>f.trash_root_id===(root&&root.id)).map(f=>f.id);
    }
    // 폴더 영구 삭제. 폴더 휴지통 안에 남아 있던 노트도 복구 시 없는 폴더를
    // 가리키지 않도록 삭제 폴더의 바깥(부모, 없으면 최상위)으로 정리한다.
    function permanentDeleteFolder(fid){
        const fs=getFolders();
        const root=fs.find(f=>f.id===fid); if(!root) return;
        const ids=_folderTrashIds(root);
        const idset=new Set(ids);
        const p0=root.trash_snapshot&&root.trash_snapshot.parent;
        const pf=p0&&fs.find(f=>f.id===p0&&!f.trashed_at);
        const up=pf?p0:null;
        notebooks.forEach(nb=>{
            const c=getCfg(nb.id); let ch=false;
            if(idset.has(c.folder)){ if(up)c.folder=up; else delete c.folder; ch=true; }
            if(idset.has(c.__prevFolder)){ if(up)c.__prevFolder=up; else delete c.__prevFolder; ch=true; }
            if(ch) setCfg(nb.id,c);
        });
        ids.forEach(id=>tombstone('folders',id));
        saveFolders(fs.filter(f=>!idset.has(f.id)));
        if(idset.has(curFolder)) curFolder=up;
    }
    // 휴지통에 30일 넘게 있는 노트·폴더 자동 영구 삭제
    async function purgeTrash(){
        const now=Date.now(); let n=0;
        for(const nb of notebooks.slice()){
            const c=getCfg(nb.id);
            if(c.trashed_at && (now-c.trashed_at)>=TRASH_TTL_MS){
                await permanentDeleteNB(nb.id, false); n++;
            }
        }
        for(const f of trashedFolders().slice()){
            if((now-(f.trashed_at||0))>=TRASH_TTL_MS){ permanentDeleteFolder(f.id); n++; }
        }
        return n;
    }
    // 휴지통에 있는 노트 목록 (최근 삭제순)
    function trashedNotes(){
        return notebooks.filter(nb=>isTrashed(nb.id))
            .sort((a,b)=>(getCfg(b.id).trashed_at||0)-(getCfg(a.id).trashed_at||0));
    }
    function updateTrashCount(){
        const el=document.getElementById('trashCount');
        if(el){
            const n=trashedNotes().length+trashedFolders().length;
            el.textContent=n?`${n}개 항목`:'비어 있음';
        }
    }
    // ===== 휴지통 보기 (설정 안) =====
    async function openTrash(){
        await purgeTrash();           // 30일 지난 노트·폴더를 먼저 정리
        renderTrash();
        document.getElementById('trashModal').style.display='flex';
        openNav(closeTrash);
    }
    function closeTrash(){ document.getElementById('trashModal').style.display='none'; navDrop(closeTrash); }
    function renderTrash(){
        const el=document.getElementById('trashList');
        const notes=trashedNotes(), folders=trashedFolders();
        updateTrashCount();
        if(!notes.length&&!folders.length){
            el.innerHTML='<div class="vault-empty" style="padding:30px 10px;"><i class="ri-delete-bin-line"></i>휴지통이 비어 있습니다</div>';
            return;
        }
        const rows=[];
        folders.forEach(f=>{
            const left=TRASH_TTL_MS-(Date.now()-(f.trashed_at||0));
            const days=Math.max(1,Math.ceil(left/86400000));
            const n=Object.keys((f.trash_snapshot&&f.trash_snapshot.members)||{}).length;
            const countTxt=n?(' · 노트 '+n+'개'):'';
            rows.push({ts:f.trashed_at||0,html:`<div class="trash-item">
                <i class="ri-folder-3-fill" style="color:${f.color||'var(--accent)'};font-size:18px;"></i>
                <b>${esc(f.name||'폴더')} <small style="color:var(--text3);font-weight:500;">폴더${countTxt}</small></b>
                <span class="days">${days}일 후 삭제</span>
                <button onclick="restoreFolderFromTrash('${f.id}')">복구</button>
            </div>`});
        });
        notes.forEach(nb=>{
            const c=getCfg(nb.id);
            const left=TRASH_TTL_MS-(Date.now()-(c.trashed_at||0));
            const days=Math.max(1,Math.ceil(left/86400000));
            rows.push({ts:c.trashed_at||0,html:`<div class="trash-item">
                <i class="ri-file-text-line" style="color:var(--text3);font-size:16px;"></i>
                <b>${esc(nb.title||'새 노트')}</b>
                <span class="days">${days}일 후 삭제</span>
                <button onclick="restoreNoteFromTrash('${nb.id}')">복구</button>
            </div>`});
        });
        el.innerHTML=rows.sort((a,b)=>b.ts-a.ts).map(x=>x.html).join('');
    }
    function restoreNoteFromTrash(id){
        restoreFromTrash(id);
        renderTrash(); renderGrid(); toast('노트를 복원했습니다',1600);
        setTimeout(()=>{ const c=document.querySelector('.note-card[data-nb-id="'+id+'"]'); if(c) playClawDrop(c); },80);
    }
    function restoreFolderFromTrash(fid){
        const fs=getFolders();
        const root=fs.find(f=>f.id===fid&&f.trashed_at); if(!root) return;
        const snap=root.trash_snapshot||{};
        const ids=new Set(_folderTrashIds(root));
        fs.forEach(f=>{
            if(!ids.has(f.id)) return;
            delete f.trashed_at; delete f.trash_root; delete f.trash_root_id;
            if(f.id!==fid) delete f.trash_snapshot;
        });
        // 원래 부모가 없어졌거나 아직 휴지통이면 최상위에서 복원한다.
        if(root.parent){
            const parent=fs.find(f=>f.id===root.parent);
            if(!parent||parent.trashed_at) delete root.parent;
        }
        const members=snap.members||{};
        Object.keys(members).forEach(nbId=>{
            if(!notebooks.some(n=>String(n.id)===String(nbId))) return;
            const old=members[nbId];
            const c=getCfg(nbId);
            if(old&&fs.some(f=>f.id===old&&!f.trashed_at)) c.folder=old;
            else c.folder=fid;
            setCfg(nbId,c);
        });
        delete root.trash_snapshot;
        saveFolders(fs);
        pushSettingsNow(); saveLocalNBs();
        renderTrash(); renderGrid();
        toast(`'${root.name||'폴더'}' 와 안의 노트를 복원했습니다`,2200);
        setTimeout(()=>{ const c=document.querySelector('.folder-card[data-folder-id="'+fid+'"]'); if(c) playClawDrop(c); },80);
    }
    // 휴지통 비우기 (노트·폴더를 30일 대기 없이 즉시 제거)
    async function emptyTrash(){
        const notes=trashedNotes().map(nb=>nb.id);
        const folders=trashedFolders().map(f=>f.id);
        const total=notes.length+folders.length;
        if(!total){ toast('휴지통이 비어 있습니다',1600); return; }
        if(!confirm(`휴지통을 비울까요? ${total}개 항목이 되돌릴 수 없게 지워집니다.`)) return;
        folders.forEach(permanentDeleteFolder);
        for(const id of notes){ await permanentDeleteNB(id, true); }
        renderTrash(); renderGrid(); toast('휴지통을 비웠습니다');
    }
    function noteFolder(id){ return getCfg(id).folder||null; }
    function setNoteFolder(id,fid){
        const c=getCfg(id);
        // 9.3 · 잠긴 폴더 안의 노트는 밖으로 빼낼 수 없다.
        //  (드래그·메뉴·일괄이동 등 어느 경로로 와도 여기서 막힌다)
        const cur=c.folder||null;
        if(cur&&cur!==fid&&isFolderLocked(cur)&&!isFolderOpen(cur)){
            toast('🔒 잠긴 폴더에서는 노트를 꺼낼 수 없습니다',2400);
            return false;
        }
        if(fid&&!isFolderOpen(fid)){
            toast('🔒 잠긴 폴더에는 넣을 수 없습니다',2000);
            return false;
        }
        if(fid) c.folder=fid; else delete c.folder;
        setCfg(id,c);
        pushSettingsNow();      // 폴더 소속도 즉시 서버 반영
        return true;
    }
    function createFolder(name,ids){
        const f=getFolders();
        const nf={id:'f_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
                  name:name||'새 폴더',
                  color:FOLDER_COLORS[f.length%FOLDER_COLORS.length],
                  icon:'ri-folder-3-fill',created_at:new Date().toISOString()};
        if(curFolder) nf.parent=curFolder;      // 폴더 안에서 만들면 그 안에 생긴다
        untombstone('folders',nf.id);
        f.push(nf); saveFolders(f);
        (ids||[]).forEach(id=>setNoteFolder(id,nf.id));
        return nf;
    }
    function deleteFolder(fid){
        // 폴더 자체는 30일 휴지통으로 보내고, 안의 노트는 바로 폴더 바깥으로
        // 꺼낸다. 삭제 순간의 소속을 스냅샷으로 남겨 폴더를 복구하면 당시
        // 노트와 하위 폴더가 모두 원래 자리로 돌아오게 한다.
        const fs=getFolders();
        const root=fs.find(f=>f.id===fid); if(!root) return;
        const up=folderParent(fid);
        const ids=folderTree(fid);
        const idset=new Set(ids);
        const members={};
        notebooks.forEach(n=>{
            const old=noteFolder(n.id);
            if(!idset.has(old)) return;
            members[n.id]=old;
            if(isTrashed(n.id)) return;       // 노트 휴지통 상태·복원 위치는 보존
            const c=getCfg(n.id);
            if(up) c.folder=up; else delete c.folder;
            setCfg(n.id,c);
        });
        const ts=Date.now();
        fs.forEach(f=>{
            if(!idset.has(f.id)) return;
            f.trashed_at=ts;
            f.trash_root_id=fid;
            if(f.id===fid){
                f.trash_root=true;
                f.trash_snapshot={folderIds:ids.slice(),members,parent:up||null};
            }else{
                delete f.trash_root;
                delete f.trash_snapshot;
            }
        });
        saveFolders(fs);
        pushSettingsNow(); saveLocalNBs();
        if(idset.has(curFolder)) curFolder=up;
    }
    // ===== 폴더 계층 (폴더 안에 폴더) =====
    function folderParent(fid){
        const f=getFolders().find(x=>x.id===fid);
        return (f&&f.parent)||null;
    }
    function childFolders(fid){
        // 휴지통으로 간 폴더는 객체와 계층을 그대로 보관하되 일반 목록에서는
        // 숨긴다. 그래야 나중에 하위 폴더까지 정확히 복구할 수 있다.
        return getFolders().filter(f=>((f.parent||null)===(fid||null))
            &&!f.trash&&!f.trashed_at&&f.id!=='f_trash');
    }
    // fid 아래(자기 자신 포함) 모든 폴더 id
    function folderTree(fid){
        const out=[fid];
        childFolders(fid).forEach(c=>out.push(...folderTree(c.id)));
        return out;
    }
    // 최상위까지의 경로 [조상…, 자신]
    function folderPath(fid){
        const path=[]; let cur=fid, guard=0;
        while(cur&&guard++<40){
            const f=getFolders().find(x=>x.id===cur);
            if(!f) break;
            path.unshift(f);
            cur=f.parent||null;
        }
        return path;
    }
    // a 가 b 의 하위인가 (순환 방지용)
    function isDescendant(a,b){
        if(!a||!b) return false;
        return folderTree(b).indexOf(a)>=0;
    }
    // 9.3 · 마지막 방어선: 어떤 경로로 불려도 잠긴 폴더는 움직이지 않는다
    function setFolderParent(fid,pid){
        if(isFolderLocked(fid)&&!isFolderOpen(fid)) return false;
        if(pid&&!isFolderOpen(pid)) return false;
        if(fid===pid) return false;
        if(pid&&isDescendant(pid,fid)) return false;      // 자기 자손 밑으로는 못 넣는다
        const f=getFolders();
        const t=f.find(x=>x.id===fid); if(!t) return false;
        if(pid) t.parent=pid; else delete t.parent;
        saveFolders(f);
        return true;
    }
    // 안에 든 노트 수 (하위 폴더까지 합산)
    function folderCount(fid){
        const ids=folderTree(fid);
        // 휴지통으로 이동한 노트는 카운트에서 제외 (폴더 소속이 남아 있어도)
        return notebooks.filter(n=>ids.indexOf(noteFolder(n.id))>=0 && !isTrashed(n.id)).length;
    }
    function folderDirectCount(fid){ return notebooks.filter(n=>noteFolder(n.id)===fid && !isTrashed(n.id)).length; }
    function enterSelectMode(id){ selectMode=true; selectedNBs.clear(); selectedNBs.add(id);
        document.getElementById('mainView').classList.add('select-mode'); updateSelUI(); renderGrid(); }
    function toggleSelectNB(id,card){
        if(selectedNBs.has(id)){selectedNBs.delete(id);card.classList.remove('selected');}
        else{selectedNBs.add(id);card.classList.add('selected');}
        updateSelUI(); if(!selectedNBs.size) cancelSelect();
    }
    function updateSelUI(){
        document.getElementById('selectedCount2').textContent=selectedNBs.size;
        document.getElementById('selectBar').classList.toggle('show',selectMode&&selectedNBs.size>0);
    }
    function cancelSelect(){
        selectMode=false; selectedNBs.clear();
        document.getElementById('mainView').classList.remove('select-mode');
        document.getElementById('selectBar').classList.remove('show'); renderGrid();
    }
    function makeFolderFromSelection(){
        if(!selectedNBs.size){ toast('노트를 선택하세요'); return; }
        const name=prompt(`${selectedNBs.size}개 노트를 담을 폴더 이름`,'새 폴더');
        if(!name||!name.trim()) return;
        const f=createFolder(name.trim(),Array.from(selectedNBs));
        cancelSelect(); renderGrid();
        playFolderCreateAnim(f.id);
        toast(`'${f.name}' 폴더 생성됨 (${folderCount(f.id)}개)`);
    }

    function openMoveFolderMenu(ev){
        ev.stopPropagation();
        if(!selectedNBs.size){ toast('노트를 선택하세요'); return; }
        const fs=getFolders();
        const m=document.getElementById('ctxMenu');
        let html=`<div class="ctx-item" onclick="moveSelectedTo(null)"><i class="ri-home-4-line"></i> 전체 노트(폴더 밖)</div>`;
        if(fs.length) html+='<div class="ctx-sep"></div>';
        // 계층 순서대로 (들여쓰기로 깊이 표시) — 휴지통은 이동 대상에서 제외
        const walk=(pid,depth)=>{
            childFolders(pid).forEach(f=>{
                if(f.trash) return;
                const lk=isFolderLocked(f.id)&&!isFolderOpen(f.id);
                html+=`<div class="ctx-item" onclick="moveSelectedTo('${f.id}')" `+
                      `style="padding-left:${11+depth*13}px;${lk?'opacity:.5;':''}">`+
                      `<i class="${lk?'ri-folder-lock-fill':(f.icon||'ri-folder-3-fill')}" `+
                      `style="color:${f.color||'var(--accent)'}"></i> ${esc(f.name)}${lk?' 🔒':''}</div>`;
                walk(f.id,depth+1);
            });
        };
        walk(null,0);
        html+=`<div class="ctx-sep"></div><div class="ctx-item" onclick="makeFolderFromSelection()"><i class="ri-folder-add-line"></i> 새 폴더 만들기…</div>`;
        m.innerHTML=html;
        m.classList.add('show');
        const r=ev.currentTarget.getBoundingClientRect();
        m.style.left=Math.min(r.left,window.innerWidth-220)+'px';
        m.style.top=Math.max(10,r.top-Math.min(320,m.offsetHeight+10))+'px';
    }
    // 폴더 자체를 다른 폴더 안으로 옮긴다 (순환은 막는다)
    function openFolderMoveMenu(ev,fid){
        if(ev){ ev.stopPropagation(); }   // 클릭 버블링으로 메뉴가 즉시 닫히는 것 방지
        const m=document.getElementById('ctxMenu');
        const me=getFolders().find(f=>f.id===fid);
        let html=`<div class="ctx-item" onclick="doMoveFolder('${fid}',null)">`+
                 `<i class="ri-home-4-line"></i> 최상위로 꺼내기</div>`;
        const cand=getFolders().filter(f=>!f.trashed_at&&f.id!==fid&&!isDescendant(f.id,fid));
        if(cand.length) html+='<div class="ctx-sep"></div>';
        cand.forEach(f=>{
            const depth=folderPath(f.id).length-1;
            html+=`<div class="ctx-item" onclick="doMoveFolder('${fid}','${f.id}')" `+
                  `style="padding-left:${11+depth*12}px">`+
                  `<i class="${f.icon||'ri-folder-3-fill'}" style="color:${f.color||'var(--accent)'}"></i> ${esc(f.name)}</div>`;
        });
        if(!cand.length) html+=`<div class="ctx-item" style="opacity:.5;pointer-events:none">옮길 폴더가 없습니다</div>`;
        m.innerHTML=html;
        m.classList.add('show');
        const x=window.sdyUiCss((ev&&ev.clientX)||lastMouse.clientX||120);
        const y=window.sdyUiCss((ev&&ev.clientY)||lastMouse.clientY||120);
        m.style.left=Math.min(x,window.sdyUiCss(window.innerWidth)-230)+'px';
        m.style.top=Math.min(y,window.sdyUiCss(window.innerHeight)-(m.offsetHeight||260)-8)+'px';
    }
    function doMoveFolder(fid,pid){
        closeCtxMenu();
        // 9.3 · 잠긴 폴더는 옮길 수 없다 (잠금을 먼저 풀어야 한다)
        if(isFolderLocked(fid)&&!isFolderOpen(fid)){
            toast('🔒 잠긴 폴더는 옮길 수 없습니다. 먼저 잠금을 해제하세요',2600); return;
        }
        // 잠긴 폴더 '안으로' 넣는 것도 막는다
        if(pid&&!isFolderOpen(pid)){
            toast('🔒 잠긴 폴더에는 넣을 수 없습니다',2000); return;
        }
        // 순환/자기 자신 이동은 미리 막는다 (집게 애니메이션 없이 안내만)
        if(pid && (pid===fid || isDescendant(pid,fid))){
            toast('그 폴더 안으로는 넣을 수 없습니다',2000); return;
        }
        const fc=document.querySelector('.folder-card[data-folder-id="'+fid+'"]');
        const finish=()=>{
            if(!setFolderParent(fid,pid)){
                toast('그 폴더 안으로는 넣을 수 없습니다',2000); return;
            }
            renderGrid();
            const nm=pid?(getFolders().find(f=>f.id===pid)||{}).name:'최상위';
            toast(`'${nm}' 로 옮겼습니다`,1800);
        };
        if(!fc){ finish(); return; }
        if(pid){
            // 다른 폴더 안으로 → 집게가 집어서 그 폴더에 넣는다
            const dest=document.querySelector('.folder-card[data-folder-id="'+pid+'"]');
            if(dest) playClawToFolderMulti([fc], dest, finish);
            else finish();
        }else{
            // 최상위로 꺼내기 → 집게가 집어서 던져 올린다
            playClawThrow(fc, finish);
        }
    }
    function moveSelectedTo(fid){
        closeCtxMenu();
        if(fid&&!isFolderOpen(fid)){ toast('🔒 잠긴 폴더에는 넣을 수 없습니다',2000); return; }
        const ids=Array.from(selectedNBs);
        const n=ids.length;
        const nm=fid?(getFolders().find(f=>f.id===fid)||{}).name:'전체 노트';
        const finish=()=>{
            ids.forEach(id=>setNoteFolder(id,fid));
            cancelSelect(); renderGrid();
            toast(`${n}개 노트를 '${nm}' 로 이동`);
        };
        animateMoveLocal(ids, fid, finish);
    }

    async function delSelectedNBs(){
        if(!selectedNBs.size) return;
        const all=Array.from(selectedNBs);
        const locked=adminMode?[]:all.filter(id=>isLocked(id)&&!isUnlocked(id));
        const target=adminMode?all:all.filter(id=>!(isLocked(id)&&!isUnlocked(id)));
        if(!target.length){
            toast(`🔒 선택한 ${locked.length}개가 모두 잠겨 있어 삭제할 수 없습니다`,2600); return;
        }
        const n=target.length;
        const msg = locked.length
            ? `${n}개의 노트를 휴지통으로 이동하시겠습니까?\n(잠긴 노트 ${locked.length}개는 제외됩니다)`
            : `${n}개의 노트를 휴지통으로 이동하시겠습니까?`;
        if(!confirm(msg)) return;
        // 선택한 모든 노트의 실제 카드를 찾아 다중 뽑기 기계로 한꺼번에 던진다
        const _cards=target.map(id=>document.querySelector('.note-card[data-nb-id="'+id+'"]'));
        playClawThrowMulti(_cards, ()=>{
            for(const id of target) moveToTrash(id);
            cancelSelect();
            toast(locked.length?`${n}개 처리됨 (잠긴 ${locked.length}개 유지)`:`${n}개 노트를 휴지통으로 이동`);
        });
    }
    function saveLocalNBs(){
        localStorage.setItem('sdy_local_nbs',JSON.stringify(sortNBs(notebooks.filter(n=>String(n.id).startsWith('local_')))));
    }

    function renderSizePresetGrid(){
        const grid=document.getElementById('sizePresetGrid'); grid.innerHTML='';
        Object.entries(SIZE_PRESETS).forEach(([k,p])=>{
            const r=p.w/p.h;
            const tw=r>=1?60:Math.max(24,Math.round(60*r));
            const th=r>=1?Math.max(24,Math.round(60/r)):60;
            const b=document.createElement('button');
            b.className='size-preset-card';
            b.innerHTML=`<div class="size-preset-thumb" style="width:${tw}px;height:${th}px;"></div><div style="font-size:13px;font-weight:600;">${p.label}</div>`;
            b.onclick=()=>createNB(k);
            grid.appendChild(b);
        });
    }
    function openCreateModal(){ renderSizePresetGrid(); document.getElementById('createModal').style.display='flex'; openNav(closeCreateModal); }
    // 새 노트 모달에서 폴더 만들기
    function createFolderFromModal(){
        closeCreateModal();
        const name=prompt('새 폴더 이름','새 폴더');
        if(name===null) return;
        const nf=createFolder((name||'').trim()||'새 폴더', []);
        renderGrid();
        playFolderCreateAnim(nf.id);
        toast(`'${nf.name}' 폴더를 만들었습니다`,1800);
    }
    function closeCreateModal(){ document.getElementById('createModal').style.display='none'; navDrop(closeCreateModal); }
    // 폴더 생성 애니메이션: 새 폴더 카드가 놓인 자리에 뽑기 기계가 폴더를 내려놓는다
    function playFolderCreateAnim(fid){
        setTimeout(()=>{
            const fc=document.querySelector('.folder-card[data-folder-id="'+fid+'"]');
            if(fc) playClawDrop(fc);
        },60);
    }
    // ===== 관리자 키 위탁(escrow) =====
    // 노트를 잠글 때 비밀번호를 '관리자 공개키'로 한 번 더 암호화해 함께 보관한다.
    // 개인키는 관리자 비밀번호로 감싸져 있어, 관리자만 풀어서 노트를 열 수 있다.
    const ADMIN_PUB_SPKI="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5e0mz7qtAZWqq4eW7Y+jax9h4oPr/u1oHg8aYKkWr7URAF8RxS9SvWbaUxUxusGOGr2PsQS1KjiY2QrYi92nsNIcdyeWbu+tL7kbBEtTCb3y8QICVq1S5tDYd9gQWaC1wfRsYeRYH8lq8XXVRFhTnOTMgHv51XqSEBOhv2icT/bTNWN4gvFlfyyXb6bPMPM9SmIL8sCQoyNpnpW4oQ72gQFdppIdt5wRj7H70SdrYEzbmyZmw/a0A+Vf8uNRiYPTET8Bp97KtYXlrd3aKdBzSzERV/keQYx+x+/CgtDqTsW6/75pEapfk3ixV0d4cs4SwtFgaKzAneD58gXZf9/JbQIDAQAB";
    const ADMIN_KEY_SALT="rlXkRnCS9FsQeDUWM9ufDA==";
    const ADMIN_KEY_IV="98EMpINMfMNnzz5S";
    const ADMIN_KEY_WRAPPED="O9mlisbkZrqC311lPG7wALVjjJ6hlYma6rhFeATGBPX3ocDq8xT3i4tcrFAXk6G09Yde218hcYUG1Pjbcf/4ofw9G4y50k69tYecCaEHZR8HlpVH5C+twLwniQcY99GNvzb2QtcNIW6dibUrFMB7tt6TLe7GhMi+OsIv2Xs6NPRANM92WR9TVHO/zxZuAdN54CYZMMRDf15OEp2C63RepGcuLvi+6/fc/fkqgC24VUAyZuLWb26poM+zdeQim2DlfSkVE1mJmsh9jNz73cOMQh696HbBoLn/MhaFckGL0fmlc7zeHEtTF6nNAucP51p0ip0W0F+V20yrz+5p2V2BjjGNS/T3h6IvjRGN1ND8Vd9tmHz2CoEBacoo2hLO5IfIbcFNYU9wZiJgRBXo790125nuwfQwnrFk2XmGa7+q+DggacaqoYdLJr0K4kyVpkbOtPrMprFgjj9oKYRJU1fp3OFiUWzLIXwkMRIIZjooYs6g6a25XvMNh5VG7yGxkzAXlNcppLWvNi4DkXdVWVTU/kUf0f3Tml8TAMuVIDOw2i4GdyOa9Seyz7lbdYsyzlLAi1EndhuOcUy77z/n+ChUZhz7A5GeKegXhYlQKDpvqLeKaoPHj4xgi00z/f7mshKVmFciiTFI3mfPkf1zFfTId8Yky1Mh9ulWA30h5IiY45FoHYDYDvjERd0M/dW3ejjcNfgVBU7fwB5wqgXOObj860EEyhurP1wv0m9V/kY2BxZt9DirQJoK/VS2g7SxHaFwIuzSLnMDXL3IgYgvtmz+QBn/LTVRhbcK0CrrznTPiMok3TU75RF80Fepo0CmItEkVjmyYCnhfx7qTaPhZGCe1ZLtUDyru3nQBI2TVRLxjFdDTondOoT41RS7rAtm5EnJykqb+1QpeSMohSttiDwi6gMTJTALVfb6486hWU5j6X+KNnoyA1Ku6zO4uOQV1z00fxxjrPOX+9yqdAH4goZavjS8y3nDpifzUMcDJmwTRMmxcNcznaeu4/GrgACt21jlDpbyZynS0fnysi2xRX+sG+8ohtfuXnDrqWocarBxdxeII1+Gx4QWu9HSkzaVx97GdeEcOGCD/C8uzWZ0RIQQ7j0czbPP5wdmUKXV76kN6HTs+L0Arthx3A1dXnIHofsCDPbfCn5Fm6ys/4i48LcYckiVtxJxBTIrDmXm3U1UAZQlW+1fhrKJB21OB52ISVAj3fW9dBMhuOwqN/PD4oHLhCwG2G+5uVMdA2+psBsWu7ngD/qo4pGz8DjIeUebxO0LNl6hOsrMtR1K+v1fnh60hiPtNaRaB45H5M9/DhyrD0xFwgxM4DnADkvexvmDnqaASJktE4LlY93QRHIUE6zdGQ5IxD5X4cy6Cy6HBYb3DczQ+RjjXfId/DGpW5eh8x/r9mnrpXlHO0kKaXkyx8ZgGV8oVI96Lz0UhADC/dbGOvZRIPjZDGKy32zQO8VOqlOjLZCTftYJMeuf1AQWQLd4d+Cdi906X4pNJUgF+N2rcTZdxL+9HJWoax42kBU3pUI814LHzHMXuGMJjyspn70lmhCns9htXEgwUumEV0GpL8UTp4moIyEhmhnbequtj5SX/Tqgutnv7lbSiO4KbAU9OM+DvT3U6sojAygW98Wz0Q==";

    let adminPrivKey=null;      // 로그인 중에만 메모리에 존재

    async function importAdminPub(){
        return crypto.subtle.importKey('spki',unb64(ADMIN_PUB_SPKI),
            {name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    }
    // 잠금 비밀번호 봉인: 6.4 부터 서버 마스터키 방식 우선(누구나 봉인 가능),
    // 서버 연결이 없으면 오프라인 폴백으로 관리자 공개키(RSA) 봉인.
    async function makeEscrow(pw){
        try{
            const r=await fetch('/api/escrow/wrap',{method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({pw})});
            const d=await r.json().catch(()=>({}));
            if(d&&d.ok&&d.blob) return d.blob;
        }catch(e){}
        try{
            const pub=await importAdminPub();
            const ct=await crypto.subtle.encrypt({name:'RSA-OAEP'},pub,te.encode(pw));
            return b64(ct);
        }catch(e){ console.warn('escrow 생성 실패',e); return null; }
    }
    // 관리자 비밀번호로 개인키를 복원
    async function unwrapAdminKey(pw){
        const base=await crypto.subtle.importKey('raw',te.encode(pw),'PBKDF2',false,['deriveKey']);
        const wk=await crypto.subtle.deriveKey(
            {name:'PBKDF2',salt:unb64(ADMIN_KEY_SALT),iterations:PBKDF2_ITER,hash:'SHA-256'},
            base,{name:'AES-GCM',length:256},false,['decrypt']);
        const pkcs8=await crypto.subtle.decrypt(
            {name:'AES-GCM',iv:unb64(ADMIN_KEY_IV)},wk,unb64(ADMIN_KEY_WRAPPED));
        return crypto.subtle.importKey('pkcs8',pkcs8,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
    }
    // 봉인된 비밀번호 되찾기: S2(서버 마스터키)는 관리자 세션으로, 옛 RSA 봉인은 개인키로.
    async function recoverPw(esc){
        if(!esc) return null;
        if(String(esc).indexOf('S2:')===0){
            if(!adminMode) return null;
            try{
                const r=await fetch('/api/escrow/unwrap',{method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({blob:esc,token:adminToken||undefined})});
                const d=await r.json().catch(()=>({}));
                if(d&&d.ok&&d.pw) return d.pw;
            }catch(e){}
            return null;
        }
        if(!adminPrivKey) return null;
        try{
            const pt=await crypto.subtle.decrypt({name:'RSA-OAEP'},adminPrivKey,unb64(esc));
            return td.decode(pt);
        }catch(e){ return null; }
    }

    // 관리자 권한으로 노트 잠금 열기 (비번 없이)
    // 관리자는 모든 노트를 열 수 있어야 한다. 다만 '진짜 암호문'만은
    // 비밀번호 없이 수학적으로 복호화할 수 없으므로 그 경우만 예외.
    async function adminUnlockNote(nbId){
        if(!adminMode) return false;
        if(sessionKeys.has(nbId)) return true;
        const cfg=getCfg(nbId);
        if(!cfg.lock||!cfg.lock.salt) return true;

        // ① 위탁(escrow) 이 있으면 비밀번호를 복원해서 정상적으로 연다
        const pw=await recoverPw(cfg.lock.escrow);
        if(pw){
            try{
                const key=await deriveKey(pw,unb64(cfg.lock.salt));
                if(cfg.encBlob) await decryptDoc(cfg.encBlob,key);   // 검증
                sessionKeys.set(nbId,key);
                adminOpenedNotes.add(nbId);
                return true;
            }catch(e){ /* 아래 경로로 계속 */ }
        }

        // ② 위탁이 없는 옛 노트라도 본문이 암호문이 아니면(=평문 pages)
        //    잠금 표시만 있는 것이므로 관리자에게는 열어 준다.
        if(!cfg.encBlob){
            adminOpenedNotes.add(nbId);
            adminPlainUnlocked.add(nbId);   // 세션 키 없이 열린 상태
            return true;
        }

        // ②-2 (6.2) 구버전: 암호문이 남아 있더라도 평문 본문이 로컬/서버에
        //      남아 있으면 관리자 권한으로 복원해서 연다.
        const rec=await recoverPlain(nbId,cfg);
        if(rec){
            decCache.set(nbId,rec);
            adminOpenedNotes.add(nbId);
            adminPlainUnlocked.add(nbId);
            return true;
        }

        // ③ 여기까지 오면 비밀번호로만 풀 수 있는 진짜 암호문이다
        return false;
    }
    // 구버전 평문 본문 복원: ① 로컬 cfg.pages  ② 서버(Supabase) memo 본문
    async function recoverPlain(nbId,cfg){
        try{
            if(Array.isArray(cfg.pages)&&cfg.pages.some(p=>((p.els||[]).length)||((p.tables||[]).length))){
                return migrate(cfg,nbId);
            }
        }catch(e){}
        try{
            if(typeof SB!=='undefined'&&SB){
                const {data}=await SB.from('memos').select('content')
                    .eq('notebook_id',nbId).limit(1);
                const c=data&&data[0]&&data[0].content;
                if(c){
                    const st=JSON.parse(c);
                    if(st&&!st.encBlob&&Array.isArray(st.pages)
                       &&st.pages.some(p=>((p.els||[]).length)||((p.tables||[]).length))){
                        return {paper:st.paper||cfg.paper||'blank',
                                sizePreset:st.sizePreset||cfg.sizePreset||'a4_portrait',
                                emoji:st.emoji||'', glossary:st.glossary||{},
                                pages:st.pages};
                    }
                }
            }
        }catch(e){}
        return null;
    }
    // 관리자 권한으로 모든 잠긴 노트 열기
    async function adminUnlockAll(){
        if(!adminMode) return {ok:0,fail:0};
        let okc=0,fail=0;
        for(const nb of notebooks){
            if(!isLocked(nb.id)||isUnlocked(nb.id)) continue;
            if(await adminUnlockNote(nb.id)){
                okc++;
                try{
                    // 평문 잠금 노트는 cfg.pages 를 그대로 읽어 온다
                    const d=adminPlainUnlocked.has(nb.id)
                          ? migrate(getCfg(nb.id),nb.id)
                          : await loadDocAsync(nb.id);
                    if(d) decCache.set(nb.id,d);
                }catch(e){}
            }else fail++;
        }
        if(fail>0) toast(`⚠️ 잠긴 노트 ${fail}개는 위탁 정보가 없어 열지 못했습니다. 열어서 비밀번호를 한 번 입력하면 관리자 권한이 등록됩니다`,5000);
        return {ok:okc,fail};
    }


/* APP-PART:02e-folders.js:END */
