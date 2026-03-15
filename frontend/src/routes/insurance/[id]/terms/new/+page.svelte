<script lang="ts">
	import { page } from '$app/state';
	import InsuranceTermForm from '$lib/components/insurance/form/InsuranceTermForm.svelte';

	let policyId = $derived(page.params.id ?? '');
	let renewFrom = $derived(page.url.searchParams.get('renewFrom') ?? undefined);
	let returnTo = $derived(page.url.searchParams.get('returnTo') || '/insurance');
</script>

<svelte:head>
	<title>{renewFrom ? 'Renew Term' : 'Add Term'} - VROOM Car Tracker</title>
</svelte:head>

<InsuranceTermForm {policyId} {renewFrom} {returnTo} />
