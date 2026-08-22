// 핀 버그 수정안 검증: 수정 후 시뮬레이션
//  - _stNow(): Date.now()+Math.random() (기기 간 rev 충돌 제거)
//  - pullSettings: since=0 전체 pull + _stApplied 워터마크 (시계 느린 기기의 op도 수신)

const clone2 = (x) => JSON.parse(JSON.stringify(x));
function canonFolder(f) {
  const o = {};
  ['id','name','color','icon','parent','created_at','order'].forEach(k => { if (f[k] !== undefined) o[k] = f[k]; });
  Object.keys(f).sort().forEach(k => { if (o[k] === undefined) o[k] = f[k]; });
  return o;
}
class Device {
  constructor(name, dev, clockSkew=0) { this.name=name; this.dev=dev; this.skew=clockSkew;
    this.folders=[]; this.cfgs=new Map(); this.notebooks=[]; this.stHash=new Map();
    this.stLocalRev=new Map(); this.stApplied=new Map(); this.stOut=new Map();
    this.stRev=0; this.stCacheReset=true; this.tombstones={folders:{}}; }
  now(){ return Date.now()+this.skew; }
  getCfg(id){ return this.cfgs.get(id)||{}; } setCfg(id,c){ this.cfgs.set(id,c); }
  folderById(fid){ return this.folders.find(f=>f.id===fid)||null; }
  setFolders(fs){ this.folders=fs; }
  stNow(){ this.stRev=Math.max(this.stRev+1, this.now()+Math.random()); return this.stRev; }
  stQueueOp(id,kind,data){ const op={id,kind,rev:this.stNow(),dev:this.dev}; if(kind!=='del') op.data=data;
    this.stOut.set(id,op); this.stLocalRev.set(id,op.rev); }
  canonKeys(){
    const out={}; const seen=new Set();
    this.folders.forEach(f=>{ if(!f||!f.id) return; const k='folder:'+f.id; seen.add(k); out[k]=canonFolder(f); });
    Object.keys(this.tombstones.folders).forEach(id=>{ const k='folder:'+id; if(!seen.has(k)){ seen.add(k); out[k]=null; } });
    const ids=new Set(this.notebooks.map(n=>n.id));
    this.cfgs.forEach((c,id)=>ids.add(id));
    ids.forEach(id=>{ const c=this.getCfg(id);
      out['member:'+id]=c.folder||null; out['trash:'+id]=c.trashed_at||null; out['pin:'+id]=c.pinned?true:null; });
    return out;
  }
  stDiff(){ const cur=this.canonKeys(); const ops=[]; const seen=new Set();
    for(const k in cur){ seen.add(k); const v=cur[k];
      if(v===null){ if(this.stHash.has(k)&&this.stHash.get(k)!==null) ops.push({id:k,kind:'del'}); }
      else { if(this.stHash.get(k)!==JSON.stringify(v)) ops.push({id:k,kind:'put',data:v}); } }
    for(const [k,v] of this.stHash.entries()){ if(!seen.has(k)&&v!==null) ops.push({id:k,kind:'del'}); }
    return ops; }
  stHashVal(op){ const k=op.id||'';
    if(!op.del&&k.indexOf('folder:')===0){ const f=this.folderById(k.slice(7)); if(f) return JSON.stringify(canonFolder(f)); }
    return JSON.stringify(op.data); }
  stApply(op){ const k=op.id; if(op.del) return this.stApplyDel(k); const d=op.data;
    if(k.indexOf('folder:')===0){ const fid=k.slice(7); if(this.tombstones.folders[fid]) return false;
      const fs=this.folders; const idx=fs.findIndex(f=>f.id===fid); const f=Object.assign({},d);
      if(idx>=0){ const old=fs[idx]; if(old&&old.lock&&old.lock.verifier&&!f.lock&&!d.lockCleared) f.lock=old.lock; }
      if(idx>=0) fs[idx]=f; else fs.push(f); return true; }
    if(k.indexOf('pin:')===0){ const nbId=k.slice(4); const c=this.getCfg(nbId); const want=!!d;
      if(!!c.pinned===want) return false; if(want) c.pinned=true; else delete c.pinned; this.setCfg(nbId,c); return true; }
    if(k.indexOf('member:')===0){ const nbId=k.slice(7); const fid=(typeof d==='string'&&d)?d:null;
      const c=this.getCfg(nbId); if((c.folder||null)===fid) return false; if(fid) c.folder=fid; else delete c.folder; this.setCfg(nbId,c); return true; }
    return false; }
  stApplyDel(k){ if(k.indexOf('folder:')===0){ const fid=k.slice(7); const fs=this.folders;
      const idx=fs.findIndex(f=>f.id===fid); if(idx<0) return false; fs.splice(idx,1); this.tombstones.folders[fid]=true; return true; }
    return false; }
}
class Server {
  constructor(){ this.els=new Map(); this.version=0; }
  push(nb,ops){ const accepted=[],rejected=[];
    for(const op of ops){ const oid=String(op.id||''); const rev=parseFloat(op.rev||0);
      const cur=this.els.get(oid); if(cur&&parseFloat(cur.rev||0)>=rev){ rejected.push(oid); continue; }
      if(op.kind==='del') this.els.set(oid,{rev,del:1}); else this.els.set(oid,{rev,data:op.data}); accepted.push(oid); }
    let ver=0; for(const v of this.els.values()) ver=Math.max(ver,parseFloat(v.rev||0)); this.version=ver;
    return {ok:true,version:ver,accepted,rejected}; }
  pull(since){ const ops=[]; for(const [id,v] of this.els.entries()){ if(parseFloat(v.rev||0)>since) ops.push({id,...v}); }
    return {ok:true,version:this.version,ops:ops.sort((a,b)=>(a.rev||0)-(b.rev||0))}; }
}

