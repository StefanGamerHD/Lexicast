<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { isLanguageTag, languageName, loadProject, type Project, type ProjectInfo } from '../lib/projects.ts';
  import Field from '../components/Field.svelte';
  import Notice from '../components/Notice.svelte';
  import ProjectNav from '../components/ProjectNav.svelte';
  import NotFound from './NotFound.svelte';

  let { slug }: { slug: string } = $props();
  let info = $state<ProjectInfo | null>(null);
  let missing = $state(false);
  let error = $state('');
  let message = $state('');
  let busy = $state(false);

  let name = $state('');
  let soloMode = $state(false);
  let progressPublic = $state(false);
  let chains = $state<Record<string, string>>({});
  let chainErrors = $state<Record<string, string>>({});
  let newTag = $state('');
  let newChain = $state('');
  let newError = $state('');

  function adopt(p: Project) {
    name = p.name; soloMode = p.soloMode; progressPublic = p.progressPublic;
    chains = Object.fromEntries(p.languages.map((l) => [l.tag, l.fallback.join(', ')]));
    chainErrors = {};
  }

  $effect(() => {
    loadProject(slug).then((r) => { info = r; adopt(r.project); }, (e) => { if (e instanceof ApiError && e.status === 404) missing = true; else error = errorText(e); });
  });

  const project = $derived(info?.project ?? null);
  const dirty = $derived(!!project && (name.trim() !== project.name || soloMode !== project.soloMode || progressPublic !== project.progressPublic));

  // "DE, en" -> ["de", "en"]: matched to the project's tags ignoring case (like the duplicate check when adding), then checked like the server does
  function parseChain(tag: string, text: string, tags: string[]): { list: string[]; error: string } {
    const list: string[] = [];
    for (const typed of text.split(/[\s,]+/).filter(Boolean)) {
      if (typed.toLowerCase() === tag.toLowerCase()) return { list, error: t('settings.chainSelf') };
      const known = tags.find((x) => x.toLowerCase() === typed.toLowerCase());
      if (!known) return { list, error: t('settings.chainUnknown', { tag: typed }) };
      list.push(known);
    }
    if (new Set(list).size !== list.length) return { list, error: t('settings.chainDuplicate') };
    return { list, error: '' };
  }

  // apply() takes over only the fields of the form that was saved, so unsaved edits in the other forms stay
  async function run(fn: () => Promise<Project>, done: string, apply: (p: Project) => void) {
    busy = true; error = ''; message = '';
    try {
      const p = await fn();
      info = { ...info!, project: p };
      apply(p);
      message = done;
    } catch (e) { error = errorText(e); } finally { busy = false; }
  }

  function saveGeneral(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    return run(async () => (await api<{ project: Project }>('PATCH', `/projects/${slug}`, { name: name.trim(), soloMode, progressPublic })).project, t('settings.saved'),
      (p) => { name = p.name; soloMode = p.soloMode; progressPublic = p.progressPublic; });
  }

  function saveChain(tag: string) {
    const { list, error: err } = parseChain(tag, chains[tag] ?? '', project!.languages.map((l) => l.tag));
    chainErrors[tag] = err;
    if (err) return;
    return run(async () => (await api<{ project: Project }>('PUT', `/projects/${slug}/languages/${tag}`, { fallback: list })).project, t('settings.chainSaved', { lang: tag }),
      (p) => { chains[tag] = (p.languages.find((l) => l.tag === tag)?.fallback ?? list).join(', '); chainErrors[tag] = ''; });
  }

  function addLanguage(e: SubmitEvent) {
    e.preventDefault();
    const tag = newTag.trim();
    newError = '';
    if (!isLanguageTag(tag)) { newError = t('settings.badTag'); return; }
    if (project!.languages.some((l) => l.tag.toLowerCase() === tag.toLowerCase())) { newError = t('settings.tagExists'); return; }
    const { list, error: err } = parseChain(tag, newChain, project!.languages.map((l) => l.tag));
    if (err) { newError = err; return; }
    return run(async () => {
      const p = (await api<{ project: Project }>('PUT', `/projects/${slug}/languages/${tag}`, { fallback: list })).project;
      newTag = ''; newChain = '';
      return p;
    }, t('settings.languageAdded', { lang: tag }), () => { chains[tag] = list.join(', '); });
  }
