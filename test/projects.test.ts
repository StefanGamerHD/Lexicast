import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PW, start } from './harness.ts';

type S = Awaited<ReturnType<typeof start>>;
const LANGS = [{ tag: 'en' }, { tag: 'de', fallback: ['en'] }, { tag: 'de-AT', fallback: ['de', 'en'] }];

// admin + project "demo" (admin = owner) + translator Tina (de) + reviewer Rita (de) + stranger Sam (no membership)
async function world() {
  const s = await start({ LEXICAST_AUTH_RATE_PER_MINUTE: '0' });
  const admin = await s.setup();
  const mkUser = async (email: string) => {
    const inv = await s.call('POST', '/api/v1/invitations', { email }, admin.cookie!);
    const r = await s.call('POST', '/api/v1/invitations/accept', { token: inv.json.inviteUrl.split('/invite/')[1], displayName: email, password: PW });
    return r.cookie!;
  };
  const tina = await mkUser('tina@example.com'), rita = await mkUser('rita@example.com'), sam = await mkUser('sam@example.com');
  const p = await s.call('POST', '/api/v1/projects', { slug: 'demo', name: 'Demo', sourceLanguage: 'en', languages: LANGS }, admin.cookie!);
  assert.equal(p.status, 201);
  await s.call('POST', '/api/v1/projects/demo/members', { email: 'tina@example.com', role: 'translator', language: 'de' }, admin.cookie!);
  await s.call('POST', '/api/v1/projects/demo/members', { email: 'rita@example.com', role: 'reviewer', language: 'de' }, admin.cookie!);
  return { s, admin: admin.cookie!, tina, rita, sam };
}
const keysUrl = '/api/v1/projects/demo/keys';
const imp = (s: S, c: string, texts: unknown, extra: object = {}) => s.call('POST', keysUrl + '/import', { texts, ...extra }, c);

test('project creation: instance admin only, validation, creator becomes owner', async () => {
  const { s, admin, tina } = await world();
  try {
    assert.equal((await s.call('POST', '/api/v1/projects', { slug: 'x', name: 'X', sourceLanguage: 'en', languages: LANGS }, tina)).status, 403);
    const bad = (over: object) => s.call('POST', '/api/v1/projects', { slug: 'p2', name: 'P2', sourceLanguage: 'en', languages: LANGS, ...over }, admin);
    assert.equal((await bad({ slug: 'Bad Slug' })).status, 400);
    assert.equal((await bad({ sourceLanguage: 'fr' })).status, 400);                          // source not among languages
    assert.equal((await bad({ languages: [{ tag: 'en' }, { tag: 'de', fallback: ['fr'] }] })).status, 400); // unknown fallback
    assert.equal((await bad({ languages: [{ tag: 'en' }, { tag: 'de', fallback: ['de'] }] })).status, 400); // self fallback
    assert.equal((await bad({ languages: [{ tag: 'en' }, { tag: 'en' }] })).status, 400);    // duplicate
    assert.equal((await bad({ slug: 'demo' })).status, 409);
    const mine = await s.call('GET', '/api/v1/projects', undefined, admin);
    assert.deepEqual(mine.json.projects, [{ slug: 'demo', name: 'Demo', roles: ['owner'] }]);
  } finally { await s.stop(); }
});

test('access: non-members get 404, instance admin has no implicit access, roles are reported', async () => {
  const { s, tina, sam } = await world();
  try {
    assert.equal((await s.call('GET', '/api/v1/projects/demo', undefined, sam)).status, 404);
    assert.equal((await s.call('GET', keysUrl, undefined, sam)).status, 404);
    assert.equal((await s.call('GET', '/api/v1/projects/nope', undefined, tina)).status, 404);
    const r = await s.call('GET', '/api/v1/projects/demo', undefined, tina);
    assert.deepEqual(r.json.roles, { owner: false, reviewer: [], translator: ['de'] });
    assert.equal((await s.call('GET', '/api/v1/projects')).status, 401);
    // a second instance admin does not exist, but an admin who is not a member would get 404 too
    await s.db.exec("INSERT INTO projects (slug, name, source_language, created_at) VALUES ('other', 'Other', 'en', 'now')");
    assert.equal((await s.call('GET', '/api/v1/projects/other', undefined, (await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: PW })).cookie!)).status, 404);
  } finally { await s.stop(); }
});

