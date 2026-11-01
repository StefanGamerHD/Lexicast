import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { createLimiter } from '../http/util.ts';
import { pickLocale, t, type Locale } from '../i18n.ts';

export interface LanguageProgress { tag: string; translated: number; total: number; percent: number; inReview: number; outdated: number; isSource: boolean }
export interface Progress {
  project: { slug: string; name: string; sourceLanguage: string };
  languages: LanguageProgress[];
  liveRelease: { number: number; createdAt: string } | null;
}

// Counts only: no key names, no texts, no people. Returns null for unknown AND for hidden projects (no existence leak).
export function loadProgress(db: DatabaseSync, slug: string): Progress | null {
  const p = db.prepare('SELECT id, slug, name, source_language, progress_public FROM projects WHERE slug = ?').get(slug) as { id: number; slug: string; name: string; source_language: string; progress_public: number } | undefined;
  if (!p || p.progress_public !== 1) return null;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM keys WHERE project_id = ? AND state = 'active'").get(p.id) as { n: number }).n;
  const langs = db.prepare('SELECT tag FROM project_languages WHERE project_id = ? ORDER BY tag').all(p.id) as { tag: string }[];
  const counts = (sql: string) => new Map((db.prepare(sql).all(p.id) as { language: string; n: number }[]).map((r) => [r.language, r.n]));
  const translated = counts("SELECT t.language, COUNT(*) AS n FROM translations t JOIN keys k ON k.id = t.key_id WHERE k.project_id = ? AND k.state = 'active' AND t.outdated = 0 GROUP BY t.language");
  const outdated = counts("SELECT t.language, COUNT(*) AS n FROM translations t JOIN keys k ON k.id = t.key_id WHERE k.project_id = ? AND k.state = 'active' AND t.outdated = 1 GROUP BY t.language");
  const review = counts("SELECT s.language, COUNT(DISTINCT s.key_id) AS n FROM suggestions s JOIN keys k ON k.id = s.key_id WHERE k.project_id = ? AND k.state = 'active' AND s.state = 'open' GROUP BY s.language");
  const live = db.prepare("SELECT number, created_at FROM releases WHERE project_id = ? AND state = 'published' ORDER BY number DESC LIMIT 1").get(p.id) as { number: number; created_at: string } | undefined;
  return {
    project: { slug: p.slug, name: p.name, sourceLanguage: p.source_language },
    languages: langs.map(({ tag }) => {
      const isSource = tag === p.source_language;
      const done = isSource ? total : (translated.get(tag) ?? 0);
      return { tag, translated: done, total, percent: total === 0 ? 0 : Math.floor((done * 100) / total), inReview: isSource ? 0 : (review.get(tag) ?? 0), outdated: isSource ? 0 : (outdated.get(tag) ?? 0), isSource };
    }),
    liveRelease: live ? { number: live.number, createdAt: live.created_at } : null,
  };
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function languageName(tag: string, locale: Locale): string {
  try { return new Intl.DisplayNames([locale], { type: 'language' }).of(tag) ?? tag; } catch { return tag; }
}

export function renderProgress(p: Progress, locale: Locale): string {
  const e = escapeHtml;
  const rows = p.languages.map((l) => {
    const name = `${e(languageName(l.tag, locale))} <span class="tag">${e(l.tag)}</span>`;
    const extra = [l.isSource ? t(locale, 'progress.source') : '', l.inReview ? t(locale, 'progress.inReview', { count: l.inReview }) : '', l.outdated ? t(locale, 'progress.outdated', { count: l.outdated }) : ''].filter(Boolean).map(e).join(' · ');
    return `<li><div class="row"><span class="name">${name}</span><span class="pct">${l.percent}%</span></div>
<progress max="100" value="${l.percent}" aria-label="${e(languageName(l.tag, locale))}">${l.percent}%</progress>
<div class="meta">${e(t(locale, 'progress.translated', { done: l.translated, total: l.total }))}${extra ? ' · ' + extra : ''}</div></li>`;
  }).join('\n');
  const live = p.liveRelease
    ? t(locale, 'progress.live', { number: p.liveRelease.number, date: new Date(p.liveRelease.createdAt).toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-GB', { timeZone: 'UTC' }) })
    : t(locale, 'progress.noRelease');
  const empty = p.languages.every((l) => l.total === 0);
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(p.project.name)} · ${e(t(locale, 'progress.title'))}</title>
<link rel="stylesheet" href="/assets/progress.css">
</head>
<body>
<main>
<p class="eyebrow">${e(t(locale, 'progress.title'))}</p>
<h1>${e(p.project.name)}</h1>
<p class="live">${e(live)}</p>
${empty ? `<p>${e(t(locale, 'progress.empty'))}</p>` : `<ul>\n${rows}\n</ul>`}
<p class="note">${e(t(locale, 'progress.privacy'))}</p>
</main>
</body>
</html>
`;
}

export const PROGRESS_CSS = `:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--line:#d6d3d1;--bar:#e7e5e4;--fill:#0f766e;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#fafaf9;--muted:#a8a29e;--line:#44403c;--bar:#292524;--fill:#2dd4bf;--card:#231f1e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:40rem;margin:0 auto;padding:2rem 1rem 3rem}
.eyebrow{margin:0;color:var(--muted);font-size:.875rem;letter-spacing:.04em;text-transform:uppercase}
h1{margin:.25rem 0 .5rem;font-size:1.75rem;line-height:1.2;overflow-wrap:anywhere}
.live{margin:0 0 1.5rem;color:var(--muted)}
ul{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}
li{background:var(--card);border:1px solid var(--line);border-radius:.5rem;padding:.75rem 1rem}
.row{display:flex;justify-content:space-between;gap:1rem;align-items:baseline}
.name{font-weight:600}.tag{color:var(--muted);font-weight:400;font-size:.875rem;margin-left:.25rem}
.pct{font-variant-numeric:tabular-nums;font-weight:600}
progress{width:100%;height:.625rem;margin:.5rem 0;border:0;border-radius:999px;background:var(--bar);overflow:hidden;-webkit-appearance:none;appearance:none}
progress::-webkit-progress-bar{background:var(--bar)}
progress::-webkit-progress-value{background:var(--fill);border-radius:999px}
progress::-moz-progress-bar{background:var(--fill);border-radius:999px}
.meta{color:var(--muted);font-size:.875rem}
.note{margin-top:2rem;color:var(--muted);font-size:.875rem}
`;

const PAGE = /^\/progress\/([a-z0-9][a-z0-9-]{0,62})$/;
const DATA = /^\/api\/v1\/public\/projects\/([a-z0-9][a-z0-9-]{0,62})\/progress$/;

export function createProgressHandler(db: DatabaseSync, ratePerMinute: number, trustProxyHeader: string | null) {
  const limited = createLimiter(ratePerMinute);
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const isCss = url.pathname === '/assets/progress.css';
    const page = PAGE.exec(url.pathname);
    const data = DATA.exec(url.pathname);
    if (!isCss && !page && !data) return false;
    const send = (code: number, headers: Record<string, string>, body: string) => {
      res.writeHead(code, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, { Allow: 'GET, HEAD' }, ''); return true; }
    const header = trustProxyHeader ? req.headers[trustProxyHeader] : undefined;
    if (limited(String((Array.isArray(header) ? header[0] : header) ?? req.socket.remoteAddress))) { send(429, { 'Retry-After': '30' }, 'rate limit'); return true; }
    if (isCss) { send(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }, PROGRESS_CSS); return true; }
    const progress = loadProgress(db, (page ?? data)![1]!);
    if (data) {
      if (!progress) send(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, '{"error":{"code":"not_found","message":"Not found"}}');
      else send(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' }, JSON.stringify(progress));
      return true;
    }
    const locale = pickLocale(req.headers['accept-language']);
    const csp = "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    if (!progress) send(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp }, 'Not found');
    else send(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'Vary': 'Accept-Language', 'Content-Security-Policy': csp }, renderProgress(progress, locale));
    return true;
  };
}
