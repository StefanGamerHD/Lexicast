import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { createLimiter } from '../http/util.ts';

const ALLOWED = /^\/p\/[a-z0-9-]+\/(manifest\.json(\.sig)?|r\/[0-9]+\/[A-Za-z0-9_-]+\.json)$/;

export interface DeliveryOptions {
  root: string;
  ratePerMinute: number;
  allowedOrigins: string[];
  trustProxyHeader: string | null;
}

// Static delivery of the signed release tree. GET/HEAD only, fixed path allow-list, no cookies.
export function createDeliveryHandler(o: DeliveryOptions) {
  const root = path.resolve(o.root);
  const limited = createLimiter(o.ratePerMinute);

  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/p/')) return false;
    const send = (code: number, headers: Record<string, string | number> = {}, body: string | Buffer = '') => {
      res.writeHead(code, { 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, { Allow: 'GET, HEAD' }); return true; }
      const header = o.trustProxyHeader ? req.headers[o.trustProxyHeader] : undefined;
      const ip = String((Array.isArray(header) ? header[0] : header) ?? req.socket.remoteAddress);
      if (limited(ip)) { send(429, { 'Retry-After': '30' }, 'rate limit'); return true; }
      if (!ALLOWED.test(url.pathname)) { send(404, {}, 'not found'); return true; }
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep)) { send(404); return true; }
      const body = await readFile(file).catch(() => null);
      if (!body) { send(404, {}, 'not found'); return true; }
      const etag = '"' + createHash('sha256').update(body).digest('base64url').slice(0, 22) + '"';
      const headers: Record<string, string | number> = {
        'Content-Type': url.pathname.endsWith('.sig') ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
        ETag: etag,
        'Cache-Control': url.pathname.includes('/r/') ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      };
      const origin = req.headers.origin;
      if (origin && (o.allowedOrigins.includes('*') || o.allowedOrigins.includes(origin))) {
        headers['Access-Control-Allow-Origin'] = o.allowedOrigins.includes('*') ? '*' : origin;
        headers.Vary = 'Origin';
      }
      if (req.headers['if-none-match'] === etag) { send(304, headers); return true; }
      send(200, { ...headers, 'Content-Length': body.length }, body);
    } catch {
      send(500, {}, 'error');
    }
    return true;
  };
}