test('members: only owners manage; existing user added at once, unknown email gets an invitation that adds membership; last owner protected', async () => {
  const { s, admin, tina, sam } = await world();
  try {
    assert.equal((await s.call('GET', '/api/v1/projects/demo/members', undefined, tina)).status, 403);
    assert.equal((await s.call('POST', '/api/v1/projects/demo/members', { email: 'sam@example.com', role: 'translator', language: 'de' }, tina)).status, 403);
    assert.equal((await s.call('POST', '/api/v1/projects/demo/members', { email: 'sam@example.com', role: 'translator', language: 'xx' }, admin)).status, 400);
    assert.equal((await s.call('POST', '/api/v1/projects/demo/members', { email: 'sam@example.com', role: 'king', language: 'de' }, admin)).status, 400);
    assert.deepEqual((await s.call('POST', '/api/v1/projects/demo/members', { email: 'sam@example.com', role: 'translator', language: 'de-AT' }, admin)).json, { added: true });
    assert.equal((await s.call('GET', '/api/v1/projects/demo', undefined, sam)).status, 200);
    const inv = await s.call('POST', '/api/v1/projects/demo/members', { email: 'newbie@example.com', role: 'reviewer', language: 'de' }, admin);
    assert.equal(inv.status, 201);
    const acc = await s.call('POST', '/api/v1/invitations/accept', { token: inv.json.inviteUrl.split('/invite/')[1], displayName: 'Newbie', password: PW });
    assert.deepEqual((await s.call('GET', '/api/v1/projects/demo', undefined, acc.cookie!)).json.roles, { owner: false, reviewer: ['de'], translator: [] });
    const adminId = (await s.call('GET', '/api/v1/me', undefined, admin)).json.user.id;
    assert.equal((await s.call('POST', '/api/v1/projects/demo/members/remove', { userId: adminId, role: 'owner' }, admin)).status, 409);
    const samId = (s.db.prepare("SELECT id FROM users WHERE email = 'sam@example.com'").get() as { id: number }).id;
    assert.equal((await s.call('POST', '/api/v1/projects/demo/members/remove', { userId: samId, role: 'translator', language: 'de-AT' }, admin)).status, 200);
    assert.equal((await s.call('GET', '/api/v1/projects/demo', undefined, sam)).status, 404);
  } finally { await s.stop(); }
});

test('keys: owner creates and edits; others cannot; validation and limits', async () => {
  const { s, admin, tina, rita } = await world();
  try {
    const mk = (c: string, b: object) => s.call('POST', keysUrl, b, c);
    assert.equal((await mk(tina, { name: 'a.b', sourceText: 'Hi' })).status, 403);
    assert.equal((await mk(admin, { name: 'a b', sourceText: 'Hi' })).status, 400);
    assert.equal((await mk(admin, { name: 'a.b', sourceText: 'Hi {name' })).status, 400);
    assert.equal((await mk(admin, { name: 'a.b', sourceText: 'Hello', maxLength: 3 })).status, 400);
    assert.equal((await mk(admin, { name: 'a.b', sourceText: 'Hi {name}', contextNote: 'Greeting on top', maxLength: 50 })).status, 201);
    assert.equal((await mk(admin, { name: 'a.b', sourceText: 'Again' })).status, 409);
    const list = await s.call('GET', keysUrl, undefined, tina);
    assert.equal(list.json.total, 1);
    assert.equal(list.json.keys[0].contextNote, 'Greeting on top');
    // source change marks translations outdated
    const id = (s.db.prepare("SELECT id FROM keys WHERE name = 'a.b'").get() as { id: number }).id;
    s.db.prepare("INSERT INTO translations (key_id, language, text, approved_at) VALUES (?, 'de', 'Hallo {name}', 'now'), (?, 'fr', 'Salut {name}', 'now')").run(id, id);
    const patch = (c: string, b: object) => s.call('PATCH', keysUrl + '/a.b', b, c);
    assert.equal((await patch(rita, { sourceText: 'Hey {name}' })).status, 403);
    assert.deepEqual((await patch(admin, { sourceText: 'Hey {name}' })).json, { name: 'a.b', outdatedMarked: true });
    assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM translations WHERE outdated = 1').get() as { n: number }).n, 2);
    // translators only see translations of their own language
    const seen = (await s.call('GET', keysUrl, undefined, tina)).json.keys[0].translations;
    assert.deepEqual(Object.keys(seen), ['de']);
    assert.equal(seen.de.outdated, true);
    assert.deepEqual(Object.keys((await s.call('GET', keysUrl, undefined, admin)).json.keys[0].translations).sort(), ['de', 'fr']);
    assert.equal((await patch(admin, { state: 'bogus' })).status, 400);
    assert.equal((await s.call('PATCH', keysUrl + '/missing', { state: 'active' }, admin)).status, 404);
  } finally { await s.stop(); }
});

