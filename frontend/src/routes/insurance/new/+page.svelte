<script lang="ts">
	import { page } from '$app/state';
	import InsurancePolicyForm from '$lib/components/insurance/InsurancePolicyForm.svelte';

	let preselectedVehicleId = $derived(page.url.searchParams.get('vehicleId'));
	let returnTo = $derived(page.url.searchParams.get('returnTo') || '/insurance');
</script>

<svelte:head>
	<title>New Insurance Policy - VROOM Car Tracker</title>
	<meta name="description" content="Add a new insurance policy" />
</svelte:head>

<InsurancePolicyForm {preselectedVehicleId} {returnTo} />
