import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { createMailer, inline } from '../src/mail/mailer.ts';
import { PW, start } from './harness.ts';

const MAIL = { LEXICAST_MAIL: 'file', LEXICAST_MAIL_FROM: 'Lexicast <noreply@example.com>', LEXICAST_AUTH_RATE_PER_MINUTE: '0' };
const P = '/api/v1/projects/demo';
const linkIn = (text: string, kind: 'invite' | 'reset') => new RegExp(`http://127\\.0\\.0\\.1:\\d+/${kind}/([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? '';

test('config: mail settings are validated', () => {
  assert.throws(() => loadConfig({ LEXICAST_MAIL: 'smtp', LEXICAST_MAIL_FROM: 'a@example.com' }), /LEXICAST_SMTP_HOST/);
  assert.throws(() => loadConfig({ LEXICAST_MAIL: 'smtp', LEXICAST_SMTP_HOST: 'smtp.example.com' }), /LEXICAST_MAIL_FROM/);
  assert.throws(() => loadConfig({ LEXICAST_MAIL: 'smtp', LEXICAST_SMTP_HOST: 'smtp.example.com', LEXICAST_MAIL_FROM: 'a@example.com', LEXICAST_SMTP_SECURITY: 'none' }), /only allowed for localhost/);
  assert.throws(() => loadConfig({ LEXICAST_MAIL: 'smtp', LEXICAST_SMTP_HOST: 'x.example.com', LEXICAST_MAIL_FROM: 'Evil\r\nBcc: x@y.z <a@example.com>' }), /LEXICAST_MAIL_FROM/);
  assert.throws(() => loadConfig({ LEXICAST_MAIL: 'carrier-pigeon' }), /LEXICAST_MAIL/);
  assert.throws(() => loadConfig({ LEXICAST_DEFAULT_LOCALE: 'fr' }), /LEXICAST_DEFAULT_LOCALE/);
  const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'pw-')), 'secret'); writeFileSync(f, 'from-file\n');
  const c = loadConfig({ LEXICAST_MAIL: 'smtp', LEXICAST_SMTP_HOST: 'smtp.example.com', LEXICAST_MAIL_FROM: 'a@example.com', LEXICAST_SMTP_PASSWORD_FILE: f });
  assert.deepEqual([c.mail.smtp.password, c.mail.smtp.port, c.mail.smtp.security], ['from-file', 587, 'starttls']);
  assert.equal(loadConfig({}).mail.mode, 'off');
});

test('invitation by mail: link only in the mail, language of the inviter, project details', async () => {
  const s = await start(MAIL);
  try {
    const admin = (await s.setup()).cookie!;
    await s.call('PATCH', '/api/v1/me', { uiLocale: 'de' }, admin);
    const r = await s.call('POST', '/api/v1/invitations', { email: 'Anna@Example.com' }, admin);
    assert.deepEqual(r.json, { sent: true });                                            // no link in the response
    const [m] = await s.outbox();
    assert.deepEqual([m!.to, m!.from], ['anna@example.com', 'Lexicast <noreply@example.com>']);
    assert.match(m!.subject, /^Einladung zu Lexicast/); assert.match(m!.text, /7 Tage gültig/);
    const token = linkIn(m!.text, 'invite');
    assert.equal((await s.call('POST', '/api/v1/invitations/accept', { token, displayName: 'Anna', password: PW })).status, 201);
    // project invitation (English: account of the inviter is German, so German again; check project and role)
    await s.call('POST', '/api/v1/projects', { slug: 'demo', name: 'Finanztracker', sourceLanguage: 'en', languages: [{ tag: 'en' }, { tag: 'de' }] }, admin);
    const p = await s.call('POST', P + '/members', { email: 'ben@example.com', role: 'reviewer', language: 'de' }, admin);
    assert.deepEqual(p.json, { sent: true });
    const pm = (await s.outbox()).at(-1)!;
    assert.match(pm.subject, /Finanztracker/); assert.match(pm.text, /Prüfer \(de\)/);
    // an existing account is added directly, no mail
    const before = (await s.outbox()).length;
    assert.deepEqual((await s.call('POST', P + '/members', { email: 'anna@example.com', role: 'translator', language: 'de' }, admin)).json, { added: true });
    assert.equal((await s.outbox()).length, before);
  } finally { await s.stop(); }
});

test('without mail the inviter still gets the link; a failing mail server does not lose the invitation', async () => {
  const off = await start({ LEXICAST_AUTH_RATE_PER_MINUTE: '0' });
  try {
    const admin = (await off.setup()).cookie!;
    assert.match((await off.call('POST', '/api/v1/invitations', { email: 'a@example.com' }, admin)).json.inviteUrl, /\/invite\//);
    assert.equal((await off.call('GET', '/api/v1/me', undefined, admin)).json.mailEnabled, false);
  } finally { await off.stop(); }
  const down = await start({ LEXICAST_MAIL: 'smtp', LEXICAST_SMTP_HOST: '127.0.0.1', LEXICAST_SMTP_PORT: '9', LEXICAST_SMTP_SECURITY: 'none', LEXICAST_MAIL_FROM: 'noreply@example.com', LEXICAST_AUTH_RATE_PER_MINUTE: '0' });
  try {
    const admin = (await down.setup()).cookie!;
    const r = await down.call('POST', '/api/v1/invitations', { email: 'a@example.com' }, admin);
    assert.deepEqual([r.status, r.json.sent, r.json.mailError], [201, false, true]);
    assert.match(r.json.inviteUrl, /\/invite\//);
  } finally { await down.stop(); }
});

test('password reset: no account enumeration, single use, expiry, signs everyone out, hourly limit', async () => {
  let t = Date.now();
  const s = await start(MAIL, () => t);
  try {
    const admin = (await s.setup()).cookie!;
    const req = (email: string) => s.call('POST', '/api/v1/auth/password-reset/request', { email });
    const known = await req('admin@example.com'); const unknown = await req('nobody@example.com'); const junk = await req('not-an-email');
    assert.deepEqual([known.status, unknown.status, junk.status], [202, 202, 202]);
    assert.deepEqual(known.json, unknown.json);
    await new Promise((r) => setTimeout(r, 100));
    const mails = await s.outbox();
    assert.equal(mails.length, 1); assert.equal(mails[0]!.to, 'admin@example.com');
    const token = linkIn(mails[0]!.text, 'reset');
    const confirm = (tok: string, password: string) => s.call('POST', '/api/v1/auth/password-reset/confirm', { token: tok, password });
    assert.equal((await confirm('garbage', 'a-new-long-password-1')).status, 400);
    assert.equal((await confirm(token, 'short')).status, 400);
    assert.equal((await s.call('GET', '/api/v1/me', undefined, admin)).status, 200);
    assert.equal((await confirm(token, 'a-new-long-password-1')).status, 200);
    assert.equal((await s.call('GET', '/api/v1/me', undefined, admin)).status, 401);          // old session ended
    assert.equal((await confirm(token, 'another-long-password-2')).status, 400);               // single use
    assert.equal((await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: PW })).status, 401);
    assert.equal((await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: 'a-new-long-password-1' })).status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assert.match((await s.outbox()).at(-1)!.subject, /password was changed/);
    // at most 3 reset mails per hour, silently
    const n0 = (await s.outbox()).length;
    for (let i = 0; i < 4; i++) await req('admin@example.com');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await s.outbox()).length - n0, 2);                                            // limit is 3 per hour and one was already used
    // expiry
    t += 2 * 3600_000;
    await req('admin@example.com'); await new Promise((r) => setTimeout(r, 100));
    const last = linkIn((await s.outbox()).at(-1)!.text, 'reset');
    t += 61 * 60_000;
    assert.equal((await confirm(last, 'yet-another-long-password-3')).status, 400);
  } finally { await s.stop(); }
});

test('password reset needs configured mail; reset also lifts a lockout', async () => {
  const off = await start({ LEXICAST_AUTH_RATE_PER_MINUTE: '0' });
  try { assert.equal((await off.call('POST', '/api/v1/auth/password-reset/request', { email: 'a@example.com' })).status, 503); } finally { await off.stop(); }
  const s = await start(MAIL);
  try {
    await s.setup();
    for (let i = 0; i < 5; i++) await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: 'wrong-wrong-wrong' });
    assert.equal((await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: PW })).status, 429);
    await s.call('POST', '/api/v1/auth/password-reset/request', { email: 'admin@example.com' }); await new Promise((r) => setTimeout(r, 100));
    const tok = linkIn((await s.outbox())[0]!.text, 'reset');
    await s.call('POST', '/api/v1/auth/password-reset/confirm', { token: tok, password: 'fresh-long-password-9' });
    assert.equal((await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: 'fresh-long-password-9' })).status, 200);
  } finally { await s.stop(); }
});

test('change password and profile: current password required, other sessions end, validation, opt-out', async () => {
  const s = await start(MAIL);
  try {
    const a = (await s.setup()).cookie!;
    const b = (await s.call('POST', '/api/v1/auth/login', { email: 'admin@example.com', password: PW })).cookie!;   // second session
    const change = (c: string, cur: string, next: string) => s.call('POST', '/api/v1/me/password', { currentPassword: cur, newPassword: next }, c);
    assert.equal((await change(a, 'wrong', 'a-new-long-password-1')).status, 403);
    assert.equal((await change(a, PW, 'short')).status, 400);
    assert.equal((await change(a, PW, PW)).status, 400);
    assert.equal((await change(a, PW, 'a-new-long-password-1')).status, 200);
    assert.equal((await s.call('GET', '/api/v1/me', undefined, a)).status, 200);            // current session stays
    assert.equal((await s.call('GET', '/api/v1/me', undefined, b)).status, 401);            // the other one ends
    const patch = (body: object) => s.call('PATCH', '/api/v1/me', body, a);
    assert.equal((await patch({ uiLocale: 'fr' })).status, 400);
    assert.equal((await patch({ theme: 'neon' })).status, 400);
    assert.equal((await patch({ notifyEmail: 'no' })).status, 400);
    assert.equal((await patch({ displayName: 'Bad\nName' })).status, 400);
    assert.equal((await patch({ displayName: '   ' })).status, 400);
    const ok = await patch({ displayName: ' Stefan ', uiLocale: 'de', theme: 'dark', notifyEmail: false });
    assert.deepEqual([ok.json.user.displayName, ok.json.user.uiLocale, ok.json.user.theme, ok.json.user.notifyEmail], ['Stefan', 'de', 'dark', false]);
    assert.equal((await s.call('GET', '/api/v1/me', undefined, a)).json.user.theme, 'dark');
  } finally { await s.stop(); }
});

async function digestWorld() {
  const s = await start(MAIL);
  const admin = (await s.setup()).cookie!;
  await s.call('POST', '/api/v1/projects', { slug: 'demo', name: 'Demo', sourceLanguage: 'en', languages: [{ tag: 'en' }, { tag: 'de', fallback: ['en'] }] }, admin);
  const mk = async (email: string, role: string) => {
    await s.call('POST', P + '/members', { email, role, language: 'de' }, admin);
    const m = (await s.outbox()).at(-1)!;
    const c = (await s.call('POST', '/api/v1/invitations/accept', { token: linkIn(m.text, 'invite'), displayName: email.split('@')[0], password: PW })).cookie!;
    return c;
  };
  const tina = await mk('tina@example.com', 'translator'); const rita = await mk('rita@example.com', 'reviewer');
  await s.call('POST', P + '/keys/import', { apply: true, texts: { a: 'One', b: 'Two', c: 'Three' } }, admin);
  return { s, admin, tina, rita };
}
const to = async (s: Awaited<ReturnType<typeof start>>, addr: string) => (await s.outbox()).filter((m) => m.to === addr && /news in your projects|Neuigkeiten/.test(m.subject));

test('digest: one mail per person, grouped, never to the actor, nothing twice', async () => {
  const { s, admin, tina, rita } = await digestWorld();
  try {
    const sg = async (key: string) => (await s.call('POST', P + '/suggestions', { key, language: 'de', text: 'Text ' + key }, tina)).json.id as number;
    const [a, b] = [await sg('a'), await sg('b')];
    await sg('c');
    assert.deepEqual(await s.digest(), { mails: 1, failed: 0 });                           // only rita (reviewer); tina caused them
    const m = (await to(s, 'rita@example.com'))[0]!;
    assert.match(m.text, /Demo: 3 new suggestion\(s\) to review \(de\)/);
    assert.equal((await to(s, 'tina@example.com')).length, 0);
    assert.equal((await to(s, 'admin@example.com')).length, 0);                            // owners only get it when nobody reviews the language
    assert.deepEqual(await s.digest(), { mails: 0, failed: 0 });                           // nothing twice
    // rejection reaches the author, release reaches owner (not the actor)
    await s.call('POST', `${P}/suggestions/${a}/reject`, { reason: 'No' }, rita);
    await s.call('POST', `${P}/suggestions/${b}/approve`, {}, rita);
    await s.call('POST', P + '/releases', {}, admin);
    await s.digest();
    assert.match((await to(s, 'tina@example.com'))[0]!.text, /Demo: 1 of your suggestion\(s\) were rejected/);
    assert.match((await to(s, 'rita@example.com')).at(-1)!.text, /release 1 was published/);
    assert.equal((await to(s, 'admin@example.com')).length, 0);                            // the admin released it himself
    // source change -> translators and reviewers of languages with translations
    await s.call('PATCH', P + '/keys/b', { sourceText: 'Two changed' }, admin);
    await s.digest();
    assert.match((await to(s, 'tina@example.com')).at(-1)!.text, /1 translation\(s\) became outdated because the source text changed \(de\)/);
    assert.match((await to(s, 'rita@example.com')).at(-1)!.text, /became outdated/);
  } finally { await s.stop(); }
});

test('digest: opt-out, retry after a failure, old entries dropped, language of the recipient', async () => {
  const { s, tina, rita } = await digestWorld();
  try {
    await s.call('PATCH', '/api/v1/me', { uiLocale: 'de', notifyEmail: false }, rita);
    await s.call('POST', P + '/suggestions', { key: 'a', language: 'de', text: 'Text' }, tina);
    assert.deepEqual(await s.digest(), { mails: 0, failed: 0 });
    assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE sent_at IS NULL').get() as { n: number }).n, 0);   // dropped quietly, not stuck
    await s.call('PATCH', '/api/v1/me', { notifyEmail: true }, rita);
    await s.call('POST', P + '/suggestions', { key: 'b', language: 'de', text: 'Text' }, tina);
    assert.deepEqual(await s.digest(), { mails: 1, failed: 0 });
    assert.match((await to(s, 'rita@example.com'))[0]!.subject, /Neuigkeiten/);              // German recipient
    assert.match((await to(s, 'rita@example.com'))[0]!.text, /Demo: 1 neue\(r\) Vorschlag/);
  } finally { await s.stop(); }
});

test('digest: a mail failure keeps the entries for the next run', async () => {
  const w = await digestWorld();
  try {
    await w.s.call('POST', P + '/suggestions', { key: 'a', language: 'de', text: 'Text' }, w.tina);
    const { createDigest } = await import('../src/notify/service.ts');
    const { createOutbound } = await import('../src/mail/outbound.ts');
    const broken = { enabled: true, mode: 'smtp' as const, send: async () => { throw new Error('smtp down'); } };
    assert.deepEqual(await createDigest(w.s.db, broken, createOutbound(broken, w.s.config))(), { mails: 0, failed: 1 });
    assert.equal((w.s.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE sent_at IS NULL').get() as { n: number }).n, 1);
    assert.deepEqual(await w.s.digest(), { mails: 1, failed: 0 });                                  // works on the next run
    // entries older than 7 days are dropped instead of sent
    w.s.db.prepare("INSERT INTO notifications (user_id, project_id, kind, detail, created_at) VALUES (2, 1, 'suggestion_open', '{}', '2020-01-01T00:00:00Z')").run();
    assert.deepEqual(await w.s.digest(), { mails: 0, failed: 0 });
    assert.equal((w.s.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE sent_at IS NULL').get() as { n: number }).n, 0);
  } finally { await w.s.stop(); }
});

test('mail content is plain text and user-controlled values cannot inject headers or lines', async () => {
  assert.equal(inline('Evil\r\nBcc: attacker@example.com'), 'Evil Bcc: attacker@example.com');
  assert.equal(inline('x'.repeat(300)).length, 100);
  const m = createMailer({ ...loadConfig({}).mail, mode: 'file', from: 'noreply@example.com', outboxDir: mkdtempSync(path.join(os.tmpdir(), 'ob-')) });
  await assert.rejects(m.send({ to: 'a@example.com\r\nBcc: x@y.z', subject: 's', text: 't' }), /invalid recipient/);
  await assert.rejects(m.send({ to: 'a@example.com', subject: 's\r\nBcc: x@y.z', text: 't' }), /invalid subject/);
  await assert.rejects(m.send({ to: 'a@example.com,b@example.com', subject: 's', text: 't' }), /invalid recipient/);
  const s = await start(MAIL);
  try {
    const admin = (await s.setup()).cookie!;
    assert.equal((await s.call('PATCH', '/api/v1/me', { displayName: 'Evil\r\nBcc: attacker@example.com' }, admin)).status, 400);
    await s.call('PATCH', '/api/v1/me', { displayName: 'Mallory <script>alert(1)</script>' }, admin);
    await s.call('POST', '/api/v1/invitations', { email: 'victim@example.com' }, admin);
    const text = (await s.outbox())[0]!.text;
    assert.match(text, /Mallory <script>alert\(1\)<\/script> invited you/);     // plain text: harmless, not rendered
    assert.equal(text.split('\n').filter((l) => /^Bcc:/i.test(l)).length, 0);
  } finally { await s.stop(); }
});

// A minimal SMTP server that records one message: proves the real nodemailer path (greeting, AUTH, envelope, body).
function smtpSink() {
  const got: { auth: string[]; from: string; rcpt: string[]; data: string } = { auth: [], from: '', rcpt: [], data: '' };
  const server = net.createServer((sock) => {
    let buf = ''; let inData = false; let data = '';
    sock.write('220 sink ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; got.data = data; sock.write('250 queued\r\n'); } else data += line + '\n';
          continue;
        }
        if (/^EHLO/i.test(line)) sock.write('250-sink\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (/^AUTH PLAIN/i.test(line)) { got.auth.push(Buffer.from(line.split(' ')[2]!, 'base64').toString('utf8').replace(/\0/g, '|')); sock.write('235 ok\r\n'); }
        else if (/^MAIL FROM/i.test(line)) { got.from = line; sock.write('250 ok\r\n'); }
        else if (/^RCPT TO/i.test(line)) { got.rcpt.push(line); sock.write('250 ok\r\n'); }
        else if (/^DATA/i.test(line)) { inData = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  return { got, server };
}

test('SMTP transport via nodemailer: AUTH, envelope, headers and body arrive as intended', async () => {
  const sink = smtpSink();
  await new Promise<void>((r) => sink.server.listen(0, '127.0.0.1', r));
  const port = (sink.server.address() as net.AddressInfo).port;
  const s = await start({ LEXICAST_MAIL: 'smtp', LEXICAST_SMTP_HOST: '127.0.0.1', LEXICAST_SMTP_PORT: String(port), LEXICAST_SMTP_SECURITY: 'none', LEXICAST_SMTP_USER: 'mailer', LEXICAST_SMTP_PASSWORD: 's3cret', LEXICAST_MAIL_FROM: 'Lexicast <noreply@example.com>', LEXICAST_AUTH_RATE_PER_MINUTE: '0' });
  try {
    const admin = (await s.setup()).cookie!;
    const r = await s.call('POST', '/api/v1/invitations', { email: 'anna@example.com' }, admin);
    assert.deepEqual(r.json, { sent: true });
    assert.deepEqual(sink.got.auth, ['|mailer|s3cret']);
    assert.match(sink.got.from, /<noreply@example\.com>/);
    assert.deepEqual(sink.got.rcpt.map((l) => /<(.+)>/.exec(l)![1]), ['anna@example.com']);
    assert.match(sink.got.data, /^Subject: Invitation to Lexicast/m);
    assert.match(sink.got.data, /^Auto-Submitted: auto-generated/m);
    assert.match(sink.got.data, /Content-Type: text\/plain/);
    assert.match(sink.got.data, /\/invite\/[A-Za-z0-9_-]{43}/);
  } finally { await s.stop(); sink.server.close(); }
});
