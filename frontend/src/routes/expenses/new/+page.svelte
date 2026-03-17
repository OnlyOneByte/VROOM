<script lang="ts">
	import { page } from '$app/state';
	import ExpenseForm from '$lib/components/expenses/form/ExpenseForm.svelte';

	let returnTo = $derived(page.url.searchParams.get('returnTo') || '/expenses');
	let preselectedVehicleId = $derived(page.url.searchParams.get('vehicleId'));
	let preselectedCategory = $derived(page.url.searchParams.get('category'));
	let preselectedFinancingId = $derived(page.url.searchParams.get('financingId'));
	let preselectedAmount = $derived(page.url.searchParams.get('amount'));
</script>

<svelte:head>
	<title>Add Expense - VROOM Car Tracker</title>
	<meta name="description" content="Add a new vehicle expense" />
</svelte:head>

<ExpenseForm
	{returnTo}
	{preselectedVehicleId}
	{preselectedCategory}
	{preselectedFinancingId}
	{preselectedAmount}
/>
