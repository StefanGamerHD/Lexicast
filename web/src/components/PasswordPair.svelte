<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';
  import { MIN_PASSWORD } from '../lib/checks.ts';
  import Field from './Field.svelte';

  // New password plus repetition, with the same minimum the server enforces (12 characters).
  let { password = $bindable(''), confirm = $bindable(''), touched = false, label }: { password: string; confirm: string; touched?: boolean; label?: string } = $props();
  let show = $state(false);
  const shortError = $derived(touched && password.length < MIN_PASSWORD ? t('check.passwordShort') : undefined);
  const matchError = $derived(touched && confirm !== password ? t('check.passwordMismatch') : undefined);
</script>

<Field label={label ?? t('field.password')} type={show ? 'text' : 'password'} autocomplete="new-password" required maxlength={256} bind:value={password} hint={t('field.passwordHint')} error={shortError} />
<Field label={t('field.confirmPassword')} type={show ? 'text' : 'password'} autocomplete="new-password" required maxlength={256} bind:value={confirm} error={matchError} />
<label class="check"><input type="checkbox" bind:checked={show} /> {t('field.showPassword')}</label>
