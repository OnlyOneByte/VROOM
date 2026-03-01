<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	const vehicleId = page.params.id;

	onMount(() => {
		// Redirect to the general expense form with vehicleId pre-selected and return path
		goto(`/expenses/new?vehicleId=${vehicleId}&returnTo=/vehicles/${vehicleId}`);
	});
</script>

<svelte:head>
	<title>Add Expense - VROOM Car Tracker</title>
</svelte:head>

<!-- Show a loading state while redirecting -->
<div class="flex items-center justify-center min-h-screen">
	<div class="text-center">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
		<p class="text-muted-foreground">Loading...</p>
	</div>
</div>
