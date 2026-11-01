import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openDatabase } from '../src/db/migrate.ts';

function fresh(): DatabaseSync {
  const db = openDatabase(':memory:'); migrate(db);
  const now = '2026-11-01T00:00:00Z';
  for (const [i, e] of ['a@x.test', 'b@x.test'].entries()) {
    db.prepare('INSERT INTO users (email, display_name, password_hash, pseudonym, created_at) VALUES (?, ?, ?, ?, ?)').run(e, e, 'hash', `p${i}`, now);
  }
  db.prepare("INSERT INTO projects (slug, name, source_language, created_at) VALUES ('demo', 'Demo', 'en', ?)").run(now);
  db.prepare("INSERT INTO keys (project_id, name, source_text, created_at, updated_at) VALUES (1, 'k', 'Hello', ?, ?)").run(now, now);
  return db;
}
const addSuggestion = (db: DatabaseSync, over: Record<string, string | number | null> = {}) => {
  const v = { author_id: 1, state: 'open', reviewer_id: null, solo_approved: 0, reject_reason: null, ...over };
  return db.prepare('INSERT INTO suggestions (key_id, language, text, author_id, state, reviewer_id, solo_approved, reject_reason, created_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('de', 'Hallo', v.author_id, v.state, v.reviewer_id, v.solo_approved, v.reject_reason, '2026-11-01T00:00:00Z');
};

test('migrations apply once and are idempotent', () => {
  const db = openDatabase(':memory:');
  assert.equal(migrate(db), 3);
  assert.equal(migrate(db), 3);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n, 3);
});

test('four-eyes rule is enforced by the database', () => {
  const db = fresh();
  assert.throws(() => addSuggestion(db, { state: 'approved', reviewer_id: 1 }), /CHECK/);
  addSuggestion(db, { state: 'approved', reviewer_id: 2 });
  addSuggestion(db, { state: 'approved', reviewer_id: 1, solo_approved: 1 }); // explicit solo-mode exception
});

test('a rejection needs a reason', () => {
  const db = fresh();
  assert.throws(() => addSuggestion(db, { state: 'rejected', reviewer_id: 2 }), /CHECK/);
  addSuggestion(db, { state: 'rejected', reviewer_id: 2, reject_reason: 'wrong term' });
});

test('audit log is append-only', () => {
  const db = fresh();
  db.prepare("INSERT INTO audit_log (at, actor_pseudonym, action) VALUES ('2026-11-01T00:00:00Z', 'p0', 'login')").run();
  assert.throws(() => db.exec("UPDATE audit_log SET action = 'x'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM audit_log'), /append-only/);
});

test('constraints: roles, states, slugs, foreign keys, unique keys', () => {
  const db = fresh();
  assert.throws(() => db.exec("INSERT INTO members VALUES (1, 1, 'owner', 'de')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO members VALUES (1, 1, 'reviewer', '')"), /CHECK/);
  db.exec("INSERT INTO members VALUES (1, 1, 'owner', '')");
  assert.throws(() => db.exec("INSERT INTO projects (slug, name, source_language, created_at) VALUES ('Bad Slug', 'x', 'en', 'now')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO keys (project_id, name, source_text, created_at, updated_at) VALUES (1, 'k', 'dup', 'n', 'n')"), /UNIQUE/);
  assert.throws(() => db.exec("INSERT INTO keys (project_id, name, source_text, created_at, updated_at) VALUES (99, 'z', 'x', 'n', 'n')"), /FOREIGN KEY/);
  assert.throws(() => db.exec("INSERT INTO releases (project_id, number, state, created_at) VALUES (1, 1, 'weird', 'n')"), /CHECK/);
  db.exec("INSERT INTO releases (project_id, number, state, created_at) VALUES (1, 1, 'published', 'n')");
  assert.throws(() => db.exec("INSERT INTO releases (project_id, number, state, created_at) VALUES (1, 1, 'published', 'n')"), /UNIQUE/);
});

test('a failing migration is rolled back completely', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const os = await import('node:os'); const path = await import('node:path');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (x INTEGER) STRICT;');
  writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE b (x INTEGER) STRICT; INSERT INTO nope VALUES (1);');
  const db = openDatabase(':memory:');
  assert.throws(() => migrate(db, dir), /002_bad.sql failed/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'b'").get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v, 1);
});
