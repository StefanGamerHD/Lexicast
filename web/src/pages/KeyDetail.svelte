<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { languageName, loadProject, type KeyItem, type ProjectInfo } from '../lib/projects.ts';
  import { textProblems } from '../lib/text.ts';
  import Field from '../components/Field.svelte';
  import Notice from '../components/Notice.svelte';
  import ProjectNav from '../components/ProjectNav.svelte';
  import NotFound from './NotFound.svelte';

  let { slug, name }: { slug: string; name: string } = $props();
  let info = $state<ProjectInfo | null>(null);
  let item = $state<KeyItem | null>(null);
  let missing = $state(false);
  let error = $state('');
  let message = $state('');
  let busy = $state(false);

  let sourceText = $state('');
  let contextNote = $state('');
  let maxLength = $state('');
  let keyState = $state('active');

  // The list endpoint searches by substring; pick the exact key from its answer.
  async function loadKey(): Promise<KeyItem | null> {
    const r = await api<{ keys: KeyItem[] }>('GET', `/projects/${slug}/keys?search=${encodeURIComponent(name)}&limit=500`);
    return r.keys.find((k) => k.name === name) ?? null;
  }
  function fill(k: KeyItem) {
    item = k;
    sourceText = k.sourceText; contextNote = k.contextNote; maxLength = k.maxLength === null ? '' : String(k.maxLength); keyState = k.state;
  }

  $effect(() => {
    (async () => {
      const p = await loadProject(slug);
      if (p.roles.owner) {
        const k = await loadKey();
        if (!k) { missing = true; return; }
        fill(k);
      }
      info = p;
    })().catch((e) => { if (e instanceof ApiError && e.status === 404) missing = true; else error = errorText(e); });
  });

  const targets = $derived(info ? info.project.languages.map((l) => l.tag).filter((l) => l !== info!.project.sourceLanguage) : []);
  const limit = $derived(maxLength.trim() ? Number(maxLength) : null);
  const limitError = $derived(limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 5000) ? t('keys.limitRule') : undefined);
  const problems = $derived(textProblems(sourceText, sourceText, limit !== null && Number.isInteger(limit) ? limit : null));
  const sourceChanged = $derived(item !== null && sourceText !== item.sourceText);
  const willOutdate = $derived(item ? Object.values(item.translations).filter((x) => !x.outdated).length : 0);
  const dirty = $derived(item !== null && (sourceChanged || contextNote !== item.contextNote || keyState !== item.state || (limit ?? null) !== item.maxLength));

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!item || limitError || problems.length || !dirty) return;
    busy = true; error = ''; message = '';
    try {
      const r = await api<{ outdatedMarked: boolean }>('PATCH', `/projects/${slug}/keys/${encodeURIComponent(name)}`, { sourceText, contextNote, maxLength: limit, state: keyState });
      message = r.outdatedMarked ? t('key.savedOutdated') : t('key.saved');
      const k = await loadKey();
      if (k) fill(k);
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if missing}
  <NotFound />
{:else}
  <main id="main">
    <ProjectNav {slug} {info} current="keys" />
    <h1 class="mono keyname">{name}</h1>
    {#if error}<Notice><p>{error}</p></Notice>{/if}
    {#if message}<Notice kind="ok"><p>{message}</p></Notice>{/if}
    {#if !info}
      {#if !error}<p class="muted" aria-busy="true">{t('app.loading')}</p>{/if}
    {:else if !info.roles.owner}
      <Notice><p>{t('keys.ownersOnly')}</p></Notice>
    {:else if item}
      <p><a href="/projects/{slug}/keys">{t('key.back')}</a></p>
      <div class="card">
        <form onsubmit={save}>
          <div>
            <label for="source">{t('keys.sourceText', { lang: info.project.sourceLanguage })}</label>
            <textarea id="source" rows="3" bind:value={sourceText} aria-invalid={problems.length ? 'true' : undefined}></textarea>
            {#each problems as p (p)}<p class="field-error">{t(`problem.${p}`)}</p>{/each}
            {#if sourceChanged && willOutdate > 0}<p class="warn-text" role="status">{t('key.outdateWarning', { count: willOutdate })}</p>{/if}
          </div>
          <div>
            <label for="note">{t('keys.note')}</label>
            <textarea id="note" rows="2" maxlength="1000" bind:value={contextNote}></textarea>
          </div>
          <Field label={t('keys.maxLength')} type="text" inputmode="numeric" autocomplete="off" bind:value={maxLength} hint={t('keys.maxLengthHint')} error={limitError} />
          <div>
            <label for="key-state">{t('key.state')}</label>
            <select id="key-state" bind:value={keyState}>
              <option value="active">{t('key.stateActive')}</option>
              <option value="deprecated">{t('key.stateDeprecated')}</option>
            </select>
            <p class="hint">{t('key.stateHint')}</p>
          </div>
          <div><button type="submit" disabled={busy || !dirty || problems.length > 0 || !!limitError}>{t('key.save')}</button></div>
        </form>
      </div>

      <h2>{t('key.translations')}</h2>
      <ul class="cards" data-testid="key-translations">
        {#each targets as lang (lang)}
          {@const tr = item.translations[lang]}
          <li class="card tr">
            <div class="head">
              <strong>{languageName(lang)}</strong> <span class="tag">{lang}</span>
              <span class="badge {tr ? (tr.outdated ? 'outdated' : 'approved') : 'untranslated'}">{t(`state.${tr ? (tr.outdated ? 'outdated' : 'approved') : 'untranslated'}`)}</span>
              {#if (item.openSuggestions[lang] ?? 0) > 0}<span class="badge">{t('progress.inReview', { count: item.openSuggestions[lang]! })}</span>{/if}
            </div>
            {#if tr}<p class="text" lang={lang}>{tr.text}</p>{/if}
            <a href="/projects/{slug}/translate/{lang}?key={encodeURIComponent(name)}">{t('project.translate')}</a>
          </li>
        {/each}
      </ul>
      <p class="small muted">{t('key.historyLater')}</p>
    {/if}
  </main>
{/if}

<style>
  .keyname { font-size: 1.375rem; }
  .warn-text { color: var(--warn); margin: .5rem 0 0; font-size: .9375rem; }
  .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .375rem .5rem; margin-bottom: .5rem; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius); padding: .5rem .625rem; }
</style>
