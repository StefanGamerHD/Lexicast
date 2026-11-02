<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';

  // A link shown once (e.g. an invitation without mail), selectable and copyable.
  let { url }: { url: string } = $props();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch { /* clipboard blocked (e.g. no https): the box is selectable */ }
  }
</script>

<code class="keybox" data-testid="invite-link">{url}</code>
<p><button class="secondary" type="button" onclick={copy} aria-live="polite">{copied ? t('setup.copied') : t('setup.copy')}</button></p>
