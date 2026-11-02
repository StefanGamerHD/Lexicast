<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { formatDate, loadProject, roleLabel as label, type Invitation, type MemberRow, type ProjectInfo } from '../lib/projects.ts';
  import { session } from '../lib/session.svelte.ts';
  import CopyLink from '../components/CopyLink.svelte';
  import Field from '../components/Field.svelte';
  import Notice from '../components/Notice.svelte';
  import ProjectNav from '../components/ProjectNav.svelte';
  import NotFound from './NotFound.svelte';

  let { slug }: { slug: string } = $props();
  let info = $state<ProjectInfo | null>(null);
  let rows = $state<MemberRow[]>([]);
  let invitations = $state<Invitation[]>([]);
  let missing = $state(false);
  let error = $state('');
  let message = $state('');
  let link = $state('');
  let busy = $state(false);

  let email = $state('');
  let role = $state<'translator' | 'reviewer' | 'owner'>('translator');
  let language = $state('');
  let leaving = $state(false);

  async function reload() {
    const [m, i] = await Promise.all([
      api<{ members: MemberRow[] }>('GET', `/projects/${slug}/members`),
      api<{ invitations: Invitation[] }>('GET', `/projects/${slug}/invitations`),
    ]);
    rows = m.members;
    invitations = i.invitations;
  }

  $effect(() => {
    (async () => {
      const p = await loadProject(slug);
      if (p.roles.owner) await reload();
      info = p;
    })().catch((e) => { if (e instanceof ApiError && e.status === 404) missing = true; else error = errorText(e); });
  });

  const targets = $derived(info ? info.project.languages.map((l) => l.tag).filter((l) => l !== info!.project.sourceLanguage) : []);
  $effect(() => { if (!language && targets.length) language = targets[0]!; });

  // one entry per person with all their roles
  const people = $derived.by(() => {
    const by = new Map<number, { id: number; email: string; displayName: string; roles: MemberRow[] }>();
    for (const r of rows) {
      const p = by.get(r.id) ?? { id: r.id, email: r.email, displayName: r.displayName, roles: [] };
      p.roles.push(r);
      by.set(r.id, p);
    }
    return [...by.values()];
  });
  const roleLabel = (r: { role: string; language: string }) => label(r.role, r.language);

  async function run(fn: () => Promise<void>) {
    busy = true; error = ''; message = ''; link = '';
    try { await fn(); } catch (e) {
      error = e instanceof ApiError && e.code === 'last_owner' ? t('members.lastOwner') : errorText(e);
    } finally { busy = false; }
    try { await reload(); } catch (e) { if (!(e instanceof ApiError && e.status === 403)) error = errorText(e); }
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    const to = email.trim();
    return run(async () => {
      const r = await api<{ added?: boolean; sent?: boolean; mailError?: boolean; inviteUrl?: string }>('POST', `/projects/${slug}/members`, { email: to, role, ...(role === 'owner' ? {} : { language }) });
      if (r.added) message = t('members.added', { email: to });
      else if (r.sent) message = t('members.inviteSent', { email: to });
      else { message = r.mailError ? t('members.inviteMailFailed', { email: to }) : t('members.inviteLink', { email: to }); link = r.inviteUrl ?? ''; }
      email = '';
    });
  }

  function remove(r: MemberRow) {
    const self = r.id === session.user?.id && r.role === 'owner';
    if (self && !leaving) { leaving = true; return; }
    leaving = false;
    return run(async () => {
      await api('POST', `/projects/${slug}/members/remove`, { userId: r.id, role: r.role, ...(r.role === 'owner' ? {} : { language: r.language }) });
      message = t('members.removed', { role: roleLabel(r), name: r.displayName });
      // with another role left the project stays reachable; without one it answers "not found", so go to the start page
      if (self) navigate(rows.some((x) => x.id === r.id && x !== r) ? `/projects/${slug}` : '/');
    });
  }

  const revoke = (i: Invitation) => run(async () => {
    await api('POST', `/projects/${slug}/invitations/${i.id}/revoke`, {});
    message = t('members.revoked', { email: i.email });
  });

  function prefill(p: { email: string }) {
    email = p.email;
    document.getElementById('member-email')?.focus();
  }
</script>

