import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRelease, rollbackRelease } from '../src/release/build.ts';
import { validateText } from '../src/release/validate.ts';
import { newKeys, sampleInput, tmpDir, verifyRelease } from './helpers.ts';

test('build produces a verifiable signed release with build-time fallback chain', async () => {
  const { dir, cleanup } = await tmpDir(); const k = newKeys();
  try {
    const m = await buildRelease({ ...sampleInput, releasesDir: dir, sign: k.sign });
    assert.equal(m.release, 1);
    assert.equal((await verifyRelease(dir, 'demo', k.publicKey)).release, 1);
    const at = JSON.parse(await readFile(path.join(dir, 'p/demo/r/1/de-AT.json'), 'utf8'));
    assert.equal(at.greeting, 'Servus {name}');
    assert.equal(at['dashboard.title'], 'Übersicht');
    assert.equal(Object.keys(at).length, 3);
  } finally { await cleanup(); }
});

test('release numbers increase; rollback creates a NEW higher release with old content', async () => {
  const { dir, cleanup } = await tmpDir(); const k = newKeys();
  try {
    await buildRelease({ ...sampleInput, releasesDir: dir, sign: k.sign });
    const changed = structuredClone(sampleInput);
    changed.texts.de!['dashboard.title'] = 'Start';
    assert.equal((await buildRelease({ ...changed, releasesDir: dir, sign: k.sign })).release, 2);
    const rb = await rollbackRelease({ releasesDir: dir, project: 'demo', toRelease: 1, sign: k.sign });
    assert.equal(rb.release, 3);
    await verifyRelease(dir, 'demo', k.publicKey);
    const de = JSON.parse(await readFile(path.join(dir, 'p/demo/r/3/de.json'), 'utf8'));
    assert.equal(de['dashboard.title'], 'Übersicht');
    // history is immutable: release 2 still has the changed text
    assert.equal(JSON.parse(await readFile(path.join(dir, 'p/demo/r/2/de.json'), 'utf8'))['dashboard.title'], 'Start');
  } finally { await cleanup(); }
});

test('a failed build leaves the live manifest untouched', async () => {
  const { dir, cleanup } = await tmpDir(); const k = newKeys();
  try {
    await buildRelease({ ...sampleInput, releasesDir: dir, sign: k.sign });
    const before = await readFile(path.join(dir, 'p/demo/manifest.json'), 'utf8');
    const bad = structuredClone(sampleInput);
    bad.texts.de!.greeting = 'Hallo {nam}';
    await assert.rejects(buildRelease({ ...bad, releasesDir: dir, sign: k.sign }), /placeholders differ/);
    assert.equal(await readFile(path.join(dir, 'p/demo/manifest.json'), 'utf8'), before);
  } finally { await cleanup(); }
});

test('hard validation rules', () => {
  assert.throws(() => validateText('k', 'Hallo {nam}', 'Hello {name}'), /placeholders differ/);
  assert.throws(() => validateText('k', 'Hallo {name', 'Hello {name}'), /malformed braces/);
  assert.throws(() => validateText('k', 'a‮b'), /bidirectional/);
  assert.throws(() => validateText('k', 'a\u0000b'), /control/);
  assert.throws(() => validateText('k', ''), /empty/);
  assert.throws(() => validateText('k', 'x'.repeat(5001)), /longer/);
  assert.throws(() => validateText('k', 'é'), /NFC/);
  assert.throws(() => validateText('k', 42), /not a string/);
  validateText('k', '<b>bleibt Text</b>');
});

test('unknown keys in a translation and bad slugs are rejected', async () => {
  const { dir, cleanup } = await tmpDir(); const k = newKeys();
  try {
    const extra = structuredClone(sampleInput);
    extra.texts.de!['nope'] = 'x';
    await assert.rejects(buildRelease({ ...extra, releasesDir: dir, sign: k.sign }), /unknown key/);
    await assert.rejects(buildRelease({ ...sampleInput, project: '../x', releasesDir: dir, sign: k.sign }), /invalid project slug/);
  } finally { await cleanup(); }
});

test('a tampered file or manifest is detected by the verifier', async () => {
  const { dir, cleanup } = await tmpDir(); const k = newKeys();
  try {
    await buildRelease({ ...sampleInput, releasesDir: dir, sign: k.sign });
    const f = path.join(dir, 'p/demo/r/1/de.json');
    const orig = await readFile(f);
    await writeFile(f, orig.toString().replace('Übersicht', 'EVIL'));
    await assert.rejects(verifyRelease(dir, 'demo', k.publicKey), /hash mismatch/);
    await writeFile(f, orig);
    const mf = path.join(dir, 'p/demo/manifest.json');
    const orig_manifest = await readFile(mf);
    await writeFile(mf, (await readFile(mf, 'utf8')).replace('"release": 1', '"release": 9'));
    await assert.rejects(verifyRelease(dir, 'demo', k.publicKey), /bad signature/);
    await writeFile(mf, orig_manifest);
    await assert.rejects(verifyRelease(dir, 'demo', newKeys().publicKey), /bad signature/); // valid file, wrong key
  } finally { await cleanup(); }
});
