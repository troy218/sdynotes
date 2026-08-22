// 두 기기 설정 동기화 시뮬레이션 — 핀 버그(폴더 이름 스왑) 재현 시도
// 실제 sdynotes.html 의 _stDiff/_stKeys/_canonFolder/_stApply/_stHashVal 를
// 그대로 포팅하여, 서버 LWW 스토어와 함께 동작시킨다.

const clone = (x) => JSON.parse(JSON.stringify(x));

function canonFolder(f) {
  const o = {};
  ['id','name','color','icon','parent','created_at','order'].forEach(k => {
    if (f[k] !== undefined) o[k] = f[k];
  });
  Object.keys(f).sort().forEach(k => { if (o[k] === undefined) o[k] = f[k]; });
  return o;
}

class Device {
  constructor(name, dev) {
    this.name = name;
    this.dev = dev;
    this.folders = [];
    this.cfgs = new Map();       // id -> cfg object
    this.notebooks = [];         // [{id,title,created_at}]
    this.stHash = new Map();     // key -> string|null
    this.stLocalRev = new Map(); // key -> rev
    this.stOut = new Map();      // key -> {id,kind,rev,data}
    this.stRev = 1000;
    this.stSince = 0;
    this.stCacheReset = true;
    this.tombstones = { folders: {} };
  }
  getFolders() { return this.folders; }
  setFolders(fs) { this.folders = fs; }
  getCfg(id) { return this.cfgs.get(id) || {}; }
  setCfg(id, c) { this.cfgs.set(id, c); }
  folderById(fid) { return this.folders.find(f => f.id === fid) || null; }

  stNow() { this.stRev = Math.max(this.stRev + 1, Date.now() % 1e13); return this.stRev; }

  canonKeys() {
    const out = {}; const seen = new Set();
    this.folders.forEach(f => {
      if (!f || !f.id) return;
      const k = 'folder:' + f.id; seen.add(k);
      out[k] = canonFolder(f);
    });
    Object.keys(this.tombstones.folders).forEach(id => {
      const k = 'folder:' + id;
      if (!seen.has(k)) { seen.add(k); out[k] = null; }
    });
    const ids = new Set(this.notebooks.map(n => n.id));
    this.cfgs.forEach((c, id) => ids.add(id));
    ids.forEach(id => {
      const c = this.getCfg(id);
      out['member:' + id] = c.folder || null;
      out['trash:' + id] = c.trashed_at || null;
      out['pin:' + id] = c.pinned ? true : null;
      out['emoji:' + id] = c.emoji || null;
      const ns = {};
      if (c.paper && c.paper !== 'blank') ns.paper = c.paper;
      if (c.sizePreset && c.sizePreset !== 'a4_portrait') ns.sizePreset = c.sizePreset;
      if (c.tint) ns.tint = c.tint;
      if (Array.isArray(c.favPages) && c.favPages.length) ns.favPages = c.favPages;
      if (c.glossary && Object.keys(c.glossary).length) ns.glossary = c.glossary;
      out['nset:' + id] = Object.keys(ns).length ? ns : null;
    });
    return out;
  }

  stDiff() {
    const cur = this.canonKeys(); const ops = []; const seen = new Set();
    for (const k in cur) {
      seen.add(k); const v = cur[k];
      if (v === null) {
        if (this.stHash.has(k) && this.stHash.get(k) !== null) ops.push({ id: k, kind: 'del' });
      } else {
        if (this.stHash.get(k) !== JSON.stringify(v)) ops.push({ id: k, kind: 'put', data: v });
      }
    }
    for (const [k, v] of this.stHash.entries()) {
      if (!seen.has(k) && v !== null) ops.push({ id: k, kind: 'del' });
    }
    return ops;
  }

  stQueueOp(id, kind, data) {
    const op = { id, kind, rev: this.stNow(), dev: this.dev };
    if (kind !== 'del') op.data = data;
    this.stOut.set(id, op); this.stLocalRev.set(id, op.rev);
  }

  stHashVal(op) {
    const k = op.id || '';
    if (!op.del && k.indexOf('folder:') === 0) {
      const f = this.folderById(k.slice(7));
      if (f) return JSON.stringify(canonFolder(f));
    }
    return JSON.stringify(op.data);
  }

