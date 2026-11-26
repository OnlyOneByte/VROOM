<script lang="ts">
	import type { Snippet } from 'svelte';

	let { filters }: { filters?: Snippet } = $props();
</script>

{@render filters?.()}
