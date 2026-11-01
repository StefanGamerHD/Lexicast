import path from 'node:path';

export interface Config {
  dataDir: string;
  keyDir: string;
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
  return {
    dataDir,
    keyDir: path.resolve(env.LEXICAST_KEY_DIR || path.join(dataDir, 'keys')),
    baseUrl,
    authRatePerMinute: int('LEXICAST_AUTH_RATE_PER_MINUTE', env.LEXICAST_AUTH_RATE_PER_MINUTE, 20, 0, 100_000),
    host,
    port,
    ratePerMinute: int('LEXICAST_RATE_PER_MINUTE', env.LEXICAST_RATE_PER_MINUTE, 600, 0, 1_000_000),
    trustProxyHeader: env.LEXICAST_TRUST_PROXY_HEADER?.toLowerCase() || null,
    allowedOrigins: (env.LEXICAST_ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
