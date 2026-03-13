<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
	import { MapPin } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import EmptyState from '$lib/components/common/empty-state.svelte';
</script>

<svelte:head>
	<title>Trips - VROOM Car Tracker</title>
	<meta name="description" content="Track and manage your vehicle trips" />
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Trips</h1>
		<p class="text-muted-foreground">Track mileage and trips across your vehicles</p>
	</div>

	<EmptyState>
		{#snippet icon()}
			<MapPin class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			Trips Coming Soon
		{/snippet}
		{#snippet description()}
			Trip tracking features are under development. You'll be able to log trips, track mileage, and
			analyze driving patterns across your vehicles.
		{/snippet}
		{#snippet action()}
			<Button href={resolve(routes.dashboard)}>Back to Dashboard</Button>
		{/snippet}
	</EmptyState>
</div>
