import type { IncomingMessage, ServerResponse } from 'node:http';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  if (!/^application\/json(\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new ApiError(413, 'too_large', 'Request body too large');
    chunks.push(c as Buffer);
  }
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'bad_json', 'Body must be a JSON object');
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export interface CookieOptions { secure: boolean; maxAgeSeconds: number }

export function sessionCookie(name: string, value: string, o: CookieOptions): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${o.maxAgeSeconds}${o.secure ? '; Secure' : ''}`;
}

export function str(v: unknown, field: string, max = 256): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new ApiError(400, 'invalid_field', `${field} is missing or invalid`);
  return v;
}

const BAD_NAME = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\u2028\u2029]/;
export function displayName(v: unknown, field = 'displayName'): string {
  if (typeof v !== 'string' || !v.trim() || v.length > 100 || BAD_NAME.test(v)) throw new ApiError(400, 'invalid_field', `${field} must be 1 to 100 characters without control characters`);
  return v.trim();
}

export function createLimiter(perMinute: number) {
  const hits = new Map<string, { minute: number; n: number }>();
  return (key: string): boolean => {
    if (!perMinute) return false;
    const minute = Math.floor(Date.now() / 60000);
    const e = hits.get(key);
    if (!e || e.minute !== minute) {
      if (hits.size > 10_000) hits.clear();
      hits.set(key, { minute, n: 1 });
      return false;
    }
    return ++e.n > perMinute;
  };
}
