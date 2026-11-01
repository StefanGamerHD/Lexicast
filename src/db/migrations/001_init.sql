-- Lexicast schema, version 1. See functional-plan.md for the meaning of roles and states.

CREATE TABLE instance_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE users (
  id                INTEGER PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name      TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  email_verified_at TEXT,
  is_instance_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_instance_admin IN (0, 1)),
  pseudonym         TEXT NOT NULL UNIQUE,
  ui_locale         TEXT NOT NULL DEFAULT 'en',
  theme             TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,
  created_at        TEXT NOT NULL,
  deleted_at        TEXT
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE projects (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  name            TEXT NOT NULL,
  source_language TEXT NOT NULL,
  solo_mode       INTEGER NOT NULL DEFAULT 0 CHECK (solo_mode IN (0, 1)),
  progress_public INTEGER NOT NULL DEFAULT 1 CHECK (progress_public IN (0, 1)),
  created_at      TEXT NOT NULL
) STRICT;

CREATE TABLE project_languages (
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag            TEXT NOT NULL,
  fallback_chain TEXT NOT NULL DEFAULT '[]',   -- JSON array of language tags, resolved at release build time
  PRIMARY KEY (project_id, tag)
) STRICT;

-- role 'owner' has language ''; reviewer and translator are per language.
CREATE TABLE members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'reviewer', 'translator')),
  language   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, user_id, role, language),
  CHECK ((role = 'owner' AND language = '') OR (role <> 'owner' AND language <> ''))
) STRICT;

CREATE TABLE invitations (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  email      TEXT NOT NULL COLLATE NOCASE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'reviewer', 'translator')),
  language   TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
) STRICT;

CREATE TABLE keys (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  source_text  TEXT NOT NULL,
  context_note TEXT NOT NULL DEFAULT '',
  max_length   INTEGER CHECK (max_length IS NULL OR max_length > 0),
  state        TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'deprecated', 'deleted')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (project_id, name)
) STRICT;

-- The currently approved text per key and language (what the next release contains).
CREATE TABLE translations (
  key_id      INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
  language    TEXT NOT NULL,
  text        TEXT NOT NULL,
  outdated    INTEGER NOT NULL DEFAULT 0 CHECK (outdated IN (0, 1)),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT NOT NULL,
  PRIMARY KEY (key_id, language)
) STRICT;

CREATE TABLE suggestions (
  id            INTEGER PRIMARY KEY,
  key_id        INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
  language      TEXT NOT NULL,
  text          TEXT NOT NULL,
  author_id     INTEGER NOT NULL REFERENCES users(id),
  state         TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'approved', 'rejected', 'withdrawn', 'superseded')),
  reviewer_id   INTEGER REFERENCES users(id),
  solo_approved INTEGER NOT NULL DEFAULT 0 CHECK (solo_approved IN (0, 1)),
  reject_reason TEXT,
  created_at    TEXT NOT NULL,
  reviewed_at   TEXT,
  -- four-eyes principle enforced in the database, not only in code; solo mode is the explicit, logged exception
  CHECK (reviewer_id IS NULL OR reviewer_id <> author_id OR solo_approved = 1),
  CHECK (state <> 'rejected' OR (reject_reason IS NOT NULL AND length(reject_reason) > 0))
) STRICT;
CREATE INDEX suggestions_open ON suggestions (key_id, language) WHERE state = 'open';

CREATE TABLE releases (
  id             INTEGER PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number         INTEGER NOT NULL CHECK (number > 0),
  state          TEXT NOT NULL CHECK (state IN ('building', 'published', 'failed')),
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  change_summary TEXT NOT NULL DEFAULT '{}',   -- JSON: added, changed, removed per language
  rolled_back_to INTEGER,
  failure_reason TEXT,
  UNIQUE (project_id, number)
) STRICT;

CREATE TABLE api_tokens (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes     TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;

-- Append-only. Stores a pseudonym instead of a user link, so account deletion needs no change here.
CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY,
  at              TEXT NOT NULL,
  actor_pseudonym TEXT NOT NULL,
  action          TEXT NOT NULL,
  project_slug    TEXT,
  target          TEXT,
  details         TEXT NOT NULL DEFAULT '{}'
) STRICT;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
