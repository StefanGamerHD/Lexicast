<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { loadAllKeys, loadProject, type KeyItem, type ProjectInfo } from '../lib/projects.ts';
  import { textProblems } from '../lib/text.ts';
  import Field from '../components/Field.svelte';
  import Notice from '../components/Notice.svelte';
  import ProjectNav from '../components/ProjectNav.svelte';
  import NotFound from './NotFound.svelte';

  let { slug }: { slug: string } = $props();
  let info = $state<ProjectInfo | null>(null);
  let keys = $state<KeyItem[]>([]);
  let missing = $state(false);
  let error = $state('');
  let message = $state('');
  let search = $state('');
  let stateFilter = $state<'active' | 'deprecated' | 'all'>('active');

  let creating = $state(false);
  let name = $state('');
  let sourceText = $state('');
  let contextNote = $state('');
  let maxLength = $state('');
  let touched = $state(false);
  let busy = $state(false);
  let formError = $state('');

  async function reload() {
    keys = await loadAllKeys(slug, '');
  }

  $effect(() => {
    (async () => {
      const p = await loadProject(slug);
      if (p.roles.owner) await reload();
      info = p;
    })().catch((e) => { if (e instanceof ApiError && e.status === 404) missing = true; else error = errorText(e); });
  });

  const targets = $derived(info ? info.project.languages.map((l) => l.tag).filter((l) => l !== info!.project.sourceLanguage) : []);
  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return keys.filter((k) => (stateFilter === 'all' || k.state === stateFilter) && (!q || k.name.toLowerCase().includes(q) || k.sourceText.toLowerCase().includes(q)));
  });
  const done = (k: KeyItem) => targets.filter((l) => k.translations[l] && !k.translations[l].outdated).length;
  const outdated = (k: KeyItem) => targets.filter((l) => k.translations[l]?.outdated).length;

  const KEY_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}$/;
  const limit = $derived(maxLength.trim() ? Number(maxLength) : null);
  const nameError = $derived(touched && !KEY_NAME.test(name) ? t('keys.nameRule') : undefined);
  const limitError = $derived(touched && limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 5000) ? t('keys.limitRule') : undefined);
  const sourceProblems = $derived(touched ? textProblems(sourceText, sourceText, limit !== null && Number.isInteger(limit) ? limit : null) : []);

  async function create(e: SubmitEvent) {
    e.preventDefault();
    touched = true;
    if (nameError || limitError || sourceProblems.length) return;
    busy = true; formError = ''; message = '';
    try {
      await api('POST', `/projects/${slug}/keys`, { name, sourceText, contextNote, ...(limit !== null ? { maxLength: limit } : {}) });
      message = t('keys.created', { name });
      name = ''; sourceText = ''; contextNote = ''; maxLength = ''; touched = false; creating = false;
      await reload();
    } catch (err) {
      formError = err instanceof ApiError && err.code === 'exists' ? t('keys.exists') : errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if missing}
  <NotFound />
{:else}
  <main id="main" class="wide">
    <ProjectNav {slug} {info} current="keys" />
    <h1>{t('keys.title')}</h1>
    {#if error}
      <Notice><p>{error}</p></Notice>
    {:else if !info}
      <p class="muted" aria-busy="true">{t('app.loading')}</p>
    {:else if !info.roles.owner}
      <Notice><p>{t('keys.ownersOnly')}</p></Notice>
    {:else}
      {#if message}<Notice kind="ok"><p>{message}</p></Notice>{/if}
      <div class="toolbar">
        <div>
          <label for="search">{t('translate.search')}</label>
          <input id="search" type="search" bind:value={search} autocomplete="off" />
        </div>
        <div>
          <label for="state">{t('translate.filter')}</label>
          <select id="state" bind:value={stateFilter}>
            <option value="active">{t('keys.active')}</option>
            <option value="deprecated">{t('keys.deprecated')}</option>
            <option value="all">{t('keys.all')}</option>
          </select>
        </div>
        <div class="actions">
          <button type="button" class="secondary" onclick={() => (creating = !creating)} aria-expanded={creating}>{t('keys.new')}</button>
          <a class="button secondary" href="/projects/{slug}/import">{t('keys.import')}</a>
        </div>
      </div>

      {#if creating}
        <div class="card create">
          <h2>{t('keys.new')}</h2>
          {#if formError}<Notice><p>{formError}</p></Notice>{/if}
          <form onsubmit={create}>
            <Field label={t('keys.name')} type="text" class="mono" autocomplete="off" spellcheck={false} required maxlength={200} bind:value={name} hint={t('keys.nameHint')} error={nameError} />
            <div>
              <label for="new-source">{t('keys.sourceText', { lang: info.project.sourceLanguage })}</label>
              <textarea id="new-source" rows="3" required bind:value={sourceText} aria-invalid={sourceProblems.length ? 'true' : undefined}></textarea>
              {#each sourceProblems as p (p)}<p class="field-error">{t(`problem.${p}`)}</p>{/each}
            </div>
            <div>
              <label for="new-note">{t('keys.note')}</label>
              <textarea id="new-note" rows="2" maxlength="1000" bind:value={contextNote}></textarea>
              <p class="hint">{t('keys.noteHint')}</p>
            </div>
            <Field label={t('keys.maxLength')} type="text" inputmode="numeric" autocomplete="off" bind:value={maxLength} hint={t('keys.maxLengthHint')} error={limitError} />
            <div class="buttons">
              <button type="submit" disabled={busy}>{t('keys.create')}</button>
              <button type="button" class="secondary" onclick={() => (creating = false)}>{t('review.cancel')}</button>
            </div>
          </form>
        </div>
      {/if}

      <p class="small muted" aria-live="polite">{t('translate.shown', { count: shown.length, total: keys.length })}</p>
      {#if !keys.length}
        <div class="card"><p>{t('keys.empty')}</p></div>
      {:else}
        <ul class="keylist" data-testid="keys-table">
          {#each shown as k (k.name)}
            <li>
              <a href="/projects/{slug}/keys/{encodeURIComponent(k.name)}">
                <span class="mono name">{k.name}</span>
                <span class="preview">{k.sourceText}</span>
                <span class="badges">
                  {#if k.state === 'deprecated'}<span class="badge warn">{t('keys.deprecatedOne')}</span>{/if}
                  <span class="badge">{t('keys.translated', { done: done(k), total: targets.length })}</span>
                  {#if outdated(k)}<span class="badge outdated">{t('progress.outdated', { count: outdated(k) })}</span>{/if}
                </span>
              </a>
            </li>
          {:else}
            <li class="muted">{t('translate.noneShown')}</li>
          {/each}
        </ul>
      {/if}
    {/if}
  </main>
{/if}

<style>
  .toolbar { display: grid; gap: .75rem; margin-bottom: 1rem; }
  .actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: end; }
  @media (min-width: 48rem) { .toolbar { grid-template-columns: 1fr 12rem auto; align-items: end; } }
  .create { margin-bottom: 1rem; }
  .create h2 { margin-top: 0; }
  .buttons { display: flex; flex-wrap: wrap; gap: .5rem; }
  .keylist { list-style: none; margin: 0; padding: 0; display: grid; gap: .375rem; }
  .keylist a { display: grid; gap: .125rem; padding: .5rem .75rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); color: var(--fg); text-decoration: none; }
  .keylist a:hover { border-color: var(--fill); }
  .name { font-size: .8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
