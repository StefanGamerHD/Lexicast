<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';

  // roles as the API lists them: "owner", "reviewer:de", "translator:fr"
  let { roles }: { roles: string[] } = $props();
  const labels = $derived(roles.map((r) => {
    const [role, lang] = r.split(':');
    return lang ? t(`role.${role}Of`, { lang }) : t(`role.${role}`);
  }));
</script>

<ul class="badges">
  {#each labels as l (l)}<li class="badge">{l}</li>{/each}
</ul>
