import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../src/http/util.ts';
import { createProjects } from '../src/projects/service.ts';
import { createReleases } from '../src/releases/service.ts';
import { PW, start } from './harness.ts';
import { verifyRelease } from './helpers.ts';

type S = Awaited<ReturnType<typeof start>>;
const LANGS = [{ tag: 'en' }, { tag: 'de', fallback: ['en'] }, { tag: 'de-AT', fallback: ['de', 'en'] }];
const P = '/api/v1/projects/demo';

async function world() {
  const s = await start({ LEXICAST_AUTH_RATE_PER_MINUTE: '0' });
  const admin = (await s.setup()).cookie!;
  const mk = async (email: string, role: string, language: string) => {
    const inv = await s.call('POST', '/api/v1/invitations', { email }, admin);
    const c = (await s.call('POST', '/api/v1/invitations/accept', { token: inv.json.inviteUrl.split('/invite/')[1], displayName: email.split('@')[0], password: PW })).cookie!;
    await s.call('POST', P + '/members', { email, role, language }, admin);
    return c;
  };
  await s.call('POST', '/api/v1/projects', { slug: 'demo', name: 'Demo', sourceLanguage: 'en', languages: LANGS }, admin);
  const tina = await mk('tina@example.com', 'translator', 'de');
  const rita = await mk('rita@example.com', 'reviewer', 'de');
  const translate = async (key: string, text: string, language = 'de') => {
    const sg = await s.call('POST', P + '/suggestions', { key, language, text }, tina);
    assert.equal(sg.status, 201, JSON.stringify(sg.json));
    const ok = await s.call('POST', `${P}/suggestions/${sg.json.id}/approve`, {}, rita);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  };
  const release = (c: string, body: object = {}) => s.call('POST', P + '/releases', body, c);
  return { s, admin, tina, rita, translate, release };
}
const files = (s: S) => path.join(s.dir, 'releases');
const getLive = async (s: S, lang: string): Promise<Record<string, string>> => {
  const m = (await (await fetch(`${s.base}/p/demo/manifest.json`)).json()) as { release: number };
  return (await (await fetch(`${s.base}/p/demo/r/${m.release}/${lang}.json`)).json()) as Record<string, string>;
};
const adminUser = (s: S) => { const r = s.db.prepare("SELECT id, email, display_name AS displayName FROM users WHERE is_instance_admin = 1").get() as { id: number; email: string; displayName: string }; return { ...r, isInstanceAdmin: true, uiLocale: 'en', theme: 'system', notifyEmail: true }; };

test('first release: owner only, needs keys, delivered over HTTP with a valid signature and fallback chain', async () => {
  const { s, admin, tina, translate, release } = await world();
  try {
    assert.equal((await s.call('GET', P + '/releases/preview', undefined, admin)).status, 409);   // no keys yet
    await s.call('POST', P + '/keys/import', { apply: true, texts: { greeting: 'Hello {name}', logout: 'Log out' } }, admin);
    await translate('greeting', 'Hallo {name}');
    assert.equal((await s.call('GET', P + '/releases/preview', undefined, tina)).status, 403);
    assert.equal((await release(tina)).status, 403);
    const pv = (await s.call('GET', P + '/releases/preview', undefined, admin)).json;
    assert.deepEqual([pv.liveRelease, pv.nextRelease, pv.hasChanges], [null, 1, true]);
    assert.deepEqual(pv.summary.languages.de, { added: 2, changed: 0, removed: 0 });
    const r = await release(admin, { note: 'First release' });
    assert.equal(r.status, 201); assert.equal(r.json.release, 1);
    const m = await (await fetch(`${s.base}/p/demo/manifest.json`)).json() as { release: number; languages: Record<string, unknown> };
    assert.equal(m.release, 1); assert.deepEqual(Object.keys(m.languages).sort(), ['de', 'de-AT', 'en']);
    const pub = (await s.call('GET', '/api/v1/instance')).json.publicKey;
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub }, format: 'jwk' });
    assert.equal((await verifyRelease(files(s), 'demo', key)).release, 1);       // signature and all hashes valid
    assert.deepEqual(await getLive(s, 'de'), { greeting: 'Hallo {name}', logout: 'Log out' });   // logout untranslated: falls back to English
    assert.deepEqual(await getLive(s, 'de-AT'), { greeting: 'Hallo {name}', logout: 'Log out' }); // de-AT -> de -> en
    const h = (await s.call('GET', P + '/releases', undefined, tina)).json.releases;       // any member may read the history
    assert.deepEqual([h.length, h[0].number, h[0].state, h[0].note, h[0].createdBy], [1, 1, 'published', 'First release', 'Admin']);
  } finally { await s.stop(); }
});

