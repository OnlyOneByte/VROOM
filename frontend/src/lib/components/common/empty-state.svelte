<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import type { Snippet } from 'svelte';

	interface Props {
		/** Optional icon snippet to display above the title */
		icon?: Snippet;
		/** Title snippet for the empty state */
		title: Snippet;
		/** Description snippet explaining the empty state */
		description: Snippet;
		/** Optional action snippet (typically a button) */
		action?: Snippet;
		/** Additional CSS classes */
		class?: string;
	}

	let { icon, title, description, action, class: className = '' }: Props = $props();
</script>

<Card class={className}>
	<CardContent class="flex flex-col items-center justify-center py-12">
		{#if icon}
			{@render icon()}
		{/if}
		<h3 class="text-lg font-semibold mb-2">
			{@render title()}
		</h3>
		<p class="text-muted-foreground text-center mb-4">
			{@render description()}
		</p>
		{#if action}
			{@render action()}
		{/if}
	</CardContent>
</Card>
