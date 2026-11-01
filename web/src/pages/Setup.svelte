<script lang="ts">
  import { api, type User } from '../lib/api.ts';
  import { passwordPairOk } from '../lib/checks.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { session, signedIn } from '../lib/session.svelte.ts';
  import Field from '../components/Field.svelte';
  import KeyFacts from '../components/KeyFacts.svelte';
  import Notice from '../components/Notice.svelte';
  import PasswordPair from '../components/PasswordPair.svelte';

  let setupToken = $state('');
  let email = $state('');
  let displayName = $state('');
  let password = $state('');
  let confirm = $state('');
  let touched = $state(false);
  let busy = $state(false);
  let error = $state('');
  let done = $state<{ publicKey: string; fingerprint: string } | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    touched = true;
    if (!displayName.trim() || !passwordPairOk(password, confirm)) return;
    busy = true;
    error = '';
    try {
      const r = await api<{ user: User; publicKey: string; fingerprint: string }>('POST', '/setup', { setupToken: setupToken.trim(), email, displayName, password });
      done = { publicKey: r.publicKey, fingerprint: r.fingerprint };
      await signedIn(r.user, true);
      if (session.instance) Object.assign(session.instance, done);
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="narrow" id="main">
  {#if done}
    <h1>{t('setup.doneTitle')}</h1>
    <Notice kind="ok"><p>{t('setup.doneIntro')}</p></Notice>
    <div class="card">
      <KeyFacts publicKey={done.publicKey} fingerprint={done.fingerprint} />
    </div>
    <p></p>
    <button type="button" onclick={() => navigate('/', true)}>{t('setup.continue')}</button>
  {:else}
    <h1>{t('setup.title')}</h1>
    <p class="muted">{t('setup.intro')}</p>
    {#if error}<Notice><p>{error}</p></Notice>{/if}
    <div class="card">
      <form onsubmit={submit}>
        <Field label={t('field.setupToken')} type="text" autocomplete="off" spellcheck={false} required maxlength={256} bind:value={setupToken} hint={t('field.setupTokenHint')} class="mono" />
        <Field label={t('field.email')} type="email" autocomplete="username" required maxlength={254} bind:value={email} />
        <Field label={t('field.displayName')} type="text" autocomplete="nickname" required maxlength={100} bind:value={displayName} hint={t('field.displayNameHint')} />
        <PasswordPair bind:password bind:confirm {touched} />
        <button type="submit" disabled={busy}>{t('setup.submit')}</button>
      </form>
    </div>
  {/if}
</main>
