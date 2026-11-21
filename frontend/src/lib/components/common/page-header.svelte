<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string | Snippet | undefined;
		back?: Snippet;
		actions?: Snippet;
	}

	let { title, description, back, actions }: Props = $props();
</script>

<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
	<div class="flex min-w-0 items-center gap-3">
		{#if back}
			{@render back()}
		{/if}
		<div class="min-w-0">
			<h1 class="text-3xl font-bold tracking-tight">{title}</h1>
			{#if typeof description === 'function'}
				<p class="text-muted-foreground mt-1">{@render description()}</p>
			{:else if description}
				<p class="text-muted-foreground mt-1">{description}</p>
			{/if}
		</div>
	</div>
	{#if actions}
		{@render actions()}
	{/if}
</div>
