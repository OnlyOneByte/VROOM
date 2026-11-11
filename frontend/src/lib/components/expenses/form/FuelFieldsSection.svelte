<script module lang="ts">
	import { isElectricFuelType } from '$lib/utils/units';

	export type EnergyMode = 'fuel' | 'charging';

	/** Charging-type option seeded into a form with no energy values yet — see reconcileEnergyMode. */
	export const DEFAULT_CHARGING_FUEL_TYPE = 'Electric';

	export interface EnergyCapabilities {
		canFuel: boolean;
		canCharge: boolean;
	}

	export interface EnergyModeDecision {
		/** The mode to show. */
		mode: EnergyMode;
		/** Mode whose fields to (re)apply, clearing the other mode's. `null` touches nothing. */
		applyFields: EnergyMode | null;
		/** fuelType to write into a form carrying no energy values yet. `null` writes nothing. */
		seedFuelType: string | null;
	}

	/**
	 * The volume/charge/fuelType values that entering `mode` implies. Clearing the other mode's
	 * value stops a stale volume riding along onto an EV charge row (and vice versa), and the
	 * fuelType it writes is what keeps requiredness pointed at the field the mode actually shows.
	 */
	export function energyModeFields(
		mode: EnergyMode,
		current: { volume: string; charge: string }
	): { volume: string; charge: string; fuelType: string } {
		return mode === 'charging'
			? { volume: '', charge: current.charge, fuelType: DEFAULT_CHARGING_FUEL_TYPE }
			: { volume: current.volume, charge: '', fuelType: '' };
	}

	/**
	 * Decide the energy mode for a vehicle's capabilities, given the mode on screen, the energy
	 * values on the form, and the capability pair that mode was last reconciled against (`seen`,
	 * `null` before the first run).
	 *
	 * The mode only chooses which INPUT is rendered. Requiredness comes from `fuelType` —
	 * ExpenseForm's `showVolumeField`/`showChargeField` read `formData.fuelType` and never this
	 * mode — so the invariant to hold is that the two AGREE. A disagreement either requires a
	 * HIDDEN field (validateForm fails on an error the user cannot see or clear) or saves the wrong
	 * unit (gallons plus an octane rating recorded against an EV; nothing downstream rejects it).
	 *
	 * `seen` must be COMPARED rather than assumed stale: the capability props compile to plain
	 * getters over ExpenseForm's `vehicle` state source (not memoized deriveds), and ExpenseForm
	 * reassigns `vehicle` more than once per load, so this runs again with IDENTICAL booleans.
	 * Clearing fields on such a run would wipe the expense being edited.
	 *
	 * Only the first run may write anything into an untouched form, and only when that form carries
	 * NO energy values: anything already there is either a row ExpenseForm loaded or something the
	 * user typed, and both outrank the vehicle's capabilities.
	 */
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

		// Same capabilities as last time: the vehicle did not change, so there is nothing to decide.
		if (seen && seen.canFuel === caps.canFuel && seen.canCharge === caps.canCharge) return stay;

		if (!seen) {
			// A fuelType that is already filled in decides the mode: it is what requiredness reads,
			// and rewriting it would destroy the value an edit-mode load just restored.
			if (fuelType) {
				return {
					mode: isElectricFuelType(fuelType) ? 'charging' : 'fuel',
					applyFields: null,
					seedFuelType: null
				};
			}
			// A quantity with no fuelType belongs to a row that already exists — edit mode mounts this
			// section only once loadExpense has filled formData, and `fuelType` is optional on this
			// form, so every Fuelio-imported fill-up arrives as a volume with an empty fuel_type.
			// Write nothing, and open the mode whose field an empty fuelType makes REQUIRED (volume),
			// which is also the one that keeps a loaded volume on screen.
			if (volume || charge) {
				return { mode: 'fuel', applyFields: null, seedFuelType: null };
			}
			// No energy values at all, so this is a new entry and the vehicle decides. A charge-only
			// vehicle also needs an electric fuelType seeded: without it validateForm requires the
			// HIDDEN volume field and the save silently does nothing.
			if (caps.canCharge && !caps.canFuel) {
				return { mode: 'charging', applyFields: null, seedFuelType: DEFAULT_CHARGING_FUEL_TYPE };
			}
			// Fuel mode is also where a vehicle tracking NEITHER lands: nothing says "electric", and
			// seeding one would file the row as a charge in the efficiency analytics.
			return { mode: 'fuel', applyFields: null, seedFuelType: null };
		}

		// The capabilities really did change, so clamp a mode the vehicle no longer supports — but
		// only onto one it DOES support. Both switches off is a real vehicle state (VehicleForm
		// toggles trackFuel/trackCharging independently and nothing forbids the pair); there is no
		// better mode to move to, and the mode on screen still agrees with fuelType, so its own
		// field stays the visible AND required one. Staying put is the correct no-op.
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

	// The mode is user-switchable (handleModeSwitch writes it), so it must stay mutable $state —
	// a $derived would destroy the toggle. It also can't be seeded from the capability props in
	// the initializer: ExpenseForm swaps its `vehicle` object under a STILL-MOUNTED section when
	// the user picks another vehicle, so a mode captured once survives onto a vehicle that doesn't
	// support it — gallons and an octane rating saved against an EV, since `showToggle` needs BOTH
	// flags and offers no way back to the kWh field. The effect below owns the initial resolution
	// and the clamp (MainSteering: "value is reset by an $effect").
	let energyMode = $state<EnergyMode>('fuel');
	// Bookkeeping for that effect rather than UI state, so a plain (non-reactive) let.
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

	// Shared by the explicit toggle and the capability clamp, so both clear the same way.
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

	// The writes at the bottom land on props this effect also reads, so it schedules itself again.
	// That run is a no-op purely because `seenCapabilities` now matches the incoming flags — the
	// `seen` comparison is what makes this converge instead of loop.
	$effect(() => {
		// Read both flags unconditionally so neither can be missed as a dependency.
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
				<strong>Price per {getVolumeUnitLabel(volumeUnit, true)}:</strong>
				{formatCurrency(parseFloat(amount) / parseFloat(volume), undefined, 3)}
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
				<strong>Price per {getChargeUnitLabel(chargeUnit, true)}:</strong>
				{formatCurrency(parseFloat(amount) / parseFloat(charge), undefined, 3)}
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
					{#each CHARGING_TYPE_OPTIONS as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	<!-- Efficiency display -->
	{#if showMpgCalculation}
		{#if calculatedMpg && energyMode === 'fuel'}
			<!-- Color stays on the icon (graphical, exempt); the TEXT is text-foreground.
			     chart-2/chart-5 small text on this bg-chart-2/10 tint fails WCAG AA
			     (~3.1:1); the ✅/⚠️ glyph carries the good/poor signal. -->
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
