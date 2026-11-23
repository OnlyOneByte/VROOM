<script lang="ts">
	import Input from '#lib/components/ui/input/input.svelte';
	import Label from '#lib/components/ui/label/label.svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import type { EnergyMode } from './FuelFieldsSection.svelte';

	interface Props {
		energyMode: EnergyMode;
		fuelType: string;
		missedFillup: boolean;
		onBlur: (_field: string) => void;
	}

	let { energyMode, fuelType = $bindable(), missedFillup = $bindable(), onBlur }: Props = $props();

	let showCustomFuelType = $state(false);

	const FUEL_TYPE_OPTIONS = [
		{ value: '87 (Regular)', label: '87 (Regular)' },
		{ value: '89 (Mid-Grade)', label: '89 (Mid-Grade)' },
		{ value: '91 (Premium)', label: '91 (Premium)' },
		{ value: '93 (Super Premium)', label: '93 (Super Premium)' },
		{ value: 'Diesel', label: 'Diesel' },
		{ value: 'Ethanol-Free', label: 'Ethanol-Free' },
		{ value: 'other', label: 'Other (Custom)' }
	];

	const CHARGING_TYPE_OPTIONS = [
		{ value: 'Level 1 (Home)', label: 'Level 1 (Home)' },
		{ value: 'Level 2 (AC)', label: 'Level 2 (AC)' },
		{ value: 'DC Fast Charging', label: 'DC Fast Charging' },
		{ value: 'Electric', label: 'Electric' }
	];
</script>

{#if energyMode === 'fuel'}
	<div class="space-y-2">
		<Label for="fuelType">Fuel Type / Octane</Label>
		<Select.Root
			type="single"
			value={showCustomFuelType ? 'other' : fuelType || ''}
			onValueChange={v => {
				if (v === 'other') {
					showCustomFuelType = true;
					fuelType = '';
				} else {
					showCustomFuelType = false;
					fuelType = v || '';
				}
			}}
		>
			<Select.Trigger id="fuelType" class="w-full">
				{#if showCustomFuelType}
					Other (Custom)
				{:else if fuelType}
					{fuelType}
				{:else}
					Select fuel type (optional)
				{/if}
			</Select.Trigger>
			<Select.Content>
				{#each FUEL_TYPE_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	{#if showCustomFuelType}
		<div class="space-y-2">
			<Label for="customFuelType">Custom Fuel Type</Label>
			<Input
				id="customFuelType"
				type="text"
				placeholder="e.g., E85, E100 Race Fuel"
				bind:value={fuelType}
				onblur={() => onBlur('fuelType')}
			/>
		</div>
	{/if}
{:else}
	<div class="space-y-2">
		<Label for="fuelType">Charging Type</Label>
		<Select.Root
			type="single"
			value={fuelType || ''}
			onValueChange={v => {
				fuelType = v || '';
			}}
		>
			<Select.Trigger id="fuelType" class="w-full">
				{#if fuelType}
					{fuelType}
				{:else}
					Select charging type
				{/if}
			</Select.Trigger>
			<Select.Content>
				{#each CHARGING_TYPE_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
{/if}

<div class="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
	<Checkbox id="missedFillup" bind:checked={missedFillup} />
	<div>
		<label for="missedFillup" class="cursor-pointer text-sm font-medium leading-none">
			Missed previous fill-up
		</label>
		<p class="text-xs text-muted-foreground mt-1">
			Skip this entry in fuel efficiency calculations
		</p>
	</div>
</div>
