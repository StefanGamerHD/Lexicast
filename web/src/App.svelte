<script lang="ts">
  import type { Component } from 'svelte';
  import Header from './components/Header.svelte';
  import { t } from './lib/i18n.svelte.ts';
  import { navigate, route, safeNext } from './lib/router.svelte.ts';
  import { session } from './lib/session.svelte.ts';
  import Forgot from './pages/Forgot.svelte';
  import Home from './pages/Home.svelte';
  import Import from './pages/Import.svelte';
  import KeyDetail from './pages/KeyDetail.svelte';
  import Keys from './pages/Keys.svelte';
  import Invite from './pages/Invite.svelte';
  import Login from './pages/Login.svelte';
  import NotFound from './pages/NotFound.svelte';
  import Project from './pages/Project.svelte';
  import Releases from './pages/Releases.svelte';
  import Reset from './pages/Reset.svelte';
  import Review from './pages/Review.svelte';
  import Setup from './pages/Setup.svelte';
  import Translate from './pages/Translate.svelte';

  // access: 'user' needs a session, 'guest' is for signed-out people, 'any' is both. Keep in sync with APP_ROUTES in src/web/handler.ts.
  type Access = 'user' | 'guest' | 'any';
  interface Route { pattern: RegExp; page: Component<any>; access: Access; props?: (m: RegExpExecArray) => Record<string, string> }
  const routes: Route[] = [
    { pattern: /^\/$/, page: Home, access: 'user' },
    { pattern: /^\/projects$/, page: Home, access: 'user' },
    { pattern: /^\/projects\/([a-z0-9][a-z0-9-]*)$/, page: Project, access: 'user', props: (m) => ({ slug: m[1]! }) },
    { pattern: /^\/projects\/([a-z0-9][a-z0-9-]*)\/translate\/([A-Za-z0-9-]+)$/, page: Translate, access: 'user', props: (m) => ({ slug: m[1]!, lang: m[2]! }) },
    { pattern: /^\/projects\/([a-z0-9][a-z0-9-]*)\/review$/, page: Review, access: 'user', props: (m) => ({ slug: m[1]! }) },
    { pattern: /^\/projects\/([a-z0-9][a-z0-9-]*)\/keys$/, page: Keys, access: 'user', props: (m) => ({ slug: m[1]! }) },
    { pattern: /^\/projects\/([a-z0-9][a-z0-9-]*)\/keys\/([A-Za-z0-9_][A-Za-z0-9_.-]*)$/, page: KeyDetail, access: 'user', props: (m) => ({ slug: m[1]!, name: m[2]! }) },
    { pattern: /^\/projects\/([a-z0-9][a-z0-9-]*)\/import$/, page: Import, access: 'user', props: (m) => ({ slug: m[1]! }) },
    { pattern: /^\/projects\/([a-z0-9][a-z0-9-]*)\/releases$/, page: Releases, access: 'user', props: (m) => ({ slug: m[1]! }) },
    { pattern: /^\/login$/, page: Login, access: 'guest' },
    { pattern: /^\/forgot$/, page: Forgot, access: 'guest' },
    { pattern: /^\/setup$/, page: Setup, access: 'any' },
    { pattern: /^\/invite\/([A-Za-z0-9_-]+)$/, page: Invite, access: 'guest', props: (m) => ({ token: m[1]! }) },
    { pattern: /^\/reset\/([A-Za-z0-9_-]+)$/, page: Reset, access: 'any', props: (m) => ({ token: m[1]! }) },
  ];

  const match = $derived.by(() => {
    for (const r of routes) {
      const m = r.pattern.exec(route.path);
      if (m) return { route: r, props: r.props?.(m) ?? {} };
    }
    return null;
  });

  // Redirects: not set up -> /setup; signed out -> /login?next=...; signed in on a guest page -> the ?next= target or the start page.
  const redirect = $derived.by((): string | null => {
    if (session.status !== 'ready') return null;
    // unknown paths count as signed-in pages: signed-out people sign in first, then see "not found"
    const access = match?.route.access ?? 'user';
    const setupDone = session.instance?.setupDone ?? false;
    if (!setupDone) return route.path === '/setup' ? null : '/setup';
    if (route.path === '/setup' && !session.user) return '/login';
    if (access === 'user' && !session.user) return route.path === '/' ? '/login' : `/login?next=${encodeURIComponent(route.path)}`;
    if (access === 'guest' && session.user) return safeNext(route.query.get('next'));
    return null;
  });

  $effect(() => {
    if (redirect) navigate(redirect, true);
  });
</script>

<a class="skip" href="#main">{t('app.skip')}</a>
<Header />
{#if session.status === 'loading' || redirect}
  <div class="center" aria-busy="true">{t('app.loading')}</div>
{:else if session.status === 'failed'}
  <main class="narrow" id="main">
    <div class="notice error" role="alert"><p>{t('app.loadFailed')}</p></div>
    <button type="button" onclick={() => location.reload()}>{t('app.reload')}</button>
  </main>
{:else if match}
  {#key route.path}
    <match.route.page {...match.props} />
  {/key}
{:else}
  <NotFound />
{/if}
