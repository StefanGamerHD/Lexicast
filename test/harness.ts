import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { createAuth } from '../src/auth/service.ts';
import { loadConfig } from '../src/config.ts';
import { migrate, openDatabase } from '../src/db/migrate.ts';
import { startSigner } from '../src/signer/client.ts';
import { tmpDir } from './helpers.ts';

export const PW = 'correct horse battery staple';

export async function start(env: Record<string, string> = {}, now?: () => number) {
  const { dir, cleanup } = await tmpDir();
  const config = loadConfig({ LEXICAST_DATA_DIR: dir, ...env });
  const db = openDatabase(':memory:'); migrate(db);
  const auth = createAuth(db, now);
  const signer = startSigner(config.keyDir);
  const server = createApp({ config, db, auth, signer });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const setupToken = auth.issueSetupToken()!;
  const origin = new URL(config.baseUrl).origin;
  async function call(method: string, p: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
    const r = await fetch(base + p, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? null, raw: r.headers.get('set-cookie') };
  }
  const setup = (over: Record<string, unknown> = {}) => call('POST', '/api/v1/setup', { setupToken, email: 'Admin@Example.com', displayName: 'Admin', password: PW, ...over });
  return { config, db, auth, signer, dir, call, setup, setupToken, base, stop: async () => { signer.close(); server.close(); db.close(); await cleanup(); } };
}
