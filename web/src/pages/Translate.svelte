<script lang="ts">
  import { ApiError } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { canTranslate, languageName, loadAllKeys, loadProject, loadSuggestions, type KeyItem, type Mine, type ProjectInfo } from '../lib/projects.ts';
  import { navigate, route } from '../lib/router.svelte.ts';
  import KeyEditor from '../components/KeyEditor.svelte';
  import Notice from '../components/Notice.svelte';
  import NotFound from './NotFound.svelte';

  let { slug, lang }: { slug: string; lang: string } = $props();

  type Filter = 'all' | 'untranslated' | 'outdated' | 'review' | 'approved';
  let info = $state<ProjectInfo | null>(null);
  let keys = $state<KeyItem[]>([]);
  let mine = $state<Record<string, Mine>>({});
  let missing = $state(false);
  let error = $state('');
  let search = $state('');
  let filter = $state<Filter>('all');

  $effect(() => {
    (async () => {
      const p = await loadProject(slug);
      if (!p.project.languages.some((l) => l.tag === lang)) { missing = true; return; }
      if (canTranslate(p.roles, lang, p.project)) {
        const [k, s] = await Promise.all([loadAllKeys(slug), loadSuggestions(slug, `mine=1&language=${encodeURIComponent(lang)}`)]);
        keys = k;
        // the newest of my suggestions per key wins (the list is oldest first)
        const m: Record<string, Mine> = {};
        for (const x of s) if (x.state !== 'superseded' && x.state !== 'approved') m[x.key] = { id: x.id, text: x.text, state: x.state, rejectReason: x.rejectReason }; else delete m[x.key];
        mine = m;
      }
      info = p;
    })().catch((e) => { if (e instanceof ApiError && e.status === 404) missing = true; else error = errorText(e); });
  });

  const stateOf = (k: KeyItem): Filter => (!k.translations[lang] ? 'untranslated' : k.translations[lang].outdated ? 'outdated' : 'approved');
  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return keys.filter((k) => {
      if (q && !k.name.toLowerCase().includes(q) && !k.sourceText.toLowerCase().includes(q) && !(k.translations[lang]?.text.toLowerCase().includes(q))) return false;
      if (filter === 'review') return (k.openSuggestions[lang] ?? 0) > 0;
      return filter === 'all' || stateOf(k) === filter;
    });
  });
  const selected = $derived(keys.find((k) => k.name === route.query.get('key')) ?? null);
  const href = (name: string) => `/projects/${slug}/translate/${lang}?key=${encodeURIComponent(name)}`;

  function move(step: 1 | -1) {
    if (!shown.length) return;
    const i = selected ? shown.findIndex((k) => k.name === selected.name) : -1;
    const next = shown[i === -1 ? 0 : (i + step + shown.length) % shown.length]!;
    navigate(href(next.name), true);
    requestAnimationFrame(() => document.getElementById('translation')?.focus());
  }

  function submitted(name: string, m: Mine) {
    const k = keys.find((x) => x.name === name)!;
    if (mine[name]?.state !== 'open') k.openSuggestions[lang] = (k.openSuggestions[lang] ?? 0) + 1;
    mine[name] = m;
  }
  function withdrawn(name: string) {
    const k = keys.find((x) => x.name === name)!;
    k.openSuggestions[lang] = Math.max(0, (k.openSuggestions[lang] ?? 1) - 1);
    delete mine[name];
  }
</script>

{#if missing}
  <NotFound />
{:else}
  <main id="main" class="wide">
    <p class="eyebrow"><a href="/">{t('nav.projects')}</a> / {#if info}<a href="/projects/{slug}">{info.project.name}</a>{/if}</p>
    <h1>{t('translate.title', { lang: languageName(lang) })} <span class="tag">{lang}</span></h1>
    {#if error}
      <Notice><p>{error}</p></Notice>
    {:else if !info}
      <p class="muted" aria-busy="true">{t('app.loading')}</p>
    {:else if !canTranslate(info.roles, lang, info.project)}
      <Notice><p>{lang === info.project.sourceLanguage ? t('translate.isSource') : t('translate.notYours')}</p></Notice>
    {:else}
      <div class="layout" class:has-selection={selected}>
        <section class="list" aria-label={t('translate.keys')}>
          <div class="filters">
            <div>
              <label for="search">{t('translate.search')}</label>
              <input id="search" type="search" bind:value={search} autocomplete="off" />
            </div>
            <div>
              <label for="filter">{t('translate.filter')}</label>
              <select id="filter" bind:value={filter}>
                {#each ['all', 'untranslated', 'outdated', 'review', 'approved'] as f (f)}<option value={f}>{t(`filter.${f}`)}</option>{/each}
              </select>
            </div>
          </div>
          <p class="small muted" aria-live="polite">{t('translate.shown', { count: shown.length, total: keys.length })}</p>
          <ul class="keys" data-testid="key-list">
            {#each shown as k (k.name)}
              <li>
                <a href={href(k.name)} aria-current={selected?.name === k.name ? 'true' : undefined}>
                  <span class="mono name">{k.name}</span>
                  <span class="preview">{k.translations[lang]?.text ?? k.sourceText}</span>
                  <span class="badges">
                    <span class="badge {stateOf(k)}">{t(`state.${stateOf(k)}`)}</span>
                    {#if (k.openSuggestions[lang] ?? 0) > 0}<span class="badge">{t('state.inReview')}</span>{/if}
                  </span>
                </a>
              </li>
            {:else}
              <li class="muted">{t('translate.noneShown')}</li>
            {/each}
          </ul>
        </section>
        <div class="pane">
          {#if selected}
            <a class="back" href="/projects/{slug}/translate/{lang}">{t('translate.backToList')}</a>
            {#key selected.name}
              <KeyEditor {slug} {lang} sourceLanguage={info.project.sourceLanguage} item={selected} mine={mine[selected.name] ?? null}
                onsubmitted={(m) => submitted(selected.name, m)} onwithdrawn={() => withdrawn(selected.name)} onmove={move} />
            {/key}
          {:else}
            <p class="muted pick">{t('translate.pick')}</p>
          {/if}
        </div>
      </div>
    {/if}
  </main>
{/if}

<style>
  .layout { display: grid; gap: 1.5rem; }
  .filters { display: grid; grid-template-columns: 1fr; gap: .5rem; margin-bottom: .5rem; }
  .keys { list-style: none; margin: 0; padding: 0; display: grid; gap: .375rem; }
  .keys a { display: grid; gap: .125rem; padding: .5rem .625rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); color: var(--fg); text-decoration: none; }
  .keys a[aria-current="true"] { border-color: var(--fill); box-shadow: inset 3px 0 0 var(--fill); }
  .name { font-size: .8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .back { display: inline-block; margin-bottom: .75rem; }
  .pick { margin-top: 2rem; }
  @media (max-width: 59.99rem) {
    .layout.has-selection .list { display: none; }
    .layout:not(.has-selection) .pane { display: none; }
  }
  @media (min-width: 60rem) {
    .layout { grid-template-columns: minmax(18rem, 2fr) 3fr; align-items: start; }
    .list { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow: auto; padding-right: .25rem; }
    .back { display: none; }
    .filters { grid-template-columns: 1fr 1fr; }
  }
</style>
