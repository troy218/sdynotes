/* ═══════════════════════════════════════════════════════════════════════════
   번들 형식 — 서버가 만들어 기기로 흘려보내는 한 줄짜리 묶음

   서버(routes/importBundle.js)와 검사(scripts/test-local-docs.mjs)가 **같은 코드**를
   쓰게 하려고 떼어 냈다. 형식이 한 곳에만 있으면 어긋날 일이 없다.

   형식
     "SDYB1\n"
     반복:  u32(이름 길이, big-endian) | 이름(utf8) | u32(내용 길이) | 내용
     마지막: "#manifest" 항목 하나 (JSON — 기기가 개수·용량을 대조한다)
     끝:    u32 0

     이름 앞 d/ = 서버의 문서 파일 그대로 ({jid}.json.gz · .s0.gz · .meta.json · .src)
     이름 앞 i/ = 배경 이미지 파일
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

export const MAGIC = Buffer.from('SDYB1\n', 'utf8');

export function entry(name, buf) {
  const nb = Buffer.from(name, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(nb.length, 0);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(buf.length, 0);
  return Buffer.concat([head, nb, size, buf]);
}

// 매니페스트까지 붙은 완성 번들 (검사·디버깅용. 운영 경로는 아래 제너레이터를 쓴다)
export function bundleBuffer(list, readFile = (p) => fs.readFileSync(p)) {
  const parts = [];
  for (const d of list.docs) parts.push(entry('d/' + d.name, readFile(d.file)));
  for (const im of list.images) parts.push(entry('i/' + im.name, readFile(im.file)));
  return Buffer.concat([MAGIC, ...parts, manifestEntry(list), Buffer.alloc(4)]);
}

export function manifestEntry(list) {
  return entry('#manifest', Buffer.from(JSON.stringify({
    jid: list.jid, files: list.files, bytes: list.bytes,
    docs: list.docs.map((d) => d.name), images: list.images.map((i) => i.name),
  }), 'utf8'));
}

// 파일 하나씩 읽어 흘려보내는 제너레이터 — 메모리 사용은 파일 하나 크기
export function* bundleChunks(list, readFile = (p) => fs.readFileSync(p)) {
  yield MAGIC;
  for (const d of list.docs) {
    try { yield entry('d/' + d.name, readFile(d.file)); }
    catch { /* 읽는 사이 사라졌으면 건너뛴다 */ }
  }
  for (const im of list.images) {
    try { yield entry('i/' + im.name, readFile(im.file)); }
    catch { /* noop */ }
  }
  yield manifestEntry(list);
  yield Buffer.alloc(4);
}
