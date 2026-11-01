<script lang="ts">
  import { api } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Field from '../components/Field.svelte';
  import Notice from '../components/Notice.svelte';

  let email = $state('');
  let busy = $state(false);
  let error = $state('');
  let sent = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      // the server answers the same for known and unknown addresses
      await api('POST', '/auth/password-reset/request', { email });
      sent = true;
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="narrow" id="main">
  <h1>{t('forgot.title')}</h1>
  {#if sent}
    <Notice kind="ok"><p>{t('forgot.sent')}</p></Notice>
  {:else}
    {#if error}<Notice><p>{error}</p></Notice>{/if}
    <div class="card">
      <p>{t('forgot.intro')}</p>
      <form onsubmit={submit}>
        <Field label={t('field.email')} type="email" autocomplete="username" required maxlength={254} bind:value={email} />
        <button type="submit" disabled={busy}>{t('forgot.submit')}</button>
      </form>
    </div>
  {/if}
  <div class="links"><a href="/login">{t('forgot.back')}</a></div>
</main>
