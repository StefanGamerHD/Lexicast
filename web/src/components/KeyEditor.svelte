<script lang="ts">
  import { api } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { languageName, type KeyItem, type Mine, type Warning } from '../lib/projects.ts';
  import { load, remove, save } from '../lib/storage.ts';
  import { placeholderNames, textProblems } from '../lib/text.ts';
  import Notice from './Notice.svelte';

  interface Props {
    slug: string; lang: string; sourceLanguage: string; item: KeyItem; mine: Mine | null;
    onsubmitted: (m: Mine) => void; onwithdrawn: () => void; onmove: (step: 1 | -1) => void;
  }
  let { slug, lang, sourceLanguage, item, mine, onsubmitted, onwithdrawn, onmove }: Props = $props();

  // The parent re-creates this editor per key ({#key}), so the start values are read once.
  const draftKey = () => `draft.${slug}.${lang}.${item.name}`;
  const baseline = () => (mine?.state === 'open' ? mine.text : item.translations[lang]?.text ?? '');
  let value = $state(load(draftKey()) ?? baseline());
  let hasDraft = $state(load(draftKey()) !== null);
  let busy = $state(false);
  let error = $state('');
  let done = $state<Warning[] | null>(null);
  let area: HTMLTextAreaElement | undefined = $state();

  const current = $derived(item.translations[lang]);
  const chips = $derived([...new Set(placeholderNames(item.sourceText))]);
  const problems = $derived(textProblems(value, item.sourceText, item.maxLength));
  const limit = $derived(item.maxLength ?? 5000);
  const others = $derived((item.openSuggestions[lang] ?? 0) - (mine?.state === 'open' ? 1 : 0));

  function changed() {
    done = null;
    if (value === baseline()) { remove(draftKey()); hasDraft = false; } else { save(draftKey(), value); hasDraft = true; }
  }

  function insert(name: string) {
    const el = area;
    const chip = `{${name}}`;
    if (!el) { value += chip; changed(); return; }
    const start = el.selectionStart, end = el.selectionEnd;
    value = value.slice(0, start) + chip + value.slice(end);
    changed();
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + chip.length, start + chip.length); });
  }

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy || problems.length) return;
    busy = true;
    error = '';
    try {
      const r = await api<{ id: number; warnings: Warning[] }>('POST', `/projects/${slug}/suggestions`, { key: item.name, language: lang, text: value });
      remove(draftKey());
      hasDraft = false;
      done = r.warnings;
      onsubmitted({ id: r.id, text: value, state: 'open', rejectReason: null });
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  async function withdraw() {
    if (!mine) return;
    busy = true;
    error = '';
    try {
      await api('POST', `/projects/${slug}/suggestions/${mine.id}/withdraw`, {});
      onwithdrawn();
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  function keys(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
    else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); onmove(e.key === 'ArrowDown' ? 1 : -1); }
  }
</script>

<section class="editor" aria-labelledby="key-title">
  <h2 id="key-title" class="mono">{item.name}</h2>

  <p class="label">{t('translate.source', { lang: languageName(sourceLanguage) })}</p>
  <p class="text" lang={sourceLanguage} data-testid="source-text">{item.sourceText}</p>
  {#if item.contextNote}<p class="small muted"><strong>{t('translate.note')}</strong> {item.contextNote}</p>{/if}

  {#if current}
    <p class="label">{t('translate.current')} {#if current.outdated}<span class="badge warn">{t('state.outdated')}</span>{/if}</p>
    <p class="text" lang={lang}>{current.text}</p>
    {#if current.outdated}<p class="small muted">{t('translate.outdatedHint')}</p>{/if}
  {/if}

  {#if mine?.state === 'open'}
    <div class="card mine">
      <p><span class="badge">{t('state.inReview')}</span> {t('translate.mineOpen')}</p>
      <p class="text" lang={lang}>{mine.text}</p>
      <button class="secondary" type="button" onclick={withdraw} disabled={busy}>{t('translate.withdraw')}</button>
    </div>
  {:else if mine?.state === 'rejected'}
    <Notice><p>{t('translate.rejected', { reason: mine.rejectReason ?? '' })}</p></Notice>
  {/if}
  {#if others > 0}<p class="small muted">{t('translate.others', { count: others })}</p>{/if}

  {#if error}<Notice><p>{error}</p></Notice>{/if}
  {#if done}
    <Notice kind="ok">
      <p>{t('translate.submitted')}</p>
      {#each done as w (w)}<p class="small">{t(`warning.${w}`)}</p>{/each}
    </Notice>
  {/if}

  <form onsubmit={submit}>
    <div>
      <label for="translation">{t('translate.yourText', { lang: languageName(lang) })}</label>
      {#if chips.length}
        <div class="chips" role="group" aria-label={t('translate.placeholders')}>
          {#each chips as c (c)}<button type="button" class="chip mono" onclick={() => insert(c)} title={t('translate.insert', { name: c })}>{`{${c}}`}</button>{/each}
        </div>
      {/if}
      <textarea id="translation" lang={lang} rows="4" bind:this={area} bind:value oninput={changed} onkeydown={keys}
        aria-invalid={value && problems.length ? 'true' : undefined} aria-describedby="translation-count translation-problems"></textarea>
      <p class="hint counter" id="translation-count" class:over={value.length > limit}>
        {t('translate.count', { count: value.length, max: limit })}{#if hasDraft} · {t('translate.draftSaved')}{/if}
      </p>
      <div id="translation-problems" aria-live="polite">
        {#if value}{#each problems as p (p)}<p class="field-error">{t(`problem.${p}`)}</p>{/each}{/if}
      </div>
    </div>
    <div class="buttons">
      <button type="submit" disabled={busy || problems.length > 0}>{t('translate.submit')}</button>
      <button class="secondary" type="button" onclick={() => onmove(-1)}>{t('translate.previous')}</button>
      <button class="secondary" type="button" onclick={() => onmove(1)}>{t('translate.next')}</button>
    </div>
    <p class="hint">{t('translate.keysHint')}</p>
  </form>
</section>

<style>
  h2 { margin-top: 0; overflow-wrap: anywhere; }
  .label { font-weight: 600; margin: 1rem 0 .25rem; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius); padding: .5rem .625rem; }
  .mine { margin: 1rem 0; }
  .chips { display: flex; flex-wrap: wrap; gap: .375rem; margin: .25rem 0 .5rem; }
  .chip { min-height: 2.25rem; padding: .125rem .5rem; background: var(--bg); color: var(--fg); border-color: var(--line); font-weight: 400; }
  .counter.over { color: var(--danger); }
  .buttons { display: flex; flex-wrap: wrap; gap: .5rem; }
  form { margin-top: 1rem; }
</style>
