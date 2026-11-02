<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import { wordDiff } from '../lib/diff.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { formatDate, languageName, loadProject, loadSuggestions, reviewLanguages, type ProjectInfo, type Suggestion } from '../lib/projects.ts';
  import { navigate, route } from '../lib/router.svelte.ts';
  import Notice from '../components/Notice.svelte';
  import NotFound from './NotFound.svelte';

  let { slug }: { slug: string } = $props();
  let info = $state<ProjectInfo | null>(null);
  let items = $state<Suggestion[] | null>(null);
  let missing = $state(false);
  let error = $state('');
  let message = $state('');
  let busy = $state(false);
  let rejecting = $state<number | null>(null);
  let reason = $state('');
  let picked = $state<number[]>([]);

  const languages = $derived(info ? reviewLanguages(info.roles, info.project) : []);
  const language = $derived(languages.includes(route.query.get('language') ?? '') ? route.query.get('language')! : '');

  $effect(() => {
    loadProject(slug).then((r) => (info = r), (e) => { if (e instanceof ApiError && e.status === 404) missing = true; else error = errorText(e); });
  });
  $effect(() => {
    if (languages.length) void reload(language);
  });

  async function reload(lang: string) {
    try {
      items = await loadSuggestions(slug, `state=open${lang ? `&language=${encodeURIComponent(lang)}` : ''}`);
      picked = picked.filter((id) => items!.some((s) => s.id === id && batchable(s)));
    } catch (e) { error = errorText(e); }
  }

  const mayApprove = (s: Suggestion) => !s.sourceChanged && (!s.mine || (info!.project.soloMode && info!.roles.owner));
  const batchable = (s: Suggestion) => mayApprove(s) && !s.warnings.length;
  const othersFor = (s: Suggestion) => items!.filter((x) => x.key === s.key && x.language === s.language && x.id !== s.id).length;

  async function act(fn: () => Promise<unknown>, done: string) {
    busy = true; error = ''; message = '';
    try { await fn(); message = done; } catch (e) { error = errorText(e); } finally { busy = false; }
    await reload(language);
  }
  const approve = (s: Suggestion) => act(() => api('POST', `/projects/${slug}/suggestions/${s.id}/approve`, {}), t('review.approved', { key: s.key }));
  async function reject(e: SubmitEvent, s: Suggestion) {
    e.preventDefault();
    await act(() => api('POST', `/projects/${slug}/suggestions/${s.id}/reject`, { reason: reason.trim() }), t('review.rejectedOne', { key: s.key }));
    if (!error) { rejecting = null; reason = ''; }
  }
  async function approvePicked() {
    const ids = [...picked];
    let ok = 0;
    await act(async () => {
      for (const id of ids) { await api('POST', `/projects/${slug}/suggestions/${id}/approve`, {}); ok++; }
    }, t('review.approvedMany', { count: ids.length }));
    if (error) error = `${t('review.approvedMany', { count: ok })} ${error}`;
    picked = [];
  }
  function toggle(id: number, on: boolean) {
    picked = on ? [...picked, id] : picked.filter((x) => x !== id);
  }
  function chooseLanguage(v: string) {
    navigate(`/projects/${slug}/review${v ? `?language=${encodeURIComponent(v)}` : ''}`, true);
  }
</script>

