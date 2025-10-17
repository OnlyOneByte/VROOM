<script lang="ts">
	import { page } from '$app/stores';
	import VehicleForm from '$lib/components/vehicles/VehicleForm.svelte';

	let vehicleId = $derived($page.params.id);

	function getVehicleDisplayName(): string {
		return 'Vehicle';
	}
</script>

<svelte:head>
	<title>Edit {getVehicleDisplayName()} - VROOM Car Tracker</title>
	<meta name="description" content="Edit vehicle information" />
</svelte:head>

<VehicleForm {vehicleId} />
