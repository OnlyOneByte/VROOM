<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import SplitConfigEditor from './SplitConfigEditor.svelte';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import type { Vehicle } from '$lib/types';

	interface Props {
		open: boolean;
		vehicles: Vehicle[];
		selectedVehicleIds: string[];
		splitMethod: 'even' | 'absolute' | 'percentage';
		allocations: Array<{ vehicleId: string; amount?: number; percentage?: number }>;
		totalAmount: number;
		onVehicleIdsChange: (_ids: string[]) => void;
		onMethodChange: (_method: 'even' | 'absolute' | 'percentage') => void;
		onAllocationsChange: (
			_allocs: Array<{ vehicleId: string; amount?: number; percentage?: number }>
		) => void;
		onClose: () => void;
	}

	let {
		open = $bindable(),
		vehicles,
		selectedVehicleIds,
		splitMethod,
		allocations,
		totalAmount,
		onVehicleIdsChange,
		onMethodChange,
		onAllocationsChange,
		onClose
	}: Props = $props();

	let splitVehicles = $derived(vehicles.filter(v => selectedVehicleIds.includes(v.id)));

	function handleVehicleChange(ids: string[]) {
		onVehicleIdsChange(ids);
	}
</script>

<Dialog.Root bind:open onOpenChange={isOpen => !isOpen && onClose()}>
	<Dialog.Content class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<GitBranch class="h-5 w-5" />
				Split Cost
			</Dialog.Title>
			<Dialog.Description>Choose vehicles and how to divide the cost</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-5 py-2">
			<!-- Vehicle multi-select dropdown -->
			<div class="space-y-2">
				<p class="text-sm font-medium text-foreground">Vehicles</p>
				<Select.Root type="multiple" value={selectedVehicleIds} onValueChange={handleVehicleChange}>
					<Select.Trigger class="w-full">
						{#if selectedVehicleIds.length === 0}
							Select vehicles...
						{:else}
							{selectedVehicleIds.length} of {vehicles.length} vehicles
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each vehicles as v (v.id)}
							<Select.Item value={v.id} label={getVehicleDisplayName(v)}>
								{getVehicleDisplayName(v)}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Split config editor -->
			{#if splitVehicles.length >= 2}
				<SplitConfigEditor
					vehicles={splitVehicles}
					{totalAmount}
					{splitMethod}
					{allocations}
					{onMethodChange}
					{onAllocationsChange}
				/>
			{:else}
				<div class="rounded-lg border border-dashed border-border p-6 text-center">
					<p class="text-sm text-muted-foreground">
						Select at least 2 vehicles to configure the split
					</p>
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => {
					open = false;
					onClose();
				}}
			>
				Done
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
