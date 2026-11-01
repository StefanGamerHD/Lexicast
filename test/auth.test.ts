import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { createAuth } from '../src/auth/service.ts';
import { hashPassword, passwordProblem, verifyPassword } from '../src/auth/crypto.ts';
import { loadConfig } from '../src/config.ts';
import { migrate, openDatabase } from '../src/db/migrate.ts';
import { buildRelease } from '../src/release/build.ts';
import { startSigner } from '../src/signer/client.ts';
import { sampleInput, tmpDir, verifyRelease } from './helpers.ts';
import { createPublicKey } from 'node:crypto';

const PW = 'correct horse battery staple';

async function start(env: Record<string, string> = {}, now?: () => number) {
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

test('password hashing: verify, wrong password, format, policy', async () => {
  const h = await hashPassword(PW);
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword(PW, h), true);
  assert.equal(await verifyPassword(PW + 'x', h), false);
  assert.equal(await verifyPassword(PW, 'garbage'), false);
  assert.ok(passwordProblem('short', 'a@b.de'));
  assert.ok(passwordProblem('admin-is-my-name-12345', 'admin@b.de'));
  assert.equal(passwordProblem(PW, 'a@b.de'), null);
});

test('setup needs the one-time token, works once, creates the signing key in the signer process', async () => {
  const s = await start();
  try {
    assert.deepEqual((await s.call('GET', '/api/v1/instance')).json, { setupDone: false, publicKey: null, fingerprint: null });
    assert.equal((await s.setup({ setupToken: 'wrong' })).status, 403);
    assert.equal((await s.setup({ password: 'short' })).status, 400);
    const ok = await s.setup();
    assert.equal(ok.status, 201);
    assert.equal(ok.json.user.email, 'admin@example.com');
    assert.equal(ok.json.user.isInstanceAdmin, true);
    assert.match(ok.json.fingerprint, /^SHA256:/);
    assert.ok(ok.cookie?.startsWith('lexicast_session='));
    assert.match(ok.raw!, /HttpOnly/); assert.match(ok.raw!, /SameSite=Strict/);
    assert.equal((await s.setup()).status, 409);
    assert.equal(s.auth.issueSetupToken(), null);
    const info = (await s.call('GET', '/api/v1/instance')).json;
    assert.equal(info.setupDone, true);
    assert.equal(info.publicKey, ok.json.publicKey);
    assert.ok(!JSON.stringify(info).includes('PRIVATE'));
    const st = await stat(path.join(s.config.keyDir, 'signing.pem'));
    assert.equal(st.mode & 0o777, 0o400);
    assert.equal((await s.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'instance.setup'").get() as { n: number }).n, 1);
  } finally { await s.stop(); }
});

test('two concurrent setups: exactly one wins', async () => {
  const s = await start();
  try {
    const rs = await Promise.all([s.setup({ email: 'a@example.com' }), s.setup({ email: 'b@example.com' })]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 1);
  } finally { await s.stop(); }
});

test('login, session, logout; sessions are stored hashed', async () => {
  const s = await start();
  try {
    await s.setup();
    assert.equal((await s.call('GET', '/api/v1/me')).status, 401);
    const l = await s.call('POST', '/api/v1/auth/login', { email: 'ADMIN@example.com', password: PW });
    assert.equal(l.status, 200);
    const me = await s.call('GET', '/api/v1/me', undefined, l.cookie!);
    assert.equal(me.json.user.displayName, 'Admin');
    const token = decodeURIComponent(l.cookie!.split('=')[1]!);
    const stored = s.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    assert.ok(stored.every((r) => r.token_hash !== token));
    await s.call('POST', '/api/v1/auth/logout', {}, l.cookie!);
    assert.equal((await s.call('GET', '/api/v1/me', undefined, l.cookie!)).status, 401);
  } finally { await s.stop(); }
});

test('wrong credentials give one generic error; lockout after 5 failures and recovery after the lock time', async () => {
  let t = Date.now();
  const s = await start({ LEXICAST_AUTH_RATE_PER_MINUTE: '0' }, () => t);
  try {
    await s.setup();
    const unknown = await s.call('POST', '/api/v1/auth/login', { email: 'nobody@example.com', password: PW });
    const wrong = await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: 'wrong-password-xx' });
    assert.equal(unknown.status, 401); assert.equal(wrong.status, 401);
    assert.deepEqual(unknown.json, wrong.json);
    for (let i = 0; i < 4; i++) await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: 'wrong-password-xx' });
    assert.equal((await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: PW })).status, 429);
    t += 16 * 60_000;
    assert.equal((await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: PW })).status, 200);
  } finally { await s.stop(); }
});

