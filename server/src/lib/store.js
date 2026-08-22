// Atomic JSON file helpers + per-key async mutex (single-process safety).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// ── async mutex keyed by resource ──────────────────────────────────────
const queues = new Map();

export function withLock(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  queues.set(key, prev.then(() => gate));
  const run = prev.then(fn);
  // when this critical section finishes (success or error), open the gate
  run.then(release, release);
  return run;
}

// ── atomic JSON ────────────────────────────────────────────────────────
export async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf-8');
    const d = JSON.parse(raw);
    return d ?? fallback;
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${crypto.randomBytes(4).toString('hex')}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 0), 'utf-8');
  await fsp.rename(tmp, file);
}

export function writeJsonAtomicSync(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
  fs.renameSync(tmp, file);
}

// sanitizers (mirror python re.sub allowlists)
export function san(v, re, max) {
  const s = String(v ?? '').replace(re, '');
  return max ? s.slice(0, max) : s;
}

export const SAN_ID = (v, max) => san(v, /[^0-9a-zA-Z_-]/g, max);
export const SAN_HEX = (v, max) => san(v, /[^0-9a-zA-Z]/g, max);

export function nowISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
