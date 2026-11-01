import { createHash } from 'node:crypto';
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

export type SignFn = (bytes: Buffer) => Promise<Uint8Array>;

interface Common { releasesDir: string; sign: SignFn; now?: () => number }

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
  const signature = await c.sign(bytes);
  // Both files are written completely first and only then renamed (signature, then manifest), so a failure
  // while writing never leaves a new manifest next to an old signature.
  const sigTmp = path.join(c.projectDir, `manifest.json.sig.tmp-${process.pid}`);
  const manTmp = path.join(c.projectDir, `manifest.json.tmp-${process.pid}`);
  await writeFile(sigTmp, b64u(signature) + '\n');
  await writeFile(manTmp, bytes);
  await rename(sigTmp, path.join(c.projectDir, 'manifest.json.sig'));
  await rename(manTmp, path.join(c.projectDir, 'manifest.json'));
  return manifest;
}

// Validates all texts and resolves the fallback chain. Pure: no files, no signing. Returns one complete text map per language.
export function resolveTexts(input: BuildInput): Record<string, Texts> {
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
  const out: Record<string, Texts> = {};
  for (const l of languages) {
    const chain = [l, ...(fallback[l] ?? []), sourceLanguage];
    const merged: Texts = {};
    for (const key of Object.keys(source)) {
      for (const c of chain) {
        const t = texts[c]?.[key];
        if (t !== undefined) { merged[key] = t; break; }
      }
    }
    out[l] = merged;
  }
  return out;
}

export interface TextDiff { added: string[]; changed: string[]; removed: string[] }

export function diffTexts(before: Texts | undefined, after: Texts): TextDiff {
  const b = before ?? {};
  return {
    added: Object.keys(after).filter((k) => !(k in b)).sort(),
    changed: Object.keys(after).filter((k) => k in b && b[k] !== after[k]).sort(),
    removed: Object.keys(b).filter((k) => !(k in after)).sort(),
  };
}

// The texts of the currently published release, read from our own files (not a client verification).
export async function readLive(releasesDir: string, project: string): Promise<{ release: number; texts: Record<string, Texts> } | null> {
  const dir = path.join(releasesDir, 'p', project);
  try {
    const m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
    const texts: Record<string, Texts> = {};
    for (const [tag, e] of Object.entries(m.languages)) texts[tag] = JSON.parse(await readFile(path.join(dir, e.path), 'utf8')) as Texts;
    return { release: m.release, texts };
  } catch {
    return null;
  }
}

export async function buildRelease(input: BuildInput & Common & { releaseNumber?: number }): Promise<Manifest> {
  const resolved = resolveTexts(input);
  const projectDir = path.join(input.releasesDir, 'p', input.project);
  const release = input.releaseNumber ?? (await nextReleaseNumber(projectDir));
  const dir = path.join(projectDir, 'r', String(release));
  await mkdir(path.join(projectDir, 'r'), { recursive: true });
  await mkdir(dir); // fails if the release directory already exists: published releases are never overwritten

  const files: Record<string, FileInfo> = {};
  for (const [l, merged] of Object.entries(resolved)) {
    const bytes = canonical(merged);
    await atomicWrite(path.join(dir, `${l}.json`), bytes);
    files[l] = { bytes, count: Object.keys(merged).length };
  }
  return writeManifest({ ...input, projectDir, release, files });
}

// Rollback = a NEW release (higher number) that carries the content of an old one.
export async function rollbackRelease(input: Common & { project: string; toRelease: number; releaseNumber?: number }): Promise<Manifest> {
  const projectDir = path.join(input.releasesDir, 'p', input.project);
  const old = path.join(projectDir, 'r', String(input.toRelease));
  const { sourceLanguage } = JSON.parse(await readFile(path.join(projectDir, 'manifest.json'), 'utf8')) as Manifest;
  const release = input.releaseNumber ?? (await nextReleaseNumber(projectDir));
  const dir = path.join(projectDir, 'r', String(release));
  await mkdir(dir);
  const files: Record<string, FileInfo> = {};
  for (const name of await readdir(old)) {
    if (!name.endsWith('.json')) continue;
    const bytes = await readFile(path.join(old, name));
    await atomicWrite(path.join(dir, name), bytes);
    files[name.slice(0, -5)] = { bytes, count: Object.keys(JSON.parse(bytes.toString()) as Texts).length };
  }
  return writeManifest({ ...input, projectDir, project: input.project, sourceLanguage, release, files });
}
