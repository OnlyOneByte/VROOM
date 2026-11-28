<script module lang="ts">
	import { isElectricFuelType } from '#lib/utils/units.ts';

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
	import type { Snippet } from 'svelte';
	import { Fuel, Zap } from '@lucide/svelte';
	import Input from '#lib/components/ui/input/input.svelte';
	import Label from '#lib/components/ui/label/label.svelte';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		getVolumeUnitLabel,
		getChargeUnitLabel,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel,
		getDistanceUnitLabel,
		getVolumeUnitName
	} from '#lib/utils/units.ts';
	import { formatCurrency, formatNumber, formatNumberUpTo } from '#lib/utils/formatters.ts';
	import { QUICK_FIGURE_INPUT } from './expense-form/quick-classes';
	import type { VolumeUnit, ChargeUnit, DistanceUnit } from '#lib/types/index.ts';
	import { rateChargeEfficiency, rateFuelEfficiency } from './expense-form/mileage-efficiency';

	interface Props {
		trackFuel: boolean;
		trackCharging: boolean;
		volume: string;
		charge: string;
		fuelType: string;
		energyMode?: EnergyMode;
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
		odometer?: Snippet;
		quick?: boolean;
		distanceSinceLast?: number | null;
	}

	let {
		trackFuel,
		trackCharging,
		volume = $bindable(),
		charge = $bindable(),
		fuelType = $bindable(),
		energyMode = $bindable('fuel'),
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
		onMileageChange,
		odometer,
		quick = false,
		distanceSinceLast = null
	}: Props = $props();

	let quickReadout = $derived.by(() => {
		const parts: Array<{ figure: string; words: string }> = [];
		const quantity = parseFloat(charging ? charge : volume);
		const total = parseFloat(amount);
		if (quantity > 0 && total > 0) {
			const per = charging
				? `per ${getChargeUnitLabel(chargeUnit, true)}`
				: volumeUnit === 'gallons_uk'
					? 'a UK gallon'
					: `a ${getVolumeUnitName(volumeUnit).replace(/ \(.*\)$/, '')}`;
			parts.push({ figure: formatCurrency(total / quantity), words: per });
		}
		const ratio = charging ? calculatedEfficiency : calculatedMpg;
		if (efficiency && ratio) {
			parts.push({
				figure: formatNumberUpTo(ratio, 1),
				words: efficiency.text.split(' ').slice(1).join(' ')
			});
		}
		if (distanceSinceLast) {
			parts.push({
				figure: formatNumber(distanceSinceLast, 0),
				words: `${getDistanceUnitLabel(distanceUnit, true)} since last ${charging ? 'charge' : 'fill'}`
			});
		}
		return parts;
	});

	let seenCapabilities: EnergyCapabilities | null = null;

	let showToggle = $derived(trackFuel && trackCharging);
	let charging = $derived(energyMode === 'charging');

	let pricePerUnit = $derived.by(() => {
		const quantity = parseFloat(charging ? charge : volume);
		const total = parseFloat(amount);
		if (!(quantity > 0) || !(total > 0)) return null;
		const unit = charging
			? getChargeUnitLabel(chargeUnit, true)
			: getVolumeUnitLabel(volumeUnit, true);
		return `${formatCurrency(total / quantity, undefined, 3)}/${unit}`;
	});

	let efficiency = $derived.by(() => {
		if (!showMpgCalculation) return null;
		if (!charging && calculatedMpg) {
			return {
				text: `${calculatedMpg} ${getFuelEfficiencyLabel(distanceUnit, volumeUnit)}`,
				rating: rateFuelEfficiency(calculatedMpg, distanceUnit, volumeUnit),
				low: 'Low fuel efficiency - consider a maintenance check.',
				excellent: 'Excellent fuel efficiency!'
			};
		}
		if (charging && calculatedEfficiency) {
			return {
				text: `${calculatedEfficiency} ${getElectricEfficiencyLabel(distanceUnit, chargeUnit)}`,
				rating: rateChargeEfficiency(calculatedEfficiency, distanceUnit),
				low: 'Low efficiency - check driving conditions.',
				excellent: 'Excellent efficiency!'
			};
		}
		return null;
	});

	let readout = $derived(
		[pricePerUnit, efficiency ? `${efficiency.text} since last fill-up` : null]
			.filter(Boolean)
			.join(' · ')
	);

	function describedBy(field: 'volume' | 'charge'): string | undefined {
		const ids = [touched[field] && errors[field] ? `${field}-error` : null];
		if (quick ? quickReadout.length > 0 : readout) ids.push('energy-readout');
		return ids.filter(Boolean).join(' ') || undefined;
	}

	function applyEnergyModeFields(mode: EnergyMode) {
		const next = energyModeFields(mode, { volume, charge });
		volume = next.volume;
		charge = next.charge;
		fuelType = next.fuelType;
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

<div class={quick ? 'space-y-5' : 'space-y-3'}>
	<h2 class="sr-only">{charging ? 'Charging details' : 'Fuel details'}</h2>
	{#if showToggle}
		<div class="flex gap-1 rounded-lg bg-muted p-1">
			<Button
				variant={energyMode === 'fuel' ? 'default' : 'ghost'}
				size="sm"
				class="h-10 flex-1 gap-1.5 sm:h-8"
				aria-pressed={energyMode === 'fuel'}
				onclick={() => handleModeSwitch('fuel')}
			>
				<Fuel class="h-4 w-4" />
				Fuel
			</Button>
			<Button
				variant={energyMode === 'charging' ? 'default' : 'ghost'}
				size="sm"
				class="h-10 flex-1 gap-1.5 sm:h-8"
				aria-pressed={energyMode === 'charging'}
				onclick={() => handleModeSwitch('charging')}
			>
				<Zap class="h-4 w-4" />
				Charging
			</Button>
		</div>
	{/if}

	<div class={quick ? 'grid grid-cols-2 gap-4 sm:gap-6' : 'grid grid-cols-2 gap-3'}>
		{#if charging}
			<div class="min-w-0 space-y-2">
				<Label for="charge">{getChargeUnitLabel(chargeUnit)} *</Label>
				<Input
					id="charge"
					type="number"
					inputmode="decimal"
					step={0.01}
					min="0"
					bind:value={charge}
					placeholder="0.00"
					class={quick ? QUICK_FIGURE_INPUT : undefined}
					oninput={onMileageChange}
					onblur={() => onBlur('charge')}
					aria-invalid={!!(touched['charge'] && errors['charge'])}
					aria-describedby={describedBy('charge')}
				/>
				{#if touched['charge'] && errors['charge']}
					<FormFieldError id="charge-error">{errors['charge']}</FormFieldError>
				{/if}
			</div>
		{:else}
			<div class="min-w-0 space-y-2">
				<Label for="volume">{getVolumeUnitLabel(volumeUnit)} *</Label>
				<Input
					id="volume"
					type="number"
					inputmode="decimal"
					step="0.001"
					min="0"
					bind:value={volume}
					placeholder="0.000"
					class={quick ? QUICK_FIGURE_INPUT : undefined}
					oninput={onMileageChange}
					onblur={() => onBlur('volume')}
					aria-invalid={!!(touched['volume'] && errors['volume'])}
					aria-describedby={describedBy('volume')}
				/>
				{#if touched['volume'] && errors['volume']}
					<FormFieldError id="volume-error">{errors['volume']}</FormFieldError>
				{/if}
			</div>
		{/if}
		{@render odometer?.()}
	</div>

	{#if quick && quickReadout.length > 0}
		<div id="energy-readout" class="space-y-1 text-center" data-testid="energy-readout">
			<p class="flex flex-wrap justify-center text-muted-foreground tabular-nums">
				{#each quickReadout as part, i (part.words)}
					{#if i > 0}<span class="mx-1.5" aria-hidden="true">·</span>{/if}<span
						class="whitespace-nowrap"
					>
						<strong class="font-semibold text-foreground">{part.figure}</strong>
						{part.words}
					</span>
				{/each}
			</p>
			{#if efficiency?.rating === 'low'}
				<p class="text-sm text-foreground">{efficiency.low}</p>
			{:else if efficiency?.rating === 'excellent'}
				<p class="text-sm text-foreground">{efficiency.excellent}</p>
			{/if}
		</div>
	{:else if !quick && readout}
		<div
			id="energy-readout"
			class="space-y-1 text-xs text-muted-foreground"
			data-testid="energy-readout"
		>
			<p class="tabular-nums">{readout}</p>
			{#if efficiency?.rating === 'low'}
				<p class="text-foreground">{efficiency.low}</p>
			{:else if efficiency?.rating === 'excellent'}
				<p class="text-foreground">{efficiency.excellent}</p>
			{/if}
		</div>
	{/if}
</div>
