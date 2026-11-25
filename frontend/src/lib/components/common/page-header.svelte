<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string | Snippet | undefined;
		back?: Snippet;
		actions?: Snippet;
		variant?: 'default' | 'display';
	}

	let { title, description, back, actions, variant = 'default' }: Props = $props();
</script>

<div class="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-4">
	<div class="flex min-w-0 items-center gap-3 sm:grow sm:basis-[min-content]">
		{#if back}
			{@render back()}
		{/if}
		<div class="min-w-0">
			<h1
				tabindex="-1"
				class="{variant === 'display'
					? 'font-(family-name:--font-fig) text-4xl leading-none uppercase lg:text-5xl'
					: 'text-3xl tracking-tight'} font-bold break-words rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				{title}
			</h1>
			{#if typeof description === 'function'}
				<p class="text-muted-foreground mt-1 max-sm:short:hidden">{@render description()}</p>
			{:else if description}
				<p class="text-muted-foreground mt-1 max-sm:short:hidden">{description}</p>
			{/if}
		</div>
	</div>
	{#if actions}
		<div class="contents lg:flex lg:shrink-0 lg:items-center lg:gap-2">
			{@render actions()}
		</div>
	{/if}
</div>
