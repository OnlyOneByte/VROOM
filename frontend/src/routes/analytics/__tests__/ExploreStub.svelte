<script lang="ts">
	import type { Snippet } from 'svelte';

	// Stands in for ExploreTab: renders only the page's filter chips it is handed.
	let { filters }: { filters?: Snippet } = $props();
</script>

{@render filters?.()}
