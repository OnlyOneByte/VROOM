<script module lang="ts">
	import { isElectricFuelType } from '$lib/utils/units';

	export type EnergyMode = 'fuel' | 'charging';

	export const DEFAULT_CHARGING_FUEL_TYPE = 'Electric';

	export interface EnergyCapabilities {
		canFuel: boolean;
		canCharge: boolean;
	}

	export interface EnergyModeDecision {
		mode: EnergyMode;
		applyFields: EnergyMode | null;
		seedFuelType: string | null;
	}

	export function energyModeFields(
		mode: EnergyMode,
		current: { volume: string; charge: string }
	): { volume: string; charge: string; fuelType: string } {
		return mode === 'charging'
			? { volume: '', charge: current.charge, fuelType: DEFAULT_CHARGING_FUEL_TYPE }
			: { volume: current.volume, charge: '', fuelType: '' };
	}

	export function reconcileEnergyMode(current: {
		mode: EnergyMode;
		seen: EnergyCapabilities | null;
		caps: EnergyCapabilities;
		fuelType: string;
		volume: string;
		charge: string;
	}): EnergyModeDecision {
		const { mode, seen, caps, fuelType, volume, charge } = current;
		const stay: EnergyModeDecision = { mode, applyFields: null, seedFuelType: null };

		if (seen && seen.canFuel === caps.canFuel && seen.canCharge === caps.canCharge) return stay;

		if (!seen) {
			if (fuelType) {
				return {
					mode: isElectricFuelType(fuelType) ? 'charging' : 'fuel',
					applyFields: null,
					seedFuelType: null
				};
			}
			if (volume || charge) {
				return { mode: 'fuel', applyFields: null, seedFuelType: null };
			}
			if (caps.canCharge && !caps.canFuel) {
				return { mode: 'charging', applyFields: null, seedFuelType: DEFAULT_CHARGING_FUEL_TYPE };
			}
			return { mode: 'fuel', applyFields: null, seedFuelType: null };
		}

		if (mode === 'fuel' && !caps.canFuel && caps.canCharge) {
			return { mode: 'charging', applyFields: 'charging', seedFuelType: null };
		}
		if (mode === 'charging' && !caps.canCharge && caps.canFuel) {
			return { mode: 'fuel', applyFields: 'fuel', seedFuelType: null };
		}
		return stay;
	}
</script>

<script lang="ts">
	import { Fuel, Gauge, Zap } from '@lucide/svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import * as Select from '$lib/components/ui/select';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Button } from '$lib/components/ui/button';
	import {
		getVolumeUnitLabel,
		getChargeUnitLabel,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel
	} from '$lib/utils/units';
	import { formatCurrency } from '$lib/utils/formatters';
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

	let energyMode = $state<EnergyMode>('fuel');
	let seenCapabilities: EnergyCapabilities | null = null;

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

	function applyEnergyModeFields(mode: EnergyMode) {
		const next = energyModeFields(mode, { volume, charge });
		volume = next.volume;
		charge = next.charge;
		fuelType = next.fuelType;
		showCustomFuelType = false;
	}

	function handleModeSwitch(mode: EnergyMode) {
		if (mode === energyMode) return;
		energyMode = mode;
		applyEnergyModeFields(mode);
	}

	$effect(() => {
		const caps: EnergyCapabilities = { canFuel: trackFuel, canCharge: trackCharging };
		const decision = reconcileEnergyMode({
			mode: energyMode,
			seen: seenCapabilities,
			caps,
			fuelType,
			volume,
			charge
		});
		seenCapabilities = caps;

		if (decision.mode !== energyMode) energyMode = decision.mode;
		if (decision.applyFields) {
			applyEnergyModeFields(decision.applyFields);
		} else if (decision.seedFuelType) {
			fuelType = decision.seedFuelType;
		}
	});
</script>

<div class="p-4 bg-primary/10 rounded-lg space-y-4">
	<div class="flex items-center gap-2 text-primary">
		{#if energyMode === 'charging'}
			<Zap class="h-5 w-5" />
			<h3 class="font-medium">Charging Details</h3>
		{:else}
			<Fuel class="h-5 w-5" />
			<h3 class="font-medium">Fuel Details</h3>
		{/if}
	</div>

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
				<strong>Price per {getVolumeUnitLabel(volumeUnit, true)}:</strong>
				{formatCurrency(parseFloat(amount) / parseFloat(volume), undefined, 3)}
			</div>
		{/if}

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
	{/if}

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
				<strong>Price per {getChargeUnitLabel(chargeUnit, true)}:</strong>
				{formatCurrency(parseFloat(amount) / parseFloat(charge), undefined, 3)}
			</div>
		{/if}

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

	{#if showMpgCalculation}
		{#if calculatedMpg && energyMode === 'fuel'}
			<div class="bg-chart-2/10 border border-chart-2/20 rounded-lg p-3">
				<div class="flex items-center gap-2 text-foreground">
					<Gauge class="h-4 w-4 text-chart-2" />
					<span class="text-sm font-medium">
						Calculated: {calculatedMpg}
						{getFuelEfficiencyLabel(distanceUnit, volumeUnit)}
					</span>
				</div>
				{#if calculatedMpg < 15}
					<p class="text-xs text-foreground mt-1">
						⚠️ Low fuel efficiency - consider maintenance check
					</p>
				{:else if calculatedMpg > 50}
					<p class="text-xs text-foreground mt-1">✅ Excellent fuel efficiency!</p>
				{/if}
			</div>
		{:else if calculatedEfficiency && energyMode === 'charging'}
			<div class="bg-chart-2/10 border border-chart-2/20 rounded-lg p-3">
				<div class="flex items-center gap-2 text-foreground">
					<Zap class="h-4 w-4 text-chart-2" />
					<span class="text-sm font-medium">
						Calculated: {calculatedEfficiency}
						{getElectricEfficiencyLabel(distanceUnit, chargeUnit)}
					</span>
				</div>
				{#if calculatedEfficiency < 2}
					<p class="text-xs text-foreground mt-1">⚠️ Low efficiency - check driving conditions</p>
				{:else if calculatedEfficiency > 4}
					<p class="text-xs text-foreground mt-1">✅ Excellent efficiency!</p>
				{/if}
			</div>
		{/if}
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
</div>