  stApply(op) {
    const k = op.id;
    if (op.del) return this.stApplyDel(k);
    const d = op.data;
    if (k.indexOf('folder:') === 0) {
      const fid = k.slice(7);
      if (this.tombstones.folders[fid]) return false;
      const fs = this.folders;
      const idx = fs.findIndex(f => f.id === fid);
      const f = Object.assign({}, d);
      if (idx >= 0) {
        const old = fs[idx];
        if (old && old.lock && old.lock.verifier && !f.lock && !d.lockCleared) f.lock = old.lock;
      }
      if (idx >= 0) fs[idx] = f; else fs.push(f);
      return true;
    }
    if (k.indexOf('member:') === 0) {
      const nbId = k.slice(7);
      const fid = (typeof d === 'string' && d) ? d : null;
      const c = this.getCfg(nbId);
      if ((c.folder || null) === fid) return false;
      if (fid) c.folder = fid; else delete c.folder;
      this.setCfg(nbId, c); return true;
    }
    if (k.indexOf('trash:') === 0) {
      const nbId = k.slice(6);
      const ts = (typeof d === 'number') ? d : null;
      const c = this.getCfg(nbId);
      if ((c.trashed_at || null) === ts) return false;
      if (ts) c.trashed_at = ts; else delete c.trashed_at;
      this.setCfg(nbId, c); return true;
    }
    if (k.indexOf('pin:') === 0) {
      const nbId = k.slice(4);
      const c = this.getCfg(nbId);
      const want = !!d;
      if (!!c.pinned === want) return false;
      if (want) c.pinned = true; else delete c.pinned;
      this.setCfg(nbId, c); return true;
    }
    return false;
  }

  stApplyDel(k) {
    if (k.indexOf('folder:') === 0) {
      const fid = k.slice(7);
      const fs = this.folders;
      const idx = fs.findIndex(f => f.id === fid);
      if (idx < 0) return false;
      fs.splice(idx, 1);
      this.tombstones.folders[fid] = true;
      return true;
    }
    if (k.indexOf('member:') === 0) {
      const c = this.getCfg(k.slice(7));
      if (!c.folder) return false;
      delete c.folder; this.setCfg(k.slice(7), c); return true;
    }
    if (k.indexOf('trash:') === 0) {
      const c = this.getCfg(k.slice(6));
      if (!c.trashed_at) return false;
      delete c.trashed_at; this.setCfg(k.slice(6), c); return true;
    }
    if (k.indexOf('pin:') === 0) {
      const c = this.getCfg(k.slice(4));
      if (!c.pinned) return false;
      delete c.pinned; this.setCfg(k.slice(4), c); return true;
    }
    return false;
  }
}

class Server {
  constructor() { this.els = new Map(); this.version = 0; }
  push(nb, ops) {
    const accepted = [], rejected = [];
    for (const op of ops) {
      const oid = String(op.id || '');
      const rev = parseFloat(op.rev || 0);
      const cur = this.els.get(oid);
      if (cur && parseFloat(cur.rev || 0) >= rev) { rejected.push(oid); continue; }
      if (op.kind === 'del') this.els.set(oid, { rev, del: 1 });
      else this.els.set(oid, { rev, data: op.data });
      accepted.push(oid);
    }
    let ver = 0;
    for (const v of this.els.values()) ver = Math.max(ver, parseFloat(v.rev || 0));
    this.version = ver;
    return { ok: true, version: ver, accepted, rejected, blocked: [] };
  }
  pull(since) {
    const ops = [];
    for (const [id, v] of this.els.entries()) {
      if (parseFloat(v.rev || 0) > since) ops.push({ id, ...v });
    }
    return { ok: true, version: this.version, ops: ops.sort((a, b) => (a.rev || 0) - (b.rev || 0)) };
  }
}

function folderNames(d) {
  return d.folders.map(f => `${f.id}:${f.name}`).sort().join(' | ');
}

// ── 시나리오 ──
function runScenario(label, setup, steps) {
  const server = new Server();
  const A = new Device('A', 'd_A');
  const B = new Device('B', 'd_B');
  setup(A, B);
  // 초기 동기화: 두 기기의 초기 상태를 서버로 올리고 서로 받는다
  const devices = [A, B];
  const initialSync = (d) => {
    d.stCacheReset = false;
    const ops = d.stDiff();
    ops.forEach(o => d.stQueueOp(o.id, o.kind, o.data));
    server.push('__settings__', Array.from(d.stOut.values()).map(o => ({ ...o })));
    // accepted → hash
    for (const o of d.stOut.values()) {
      d.stHash.set(o.id, o.kind === 'del' ? null : JSON.stringify(o.data));
      d.stOut.delete(o.id);
    }
    // pull
    const res = server.pull(d.stSince);
    for (const op of res.ops) {
      const local = d.stLocalRev.get(op.id) || 0;
      if ((op.rev || 0) <= local) continue;
      d.stApply(op);
      d.stHash.set(op.id, op.del ? null : d.stHashVal(op));
    }
    d.stSince = res.version;
  };
  initialSync(A); initialSync(B);

  const pushNow = (d) => {
    if (d.stCacheReset) return;
    const diffs = d.stDiff();
    diffs.forEach(o => {
      const cur = d.stOut.get(o.id);
      const same = cur && cur.kind === o.kind && JSON.stringify(cur.data) === JSON.stringify(o.data);
      if (!same) d.stQueueOp(o.id, o.kind, o.data);
    });
    const ops = Array.from(d.stOut.values()).filter(o => o && o.id);
    if (!ops.length) return;
    const res = server.push('__settings__', ops.map(o => ({ ...o })));
    const accepted = new Set(res.accepted || []);
    const rejected = new Set(res.rejected || []);
    for (const o of ops) {
      if (accepted.has(o.id) && d.stOut.get(o.id) && d.stOut.get(o.id).rev === o.rev) {
        d.stOut.delete(o.id); d.stLocalRev.delete(o.id);
        d.stHash.set(o.id, o.kind === 'del' ? null : JSON.stringify(o.data));
      }
      if (rejected.has(o.id) && d.stOut.get(o.id) && d.stOut.get(o.id).rev === o.rev) {
        d.stOut.delete(o.id); d.stLocalRev.delete(o.id);
      }
    }
  };
  const pullNow = (d) => {
    const res = server.pull(d.stSince);
    d.stCacheReset = false;
    for (const op of res.ops) {
      const local = d.stLocalRev.get(op.id) || 0;
      if ((op.rev || 0) <= local) continue;
      if (local) d.stOut.delete(op.id);
      d.stApply(op);
      d.stHash.set(op.id, op.del ? null : d.stHashVal(op));
    }
    d.stSince = res.version;
  };
  const pin = (d, id) => {
    const c = d.getCfg(id);
    c.pinned = !c.pinned;
    d.setCfg(id, c);
    pushNow(d);
  };
  const rename = (d, fid, name) => {
    const t = d.folderById(fid);
    t.name = name;
    pushNow(d);
  };

  const result = steps({ A, B, server, pushNow, pullNow, pin, rename });
  const a = folderNames(A), b = folderNames(B);
  console.log(`── ${label} ──`);
  console.log(`  A: ${a}`);
  console.log(`  B: ${b}`);
  const pass = a === b && !/undefined|:일|:개인/g.test(`${a} ${b}`.replace(/f1:/g,'').replace(/f2:/g,'')) === false;
  return { label, a, b, converge: a === b };
}