function makeEnv(clockSkewB=0) {
  const server=new Server();
  const A=new Device('A','d_A',0);
  const B=new Device('B','d_B',clockSkewB);
  const F1={id:'f1',name:'업무',color:'#4f6ef7',icon:'ri-folder-3-fill',created_at:'2026-01-01T00:00:00Z'};
  const F2={id:'f2',name:'개인',color:'#f76e4f',icon:'ri-folder-3-fill',created_at:'2026-01-02T00:00:00Z'};
  A.setFolders(clone2([F1,F2])); B.setFolders(clone2([F1,F2]));
  A.notebooks=[{id:'n1',title:'N1',created_at:'2026-01-03T00:00:00Z'}];
  B.notebooks=[{id:'n1',title:'N1',created_at:'2026-01-03T00:00:00Z'}];
  const initialSync=(d)=>{ d.stCacheReset=false;
    d.stDiff().forEach(o=>d.stQueueOp(o.id,o.kind,o.data));
    const ops=Array.from(d.stOut.values()).map(o=>({...o}));
    const res=server.push('__settings__',ops);
    for(const o of ops){ if(res.accepted.includes(o.id)){ d.stHash.set(o.id,o.kind==='del'?null:JSON.stringify(o.data)); d.stApplied.set(o.id,o.rev); d.stOut.delete(o.id); d.stLocalRev.delete(o.id); } }
    const pr=server.pull(0); d.stRev=Math.max(d.stRev, pr.version||0);
    for(const op of pr.ops){ const local=d.stLocalRev.get(op.id)||0; if((op.rev||0)<=local) continue;
      const applied=d.stApplied.get(op.id)||0; if((op.rev||0)<=applied) continue;
      d.stApply(op); d.stApplied.set(op.id,op.rev||0); d.stHash.set(op.id,op.del?null:d.stHashVal(op)); }
  };
  initialSync(A); initialSync(B);
  const pushNow=(d)=>{ if(d.stCacheReset) return;
    d.stDiff().forEach(o=>{ const cur=d.stOut.get(o.id);
      const same=cur&&cur.kind===o.kind&&JSON.stringify(cur.data)===JSON.stringify(o.data);
      if(!same) d.stQueueOp(o.id,o.kind,o.data); });
    const ops=Array.from(d.stOut.values()).filter(o=>o&&o.id); if(!ops.length) return;
    const res=server.push('__settings__',ops.map(o=>({...o})));
    for(const o of ops){ if(res.accepted.includes(o.id)&&d.stOut.get(o.id)&&d.stOut.get(o.id).rev===o.rev){
        d.stOut.delete(o.id); d.stLocalRev.delete(o.id); d.stApplied.set(o.id,o.rev); d.stHash.set(o.id,o.kind==='del'?null:JSON.stringify(o.data)); }
      if(res.rejected.includes(o.id)&&d.stOut.get(o.id)&&d.stOut.get(o.id).rev===o.rev){ d.stOut.delete(o.id); d.stLocalRev.delete(o.id); } }
  };
  const pullNow=(d)=>{ const res=server.pull(0); d.stCacheReset=false; d.stRev=Math.max(d.stRev, res.version||0);
    for(const op of res.ops){ const local=d.stLocalRev.get(op.id)||0; if((op.rev||0)<=local) continue;
      const applied=d.stApplied.get(op.id)||0; if((op.rev||0)<=applied) continue;
      if(local) d.stOut.delete(op.id);
      d.stApply(op); d.stApplied.set(op.id,op.rev||0); d.stHash.set(op.id,op.del?null:d.stHashVal(op)); } };
  return { server, A, B, pushNow, pullNow,
    rename:(d,fid,name)=>{ const t=d.folderById(fid); t.name=name; pushNow(d); },
    pin:(d,id)=>{ const c=d.getCfg(id); c.pinned=!c.pinned; d.setCfg(id,c); pushNow(d); } };
}

