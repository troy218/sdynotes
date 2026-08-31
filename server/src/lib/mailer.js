// 16.2/16.4 · 최소 SMTP 클라이언트 — 신규 등록 OTP 인증 코드를 보내는 데 쓴다.
//
// nodemailer 같은 의존성 없이 node:net / node:tls 만으로 대화한다.
//   SDY_SMTP_HOST   — SMTP 서버 주소 (없으면 메일 발송 비활성)
//   SDY_SMTP_PORT   — 포트 (기본 587; 465면 암시적 SSL)
//   SDY_SMTP_USER   — 로그인 아이디 (보통 이메일)
//   SDY_SMTP_PASS   — 비밀번호(앱 비밀번호)
//   SDY_SMTP_FROM   — 보내는 주소 (기본 = USER)
//   SDY_SMTP_SECURE — 'ssl' | 'starttls' | 'auto' (기본 auto: 465→ssl, 나머지→starttls)
//
// 지원: EHLO → (STARTTLS) → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT
import net from 'node:net';
import tls from 'node:tls';

// 호출 시점에 읽는다 — 테스트에서 시나리오마다 다른 서버를 물 수 있게.
function cfg() {
  const user = (process.env.SDY_SMTP_USER || '').trim();
  return {
    host: (process.env.SDY_SMTP_HOST || '').trim(),
    port: parseInt(process.env.SDY_SMTP_PORT || '587', 10),
    user,
    pass: process.env.SDY_SMTP_PASS || '',
    from: (process.env.SDY_SMTP_FROM || user).trim(),
    secure: (process.env.SDY_SMTP_SECURE || 'auto').trim().toLowerCase(),
  };
}

export function smtpConfigured() {
  const c = cfg();
  return Boolean(c.host && c.user && c.pass && c.from);
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s) => (s.match(/.{1,76}/g) || []).join('\r\n');
const hdrB64 = (s) => `=?UTF-8?B?${b64(s)}?=`;

class SmtpDialog {
  constructor(socket) { this.socket = socket; }
  // 한 줄 응답(연속 줄 `NNN-` 묶음)을 기다려 {code, text} 반환.
  //   · 버퍼가 \r\n 으로 끝나야 마지막 줄까지 온 것이다 (그 전엔 파편)
  //   · 모든 줄이 `NNN-`(계속) 또는 `NNN `(끝) 꼴이고, 마지막 줄이 `NNN `이면 완결
  reply(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('SMTP 응답 대기 시간 초과'));
      }, timeoutMs);
      const onData = (chunk) => {
        buf += chunk.toString('utf8');
        if (!buf.endsWith('\r\n')) return;                 // 아직 진행 중인 줄
        const lines = buf.split('\r\n').filter((l) => l.length);
        if (!lines.length) return;
        const shaped = lines.every((l) => /^\d{3}[ -]/.test(l));
        const last = lines[lines.length - 1];
        if (shaped && /^\d{3} /.test(last)) {
          cleanup();
          const code = parseInt(last.slice(0, 3), 10);
          resolve({ code, text: lines.join('\r\n') });
        }
        // `NNN-` 로 끝나는 묶음(아직 마지막 줄 안 옴)은 계속 쌓는다
      };
      const onError = (e) => { cleanup(); reject(e); };
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off('data', onData);
        this.socket.off('error', onError);
      };
      this.socket.on('data', onData);
      this.socket.on('error', onError);
    });
  }
  async cmd(line, expect = 250, timeoutMs = 15000) {
    this.socket.write(line + '\r\n');
    const r = await this.reply(timeoutMs);
    if (Math.floor(r.code / 100) !== Math.floor(expect / 100)) {
      throw new Error(`SMTP ${line.slice(0, 24)}… → ${r.code}: ${r.text.trim().slice(0, 200)}`);
    }
    return r;
  }
}

function buildMime(c, { to, subject, text }) {
  return [
    `From: ${hdrB64('SDYnotes')} <${c.from}>`,
    `To: <${to}>`,
    `Subject: ${hdrB64(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Date: ' + new Date().toUTCString(),
    '',
    wrap76(b64(text)),
  ].join('\r\n');
}

// SMTP 서버와 한 번의 세션으로 메일 한 통을 보낸다.
export async function sendMail({ to, subject, text }) {
  const c = cfg();
  if (!smtpConfigured()) throw new Error('SMTP 미설정');
  const useSsl = c.secure === 'ssl' || (c.secure === 'auto' && c.port === 465);
  let socket = useSsl
    ? tls.connect({ host: c.host, port: c.port, rejectUnauthorized: false })
    : net.connect({ host: c.host, port: c.port });
  socket.setTimeout(20000);
  const fail = (e) => { try { socket.destroy(); } catch { /* */ } throw e; };
  const say = (d) => buildMime(c, { to, subject, text }).replace(/(^|\n)\./g, '$1..') + '\r\n.\r\n';
  try {
    const d = new SmtpDialog(socket);
    await d.reply();                                  // 220 banner
    const ehlo = await d.cmd(`EHLO ${c.host}`, 250);  // 기대 코드 그룹(2xx)
    // 587 등 평문 포트면 STARTTLS 로 올린다 (서버가 지원할 때만)
    if (!useSsl && /STARTTLS/i.test(ehlo.text)) {
      await d.cmd('STARTTLS', 220);
      socket = tls.connect({ socket, rejectUnauthorized: false });
      socket.setTimeout(20000);
      const d2 = new SmtpDialog(socket);
      await d2.cmd(`EHLO ${c.host}`, 250);
      await d2.cmd('AUTH LOGIN', 334);
      await d2.cmd(b64(c.user), 334);
      await d2.cmd(b64(c.pass), 235);
      await d2.cmd(`MAIL FROM:<${c.from}>`, 250);
      await d2.cmd(`RCPT TO:<${to}>`, 250);
      await d2.cmd('DATA', 354);
      socket.write(say(d2));
      await d2.reply();
      await d2.cmd('QUIT', 221);
    } else {
      await d.cmd('AUTH LOGIN', 334);
      await d.cmd(b64(c.user), 334);
      await d.cmd(b64(c.pass), 235);
      await d.cmd(`MAIL FROM:<${c.from}>`, 250);
      await d.cmd(`RCPT TO:<${to}>`, 250);
      await d.cmd('DATA', 354);
      socket.write(say(d));
      await d.reply();
      await d.cmd('QUIT', 221);
    }
  } catch (e) {
    return fail(e);
  } finally {
    try { socket.destroy(); } catch { /* */ }
  }
  return { ok: true };
}
