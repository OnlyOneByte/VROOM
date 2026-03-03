<script lang="ts">
	import { page } from '$app/state';
	import InsurancePolicyForm from '$lib/components/insurance/InsurancePolicyForm.svelte';

	let policyId = $derived(page.params.id);
	let returnTo = $derived(page.url.searchParams.get('returnTo') || '/insurance');
</script>

<svelte:head>
	<title>Edit Insurance Policy - VROOM Car Tracker</title>
	<meta name="description" content="Edit insurance policy details" />
</svelte:head>

<InsurancePolicyForm {policyId} {returnTo} />
