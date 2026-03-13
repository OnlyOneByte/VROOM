<script lang="ts">
	import { Globe, Fuel, DollarSign } from '@lucide/svelte';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';

	interface Props {
		distanceUnit: 'miles' | 'kilometers';
		volumeUnit: 'gallons_us' | 'gallons_uk' | 'liters';
		chargeUnit: 'kwh';
		currencyUnit: string;
	}

	let {
		distanceUnit = $bindable(),
		volumeUnit = $bindable(),
		chargeUnit = $bindable(),
		currencyUnit = $bindable()
	}: Props = $props();

	function getDistanceLabel(unit: 'miles' | 'kilometers'): string {
		return unit === 'miles' ? 'Miles' : 'Kilometers';
	}

	function getVolumeLabel(unit: 'gallons_us' | 'gallons_uk' | 'liters'): string {
		const labels = { gallons_us: 'Gallons (US)', gallons_uk: 'Gallons (UK)', liters: 'Liters' };
		return labels[unit];
	}

	function getCurrencyLabel(currency: string): string {
		const labels: Record<string, string> = {
			USD: 'USD ($)',
			EUR: 'EUR (€)',
			GBP: 'GBP (£)',
			CAD: 'CAD ($)',
			AUD: 'AUD ($)'
		};
		return labels[currency] || currency;
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>Unit Preferences</CardTitle>
		<CardDescription>Choose your preferred units for measurements</CardDescription>
		<p class="text-sm text-muted-foreground mt-1">
			These units are used as defaults when adding new vehicles and determine the display units for
			cross-vehicle analytics.
		</p>
	</CardHeader>
	<CardContent class="space-y-6">
		<div class="space-y-2">
			<Label for="distance-unit" class="flex items-center gap-2">
				<Globe class="h-4 w-4" />
				Distance Unit
			</Label>
			<Select.Root
				type="single"
				value={distanceUnit}
				onValueChange={v => {
					if (v) distanceUnit = v as 'miles' | 'kilometers';
				}}
			>
				<Select.Trigger id="distance-unit" class="w-full">
					{getDistanceLabel(distanceUnit)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="miles" label="Miles">Miles</Select.Item>
					<Select.Item value="kilometers" label="Kilometers">Kilometers</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>

		<div class="space-y-2">
			<Label for="volume-unit" class="flex items-center gap-2">
				<Fuel class="h-4 w-4" />
				Fuel Volume Unit
			</Label>
			<p class="text-xs text-muted-foreground">For gas and diesel vehicles</p>
			<Select.Root
				type="single"
				value={volumeUnit}
				onValueChange={v => {
					if (v) volumeUnit = v as 'gallons_us' | 'gallons_uk' | 'liters';
				}}
			>
				<Select.Trigger id="volume-unit" class="w-full">
					{getVolumeLabel(volumeUnit)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="gallons_us" label="Gallons (US)">Gallons (US)</Select.Item>
					<Select.Item value="gallons_uk" label="Gallons (UK)">Gallons (UK)</Select.Item>
					<Select.Item value="liters" label="Liters">Liters</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>

		<div class="space-y-2">
			<Label for="charge-unit" class="flex items-center gap-2">
				<Fuel class="h-4 w-4" />
				Electric Charge Unit
			</Label>
			<p class="text-xs text-muted-foreground">For electric and hybrid vehicles</p>
			<Select.Root
				type="single"
				value={chargeUnit}
				onValueChange={v => {
					if (v) chargeUnit = v as 'kwh';
				}}
			>
				<Select.Trigger id="charge-unit" class="w-full">kWh</Select.Trigger>
				<Select.Content>
					<Select.Item value="kwh" label="kWh">kWh</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>

		<div class="space-y-2">
			<Label for="currency" class="flex items-center gap-2">
				<DollarSign class="h-4 w-4" />
				Currency
			</Label>
			<Select.Root
				type="single"
				value={currencyUnit}
				onValueChange={v => {
					if (v) currencyUnit = v;
				}}
			>
				<Select.Trigger id="currency" class="w-full">
					{getCurrencyLabel(currencyUnit)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="USD" label="USD ($)">USD ($)</Select.Item>
					<Select.Item value="EUR" label="EUR (€)">EUR (€)</Select.Item>
					<Select.Item value="GBP" label="GBP (£)">GBP (£)</Select.Item>
					<Select.Item value="CAD" label="CAD ($)">CAD ($)</Select.Item>
					<Select.Item value="AUD" label="AUD ($)">AUD ($)</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>
	</CardContent>
</Card>
