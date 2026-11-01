<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';

  let { publicKey, fingerprint }: { publicKey: string; fingerprint: string } = $props();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicKey);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch { /* clipboard blocked (e.g. no https): the key box is selectable */ }
  }
</script>

<dl class="facts">
  <dt>{t('setup.fingerprint')}</dt>
  <dd><code data-testid="fingerprint">{fingerprint}</code></dd>
  <dt>{t('setup.publicKey')}</dt>
  <dd><code class="keybox" data-testid="public-key">{publicKey}</code></dd>
</dl>
<button class="secondary" type="button" onclick={copy} aria-live="polite">{copied ? t('setup.copied') : t('setup.copy')}</button>
