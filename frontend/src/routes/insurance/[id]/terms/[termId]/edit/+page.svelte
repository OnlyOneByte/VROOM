<script lang="ts">
	import { page } from '$app/state';
	import InsuranceTermForm from '$lib/components/insurance/form/InsuranceTermForm.svelte';

	let policyId = $derived(page.params.id ?? '');
	let termId = $derived(page.params.termId ?? '');
	let returnTo = $derived(page.url.searchParams.get('returnTo') || '/insurance');
</script>

<svelte:head>
	<title>Edit Term - VROOM Car Tracker</title>
</svelte:head>

<InsuranceTermForm {policyId} {termId} {returnTo} />
