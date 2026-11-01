import type { DatabaseSync } from 'node:sqlite';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { User } from '../auth/service.ts';
import { ApiError } from '../http/util.ts';
import type { Projects } from '../projects/service.ts';
import { buildRelease, diffTexts, readLive, resolveTexts, rollbackRelease, type BuildInput, type SignFn, type TextDiff, type Texts } from '../release/build.ts';

const LIST_CAP = 200;

export interface LanguageChanges { added: number; changed: number; removed: number }
export interface Summary { languages: Record<string, LanguageChanges>; soloApprovals: number; outdatedExcluded: number }

interface ReleaseRow {
  number: number; state: string; created_at: string; note: string; change_summary: string; rolled_back_to: number | null;
  failure_reason: string | null; created_by_name: string | null;
}

export function createReleases(db: DatabaseSync, projects: Projects, sign: SignFn, releasesDir: string, now: () => number = Date.now) {
  const iso = () => new Date(now()).toISOString();
  const running = new Set<number>();

  // A crash during a build leaves a 'building' row behind; it would block the project forever.
  db.prepare("UPDATE releases SET state = 'failed', failure_reason = 'interrupted by a restart' WHERE state = 'building'").run();

  // What a release built right now would contain. Outdated translations and deprecated keys are not included.
  function collect(projectId: number, slug: string, sourceLanguage: string, languages: { tag: string; fallback: string[] }[]) {
    const keys = db.prepare("SELECT id, name, source_text FROM keys WHERE project_id = ? AND state = 'active'").all(projectId) as { id: number; name: string; source_text: string }[];
    const texts: Record<string, Texts> = { [sourceLanguage]: {} };
    for (const l of languages) texts[l.tag] ??= {};
    for (const k of keys) texts[sourceLanguage]![k.name] = k.source_text;
    const tr = db.prepare("SELECT k.name, t.language, t.text FROM translations t JOIN keys k ON k.id = t.key_id WHERE k.project_id = ? AND k.state = 'active' AND t.outdated = 0").all(projectId) as { name: string; language: string; text: string }[];
    for (const t of tr) if (t.language !== sourceLanguage) (texts[t.language] ??= {})[t.name] = t.text;
    const outdatedExcluded = (db.prepare("SELECT COUNT(*) AS n FROM translations t JOIN keys k ON k.id = t.key_id WHERE k.project_id = ? AND k.state = 'active' AND t.outdated = 1").get(projectId) as { n: number }).n;
    const input: BuildInput = {
      project: slug, sourceLanguage, languages: languages.map((l) => l.tag),
      fallback: Object.fromEntries(languages.map((l) => [l.tag, l.fallback])), texts,
    };
    return { input, outdatedExcluded, keyCount: keys.length };
  }

  function soloSinceLastRelease(projectId: number): number {
    const last = db.prepare("SELECT created_at FROM releases WHERE project_id = ? AND state = 'published' ORDER BY number DESC LIMIT 1").get(projectId) as { created_at: string } | undefined;
    return (db.prepare(`SELECT COUNT(*) AS n FROM suggestions s JOIN keys k ON k.id = s.key_id
      WHERE k.project_id = ? AND s.solo_approved = 1 AND s.state = 'approved' AND s.reviewed_at > ?`).get(projectId, last?.created_at ?? '') as { n: number }).n;
  }

  async function plan(user: User, slug: string) {
    const { project } = projects.ownerAccess(user, slug);
    const { input, outdatedExcluded, keyCount } = collect(project.id, slug, project.sourceLanguage, project.languages);
    if (keyCount === 0) throw new ApiError(409, 'nothing_to_release', 'The project has no active keys');
    let resolved: Record<string, Texts>;
    try { resolved = resolveTexts(input); } catch (e) { throw new ApiError(409, 'invalid_release', (e as Error).message); }
    const live = await readLive(releasesDir, slug);
    const diffs: Record<string, TextDiff> = {};
    const languages: Record<string, LanguageChanges> = {};
    for (const [lang, map] of Object.entries(resolved)) {
      const d = diffTexts(live?.texts[lang], map);
      diffs[lang] = d;
      languages[lang] = { added: d.added.length, changed: d.changed.length, removed: d.removed.length };
    }
    const changeCount = Object.values(languages).reduce((n, c) => n + c.added + c.changed + c.removed, 0);
    return { project, input, live, diffs, summary: { languages, soloApprovals: soloSinceLastRelease(project.id), outdatedExcluded } as Summary, changeCount };
  }

  async function preview(user: User, slug: string) {
    const p = await plan(user, slug);
    const cap = (d: TextDiff) => ({ added: d.added.slice(0, LIST_CAP), changed: d.changed.slice(0, LIST_CAP), removed: d.removed.slice(0, LIST_CAP) });
    const open = (db.prepare("SELECT COUNT(*) AS n FROM suggestions s JOIN keys k ON k.id = s.key_id WHERE k.project_id = ? AND s.state = 'open'").get(p.project.id) as { n: number }).n;
    return {
      liveRelease: p.live?.release ?? null, nextRelease: nextNumber(p.project.id), hasChanges: p.changeCount > 0 || !p.live, summary: p.summary,
      changes: Object.fromEntries(Object.entries(p.diffs).map(([l, d]) => [l, cap(d)])), openSuggestions: open,
    };
  }

  const nextNumber = (projectId: number): number =>
    ((db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM releases WHERE project_id = ?').get(projectId) as { n: number }).n) + 1;

  function cleanNote(v: unknown): string {
    if (v === undefined) return '';
    if (typeof v !== 'string' || v.length > 1000) throw new ApiError(400, 'invalid_field', 'note must be a string of at most 1000 characters');
    return v;
  }

  // Reserve the next number and the project's "building" slot. Only one release per project at a time.
  function begin(projectId: number, userId: number, note: string, rolledBackTo: number | null): number {
    if (running.has(projectId)) throw new ApiError(409, 'release_running', 'A release is already being built for this project');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare("SELECT 1 FROM releases WHERE project_id = ? AND state = 'building'").get(projectId)) throw new ApiError(409, 'release_running', 'A release is already being built for this project');
      const number = nextNumber(projectId);
      db.prepare("INSERT INTO releases (project_id, number, state, created_by, created_at, note, rolled_back_to) VALUES (?, ?, 'building', ?, ?, ?, ?)").run(projectId, number, userId, iso(), note, rolledBackTo);
      db.exec('COMMIT');
      running.add(projectId);
      return number;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  async function fail(projectId: number, slug: string, number: number, userId: number, e: unknown): Promise<never> {
    await rm(path.join(releasesDir, 'p', slug, 'r', String(number)), { recursive: true, force: true });
    const reason = (e as Error).message.slice(0, 500);
    db.prepare("UPDATE releases SET state = 'failed', failure_reason = ? WHERE project_id = ? AND number = ?").run(reason, projectId, number);
    projects.audit(userId, 'release.failed', slug, String(number), { reason });
    if (e instanceof ApiError) throw e;
    throw new ApiError(500, 'release_failed', `Release ${number} failed: ${reason}`);
  }

  async function create(user: User, slug: string, b: Record<string, unknown>) {
    const note = cleanNote(b.note);
    const p = await plan(user, slug);
    if (p.live && p.changeCount === 0) throw new ApiError(409, 'no_changes', 'Nothing changed since the live release');
    const number = begin(p.project.id, user.id, note, null);
    try {
      // The plan is built again inside the lock so that nothing approved in between is half-included.
      const fresh = collect(p.project.id, slug, p.project.sourceLanguage, p.project.languages);
      const again = await plan(user, slug);
      if (again.live && again.changeCount === 0) throw new ApiError(409, 'no_changes', 'Nothing changed since the live release');
      await buildRelease({ ...fresh.input, releasesDir, sign, releaseNumber: number, now });
      db.prepare("UPDATE releases SET state = 'published', change_summary = ? WHERE project_id = ? AND number = ?").run(JSON.stringify(p.summary), p.project.id, number);
      projects.audit(user.id, 'release.create', slug, String(number), { solo: p.summary.soloApprovals });
      return { release: number, summary: p.summary };
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_changes') {
        // a concurrent release already published the same content: nothing happened, so leave no trace
        db.prepare("DELETE FROM releases WHERE project_id = ? AND number = ? AND state = 'building'").run(p.project.id, number);
        throw e;
      }
      return fail(p.project.id, slug, number, user.id, e);
    } finally { running.delete(p.project.id); }
  }

  async function rollback(user: User, slug: string, toRelease: number, b: Record<string, unknown>) {
    const { project } = projects.ownerAccess(user, slug);
    const note = cleanNote(b.note);
    const target = db.prepare("SELECT state FROM releases WHERE project_id = ? AND number = ?").get(project.id, toRelease) as { state: string } | undefined;
    if (!target || target.state !== 'published') throw new ApiError(404, 'not_found', 'Only a published release can be restored');
    const live = db.prepare("SELECT number FROM releases WHERE project_id = ? AND state = 'published' ORDER BY number DESC LIMIT 1").get(project.id) as { number: number };
    const liveContentOf = (db.prepare('SELECT rolled_back_to FROM releases WHERE project_id = ? AND number = ?').get(project.id, live.number) as { rolled_back_to: number | null }).rolled_back_to ?? live.number;
    if (liveContentOf === toRelease) throw new ApiError(409, 'already_live', 'This release content is already live');
    const number = begin(project.id, user.id, note, toRelease);
    try {
      await rollbackRelease({ releasesDir, project: slug, toRelease, sign, releaseNumber: number, now });
      db.prepare("UPDATE releases SET state = 'published', change_summary = ? WHERE project_id = ? AND number = ?").run(JSON.stringify({ rolledBackTo: toRelease }), project.id, number);
      projects.audit(user.id, 'release.rollback', slug, String(number), { to: toRelease });
      return { release: number, rolledBackTo: toRelease };
    } catch (e) {
      return fail(project.id, slug, number, user.id, e);
    } finally { running.delete(project.id); }
  }

  function list(user: User, slug: string) {
    const { project } = projects.access(user, slug);
    const rows = db.prepare(`SELECT r.number, r.state, r.created_at, r.note, r.change_summary, r.rolled_back_to, r.failure_reason, u.display_name AS created_by_name
      FROM releases r LEFT JOIN users u ON u.id = r.created_by WHERE r.project_id = ? ORDER BY r.number DESC LIMIT 200`).all(project.id) as unknown as ReleaseRow[];
    return {
      releases: rows.map((r) => ({
        number: r.number, state: r.state, createdAt: r.created_at, createdBy: r.created_by_name, note: r.note, rolledBackTo: r.rolled_back_to,
        failureReason: r.failure_reason, summary: JSON.parse(r.change_summary) as unknown,
      })),
    };
  }

  return { preview, create, rollback, list };
}
export type Releases = ReturnType<typeof createReleases>;
