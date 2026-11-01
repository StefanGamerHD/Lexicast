import type { DatabaseSync } from 'node:sqlite';

export function writeAudit(db: DatabaseSync, now: () => number, actorPseudonym: string, action: string, opts: { project?: string; target?: string; details?: object } = {}): void {
  db.prepare('INSERT INTO audit_log (at, actor_pseudonym, action, project_slug, target, details) VALUES (?, ?, ?, ?, ?, ?)')
    .run(new Date(now()).toISOString(), actorPseudonym, action, opts.project ?? null, opts.target ?? null, JSON.stringify(opts.details ?? {}));
}

export const pseudonymOf = (db: DatabaseSync, userId: number): string =>
  (db.prepare('SELECT pseudonym FROM users WHERE id = ?').get(userId) as { pseudonym: string }).pseudonym;
