<script lang="ts">
	import { LoaderCircle, Sparkles } from '@lucide/svelte';
	import type { ImportMappingPreset } from '$lib/types/import-mapping';
	import type { Vehicle } from '$lib/types';
	import TargetVehiclePicker from './TargetVehiclePicker.svelte';

	interface Props {
		isDetecting: boolean;
		preset: ImportMappingPreset | null;
		vehicles: Vehicle[];
		targetVehicleId: string;
		onVehicleChange: (_id: string) => void;
	}

	let { isDetecting, preset, vehicles, targetVehicleId, onVehicleChange }: Props = $props();
</script>

{#if isDetecting}
	<div class="flex items-center gap-2 py-1 text-sm text-muted-foreground">
		<LoaderCircle class="h-4 w-4 animate-spin" />
		Detecting format…
	</div>
{:else if preset}
	<div class="space-y-3 rounded-lg border border-chart-2/40 bg-chart-2/5 p-4">
		<div class="flex items-center gap-2 text-sm font-medium text-foreground">
			<Sparkles class="h-4 w-4 text-chart-2" />
			Detected a <span class="font-semibold">{preset.label}</span> fuel log
		</div>
		<p class="text-xs text-muted-foreground">
			Columns, units, and date format are mapped automatically. This file has no vehicle column, so
			choose which vehicle these entries belong to.
		</p>
		<div class="space-y-1.5">
			<TargetVehiclePicker
				{vehicles}
				selectedId={targetVehicleId}
				triggerId="import-target-vehicle"
				emptyText="Add a vehicle first to import a fuel log."
				onSelect={onVehicleChange}
			/>
		</div>
	</div>
{/if}
