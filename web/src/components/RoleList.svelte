<script lang="ts">
  import { roleLabel } from '../lib/projects.ts';

  // roles as the API lists them: "owner", "reviewer:de", "translator:fr"
  let { roles }: { roles: string[] } = $props();
  const labels = $derived(roles.map((r) => {
    const [role = '', lang = ''] = r.split(':');
    return roleLabel(role, lang);
  }));
</script>

<ul class="badges">
  {#each labels as l (l)}<li class="badge">{l}</li>{/each}
</ul>