test('import: preview does not change data; apply adds/changes; nested JSON; removed keys are only deprecated on request; reactivation', async () => {
  const { s, admin, tina } = await world();
  try {
    assert.equal((await imp(s, tina, { a: 'x' })).status, 403);
    const first = await imp(s, admin, { nav: { home: 'Home', logout: 'Log out' }, greeting: 'Hello {name}' });
    assert.equal(first.status, 200);
    assert.equal(first.json.applied, false);
    assert.deepEqual(first.json.added.sort(), ['greeting', 'nav.home', 'nav.logout']);
    assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM keys').get() as { n: number }).n, 0);          // preview wrote nothing
    assert.equal((await imp(s, admin, { nav: { home: 'Home', logout: 'Log out' }, greeting: 'Hello {name}' }, { apply: true })).json.applied, true);
    assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM keys').get() as { n: number }).n, 3);
    const id = (s.db.prepare("SELECT id FROM keys WHERE name = 'greeting'").get() as { id: number }).id;
    s.db.prepare("INSERT INTO translations (key_id, language, text, approved_at) VALUES (?, 'de', 'Hallo {name}', 'now')").run(id);
    // change one text, drop one key
    const second = await imp(s, admin, { nav: { home: 'Start' }, greeting: 'Hi {name}' });
    assert.deepEqual(second.json.changed.sort(), ['greeting', 'nav.home']);
    assert.deepEqual(second.json.removed, ['nav.logout']);
    await imp(s, admin, { nav: { home: 'Start' }, greeting: 'Hi {name}' }, { apply: true });           // without deprecateMissing
    assert.equal((s.db.prepare("SELECT state FROM keys WHERE name = 'nav.logout'").get() as { state: string }).state, 'active');
    assert.equal((s.db.prepare('SELECT outdated FROM translations WHERE key_id = ?').get(id) as { outdated: number }).outdated, 1);
    const third = await imp(s, admin, { nav: { home: 'Start' }, greeting: 'Hi {name}' }, { apply: true, deprecateMissing: true });
    assert.equal(third.json.removedAreDeprecated, true);
    assert.equal((s.db.prepare("SELECT state FROM keys WHERE name = 'nav.logout'").get() as { state: string }).state, 'deprecated');
    assert.equal((await s.call('GET', keysUrl + '?state=deprecated', undefined, admin)).json.total, 1);
    const back = await imp(s, admin, { nav: { home: 'Start', logout: 'Log out' }, greeting: 'Hi {name}' }, { apply: true });
    assert.deepEqual(back.json.reactivated, ['nav.logout']);
    assert.equal((s.db.prepare("SELECT state FROM keys WHERE name = 'nav.logout'").get() as { state: string }).state, 'active');
  } finally { await s.stop(); }
});