let fails=0;
function check(label, env, act) {
  act(env);
  env.pullNow(env.B); env.pullNow(env.A);
  const a=env.A.folders.map(f=>f.id+':'+f.name).sort().join('|');
  const b=env.B.folders.map(f=>f.id+':'+f.name).sort().join('|');
  const ok=a===b;
  console.log(`${ok?'✓':'✗'} ${label}\n     A=${a}\n     B=${b}`);
  if(!ok) fails++;
}

// 1) 동시 rename (같은 ms) — 수정 전엔 발산했던 케이스
check('동시 rename(다른 폴더) 수렴', makeEnv(), ({A,B,rename})=>{ rename(A,'f1','일'); rename(B,'f2','취미'); });
// 2) B 시계가 3000ms 느림 — 수정 전엔 B의 rename이 영영 안 보였을 케이스
check('느린 시계 기기의 rename 수신', makeEnv(0), ({A,B,rename,pullNow})=>{ pullNow(B); rename(B,'f2','취미'); });
check('느린 시계 기기의 rename 수신(실제 skew)', makeEnv(-3000), ({B,rename})=>{ rename(B,'f2','취미'); });
// 3) A가 rename + B가(미수신) 핀
check('A rename + B 핀(미수신)', makeEnv(), ({A,B,rename,pin})=>{ rename(A,'f1','일'); pin(B,'n1'); });
// 4) 새 폴더를 느린 시계 기기가 생성
{
  const env=makeEnv(-5000);
  const {B}=env;
  B.folders.push({id:'f3',name:'느림기기폴더',color:'#4f6ef7',icon:'ri-folder-3-fill',created_at:'2026-01-04T00:00:00Z'});
  env.pushNow(B);
  check('느린 시계 기기의 새 폴더 생성 전파', env, ()=>{});
}
console.log(fails?`\n${fails}개 실패`:'\n모두 통과');
