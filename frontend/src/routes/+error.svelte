<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { CircleAlert, Map } from '@lucide/svelte';
	import { routes } from '#lib/routes.ts';
	import { Button } from '#lib/components/ui/button/index.ts';

	let notFound = $derived(page.status === 404);
	let pageTitle = $derived(notFound ? 'Page Not Found' : 'Page Unavailable');
</script>

<svelte:head>
	<title>{pageTitle} - VROOM Car Tracker</title>
</svelte:head>

<div class="grid justify-items-center gap-2.5 px-5 py-12 text-center">
	<div
		class="mb-1.5 grid size-[120px] place-items-center rounded-full bg-surface text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]"
		aria-hidden="true"
	>
		{#if notFound}
			<Map class="size-[52px]" />
		{:else}
			<CircleAlert class="size-[52px]" />
		{/if}
	</div>
	<h1
		class="font-(family-name:--font-fig) text-[34px] leading-none font-bold uppercase tracking-[0.02em]"
	>
		{notFound ? 'Wrong turn' : "This page couldn't load"}
	</h1>
	<p class="max-w-[42ch] text-muted-foreground">
		{notFound
			? 'This page doesn’t exist, or the vehicle was removed.'
			: 'Try again in a moment, or go back to your dashboard.'}
	</p>
	<div class="mt-2 flex flex-wrap justify-center gap-2.5">
		{#if !notFound}
			<Button variant="outline" onclick={() => location.reload()}>Retry</Button>
		{/if}
		<Button href={resolve(routes.dashboard)}>Go to the dashboard</Button>
	</div>
</div>
