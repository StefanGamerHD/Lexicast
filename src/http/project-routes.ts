import type { User } from '../auth/service.ts';
import type { Keys } from '../projects/keys.ts';
import type { Projects } from '../projects/service.ts';
import { str } from './util.ts';

export interface RouteCtx { user: User; params: string[]; body: Record<string, unknown>; query: URLSearchParams }
export interface Route { method: string; pattern: RegExp; body: boolean; bodyLimit?: number; handle: (c: RouteCtx) => { status: number; body: unknown } }

const SLUG = '([a-z0-9][a-z0-9-]*)';
const TAG = '([A-Za-z0-9-]+)';
const KEY = '([^/]+)';

// Authenticated routes; every handler enforces project roles inside the services.
export function createProjectRoutes({ projects, keys, baseUrl }: { projects: Projects; keys: Keys; baseUrl: string }): Route[] {
  const r = (method: string, pattern: string, body: boolean, handle: Route['handle']): Route => ({ method, pattern: new RegExp(`^${pattern}$`), body, handle });
  const int = (v: string | null): number | undefined => (v !== null && /^\d{1,6}$/.test(v) ? Number(v) : undefined);
  return [
    r('GET', '/projects', false, (c) => ({ status: 200, body: { projects: projects.listFor(c.user) } })),
    r('POST', '/projects', true, (c) => ({ status: 201, body: { project: projects.create(c.user, { slug: c.body.slug, name: c.body.name, sourceLanguage: c.body.sourceLanguage, languages: c.body.languages }) } })),
    r('GET', `/projects/${SLUG}`, false, (c) => {
      const { project, roles } = projects.access(c.user, c.params[0]!);
      return { status: 200, body: { project, roles: { owner: roles.owner, reviewer: [...roles.reviewer], translator: [...roles.translator] } } };
    }),
    r('PUT', `/projects/${SLUG}/languages/${TAG}`, true, (c) => ({ status: 200, body: { project: projects.setLanguage(c.user, c.params[0]!, c.params[1], c.body.fallback) } })),
    r('GET', `/projects/${SLUG}/members`, false, (c) => ({ status: 200, body: { members: projects.listMembers(c.user, c.params[0]!) } })),
    r('POST', `/projects/${SLUG}/members`, true, (c) => {
      const out = projects.addMember(c.user, c.params[0]!, c.body.email, c.body.role, c.body.language);
      // Shown once. Sending it by email arrives with the mail transport.
      return 'token' in out ? { status: 201, body: { inviteUrl: `${baseUrl}/invite/${out.token}` } } : { status: 200, body: out };
    }),
    r('POST', `/projects/${SLUG}/members/remove`, true, (c) => { projects.removeMember(c.user, c.params[0]!, c.body.userId, c.body.role, c.body.language); return { status: 200, body: { ok: true } }; }),
    r('GET', `/projects/${SLUG}/keys`, false, (c) => {
      const limit = int(c.query.get('limit')); const offset = int(c.query.get('offset'));
      return { status: 200, body: keys.list(c.user, c.params[0]!, { search: c.query.get('search'), state: c.query.get('state'), ...(limit !== undefined ? { limit } : {}), ...(offset !== undefined ? { offset } : {}) }) };
    }),
    r('POST', `/projects/${SLUG}/keys`, true, (c) => ({ status: 201, body: keys.create(c.user, c.params[0]!, c.body) })),
    { ...r('POST', `/projects/${SLUG}/keys/import`, true, (c) => ({ status: 200, body: keys.importTexts(c.user, c.params[0]!, c.body) })), bodyLimit: 2 * 1024 * 1024 },
    r('PATCH', `/projects/${SLUG}/keys/${KEY}`, true, (c) => ({ status: 200, body: keys.update(c.user, c.params[0]!, str(c.params[1], 'key'), c.body) })),
  ];
}
