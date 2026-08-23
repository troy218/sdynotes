// 16.2 · 최소 SMTP 클라이언트(mailer.js) 계약 테스트 — 로컬 가짜 SMTP 서버로 검증.
//
// Gmail 과 같은 경로를 그대로 흉내 낸다:
//   평문 연결 → EHLO(STARTTLS 광고) → STARTTLS(자체서명 인증서) → EHLO →
//   AUTH LOGIN(base64 아이디/비번) → MAIL FROM → RCPT TO → DATA → '.'
//
// openssl 이 없으면 인증서를 못 만들므로 건너뛴다(0 fail 종료).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 자체서명 인증서 ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-smtp-'));
const keyFile = path.join(tmp, 'key.pem');
const certFile = path.join(tmp, 'cert.pem');
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyFile,
    '-out', certFile, '-days', '2', '-nodes', '-subj', '/CN=localhost'], { stdio: 'ignore' });
} catch {
  console.log('⏭ openssl 없음 — SMTP 메일러 테스트 건너뜀 (PASS 0 / FAIL 0)');
  process.exit(0);
}

// ── 가짜 SMTP 서버 ──
//  STARTTLS 로 소켓을 감쌀 때는 기존 data 리스너를 먼저 떼고,
//  이후 쓰기/읽기는 모두 TLS 소켓으로만 한다.
function fakeSmtp({ advertiseStarttls }) {
  const saw = { authUser: '', authPass: '', from: '', to: '', data: '', steps: [] };
  const ctx = tls.createSecureContext({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) });
  const server = net.createServer((raw) => {
    let sock = raw;                 // 업그레이드되면 TLS 소켓으로 교체
    let upgraded = false;
    let authStep = 0;               // 0=대기, 1=아이디 기다림, 2=비번 기다림
    let dataMode = false, dataBuf = '';
    const send = (s) => { try { sock.write(s + '\r\n'); } catch { /* */ } };
    const attach = (s) => {
      let buf = '';
      s.on('data', (c) => {
        const t = c.toString('utf8');
        if (dataMode) {
          dataBuf += t;
          if (dataBuf.endsWith('\r\n.\r\n')) {
            saw.data = dataBuf.slice(0, -5);
            dataMode = false; dataBuf = '';
            send('250 2.0.0 queued');
          }
          return;
        }
        buf += t;
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); onLine(l); }
      });
    };
    const onLine = (line) => {
      // AUTH LOGIN 다음 두 줄은 무조건 아이디→비번 (명령어와 구분해 상태로 처리)
      if (authStep === 1) { saw.authUser = Buffer.from(line, 'base64').toString('utf8'); authStep = 2; send('334 UGFzc3dvcmQ6'); return; }
      if (authStep === 2) { saw.authPass = Buffer.from(line, 'base64').toString('utf8'); authStep = 0; send('235 2.7.0 accepted'); return; }
      const u = line.toUpperCase();
      if (u.startsWith('EHLO')) {
        if (advertiseStarttls && !upgraded) {
          send('250-fake.sdy'); send('250-STARTTLS'); send('250-AUTH LOGIN PLAIN'); send('250 OK');
        } else { send('250-fake.sdy'); send('250 AUTH LOGIN PLAIN'); send('250 OK'); }
      } else if (u.startsWith('STARTTLS')) {
        send('220 go tls');
        raw.removeAllListeners('data');
        const t = new tls.TLSSocket(raw, { isServer: true, secureContext: ctx });
        sock = t; upgraded = true;
        attach(t);
      } else if (u.startsWith('AUTH LOGIN')) {
        authStep = 1; send('334 VXNlcm5hbWU6');
      } else if (u.startsWith('MAIL FROM')) {
        saw.from = line; send('250 2.1.0 ok');
      } else if (u.startsWith('RCPT TO')) {
        saw.to = line; send('250 2.1.5 ok');
      } else if (u.startsWith('DATA')) {
        dataMode = true; dataBuf = ''; send('354 end with .');
      } else if (u.startsWith('QUIT')) {
        send('221 bye'); try { sock.end(); } catch { /* */ }
      } else if (line.length) {
        send('250 ok');
      }
    };
    attach(raw);
    send('220 fake.sdy ESMTP ready');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, saw, port: server.address().port }));
  });
}

// ── 클라이언트(mailer.js) — env 를 import 시점에 읽으므로 먼저 심는다 ──
async function loadMailer(port) {
  process.env.SDY_SMTP_HOST = '127.0.0.1';
  process.env.SDY_SMTP_PORT = String(port);
  process.env.SDY_SMTP_USER = 'testuser@sdy.local';
  process.env.SDY_SMTP_PASS = 'test-pass-123';
  process.env.SDY_SMTP_FROM = 'testuser@sdy.local';
  return import('../server/src/lib/mailer.js');
}

(async () => {
  // 1) STARTTLS 경로 (Gmail 587 과 동일)
  {
    const srv = await fakeSmtp({ advertiseStarttls: true });
    const { sendMail } = await loadMailer(srv.port);
    process.env.SDY_SMTP_SECURE = 'starttls';
    let r = null;
    try { r = await sendMail({ to: 'bird@test.local', subject: '인증 코드 654321', text: '인증 코드: 654321\n10분 안에 입력해 주세요.' }); }
    catch (e) { r = { error: String(e?.message || e) }; }
    ok('STARTTLS: 발송 성공', r && r.ok === true);
    ok('STARTTLS: AUTH LOGIN 아이디', srv.saw.authUser === 'testuser@sdy.local');
    ok('STARTTLS: AUTH LOGIN 비번', srv.saw.authPass === 'test-pass-123');
    ok('STARTTLS: MAIL FROM', /MAIL FROM:<testuser@sdy\.local>/i.test(srv.saw.from));
    ok('STARTTLS: RCPT TO', /RCPT TO:<bird@test\.local>/i.test(srv.saw.to));
    ok('STARTTLS: 제목이 UTF-8 base64 로 인코딩', srv.saw.data.includes('Subject: =?UTF-8?B?' + Buffer.from('인증 코드 654321').toString('base64') + '?='));
    ok('STARTTLS: 본문이 base64 로 실렸다', srv.saw.data.includes(Buffer.from('인증 코드: 654321').toString('base64')));
    srv.server.close();
  }

  // 2) 평문 경로 (STARTTLS 광고 없음 → 업그레이드 없이 그대로)
  {
    const srv = await fakeSmtp({ advertiseStarttls: false });
    const { sendMail, smtpConfigured } = await loadMailer(srv.port);
    process.env.SDY_SMTP_SECURE = 'auto';
    ok('설정 감지: smtpConfigured()', smtpConfigured() === true);
    let r = null;
    try { r = await sendMail({ to: 'bird2@test.local', subject: 's', text: 'x' }); } catch (e) { r = { error: String(e?.message || e) }; }
    ok('평문: 발송 성공', r && r.ok === true);
    ok('평문: 비번 인증', srv.saw.authPass === 'test-pass-123');
    srv.server.close();
  }

  await wait(200);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  console.log(`\nSMTP 메일러 계약: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
