<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';
  import CopyLink from './CopyLink.svelte';

  let { publicKey, fingerprint }: { publicKey: string; fingerprint: string } = $props();
</script>

<dl class="facts">
  <dt>{t('setup.fingerprint')}</dt>
  <dd><code data-testid="fingerprint">{fingerprint}</code></dd>
  <dt>{t('setup.publicKey')}</dt>
  <dd><CopyLink text={publicKey} testid="public-key" /></dd>
</dl>
