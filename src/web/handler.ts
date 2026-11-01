import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

// The editor UI is a prebuilt single-page app (web/ built by Vite into dist/web). The server only serves its files:
// index.html for the app's own routes, hashed files under /static/ from memory. Nothing is read from disk per request.
export const WEB_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const APP_ROUTES = [
  /^\/$/,
  /^\/(login|forgot|setup|account)$/,
  /^\/(invite|reset)\/[A-Za-z0-9_-]{16,128}$/,
  /^\/(projects|admin)(\/[A-Za-z0-9._~-]+){0,6}$/,
];

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

interface StaticFile { body: Buffer; type: string }

export function createWebHandler(dir: string) {
  const indexPath = path.join(dir, 'index.html');
  if (!existsSync(indexPath)) {
    console.warn(`web UI not found in ${dir}; run "npm run build:web" (the JSON API works without it)`);
    return async (): Promise<boolean> => false;
  }
  const index = readFileSync(indexPath);
  const files = new Map<string, StaticFile>();
  const load = (sub: string, prefix: string) => {
    const d = path.join(dir, sub);
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const type = TYPES[path.extname(name)];
      if (type && /^[A-Za-z0-9._-]+$/.test(name)) files.set(prefix + name, { body: readFileSync(path.join(d, name)), type });
    }
  };
  load('static', '/static/');
  load('.', '/'); // files from web/public, e.g. /favicon.svg

  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const file = files.get(url.pathname);
    const base = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (file && url.pathname !== '/index.html') {
      // names under /static/ carry a content hash, so they never change
      const cache = url.pathname.startsWith('/static/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
      res.writeHead(200, { ...base, 'Content-Type': file.type, 'Content-Length': file.body.length, 'Cache-Control': cache });
      res.end(req.method === 'HEAD' ? undefined : file.body);
      return true;
    }
    if (!APP_ROUTES.some((r) => r.test(url.pathname))) return false;
    res.writeHead(200, {
      ...base,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': index.length,
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': WEB_CSP,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    res.end(req.method === 'HEAD' ? undefined : index);
    return true;
  };
}
