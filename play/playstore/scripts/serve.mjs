#!/usr/bin/env node
/* 미리 보기 서버 — build/ 를 그대로 띄운다.
   기존 백엔드가 있으면 SDY_UPSTREAM 으로 넘긴다.

     node scripts/serve.mjs                       # 포트 5173
     PORT=8080 SDY_UPSTREAM=http://127.0.0.1:5000 node scripts/serve.mjs
*/
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');

process.env.PORT = process.env.PORT || '5173';
process.env.SDY_ROOT = process.env.SDY_ROOT || path.join(PKG, 'build');

const child = spawn(process.execPath, [path.join(PKG, 'server-play', 'index.mjs')], {
  stdio: 'inherit',
  env: process.env
});
child.on('exit', (c) => process.exit(c == null ? 0 : c));
