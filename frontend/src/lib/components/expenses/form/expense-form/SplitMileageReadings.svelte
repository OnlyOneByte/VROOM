<script lang="ts">
	import { Gauge } from '@lucide/svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import type { Vehicle } from '$lib/types';

	interface Props {
		vehicles: Vehicle[];
		selectedVehicleIds: string[];
		mileages: Record<string, string>;
		open?: boolean;
		onMileageInput: (_vehicleId: string, _value: string) => void;
	}

	let {
		vehicles,
		selectedVehicleIds,
		mileages,
		open = $bindable(false),
		onMileageInput
	}: Props = $props();
</script>

<div class="space-y-2">
	<button
		type="button"
		onclick={() => (open = !open)}
		class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
	>
		<span class="text-xs">{open ? '▾' : '▸'}</span>
		Add mileage readings (optional)
	</button>
	{#if open}
		<div class="rounded-md border border-input p-3 space-y-3">
			{#each selectedVehicleIds as vid (vid)}
				{@const v = vehicles.find(veh => veh.id === vid)}
				{#if v}
					<div class="space-y-1">
						<Label for="mileage-{vid}" class="text-xs">{getVehicleDisplayName(v)}</Label>
						<div class="relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
								<Gauge class="h-4 w-4 text-muted-foreground" />
							</div>
							<Input
								id="mileage-{vid}"
								type="number"
								min="0"
								value={mileages[vid] ?? ''}
								oninput={e => {
									const target = e.currentTarget;
									if (target instanceof HTMLInputElement) {
										onMileageInput(vid, target.value);
									}
								}}
								placeholder="Current mileage"
								class="pl-10 h-9 text-sm"
							/>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
