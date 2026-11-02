<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { formatDate, languageName, loadProject, type LanguageChanges, type ProjectInfo, type Release, type ReleasePreview } from '../lib/projects.ts';
  import Notice from '../components/Notice.svelte';
  import ProjectNav from '../components/ProjectNav.svelte';
  import NotFound from './NotFound.svelte';

  let { slug }: { slug: string } = $props();
  let info = $state<ProjectInfo | null>(null);
  let releases = $state<Release[] | null>(null);
  let preview = $state<ReleasePreview | null>(null);
  let missing = $state(false);
  let error = $state('');
  let message = $state('');
  let busy = $state(false);
  let note = $state('');
  let restoring = $state<number | null>(null);
  let restoreNote = $state('');

  async function reload(owner: boolean) {
    const [list, pre] = await Promise.all([
      api<{ releases: Release[] }>('GET', `/projects/${slug}/releases`),
      owner ? api<ReleasePreview>('GET', `/projects/${slug}/releases/preview`).catch((e) => {
        // a project without keys cannot be previewed; the page still shows the empty history
        if (e instanceof ApiError && e.code === 'nothing_to_release') return null;
        throw e;
      }) : Promise.resolve(null),
    ]);
    releases = list.releases;
    preview = pre;
  }

  $effect(() => {
    (async () => {
      const p = await loadProject(slug);
      await reload(p.roles.owner);
      info = p;
    })().catch((e) => { if (e instanceof ApiError && e.status === 404) missing = true; else error = errorText(e); });
  });

  const live = $derived(releases?.find((r) => r.state === 'published')?.number ?? null);
  // releases replaced by a later rollback: published ones between the rollback target and the rollback
  const rolledBack = $derived.by(() => {
    const out = new Set<number>();
    for (const r of releases ?? []) {
      if (r.rolledBackTo === null) continue;
      for (const x of releases!) if (x.state === 'published' && x.number > r.rolledBackTo && x.number < r.number) out.add(x.number);
    }
    return out;
  });
  const kinds = (l: { added: string[]; changed: string[]; removed: string[] }): [string, string[]][] => [['added', l.added], ['changed', l.changed], ['removed', l.removed]];
  const totals = (c: LanguageChanges) => t('releases.changeCounts', { added: c.added, changed: c.changed, removed: c.removed });

  async function act(fn: () => Promise<{ release: number }>, done: (n: number) => string) {
    if (busy) return;
    busy = true; error = ''; message = '';
    try {
      const r = await fn();
      message = done(r.release);
      note = ''; restoring = null; restoreNote = '';
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
    try { await reload(true); } catch (e) { error = errorText(e); }
  }
  const create = (e: SubmitEvent) => {
    e.preventDefault();
    return act(() => api('POST', `/projects/${slug}/releases`, { note: note.trim() }), (n) => t('releases.created', { number: n }));
  };
  const restore = (e: SubmitEvent, to: number) => {
    e.preventDefault();
    return act(() => api('POST', `/projects/${slug}/releases/${to}/rollback`, { note: restoreNote.trim() }), (n) => t('releases.restored', { number: n, to }));
  };
</script>

{#if missing}
  <NotFound />
{:else}
  <main id="main">
    <ProjectNav {slug} {info} current="releases" />
    <h1>{t('releases.title')}</h1>
    {#if error}<Notice><p>{error}</p></Notice>{/if}
    {#if message}<Notice kind="ok"><p>{message}</p></Notice>{/if}
    {#if !info || !releases}
      {#if !error}<p class="muted" aria-busy="true">{t('app.loading')}</p>{/if}
    {:else}
      <p class="muted">{live ? t('releases.live', { number: live }) : t('project.noRelease')}</p>

      {#if info.roles.owner}
        <section class="card" aria-labelledby="next-title" data-testid="release-preview">
          {#if !preview}
            <h2 id="next-title">{t('releases.next')}</h2>
            <p>{t('releases.noKeys')}</p>
          {:else}
            <h2 id="next-title">{t('releases.nextNumber', { number: preview.nextRelease })}</h2>
            {#if !preview.hasChanges}
              <p>{t('releases.noChanges')}</p>
            {:else}
              <ul class="langs">
                {#each Object.entries(preview.summary.languages) as [lang, c] (lang)}
                  {@const lists = preview.changes[lang]}
                  <li>
                    <details>
                      <summary><strong>{languageName(lang)}</strong> <span class="tag">{lang}</span>: {totals(c)}</summary>
                      {#if lists}
                        {#each kinds(lists) as [kind, names] (kind)}
                          {#if names.length}
                            <p class="small label">{t(`releases.kind.${kind}`)}</p>
                            <ul class="names mono">{#each names as n (n)}<li>{n}</li>{/each}</ul>
                          {/if}
                        {/each}
                      {/if}
                    </details>
                  </li>
                {/each}
              </ul>
            {/if}
            <ul class="facts small">
              {#if preview.openSuggestions}<li>{t('releases.openSuggestions', { count: preview.openSuggestions })}</li>{/if}
              {#if preview.summary.outdatedExcluded}<li>{t('releases.outdatedExcluded', { count: preview.summary.outdatedExcluded })}</li>{/if}
              {#if preview.summary.soloApprovals}<li class="warn-text">{t('releases.solo', { count: preview.summary.soloApprovals })}</li>{/if}
            </ul>
            <form onsubmit={create}>
              <div>
                <label for="note">{t('releases.note')}</label>
                <textarea id="note" rows="2" maxlength="1000" bind:value={note}></textarea>
                <p class="hint">{t('releases.noteHint')}</p>
              </div>
              <div><button type="submit" disabled={busy || !preview.hasChanges}>{busy ? t('releases.building') : t('releases.create', { number: preview.nextRelease })}</button></div>
            </form>
          {/if}
        </section>
      {/if}

      <h2>{t('releases.history')}</h2>
      {#if !releases.length}
        <p>{t('releases.none')}</p>
      {:else}
        <ol class="history" data-testid="release-history">
          {#each releases as r (r.number)}
            <li class="card">
              <div class="head">
                <h3>{t('releases.number', { number: r.number })}</h3>
                {#if r.number === live}<span class="badge approved">{t('releases.isLive')}</span>{/if}
                {#if r.state === 'failed'}<span class="badge warn">{t('releases.failed')}</span>{/if}
                {#if r.state === 'building'}<span class="badge">{t('releases.buildingState')}</span>{/if}
                {#if rolledBack.has(r.number)}<span class="badge warn">{t('releases.rolledBack')}</span>{/if}
              </div>
              <p class="small muted">{formatDate(r.createdAt)}{#if r.createdBy}{' · '}{r.createdBy}{/if}</p>
              {#if r.rolledBackTo !== null}<p>{t('releases.rollbackOf', { number: r.rolledBackTo })}</p>{/if}
              {#if r.note}<p class="note">{r.note}</p>{/if}
              {#if r.summary?.languages}
                <ul class="small changes">
                  {#each Object.entries(r.summary.languages) as [lang, c] (lang)}<li><span class="tag">{lang}</span> {totals(c)}</li>{/each}
                </ul>
                {#if r.summary.soloApprovals}<p class="small warn-text">{t('releases.solo', { count: r.summary.soloApprovals })}</p>{/if}
              {/if}
              {#if r.failureReason}<p class="small mono">{r.failureReason}</p>{/if}

              {#if info.roles.owner && r.state === 'published' && live !== null && r.number < live}
                {#if restoring === r.number}
                  <form onsubmit={(e) => restore(e, r.number)}>
                    <p>{t('releases.restoreConfirm', { number: r.number })}</p>
                    <div>
                      <label for="restore-note-{r.number}">{t('releases.note')}</label>
                      <textarea id="restore-note-{r.number}" rows="2" maxlength="1000" bind:value={restoreNote}></textarea>
                    </div>
                    <div class="buttons">
                      <button type="submit" disabled={busy}>{t('releases.restoreNow', { number: r.number })}</button>
                      <button type="button" class="secondary" onclick={() => (restoring = null)}>{t('review.cancel')}</button>
                    </div>
                  </form>
                {:else}
                  <button type="button" class="secondary" onclick={() => { restoring = r.number; restoreNote = ''; }}>{t('releases.restore', { number: r.number })}</button>
                {/if}
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    {/if}
  </main>
{/if}

<style>
  section h2 { margin-top: 0; }
  .langs { list-style: none; margin: 0 0 .75rem; padding: 0; display: grid; gap: .375rem; }
  summary { cursor: pointer; }
  .label { font-weight: 600; margin: .5rem 0 .25rem; }
  .names { max-height: 12rem; overflow: auto; margin: 0; padding-left: 1.25rem; overflow-wrap: anywhere; }
  .facts { margin: 0 0 1rem; padding-left: 1.25rem; }
  .warn-text { color: var(--warn); }
  .history { list-style: none; margin: 0; padding: 0; display: grid; gap: .75rem; }
  .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .375rem .5rem; }
  h3 { margin: 0; font-size: 1.0625rem; }
  .note { white-space: pre-wrap; overflow-wrap: anywhere; }
  .changes { list-style: none; margin: 0 0 .75rem; padding: 0; }
  .buttons { display: flex; flex-wrap: wrap; gap: .5rem; }
  form { margin-top: .5rem; }
</style>
