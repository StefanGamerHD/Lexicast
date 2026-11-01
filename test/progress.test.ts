import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PW, start } from './harness.ts';
import { pickLocale, t } from '../src/i18n.ts';

type S = Awaited<ReturnType<typeof start>>;
const P = '/api/v1/projects/demo';
const LANGS = [{ tag: 'en' }, { tag: 'de', fallback: ['en'] }, { tag: 'fr', fallback: ['en'] }];

async function world(name = 'Demo') {
  const s = await start({ LEXICAST_AUTH_RATE_PER_MINUTE: '0' });
  const admin = (await s.setup()).cookie!;
  await s.call('POST', '/api/v1/projects', { slug: 'demo', name, sourceLanguage: 'en', languages: LANGS }, admin);
  const mk = async (email: string, role: string) => {
    const inv = await s.call('POST', '/api/v1/invitations', { email }, admin);
    const c = (await s.call('POST', '/api/v1/invitations/accept', { token: inv.json.inviteUrl.split('/invite/')[1], displayName: 'Secret Person', password: PW })).cookie!;
    await s.call('POST', P + '/members', { email, role, language: 'de' }, admin);
    return c;
  };
  const tina = await mk('tina@example.com', 'translator'); const rita = await mk('rita@example.com', 'reviewer');
  await s.call('POST', P + '/keys/import', { apply: true, texts: { 'secret.key.name': 'Top secret source text', other: 'Other', third: 'Third', fourth: 'Fourth' } }, admin);
  const translate = async (key: string, text: string, approve = true) => {
    const sg = await s.call('POST', P + '/suggestions', { key, language: 'de', text }, tina);
    if (approve) await s.call('POST', `${P}/suggestions/${sg.json.id}/approve`, {}, rita);
  };
  return { s, admin, tina, rita, translate };
}
const get = (s: S, path: string, headers: Record<string, string> = {}) => fetch(s.base + path, { headers });

test('progress data: counts per language, source language is complete, outdated and in-review are counted separately', async () => {
  const { s, admin, translate } = await world();
  try {
    await translate('other', 'Andere'); await translate('third', 'Dritte'); await translate('fourth', 'Vierte', false);   // 2 approved, 1 in review
    await s.call('PATCH', P + '/keys/third', { sourceText: 'Third changed' }, admin);                                 // 1 becomes outdated
    const r = await get(s, '/api/v1/public/projects/demo/progress');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control')!, /public, max-age=60/);
    const d = await r.json() as { project: object; languages: { tag: string; translated: number; total: number; percent: number; inReview: number; outdated: number; isSource: boolean }[]; liveRelease: unknown };
    const by = Object.fromEntries(d.languages.map((l) => [l.tag, l]));
    assert.deepEqual(by.en, { tag: 'en', translated: 4, total: 4, percent: 100, inReview: 0, outdated: 0, isSource: true });
    assert.deepEqual(by.de, { tag: 'de', translated: 1, total: 4, percent: 25, inReview: 1, outdated: 1, isSource: false });
    assert.deepEqual(by.fr, { tag: 'fr', translated: 0, total: 4, percent: 0, inReview: 0, outdated: 0, isSource: false });
    assert.equal(d.liveRelease, null);
    await s.call('POST', P + '/releases', {}, admin);
    assert.equal(((await (await get(s, '/api/v1/public/projects/demo/progress')).json()) as { liveRelease: { number: number } }).liveRelease.number, 1);
  } finally { await s.stop(); }
});

test('privacy: no key names, texts, emails, display names or ids anywhere in the data or the page', async () => {
  const { s, translate } = await world();
  try {
    await translate('other', 'Geheimer Übersetzungstext');
    for (const path of ['/api/v1/public/projects/demo/progress', '/progress/demo']) {
      const body = await (await get(s, path)).text();
      for (const secret of ['secret.key.name', 'Top secret', 'Geheimer', 'tina', 'rita', 'example.com', 'Secret Person', 'admin']) {
        assert.ok(!body.toLowerCase().includes(secret.toLowerCase()), `${path} leaks "${secret}"`);
      }
    }
  } finally { await s.stop(); }
});

