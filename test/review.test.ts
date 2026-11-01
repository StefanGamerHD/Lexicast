import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PW, start } from './harness.ts';
import { softWarnings } from '../src/review/warnings.ts';

type S = Awaited<ReturnType<typeof start>>;
const LANGS = [{ tag: 'en' }, { tag: 'de', fallback: ['en'] }, { tag: 'de-AT', fallback: ['de', 'en'] }];
const P = '/api/v1/projects/demo';

// admin(owner) + tina(translator de) + rita(reviewer de) + sam(reviewer de-AT) + ben(translator de); key "greeting" = "Hello {name}"
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
  const sam = await mk('sam@example.com', 'reviewer', 'de-AT');
  const ben = await mk('ben@example.com', 'translator', 'de');
  await s.call('POST', P + '/keys', { name: 'greeting', sourceText: 'Hello {name}' }, admin);
  await s.call('POST', P + '/keys', { name: 'bye', sourceText: 'Goodbye', maxLength: 10 }, admin);
  const sug = (c: string, text: string, key = 'greeting', language = 'de') => s.call('POST', P + '/suggestions', { key, language, text }, c);
  const act = (c: string, id: number, what: string, body: object = {}) => s.call('POST', `${P}/suggestions/${id}/${what}`, body, c);
  return { s, admin, tina, rita, sam, ben, sug, act };
}
const tr = (s: S, lang = 'de'): { text: string; outdated: number } | undefined => {
  const r = s.db.prepare("SELECT t.text, t.outdated FROM translations t JOIN keys k ON k.id = t.key_id WHERE k.name = 'greeting' AND t.language = ?").get(lang) as { text: string; outdated: number } | undefined;
  return r ? { ...r } : undefined;
};

test('submitting: rules for language, role, key and text', async () => {
  const { s, admin, tina, sug } = await world();
  try {
    const ok = await sug(tina, 'Hallo {name}');
    assert.equal(ok.status, 201); assert.deepEqual(ok.json.warnings, []);
    assert.equal((await sug(tina, 'Hallo {nam}')).status, 400);                        // placeholder mismatch
    assert.equal((await sug(tina, 'Hallo {name')).status, 400);                        // broken braces
    assert.equal((await sug(tina, 'Hallo {name}', 'greeting', 'en')).status, 400);     // source language
    assert.equal((await sug(tina, 'Servus {name}', 'greeting', 'de-AT')).status, 403); // not her language
    assert.equal((await sug(tina, 'x', 'nope')).status, 404);
    assert.equal((await sug(tina, 'Auf Wiedersehen', 'bye')).status, 400);            // over maxLength 10
    assert.equal((await s.call('POST', P + '/suggestions', { key: 'greeting', language: 'xx', text: 'x' }, tina)).status, 400);
    assert.equal((await sug(admin, 'Servus {name}', 'greeting', 'de-AT')).status, 201); // owners may translate any language
    await s.call('PATCH', P + '/keys/bye', { state: 'deprecated' }, admin);
    assert.equal((await sug(tina, 'Tschüss', 'bye')).status, 409);
  } finally { await s.stop(); }
});

test('non-members cannot submit; one open suggestion per author, key and language', async () => {
  const { s, tina, sug } = await world();
  try {
    const stranger = (await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: PW })).cookie!;
    await s.db.exec("DELETE FROM members WHERE role = 'owner'"); // admin is no member any more
    assert.equal((await sug(stranger, 'Hallo {name}')).status, 404);
    const a = await sug(tina, 'Hallo {name}'); const b = await sug(tina, 'Hallo, {name}');
    const states = s.db.prepare('SELECT id, state FROM suggestions ORDER BY id').all() as { id: number; state: string }[];
    assert.deepEqual(states.map((x) => x.state), ['withdrawn', 'open']);
    assert.ok(b.json.id > a.json.id);
  } finally { await s.stop(); }
});

test('review queue: reviewers see their languages, translators only their own suggestions', async () => {
  const { s, tina, rita, sam, sug } = await world();
  try {
    await sug(tina, 'Hallo {name}');
    assert.equal((await s.call('GET', P + '/suggestions', undefined, tina)).status, 403);
    const q = await s.call('GET', P + '/suggestions', undefined, rita);
    assert.equal(q.json.total, 1);
    const item = q.json.suggestions[0];
    assert.deepEqual({ key: item.key, language: item.language, author: item.author, mine: item.mine, sourceChanged: item.sourceChanged, currentText: item.currentText, sourceText: item.sourceText }, { key: 'greeting', language: 'de', author: 'tina', mine: false, sourceChanged: false, currentText: null, sourceText: 'Hello {name}' });
    assert.equal((await s.call('GET', P + '/suggestions', undefined, sam)).json.total, 0);   // reviews de-AT only
    const mine = await s.call('GET', P + '/suggestions?mine=1', undefined, tina);
    assert.equal(mine.json.total, 1); assert.equal(mine.json.suggestions[0].mine, true);
    assert.equal((await s.call('GET', P + '/suggestions?state=bogus', undefined, rita)).status, 400);
  } finally { await s.stop(); }
});

