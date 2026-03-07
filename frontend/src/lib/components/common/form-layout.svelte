<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="mx-auto w-full max-w-2xl">
	{@render children()}
</div>
