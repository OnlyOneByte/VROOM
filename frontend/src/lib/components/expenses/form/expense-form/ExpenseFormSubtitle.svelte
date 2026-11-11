<script lang="ts">
	import { onlineStatus } from '$lib/stores/offline.svelte';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import type { Vehicle } from '$lib/types';

	interface Props {
		isEditMode: boolean;
		isGroupEditMode: boolean;
		selectedVehicleIds: string[];
		vehicles: Vehicle[];
		vehicle: Vehicle | null;
	}

	let { isEditMode, isGroupEditMode, selectedVehicleIds, vehicles, vehicle }: Props = $props();
</script>

{#if isGroupEditMode && selectedVehicleIds.length > 0}
	{selectedVehicleIds
		.map(id => {
			const v = vehicles.find(veh => veh.id === id);
			return v ? getVehicleDisplayName(v) : '';
		})
		.filter(Boolean)
		.join(', ')}
{:else if isEditMode}
	{getVehicleDisplayName(vehicle)}
{:else if !onlineStatus.current}
	<span class="text-chart-5">Offline mode - will sync when online</span>
{:else}
	Track a new vehicle expense
{/if}