test('import is all-or-nothing and rejects bad input', async () => {
  const { s, admin } = await world();
  try {
    const count = () => (s.db.prepare('SELECT COUNT(*) AS n FROM keys').get() as { n: number }).n;
    const bad = await imp(s, admin, { ok: 'Fine', broken: 'Hello {name', bidi: 'a‮b' }, { apply: true });
    assert.equal(bad.status, 400); assert.match(bad.json.error.message, /2 invalid/); assert.equal(count(), 0);
    assert.equal((await imp(s, admin, { n: 5 })).status, 400);                      // not a string
    assert.equal((await imp(s, admin, { 'bad name': 'x' })).status, 400);          // invalid key name
    assert.equal((await imp(s, admin, { a: ['x'] })).status, 400);                 // arrays not supported
    let deep: Record<string, unknown> = { leaf: 'x' }; for (let i = 0; i < 10; i++) deep = { n: deep };
    assert.equal((await imp(s, admin, deep)).status, 400);                         // too deep
    const many: Record<string, string> = {}; for (let i = 0; i < 5001; i++) many['k' + i] = 'x';
    const tooMany = await s.call('POST', keysUrl + '/import', { texts: many }, admin);          // ~75 KB body: passes the import limit, fails the key count
    assert.equal(tooMany.status, 400); assert.match(tooMany.json.error.message, /more than 5000 keys/);
    const huge = await s.call('POST', keysUrl + '/import', { texts: { a: 'x'.repeat(2.1 * 1024 * 1024) } }, admin);
    assert.equal(huge.status, 413);
  } finally { await s.stop(); }
});

test('key search escapes LIKE wildcards; paging is bounded', async () => {
  const { s, admin } = await world();
  try {
    await imp(s, admin, { a_b: '100% done', axb: 'plain', other: 'Something' }, { apply: true });
    const q = async (search: string) => (await s.call('GET', keysUrl + '?search=' + encodeURIComponent(search), undefined, admin)).json;
    assert.equal((await q('a_b')).total, 1);                 // _ is literal, not "any char"
    assert.equal((await q('%')).total, 1);                   // % matches only the real percent sign
    assert.equal((await q('100%')).total, 1);
    assert.equal((await s.call('GET', keysUrl + '?limit=1', undefined, admin)).json.keys.length, 1);
    assert.equal((await s.call('GET', keysUrl + '?limit=999999', undefined, admin)).json.keys.length, 3);
  } finally { await s.stop(); }
});

test('language fallback can be changed by owners only and stays valid', async () => {
  const { s, admin, tina } = await world();
  try {
    const put = (c: string, tag: string, fallback: unknown) => s.call('PUT', '/api/v1/projects/demo/languages/' + tag, { fallback }, c);
    assert.equal((await put(tina, 'de-AT', ['en'])).status, 403);
    assert.equal((await put(admin, 'de-AT', ['xx'])).status, 400);
    const ok = await put(admin, 'de-AT', ['en']);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.project.languages.find((l: { tag: string }) => l.tag === 'de-AT').fallback, ['en']);
    const fr = await put(admin, 'fr', ['de']);                                       // adds a language
    assert.equal(fr.json.project.languages.length, 4);
  } finally { await s.stop(); }
});

test('changes are written to the audit log without personal data in the entry text', async () => {
  const { s, admin } = await world();
  try {
    await imp(s, admin, { a: 'x' }, { apply: true });
    const rows = s.db.prepare("SELECT action, project_slug, actor_pseudonym FROM audit_log WHERE project_slug = 'demo' ORDER BY id").all() as { action: string; project_slug: string; actor_pseudonym: string }[];
    const actions = rows.map((r) => r.action);
    for (const a of ['project.create', 'member.add', 'key.import']) assert.ok(actions.includes(a), a);
    assert.ok(rows.every((r) => /^u-[0-9a-f]{12}$/.test(r.actor_pseudonym)));
  } finally { await s.stop(); }
});

