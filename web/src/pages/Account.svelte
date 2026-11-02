<script lang="ts">
  import { api } from '../lib/api.ts';
  import { passwordPairOk } from '../lib/checks.ts';
  import { errorText } from '../lib/errors.ts';
  import { LOCALES, i18n, t, type Locale } from '../lib/i18n.svelte.ts';
  import { session, setLocale, setTheme, updateAccount, type Theme } from '../lib/session.svelte.ts';
  import Field from '../components/Field.svelte';
  import Notice from '../components/Notice.svelte';
  import PasswordPair from '../components/PasswordPair.svelte';

  const names: Record<Locale, string> = { en: 'English', de: 'Deutsch' };

  let displayName = $state(session.user?.displayName ?? '');
  let notifyEmail = $state(session.user?.notifyEmail ?? true);
  let profileBusy = $state(false);
  let profileError = $state('');
  let profileDone = $state(false);
  const dirty = $derived(!!session.user && (displayName.trim() !== session.user.displayName || notifyEmail !== session.user.notifyEmail));

  let current = $state('');
  let password = $state('');
  let confirm = $state('');
  let touched = $state(false);
  let pwBusy = $state(false);
  let pwError = $state('');
  let pwDone = $state(false);

  async function saveProfile(e: SubmitEvent) {
    e.preventDefault();
    if (!displayName.trim() || profileBusy) return;
    profileBusy = true; profileError = ''; profileDone = false;
    try {
      await updateAccount({ displayName: displayName.trim(), notifyEmail });
      displayName = session.user!.displayName;
      notifyEmail = session.user!.notifyEmail;
      profileDone = true;
    } catch (err) { profileError = errorText(err); } finally { profileBusy = false; }
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    touched = true;
    if (!current || !passwordPairOk(password, confirm) || pwBusy) return;
    pwBusy = true; pwError = ''; pwDone = false;
    try {
      await api('POST', '/me/password', { currentPassword: current, newPassword: password });
      current = ''; password = ''; confirm = ''; touched = false;
      pwDone = true;
    } catch (err) { pwError = errorText(err); } finally { pwBusy = false; }
  }
</script>

<main id="main" class="narrow">
  <p class="eyebrow"><a href="/">{t('nav.projects')}</a></p>
  <h1>{t('account.title')}</h1>

  <section class="card" aria-labelledby="profile-title">
    <h2 id="profile-title">{t('account.profile')}</h2>
    {#if profileError}<Notice><p>{profileError}</p></Notice>{/if}
    {#if profileDone}<Notice kind="ok"><p>{t('account.saved')}</p></Notice>{/if}
    <form onsubmit={saveProfile}>
      <div>
        <p class="label">{t('field.email')}</p>
        <p class="value" data-testid="account-email">{session.user?.email}</p>
        <p class="hint">{t('account.emailHint')}</p>
      </div>
      <Field label={t('field.displayName')} type="text" required maxlength={100} autocomplete="name" bind:value={displayName} hint={t('field.displayNameHint')}
        error={displayName.trim() ? undefined : t('check.required')} />
      <div>
        <label class="check"><input type="checkbox" bind:checked={notifyEmail} /> {t('account.notify')}</label>
        <p class="hint">{t('account.notifyHint')}{#if !session.mailEnabled}{' '}{t('account.noMail')}{/if}</p>
      </div>
      <div><button type="submit" disabled={profileBusy || !dirty || !displayName.trim()}>{t('key.save')}</button></div>
    </form>
  </section>

  <section class="card" aria-labelledby="display-title">
    <h2 id="display-title">{t('account.display')}</h2>
    <form onsubmit={(e) => e.preventDefault()}>
      <div>
        <label for="account-locale">{t('nav.language')}</label>
        <select id="account-locale" value={i18n.locale} onchange={(e) => setLocale(e.currentTarget.value as Locale)}>
          {#each LOCALES as l (l)}<option value={l}>{names[l]}</option>{/each}
        </select>
      </div>
      <div>
        <label for="account-theme">{t('nav.theme')}</label>
        <select id="account-theme" value={session.theme} onchange={(e) => setTheme(e.currentTarget.value as Theme)}>
          <option value="system">{t('theme.system')}</option>
          <option value="light">{t('theme.light')}</option>
          <option value="dark">{t('theme.dark')}</option>
        </select>
      </div>
      <p class="hint">{t('account.displayHint')}</p>
    </form>
  </section>

  <section class="card" aria-labelledby="password-title">
    <h2 id="password-title">{t('account.password')}</h2>
    {#if pwError}<Notice><p>{pwError}</p></Notice>{/if}
    {#if pwDone}<Notice kind="ok"><p>{t('account.passwordChanged')}</p></Notice>{/if}
    <form onsubmit={changePassword}>
      <Field label={t('account.currentPassword')} type="password" autocomplete="current-password" required maxlength={256} bind:value={current}
        error={touched && !current ? t('check.required') : undefined} />
      <PasswordPair label={t('field.newPassword')} bind:password bind:confirm {touched} />
      <div><button type="submit" disabled={pwBusy}>{t('account.changePassword')}</button></div>
    </form>
    <p class="small muted">{t('account.passwordHint')}</p>
  </section>
</main>

<style>
  section { margin-bottom: 1rem; }
  section h2 { margin-top: 0; }
  .label { font-weight: 600; margin: 0 0 .25rem; }
  .value { margin: 0; overflow-wrap: anywhere; }
</style>
