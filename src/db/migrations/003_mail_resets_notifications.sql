-- Password reset tokens, e-mail notification queue and the per-user opt-out.
ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1 CHECK (notify_email IN (0, 1));

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
) STRICT;
CREATE INDEX password_resets_user ON password_resets (user_id, created_at);

-- Collected and sent as one digest mail per user and run, never one mail per event.
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('suggestion_open', 'suggestion_rejected', 'release_published', 'source_changed')),
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  sent_at    TEXT
) STRICT;
CREATE INDEX notifications_unsent ON notifications (user_id) WHERE sent_at IS NULL;
