import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { pseudonymOf as pseudonymOfUser, writeAudit } from '../audit.ts';
import { ApiError, displayName } from '../http/util.ts';
import { DUMMY_HASH, hashPassword, hashToken, newToken, normalizeEmail, passwordProblem, verifyPassword } from './crypto.ts';

export interface User {
  id: number;
  email: string;
  displayName: string;
  isInstanceAdmin: boolean;
  uiLocale: string;
  theme: string;
  notifyEmail: boolean;
}

interface UserRow { id: number; email: string; display_name: string; password_hash: string; is_instance_admin: number; pseudonym: string; ui_locale: string; theme: string; notify_email: number; failed_logins: number; locked_until: string | null; deleted_at: string | null; email_verified_at: string | null }

const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, displayName: r.display_name, isInstanceAdmin: r.is_instance_admin === 1, uiLocale: r.ui_locale, theme: r.theme, notifyEmail: r.notify_email === 1 });

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const SESSION_MS = 7 * 24 * 3600_000;
const INVITE_MS = 7 * 24 * 3600_000;

export function createAuth(db: DatabaseSync, now: () => number = Date.now) {
  const iso = (t = now()) => new Date(t).toISOString();
  const setting = (k: string): string | undefined => (db.prepare('SELECT value FROM instance_settings WHERE key = ?').get(k) as { value: string } | undefined)?.value;
  const putSetting = (k: string, v: string) => db.prepare('INSERT INTO instance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

  const audit = (actorPseudonym: string, action: string, target?: string, details: object = {}) =>
    writeAudit(db, now, actorPseudonym, action, { ...(target !== undefined ? { target } : {}), details });

  const isSetupDone = (): boolean => setting('setup_done') === '1';

  // Called at every start while the instance is not set up: a fresh one-time token, shown only in the server log.
  function issueSetupToken(): string | null {
    if (isSetupDone()) return null;
    const token = newToken();
    putSetting('setup_token_hash', hashToken(token));
    return token;
  }

  async function completeSetup(input: { setupToken: string; email: unknown; displayName: string; password: unknown }): Promise<User> {
    const email = normalizeEmail(input.email);
    if (!email) throw new ApiError(400, 'invalid_email', 'Invalid email address');
    const problem = passwordProblem(input.password, email);
    if (problem) throw new ApiError(400, 'weak_password', problem);
    const passwordHash = await hashPassword(input.password as string);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (isSetupDone()) throw new ApiError(409, 'setup_done', 'Instance is already set up');
      const expected = setting('setup_token_hash');
      if (!expected || hashToken(input.setupToken) !== expected) throw new ApiError(403, 'bad_setup_token', 'Setup token is invalid');
      const pseudonym = 'u-' + randomBytes(6).toString('hex');
      const r = db.prepare(`INSERT INTO users (email, display_name, password_hash, email_verified_at, is_instance_admin, pseudonym, created_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)`).run(email, input.displayName, passwordHash, iso(), pseudonym, iso());
      putSetting('setup_done', '1');
      db.prepare("DELETE FROM instance_settings WHERE key = 'setup_token_hash'").run();
      audit(pseudonym, 'instance.setup', undefined, {});
      db.exec('COMMIT');
      return { id: Number(r.lastInsertRowid), email, displayName: input.displayName, isInstanceAdmin: true, uiLocale: 'en', theme: 'system', notifyEmail: true };
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  function createSession(userId: number): string {
    const token = newToken();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, iso(), iso(now() + SESSION_MS));
    return token;
  }

  async function login(emailIn: unknown, password: unknown): Promise<{ user: User; token: string }> {
    const email = normalizeEmail(emailIn);
    const row = email ? (db.prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL').get(email) as UserRow | undefined) : undefined;
    const generic = new ApiError(401, 'invalid_credentials', 'Email or password is wrong');
    if (typeof password !== 'string' || password.length > 256) throw generic;
    if (!row) { await verifyPassword(password, DUMMY_HASH); throw generic; }
    if (row.locked_until && row.locked_until > iso()) throw new ApiError(429, 'locked', 'Too many failed attempts, try again later');
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      const failed = row.failed_logins + 1;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? iso(now() + LOCK_MS) : null, row.id);
      if (failed >= MAX_FAILED) audit(row.pseudonym, 'auth.locked');
      throw generic;
    }
    if (!row.email_verified_at) throw new ApiError(403, 'email_not_verified', 'Email address is not verified');
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(row.id);
    if (row.is_instance_admin) audit(row.pseudonym, 'auth.login');
    return { user: toUser(row), token: createSession(row.id) };
  }

  function userForSession(token: string | undefined): User | null {
    if (!token) return null;
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`).get(hashToken(token), iso()) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  const logout = (token: string | undefined) => { if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token)); };

  function createInvitation(admin: User, emailIn: unknown): string {
    const email = normalizeEmail(emailIn);
    if (!email) throw new ApiError(400, 'invalid_email', 'Invalid email address');
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(email)) throw new ApiError(409, 'exists', 'An account with this email already exists');
    const token = newToken();
    // instance-level invitation: no project, role/language are placeholders until project invitations exist
    db.prepare(`INSERT INTO invitations (project_id, email, role, language, token_hash, created_by, created_at, expires_at)
      VALUES (NULL, ?, 'translator', '', ?, ?, ?, ?)`).run(email, hashToken(token), admin.id, iso(), iso(now() + INVITE_MS));
    audit(pseudonymOf(admin.id), 'invitation.create', undefined, {});
    return token;
  }

  async function acceptInvitation(token: string, displayName: string, password: unknown): Promise<User> {
    const inv = db.prepare('SELECT * FROM invitations WHERE token_hash = ?').get(hashToken(token)) as { id: number; project_id: number | null; role: string; language: string; email: string; expires_at: string; used_at: string | null } | undefined;
    if (!inv || inv.used_at || inv.expires_at < iso()) throw new ApiError(400, 'invalid_invitation', 'Invitation is invalid or expired');
    const problem = passwordProblem(password, inv.email);
    if (problem) throw new ApiError(400, 'weak_password', problem);
    const passwordHash = await hashPassword(password as string);
    db.exec('BEGIN IMMEDIATE');
    try {
      const fresh = db.prepare('SELECT used_at FROM invitations WHERE id = ?').get(inv.id) as { used_at: string | null };
      if (fresh.used_at) throw new ApiError(400, 'invalid_invitation', 'Invitation is invalid or expired');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(inv.email)) throw new ApiError(409, 'exists', 'An account with this email already exists');
      const pseudonym = 'u-' + randomBytes(6).toString('hex');
      // the link was sent to this address, so using it verifies the email
      const r = db.prepare(`INSERT INTO users (email, display_name, password_hash, email_verified_at, pseudonym, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(inv.email, displayName, passwordHash, iso(), pseudonym, iso());
      db.prepare('UPDATE invitations SET used_at = ? WHERE id = ?').run(iso(), inv.id);
      if (inv.project_id !== null) {
        db.prepare('INSERT OR IGNORE INTO members (project_id, user_id, role, language) VALUES (?, ?, ?, ?)').run(inv.project_id, Number(r.lastInsertRowid), inv.role, inv.role === 'owner' ? '' : inv.language);
      }
      audit(pseudonym, 'invitation.accept');
      db.exec('COMMIT');
      return { id: Number(r.lastInsertRowid), email: inv.email, displayName, isInstanceAdmin: false, uiLocale: 'en', theme: 'system', notifyEmail: true };
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const pseudonymOf = (userId: number): string => pseudonymOfUser(db, userId);

  const RESET_MS = 3600_000;
  const MAX_RESETS_PER_HOUR = 3;

  // Returns null for unknown accounts and when the hourly limit is reached: the caller must answer the same way in every case.
  function requestPasswordReset(emailIn: unknown): { token: string; email: string; locale: 'en' | 'de' } | null {
    const email = normalizeEmail(emailIn);
    if (!email) return null;
    const u = db.prepare('SELECT id, email, ui_locale, pseudonym FROM users WHERE email = ? AND deleted_at IS NULL AND email_verified_at IS NOT NULL').get(email) as { id: number; email: string; ui_locale: string; pseudonym: string } | undefined;
    if (!u) return null;
    const recent = (db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?').get(u.id, iso(now() - RESET_MS)) as { n: number }).n;
    if (recent >= MAX_RESETS_PER_HOUR) return null;
    const token = newToken();
    db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), u.id, iso(), iso(now() + RESET_MS));
    audit(u.pseudonym, 'auth.reset.request');
    return { token, email: u.email, locale: u.ui_locale === 'de' ? 'de' : 'en' };
  }

  async function confirmPasswordReset(token: unknown, password: unknown): Promise<{ email: string; locale: 'en' | 'de' }> {
    const invalid = new ApiError(400, 'invalid_token', 'The reset link is invalid or expired');
    if (typeof token !== 'string' || token.length > 100) throw invalid;
    const r = db.prepare(`SELECT pr.token_hash, pr.used_at, pr.expires_at, u.id, u.email, u.ui_locale, u.pseudonym FROM password_resets pr JOIN users u ON u.id = pr.user_id
      WHERE pr.token_hash = ? AND u.deleted_at IS NULL`).get(hashToken(token)) as { token_hash: string; used_at: string | null; expires_at: string; id: number; email: string; ui_locale: string; pseudonym: string } | undefined;
    if (!r || r.used_at || r.expires_at < iso()) throw invalid;
    const problem = passwordProblem(password, r.email);
    if (problem) throw new ApiError(400, 'weak_password', problem);
    const hash = await hashPassword(password as string);
    db.exec('BEGIN IMMEDIATE');
    try {
      const fresh = db.prepare('SELECT used_at FROM password_resets WHERE token_hash = ?').get(r.token_hash) as { used_at: string | null };
      if (fresh.used_at) throw invalid;
      db.prepare('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').run(hash, r.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(r.id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(iso(), r.id);
      audit(r.pseudonym, 'auth.reset.confirm');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { email: r.email, locale: r.ui_locale === 'de' ? 'de' : 'en' };
  }

  // Signed-in change: needs the current password, signs out every other session.
  async function changePassword(user: User, currentToken: string | undefined, current: unknown, next: unknown): Promise<void> {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (typeof current !== 'string' || current.length > 256 || !(await verifyPassword(current, row.password_hash))) throw new ApiError(403, 'wrong_password', 'The current password is wrong');
    const problem = passwordProblem(next, user.email);
    if (problem) throw new ApiError(400, 'weak_password', problem);
    if (next === current) throw new ApiError(400, 'weak_password', 'The new password must differ from the current one');
    const hash = await hashPassword(next as string);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user.id, currentToken ? hashToken(currentToken) : '');
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(iso(), user.id);
      audit(pseudonymOf(user.id), 'auth.password.change');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function updateProfile(user: User, b: Record<string, unknown>): User {
    const name = 'displayName' in b ? displayName(b.displayName) : user.displayName;
    const locale = 'uiLocale' in b ? b.uiLocale : user.uiLocale;
    const theme = 'theme' in b ? b.theme : user.theme;
    const notify = 'notifyEmail' in b ? b.notifyEmail : user.notifyEmail;
    if (locale !== 'en' && locale !== 'de') throw new ApiError(400, 'invalid_field', 'uiLocale must be en or de');
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') throw new ApiError(400, 'invalid_field', 'theme must be light, dark or system');
    if (typeof notify !== 'boolean') throw new ApiError(400, 'invalid_field', 'notifyEmail must be true or false');
    db.prepare('UPDATE users SET display_name = ?, ui_locale = ?, theme = ?, notify_email = ? WHERE id = ?').run(name, locale, theme, notify ? 1 : 0, user.id);
    return { ...user, displayName: name, uiLocale: locale, theme, notifyEmail: notify };
  }

  return { isSetupDone, issueSetupToken, completeSetup, login, userForSession, logout, createInvitation, acceptInvitation, requestPasswordReset, confirmPasswordReset, changePassword, updateProfile };
}
export type Auth = ReturnType<typeof createAuth>;
export { newToken };
