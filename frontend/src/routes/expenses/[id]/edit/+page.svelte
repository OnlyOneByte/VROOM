<script lang="ts">
	import { page } from '$app/stores';
	import ExpenseForm from '$lib/components/expenses/ExpenseForm.svelte';

	let expenseId = $derived($page.params.id);
	let returnTo = $derived($page.url.searchParams.get('returnTo') || '/expenses');
</script>

<svelte:head>
	<title>Edit Expense - VROOM Car Tracker</title>
	<meta name="description" content="Edit vehicle expense" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
</svelte:head>

<ExpenseForm {expenseId} {returnTo} />
