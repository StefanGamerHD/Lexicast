import type { DatabaseSync } from 'node:sqlite';
import { pseudonymOf, writeAudit } from '../audit.ts';
import { hashToken, newToken, normalizeEmail } from '../auth/crypto.ts';
import type { User } from '../auth/service.ts';
import { ApiError } from '../http/util.ts';
import { isLanguageTag, isProjectSlug } from '../release/validate.ts';

export type Role = 'owner' | 'reviewer' | 'translator';
const ROLES: Role[] = ['owner', 'reviewer', 'translator'];

export interface Language { tag: string; fallback: string[] }
export interface Project { id: number; slug: string; name: string; sourceLanguage: string; soloMode: boolean; progressPublic: boolean; languages: Language[] }
export interface Roles { owner: boolean; reviewer: Set<string>; translator: Set<string> }
export interface Access { project: Project; roles: Roles }

const INVITE_MS = 7 * 24 * 3600_000;

export function createProjects(db: DatabaseSync, now: () => number = Date.now) {
  const iso = (t = now()) => new Date(t).toISOString();
  const audit = (userId: number, action: string, project: string, target?: string, details?: object) =>
    writeAudit(db, now, pseudonymOf(db, userId), action, { project, ...(target !== undefined ? { target } : {}), ...(details ? { details } : {}) });

  function loadProject(where: string, arg: string | number): Project | undefined {
    const r = db.prepare(`SELECT * FROM projects WHERE ${where}`).get(arg) as { id: number; slug: string; name: string; source_language: string; solo_mode: number; progress_public: number } | undefined;
    if (!r) return undefined;
    const langs = db.prepare('SELECT tag, fallback_chain FROM project_languages WHERE project_id = ? ORDER BY tag').all(r.id) as { tag: string; fallback_chain: string }[];
    return {
      id: r.id, slug: r.slug, name: r.name, sourceLanguage: r.source_language, soloMode: r.solo_mode === 1, progressPublic: r.progress_public === 1,
      languages: langs.map((l) => ({ tag: l.tag, fallback: JSON.parse(l.fallback_chain) as string[] })),
    };
  }

  function rolesOf(userId: number, projectId: number): Roles {
    const rows = db.prepare('SELECT role, language FROM members WHERE project_id = ? AND user_id = ?').all(projectId, userId) as { role: Role; language: string }[];
    const roles: Roles = { owner: false, reviewer: new Set(), translator: new Set() };
    for (const m of rows) {
      if (m.role === 'owner') roles.owner = true; else roles[m.role].add(m.language);
    }
    return roles;
  }

  // Non-members get 404, so the existence of a project is not revealed. Instance admins get no implicit access.
  function access(user: User, slug: string): Access {
    const project = loadProject('slug = ?', slug);
    const roles = project ? rolesOf(user.id, project.id) : undefined;
    if (!project || !roles || (!roles.owner && !roles.reviewer.size && !roles.translator.size)) throw new ApiError(404, 'not_found', 'Project not found');
    return { project, roles };
  }
  function ownerAccess(user: User, slug: string): Access {
    const a = access(user, slug);
    if (!a.roles.owner) throw new ApiError(403, 'forbidden', 'Only a project owner can do this');
    return a;
  }

  function checkLanguages(sourceLanguage: string, languages: unknown): Language[] {
    if (!Array.isArray(languages) || languages.length === 0 || languages.length > 100) throw new ApiError(400, 'invalid_languages', 'languages must be a list of 1 to 100 entries');
    const out: Language[] = languages.map((l: unknown) => {
      const o = (l ?? {}) as { tag?: unknown; fallback?: unknown };
      if (typeof o.tag !== 'string' || !isLanguageTag(o.tag)) throw new ApiError(400, 'invalid_languages', `invalid language tag ${String(o.tag)}`);
      const fb = o.fallback ?? [];
      if (!Array.isArray(fb) || fb.some((x) => typeof x !== 'string')) throw new ApiError(400, 'invalid_languages', `fallback of ${o.tag} must be a list of tags`);
      return { tag: o.tag, fallback: fb as string[] };
    });
    const tags = new Set(out.map((l) => l.tag));
    if (tags.size !== out.length) throw new ApiError(400, 'invalid_languages', 'duplicate language');
    if (!tags.has(sourceLanguage)) throw new ApiError(400, 'invalid_languages', 'the source language must be one of the languages');
    for (const l of out) {
      if (new Set(l.fallback).size !== l.fallback.length) throw new ApiError(400, 'invalid_languages', `fallback of ${l.tag} has duplicates`);
      for (const f of l.fallback) if (!tags.has(f) || f === l.tag) throw new ApiError(400, 'invalid_languages', `fallback ${f} of ${l.tag} is not another project language`);
    }
    return out;
  }

  function create(admin: User, input: { slug: unknown; name: unknown; sourceLanguage: unknown; languages: unknown }): Project {
    if (!admin.isInstanceAdmin) throw new ApiError(403, 'forbidden', 'Only the instance admin can create projects');
    if (typeof input.slug !== 'string' || !isProjectSlug(input.slug)) throw new ApiError(400, 'invalid_slug', 'slug must be lowercase letters, digits and dashes');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new ApiError(400, 'invalid_name', 'name is missing or too long');
    if (typeof input.sourceLanguage !== 'string' || !isLanguageTag(input.sourceLanguage)) throw new ApiError(400, 'invalid_languages', 'invalid source language');
    const languages = checkLanguages(input.sourceLanguage, input.languages);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(input.slug)) throw new ApiError(409, 'exists', 'A project with this slug already exists');
      const r = db.prepare('INSERT INTO projects (slug, name, source_language, created_at) VALUES (?, ?, ?, ?)').run(input.slug, input.name.trim(), input.sourceLanguage, iso());
      const id = Number(r.lastInsertRowid);
      for (const l of languages) db.prepare('INSERT INTO project_languages (project_id, tag, fallback_chain) VALUES (?, ?, ?)').run(id, l.tag, JSON.stringify(l.fallback));
      db.prepare("INSERT INTO members (project_id, user_id, role, language) VALUES (?, ?, 'owner', '')").run(id, admin.id);
      audit(admin.id, 'project.create', input.slug);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return loadProject('slug = ?', input.slug)!;
  }

  function listFor(user: User): { slug: string; name: string; roles: string[] }[] {
    const rows = db.prepare(`SELECT p.slug, p.name, m.role, m.language FROM members m JOIN projects p ON p.id = m.project_id WHERE m.user_id = ? ORDER BY p.slug`).all(user.id) as { slug: string; name: string; role: string; language: string }[];
    const by = new Map<string, { slug: string; name: string; roles: string[] }>();
    for (const r of rows) {
      const e = by.get(r.slug) ?? { slug: r.slug, name: r.name, roles: [] };
      e.roles.push(r.language ? `${r.role}:${r.language}` : r.role);
      by.set(r.slug, e);
    }
    return [...by.values()];
  }

  function setLanguage(user: User, slug: string, tag: unknown, fallback: unknown): Project {
    const { project } = ownerAccess(user, slug);
    if (typeof tag !== 'string' || !isLanguageTag(tag)) throw new ApiError(400, 'invalid_languages', 'invalid language tag');
    const next = project.languages.filter((l) => l.tag !== tag).concat([{ tag, fallback: (fallback ?? []) as string[] }]);
    checkLanguages(project.sourceLanguage, next);
    db.prepare('INSERT INTO project_languages (project_id, tag, fallback_chain) VALUES (?, ?, ?) ON CONFLICT(project_id, tag) DO UPDATE SET fallback_chain = excluded.fallback_chain')
      .run(project.id, tag, JSON.stringify(next.find((l) => l.tag === tag)!.fallback));
    audit(user.id, 'project.language.set', slug, tag, { fallback });
    return loadProject('id = ?', project.id)!;
  }

  function validRole(role: unknown, language: unknown, project: Project): { role: Role; language: string } {
    if (typeof role !== 'string' || !ROLES.includes(role as Role)) throw new ApiError(400, 'invalid_role', 'role must be owner, reviewer or translator');
    if (role === 'owner') return { role, language: '' };
    if (typeof language !== 'string' || !project.languages.some((l) => l.tag === language)) throw new ApiError(400, 'invalid_language', 'language must be a project language');
    return { role: role as Role, language };
  }

  function listMembers(user: User, slug: string) {
    const { project } = ownerAccess(user, slug);
    return (db.prepare(`SELECT u.id, u.email, u.display_name AS displayName, m.role, m.language FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ? AND u.deleted_at IS NULL ORDER BY u.email, m.role, m.language`).all(project.id)) as unknown[];
  }

  // Existing account: membership at once. Unknown email: an invitation link (single use, 7 days).
  function addMember(user: User, slug: string, emailIn: unknown, roleIn: unknown, languageIn: unknown): { added: true } | { token: string } {
    const { project } = ownerAccess(user, slug);
    const email = normalizeEmail(emailIn);
    if (!email) throw new ApiError(400, 'invalid_email', 'Invalid email address');
    const { role, language } = validRole(roleIn, languageIn, project);
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL').get(email) as { id: number } | undefined;
    if (existing) {
      db.prepare('INSERT OR IGNORE INTO members (project_id, user_id, role, language) VALUES (?, ?, ?, ?)').run(project.id, existing.id, role, language);
      audit(user.id, 'member.add', slug, pseudonymOf(db, existing.id), { role, language });
      return { added: true };
    }
    const token = newToken();
    db.prepare(`INSERT INTO invitations (project_id, email, role, language, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(project.id, email, role, language, hashToken(token), user.id, iso(), iso(now() + INVITE_MS));
    audit(user.id, 'member.invite', slug, undefined, { role, language });
    return { token };
  }

  function removeMember(user: User, slug: string, userId: unknown, roleIn: unknown, languageIn: unknown): void {
    const { project } = ownerAccess(user, slug);
    if (typeof userId !== 'number' || !Number.isInteger(userId)) throw new ApiError(400, 'invalid_field', 'userId must be a number');
    const { role, language } = validRole(roleIn, languageIn, project);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (role === 'owner') {
        const owners = (db.prepare("SELECT COUNT(*) AS n FROM members WHERE project_id = ? AND role = 'owner'").get(project.id) as { n: number }).n;
        const isOwner = db.prepare("SELECT 1 FROM members WHERE project_id = ? AND user_id = ? AND role = 'owner'").get(project.id, userId);
        if (isOwner && owners <= 1) throw new ApiError(409, 'last_owner', 'A project needs at least one owner');
      }
      const r = db.prepare('DELETE FROM members WHERE project_id = ? AND user_id = ? AND role = ? AND language = ?').run(project.id, userId, role, language);
      if (!r.changes) throw new ApiError(404, 'not_found', 'Membership not found');
      audit(user.id, 'member.remove', slug, pseudonymOf(db, userId), { role, language });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  return { access, ownerAccess, create, listFor, setLanguage, listMembers, addMember, removeMember, audit };
}
export type Projects = ReturnType<typeof createProjects>;
