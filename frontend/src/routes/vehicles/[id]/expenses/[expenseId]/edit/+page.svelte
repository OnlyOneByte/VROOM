<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { LoaderCircle } from 'lucide-svelte';

	const vehicleId = page.params.id;
	const expenseId = page.params.expenseId;

	onMount(() => {
		// Redirect to the general expense edit form with return path
		goto(`/expenses/${expenseId}/edit?returnTo=/vehicles/${vehicleId}`);
	});
</script>

<svelte:head>
	<title>Edit Expense - VROOM Car Tracker</title>
</svelte:head>

<!-- Show a loading state while redirecting -->
<div class="flex items-center justify-center min-h-screen">
	<div class="text-center">
		<LoaderCircle class="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
		<p class="text-muted-foreground">Loading...</p>
	</div>
</div>