test('no empty releases; changes are listed per language; history keeps order', async () => {
  const { s, admin, translate, release } = await world();
  try {
    await s.call('POST', P + '/keys/import', { apply: true, texts: { greeting: 'Hello {name}', logout: 'Log out' } }, admin);
    await release(admin);
    const none = await release(admin);
    assert.deepEqual([none.status, none.json.error.code], [409, 'no_changes']);
    assert.equal((await s.call('GET', P + '/releases/preview', undefined, admin)).json.hasChanges, false);
    await translate('greeting', 'Hallo {name}');
    const pv = (await s.call('GET', P + '/releases/preview', undefined, admin)).json;
    assert.deepEqual(pv.changes.de.changed, ['greeting']);
    assert.deepEqual(pv.changes['de-AT'].changed, ['greeting']);                 // de-AT inherits it through the fallback chain
    assert.deepEqual(pv.changes.en, { added: [], changed: [], removed: [] });
    assert.equal((await release(admin)).json.release, 2);
    assert.deepEqual((await s.call('GET', P + '/releases', undefined, admin)).json.releases.map((x: { number: number }) => x.number), [2, 1]);
  } finally { await s.stop(); }
});

test('outdated translations and deprecated keys are not released', async () => {
  const { s, admin, translate, release } = await world();
  try {
    await s.call('POST', P + '/keys/import', { apply: true, texts: { greeting: 'Hello {name}', logout: 'Log out' } }, admin);
    await translate('greeting', 'Hallo {name}'); await translate('logout', 'Abmelden');
    await release(admin);
    assert.equal((await getLive(s, 'de')).greeting, 'Hallo {name}');
    await s.call('PATCH', P + '/keys/greeting', { sourceText: 'Hi {name}!' }, admin);   // translation becomes outdated
    await s.call('PATCH', P + '/keys/logout', { state: 'deprecated' }, admin);
    const pv = (await s.call('GET', P + '/releases/preview', undefined, admin)).json;
    assert.equal(pv.summary.outdatedExcluded, 1);
    assert.deepEqual(pv.changes.de.removed, ['logout']);
    assert.deepEqual(pv.changes.de.changed, ['greeting']);                           // falls back to the new English text
    assert.equal((await release(admin)).status, 201);
    assert.deepEqual(await getLive(s, 'de'), { greeting: 'Hi {name}!' });
  } finally { await s.stop(); }
});

test('solo-mode approvals are counted in the change summary', async () => {
  const { s, admin, release } = await world();
  try {
    await s.call('POST', P + '/keys/import', { apply: true, texts: { greeting: 'Hello {name}' } }, admin);
    await s.call('PATCH', P, { soloMode: true }, admin);
    const sg = await s.call('POST', P + '/suggestions', { key: 'greeting', language: 'de', text: 'Hallo {name}' }, admin);
    await s.call('POST', `${P}/suggestions/${sg.json.id}/approve`, {}, admin);
    assert.equal((await s.call('GET', P + '/releases/preview', undefined, admin)).json.summary.soloApprovals, 1);
    await release(admin);
    assert.equal((await s.call('GET', P + '/releases', undefined, admin)).json.releases[0].summary.soloApprovals, 1);
    assert.equal((await s.call('GET', P + '/releases/preview', undefined, admin)).json.summary.soloApprovals, 0);  // counted once
  } finally { await s.stop(); }
});

