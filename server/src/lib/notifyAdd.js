// 알림 추가 (단일 작성자 = Node). worker 의 /internal/notify 가 여기로 온다.
import crypto from 'node:crypto';
import { FILES } from './paths.js';
import { readJson, writeJsonAtomic, withLock } from './store.js';

const NOTIFY_MAX = 160;

export async function notifyAddInternal(kind, title, message = '', dedupe = null, meta = null) {
  return withLock('notify', async () => {
    const items = await readJson(FILES.notifications, []);
    if (dedupe && items.some((x) => x.dedupe === dedupe)) return null;
    const rec = {
      id: 'nt_' + crypto.randomBytes(6).toString('hex'),
      kind: String(kind || 'info').slice(0, 24),
      title: String(title || '알림').slice(0, 120),
      message: String(message || '').slice(0, 500),
      ts: Date.now() / 1000,
      read: false,
    };
    if (dedupe) rec.dedupe = String(dedupe).slice(0, 160);
    if (meta && typeof meta === 'object') rec.meta = meta;
    items.push(rec);
    await writeJsonAtomic(FILES.notifications, items.slice(-NOTIFY_MAX));
    return rec;
  }).catch((e) => { console.error('[notify] 저장 실패:', e); return null; });
}
