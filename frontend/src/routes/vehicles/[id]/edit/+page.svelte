<script lang="ts">
	import { page } from '$app/state';
	import VehicleForm from '#lib/components/vehicles/form/VehicleForm.svelte';

	let vehicleId = $derived(page.params.id);
</script>

<svelte:head>
	<title>Edit vehicle - VROOM Car Tracker</title>
	<meta name="description" content="Edit vehicle information" />
</svelte:head>

<VehicleForm {vehicleId} />
