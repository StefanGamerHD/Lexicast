<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';

  // A value to pass on (an invitation link shown once, the public signing key): selectable and copyable.
  let { text, testid }: { text: string; testid?: string } = $props();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch { /* clipboard blocked (e.g. no https): the box is selectable */ }
  }
</script>

<code class="keybox" data-testid={testid}>{text}</code>
<p><button class="secondary" type="button" onclick={copy} aria-live="polite">{copied ? t('setup.copied') : t('setup.copy')}</button></p>