const F1 = { id: 'f1', name: '업무', color: '#4f6ef7', icon: 'ri-folder-3-fill', created_at: '2026-01-01T00:00:00Z' };
const F2 = { id: 'f2', name: '개인', color: '#f76e4f', icon: 'ri-folder-3-fill', created_at: '2026-01-02T00:00:00Z' };

const scenarios = [];

// 1) 기기 A가 폴더명 변경, 기기 B(미수신)가 노트 핀 → 폴더명 보존?
scenarios.push(runScenario('A가 폴더명 변경 + B가(미수신 상태에서) 핀', (A, B) => {
  A.setFolders(clone([F1, F2])); B.setFolders(clone([F1, F2]));
  A.notebooks = [{ id: 'n1', title: 'N1', created_at: '2026-01-03T00:00:00Z' }];
  B.notebooks = [{ id: 'n1', title: 'N1', created_at: '2026-01-03T00:00:00Z' }];
  A.setCfg('n1', { folder: 'f1' }); B.setCfg('n1', { folder: 'f1' });
}, ({ A, B, rename, pin, pullNow }) => {
  rename(A, 'f1', '일');           // A: f1 → '일' (B는 아직 모름)
  pin(B, 'n1');                    // B: n1 핀 → pushSettingsNow (stale)
  pullNow(B);                      // B가 A의 rename 수신
  pullNow(A);                      // A가 B의 pin 수신
}));

// 2) 동시: A rename f1, B rename f2 → 각자 다른 폴더, 섞이면 안 됨
scenarios.push(runScenario('동시 rename(서로 다른 폴더)', (A, B) => {
  A.setFolders(clone([F1, F2])); B.setFolders(clone([F1, F2]));
  A.notebooks = [{ id: 'n1', title: 'N1', created_at: '2026-01-03T00:00:00Z' }];
  B.notebooks = [{ id: 'n1', title: 'N1', created_at: '2026-01-03T00:00:00Z' }];
}, ({ A, B, rename, pullNow }) => {
  rename(A, 'f1', '일');
  rename(B, 'f2', '취미');
  pullNow(B); pullNow(A);
}));

// 3) 핀만 반복: echo 없이 폴더명 유지되는지
scenarios.push(runScenario('핀만 반복(echo 없어야 함)', (A, B) => {
  A.setFolders(clone([F1, F2])); B.setFolders(clone([F1, F2]));
  A.notebooks = [{ id: 'n1', title: 'N1', created_at: '2026-01-03T00:00:00Z' }];
  B.notebooks = [{ id: 'n1', title: 'N1', created_at: '2026-01-03T00:00:00Z' }];
  A.setCfg('n1', { folder: 'f1' }); B.setCfg('n1', { folder: 'f1' });
}, ({ A, B, pin, pullNow, pushNow }) => {
  pin(B, 'n1');
  pullNow(A);
  // B가 다시 pushSettingsNow 해도 echo(폴더 put)가 나가면 안 됨
  pushNow(B);
  pullNow(A);
}));

for (const s of scenarios) {
  const ok = s.a === s.b;
  console.log(`결과: ${ok ? '✓ 수렴' : '✗ 불일치!'}  (${s.a} vs ${s.b})\n`);
}
