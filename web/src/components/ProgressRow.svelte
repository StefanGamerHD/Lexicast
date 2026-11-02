<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte.ts';
  import { languageName, type LanguageProgress } from '../lib/projects.ts';

  // One language like on the public progress page, plus the actions the person may take.
  let { lang, children }: { lang: LanguageProgress; children?: Snippet } = $props();
  const extra = $derived([
    lang.isSource ? t('progress.source') : '',
    lang.inReview ? t('progress.inReview', { count: lang.inReview }) : '',
    lang.outdated ? t('progress.outdated', { count: lang.outdated }) : '',
  ].filter(Boolean).join(' · '));
</script>

<li class="progress-row">
  <div class="row"><span class="name">{languageName(lang.tag)} <span class="tag">{lang.tag}</span></span><span class="pct">{lang.percent}%</span></div>
  <progress max="100" value={lang.percent} aria-label={languageName(lang.tag)}>{lang.percent}%</progress>
  <div class="meta">{t('progress.translated', { done: lang.translated, total: lang.total })}{extra ? ' · ' + extra : ''}</div>
  {#if children}<div class="actions">{@render children()}</div>{/if}
</li>
