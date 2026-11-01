import { chmodSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = path.join(import.meta.dirname, 'migrations');

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') chmodSync(file, 0o600);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

// Applies pending migrations in order, each in its own transaction. Never edits applied ones.
export function migrate(db: DatabaseSync, dir: string = MIGRATIONS): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
  const current = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v;
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  let latest = current;
  for (const f of files) {
    const version = Number(f.slice(0, 3));
    if (version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(path.join(dir, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
    latest = version;
  }
  return latest;
}
