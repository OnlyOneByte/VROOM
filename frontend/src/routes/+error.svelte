<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { CircleAlert, MapPinOff } from '@lucide/svelte';
	import { routes } from '#lib/routes.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';

	let notFound = $derived(page.status === 404);
	let pageTitle = $derived(notFound ? 'Page Not Found' : 'Page Unavailable');
</script>

<svelte:head>
	<title>{pageTitle} - VROOM Car Tracker</title>
</svelte:head>

<div class="space-y-6">
	<PageHeader title={pageTitle} />

	<EmptyState>
		{#snippet icon()}
			{#if notFound}
				<MapPinOff class="h-12 w-12 text-muted-foreground mb-4" aria-hidden="true" />
			{:else}
				<CircleAlert class="h-12 w-12 text-muted-foreground mb-4" aria-hidden="true" />
			{/if}
		{/snippet}
		{#snippet title()}
			{notFound ? "This page doesn't exist" : "This page couldn't load"}
		{/snippet}
		{#snippet description()}
			{notFound
				? 'The link may be old or the address mistyped. Your dashboard lists all your vehicles.'
				: 'Try again in a moment, or go back to your dashboard.'}
		{/snippet}
		{#snippet action()}
			<div class="flex flex-col sm:flex-row gap-3">
				{#if !notFound}
					<Button variant="outline" size="lg" onclick={() => location.reload()}>Try Again</Button>
				{/if}
				<Button size="lg" href={resolve(routes.dashboard)}>Go to Dashboard</Button>
			</div>
		{/snippet}
	</EmptyState>
</div>
