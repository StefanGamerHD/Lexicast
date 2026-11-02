<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { parseJson } from '../lib/json.ts';
  import { loadProject, type ImportResult, type ProjectInfo } from '../lib/projects.ts';
  import Notice from '../components/Notice.svelte';
  import ProjectNav from '../components/ProjectNav.svelte';
  import NotFound from './NotFound.svelte';

  let { slug }: { slug: string } = $props();
  let info = $state<ProjectInfo | null>(null);
  let missing = $state(false);
  let error = $state('');
  let detail = $state('');
  let text = $state('');
  let fileName = $state('');
  let deprecateMissing = $state(false);
  let preview = $state<ImportResult | null>(null);
  let applied = $state<ImportResult | null>(null);
  let busy = $state(false);

  $effect(() => {
    loadProject(slug).then((r) => (info = r), (e) => { if (e instanceof ApiError && e.status === 404) missing = true; else error = errorText(e); });
  });

  // a preview belongs to exactly this text and option; any change asks for a new preview
  function changed() { preview = null; applied = null; error = ''; detail = ''; }

  async function pick(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { error = t('import.tooBig'); return; }
    fileName = file.name;
    text = await file.text();
    changed();
  }

  async function send(apply: boolean) {
    error = ''; detail = '';
    const parsed = parseJson(text);
    if (!parsed.ok) {
      error = t('import.badJsonAt', { line: parsed.line, column: parsed.column });
      detail = parsed.detail;
      return;
    }
    busy = true;
    try {
      const r = await api<ImportResult>('POST', `/projects/${slug}/keys/import`, { texts: parsed.value, apply, deprecateMissing });
      if (apply) { applied = r; preview = null; } else preview = r;
    } catch (err) {
      error = errorText(err);
      // the server names the keys and rules that failed; show them as they are
      if (err instanceof ApiError && (err.code === 'invalid_import' || err.code === 'invalid_text')) detail = err.message;
    } finally {
      busy = false;
    }
  }

  const lists = $derived(preview ? [
    { id: 'added', names: preview.added },
    { id: 'changed', names: preview.changed },
    { id: 'reactivated', names: preview.reactivated },
    { id: 'removed', names: preview.removed },
  ] : []);
</script>

{#if missing}
  <NotFound />
{:else}
  <main id="main">
    <ProjectNav {slug} {info} current="keys" />
    <h1>{t('import.title')}</h1>
    {#if !info}
      {#if error}<Notice><p>{error}</p></Notice>{:else}<p class="muted" aria-busy="true">{t('app.loading')}</p>{/if}
    {:else if !info.roles.owner}
      <Notice><p>{t('keys.ownersOnly')}</p></Notice>
    {:else}
      <p class="muted">{t('import.intro', { lang: info.project.sourceLanguage })}</p>
      {#if applied}
        <Notice kind="ok">
          <p>{t('import.applied', { added: applied.added.length, changed: applied.changed.length, reactivated: applied.reactivated.length })}{#if applied.removedAreDeprecated}{' '}{t('import.appliedDeprecated', { count: applied.removed.length })}{/if}</p>
          <p><a href="/projects/{slug}/keys">{t('import.toKeys')}</a></p>
        </Notice>
      {/if}
      {#if error}
        <Notice><p>{error}</p>{#if detail}<p class="small mono detail">{detail}</p>{/if}</Notice>
      {/if}

      <div class="card">
        <form onsubmit={(e) => { e.preventDefault(); void send(false); }}>
          <div>
            <label for="file">{t('import.file')}</label>
            <input id="file" type="file" accept=".json,application/json" onchange={pick} />
            {#if fileName}<p class="hint">{t('import.loaded', { name: fileName })}</p>{/if}
          </div>
          <div>
            <label for="json">{t('import.paste')}</label>
            <textarea id="json" class="mono" rows="10" spellcheck="false" bind:value={text} oninput={changed}></textarea>
            <p class="hint">{t('import.format')}</p>
          </div>
          <label class="check"><input type="checkbox" bind:checked={deprecateMissing} onchange={changed} /> {t('import.deprecateMissing')}</label>
          <div><button type="submit" disabled={busy || !text.trim()}>{t('import.preview')}</button></div>
        </form>
      </div>

      {#if preview}
        <section class="card result" aria-labelledby="preview-title" data-testid="import-preview">
          <h2 id="preview-title">{t('import.previewTitle')}</h2>
          <ul class="counts">
            <li>{t('import.added', { count: preview.added.length })}</li>
            <li>{t('import.changed', { count: preview.changed.length })}</li>
            <li>{t('import.reactivated', { count: preview.reactivated.length })}</li>
            <li>{t('import.unchanged', { count: preview.unchanged })}</li>
            <li>{deprecateMissing ? t('import.removedDeprecate', { count: preview.removed.length }) : t('import.removedKeep', { count: preview.removed.length })}</li>
          </ul>
          {#if preview.changed.length}<p class="warn-text">{t('import.changedHint')}</p>{/if}
          {#each lists as l (l.id)}
            {#if l.names.length}
              <details>
                <summary>{t(`import.list.${l.id}`)} ({l.names.length})</summary>
                <ul class="names mono">{#each l.names.slice(0, 500) as n (n)}<li>{n}</li>{/each}</ul>
                {#if l.names.length > 500}<p class="small muted">{t('import.more', { count: l.names.length - 500 })}</p>{/if}
              </details>
            {/if}
          {/each}
          <div class="buttons">
            <button type="button" disabled={busy} onclick={() => send(true)}>{t('import.apply')}</button>
          </div>
        </section>
      {/if}
    {/if}
  </main>
{/if}

<style>
  .detail { overflow-wrap: anywhere; white-space: pre-wrap; }
  input[type="file"] { display: block; max-width: 100%; }
  .result { margin-top: 1rem; }
  .result h2 { margin-top: 0; }
  .counts { margin: 0 0 1rem; padding-left: 1.25rem; }
  .warn-text { color: var(--warn); }
  details { margin: .5rem 0; }
  summary { cursor: pointer; font-weight: 600; }
  .names { max-height: 16rem; overflow: auto; margin: .5rem 0; padding-left: 1.25rem; overflow-wrap: anywhere; }
  .buttons { margin-top: 1rem; }
</style>
