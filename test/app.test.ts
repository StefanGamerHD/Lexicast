import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { createAuth } from '../src/auth/service.ts';
import { loadConfig } from '../src/config.ts';
import { migrate, openDatabase } from '../src/db/migrate.ts';
import { buildRelease } from '../src/release/build.ts';
import { newKeys, sampleInput, tmpDir } from './helpers.ts';

async function start(over: Record<string, string> = {}) {
  const { dir, cleanup } = await tmpDir();
  const config = loadConfig({ LEXICAST_DATA_DIR: dir, LEXICAST_PORT: '1', ...over });
  const db = openDatabase(':memory:'); migrate(db);
  const signer = { publicKey: async () => 'x', sign: async () => Buffer.alloc(64), close() {} };
  const server = createApp({ config, db, auth: createAuth(db), signer });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const k = newKeys();
  await buildRelease({ ...sampleInput, releasesDir: path.join(dir, 'releases'), sign: k.sign });
  return { base, k, stop: async () => { server.close(); db.close(); await cleanup(); } };
}

test('delivery headers: JSON type, ETag/304, nosniff, immutable files, no cookies', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/p/demo/manifest.json`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type')!, /^application\/json/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('cache-control')!, /max-age=60/);
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal((await fetch(`${s.base}/p/demo/manifest.json`, { headers: { 'If-None-Match': r.headers.get('etag')! } })).status, 304);
    assert.match((await fetch(`${s.base}/p/demo/r/1/de.json`)).headers.get('cache-control')!, /immutable/);
  } finally { await s.stop(); }
});

test('only allowed paths and methods are served', async () => {
  const s = await start();
  try {
    for (const p of ['/p/demo/keys.json', '/p/demo/r/1/%2e%2e%2fmanifest.json', '/p/../etc/passwd', '/p/demo/r/x/de.json']) {
      assert.equal((await fetch(`${s.base}${p}`)).status, 404, p);
    }
    assert.equal((await fetch(`${s.base}/p/demo/manifest.json`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${s.base}/unknown`)).status, 404);
  } finally { await s.stop(); }
});

test('no 429 for 300 requests from localhost with default limit; limit applies when exceeded', async () => {
  const s = await start();
  try {
    let n429 = 0;
    for (let i = 0; i < 300; i++) if ((await fetch(`${s.base}/p/demo/manifest.json`)).status === 429) n429++;
    assert.equal(n429, 0);
  } finally { await s.stop(); }
  const t = await start({ LEXICAST_RATE_PER_MINUTE: '5' });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await fetch(`${t.base}/p/demo/manifest.json`)).status);
    assert.equal(codes[0], 200);
    assert.ok(codes.includes(429));
  } finally { await t.stop(); }
});

test('rate limit uses the configured proxy header, not the socket, when set', async () => {
  const s = await start({ LEXICAST_RATE_PER_MINUTE: '3', LEXICAST_TRUST_PROXY_HEADER: 'CF-Connecting-IP' });
  try {
    const hit = (ip: string) => fetch(`${s.base}/p/demo/manifest.json`, { headers: { 'cf-connecting-ip': ip } }).then((r) => r.status);
    for (let i = 0; i < 3; i++) assert.equal(await hit('203.0.113.1'), 200);
    assert.equal(await hit('203.0.113.1'), 429);
    assert.equal(await hit('203.0.113.2'), 200);
  } finally { await s.stop(); }
});

test('CORS: wildcard by default, restricted when configured', async () => {
  const a = await start();
  try { assert.equal((await fetch(`${a.base}/p/demo/manifest.json`, { headers: { Origin: 'https://x.example' } })).headers.get('access-control-allow-origin'), '*'); } finally { await a.stop(); }
  const b = await start({ LEXICAST_ALLOWED_ORIGINS: 'https://app.example' });
  try {
    assert.equal((await fetch(`${b.base}/p/demo/manifest.json`, { headers: { Origin: 'https://app.example' } })).headers.get('access-control-allow-origin'), 'https://app.example');
    assert.equal((await fetch(`${b.base}/p/demo/manifest.json`, { headers: { Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  } finally { await b.stop(); }
});

test('healthz reports ok and the schema version without secrets', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/healthz`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: 'ok', schema: 3 });
  } finally { await s.stop(); }
});

test('config rejects invalid values', () => {
  assert.throws(() => loadConfig({ LEXICAST_PORT: '99999' }), /LEXICAST_PORT/);
  assert.throws(() => loadConfig({ LEXICAST_RATE_PER_MINUTE: '-1' }), /LEXICAST_RATE_PER_MINUTE/);
  assert.equal(loadConfig({}).host, '127.0.0.1');
});
