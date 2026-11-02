<script lang="ts">
  import { api } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import type { ProjectSummary } from '../lib/projects.ts';
  import { session } from '../lib/session.svelte.ts';
  import Notice from '../components/Notice.svelte';
  import RoleList from '../components/RoleList.svelte';

  let projects = $state<ProjectSummary[] | null>(null);
  let error = $state('');

  $effect(() => {
    api<{ projects: ProjectSummary[] }>('GET', '/projects').then((r) => (projects = r.projects), (e) => (error = errorText(e)));
  });
</script>

<main id="main">
  <p class="eyebrow">Lexicast</p>
  <h1>{t('home.title', { name: session.user?.displayName ?? '' })}</h1>

  <h2>{t('home.projects')}</h2>
  {#if error}
    <Notice><p>{error}</p></Notice>
  {:else if !projects}
    <p class="muted" aria-busy="true">{t('app.loading')}</p>
  {:else if !projects.length}
    <div class="card">
      <p>{t('home.noProjects')}</p>
      <p class="small muted">{session.user?.isInstanceAdmin ? t('home.noProjectsAdmin') : t('home.noProjectsMember')}</p>
    </div>
  {:else}
    <ul class="cards" data-testid="project-list">
      {#each projects as p (p.slug)}
        <li class="card">
          <a class="title" href="/projects/{p.slug}">{p.name}</a>
          <span class="tag">{p.slug}</span>
          <RoleList roles={p.roles} />
        </li>
      {/each}
    </ul>
  {/if}

  {#if session.user?.isInstanceAdmin}
    <div class="card admin">
      <p>{t('home.admin')}</p>
      {#if session.instance?.fingerprint}
        <p class="small muted">{t('home.fingerprint')}</p>
        <code data-testid="fingerprint">{session.instance.fingerprint}</code>
      {/if}
    </div>
  {/if}
</main>

<style>
  .title { font-weight: 600; font-size: 1.0625rem; margin-right: .5rem; }
  .admin { margin-top: 2rem; }
  .admin code { overflow-wrap: anywhere; }
</style>
