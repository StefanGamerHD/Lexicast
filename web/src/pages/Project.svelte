<script lang="ts">
  import { ApiError } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { canTranslate, formatDate, loadProject, reviewLanguages, type ProjectInfo } from '../lib/projects.ts';
  import Notice from '../components/Notice.svelte';
  import ProjectNav from '../components/ProjectNav.svelte';
  import ProgressRow from '../components/ProgressRow.svelte';
  import RoleList from '../components/RoleList.svelte';
  import NotFound from './NotFound.svelte';

  let { slug }: { slug: string } = $props();
  let info = $state<ProjectInfo | null>(null);
  let missing = $state(false);
  let error = $state('');

  $effect(() => {
    loadProject(slug).then((r) => (info = r), (e) => {
      if (e instanceof ApiError && e.status === 404) missing = true; else error = errorText(e);
    });
  });

  const roleNames = $derived(info ? [...(info.roles.owner ? ['owner'] : []), ...info.roles.reviewer.map((l) => `reviewer:${l}`), ...info.roles.translator.map((l) => `translator:${l}`)] : []);
  const reviewable = $derived(info ? reviewLanguages(info.roles, info.project) : []);
  const openTotal = $derived(info ? info.progress.languages.filter((l) => reviewable.includes(l.tag)).reduce((n, l) => n + l.inReview, 0) : 0);
</script>

{#if missing}
  <NotFound />
{:else}
  <main id="main">
    <ProjectNav {slug} {info} current="overview" />
    {#if error}
      <Notice><p>{error}</p></Notice>
    {:else if !info}
      <p class="muted" aria-busy="true">{t('app.loading')}</p>
    {:else}
      {@const p = info.project}
      <h1>{p.name}</h1>
      <RoleList roles={roleNames} />
      <p class="muted">
        {info.progress.liveRelease ? t('project.live', { number: info.progress.liveRelease.number, date: formatDate(info.progress.liveRelease.createdAt) }) : t('project.noRelease')}
        {#if p.soloMode}<br />{t('project.soloMode')}{/if}
      </p>

      {#if reviewable.length}
        <div class="card review">
          <p>{openTotal ? t('project.openReview', { count: openTotal }) : t('project.noOpenReview')}</p>
          <a class="button" href="/projects/{p.slug}/review">{t('project.toReview')}</a>
        </div>
      {/if}

      <h2>{t('project.languages')}</h2>
      {#if info.progress.languages.every((l) => l.total === 0)}
        <p>{t('project.noKeys')}{#if info.roles.owner} <a href="/projects/{p.slug}/import">{t('project.importNow')}</a>{/if}</p>
      {/if}
      <ul class="progress-list">
        {#each info.progress.languages as lang (lang.tag)}
          <ProgressRow {lang}>
            {#if canTranslate(info.roles, lang.tag, p) && lang.total > 0}
              <a class="button secondary" href="/projects/{p.slug}/translate/{lang.tag}">{t('project.translate')}</a>
            {/if}
          </ProgressRow>
        {/each}
      </ul>
      {#if p.progressPublic}
        <p class="small"><a href="/progress/{p.slug}" rel="external">{t('project.publicProgress')}</a></p>
      {/if}
    {/if}
  </main>
{/if}

<style>
  .review { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin: 1rem 0; }
  .review p { margin: 0; }
</style>
