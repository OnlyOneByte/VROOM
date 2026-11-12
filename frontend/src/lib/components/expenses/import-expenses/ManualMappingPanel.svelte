<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import { FileText } from '@lucide/svelte';
	import type {
		ImportDateFormat,
		DistanceUnit,
		NativeImportField,
		Vehicle,
		VolumeUnit
	} from '#lib/types/index.ts';
	import { getDistanceUnitLabel, getVolumeUnitLabel } from '#lib/utils/units.ts';
	import TargetVehiclePicker from './TargetVehiclePicker.svelte';
	import type { ImportExpensesForm } from './import-expenses-form.svelte';

	interface Props {
		form: ImportExpensesForm;
		vehicles: Vehicle[];
	}

	let { form, vehicles }: Props = $props();

	const MAPPABLE_FIELDS: { field: NativeImportField; label: string; required?: boolean }[] = [
		{ field: 'date', label: 'Date', required: true },
		{ field: 'amount', label: 'Amount', required: true },
		{ field: 'category', label: 'Category' },
		{ field: 'vehicle', label: 'Vehicle' },
		{ field: 'mileage', label: 'Odometer' },
		{ field: 'volume', label: 'Volume' },
		{ field: 'fuelType', label: 'Fuel type' },
		{ field: 'description', label: 'Description' },
		{ field: 'tags', label: 'Tags' }
	];
	const DATE_FORMATS: { value: ImportDateFormat; label: string }[] = [
		{ value: 'iso', label: 'ISO (YYYY-MM-DD)' },
		{ value: 'mdy', label: 'US (MM/DD/YYYY)' },
		{ value: 'dmy', label: 'EU (DD/MM/YYYY)' },
		{ value: 'epoch', label: 'Unix timestamp' }
	];
	const DISTANCE_UNITS: DistanceUnit[] = ['miles', 'kilometers'];
	const VOLUME_UNITS: VolumeUnit[] = ['gallons_us', 'gallons_uk', 'liters'];
</script>

<div class="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
	<div class="flex items-center gap-2 text-sm font-medium text-foreground">
		<FileText class="h-4 w-4 text-muted-foreground" />
		Map your columns
	</div>
	<p class="text-xs text-muted-foreground">
		We didn't recognize this format. Match each VROOM field to a column from your file.
		<span class="text-foreground">Date</span> and
		<span class="text-foreground">Amount</span>
		are required.
	</p>

	<div class="space-y-2">
		{#each MAPPABLE_FIELDS as f (f.field)}
			<div class="flex items-center gap-2">
				<span class="w-28 shrink-0 text-xs text-muted-foreground">
					{f.label}{f.required ? ' *' : ''}
				</span>
				<Select.Root
					type="single"
					value={form.manualColumns[f.field] ?? ''}
					onValueChange={v => form.setManualColumn(f.field, v)}
				>
					<Select.Trigger class="h-8 flex-1 text-xs" data-testid="map-field-{f.field}">
						{form.manualColumns[f.field] || '— not mapped —'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="" label="— not mapped —">— not mapped —</Select.Item>
						{#each form.fileHeaders as h (h)}
							<Select.Item value={h} label={h}>{h}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/each}
	</div>

	<div class="flex items-center gap-2">
		<span class="w-28 shrink-0 text-xs text-muted-foreground">Date format</span>
		<Select.Root
			type="single"
			value={form.manualDateFormat}
			onValueChange={v => form.setManualDateFormat(v as ImportDateFormat)}
		>
			<Select.Trigger class="h-8 flex-1 text-xs">
				{DATE_FORMATS.find(d => d.value === form.manualDateFormat)?.label ?? form.manualDateFormat}
			</Select.Trigger>
			<Select.Content>
				{#each DATE_FORMATS as d (d.value)}
					<Select.Item value={d.value} label={d.label}>{d.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	{#if form.manualColumns.mileage}
		<div class="flex items-center gap-2">
			<span class="w-28 shrink-0 text-xs text-muted-foreground">Odometer unit</span>
			<Select.Root
				type="single"
				value={form.manualDistanceUnit}
				onValueChange={v => form.setManualDistanceUnit(v as DistanceUnit)}
			>
				<Select.Trigger class="h-8 flex-1 text-xs" data-testid="map-distance-unit">
					{getDistanceUnitLabel(form.manualDistanceUnit)}
				</Select.Trigger>
				<Select.Content>
					{#each DISTANCE_UNITS as u (u)}
						<Select.Item value={u} label={getDistanceUnitLabel(u)}>
							{getDistanceUnitLabel(u)}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	{#if form.manualColumns.volume}
		<div class="flex items-center gap-2">
			<span class="w-28 shrink-0 text-xs text-muted-foreground">Volume unit</span>
			<Select.Root
				type="single"
				value={form.manualVolumeUnit}
				onValueChange={v => form.setManualVolumeUnit(v as VolumeUnit)}
			>
				<Select.Trigger class="h-8 flex-1 text-xs" data-testid="map-volume-unit">
					{getVolumeUnitLabel(form.manualVolumeUnit)}
				</Select.Trigger>
				<Select.Content>
					{#each VOLUME_UNITS as u (u)}
						<Select.Item value={u} label={getVolumeUnitLabel(u)}>
							{getVolumeUnitLabel(u)}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	{#if !form.manualColumns.vehicle}
		<div class="space-y-1.5 border-t pt-3">
			<TargetVehiclePicker
				{vehicles}
				selectedId={form.targetVehicleId}
				triggerId="manual-target-vehicle"
				emptyText="Add a vehicle first to import."
				onSelect={id => form.changeTargetVehicle(id)}
			/>
		</div>
	{/if}
</div>
