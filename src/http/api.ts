import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { Auth, User } from '../auth/service.ts';
import type { Config } from '../config.ts';
import type { Keys } from '../projects/keys.ts';
import type { Projects } from '../projects/service.ts';
import type { Releases } from '../releases/service.ts';
import type { Review } from '../review/service.ts';
import type { Signer } from '../signer/client.ts';
import { createProjectRoutes } from './project-routes.ts';
import { fingerprint } from '../signer/client.ts';
import { ApiError, createLimiter, parseCookies, readJson, sendJson, sessionCookie, str } from './util.ts';

export interface ApiDeps { config: Config; auth: Auth; signer: Signer; projects: Projects; keys: Keys; review: Review; releases: Releases }

// JSON API under /api/v1. Cookie-authenticated, so every state-changing request must come from our own origin.
export function createApiHandler({ config, auth, signer, projects, keys, review, releases }: ApiDeps) {
  const routes = createProjectRoutes({ projects, keys, review, releases, baseUrl: config.baseUrl });
  const origin = new URL(config.baseUrl).origin;
  const secure = config.baseUrl.startsWith('https://');
  const cookieName = secure ? '__Host-lexicast' : 'lexicast_session';
  const authLimited = createLimiter(config.authRatePerMinute);
  const cookieOpts = { secure, maxAgeSeconds: 7 * 24 * 3600 };

  const clientIp = (req: IncomingMessage): string => {
    const h = config.trustProxyHeader ? req.headers[config.trustProxyHeader] : undefined;
    return String((Array.isArray(h) ? h[0] : h) ?? req.socket.remoteAddress);
  };
  const sessionToken = (req: IncomingMessage) => parseCookies(req.headers.cookie)[cookieName];
  const currentUser = (req: IncomingMessage): User | null => auth.userForSession(sessionToken(req));
  const requireUser = (req: IncomingMessage): User => {
    const u = currentUser(req);
    if (!u) throw new ApiError(401, 'unauthenticated', 'Sign in required');
    return u;
  };

  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/api/v1/')) return false;
    const route = `${req.method} ${url.pathname.slice('/api/v1'.length)}`;
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers.origin !== origin) throw new ApiError(403, 'bad_origin', 'Request origin is not allowed');
        if (authLimited(clientIp(req))) throw new ApiError(429, 'rate_limited', 'Too many requests');
      }
      switch (route) {
        case 'GET /instance': {
          const done = auth.isSetupDone();
          const publicKey = done ? await signer.publicKey() : null;
          return sendJson(res, 200, { setupDone: done, publicKey, fingerprint: publicKey ? fingerprint(publicKey) : null }), true;
        }
        case 'POST /setup': {
          const b = await readJson(req);
          const user = await auth.completeSetup({ setupToken: str(b.setupToken, 'setupToken'), email: b.email, displayName: str(b.displayName, 'displayName', 100), password: b.password });
          const publicKey = await signer.publicKey(); // creates the signing key on first use
          const login = await auth.login(user.email, b.password);
          return sendJson(res, 201, { user, publicKey, fingerprint: fingerprint(publicKey) }, { 'Set-Cookie': sessionCookie(cookieName, login.token, cookieOpts) }), true;
        }
        case 'POST /auth/login': {
          const b = await readJson(req);
          const { user, token } = await auth.login(b.email, b.password);
          return sendJson(res, 200, { user }, { 'Set-Cookie': sessionCookie(cookieName, token, cookieOpts) }), true;
        }
        case 'POST /auth/logout': {
          auth.logout(sessionToken(req));
          return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(cookieName, '', { ...cookieOpts, maxAgeSeconds: 0 }) }), true;
        }
        case 'GET /me':
          return sendJson(res, 200, { user: requireUser(req) }), true;
        case 'POST /invitations': {
          const admin = requireUser(req);
          if (!admin.isInstanceAdmin) throw new ApiError(403, 'forbidden', 'Only the instance admin can invite');
          const b = await readJson(req);
          const token = auth.createInvitation(admin, b.email);
          // Shown once. Sending it by email arrives with the mail transport; until then the inviter passes it on.
          return sendJson(res, 201, { inviteUrl: `${config.baseUrl}/invite/${token}` }), true;
        }
        case 'POST /invitations/accept': {
          const b = await readJson(req);
          const user = await auth.acceptInvitation(str(b.token, 'token'), str(b.displayName, 'displayName', 100), b.password);
          const login = await auth.login(user.email, b.password);
          return sendJson(res, 201, { user }, { 'Set-Cookie': sessionCookie(cookieName, login.token, cookieOpts) }), true;
        }
        default: {
          const path = url.pathname.slice('/api/v1'.length);
          for (const r of routes) {
            const m = r.pattern.exec(path);
            if (r.method !== req.method || !m) continue;
            const user = requireUser(req);
            const body = r.body ? await readJson(req, r.bodyLimit) : {};
            const out = await r.handle({ user, params: m.slice(1).map((x) => decodeURIComponent(x)), body, query: url.searchParams });
            return sendJson(res, out.status, out.body), true;
          }
          throw new ApiError(404, 'not_found', 'Unknown endpoint');
        }
      }
    } catch (e) {
      if (e instanceof ApiError) {
        sendJson(res, e.status, { error: { code: e.code, message: e.message } });
      } else {
        // never echo internals; log a short id so the operator can correlate
        const id = createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 8);
        console.error(`api error ${id}:`, (e as Error).message);
        sendJson(res, 500, { error: { code: 'internal', message: `Internal error (${id})` } });
      }
      return true;
    }
  };
}