test('project overview counts and open-suggestion counts per key, limited to visible languages', async () => {
  const { s, admin, tina, rita, sam } = await world();
  try {
    assert.equal((await imp(s, admin, { a: 'Hello {name}', b: 'Bye' }, { apply: true })).status, 200);
    const sub = (c: string, language: string, text: string) => s.call('POST', '/api/v1/projects/demo/suggestions', { key: 'a', language, text }, c);
    assert.equal((await sub(tina, 'de', 'Hallo {name}')).status, 201);
    assert.equal((await sub(admin, 'de-AT', 'Servus {name}')).status, 201);

    const r = await s.call('GET', '/api/v1/projects/demo', undefined, tina);
    const de = r.json.progress.languages.find((l: { tag: string }) => l.tag === 'de');
    assert.deepEqual({ ...de }, { tag: 'de', translated: 0, total: 2, percent: 0, inReview: 1, outdated: 0, isSource: false });
    assert.equal(r.json.progress.liveRelease, null);

    const keysOf = async (c: string) => (await s.call('GET', keysUrl, undefined, c)).json.keys as { name: string; openSuggestions: Record<string, number> }[];
    assert.deepEqual((await keysOf(tina)).find((k) => k.name === 'a')!.openSuggestions, { de: 1 });          // de-AT is not Tina's language
    assert.deepEqual((await keysOf(admin)).find((k) => k.name === 'a')!.openSuggestions, { de: 1, 'de-AT': 1 });
    assert.deepEqual((await keysOf(rita)).find((k) => k.name === 'b')!.openSuggestions, {});
    assert.equal((await s.call('GET', '/api/v1/projects/demo', undefined, sam)).status, 404);
  } finally { await s.stop(); }
});

test('pending project invitations: owners list and revoke them; a revoked link no longer works', async () => {
  const { s, admin, tina } = await world();
  try {
    const inv = await s.call('POST', '/api/v1/projects/demo/members', { email: 'nina@example.com', role: 'translator', language: 'de-AT' }, admin);
    assert.equal(inv.status, 201);
    const token = (inv.json.inviteUrl as string).split('/invite/')[1];
    await s.call('POST', '/api/v1/projects/demo/members', { email: 'otto@example.com', role: 'reviewer', language: 'de' }, admin);

    const list = await s.call('GET', '/api/v1/projects/demo/invitations', undefined, admin);
    assert.equal(list.status, 200);
    const nina = list.json.invitations.find((i: { email: string }) => i.email === 'nina@example.com');
    assert.deepEqual({ email: nina.email, role: nina.role, language: nina.language, expired: nina.expired }, { email: 'nina@example.com', role: 'translator', language: 'de-AT', expired: false });
    assert.equal(list.json.invitations.length, 2);
    assert.equal((await s.call('GET', '/api/v1/projects/demo/invitations', undefined, tina)).status, 403);
    assert.equal((await s.call('POST', `/api/v1/projects/demo/invitations/${nina.id}/revoke`, {}, tina)).status, 403);

    assert.equal((await s.call('POST', `/api/v1/projects/demo/invitations/${nina.id}/revoke`, {}, admin)).status, 200);
    assert.equal((await s.call('POST', `/api/v1/projects/demo/invitations/${nina.id}/revoke`, {}, admin)).status, 404);
    assert.equal((await s.call('GET', '/api/v1/projects/demo/invitations', undefined, admin)).json.invitations.length, 1);
    const accept = await s.call('POST', '/api/v1/invitations/accept', { token, displayName: 'Nina', password: PW });
    assert.equal(accept.status, 400);
    assert.equal(accept.json.error.code, 'invalid_invitation');
  } finally { await s.stop(); }
});

test('invitations past their expiry are listed as expired and can still be revoked; the revocation is audited', async () => {
  const { s, admin } = await world();
  try {
    assert.equal((await s.call('POST', '/api/v1/projects/demo/members', { email: 'old@example.com', role: 'reviewer', language: 'de' }, admin)).status, 201);
    const list = async () => (await s.call('GET', '/api/v1/projects/demo/invitations', undefined, admin)).json.invitations as { id: number; expired: boolean }[];
    const [inv] = await list();
    assert.equal(inv!.expired, false);
    // the service compares stored ISO timestamps with the current time; move the expiry around it
    const setExpiry = (ms: number) => s.db.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run(new Date(Date.now() + ms).toISOString(), inv!.id);
    setExpiry(60_000);
    assert.equal((await list())[0]!.expired, false);
    setExpiry(-60_000);
    assert.equal((await list())[0]!.expired, true);
    assert.equal((await s.call('POST', `/api/v1/projects/demo/invitations/${inv!.id}/revoke`, {}, admin)).status, 200);
    const entry = s.db.prepare("SELECT details FROM audit_log WHERE action = 'member.invite.revoke'").get() as { details: string };
    assert.deepEqual(JSON.parse(entry.details), { role: 'reviewer', language: 'de' });
  } finally { await s.stop(); }
});
