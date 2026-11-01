<script lang="ts">
  import { LOCALES, i18n, t, type Locale } from '../lib/i18n.svelte.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { session, setLocale, setTheme, signOut, type Theme } from '../lib/session.svelte.ts';

  const names: Record<Locale, string> = { en: 'English', de: 'Deutsch' };

  async function out() {
    await signOut().catch(() => {});
    navigate('/login');
  }
</script>

<header>
  <a class="brand" href="/">Lexicast</a>
  <div class="tools">
    <select aria-label={t('nav.language')} value={i18n.locale} onchange={(e) => setLocale(e.currentTarget.value as Locale)}>
      {#each LOCALES as l (l)}<option value={l}>{names[l]}</option>{/each}
    </select>
    <select aria-label={t('nav.theme')} value={session.theme} onchange={(e) => setTheme(e.currentTarget.value as Theme)}>
      <option value="system">{t('theme.system')}</option>
      <option value="light">{t('theme.light')}</option>
      <option value="dark">{t('theme.dark')}</option>
    </select>
    {#if session.user}
      <span class="who" title={t('nav.signedInAs', { name: session.user.displayName })}>{session.user.displayName}</span>
      <button class="secondary" type="button" onclick={out}>{t('nav.signOut')}</button>
    {/if}
  </div>
</header>

<style>
  header {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem 1rem;
    padding: .5rem 1rem; border-bottom: 1px solid var(--line); background: var(--card);
  }
  .brand { font-weight: 700; font-size: 1.125rem; color: var(--fg); text-decoration: none; padding: .5rem 0; }
  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  select { width: auto; min-height: 2.5rem; padding: .25rem .5rem; }
  button { min-height: 2.5rem; padding: .25rem .75rem; }
  .who { color: var(--muted); max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 30rem) { .who { display: none; } }
</style>
