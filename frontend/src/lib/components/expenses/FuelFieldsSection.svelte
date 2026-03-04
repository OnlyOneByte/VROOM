<script lang="ts">
	import { Fuel, Gauge, Zap } from 'lucide-svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import * as Select from '$lib/components/ui/select';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Button } from '$lib/components/ui/button';
	import {
		isElectricFuelType,
		getVolumeUnitLabel,
		getChargeUnitLabel,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel
	} from '$lib/utils/units';
	import type { VolumeUnit, ChargeUnit, DistanceUnit } from '$lib/types';

	interface Props {
		trackFuel: boolean;
		trackCharging: boolean;
		volume: string;
		charge: string;
		fuelType: string;
		missedFillup: boolean;
		amount: string;
		volumeUnit: VolumeUnit;
		chargeUnit: ChargeUnit;
		distanceUnit: DistanceUnit;
		calculatedMpg: number | null;
		calculatedEfficiency: number | null;
		showMpgCalculation: boolean;
		errors: Record<string, string | undefined>;
		touched: Record<string, boolean>;
		onBlur: (_field: string) => void;
		onMileageChange: () => void;
	}

	let {
		trackFuel,
		trackCharging,
		volume = $bindable(),
		charge = $bindable(),
		fuelType = $bindable(),
		missedFillup = $bindable(),
		amount,
		volumeUnit,
		chargeUnit,
		distanceUnit,
		calculatedMpg,
		calculatedEfficiency,
		showMpgCalculation,
		errors,
		touched,
		onBlur,
		onMileageChange
	}: Props = $props();

	// Derive initial energy mode from fuelType on edit, default to appropriate mode
	let energyMode = $state<'fuel' | 'charging'>(
		isElectricFuelType(fuelType) ? 'charging' : trackFuel ? 'fuel' : 'charging'
	);

	let showToggle = $derived(trackFuel && trackCharging);
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

	function handleModeSwitch(mode: 'fuel' | 'charging') {
		if (mode === energyMode) return;
		energyMode = mode;

		if (mode === 'charging') {
			// fuel → charging: clear volume and fuelType, set Electric default
			volume = '';
			fuelType = 'Electric';
			showCustomFuelType = false;
		} else {
			// charging → fuel: clear charge and fuelType
			charge = '';
			fuelType = '';
			showCustomFuelType = false;
		}
	}
</script>

<div class="p-4 bg-primary/10 rounded-lg space-y-4">
	<!-- Section header -->
	<div class="flex items-center gap-2 text-primary">
		{#if energyMode === 'charging'}
			<Zap class="h-5 w-5" />
			<h3 class="font-medium">Charging Details</h3>
		{:else}
			<Fuel class="h-5 w-5" />
			<h3 class="font-medium">Fuel Details</h3>
		{/if}
	</div>

	<!-- Energy mode toggle (only when both trackFuel and trackCharging are true) -->
	{#if showToggle}
		<div class="flex gap-1 rounded-lg bg-muted p-1">
			<Button
				variant={energyMode === 'fuel' ? 'default' : 'ghost'}
				size="sm"
				class="flex-1 gap-1.5"
				onclick={() => handleModeSwitch('fuel')}
			>
				<Fuel class="h-4 w-4" />
				Fuel
			</Button>
			<Button
				variant={energyMode === 'charging' ? 'default' : 'ghost'}
				size="sm"
				class="flex-1 gap-1.5"
				onclick={() => handleModeSwitch('charging')}
			>
				<Zap class="h-4 w-4" />
				Charging
			</Button>
		</div>
	{/if}

	<!-- Fuel mode fields -->
	{#if energyMode === 'fuel'}
		<div class="space-y-2">
			<Label for="volume">{getVolumeUnitLabel(volumeUnit)} *</Label>
			<Input
				id="volume"
				type="number"
				step="0.001"
				min="0"
				bind:value={volume}
				placeholder="0.000"
				oninput={onMileageChange}
				onblur={() => onBlur('volume')}
				aria-invalid={!!(touched['volume'] && errors['volume'])}
				aria-describedby={touched['volume'] && errors['volume'] ? 'volume-error' : undefined}
			/>
			{#if touched['volume'] && errors['volume']}
				<FormFieldError id="volume-error">{errors['volume']}</FormFieldError>
			{/if}
		</div>

		{#if volume && amount}
			<div class="text-sm text-muted-foreground">
				<strong>Price per {getVolumeUnitLabel(volumeUnit, true)}:</strong> ${(
					parseFloat(amount) / parseFloat(volume)
				).toFixed(3)}
			</div>
		{/if}

		<!-- Fuel Type dropdown -->
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
					{#each FUEL_TYPE_OPTIONS as option}
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
	{/if}

	<!-- Charging mode fields -->
	{#if energyMode === 'charging'}
		<div class="space-y-2">
			<Label for="charge">{getChargeUnitLabel(chargeUnit)} *</Label>
			<Input
				id="charge"
				type="number"
				step="0.01"
				min="0"
				bind:value={charge}
				placeholder="0.00"
				oninput={onMileageChange}
				onblur={() => onBlur('charge')}
				aria-invalid={!!(touched['charge'] && errors['charge'])}
				aria-describedby={touched['charge'] && errors['charge'] ? 'charge-error' : undefined}
			/>
			{#if touched['charge'] && errors['charge']}
				<FormFieldError id="charge-error">{errors['charge']}</FormFieldError>
			{/if}
		</div>

		{#if charge && amount}
			<div class="text-sm text-muted-foreground">
				<strong>Price per {getChargeUnitLabel(chargeUnit, true)}:</strong> ${(
					parseFloat(amount) / parseFloat(charge)
				).toFixed(3)}
			</div>
		{/if}

		<!-- Charging Type dropdown -->
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
					{#each CHARGING_TYPE_OPTIONS as option}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	<!-- Efficiency display -->
	{#if showMpgCalculation}
		{#if calculatedMpg && energyMode === 'fuel'}
			<div class="bg-chart-2/10 border border-chart-2/20 rounded-lg p-3">
				<div class="flex items-center gap-2 text-chart-2">
					<Gauge class="h-4 w-4" />
					<span class="text-sm font-medium">
						Calculated: {calculatedMpg}
						{getFuelEfficiencyLabel(distanceUnit, volumeUnit)}
					</span>
				</div>
				{#if calculatedMpg < 15}
					<p class="text-xs text-chart-5 mt-1">
						⚠️ Low fuel efficiency - consider maintenance check
					</p>
				{:else if calculatedMpg > 50}
					<p class="text-xs text-chart-2 mt-1">✅ Excellent fuel efficiency!</p>
				{/if}
			</div>
		{:else if calculatedEfficiency && energyMode === 'charging'}
			<div class="bg-chart-2/10 border border-chart-2/20 rounded-lg p-3">
				<div class="flex items-center gap-2 text-chart-2">
					<Zap class="h-4 w-4" />
					<span class="text-sm font-medium">
						Calculated: {calculatedEfficiency}
						{getElectricEfficiencyLabel(distanceUnit, chargeUnit)}
					</span>
				</div>
				{#if calculatedEfficiency < 2}
					<p class="text-xs text-chart-5 mt-1">⚠️ Low efficiency - check driving conditions</p>
				{:else if calculatedEfficiency > 4}
					<p class="text-xs text-chart-2 mt-1">✅ Excellent efficiency!</p>
				{/if}
			</div>
		{/if}
	{/if}

	<!-- Missed fill-up checkbox -->
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
</div>
