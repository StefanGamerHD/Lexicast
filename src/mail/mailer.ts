import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { MailConfig } from '../config.ts';

export interface Mail { to: string; subject: string; text: string }
export interface Mailer { enabled: boolean; mode: MailConfig['mode']; send(mail: Mail): Promise<void> }

// One line, no control characters: keeps user-controlled values (names, project names) out of mail headers.
export const inline = (s: string, max = 100): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, max);

const ADDRESS = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;

function check(m: Mail): void {
  if (!ADDRESS.test(m.to) || m.to.length > 254) throw new Error('invalid recipient');
  if (/[\r\n]/.test(m.subject)) throw new Error('invalid subject');
}

export function createMailer(cfg: MailConfig): Mailer {
  if (cfg.mode === 'smtp') {
    const s = cfg.smtp;
    const transport = nodemailer.createTransport({
      host: s.host, port: s.port,
      secure: s.security === 'tls',
      requireTLS: s.security === 'starttls',
      ignoreTLS: s.security === 'none',
      auth: s.user ? { user: s.user, pass: s.password } : undefined,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    return {
      enabled: true, mode: 'smtp',
      async send(m) {
        check(m);
        await transport.sendMail({ from: cfg.from, to: m.to, subject: m.subject, text: m.text, headers: { 'Auto-Submitted': 'auto-generated' } });
      },
    };
  }
  if (cfg.mode === 'file') {
    let n = 0;
    return {
      enabled: true, mode: 'file',
      async send(m) {
        check(m);
        await mkdir(cfg.outboxDir, { recursive: true, mode: 0o700 });
        const name = `${Date.now()}-${String(++n).padStart(4, '0')}.json`;
        await writeFile(path.join(cfg.outboxDir, name), JSON.stringify({ from: cfg.from, ...m }, null, 2), { mode: 0o600 });
      },
    };
  }
  return { enabled: false, mode: 'off', async send() { throw new Error('mail is not configured'); } };
}
