import type { DatabaseSync } from 'node:sqlite';
import { ApiError } from '../http/util.ts';
import { validateText } from '../release/validate.ts';
import type { User } from '../auth/service.ts';
import type { Notifier } from '../notify/service.ts';
import type { Projects } from './service.ts';

const KEY_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}$/;
const MAX_IMPORT_KEYS = 5000;
const MAX_DEPTH = 8;

interface KeyRow { id: number; name: string; source_text: string; context_note: string; max_length: number | null; state: string }

// Accepts flat or nested JSON; nested objects become dotted key names.
export function flatten(input: unknown, out: Record<string, string> = {}, prefix = '', depth = 0): Record<string, string> {
  if (depth > MAX_DEPTH) throw new ApiError(400, 'invalid_import', `nesting deeper than ${MAX_DEPTH} levels at ${prefix}`);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'invalid_import', 'texts must be a JSON object');
  for (const [k, v] of Object.entries(input)) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) { flatten(v, out, name, depth + 1); continue; }
    if (typeof v !== 'string') throw new ApiError(400, 'invalid_import', `${name}: value is not a string`);
    if (!KEY_NAME.test(name)) throw new ApiError(400, 'invalid_import', `${name}: invalid key name`);
    if (name in out) throw new ApiError(400, 'invalid_import', `${name}: duplicate key`);
    out[name] = v;
    if (Object.keys(out).length > MAX_IMPORT_KEYS) throw new ApiError(400, 'invalid_import', `more than ${MAX_IMPORT_KEYS} keys`);
  }
  return out;
}

