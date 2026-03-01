<script lang="ts">
	import { BarChart3 } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
</script>

<svelte:head>
	<title>Analytics - VROOM Car Tracker</title>
	<meta name="description" content="Analyze your vehicle expenses and trends" />
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Analytics Dashboard</h1>
		<p class="text-muted-foreground">Visualize your spending patterns and trends</p>
	</div>

	<EmptyState>
		{#snippet icon()}
			<BarChart3 class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			Analytics Coming Soon
		{/snippet}
		{#snippet description()}
			Advanced analytics features are under development. In the meantime, view per-vehicle expense
			breakdowns and fuel efficiency charts on each vehicle's detail page.
		{/snippet}
		{#snippet action()}
			<Button href="/dashboard">Back to Dashboard</Button>
		{/snippet}
	</EmptyState>
</div>
