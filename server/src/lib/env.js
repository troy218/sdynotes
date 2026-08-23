// 16.2 · .env 로더 (의존성 없음) — BASE_DIR/.env 가 있으면 process.env 에 심는다.
//
// 운영(apply.sh)은 systemd EnvironmentFile 로 같은 파일을 이미 주입한다.
// 여기는 로컬 실행·미리보기에서도 '설정은 .env 하나' 규칙을 지키기 위한 경로다.
//
// 주의: 이 모듈은 config.js 보다 먼저 불려야 한다 (env 를 import 시점에 읽기 때문).
//        index.js 의 첫 import 로 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = process.env.SDY_BASE_DIR || path.resolve(__dirname, '..', '..', '..');
const ENV_FILE = process.env.SDY_ENV_FILE || path.join(BASE_DIR, '.env');

try {
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;   // 이미 있는 값(시스템d 등)은 안 덮는다
  }
} catch {
  /* .env 없으면 조용히 지나간다 */
}