test('two simultaneous release requests: one wins, the other is refused, no duplicate release', async () => {
  const { s, admin, translate, release } = await world();
  try {
    await s.call('POST', P + '/keys/import', { apply: true, texts: { greeting: 'Hello {name}' } }, admin);
    await release(admin);
    await translate('greeting', 'Hallo {name}');
    const rs = await Promise.all([release(admin), release(admin)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.deepEqual((s.db.prepare("SELECT number, state FROM releases ORDER BY number").all() as { number: number; state: string }[]).map((r) => `${r.number}:${r.state}`), ['1:published', '2:published']);
  } finally { await s.stop(); }
});

test('a failing build leaves the live release untouched, records the reason and cleans up', async () => {
  const { s, admin, translate, release } = await world();
  try {
    await s.call('POST', P + '/keys/import', { apply: true, texts: { greeting: 'Hello {name}' } }, admin);
    await release(admin);
    await translate('greeting', 'Hallo {name}');
    const before = await readFile(path.join(files(s), 'p/demo/manifest.json'), 'utf8');
    const broken = createReleases(s.db, createProjects(s.db), async () => { throw new Error('signer is down'); }, files(s));
    await assert.rejects(broken.create(adminUser(s), 'demo', {}), (e: unknown) => e instanceof ApiError && e.status === 500 && /signer is down/.test(e.message));
    assert.equal(await readFile(path.join(files(s), 'p/demo/manifest.json'), 'utf8'), before);
    await assert.rejects(access(path.join(files(s), 'p/demo/r/2')));                 // half-built directory removed
    const row = s.db.prepare('SELECT state, failure_reason FROM releases WHERE number = 2').get() as { state: string; failure_reason: string };
    assert.deepEqual({ ...row }, { state: 'failed', failure_reason: 'signer is down' });
    const next = await release(admin);                                                   // the project is not blocked afterwards
    assert.equal(next.json.release, 3);
    assert.ok((await s.call('GET', P + '/releases', undefined, admin)).json.releases.some((x: { state: string }) => x.state === 'failed'));
  } finally { await s.stop(); }
});

test('invalid data in the database blocks the release before anything is written', async () => {
  const { s, admin, translate, release } = await world();
  try {
    await s.call('POST', P + '/keys/import', { apply: true, texts: { greeting: 'Hello {name}' } }, admin);
    await translate('greeting', 'Hallo {name}');
    s.db.prepare("UPDATE translations SET text = 'Hallo {wrong}'").run();          // simulates data that bypassed the checks
    const r = await release(admin);
    assert.deepEqual([r.status, r.json.error.code], [409, 'invalid_release']);
    assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM releases').get() as { n: number }).n, 0);
    await assert.rejects(access(path.join(files(s), 'p/demo/manifest.json')));
  } finally { await s.stop(); }
});

test('rollback creates a new higher release with the old content; guards for bad targets', async () => {
  const { s, admin, tina, translate, release } = await world();
  try {
    await s.call('POST', P + '/keys/import', { apply: true, texts: { greeting: 'Hello {name}' } }, admin);
    await translate('greeting', 'Hallo {name}');
    await release(admin);                                                           // 1: "Hallo {name}"
    await translate('greeting', 'Guten Tag {name}');
    await release(admin);                                                           // 2: "Guten Tag {name}"
    const rb = (to: number, c = admin, body: object = {}) => s.call('POST', `${P}/releases/${to}/rollback`, body, c);
    assert.equal((await rb(1, tina)).status, 403);
    assert.equal((await rb(99)).status, 404);
    const ok = await rb(1, admin, { note: 'Bad wording' });
    assert.deepEqual([ok.status, ok.json.release, ok.json.rolledBackTo], [201, 3, 1]);
    assert.equal((await getLive(s, 'de')).greeting, 'Hallo {name}');
    assert.equal((await rb(1)).status, 409);                                        // that content is already live
    const h = (await s.call('GET', P + '/releases', undefined, admin)).json.releases;
    assert.deepEqual([h[0].number, h[0].rolledBackTo, h[0].note], [3, 1, 'Bad wording']);
    assert.equal((await fetch(`${s.base}/p/demo/manifest.json`).then((r) => r.json()) as { release: number }).release, 3);   // clients see a higher number
    const pv = (await s.call('GET', P + '/releases/preview', undefined, admin)).json;     // database now differs from what is live
    assert.equal(pv.hasChanges, true); assert.deepEqual(pv.changes.de.changed, ['greeting']);
    const pub = (await s.call('GET', '/api/v1/instance')).json.publicKey;
    await verifyRelease(files(s), 'demo', createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub }, format: 'jwk' }));
    // a failed release cannot be restored
    s.db.prepare("INSERT INTO releases (project_id, number, state, created_at) VALUES (1, 10, 'failed', 'now')").run();
    assert.equal((await rb(10)).status, 404);
  } finally { await s.stop(); }
});

test('a build interrupted by a restart does not block the project', async () => {
  const { s } = await world();
  try {
    s.db.prepare("INSERT INTO releases (project_id, number, state, created_at) VALUES (1, 1, 'building', 'now')").run();
    createReleases(s.db, createProjects(s.db), async () => Buffer.alloc(64), files(s));
    const row = s.db.prepare('SELECT state, failure_reason FROM releases WHERE number = 1').get() as { state: string; failure_reason: string };
    assert.deepEqual({ ...row }, { state: 'failed', failure_reason: 'interrupted by a restart' });
  } finally { await s.stop(); }
});
