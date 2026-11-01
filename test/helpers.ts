import { createHash, generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Manifest } from '../src/release/build.ts';

export interface Keys { privateKeyPem: string; publicKey: KeyObject }

export function newKeys(): Keys {
  const k = generateKeyPairSync('ed25519');
  return { privateKeyPem: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, publicKey: k.publicKey };
}

export async function tmpDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lexicast-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// Minimal independent verifier: what any client must do with a delivered release.
export async function verifyRelease(releasesDir: string, project: string, publicKey: KeyObject): Promise<Manifest> {
  const base = path.join(releasesDir, 'p', project);
  const bytes = await readFile(path.join(base, 'manifest.json'));
  const sig = Buffer.from((await readFile(path.join(base, 'manifest.json.sig'), 'utf8')).trim(), 'base64url');
  if (!verify(null, bytes, publicKey, sig)) throw new Error('bad signature');
  const manifest = JSON.parse(bytes.toString()) as Manifest;
  for (const [tag, e] of Object.entries(manifest.languages)) {
    const f = await readFile(path.join(base, e.path));
    if (createHash('sha256').update(f).digest('hex') !== e.sha256) throw new Error(`hash mismatch ${tag}`);
  }
  return manifest;
}

export const sampleInput = {
  project: 'demo',
  sourceLanguage: 'en',
  languages: ['en', 'de', 'de-AT'],
  fallback: { 'de-AT': ['de', 'en'], de: ['en'] } as Record<string, string[]>,
  texts: {
    en: { 'dashboard.title': 'Overview', greeting: 'Hello {name}', logout: 'Log out' },
    de: { 'dashboard.title': 'Übersicht', greeting: 'Hallo {name}', logout: 'Abmelden' },
    'de-AT': { greeting: 'Servus {name}' },
  } as Record<string, Record<string, string>>,
};
