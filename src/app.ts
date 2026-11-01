import http from 'node:http';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import { createDeliveryHandler } from './delivery/handler.ts';

export function createApp(config: Config, db: DatabaseSync): http.Server {
  const delivery = createDeliveryHandler({
    root: path.join(config.dataDir, 'releases'),
    ratePerMinute: config.ratePerMinute,
    allowedOrigins: config.allowedOrigins,
    trustProxyHeader: config.trustProxyHeader,
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (await delivery(req, res, url)) return;

    if (url.pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      let ok = true;
      let schema = 0;
      try { schema = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v; }
      catch { ok = false; }
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'error', schema }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end('{"error":{"code":"not_found","message":"Not found"}}');
  });
}
