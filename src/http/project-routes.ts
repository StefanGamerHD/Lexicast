import { normalizeEmail } from '../auth/crypto.ts';
import type { User } from '../auth/service.ts';
import type { Keys } from '../projects/keys.ts';
import type { Projects } from '../projects/service.ts';
import type { Locale } from '../i18n.ts';
import type { Mailer } from '../mail/mailer.ts';
import type { Outbound } from '../mail/outbound.ts';
import type { Releases } from '../releases/service.ts';
import type { Review } from '../review/service.ts';
import { str } from './util.ts';

export interface RouteCtx { user: User; params: string[]; body: Record<string, unknown>; query: URLSearchParams }
export interface Route { method: string; pattern: RegExp; body: boolean; bodyLimit?: number; handle: (c: RouteCtx) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }> }

const SLUG = '([a-z0-9][a-z0-9-]*)';
const TAG = '([A-Za-z0-9-]+)';
const KEY = '([^/]+)';
const ID = '([0-9]{1,9})';

// Authenticated routes; every handler enforces project roles inside the services.
export function createProjectRoutes({ projects, keys, review, releases, mailer, outbound, baseUrl }: { projects: Projects; keys: Keys; review: Review; releases: Releases; mailer: Mailer; outbound: Outbound; baseUrl: string }): Route[] {
  const r = (method: string, pattern: string, body: boolean, handle: Route['handle']): Route => ({ method, pattern: new RegExp(`^${pattern}$`), body, handle });
  const int = (v: string | null): number | undefined => (v !== null && /^\d{1,6}$/.test(v) ? Number(v) : undefined);
  return [
    r('GET', '/projects', false, (c) => ({ status: 200, body: { projects: projects.listFor(c.user) } })),
    r('POST', '/projects', true, (c) => ({ status: 201, body: { project: projects.create(c.user, { slug: c.body.slug, name: c.body.name, sourceLanguage: c.body.sourceLanguage, languages: c.body.languages }) } })),
    r('GET', `/projects/${SLUG}`, false, (c) => {
      const { project, roles } = projects.access(c.user, c.params[0]!);
      return { status: 200, body: { project, roles: { owner: roles.owner, reviewer: [...roles.reviewer], translator: [...roles.translator] }, progress: projects.progress(c.user, c.params[0]!) } };
    }),
    r('PATCH', `/projects/${SLUG}`, true, (c) => ({ status: 200, body: { project: projects.updateSettings(c.user, c.params[0]!, c.body) } })),
    r('PUT', `/projects/${SLUG}/languages/${TAG}`, true, (c) => ({ status: 200, body: { project: projects.setLanguage(c.user, c.params[0]!, c.params[1], c.body.fallback) } })),
    r('GET', `/projects/${SLUG}/members`, false, (c) => ({ status: 200, body: { members: projects.listMembers(c.user, c.params[0]!) } })),
    r('POST', `/projects/${SLUG}/members`, true, async (c) => {
      const slug = c.params[0]!;
      const out = projects.addMember(c.user, slug, c.body.email, c.body.role, c.body.language);
      if (!('token' in out)) return { status: 200, body: out };
      // With mail configured the link only travels by email; without mail, or if sending fails, the owner gets it once.
      const link = `${baseUrl}/invite/${out.token}`;
      if (!mailer.enabled) return { status: 201, body: { inviteUrl: link } };
      try {
        const to = normalizeEmail(c.body.email)!;
        await outbound.sendInvitation({ to, token: out.token, inviter: c.user.displayName, locale: c.user.uiLocale as Locale, project: projects.access(c.user, slug).project.name, role: String(c.body.role), language: typeof c.body.language === 'string' ? c.body.language : '' });
        return { status: 201, body: { sent: true } };
      } catch (e) {
        console.error('invitation mail failed:', (e as Error).message);
        return { status: 201, body: { sent: false, mailError: true, inviteUrl: link } };
      }
    }),
    r('POST', `/projects/${SLUG}/members/remove`, true, (c) => { projects.removeMember(c.user, c.params[0]!, c.body.userId, c.body.role, c.body.language); return { status: 200, body: { ok: true } }; }),
    r('GET', `/projects/${SLUG}/keys`, false, (c) => {
      const limit = int(c.query.get('limit')); const offset = int(c.query.get('offset'));
      return { status: 200, body: keys.list(c.user, c.params[0]!, { search: c.query.get('search'), state: c.query.get('state'), ...(limit !== undefined ? { limit } : {}), ...(offset !== undefined ? { offset } : {}) }) };
    }),
    r('POST', `/projects/${SLUG}/keys`, true, (c) => ({ status: 201, body: keys.create(c.user, c.params[0]!, c.body) })),
    { ...r('POST', `/projects/${SLUG}/keys/import`, true, (c) => ({ status: 200, body: keys.importTexts(c.user, c.params[0]!, c.body) })), bodyLimit: 2 * 1024 * 1024 },
    r('POST', `/projects/${SLUG}/suggestions`, true, (c) => ({ status: 201, body: review.submit(c.user, c.params[0]!, c.body) })),
    r('GET', `/projects/${SLUG}/suggestions`, false, (c) => {
      const limit = int(c.query.get('limit')); const offset = int(c.query.get('offset'));
      return { status: 200, body: review.list(c.user, c.params[0]!, { language: c.query.get('language'), state: c.query.get('state'), mine: c.query.get('mine') === '1', ...(limit !== undefined ? { limit } : {}), ...(offset !== undefined ? { offset } : {}) }) };
    }),
    r('POST', `/projects/${SLUG}/suggestions/${ID}/approve`, true, (c) => ({ status: 200, body: review.approve(c.user, c.params[0]!, Number(c.params[1])) })),
    r('POST', `/projects/${SLUG}/suggestions/${ID}/reject`, true, (c) => ({ status: 200, body: review.reject(c.user, c.params[0]!, Number(c.params[1]), c.body.reason) })),
    r('POST', `/projects/${SLUG}/suggestions/${ID}/withdraw`, true, (c) => ({ status: 200, body: review.withdraw(c.user, c.params[0]!, Number(c.params[1])) })),
    r('GET', `/projects/${SLUG}/releases`, false, (c) => ({ status: 200, body: releases.list(c.user, c.params[0]!) })),
    r('GET', `/projects/${SLUG}/releases/preview`, false, async (c) => ({ status: 200, body: await releases.preview(c.user, c.params[0]!) })),
    r('POST', `/projects/${SLUG}/releases`, true, async (c) => ({ status: 201, body: await releases.create(c.user, c.params[0]!, c.body) })),
    r('POST', `/projects/${SLUG}/releases/${ID}/rollback`, true, async (c) => ({ status: 201, body: await releases.rollback(c.user, c.params[0]!, Number(c.params[1]), c.body) })),
    r('PATCH', `/projects/${SLUG}/keys/${KEY}`, true, (c) => ({ status: 200, body: keys.update(c.user, c.params[0]!, str(c.params[1], 'key'), c.body) })),
  ];
}
