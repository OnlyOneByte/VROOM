<script lang="ts">
	import { page } from '$app/state';
	import VehicleForm from '$lib/components/vehicles/VehicleForm.svelte';

	let vehicleId = $derived(page.params.id);
</script>

<svelte:head>
	<title>Edit Vehicle - VROOM Car Tracker</title>
	<meta name="description" content="Edit vehicle information" />
</svelte:head>

<VehicleForm {vehicleId} />
