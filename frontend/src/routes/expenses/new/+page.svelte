<script lang="ts">
	import { page } from '$app/stores';
	import ExpenseForm from '$lib/components/expenses/ExpenseForm.svelte';

	let returnTo = $derived($page.url.searchParams.get('returnTo') || '/expenses');
	let preselectedVehicleId = $derived($page.url.searchParams.get('vehicleId'));
</script>

<svelte:head>
	<title>Add Expense - VROOM Car Tracker</title>
	<meta name="description" content="Add a new vehicle expense" />
</svelte:head>

<ExpenseForm {returnTo} {preselectedVehicleId} />
