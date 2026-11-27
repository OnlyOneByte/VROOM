<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import Segmented from '#lib/components/common/Segmented.svelte';
	import { CURRENCIES } from '#lib/constants/currencies.ts';
	import { currencyLabel, minorUnitScale } from '#lib/utils/formatters.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.ts';

	type Distance = 'miles' | 'kilometers';
	type Volume = 'gallons_us' | 'gallons_uk' | 'liters';

	interface Props {
		distanceUnit: Distance;
		volumeUnit: Volume;
		chargeUnit: 'kwh';
		currencyUnit: string;
		onUnitsChange?: () => void;
		onCurrencyChange?: () => void;
	}

	let {
		distanceUnit = $bindable(),
		volumeUnit = $bindable(),
		chargeUnit = $bindable(),
		currencyUnit = $bindable(),
		onUnitsChange,
		onCurrencyChange
	}: Props = $props();

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
			Defaults for new vehicles, and the units for totals across vehicles. Changes save right away.
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
				<Select.Root type="single" value={currencyUnit} onValueChange={chooseCurrency}>
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
		</div>
	</CardContent>
</Card>

<ConfirmDialog
	bind:open={confirmOpen}
	title={pendingCurrency ? `Switch to ${currencyLabel(pendingCurrency)}?` : ''}
	description={pendingCurrency
		? `${currencyLabel(pendingCurrency)} has no cents, so every amount you've recorded is rounded to a whole number. Switching back later won't bring the cents back.`
		: ''}
	confirmLabel="Switch and round"
	onConfirm={() => {
		if (pendingCurrency) applyCurrency(pendingCurrency);
		pendingCurrency = null;
	}}
/>
