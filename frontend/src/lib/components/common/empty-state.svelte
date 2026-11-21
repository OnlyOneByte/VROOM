<script lang="ts">
	import { Card, CardContent } from '#lib/components/ui/card/index.ts';
	import type { Snippet } from 'svelte';

	interface Props {
		icon?: Snippet;
		title: Snippet;
		description: Snippet;
		action?: Snippet;
		level?: 2 | 3 | 4;
		class?: string;
	}

	let { icon, title, description, action, level = 2, class: className = '' }: Props = $props();
</script>

<Card class={className}>
	<CardContent class="flex flex-col items-center justify-center py-12">
		{#if icon}
			{@render icon()}
		{/if}
		<svelte:element this={`h${level}`} class="text-lg font-semibold mb-2">
			{@render title()}
		</svelte:element>
		<p class="text-muted-foreground text-center mb-4">
			{@render description()}
		</p>
		{#if action}
			{@render action()}
		{/if}
	</CardContent>
</Card>
