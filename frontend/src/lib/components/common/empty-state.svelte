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
		<!-- `h2`, not `h3`: this card is a top-level region of whatever page renders it, so it sits
		     directly under that page's `h1`. An `h3` here skips a level, which is both an axe
		     `heading-order` failure and a screen-reader outline with a hole in it. Nothing inside
		     the card is a heading, so there is no level below this to preserve. -->
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