test('approve: sets the current translation, supersedes the others, only reviewers of that language', async () => {
  const { s, admin, tina, rita, sam, ben, sug, act } = await world();
  try {
    const a = await sug(tina, 'Hallo {name}'); const b = await sug(ben, 'Guten Tag {name}');
    assert.equal((await act(tina, a.json.id, 'approve')).status, 403);        // translator
    assert.equal((await act(sam, a.json.id, 'approve')).status, 403);         // reviewer of another language
    const ok = await act(rita, a.json.id, 'approve');
    assert.deepEqual(ok.json, { approved: true, solo: false, superseded: 1 });
    assert.deepEqual(tr(s), { text: 'Hallo {name}', outdated: 0 });
    assert.equal((s.db.prepare('SELECT state FROM suggestions WHERE id = ?').get(b.json.id) as { state: string }).state, 'superseded');
    assert.equal((await act(rita, a.json.id, 'approve')).status, 409);       // already approved
    assert.equal((await act(rita, b.json.id, 'approve')).status, 409);       // superseded
    const row = s.db.prepare('SELECT reviewer_id, solo_approved, author_id FROM suggestions WHERE id = ?').get(a.json.id) as { reviewer_id: number; solo_approved: number; author_id: number };
    assert.notEqual(row.reviewer_id, row.author_id); assert.equal(row.solo_approved, 0);
    assert.equal((await sug(tina, 'Hallo {name}')).status, 409);              // same as current
    assert.ok((s.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'suggestion.approve'").get() as { n: number }).n === 1);
    void admin;
  } finally { await s.stop(); }
});

test('four-eyes: nobody approves their own text; solo mode is the logged exception and only for owners', async () => {
  const { s, admin, rita, sug, act } = await world();
  try {
    const own = await sug(rita, 'Hallo {name}');                                // reviewer's own suggestion
    assert.equal((await act(rita, own.json.id, 'approve')).status, 403);
    assert.equal((await act(rita, own.json.id, 'reject', { reason: 'x' })).status, 403);
    const ownerSug = await sug(admin, 'Moin {name}');
    assert.equal((await act(admin, ownerSug.json.id, 'approve')).status, 403);   // owner without solo mode
    assert.equal((await s.call('PATCH', P, { soloMode: true }, rita)).status, 403);
    assert.equal((await s.call('PATCH', P, { soloMode: 'yes' }, admin)).status, 400);
    assert.equal((await s.call('PATCH', P, { soloMode: true }, admin)).json.project.soloMode, true);
    assert.equal((await act(rita, own.json.id, 'approve')).status, 403);          // reviewer who is not an owner still cannot
    const ok = await act(admin, ownerSug.json.id, 'approve');
    assert.deepEqual([ok.status, ok.json.solo], [200, true]);
    assert.equal((s.db.prepare('SELECT solo_approved FROM suggestions WHERE id = ?').get(ownerSug.json.id) as { solo_approved: number }).solo_approved, 1);
    assert.equal((s.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'suggestion.approve.solo'").get() as { n: number }).n, 1);
  } finally { await s.stop(); }
});

test('reject needs a reason; the author sees it; withdraw only by the author', async () => {
  const { s, tina, rita, ben, sug, act } = await world();
  try {
    const a = await sug(tina, 'Hallo {name}');
    assert.equal((await act(rita, a.json.id, 'reject', {})).status, 400);
    assert.equal((await act(rita, a.json.id, 'reject', { reason: '   ' })).status, 400);
    assert.equal((await act(tina, a.json.id, 'reject', { reason: 'mine' })).status, 403);
    assert.equal((await act(ben, a.json.id, 'withdraw')).status, 403);
    assert.equal((await act(rita, a.json.id, 'reject', { reason: 'Please use "Guten Tag"' })).status, 200);
    const mine = (await s.call('GET', P + '/suggestions?mine=1', undefined, tina)).json.suggestions[0];
    assert.deepEqual([mine.state, mine.rejectReason], ['rejected', 'Please use "Guten Tag"']);
    assert.equal((await act(tina, a.json.id, 'withdraw')).status, 409);          // no longer open
    const b = await sug(tina, 'Guten Tag {name}');
    assert.equal((await act(tina, b.json.id, 'withdraw')).status, 200);
    assert.equal((await act(rita, b.json.id, 'approve')).status, 409);
    assert.equal(tr(s), undefined);
  } finally { await s.stop(); }
});

test('source text changed after the suggestion: flagged and cannot be approved', async () => {
  const { s, admin, tina, rita, sug, act } = await world();
  try {
    const a = await sug(tina, 'Hallo {name}');
    await s.call('PATCH', P + '/keys/greeting', { sourceText: 'Hi {name}!' }, admin);
    const item = (await s.call('GET', P + '/suggestions', undefined, rita)).json.suggestions[0];
    assert.equal(item.sourceChanged, true); assert.equal(item.sourceText, 'Hi {name}!');
    const r = await act(rita, a.json.id, 'approve');
    assert.deepEqual([r.status, r.json.error.code], [409, 'source_changed']);
    assert.equal(tr(s), undefined);
    assert.equal((await act(rita, a.json.id, 'reject', { reason: 'source changed' })).status, 200);
    const again = await sug(tina, 'Hallo {name}!');
    assert.equal((await act(rita, again.json.id, 'approve')).status, 200);
    // translation becomes outdated again when the source changes later, and a new suggestion may restate it
    await s.call('PATCH', P + '/keys/greeting', { sourceText: 'Hey {name}!' }, admin);
    assert.equal(tr(s)!.outdated, 1);
    assert.equal((await sug(tina, 'Hallo {name}!')).status, 201);
  } finally { await s.stop(); }
});

test('concurrent approvals: exactly one wins', async () => {
  const { s, tina, rita, ben, sug, act } = await world();
  try {
    const a = await sug(tina, 'Hallo {name}');
    const same = await Promise.all([act(rita, a.json.id, 'approve'), act(rita, a.json.id, 'approve')]);
    assert.deepEqual(same.map((r) => r.status).sort(), [200, 409]);
    const b = await sug(tina, 'Guten Tag {name}'); const c = await sug(ben, 'Moin {name}');
    const two = await Promise.all([act(rita, b.json.id, 'approve'), act(rita, c.json.id, 'approve')]);
    assert.deepEqual(two.map((r) => r.status).sort(), [200, 409]);                 // the loser was superseded
    assert.equal((s.db.prepare("SELECT COUNT(*) AS n FROM suggestions WHERE state = 'approved'").get() as { n: number }).n, 2);
  } finally { await s.stop(); }
});

test('a user cannot hold more than 100 open suggestions per project', async () => {
  const { s, tina, sug } = await world();
  try {
    const tinaId = (s.db.prepare("SELECT id FROM users WHERE email = 'tina@example.com'").get() as { id: number }).id;
    const keyId = (s.db.prepare("SELECT id FROM keys WHERE name = 'greeting'").get() as { id: number }).id;
    for (let i = 0; i < 100; i++) s.db.prepare("INSERT INTO suggestions (key_id, language, text, author_id, created_at, source_snapshot) VALUES (?, 'de-AT', ?, ?, 'now', 'x')").run(keyId, 't' + i, tinaId);
    assert.equal((await sug(tina, 'Hallo {name}')).status, 429);
  } finally { await s.stop(); }
});

test('soft warnings', () => {
  assert.deepEqual(softWarnings('Hello there', 'Hello there'), ['same_as_source']);
  assert.ok(softWarnings('Please visit https://evil.example now', 'Please visit us now').includes('new_url_or_email'));
  assert.ok(!softWarnings('Visit https://a.example', 'Visit https://a.example today').includes('new_url_or_email'));
  assert.ok(softWarnings('<b>Hi</b>', 'Hi').includes('looks_like_markup'));
  assert.ok(!softWarnings('<b>Hi</b>', '<b>Hi</b>').includes('looks_like_markup'));
  assert.ok(softWarnings('Hallo Welt, das ist ein sehr sehr langer Text', 'Hello you').includes('much_longer'));
  assert.ok(softWarnings('Ok.', 'Save your changes before leaving').includes('much_shorter'));
  assert.ok(softWarnings('Gespeichert', 'Saved.').includes('punctuation_differs'));
  assert.ok(softWarnings(' Hallo', 'Hello').includes('whitespace_differs'));
  assert.deepEqual(softWarnings('Hallo Welt', 'Hello world'), []);
});
