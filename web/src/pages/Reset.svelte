<script lang="ts">
  import { api } from '../lib/api.ts';
  import { passwordPairOk } from '../lib/checks.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Notice from '../components/Notice.svelte';
  import PasswordPair from '../components/PasswordPair.svelte';

  let { token }: { token: string } = $props();
  let password = $state('');
  let confirm = $state('');
  let touched = $state(false);
  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    touched = true;
    if (!passwordPairOk(password, confirm)) return;
    busy = true;
    error = '';
    try {
      await api('POST', '/auth/password-reset/confirm', { token, password });
      done = true;
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="narrow" id="main">
  <h1>{t('reset.title')}</h1>
  {#if done}
    <Notice kind="ok"><p>{t('reset.done')}</p></Notice>
    <a class="button" href="/login">{t('login.submit')}</a>
  {:else}
    {#if error}<Notice><p>{error}</p></Notice>{/if}
    <div class="card">
      <form onsubmit={submit}>
        <PasswordPair label={t('field.newPassword')} bind:password bind:confirm {touched} />
        <button type="submit" disabled={busy}>{t('reset.submit')}</button>
      </form>
    </div>
    <div class="links"><a href="/forgot">{t('forgot.title')}</a></div>
  {/if}
</main>
