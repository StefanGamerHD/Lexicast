import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type MailMode = 'off' | 'smtp' | 'file';
export type SmtpSecurity = 'starttls' | 'tls' | 'none';

export interface MailConfig {
  mode: MailMode;
  from: string;
  smtp: { host: string; port: number; security: SmtpSecurity; user: string; password: string };
  outboxDir: string;
  digestMinutes: number;
  defaultLocale: 'en' | 'de';
}

export interface Config {
  mail: MailConfig;
  dataDir: string;
  keyDir: string;
  webDir: string;
  baseUrl: string;
  authRatePerMinute: number;
  host: string;
  port: number;
  ratePerMinute: number;
  trustProxyHeader: string | null;
  allowedOrigins: string[];
}

function int(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

// All settings come from the environment. There are no secrets and no default credentials here.
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dataDir = path.resolve(env.LEXICAST_DATA_DIR || './data');
  const host = env.LEXICAST_HOST || '127.0.0.1';
  const port = int('LEXICAST_PORT', env.LEXICAST_PORT, 8787, 1, 65535);
  const baseUrl = (env.LEXICAST_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
  if (!/^https?:\/\/[^/\s]+$/.test(baseUrl)) throw new Error('LEXICAST_BASE_URL must look like https://translate.example.com (no path)');
  const mode = (env.LEXICAST_MAIL || 'off') as MailMode;
  if (!['off', 'smtp', 'file'].includes(mode)) throw new Error('LEXICAST_MAIL must be off, smtp or file');
  const security = (env.LEXICAST_SMTP_SECURITY || 'starttls') as SmtpSecurity;
  if (!['starttls', 'tls', 'none'].includes(security)) throw new Error('LEXICAST_SMTP_SECURITY must be starttls, tls or none');
  const smtpHost = env.LEXICAST_SMTP_HOST || '';
  const from = env.LEXICAST_MAIL_FROM || '';
  if (mode !== 'off' && !/^([^<>\r\n"]{1,80} )?<?[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+>?$/.test(from)) throw new Error('LEXICAST_MAIL_FROM must be an address like noreply@example.com or Name <noreply@example.com>');
  if (mode === 'smtp') {
    if (!smtpHost) throw new Error('LEXICAST_SMTP_HOST is required when LEXICAST_MAIL=smtp');
    // unencrypted SMTP is only accepted towards the local machine (tests, local relay)
    if (security === 'none' && !['127.0.0.1', '::1', 'localhost'].includes(smtpHost)) throw new Error('LEXICAST_SMTP_SECURITY=none is only allowed for localhost');
  }
  let smtpPassword = env.LEXICAST_SMTP_PASSWORD || '';
  if (env.LEXICAST_SMTP_PASSWORD_FILE) smtpPassword = readFileSync(env.LEXICAST_SMTP_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
  const locale = env.LEXICAST_DEFAULT_LOCALE || 'en';
  if (locale !== 'en' && locale !== 'de') throw new Error('LEXICAST_DEFAULT_LOCALE must be en or de');
  return {
    mail: {
      mode, from,
      smtp: { host: smtpHost, port: int('LEXICAST_SMTP_PORT', env.LEXICAST_SMTP_PORT, security === 'tls' ? 465 : 587, 1, 65535), security, user: env.LEXICAST_SMTP_USER || '', password: smtpPassword },
      outboxDir: path.resolve(env.LEXICAST_MAIL_OUTBOX || path.join(dataDir, 'outbox')),
      digestMinutes: int('LEXICAST_DIGEST_MINUTES', env.LEXICAST_DIGEST_MINUTES, 15, 0, 1440),
      defaultLocale: locale,
    },
    dataDir,
    keyDir: path.resolve(env.LEXICAST_KEY_DIR || path.join(dataDir, 'keys')),
    // built editor UI; defaults to dist/web next to src/
    webDir: path.resolve(env.LEXICAST_WEB_DIR || fileURLToPath(new URL('../dist/web', import.meta.url))),
    baseUrl,
    authRatePerMinute: int('LEXICAST_AUTH_RATE_PER_MINUTE', env.LEXICAST_AUTH_RATE_PER_MINUTE, 20, 0, 100_000),
    host,
    port,
    ratePerMinute: int('LEXICAST_RATE_PER_MINUTE', env.LEXICAST_RATE_PER_MINUTE, 600, 0, 1_000_000),
    trustProxyHeader: env.LEXICAST_TRUST_PROXY_HEADER?.toLowerCase() || null,
    allowedOrigins: (env.LEXICAST_ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
