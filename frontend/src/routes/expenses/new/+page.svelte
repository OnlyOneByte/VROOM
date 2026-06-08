<script lang="ts">
	import { page } from '$app/state';
	import ExpenseForm from '$lib/components/expenses/form/ExpenseForm.svelte';

	let returnTo = $derived(page.url.searchParams.get('returnTo') || '/expenses');
	let preselectedVehicleId = $derived(page.url.searchParams.get('vehicleId'));
	let preselectedCategory = $derived(page.url.searchParams.get('category'));
	let preselectedFinancingId = $derived(page.url.searchParams.get('financingId'));
	let preselectedAmount = $derived(page.url.searchParams.get('amount'));
	let preselectedDescription = $derived(page.url.searchParams.get('description'));
	// Tags arrive as a comma-separated list (from "Duplicate expense").
	let preselectedTags = $derived(page.url.searchParams.get('tags'));
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
	{preselectedDescription}
	{preselectedTags}
/>
