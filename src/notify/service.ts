import type { DatabaseSync } from 'node:sqlite';
import type { Mailer } from '../mail/mailer.ts';
import type { DigestItem, Outbound } from '../mail/outbound.ts';
import type { Locale } from '../i18n.ts';

export type Kind = 'suggestion_open' | 'suggestion_rejected' | 'release_published' | 'source_changed';
const MAX_AGE_MS = 7 * 24 * 3600_000;
const MAX_USERS_PER_RUN = 200;

// Queue of things people may want to hear about. Best effort: failing to queue never fails the action itself.
export function createNotifier(db: DatabaseSync, now: () => number = Date.now) {
  const iso = (t = now()) => new Date(t).toISOString();

  function enqueue(userIds: Iterable<number>, projectId: number, kind: Kind, detail: object, exceptUserId?: number): void {
    try {
      const ins = db.prepare('INSERT INTO notifications (user_id, project_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const id of new Set(userIds)) if (id !== exceptUserId) ins.run(id, projectId, kind, JSON.stringify(detail), iso());
    } catch (e) { console.error('notification queue failed:', (e as Error).message); }
  }

  const ids = (sql: string, ...args: (string | number)[]): number[] => (db.prepare(sql).all(...args) as { user_id: number }[]).map((r) => r.user_id);
  const owners = (projectId: number) => ids("SELECT user_id FROM members WHERE project_id = ? AND role = 'owner'", projectId);
  // reviewers of a language; the owners when nobody reviews it yet
  const reviewers = (projectId: number, language: string) => {
    const r = ids("SELECT user_id FROM members WHERE project_id = ? AND role = 'reviewer' AND language = ?", projectId, language);
    return r.length ? r : owners(projectId);
  };
  const languageMembers = (projectId: number, language: string) => ids("SELECT user_id FROM members WHERE project_id = ? AND role IN ('reviewer', 'translator') AND language = ?", projectId, language);

  const staff = (projectId: number) => [...owners(projectId), ...ids("SELECT user_id FROM members WHERE project_id = ? AND role = 'reviewer'", projectId)];
  return { enqueue, owners, reviewers, languageMembers, staff };
}
export type Notifier = ReturnType<typeof createNotifier>;

interface Row { id: number; user_id: number; kind: Kind; detail: string; email: string; display_name: string; ui_locale: string; notify_email: number; project_name: string }

// One mail per user and run. Mails that fail stay queued and are retried on the next run; entries older than 7 days are dropped.
export function createDigest(db: DatabaseSync, mailer: Mailer, outbound: Outbound, now: () => number = Date.now) {
  return async function run(): Promise<{ mails: number; failed: number }> {
    const iso = (t = now()) => new Date(t).toISOString();
    db.prepare('UPDATE notifications SET sent_at = ? WHERE sent_at IS NULL AND created_at < ?').run(iso(), iso(now() - MAX_AGE_MS));
    if (!mailer.enabled) return { mails: 0, failed: 0 };
    const rows = db.prepare(`SELECT n.id, n.user_id, n.kind, n.detail, u.email, u.display_name, u.ui_locale, u.notify_email, p.name AS project_name
      FROM notifications n JOIN users u ON u.id = n.user_id AND u.deleted_at IS NULL JOIN projects p ON p.id = n.project_id
      WHERE n.sent_at IS NULL ORDER BY n.id`).all() as unknown as Row[];
    const byUser = new Map<number, Row[]>();
    for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
    const mark = db.prepare('UPDATE notifications SET sent_at = ? WHERE id = ?');
    let mails = 0, failed = 0;
    for (const [, list] of [...byUser].slice(0, MAX_USERS_PER_RUN)) {
      const first = list[0]!;
      if (first.notify_email !== 1) { for (const r of list) mark.run(iso(), r.id); continue; }   // opted out meanwhile
      try {
        await outbound.sendDigest({ to: first.email, name: first.display_name, locale: (first.ui_locale === 'de' ? 'de' : 'en') as Locale, items: aggregate(list) });
        for (const r of list) mark.run(iso(), r.id);
        mails++;
      } catch (e) { failed++; console.error('digest mail failed:', (e as Error).message); }
    }
    return { mails, failed };
  };
}

function aggregate(rows: Row[]): DigestItem[] {
  const by = new Map<string, { kind: Kind; project: string; count: number; languages: Set<string>; numbers: Set<number> }>();
  for (const r of rows) {
    const d = JSON.parse(r.detail) as { language?: string; count?: number; number?: number };
    const k = `${r.kind}|${r.project_name}`;
    const e = by.get(k) ?? { kind: r.kind, project: r.project_name, count: 0, languages: new Set<string>(), numbers: new Set<number>() };
    e.count += d.count ?? 1;
    if (d.language) e.languages.add(d.language);
    if (d.number) e.numbers.add(d.number);
    by.set(k, e);
  }
  return [...by.values()].map((e): DigestItem => {
    const languages = [...e.languages].sort();
    switch (e.kind) {
      case 'suggestion_open': return { kind: e.kind, project: e.project, count: e.count, languages };
      case 'suggestion_rejected': return { kind: e.kind, project: e.project, count: e.count };
      case 'release_published': return { kind: e.kind, project: e.project, numbers: [...e.numbers].sort((a, b) => a - b) };
      case 'source_changed': return { kind: e.kind, project: e.project, count: e.count, languages };
    }
  });
}
