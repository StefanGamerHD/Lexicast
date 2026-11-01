<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
</script>

<main id="main">
  <p class="eyebrow">Lexicast</p>
  <h1>{t('home.title', { name: session.user?.displayName ?? '' })}</h1>
  <p>{t('home.next')}</p>
  {#if session.user?.isInstanceAdmin}
    <div class="card">
      <p>{t('home.admin')}</p>
      {#if session.instance?.fingerprint}
        <p class="small muted">{t('home.fingerprint')}</p>
        <code data-testid="fingerprint">{session.instance.fingerprint}</code>
      {/if}
    </div>
  {/if}
</main>
