// Who is signed in, whether the instance is set up, and the user's language and theme.
import { api, ApiError, type Instance, type User } from './api.ts';
import { i18n, type Locale } from './i18n.svelte.ts';
import { load, save } from './storage.ts';

export type Theme = 'system' | 'light' | 'dark';

export const session = $state({
  status: 'loading' as 'loading' | 'ready' | 'failed',
  instance: null as Instance | null,
  user: null as User | null,
  mailEnabled: false,
  theme: (['light', 'dark'].includes(load('theme') ?? '') ? load('theme') : 'system') as Theme,
});

export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function applyLocale(locale: Locale): void {
  i18n.locale = locale;
  document.documentElement.lang = locale;
}

function adopt(user: User | null, mailEnabled = session.mailEnabled): void {
  session.user = user;
  session.mailEnabled = mailEnabled;
  if (!user) return;
  // the account's saved choices win over this browser's
  if (user.uiLocale === 'en' || user.uiLocale === 'de') { applyLocale(user.uiLocale); save('locale', user.uiLocale); }
  if (user.theme === 'system' || user.theme === 'light' || user.theme === 'dark') { session.theme = user.theme; applyTheme(user.theme); save('theme', user.theme); }
}

export async function loadSession(): Promise<void> {
  try {
    session.instance = await api<Instance>('GET', '/instance');
    if (session.instance.setupDone) {
      try {
        const me = await api<{ user: User; mailEnabled: boolean }>('GET', '/me');
        adopt(me.user, me.mailEnabled);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e;
        adopt(null);
      }
    }
    session.status = 'ready';
  } catch {
    session.status = 'failed';
  }
}

// After sign-in, setup or accepting an invitation: the response carries the user.
// A new account has no choices yet, so it takes over the language and theme picked in this browser.
export async function signedIn(user: User, newAccount = false): Promise<void> {
  if (newAccount) {
    session.user = user;
    try { user = (await api<{ user: User }>('PATCH', '/me', { uiLocale: i18n.locale, theme: session.theme })).user; } catch { /* keep server defaults */ }
  }
  adopt(user);
  if (session.instance) session.instance.setupDone = true;
  // mailEnabled is only reported to signed-in users
  try { session.mailEnabled = (await api<{ mailEnabled: boolean }>('GET', '/me')).mailEnabled; } catch { /* keep default */ }
}

export async function signOut(): Promise<void> {
  try { await api('POST', '/auth/logout'); } finally { session.user = null; }
}

async function savePreference(field: 'uiLocale' | 'theme', value: string): Promise<void> {
  if (!session.user) return;
  try { session.user = (await api<{ user: User }>('PATCH', '/me', { [field]: value })).user; } catch { /* the local choice still applies */ }
}

export function setLocale(locale: Locale): void {
  applyLocale(locale);
  save('locale', locale);
  void savePreference('uiLocale', locale);
}

export function setTheme(theme: Theme): void {
  session.theme = theme;
  applyTheme(theme);
  save('theme', theme);
  void savePreference('theme', theme);
}
