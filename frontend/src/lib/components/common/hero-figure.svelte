<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		value: string;
		meta?: Snippet;
		action?: Snippet;
		class?: string;
	}

	let { label, value, meta, action, class: className = '' }: Props = $props();
</script>

<div class="space-y-1 {className}" data-slot="hero-figure">
	<div class="flex min-h-7 items-center justify-between gap-2">
		<p class="text-sm text-muted-foreground">{label}</p>
		{@render action?.()}
	</div>
	<p class="text-4xl font-bold leading-tight tracking-tight tabular-nums lg:text-5xl">{value}</p>
	{#if meta}
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
			{@render meta()}
		</div>
	{/if}
</div>
