<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import type { Snippet } from 'svelte';

	interface Props {
		icon?: Snippet;
		title: Snippet;
		description: Snippet;
		action?: Snippet;
		class?: string;
	}

	let { icon, title, description, action, class: className = '' }: Props = $props();
</script>

<Card class={className}>
	<CardContent class="flex flex-col items-center justify-center py-12">
		{#if icon}
			{@render icon()}
		{/if}
		<!-- h2: the card is a top-level region of whatever page renders it. -->
		<h2 class="text-lg font-semibold mb-2">
			{@render title()}
		</h2>
		<p class="text-muted-foreground text-center mb-4">
			{@render description()}
		</p>
		{#if action}
			{@render action()}
		{/if}
	</CardContent>
</Card>
