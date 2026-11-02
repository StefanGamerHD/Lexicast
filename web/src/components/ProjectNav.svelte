<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';
  import { reviewLanguages, type ProjectInfo } from '../lib/projects.ts';

  // Breadcrumb plus the project's sections; each person sees only the sections their roles allow.
  type Section = 'overview' | 'review' | 'keys' | 'releases' | 'members' | 'settings' | 'other';
  let { slug, info, current }: { slug: string; info: ProjectInfo | null; current: Section } = $props();

  const tabs = $derived(info ? [
    { id: 'overview', href: `/projects/${slug}`, label: t('tab.overview') },
    ...(reviewLanguages(info.roles, info.project).length ? [{ id: 'review', href: `/projects/${slug}/review`, label: t('tab.review') }] : []),
    ...(info.roles.owner ? [{ id: 'keys', href: `/projects/${slug}/keys`, label: t('tab.keys') }] : []),
    { id: 'releases', href: `/projects/${slug}/releases`, label: t('tab.releases') },
    ...(info.roles.owner ? [{ id: 'members', href: `/projects/${slug}/members`, label: t('tab.members') }, { id: 'settings', href: `/projects/${slug}/settings`, label: t('tab.settings') }] : []),
  ] : []);
</script>

<p class="eyebrow"><a href="/">{t('nav.projects')}</a>{#if info}<span aria-hidden="true">{' / '}</span><a href="/projects/{slug}">{info.project.name}</a>{/if}</p>
{#if tabs.length}
  <nav class="tabs" aria-label={t('tab.label')}>
    {#each tabs as tab (tab.id)}
      <a href={tab.href} aria-current={tab.id === current ? 'page' : undefined}>{tab.label}</a>
    {/each}
  </nav>
{/if}

<style>
  .tabs { display: flex; flex-wrap: wrap; gap: .25rem; margin: .5rem 0 1rem; border-bottom: 1px solid var(--line); }
  .tabs a { padding: .5rem .75rem; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; font-weight: 600; }
  .tabs a:hover { color: var(--fg); }
  .tabs a[aria-current="page"] { color: var(--fg); border-bottom-color: var(--fill); }
</style>
