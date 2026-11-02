// Shapes of the project API (src/http/project-routes.ts) and small helpers the project screens share.
import { api } from './api.ts';
import { i18n, t } from './i18n.svelte.ts';

export interface Language { tag: string; fallback: string[] }
export interface Project { id: number; slug: string; name: string; sourceLanguage: string; soloMode: boolean; progressPublic: boolean; languages: Language[] }
export interface Roles { owner: boolean; reviewer: string[]; translator: string[] }
export interface LanguageProgress { tag: string; translated: number; total: number; percent: number; inReview: number; outdated: number; isSource: boolean }
export interface ProjectInfo { project: Project; roles: Roles; progress: { languages: LanguageProgress[]; liveRelease: { number: number; createdAt: string } | null } }
export interface ProjectSummary { slug: string; name: string; roles: string[] }
export interface KeyItem {
  name: string; sourceText: string; contextNote: string; maxLength: number | null; state: string;
  translations: Record<string, { text: string; outdated: boolean }>;
  openSuggestions: Record<string, number>;
}
export type Warning = 'much_longer' | 'much_shorter' | 'whitespace_differs' | 'punctuation_differs' | 'same_as_source' | 'new_url_or_email' | 'looks_like_markup';
export interface Suggestion {
  id: number; key: string; language: string; text: string; state: string; author: string; mine: boolean; createdAt: string;
  sourceText: string; currentText: string | null; sourceChanged: boolean; warnings: Warning[]; rejectReason: string | null;
}

// The newest own suggestion for a key in the editor.
export interface Mine { id: number; text: string; state: string; rejectReason: string | null }

export interface LanguageChanges { added: number; changed: number; removed: number }
export interface ReleasePreview {
  liveRelease: number | null; nextRelease: number; hasChanges: boolean; openSuggestions: number;
  summary: { languages: Record<string, LanguageChanges>; soloApprovals: number; outdatedExcluded: number };
  changes: Record<string, { added: string[]; changed: string[]; removed: string[] }>;
}
export interface Release {
  number: number; state: 'building' | 'published' | 'failed'; createdAt: string; createdBy: string | null; note: string;
  rolledBackTo: number | null; failureReason: string | null;
  summary: { languages?: Record<string, LanguageChanges>; soloApprovals?: number; outdatedExcluded?: number; rolledBackTo?: number } | null;
}
export interface ImportResult { applied: boolean; added: string[]; changed: string[]; reactivated: string[]; unchanged: number; removed: string[]; removedAreDeprecated: boolean }

export interface MemberRow { id: number; email: string; displayName: string; role: 'owner' | 'reviewer' | 'translator'; language: string }
export interface Invitation { id: number; email: string; role: string; language: string; createdAt: string; expiresAt: string; expired: boolean; invitedBy: string | null }

// "Owner", "Reviewer de", "Translator fr": one text per role, shared by the role badges and the members page.
export const roleLabel = (role: string, language: string): string => (language ? t(`role.${role}Of`, { lang: language }) : t(`role.${role}`));

export const isLanguageTag = (s: string): boolean => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s);

export const loadProject = (slug: string) => api<ProjectInfo>('GET', `/projects/${slug}`);

// The server pages keys (max 500 per request); the editor filters on the client, so it loads them all.
export async function loadAllKeys(slug: string, state: '' | 'active' | 'deprecated' = 'active'): Promise<KeyItem[]> {
  const out: KeyItem[] = [];
  for (;;) {
    const r = await api<{ total: number; keys: KeyItem[] }>('GET', `/projects/${slug}/keys?${state ? `state=${state}&` : ''}limit=500&offset=${out.length}`);
    out.push(...r.keys);
    if (!r.keys.length || out.length >= r.total) return out;
  }
}

export async function loadSuggestions(slug: string, query: string): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  for (;;) {
    const r = await api<{ total: number; suggestions: Suggestion[] }>('GET', `/projects/${slug}/suggestions?${query}&limit=200&offset=${out.length}`);
    out.push(...r.suggestions);
    if (!r.suggestions.length || out.length >= r.total) return out;
  }
}

export const canTranslate = (r: Roles, lang: string, p: Project): boolean => lang !== p.sourceLanguage && (r.owner || r.translator.includes(lang) || r.reviewer.includes(lang));
export const canReview = (r: Roles, lang: string): boolean => r.owner || r.reviewer.includes(lang);
export const reviewLanguages = (r: Roles, p: Project): string[] => (r.owner ? p.languages.map((l) => l.tag).filter((l) => l !== p.sourceLanguage) : r.reviewer);

export function languageName(tag: string): string {
  try { return new Intl.DisplayNames([i18n.locale], { type: 'language' }).of(tag) ?? tag; } catch { return tag; }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(i18n.locale === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
