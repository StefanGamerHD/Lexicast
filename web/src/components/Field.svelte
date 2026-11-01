<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes { label: string; value: string; hint?: string; error?: string }
  let { label, value = $bindable(''), hint, error, id = `f-${Math.random().toString(36).slice(2, 9)}`, ...rest }: Props = $props();
  const described = $derived([hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined);
</script>

<div>
  <label for={id}>{label}</label>
  <input {id} bind:value aria-invalid={error ? 'true' : undefined} aria-describedby={described} {...rest} />
  {#if hint}<p class="hint" id="{id}-hint">{hint}</p>{/if}
  {#if error}<p class="field-error" id="{id}-err">{error}</p>{/if}
</div>
