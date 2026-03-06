<script lang="ts">
	import { ArrowLeft, Fuel } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
</script>

<svelte:head>
	<title>Fuel Efficiency Monitor - VROOM Car Tracker</title>
	<meta name="description" content="Monitor fuel efficiency and get alerts for your vehicles" />
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center space-x-4">
		<a
			href="/analytics"
			class="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
		>
			<ArrowLeft class="h-5 w-5 mr-1" />
			Back to Analytics
		</a>
	</div>

	<div>
		<h1 class="text-2xl font-bold text-foreground">Fuel Efficiency Monitor</h1>
		<p class="text-muted-foreground">Track and analyze fuel efficiency trends</p>
	</div>

	<EmptyState>
		{#snippet icon()}
			<Fuel class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			Fuel Efficiency Monitor Coming Soon
		{/snippet}
		{#snippet description()}
			Detailed fuel efficiency monitoring is under development. View per-vehicle fuel stats on each
			vehicle's detail page in the meantime.
		{/snippet}
		{#snippet action()}
			<Button href="/dashboard">Back to Dashboard</Button>
		{/snippet}
	</EmptyState>
</div>
