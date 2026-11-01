import type { DatabaseSync } from 'node:sqlite';
import type { User } from '../auth/service.ts';
import { ApiError } from '../http/util.ts';
import type { Projects, Roles } from '../projects/service.ts';
import { validateText } from '../release/validate.ts';
import { softWarnings, type Warning } from './warnings.ts';

const MAX_OPEN_PER_USER = 100;

interface SuggestionRow {
  id: number; key_id: number; language: string; text: string; author_id: number; state: string; reviewer_id: number | null;
  reject_reason: string | null; created_at: string; reviewed_at: string | null; source_snapshot: string;
}
interface KeyRow { id: number; project_id: number; name: string; source_text: string; max_length: number | null; state: string }

export interface SuggestionView {
  id: number; key: string; language: string; text: string; state: string; author: string; mine: boolean; createdAt: string;
  sourceText: string; currentText: string | null; sourceChanged: boolean; warnings: Warning[]; rejectReason: string | null;
}

export function createReview(db: DatabaseSync, projects: Projects, now: () => number = Date.now) {
  const iso = () => new Date(now()).toISOString();
  const mayTranslate = (r: Roles, lang: string) => r.owner || r.translator.has(lang) || r.reviewer.has(lang);
  const mayReview = (r: Roles, lang: string) => r.owner || r.reviewer.has(lang);

  const getKey = (projectId: number, name: string): KeyRow | undefined =>
    db.prepare("SELECT id, project_id, name, source_text, max_length, state FROM keys WHERE project_id = ? AND name = ? AND state <> 'deleted'").get(projectId, name) as KeyRow | undefined;

  function submit(user: User, slug: string, b: Record<string, unknown>) {
    const { project, roles } = projects.access(user, slug);
    const language = b.language;
    if (typeof language !== 'string' || !project.languages.some((l) => l.tag === language)) throw new ApiError(400, 'invalid_language', 'language must be a project language');
    if (language === project.sourceLanguage) throw new ApiError(400, 'invalid_language', 'the source language is edited through the key, not by suggestions');
    if (!mayTranslate(roles, language)) throw new ApiError(403, 'forbidden', 'You do not translate this language');
    if (typeof b.key !== 'string') throw new ApiError(400, 'invalid_field', 'key is missing');
    const key = getKey(project.id, b.key);
    if (!key) throw new ApiError(404, 'not_found', 'Key not found');
    if (key.state !== 'active') throw new ApiError(409, 'key_deprecated', 'This key is deprecated');
    try { validateText(`${key.name}`, b.text, key.source_text); } catch (e) { throw new ApiError(400, 'invalid_text', (e as Error).message); }
    const text = b.text as string;
    if (key.max_length !== null && text.length > key.max_length) throw new ApiError(400, 'invalid_text', `longer than the limit of ${key.max_length} characters`);

    db.exec('BEGIN IMMEDIATE');
    try {
      const open = (db.prepare("SELECT COUNT(*) AS n FROM suggestions s JOIN keys k ON k.id = s.key_id WHERE k.project_id = ? AND s.author_id = ? AND s.state = 'open'").get(project.id, user.id) as { n: number }).n;
      if (open >= MAX_OPEN_PER_USER) throw new ApiError(429, 'too_many_open', `You already have ${MAX_OPEN_PER_USER} open suggestions in this project`);
      const current = db.prepare('SELECT text, outdated FROM translations WHERE key_id = ? AND language = ?').get(key.id, language) as { text: string; outdated: number } | undefined;
      if (current && current.text === text && !current.outdated) throw new ApiError(409, 'unchanged', 'This is already the current translation');
      // one open suggestion per author, key and language: a new one replaces the old
      db.prepare("UPDATE suggestions SET state = 'withdrawn' WHERE key_id = ? AND language = ? AND author_id = ? AND state = 'open'").run(key.id, language, user.id);
      const r = db.prepare('INSERT INTO suggestions (key_id, language, text, author_id, created_at, source_snapshot) VALUES (?, ?, ?, ?, ?, ?)').run(key.id, language, text, user.id, iso(), key.source_text);
      projects.audit(user.id, 'suggestion.create', slug, `${key.name}:${language}`);
      db.exec('COMMIT');
      return { id: Number(r.lastInsertRowid), warnings: softWarnings(text, key.source_text) };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function toView(row: SuggestionRow & { key_name: string; source_text: string; author_name: string; current_text: string | null }, userId: number): SuggestionView {
    return {
      id: row.id, key: row.key_name, language: row.language, text: row.text, state: row.state, author: row.author_name, mine: row.author_id === userId,
      createdAt: row.created_at, sourceText: row.source_text, currentText: row.current_text,
      sourceChanged: row.source_snapshot !== row.source_text, warnings: softWarnings(row.text, row.source_text), rejectReason: row.reject_reason,
    };
  }

  // mine=true: my own suggestions in any state. Otherwise the review queue of the languages I review.
  function list(user: User, slug: string, q: { language?: string | null; state?: string | null; mine?: boolean; limit?: number; offset?: number }) {
    const { project, roles } = projects.access(user, slug);
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const offset = Math.max(q.offset ?? 0, 0);
    const where = ['k.project_id = ?'];
    const args: (string | number)[] = [project.id];
    if (q.mine) {
      where.push('s.author_id = ?'); args.push(user.id);
    } else {
      const langs = roles.owner ? project.languages.map((l) => l.tag) : [...roles.reviewer];
      if (!langs.length) throw new ApiError(403, 'forbidden', 'Only reviewers and owners can see the review queue');
      where.push(`s.language IN (${langs.map(() => '?').join(',')})`); args.push(...langs);
    }
    if (q.language) { where.push('s.language = ?'); args.push(q.language); }
    const state = q.state ?? (q.mine ? null : 'open');
    if (state) {
      if (!['open', 'approved', 'rejected', 'withdrawn', 'superseded'].includes(state)) throw new ApiError(400, 'invalid_field', 'invalid state');
      where.push('s.state = ?'); args.push(state);
    }
    const base = `FROM suggestions s JOIN keys k ON k.id = s.key_id JOIN users u ON u.id = s.author_id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`SELECT s.*, k.name AS key_name, k.source_text, u.display_name AS author_name,
      (SELECT t.text FROM translations t WHERE t.key_id = s.key_id AND t.language = s.language) AS current_text
      ${base} ORDER BY s.created_at, s.id LIMIT ? OFFSET ?`).all(...args, limit, offset) as unknown as (SuggestionRow & { key_name: string; source_text: string; author_name: string; current_text: string | null })[];
    return { total, suggestions: rows.map((r) => toView(r, user.id)) };
  }

  function loadForReview(user: User, slug: string, id: number) {
    const { project, roles } = projects.access(user, slug);
    const s = db.prepare('SELECT s.*, k.project_id, k.name AS key_name, k.source_text, k.state AS key_state FROM suggestions s JOIN keys k ON k.id = s.key_id WHERE s.id = ?').get(id) as unknown as (SuggestionRow & { project_id: number; key_name: string; source_text: string; key_state: string }) | undefined;
    if (!s || s.project_id !== project.id) throw new ApiError(404, 'not_found', 'Suggestion not found');
    return { project, roles, s };
  }

  function approve(user: User, slug: string, id: number) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const { project, roles, s } = loadForReview(user, slug, id);
      if (!mayReview(roles, s.language)) throw new ApiError(403, 'forbidden', 'You do not review this language');
      if (s.state !== 'open') throw new ApiError(409, 'not_open', `Suggestion is ${s.state}`);
      let solo = 0;
      if (s.author_id === user.id) {
        // four-eyes: only the explicit, logged solo-mode exception allows approving your own text
        if (!(project.soloMode && roles.owner)) throw new ApiError(403, 'self_review', 'You cannot approve your own suggestion; another person must review it');
        solo = 1;
      }
      if (s.key_state !== 'active') throw new ApiError(409, 'key_deprecated', 'This key is deprecated');
      if (s.source_snapshot !== s.source_text) throw new ApiError(409, 'source_changed', 'The source text changed after this suggestion was written; reject it so the author can update it');
      try { validateText(s.key_name, s.text, s.source_text); } catch (e) { throw new ApiError(409, 'invalid_text', (e as Error).message); }
      db.prepare(`INSERT INTO translations (key_id, language, text, outdated, approved_by, approved_at) VALUES (?, ?, ?, 0, ?, ?)
        ON CONFLICT(key_id, language) DO UPDATE SET text = excluded.text, outdated = 0, approved_by = excluded.approved_by, approved_at = excluded.approved_at`)
        .run(s.key_id, s.language, s.text, user.id, iso());
      db.prepare("UPDATE suggestions SET state = 'approved', reviewer_id = ?, solo_approved = ?, reviewed_at = ? WHERE id = ?").run(user.id, solo, iso(), s.id);
      const superseded = db.prepare("UPDATE suggestions SET state = 'superseded' WHERE key_id = ? AND language = ? AND state = 'open' AND id <> ?").run(s.key_id, s.language, s.id);
      projects.audit(user.id, solo ? 'suggestion.approve.solo' : 'suggestion.approve', slug, `${s.key_name}:${s.language}`, { superseded: Number(superseded.changes) });
      db.exec('COMMIT');
      return { approved: true, solo: solo === 1, superseded: Number(superseded.changes) };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function reject(user: User, slug: string, id: number, reasonIn: unknown) {
    const reason = typeof reasonIn === 'string' ? reasonIn.trim() : '';
    if (!reason || reason.length > 500) throw new ApiError(400, 'invalid_field', 'A reason of 1 to 500 characters is required');
    db.exec('BEGIN IMMEDIATE');
    try {
      const { roles, s } = loadForReview(user, slug, id);
      if (!mayReview(roles, s.language)) throw new ApiError(403, 'forbidden', 'You do not review this language');
      if (s.state !== 'open') throw new ApiError(409, 'not_open', `Suggestion is ${s.state}`);
      if (s.author_id === user.id) throw new ApiError(403, 'self_review', 'Withdraw your own suggestion instead of rejecting it');
      db.prepare("UPDATE suggestions SET state = 'rejected', reviewer_id = ?, reject_reason = ?, reviewed_at = ? WHERE id = ?").run(user.id, reason, iso(), s.id);
      projects.audit(user.id, 'suggestion.reject', slug, `${s.key_name}:${s.language}`);
      db.exec('COMMIT');
      return { rejected: true };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function withdraw(user: User, slug: string, id: number) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const { s } = loadForReview(user, slug, id);
      if (s.author_id !== user.id) throw new ApiError(403, 'forbidden', 'Only the author can withdraw a suggestion');
      if (s.state !== 'open') throw new ApiError(409, 'not_open', `Suggestion is ${s.state}`);
      db.prepare("UPDATE suggestions SET state = 'withdrawn' WHERE id = ?").run(s.id);
      projects.audit(user.id, 'suggestion.withdraw', slug, `${s.key_name}:${s.language}`);
      db.exec('COMMIT');
      return { withdrawn: true };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  return { submit, list, approve, reject, withdraw };
}
export type Review = ReturnType<typeof createReview>;
