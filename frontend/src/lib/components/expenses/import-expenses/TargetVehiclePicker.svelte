<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import type { Vehicle } from '#lib/types/index.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';

	interface Props {
		vehicles: Vehicle[];
		selectedId: string;
		triggerId: string;
		emptyText: string;
		onSelect: (_id: string) => void;
	}

	let { vehicles, selectedId, triggerId, emptyText, onSelect }: Props = $props();

	let selected = $derived(vehicles.find(v => v.id === selectedId));
</script>

<label for={triggerId} class="text-xs font-medium text-foreground">Import into vehicle *</label>
{#if vehicles.length === 0}
	<p class="text-sm text-muted-foreground">{emptyText}</p>
{:else}
	<Select.Root type="single" value={selectedId} onValueChange={onSelect}>
		<Select.Trigger id={triggerId} class="w-full">
			{selected ? getVehicleDisplayName(selected) : 'Select a vehicle'}
		</Select.Trigger>
		<Select.Content>
			{#each vehicles as v (v.id)}
				<Select.Item value={v.id} label={getVehicleDisplayName(v)}>
					{getVehicleDisplayName(v)}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/if}