test('hidden or unknown projects give the same 404, nothing leaks', async () => {
  const { s, admin } = await world();
  try {
    const unknown = await get(s, '/api/v1/public/projects/nope/progress');
    assert.equal((await s.call('PATCH', P, { progressPublic: false }, admin)).json.project.progressPublic, false);
    const hidden = await get(s, '/api/v1/public/projects/demo/progress');
    assert.deepEqual([unknown.status, hidden.status], [404, 404]);
    assert.equal(await unknown.text(), await hidden.text());
    assert.equal((await get(s, '/progress/demo')).status, 404);
    assert.equal((await get(s, '/progress/nope')).status, 404);
    await s.call('PATCH', P, { progressPublic: true }, admin);
    assert.equal((await get(s, '/progress/demo')).status, 200);
    assert.equal((await get(s, '/progress/Bad_Slug')).status, 404);
  } finally { await s.stop(); }
});

test('page: language from Accept-Language, escaped content, strict headers, accessible markup', async () => {
  const { s } = await world('<script>alert(1)</script> & "Co"');
  try {
    const en = await get(s, '/progress/demo', { 'Accept-Language': 'fr-CH, en;q=0.8' });
    const html = await en.text();
    assert.equal(en.status, 200);
    assert.match(en.headers.get('content-type')!, /^text\/html; charset=utf-8/);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /Translation progress/);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Co&quot;/);
    assert.match(html, /<progress max="100" value="100" aria-label="English">/);
    assert.match(html, /name="viewport"/);
    assert.ok(!/<script/i.test(html.replace(/&lt;script&gt;/g, '')), 'no script elements');
    const csp = en.headers.get('content-security-policy')!;
    assert.match(csp, /default-src 'none'/); assert.match(csp, /style-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(en.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(en.headers.get('vary'), 'Accept-Language');
    const de = await (await get(s, '/progress/demo', { 'Accept-Language': 'de-AT,de;q=0.9' })).text();
    assert.match(de, /<html lang="de">/); assert.match(de, /Übersetzungsfortschritt/); assert.match(de, /Noch kein Release veröffentlicht/); assert.match(de, /Deutsch/);
  } finally { await s.stop(); }
});

test('css asset, HEAD, methods, rate limit', async () => {
  const { s } = await world();
  try {
    const css = await get(s, '/assets/progress.css');
    assert.equal(css.status, 200); assert.match(css.headers.get('content-type')!, /^text\/css/);
    const text = await css.text();
    assert.match(text, /prefers-color-scheme:dark/);
    assert.ok(!/url\(|@import/.test(text), 'no external resources');
    const head = await fetch(s.base + '/progress/demo', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await fetch(s.base + '/progress/demo', { method: 'POST' })).status, 405);
  } finally { await s.stop(); }
  const l = await start({ LEXICAST_RATE_PER_MINUTE: '4' });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await get(l, '/progress/none')).status);
    assert.equal(codes[0], 404); assert.ok(codes.includes(429));
  } finally { await l.stop(); }
});

test('empty project and i18n helpers', async () => {
  const s = await start({ LEXICAST_AUTH_RATE_PER_MINUTE: '0' });
  try {
    const admin = (await s.setup()).cookie!;
    await s.call('POST', '/api/v1/projects', { slug: 'empty', name: 'Empty', sourceLanguage: 'en', languages: [{ tag: 'en' }, { tag: 'de' }] }, admin);
    const html = await (await get(s, '/progress/empty')).text();
    assert.match(html, /This project has no texts yet\./); assert.ok(!html.includes('<progress'));
    const data = await (await get(s, '/api/v1/public/projects/empty/progress')).json() as { languages: { percent: number }[] };
    assert.deepEqual(data.languages.map((l) => l.percent), [0, 0]);          // no division by zero
  } finally { await s.stop(); }
  assert.equal(pickLocale(undefined), 'en'); assert.equal(pickLocale('de'), 'de'); assert.equal(pickLocale('fr, de;q=0.5'), 'de'); assert.equal(pickLocale('fr'), 'en');
  assert.equal(t('de', 'progress.translated', { done: 1, total: 2 }), '1 von 2 Texten');
  assert.equal(t('en', 'unknown.key'), 'unknown.key');
});