{#if missing}
  <NotFound />
{:else}
  <main id="main">
    <ProjectNav {slug} {info} current="members" />
    <h1>{t('members.title')}</h1>
    {#if error}<Notice><p>{error}</p></Notice>{/if}
    {#if message}<Notice kind="ok"><p>{message}</p>{#if link}<CopyLink text={link} testid="invite-link" />{/if}</Notice>{/if}
    {#if !info}
      {#if !error}<p class="muted" aria-busy="true">{t('app.loading')}</p>{/if}
    {:else if !info.roles.owner}
      <Notice><p>{t('members.ownersOnly')}</p></Notice>
    {:else}
      <section class="card" aria-labelledby="add-title">
        <h2 id="add-title">{t('members.addTitle')}</h2>
        <p class="small muted">{t('members.addIntro')}</p>
        <form onsubmit={add}>
          <Field id="member-email" label={t('field.email')} type="email" autocomplete="off" required maxlength={254} bind:value={email} />
          <div class="row">
            <div>
              <label for="member-role">{t('members.role')}</label>
              <select id="member-role" bind:value={role}>
                <option value="translator">{t('members.roleTranslator')}</option>
                <option value="reviewer">{t('members.roleReviewer')}</option>
                <option value="owner">{t('role.owner')}</option>
              </select>
            </div>
            {#if role !== 'owner'}
              <div>
                <label for="member-language">{t('members.language')}</label>
                <select id="member-language" bind:value={language}>
                  {#each targets as l (l)}<option value={l}>{l}</option>{/each}
                </select>
              </div>
            {/if}
          </div>
          <p class="hint">{t(`members.roleHint.${role}`)}</p>
          <div><button type="submit" disabled={busy || (role !== 'owner' && !targets.length)}>{t('members.add')}</button></div>
        </form>
      </section>

      <h2>{t('members.people')}</h2>
      <ul class="cards" data-testid="member-list">
        {#each people as p (p.id)}
          <li class="card person">
            <div class="who">
              <strong>{p.displayName}</strong>{#if p.id === session.user?.id}{' '}<span class="muted">({t('review.you')})</span>{/if}
              <span class="small muted email">{p.email}</span>
            </div>
            <ul class="roles">
              {#each p.roles as r (r.role + r.language)}
                <li>
                  <span class="badge">{roleLabel(r)}</span>
                  <button type="button" class="link small" disabled={busy} onclick={() => remove(r)} aria-label={t('members.removeRole', { role: roleLabel(r), name: p.displayName })}>{t('members.remove')}</button>
                </li>
              {/each}
            </ul>
            {#if leaving && p.id === session.user?.id}
              <Notice><p>{t('members.leaveWarning')}</p></Notice>
              <div class="buttons">
                <button type="button" disabled={busy} onclick={() => remove(p.roles.find((r) => r.role === 'owner')!)}>{t('members.leaveConfirm')}</button>
                <button type="button" class="secondary" onclick={() => (leaving = false)}>{t('review.cancel')}</button>
              </div>
            {/if}
            <button type="button" class="link small" onclick={() => prefill(p)}>{t('members.addRole')}</button>
          </li>
        {/each}
      </ul>

      <h2>{t('members.pending')}</h2>
      {#if !invitations.length}
        <p class="muted">{t('members.noPending')}</p>
      {:else}
        <ul class="cards" data-testid="invitation-list">
          {#each invitations as i (i.id)}
            <li class="card invite">
              <div>
                <strong class="email">{i.email}</strong> <span class="badge">{roleLabel(i)}</span>
                {#if i.expired}<span class="badge warn">{t('members.expired')}</span>{/if}
                <p class="small muted">{t(i.expired ? 'members.expiredOn' : 'members.expiresOn', { date: formatDate(i.expiresAt) })}{#if i.invitedBy}{' · '}{t('members.invitedBy', { name: i.invitedBy })}{/if}</p>
              </div>
              <button type="button" class="secondary" disabled={busy} onclick={() => revoke(i)}>{t('members.revoke')}</button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </main>
{/if}

<style>
  section h2 { margin-top: 0; }
  .row { display: grid; gap: 1rem; }
  @media (min-width: 30rem) { .row { grid-template-columns: 1fr 1fr; } }
  .who { display: flex; flex-wrap: wrap; align-items: baseline; gap: .25rem .5rem; }
  .email { overflow-wrap: anywhere; }
  .roles { list-style: none; margin: .5rem 0; padding: 0; display: flex; flex-wrap: wrap; gap: .5rem 1rem; }
  .roles li { display: flex; align-items: center; gap: .375rem; }
  .buttons { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: .5rem; }
  .invite { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .75rem; }
  .invite p { margin: .25rem 0 0; }
</style>
