<script lang="ts">
	import { Fuel, Gauge, Zap } from 'lucide-svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import * as Select from '$lib/components/ui/select';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import {
		getVolumeUnitLabel,
		getChargeUnitLabel,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel
	} from '$lib/utils/units';
	import type { VolumeUnit, ChargeUnit, DistanceUnit } from '$lib/types';

	interface Props {
		vehicleType: 'gas' | 'electric' | 'hybrid';
		volume: string;
		charge: string;
		fuelType: string;
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
		vehicleType,
		volume = $bindable(),
		charge = $bindable(),
		fuelType = $bindable(),
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

	let showCustomFuelType = $state(false);

	let showVolumeField = $derived(vehicleType === 'gas' || vehicleType === 'hybrid');
	let showChargeField = $derived(vehicleType === 'electric' || vehicleType === 'hybrid');

	const FUEL_TYPE_OPTIONS = [
		{ value: '87 (Regular)', label: '87 (Regular)' },
		{ value: '89 (Mid-Grade)', label: '89 (Mid-Grade)' },
		{ value: '91 (Premium)', label: '91 (Premium)' },
		{ value: '93 (Super Premium)', label: '93 (Super Premium)' },
		{ value: 'Diesel', label: 'Diesel' },
		{ value: 'Ethanol-Free', label: 'Ethanol-Free' },
		{ value: 'other', label: 'Other (Custom)' }
	];
</script>

<div class="p-4 bg-blue-50 rounded-lg space-y-4">
	<div class="flex items-center gap-2 text-blue-700">
		{#if vehicleType === 'electric'}
			<Zap class="h-5 w-5" />
			<h3 class="font-medium">Charging Details</h3>
		{:else}
			<Fuel class="h-5 w-5" />
			<h3 class="font-medium">Fuel Details</h3>
		{/if}
	</div>

	{#if showVolumeField}
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

		<!-- Fuel Type -->
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

	{#if showChargeField}
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
	{/if}

	{#if showMpgCalculation}
		{#if calculatedMpg && showVolumeField}
			<div class="bg-green-50 border border-green-200 rounded-lg p-3">
				<div class="flex items-center gap-2 text-green-700">
					<Gauge class="h-4 w-4" />
					<span class="text-sm font-medium">
						Calculated: {calculatedMpg}
						{getFuelEfficiencyLabel(distanceUnit, volumeUnit)}
					</span>
				</div>
				{#if calculatedMpg < 15}
					<p class="text-xs text-orange-600 mt-1">
						⚠️ Low fuel efficiency - consider maintenance check
					</p>
				{:else if calculatedMpg > 50}
					<p class="text-xs text-green-600 mt-1">✅ Excellent fuel efficiency!</p>
				{/if}
			</div>
		{:else if calculatedEfficiency && showChargeField}
			<div class="bg-green-50 border border-green-200 rounded-lg p-3">
				<div class="flex items-center gap-2 text-green-700">
					<Zap class="h-4 w-4" />
					<span class="text-sm font-medium">
						Calculated: {calculatedEfficiency}
						{getElectricEfficiencyLabel(distanceUnit, chargeUnit)}
					</span>
				</div>
				{#if calculatedEfficiency < 2}
					<p class="text-xs text-orange-600 mt-1">⚠️ Low efficiency - check driving conditions</p>
				{:else if calculatedEfficiency > 4}
					<p class="text-xs text-green-600 mt-1">✅ Excellent efficiency!</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>
