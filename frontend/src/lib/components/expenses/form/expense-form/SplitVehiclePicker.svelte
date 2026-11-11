<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import type { Vehicle } from '$lib/types';

	interface Props {
		vehicles: Vehicle[];
		selectedVehicleIds: string[];
		/** Editing an existing split group cannot drop back to a single vehicle. */
		showRemove: boolean;
		onToggle: (_vehicleId: string) => void;
		onRemoveSplit: () => void;
	}

	let { vehicles, selectedVehicleIds, showRemove, onToggle, onRemoveSplit }: Props = $props();
</script>

<div class="space-y-2">
	<Label>Vehicles *</Label>
	<div class="rounded-md border border-input p-3 space-y-2">
		{#each vehicles as v (v.id)}
			<label class="flex items-center gap-2 cursor-pointer">
				<Checkbox
					checked={selectedVehicleIds.includes(v.id)}
					onCheckedChange={() => onToggle(v.id)}
				/>
				<span class="text-sm text-foreground">{getVehicleDisplayName(v)}</span>
			</label>
		{/each}
	</div>
	{#if showRemove}
		<button
			type="button"
			onclick={onRemoveSplit}
			class="text-xs text-muted-foreground underline hover:text-foreground"
		>
			Remove split
		</button>
	{/if}
</div>
