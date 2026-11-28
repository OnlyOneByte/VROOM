<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import { csvDelimiter, splitCsvLine } from '#lib/utils/import-mapping-helpers.ts';
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
	const SKIP = "Don't import";

	const examples = $derived(
		splitCsvLine(
			form.csvText
				.split('\n')
				.slice(1)
				.find(line => line.trim())
				?.trim() ?? '',
			csvDelimiter(form.csvText)
		)
	);
	const missing = $derived(
		MAPPABLE_FIELDS.filter(f => f.required && !form.manualColumns[f.field]).map(f => f.label)
	);

	const columns = $derived(
		form.fileHeaders.map((header, i) => ({ header, i })).filter(({ header }) => header)
	);

	function fieldFor(header: string) {
		if (!header) return undefined;
		return MAPPABLE_FIELDS.find(f => form.manualColumns[f.field] === header);
	}
</script>

<div class="space-y-3">
	<p class="text-sm text-muted-foreground">
		We didn't recognize this format. Match each column in your file to a VROOM field.
		<span class="text-foreground">Date</span> and
		<span class="text-foreground">Amount</span>
		are required.
	</p>

	<table class="w-full text-sm" data-testid="column-mapping">
		<thead>
			<tr class="border-b text-left text-xs text-muted-foreground">
				<th scope="col" class="py-2 pr-3 font-medium">Column in your file</th>
				<th scope="col" class="py-2 pr-3 font-medium">Example</th>
				<th scope="col" class="py-2 font-medium">VROOM field</th>
			</tr>
		</thead>
		<tbody>
			{#each columns as { header, i } (i)}
				{@const mapped = fieldFor(header)}
				<tr class="border-b">
					<th scope="row" class="py-2 pr-3 text-left font-normal break-words">
						<label for="map-column-{i}">{header}</label>
					</th>
					<td class="py-2 pr-3 break-words text-muted-foreground tabular-nums">
						{examples[i] ?? ''}
					</td>
					<td class="w-[45%] py-2">
						<Select.Root
							type="single"
							value={mapped?.field ?? ''}
							onValueChange={v => form.setColumnField(header, v as NativeImportField | '')}
						>
							<Select.Trigger id="map-column-{i}" class="w-full" data-testid="map-column-{i}">
								{mapped ? `${mapped.label}${mapped.required ? ' *' : ''}` : SKIP}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="" label={SKIP}>{SKIP}</Select.Item>
								{#each MAPPABLE_FIELDS as f (f.field)}
									<Select.Item value={f.field} label={f.label}>
										{f.label}{f.required ? ' *' : ''}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<p
		class="text-sm text-muted-foreground {missing.length > 0 ? '' : 'sr-only'}"
		role="status"
		data-testid="mapping-missing"
	>
		{missing.length > 0 ? `Still needed: ${missing.join(' and ')}` : ''}
	</p>

	{#if !form.manualColumns.category}
		<p class="text-sm text-muted-foreground" data-testid="mapping-misc-note">
			With no Category column, every row is filed as <span class="text-foreground">Misc</span>.
		</p>
	{/if}

	<div class="flex items-center gap-2">
		<label for="manual-date-format" class="w-32 shrink-0 text-sm text-muted-foreground">
			Date format
		</label>
		<Select.Root
			type="single"
			value={form.manualDateFormat}
			onValueChange={v => form.setManualDateFormat(v as ImportDateFormat)}
		>
			<Select.Trigger id="manual-date-format" class="flex-1">
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
			<label for="manual-distance-unit" class="w-32 shrink-0 text-sm text-muted-foreground">
				Odometer unit
			</label>
			<Select.Root
				type="single"
				value={form.manualDistanceUnit}
				onValueChange={v => form.setManualDistanceUnit(v as DistanceUnit)}
			>
				<Select.Trigger id="manual-distance-unit" class="flex-1" data-testid="map-distance-unit">
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
			<label for="manual-volume-unit" class="w-32 shrink-0 text-sm text-muted-foreground">
				Volume unit
			</label>
			<Select.Root
				type="single"
				value={form.manualVolumeUnit}
				onValueChange={v => form.setManualVolumeUnit(v as VolumeUnit)}
			>
				<Select.Trigger id="manual-volume-unit" class="flex-1" data-testid="map-volume-unit">
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
		<div class="space-y-1.5">
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
