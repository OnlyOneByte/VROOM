<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import Segmented from '#lib/components/common/Segmented.svelte';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { CURRENCIES } from '#lib/constants/currencies.ts';
	import {
		currencyLabel,
		getCurrencySymbol,
		minorUnitScale,
		plainDecimal
	} from '#lib/utils/formatters.ts';
	import { landOn } from '#lib/utils/focus.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.ts';

	type Distance = 'miles' | 'kilometers';
	type Volume = 'gallons_us' | 'gallons_uk' | 'liters';

	interface Props {
		distanceUnit: Distance;
		volumeUnit: Volume;
		chargeUnit: 'kwh';
		currencyUnit: string;
		businessMileageRate?: number;
		onUnitsChange?: () => void;
		onCurrencyChange?: () => void;
		onRateChange?: () => void;
	}

	let {
		distanceUnit = $bindable(),
		volumeUnit = $bindable(),
		chargeUnit = $bindable(),
		currencyUnit = $bindable(),
		businessMileageRate = $bindable(0),
		onUnitsChange,
		onCurrencyChange,
		onRateChange
	}: Props = $props();

	const RATE_ANCHOR = 'business-mileage-rate';
	let rateInput = $state<HTMLInputElement | null>(null);
	let rateDraft = $state('');
	let rateEditing = $state(false);
	let rateError = $state<string | null>(null);
	let perUnit = $derived(distanceUnit === 'kilometers' ? 'km' : 'mile');

	$effect.pre(() => {
		if (!rateEditing && !rateError) {
			rateDraft = businessMileageRate > 0 ? plainDecimal(businessMileageRate) : '';
		}
	});

	const MAX_RATE = 1_000_000;

	function rateProblem(text: string): string | null {
		if (text === '') return null;
		const wholeCurrency = minorUnitScale(currencyUnit) === 1;
		if (wholeCurrency && /^[1-9]\d{0,2}[.,]\d{3}$/.test(text)) {
			return 'Leave out thousands separators';
		}
		if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return 'Use a number like 0.67';
		if (Number(text.replace(',', '.')) > MAX_RATE) return 'Use 1000000 or less';
		return null;
	}

	function commitRate() {
		const text = rateDraft.trim();
		if (businessMileageRate > 0 && text === plainDecimal(businessMileageRate)) {
			rateError = null;
			return;
		}
		rateError = rateProblem(text);
		if (rateError) return;
		const value = text === '' ? 0 : Number(text.replace(',', '.'));
		if (value === businessMileageRate) return;
		businessMileageRate = value;
		onRateChange?.();
	}

	let stopLanding: (() => void) | undefined;
	onDestroy(() => stopLanding?.());
	onMount(() => {
		if (location.hash === `#${RATE_ANCHOR}` && rateInput) stopLanding = landOn(rateInput);
	});

	const DISTANCES: { value: Distance; label: string }[] = [
		{ value: 'miles', label: 'Miles' },
		{ value: 'kilometers', label: 'Kilometers' }
	];
	const VOLUMES: { value: Volume; label: string }[] = [
		{ value: 'gallons_us', label: 'US gal' },
		{ value: 'gallons_uk', label: 'UK gal' },
		{ value: 'liters', label: 'Liters' }
	];

	const currencyCodes: readonly string[] = $derived(
		(CURRENCIES as readonly string[]).includes(currencyUnit)
			? CURRENCIES
			: [currencyUnit, ...CURRENCIES]
	);

	let pendingCurrency = $state<string | null>(null);
	let confirmOpen = $state(false);
	let shownCurrency = $state('');

	$effect.pre(() => {
		if (!confirmOpen) shownCurrency = currencyUnit;
	});

	function applyCurrency(code: string) {
		currencyUnit = code;
		onCurrencyChange?.();
	}

	function chooseCurrency(code: string) {
		if (!code || code === currencyUnit) return;
		if (minorUnitScale(code) < minorUnitScale(currencyUnit)) {
			pendingCurrency = code;
			confirmOpen = true;
			return;
		}
		applyCurrency(code);
	}
</script>

<Card variant="section">
	<CardHeader>
		<CardTitle level={2} class="text-base">Units and currency</CardTitle>
	</CardHeader>
	<CardContent>
		<p class="text-sm text-muted-foreground">
			Defaults for new vehicles, and the units for totals across vehicles. Changes save right away;
			a currency without cents asks first.
		</p>
		<div class="divide-y">
			<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
				<p class="font-medium">Distance</p>
				<Segmented
					label="Distance"
					value={distanceUnit}
					options={DISTANCES}
					onValueChange={v => {
						distanceUnit = v;
						onUnitsChange?.();
					}}
				/>
			</div>
			<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
				<div>
					<p class="font-medium">Fuel</p>
					<p class="text-sm text-muted-foreground">For gas and diesel vehicles</p>
				</div>
				<Segmented
					label="Fuel"
					value={volumeUnit}
					options={VOLUMES}
					onValueChange={v => {
						volumeUnit = v;
						onUnitsChange?.();
					}}
				/>
			</div>
			<div class="flex items-center justify-between gap-4 py-3" data-testid="charge-unit">
				<div>
					<p class="font-medium">Charging</p>
					<p class="text-sm text-muted-foreground">For electric and hybrid vehicles</p>
				</div>
				<span class="text-sm font-semibold">{chargeUnit === 'kwh' ? 'kWh' : chargeUnit}</span>
			</div>
			<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
				<label for="currency" class="font-medium">Currency</label>
				<Select.Root type="single" bind:value={shownCurrency} onValueChange={chooseCurrency}>
					<Select.Trigger id="currency" class="w-full max-w-xs sm:w-auto">
						{currencyLabel(currencyUnit)}
					</Select.Trigger>
					<Select.Content>
						{#each currencyCodes as code (code)}
							<Select.Item value={code} label={currencyLabel(code)}>
								{currencyLabel(code)}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
				<div class="min-w-0 flex-1 basis-48">
					<label for={RATE_ANCHOR} class="font-medium">Business mileage rate</label>
					<p id="{RATE_ANCHOR}-help" class="text-sm text-muted-foreground">
						{getCurrencySymbol(currencyUnit)} per {perUnit}, to value your business trips. Leave
						empty to turn it off.
					</p>
				</div>
				<div class="w-full space-y-1 sm:w-32 sm:shrink-0">
					<Input
						id={RATE_ANCHOR}
						bind:ref={rateInput}
						bind:value={rateDraft}
						inputmode="decimal"
						autocomplete="off"
						placeholder="0.67"
						aria-describedby="{RATE_ANCHOR}-help{rateError ? ` ${RATE_ANCHOR}-error` : ''}"
						aria-invalid={rateError ? true : undefined}
						onfocus={() => (rateEditing = true)}
						onblur={() => (rateEditing = false)}
						onchange={commitRate}
					/>
					{#if rateError}
						<FormFieldError id="{RATE_ANCHOR}-error">{rateError}</FormFieldError>
					{/if}
				</div>
			</div>
		</div>
	</CardContent>
</Card>

<ConfirmDialog
	bind:open={confirmOpen}
	title={pendingCurrency ? `Switch to ${currencyLabel(pendingCurrency)}?` : ''}
	description="This currency has no cents, so every amount you've recorded is rounded to a whole number. Switching back later won't bring the cents back."
	confirmLabel="Switch and round"
	onConfirm={() => {
		if (pendingCurrency) applyCurrency(pendingCurrency);
	}}
/>