</script>

{#if missing}
  <NotFound />
{:else}
  <main id="main">
    <ProjectNav {slug} {info} current="settings" />
    <h1>{t('settings.title')}</h1>
    {#if error}<Notice><p>{error}</p></Notice>{/if}
    {#if message}<Notice kind="ok"><p>{message}</p></Notice>{/if}
    {#if !info || !project}
      {#if !error}<p class="muted" aria-busy="true">{t('app.loading')}</p>{/if}
    {:else if !info.roles.owner}
      <Notice><p>{t('settings.ownersOnly')}</p></Notice>
    {:else}
      <section class="card" aria-labelledby="general-title">
        <h2 id="general-title">{t('settings.general')}</h2>
        <form onsubmit={saveGeneral}>
          <Field label={t('settings.name')} type="text" required maxlength={100} bind:value={name} hint={t('settings.slug', { slug: project.slug })} />
          <div>
            <label class="check"><input type="checkbox" bind:checked={progressPublic} /> {t('settings.public')}</label>
            <p class="hint">{t('settings.publicHint')}{#if project.progressPublic}{' '}<a href="/progress/{project.slug}" rel="external">{t('project.publicProgress')}</a>{/if}</p>
          </div>
          <div>
            <label class="check"><input type="checkbox" bind:checked={soloMode} /> {t('settings.solo')}</label>
            <p class="hint">{t('settings.soloHint')}</p>
          </div>
          <div><button type="submit" disabled={busy || !dirty || !name.trim()}>{t('key.save')}</button></div>
        </form>
      </section>

      <h2>{t('project.languages')}</h2>
      <p class="small muted">{t('settings.languagesIntro')}</p>
      <ul class="cards" data-testid="language-list">
        {#each project.languages as l (l.tag)}
          <li class="card">
            <div class="head"><strong>{languageName(l.tag)}</strong> <span class="tag">{l.tag}</span>
              {#if l.tag === project.sourceLanguage}<span class="badge">{t('progress.source')}</span>{/if}</div>
            {#if l.tag !== project.sourceLanguage}
              <form class="chain" onsubmit={(e) => { e.preventDefault(); void saveChain(l.tag); }}>
                <div>
                  <label for="chain-{l.tag}">{t('settings.fallback')}</label>
                  <input id="chain-{l.tag}" type="text" autocomplete="off" spellcheck="false" bind:value={chains[l.tag]} aria-invalid={chainErrors[l.tag] ? 'true' : undefined} />
                  {#if chainErrors[l.tag]}<p class="field-error">{chainErrors[l.tag]}</p>{/if}
                  <p class="hint">{t('settings.fallbackHint', { source: project.sourceLanguage })}</p>
                </div>
                <div><button type="submit" class="secondary" disabled={busy || (chains[l.tag] ?? '') === l.fallback.join(', ')}>{t('key.save')}</button></div>
              </form>
            {/if}
          </li>
        {/each}
      </ul>

      <section class="card add" aria-labelledby="add-lang-title">
        <h2 id="add-lang-title">{t('settings.addLanguage')}</h2>
        <form onsubmit={addLanguage}>
          <Field label={t('settings.tag')} type="text" autocomplete="off" spellcheck={false} maxlength={35} bind:value={newTag} hint={newTag && isLanguageTag(newTag.trim()) ? languageName(newTag.trim()) : t('settings.tagHint')} />
          <Field label={t('settings.fallback')} type="text" autocomplete="off" spellcheck={false} bind:value={newChain} hint={t('settings.fallbackHint', { source: project.sourceLanguage })} />
          {#if newError}<p class="field-error" role="alert">{newError}</p>{/if}
          <div><button type="submit" disabled={busy || !newTag.trim()}>{t('settings.add')}</button></div>
        </form>
        <p class="small muted">{t('settings.afterAdd')}</p>
      </section>
    {/if}
  </main>
{/if}

<style>
  section h2 { margin-top: 0; }
  .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .375rem .5rem; }
  .chain { margin-top: .75rem; gap: .5rem; }
  .add { margin-top: 1rem; }
</style>
