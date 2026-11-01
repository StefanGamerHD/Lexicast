<script lang="ts">
  import { api, type User } from '../lib/api.ts';
  import { errorText } from '../lib/errors.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { navigate, route, safeNext } from '../lib/router.svelte.ts';
  import { signedIn } from '../lib/session.svelte.ts';
  import Field from '../components/Field.svelte';
  import Notice from '../components/Notice.svelte';

  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const next = safeNext(route.query.get('next')); // read before awaiting: the app may redirect meanwhile
    busy = true;
    error = '';
    try {
      const r = await api<{ user: User }>('POST', '/auth/login', { email, password });
      await signedIn(r.user);
      navigate(next, true);
    } catch (err) {
      error = errorText(err);
      password = '';
    } finally {
      busy = false;
    }
  }
</script>

<main class="narrow" id="main">
  <h1>{t('login.title')}</h1>
  {#if error}<Notice><p>{error}</p></Notice>{/if}
  <div class="card">
    <form onsubmit={submit}>
      <Field label={t('field.email')} type="email" autocomplete="username" required maxlength={254} bind:value={email} />
      <Field label={t('field.password')} type="password" autocomplete="current-password" required maxlength={256} bind:value={password} />
      <button type="submit" disabled={busy}>{t('login.submit')}</button>
    </form>
  </div>
  <div class="links">
    <a href="/forgot">{t('login.forgot')}</a>
    <span class="muted">{t('login.noAccount')}</span>
  </div>
</main>