{#if missing}
  <NotFound />
{:else}
  <main id="main" class="wide">
    <p class="eyebrow"><a href="/">{t('nav.projects')}</a> / {#if info}<a href="/projects/{slug}">{info.project.name}</a>{/if}</p>
    <h1>{t('review.title')}</h1>
    {#if error}<Notice><p>{error}</p></Notice>{/if}
    {#if message}<Notice kind="ok"><p>{message}</p></Notice>{/if}
    {#if !info}
      {#if !error}<p class="muted" aria-busy="true">{t('app.loading')}</p>{/if}
    {:else if !languages.length}
      <Notice><p>{t('review.notYours')}</p></Notice>
    {:else}
      <div class="toolbar">
        <div>
          <label for="language">{t('review.language')}</label>
          <select id="language" value={language} onchange={(e) => chooseLanguage(e.currentTarget.value)}>
            <option value="">{t('review.allLanguages')}</option>
            {#each languages as l (l)}<option value={l}>{languageName(l)} ({l})</option>{/each}
          </select>
        </div>
        {#if items?.some(batchable)}
          <button type="button" disabled={busy || !picked.length} onclick={approvePicked}>{t('review.approvePicked', { count: picked.length })}</button>
        {/if}
      </div>
      {#if info.project.soloMode}<p class="small muted">{t('review.soloHint')}</p>{/if}

      {#if !items}
        <p class="muted" aria-busy="true">{t('app.loading')}</p>
      {:else if !items.length}
        <div class="card"><p>{t('review.empty')}</p></div>
      {:else}
        <p class="small muted">{t('review.count', { count: items.length })}</p>
        <ul class="queue" data-testid="review-queue">
          {#each items as s (s.id)}
            <li class="card" aria-labelledby="s-{s.id}">
              <div class="head">
                <h2 id="s-{s.id}" class="mono">{s.key}</h2>
                <span class="tag">{s.language}</span>
              </div>
              <p class="small muted">{t('review.by', { name: s.mine ? t('review.you') : s.author, date: formatDate(s.createdAt) })}</p>

              <p class="label">{t('review.source')}</p>
              <p class="text" lang={info.project.sourceLanguage}>{s.sourceText}</p>
              <p class="label">{s.currentText === null ? t('review.newText') : t('review.change')}</p>
              <p class="text diff" lang={s.language} data-testid="diff">
                {#if s.currentText === null}{s.text}{:else}{#each wordDiff(s.currentText, s.text) as part, i (i)}{#if part.kind === 'added'}<ins>{part.text}</ins>{:else if part.kind === 'removed'}<del>{part.text}</del>{:else}{part.text}{/if}{/each}{/if}
              </p>

              {#if s.sourceChanged}<Notice><p>{t('review.sourceChanged')}</p></Notice>{/if}
              {#if s.warnings.length}
                <ul class="warnings" aria-label={t('review.warnings')}>
                  {#each s.warnings as w (w)}<li>{t(`warning.${w}`)}</li>{/each}
                </ul>
              {/if}
              {#if othersFor(s) > 0}<p class="small">{t('review.conflict', { count: othersFor(s) })}</p>{/if}
              {#if s.mine && !mayApprove(s)}<p class="small muted">{t('review.ownText')}</p>{/if}

              {#if rejecting === s.id}
                <form onsubmit={(e) => reject(e, s)}>
                  <div>
                    <label for="reason-{s.id}">{t('review.reason')}</label>
                    <textarea id="reason-{s.id}" rows="2" maxlength="500" required bind:value={reason}></textarea>
                    <p class="hint">{t('review.reasonHint')}</p>
                  </div>
                  <div class="buttons">
                    <button type="submit" disabled={busy || !reason.trim()}>{t('review.confirmReject')}</button>
                    <button class="secondary" type="button" onclick={() => { rejecting = null; reason = ''; }}>{t('review.cancel')}</button>
                  </div>
                </form>
              {:else}
                <div class="buttons">
                  {#if mayApprove(s)}<button type="button" disabled={busy} onclick={() => approve(s)}>{t('review.approve')}</button>{/if}
                  {#if !s.mine}<button class="secondary" type="button" disabled={busy} onclick={() => { rejecting = s.id; reason = ''; }}>{t('review.reject')}</button>{/if}
                  {#if batchable(s)}
                    <label class="check"><input type="checkbox" checked={picked.includes(s.id)} onchange={(e) => toggle(s.id, e.currentTarget.checked)} /> {t('review.pick')}</label>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </main>
{/if}

<style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: .75rem; margin-bottom: 1rem; }
  .toolbar select { min-width: 14rem; }
  .queue { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; }
  .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; }
  h2 { margin: 0; overflow-wrap: anywhere; }
  .label { font-weight: 600; margin: .75rem 0 .25rem; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius); padding: .5rem .625rem; }
  .warnings { margin: 0 0 1rem; padding-left: 1.25rem; color: var(--warn); }
  .buttons { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; }
  form { gap: .5rem; }
</style>
