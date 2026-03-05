<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Page title */
		title: string;
		/** Optional description text */
		description?: string;
		/** Optional snippet for action buttons (right side) */
		actions?: Snippet;
	}

	let { title, description, actions }: Props = $props();
</script>

<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
	<div>
		<h1 class="text-3xl font-bold tracking-tight">{title}</h1>
		{#if description}
			<p class="text-muted-foreground mt-1">{description}</p>
		{/if}
	</div>
	{#if actions}
		{@render actions()}
	{/if}
</div>