export function createKeys(db: DatabaseSync, projects: Projects, now: () => number = Date.now, notifier?: Notifier) {
  const iso = () => new Date(now()).toISOString();

  // Tells the people of the affected languages that translations became outdated (counted before they are marked).
  function notifyOutdated(projectId: number, keyIds: number[], actorId: number): void {
    if (!notifier || !keyIds.length) return;
    const rows = db.prepare(`SELECT language, COUNT(*) AS n FROM translations WHERE outdated = 1 AND key_id IN (${keyIds.map(() => '?').join(',')}) GROUP BY language`).all(...keyIds) as { language: string; n: number }[];
    for (const r of rows) notifier.enqueue(notifier.languageMembers(projectId, r.language), projectId, 'source_changed', { language: r.language, count: r.n }, actorId);
  }

  function checkSource(name: string, text: unknown, maxLength: number | null): string {
    try { validateText(name, text); } catch (e) { throw new ApiError(400, 'invalid_text', (e as Error).message); }
    if (maxLength !== null && (text as string).length > maxLength) throw new ApiError(400, 'invalid_text', `${name}: longer than the limit of ${maxLength} characters`);
    return text as string;
  }
  const optLength = (v: unknown): number | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5000) throw new ApiError(400, 'invalid_field', 'maxLength must be an integer from 1 to 5000');
    return v;
  };
  const optNote = (v: unknown): string => {
    if (v === undefined) return '';
    if (typeof v !== 'string' || v.length > 1000) throw new ApiError(400, 'invalid_field', 'contextNote must be a string of at most 1000 characters');
    return v;
  };

  function list(user: User, slug: string, q: { search?: string | null; state?: string | null; limit?: number; offset?: number }) {
    const { project, roles } = projects.access(user, slug);
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const offset = Math.max(q.offset ?? 0, 0);
    const where = ['project_id = ?', "state <> 'deleted'"];
    const args: (string | number)[] = [project.id];
    if (q.state) {
      if (!['active', 'deprecated'].includes(q.state)) throw new ApiError(400, 'invalid_field', 'state must be active or deprecated');
      where.push('state = ?'); args.push(q.state);
    }
    if (q.search) {
      const like = '%' + q.search.slice(0, 100).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      where.push("(name LIKE ? ESCAPE '\\' OR source_text LIKE ? ESCAPE '\\')"); args.push(like, like);
    }
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM keys WHERE ${where.join(' AND ')}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM keys WHERE ${where.join(' AND ')} ORDER BY name LIMIT ? OFFSET ?`).all(...args, limit, offset) as unknown as KeyRow[];
    const visible = (lang: string) => roles.owner || roles.reviewer.has(lang) || roles.translator.has(lang);
    const tr = db.prepare('SELECT language, text, outdated FROM translations WHERE key_id = ?');
    const open = db.prepare("SELECT language, COUNT(*) AS n FROM suggestions WHERE key_id = ? AND state = 'open' GROUP BY language");
    return {
      total,
      keys: rows.map((k) => ({
        name: k.name, sourceText: k.source_text, contextNote: k.context_note, maxLength: k.max_length, state: k.state,
        translations: Object.fromEntries((tr.all(k.id) as { language: string; text: string; outdated: number }[]).filter((t) => visible(t.language)).map((t) => [t.language, { text: t.text, outdated: t.outdated === 1 }])),
        // counts only: translators see that a text waits for review, not whose text it is
        openSuggestions: Object.fromEntries((open.all(k.id) as { language: string; n: number }[]).filter((o) => visible(o.language)).map((o) => [o.language, o.n])),
      })),
    };
  }

  function create(user: User, slug: string, b: Record<string, unknown>) {
    const { project } = projects.ownerAccess(user, slug);
    const name = b.name;
    if (typeof name !== 'string' || !KEY_NAME.test(name)) throw new ApiError(400, 'invalid_name', 'key name must use letters, digits, dot, dash and underscore (max 200)');
    const maxLength = optLength(b.maxLength);
    const text = checkSource(name, b.sourceText, maxLength);
    if (db.prepare('SELECT 1 FROM keys WHERE project_id = ? AND name = ?').get(project.id, name)) throw new ApiError(409, 'exists', 'Key already exists');
    db.prepare('INSERT INTO keys (project_id, name, source_text, context_note, max_length, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(project.id, name, text, optNote(b.contextNote), maxLength, iso(), iso());
    projects.audit(user.id, 'key.create', slug, name);
    return { name };
  }

  function update(user: User, slug: string, name: string, b: Record<string, unknown>) {
    const { project } = projects.ownerAccess(user, slug);
    const k = db.prepare("SELECT * FROM keys WHERE project_id = ? AND name = ? AND state <> 'deleted'").get(project.id, name) as KeyRow | undefined;
    if (!k) throw new ApiError(404, 'not_found', 'Key not found');
    const maxLength = 'maxLength' in b ? optLength(b.maxLength) : k.max_length;
    const text = 'sourceText' in b ? checkSource(name, b.sourceText, maxLength) : k.source_text;
    const note = 'contextNote' in b ? optNote(b.contextNote) : k.context_note;
    const state = 'state' in b ? b.state : k.state;
    if (state !== 'active' && state !== 'deprecated') throw new ApiError(400, 'invalid_field', 'state must be active or deprecated');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE keys SET source_text = ?, context_note = ?, max_length = ?, state = ?, updated_at = ? WHERE id = ?').run(text, note, maxLength, state, iso(), k.id);
      if (text !== k.source_text) db.prepare('UPDATE translations SET outdated = 1 WHERE key_id = ?').run(k.id);
      projects.audit(user.id, 'key.update', slug, name, { sourceChanged: text !== k.source_text, state });
      db.exec('COMMIT');
      if (text !== k.source_text) notifyOutdated(project.id, [k.id], user.id);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { name, outdatedMarked: text !== k.source_text };
  }

  // Preview (apply=false) or apply (apply=true) a JSON import. All-or-nothing: any invalid text rejects everything.
  function importTexts(user: User, slug: string, b: Record<string, unknown>) {
    const { project } = projects.ownerAccess(user, slug);
    const incoming = flatten(b.texts);
    const apply = b.apply === true;
    const deprecateMissing = b.deprecateMissing === true;
    const existing = new Map((db.prepare("SELECT * FROM keys WHERE project_id = ? AND state <> 'deleted'").all(project.id) as unknown as KeyRow[]).map((k) => [k.name, k]));

    const problems: { key: string; problem: string }[] = [];
    for (const [name, text] of Object.entries(incoming)) {
      try { checkSource(name, text, existing.get(name)?.max_length ?? null); } catch (e) { problems.push({ key: name, problem: (e as Error).message }); }
    }
    if (problems.length) throw new ApiError(400, 'invalid_import', `${problems.length} invalid text(s): ` + problems.slice(0, 20).map((p) => p.problem).join('; '));

    const added: string[] = [], changed: string[] = [], reactivated: string[] = [], removed: string[] = [];
    let unchanged = 0;
    for (const [name, text] of Object.entries(incoming)) {
      const k = existing.get(name);
      if (!k) added.push(name);
      else if (k.source_text !== text) changed.push(name);
      else if (k.state === 'deprecated') reactivated.push(name);
      else unchanged++;
    }
    for (const [name, k] of existing) if (!(name in incoming) && k.state === 'active') removed.push(name);

    if (apply) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const ins = db.prepare('INSERT INTO keys (project_id, name, source_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
        const upd = db.prepare("UPDATE keys SET source_text = ?, state = 'active', updated_at = ? WHERE id = ?");
        const react = db.prepare("UPDATE keys SET state = 'active', updated_at = ? WHERE id = ?");
        const outdate = db.prepare('UPDATE translations SET outdated = 1 WHERE key_id = ?');
        const dep = db.prepare("UPDATE keys SET state = 'deprecated', updated_at = ? WHERE id = ?");
        for (const n of added) ins.run(project.id, n, incoming[n]!, iso(), iso());
        for (const n of changed) { const k = existing.get(n)!; upd.run(incoming[n]!, iso(), k.id); outdate.run(k.id); }
        for (const n of reactivated) react.run(iso(), existing.get(n)!.id);
        if (deprecateMissing) for (const n of removed) dep.run(iso(), existing.get(n)!.id);
        projects.audit(user.id, 'key.import', slug, undefined, { added: added.length, changed: changed.length, reactivated: reactivated.length, deprecated: deprecateMissing ? removed.length : 0 });
        db.exec('COMMIT');
        notifyOutdated(project.id, changed.map((n) => existing.get(n)!.id), user.id);
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    return { applied: apply, added, changed, reactivated, unchanged, removed, removedAreDeprecated: apply && deprecateMissing };
  }

  return { list, create, update, importTexts };
}
export type Keys = ReturnType<typeof createKeys>;
