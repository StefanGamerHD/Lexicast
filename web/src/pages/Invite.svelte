<script lang="ts">
  import { api, type User } from '../lib/api.ts';
  import { passwordPairOk } from '../lib/checks.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { signedIn } from '../lib/session.svelte.ts';
  import Field from '../components/Field.svelte';
  import Notice from '../components/Notice.svelte';
  import PasswordPair from '../components/PasswordPair.svelte';

  let { token }: { token: string } = $props();
  let displayName = $state('');
  let password = $state('');
  let confirm = $state('');
  let touched = $state(false);
  let busy = $state(false);
  let error = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    touched = true;
    if (!displayName.trim() || !passwordPairOk(password, confirm)) return;
    busy = true;
    error = '';
    try {
      const r = await api<{ user: User }>('POST', '/invitations/accept', { token, displayName, password });
      await signedIn(r.user, true);
      navigate('/', true);
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="narrow" id="main">
  <h1>{t('invite.title')}</h1>
  <p class="muted">{t('invite.intro')}</p>
  {#if error}<Notice><p>{error}</p></Notice>{/if}
  <div class="card">
    <form onsubmit={submit}>
      <Field label={t('field.displayName')} type="text" autocomplete="nickname" required maxlength={100} bind:value={displayName} hint={t('field.displayNameHint')} />
      <PasswordPair bind:password bind:confirm {touched} />
      <button type="submit" disabled={busy}>{t('invite.submit')}</button>
    </form>
  </div>
</main>
