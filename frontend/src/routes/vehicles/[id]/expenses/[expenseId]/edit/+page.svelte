<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	const vehicleId = $page.params.id;
	const expenseId = $page.params.expenseId;

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
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
		<p class="text-gray-600">Loading...</p>
	</div>
</div>
