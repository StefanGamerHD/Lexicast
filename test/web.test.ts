import assert from 'node:assert/strict';
import test from 'node:test';
import { start } from './harness.ts';

test('app routes get index.html with a strict CSP; other paths are not caught', async () => {
  const s = await start();
  try {
    for (const p of ['/', '/login', '/setup', '/forgot', '/account', '/invite/abcdefghijklmnopqrstuvwxyz012345', '/reset/abcdefghijklmnopqrstuvwxyz012345', '/projects', '/projects/demo/translate/de', '/admin/users']) {
      const r = await fetch(s.base + p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type')!, /^text\/html/);
      const csp = r.headers.get('content-security-policy')!;
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(r.headers.get('cache-control'), 'no-cache');
      assert.match(await r.text(), /\/static\/app-abc123\.js/);
    }
    for (const p of ['/unknown', '/invite/short', '/invite/a/b', '/projects/../etc', '/index.html', '/static/../index.html', '/static/notes.txt', '/static/missing.js', '/api/v1/unknown']) {
      assert.equal((await fetch(s.base + p)).status, 404, p);
    }
    assert.equal((await fetch(s.base + '/login', { method: 'POST' })).status, 404);
  } finally { await s.stop(); }
});

test('hashed static files are served from memory with immutable caching', async () => {
  const s = await start();
  try {
    const js = await fetch(s.base + '/static/app-abc123.js');
    assert.equal(js.status, 200);
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.match(js.headers.get('cache-control')!, /immutable/);
    assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
    const icon = await fetch(s.base + '/favicon.svg');
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
    assert.doesNotMatch(icon.headers.get('cache-control')!, /immutable/);
  } finally { await s.stop(); }
});

test('without a built UI the server still answers the API', async () => {
  const s = await start({ LEXICAST_WEB_DIR: '/nonexistent-lexicast-web' });
  try {
    assert.equal((await fetch(s.base + '/')).status, 404);
    assert.equal((await s.call('GET', '/api/v1/instance')).status, 200);
  } finally { await s.stop(); }
});
