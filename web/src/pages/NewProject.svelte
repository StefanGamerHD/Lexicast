<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { isLanguageTag, languageName, type Project } from '../lib/projects.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import Field from '../components/Field.svelte';
  import Notice from '../components/Notice.svelte';

  let name = $state('');
  let slug = $state('');
  let slugEdited = $state(false);
  let source = $state('en');
  let targets = $state('');
  let touched = $state(false);
  let busy = $state(false);
  let error = $state('');
  let slugTaken = $state('');

  // "Café Shop" -> "cafe-shop", until the slug is edited by hand
  const toSlug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '');
  $effect(() => { if (!slugEdited) slug = toSlug(name); });

  // A regional language falls back to its base language when the project has it (de-AT -> de); every chain ends with the source.
  const plan = $derived.by(() => {
    const src = source.trim();
    const typed = targets.split(/[\s,]+/).filter(Boolean);
    const problems: string[] = [];
    if (!isLanguageTag(src)) problems.push(t('newProject.badSource'));
    const tags: string[] = [];
    for (const tag of typed) {
      if (!isLanguageTag(tag)) problems.push(t('newProject.badTag', { tag }));
      else if (tag.toLowerCase() === src.toLowerCase()) problems.push(t('newProject.sourceTwice', { tag }));
      else if (tags.some((x) => x.toLowerCase() === tag.toLowerCase())) problems.push(t('newProject.duplicate', { tag }));
      else tags.push(tag);
    }
    const languages = tags.map((tag) => {
      const base = tag.split('-')[0]!.toLowerCase();
      const parent = base !== tag.toLowerCase() ? tags.find((x) => x.toLowerCase() === base) : undefined;
      return { tag, fallback: parent ? [parent] : [] };
    });
    return { languages, problems };
  });

  const slugError = $derived(slugTaken === slug && slug ? t('newProject.slugTaken')
    : touched && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) ? t('newProject.badSlug')
    : slug === 'new' ? t('newProject.slugReserved') : undefined);
  const nameError = $derived(touched && !name.trim() ? t('check.required') : undefined);
  const valid = $derived(!!name.trim() && /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) && slug !== 'new' && slugTaken !== slug && !plan.problems.length);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    touched = true;
    if (!valid || busy) return;
    busy = true;
    error = '';
    try {
      const src = source.trim();
      const languages = [{ tag: src, fallback: [] }, ...plan.languages];
      const r = await api<{ project: Project }>('POST', '/projects', { slug, name: name.trim(), sourceLanguage: src, languages });
      navigate(`/projects/${r.project.slug}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) slugTaken = slug;
      else error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<main id="main">
  <p class="eyebrow"><a href="/">{t('nav.projects')}</a></p>
  <h1>{t('newProject.title')}</h1>
  {#if !session.user?.isInstanceAdmin}
    <Notice><p>{t('newProject.adminOnly')}</p></Notice>
  {:else}
    {#if error}<Notice><p>{error}</p></Notice>{/if}
    <div class="card">
      <form onsubmit={submit}>
        <Field label={t('newProject.name')} type="text" required maxlength={100} bind:value={name} error={nameError} />
        <Field label={t('newProject.slug')} type="text" required maxlength={63} autocomplete="off" spellcheck={false} bind:value={slug}
          oninput={() => (slugEdited = true)} hint={t('newProject.slugHint')} error={slugError} />
        <Field label={t('newProject.source')} type="text" required maxlength={35} autocomplete="off" spellcheck={false} bind:value={source}
          hint={isLanguageTag(source.trim()) ? languageName(source.trim()) : t('settings.tagHint')} />
        <Field label={t('newProject.targets')} type="text" autocomplete="off" spellcheck={false} bind:value={targets} hint={t('newProject.targetsHint')} />
        {#if plan.problems.length}
          <div role="alert">{#each plan.problems as p (p)}<p class="field-error">{p}</p>{/each}</div>
        {/if}
        {#if plan.languages.length && isLanguageTag(source.trim())}
          <div>
            <p class="label">{t('newProject.preview')}</p>
            <ul class="plain" data-testid="language-plan">
              {#each plan.languages as l (l.tag)}
                <li><strong>{languageName(l.tag)}</strong> <span class="mono small">{[l.tag, ...l.fallback, source.trim()].join(' → ')}</span></li>
              {/each}
            </ul>
            <p class="hint">{t('newProject.previewHint')}</p>
          </div>
        {/if}
        <div><button type="submit" disabled={busy}>{t('newProject.submit')}</button></div>
      </form>
    </div>
    <p class="small muted">{t('newProject.after')}</p>
  {/if}
</main>

<style>
  .label { font-weight: 600; margin: 0 0 .25rem; }
  .plain { list-style: none; padding: 0; margin: 0; display: grid; gap: .25rem; }
</style>
