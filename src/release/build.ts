import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isLanguageTag, isProjectSlug, validateText } from './validate.ts';

export type Texts = Record<string, string>;

export interface Manifest {
  v: 1;
  project: string;
  release: number;
  created: string;
  sourceLanguage: string;
  languages: Record<string, { path: string; sha256: string; keys: number }>;
}

export interface BuildInput {
  project: string;
  sourceLanguage: string;
  languages: string[];
  fallback?: Record<string, string[]>;
  texts: Record<string, Texts>;
}

interface Common { releasesDir: string; privateKeyPem: string; now?: () => number }

export const b64u = (buf: Uint8Array): string => Buffer.from(buf).toString('base64url');
const sha256hex = (buf: Uint8Array): string => createHash('sha256').update(buf).digest('hex');

const canonical = (obj: Texts): Buffer =>
  Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1))), null, 2) + '\n');

async function atomicWrite(file: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

async function nextReleaseNumber(projectDir: string): Promise<number> {
  try {
    const nums = (await readdir(path.join(projectDir, 'r'))).map(Number).filter(Number.isInteger);
    return nums.length ? Math.max(...nums) + 1 : 1;
  } catch {
    return 1;
  }
}

interface FileInfo { bytes: Uint8Array; count: number }

async function writeManifest(c: Common & { projectDir: string; project: string; sourceLanguage: string; release: number; files: Record<string, FileInfo> }): Promise<Manifest> {
  const languages: Manifest['languages'] = {};
  for (const [tag, { bytes, count }] of Object.entries(c.files)) {
    languages[tag] = { path: `r/${c.release}/${tag}.json`, sha256: sha256hex(bytes), keys: count };
  }
  const manifest: Manifest = {
    v: 1, project: c.project, release: c.release, created: new Date((c.now ?? Date.now)()).toISOString(),
    sourceLanguage: c.sourceLanguage, languages,
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const signature = sign(null, bytes, createPrivateKey(c.privateKeyPem));
  // Order matters: the signature file is replaced first, the manifest last, so a client never sees a
  // new manifest with an old signature for longer than the instant between the two renames.
  await atomicWrite(path.join(c.projectDir, 'manifest.json.sig'), b64u(signature) + '\n');
  await atomicWrite(path.join(c.projectDir, 'manifest.json'), bytes);
  return manifest;
}

export async function buildRelease(input: BuildInput & Common): Promise<Manifest> {
  const { project, sourceLanguage, languages, texts, fallback = {} } = input;
  if (!isProjectSlug(project)) throw new Error('invalid project slug');
  for (const l of languages) if (!isLanguageTag(l)) throw new Error(`invalid language tag ${l}`);
  const source = texts[sourceLanguage];
  if (!source) throw new Error('source language missing');
  for (const [k, v] of Object.entries(source)) validateText(k, v);
  for (const l of languages) {
    if (l === sourceLanguage) continue;
    for (const [k, v] of Object.entries(texts[l] ?? {})) {
      const src = source[k];
      if (src === undefined) throw new Error(`${l}: unknown key ${k}`);
      validateText(`${l}:${k}`, v, src);
    }
  }

  const projectDir = path.join(input.releasesDir, 'p', project);
  const release = await nextReleaseNumber(projectDir);
  const dir = path.join(projectDir, 'r', String(release));
  await mkdir(dir, { recursive: true });

  const files: Record<string, FileInfo> = {};
  for (const l of languages) {
    const chain = [l, ...(fallback[l] ?? []), sourceLanguage];
    const merged: Texts = {};
    for (const key of Object.keys(source)) {
      for (const c of chain) {
        const t = texts[c]?.[key];
        if (t !== undefined) { merged[key] = t; break; }
      }
    }
    const bytes = canonical(merged);
    await atomicWrite(path.join(dir, `${l}.json`), bytes);
    files[l] = { bytes, count: Object.keys(merged).length };
  }
  return writeManifest({ ...input, projectDir, release, files });
}

// Rollback = a NEW release (higher number) that carries the content of an old one.
export async function rollbackRelease(input: Common & { project: string; toRelease: number }): Promise<Manifest> {
  const projectDir = path.join(input.releasesDir, 'p', input.project);
  const old = path.join(projectDir, 'r', String(input.toRelease));
  const { sourceLanguage } = JSON.parse(await readFile(path.join(projectDir, 'manifest.json'), 'utf8')) as Manifest;
  const release = await nextReleaseNumber(projectDir);
  const dir = path.join(projectDir, 'r', String(release));
  await mkdir(dir, { recursive: true });
  const files: Record<string, FileInfo> = {};
  for (const name of await readdir(old)) {
    if (!name.endsWith('.json')) continue;
    const bytes = await readFile(path.join(old, name));
    await atomicWrite(path.join(dir, name), bytes);
    files[name.slice(0, -5)] = { bytes, count: Object.keys(JSON.parse(bytes.toString()) as Texts).length };
  }
  return writeManifest({ ...input, projectDir, project: input.project, sourceLanguage, release, files });
}