test('state-changing requests need our own Origin and JSON; auth endpoints are rate limited', async () => {
  const s = await start({ LEXICAST_AUTH_RATE_PER_MINUTE: '3' });
  try {
    const noOrigin = await fetch(s.base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(noOrigin.status, 403);
    const evil = await fetch(s.base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
    assert.equal(evil.status, 403);
    const form = await fetch(s.base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: s.config.baseUrl }, body: '{}' });
    assert.equal(form.status, 415);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await s.call('POST', '/api/v1/auth/login', { email: 'x@example.com', password: 'whatever-whatever' })).status);
    assert.ok(codes.includes(429));
    const big = await fetch(s.base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.config.baseUrl }, body: JSON.stringify({ x: 'a'.repeat(70_000) }) });
    assert.ok([413, 429].includes(big.status));
    const r = await s.call('GET', '/api/v1/me');
    assert.equal(r.status, 401);
  } finally { await s.stop(); }
});

test('invitations: admin only, single use, expiry, email becomes verified, one account per email', async () => {
  let t = Date.now();
  const s = await start({ LEXICAST_AUTH_RATE_PER_MINUTE: '0' }, () => t);
  try {
    const admin = await s.setup();
    assert.equal((await s.call('POST', '/api/v1/invitations', { email: 'anna@example.com' })).status, 401);
    const inv = await s.call('POST', '/api/v1/invitations', { email: 'anna@example.com' }, admin.cookie!);
    assert.equal(inv.status, 201);
    const token = inv.json.inviteUrl.split('/invite/')[1];
    const row = s.db.prepare('SELECT token_hash FROM invitations').get() as { token_hash: string };
    assert.notEqual(row.token_hash, token);
    assert.equal((await s.call('POST', '/api/v1/invitations/accept', { token, displayName: 'Anna', password: 'short' })).status, 400);
    const ok = await s.call('POST', '/api/v1/invitations/accept', { token, displayName: 'Anna', password: PW });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.user.isInstanceAdmin, false);
    assert.equal((s.db.prepare("SELECT email_verified_at IS NOT NULL AS v FROM users WHERE email = 'anna@example.com'").get() as { v: number }).v, 1);
    assert.equal((await s.call('POST', '/api/v1/invitations/accept', { token, displayName: 'Anna', password: PW })).status, 400);
    assert.equal((await s.call('POST', '/api/v1/invitations', { email: 'anna@example.com' }, admin.cookie!)).status, 409);
    // a non-admin cannot invite
    assert.equal((await s.call('POST', '/api/v1/invitations', { email: 'x@example.com' }, ok.cookie!)).status, 403);
    // expiry
    const inv2 = await s.call('POST', '/api/v1/invitations', { email: 'ben@example.com' }, admin.cookie!);
    t += 8 * 24 * 3600_000;
    assert.equal((await s.call('POST', '/api/v1/invitations/accept', { token: inv2.json.inviteUrl.split('/invite/')[1], displayName: 'Ben', password: PW })).status, 400);
  } finally { await s.stop(); }
});

test('signer process signs releases that verify with the published public key; key is never exposed by the API', async () => {
  const s = await start();
  try {
    const ok = await s.setup();
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: ok.json.publicKey }, format: 'jwk' });
    const out = path.join(s.dir, 'releases');
    await buildRelease({ ...sampleInput, releasesDir: out, sign: (b) => s.signer.sign(b) });
    assert.equal((await verifyRelease(out, 'demo', pub)).release, 1);
    // restart of the signer keeps the same key
    const again = startSigner(s.config.keyDir);
    try { assert.equal(await again.publicKey(), ok.json.publicKey); } finally { again.close(); }
    const pem = await readFile(path.join(s.config.keyDir, 'signing.pem'), 'utf8');
    for (const url of ['/api/v1/instance', '/api/v1/me', '/healthz']) {
      const body = JSON.stringify((await s.call('GET', url)).json);
      assert.ok(!body.includes(pem.split('\n')[1]!), url);
    }
  } finally { await s.stop(); }
});
