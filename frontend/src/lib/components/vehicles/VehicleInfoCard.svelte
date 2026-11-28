<script lang="ts">
	import { resolve } from '$app/paths';
	import { paramRoutes } from '#lib/routes.ts';
	import { Car, ChevronDown, Settings } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { formatCurrency, formatDate, formatNumber } from '#lib/utils/formatters.ts';
	import type { Vehicle } from '#lib/types/index.ts';

	interface Props {
		vehicle: Vehicle;
		isOwner?: boolean;
	}

	let { vehicle, isOwner = true }: Props = $props();

	let detailsOpen = $state(false);
	const detailsId = $props.id();

	let distanceLabel = $derived(
		getDistanceUnitLabel(
			(vehicle.unitPreferences ?? settingsStore.unitPreferences).distanceUnit,
			true
		)
	);

	let detailsSummary = $derived(
		[
			vehicle.licensePlate && `plate ${vehicle.licensePlate}`,
			vehicle.initialMileage &&
				`${formatNumber(vehicle.initialMileage, 0)} ${distanceLabel} initial`
		]
			.filter(Boolean)
			.join(', ') || String(vehicle.year)
	);
</script>

<Card>
	<CardHeader>
		<div class="flex items-center justify-between">
			<CardTitle level={2} class="flex items-center gap-2">
				<Car class="h-5 w-5" />
				Vehicle information
			</CardTitle>
			{#if isOwner}
				<Button
					variant="outline"
					size="icon-lg"
					href={resolve(paramRoutes.vehicleEdit, { id: vehicle.id })}
					aria-label="Edit vehicle"
				>
					<Settings class="h-5 w-5" />
				</Button>
			{/if}
		</div>
	</CardHeader>
	<CardContent>
		<button
			type="button"
			class="flex min-h-10 w-full items-center justify-between gap-3 rounded-md text-left text-sm sm:hidden outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			aria-expanded={detailsOpen}
			aria-controls={detailsId}
			onclick={() => (detailsOpen = !detailsOpen)}
		>
			<span class="min-w-0">
				<span class="font-medium">Details:</span>
				<span class="text-muted-foreground">{detailsSummary}</span>
			</span>
			<ChevronDown
				class="h-4 w-4 shrink-0 text-muted-foreground transition-transform {detailsOpen
					? 'rotate-180'
					: ''}"
				aria-hidden="true"
			/>
		</button>
		<div
			id={detailsId}
			class="{detailsOpen
				? 'grid'
				: 'hidden'} mt-4 grid-cols-1 gap-6 sm:mt-0 sm:grid sm:grid-cols-2"
		>
			<div class="space-y-1">
				<p class="text-sm font-medium text-muted-foreground">Year</p>
				<p class="text-base font-semibold">{vehicle.year}</p>
			</div>

			{#if vehicle.licensePlate}
				<div class="space-y-1">
					<p class="text-sm font-medium text-muted-foreground">License plate</p>
					<p class="text-base font-semibold font-mono">{vehicle.licensePlate}</p>
				</div>
			{/if}

			{#if vehicle.vin}
				<div class="space-y-1">
					<p class="text-sm font-medium text-muted-foreground">VIN</p>
					<p class="text-base font-semibold font-mono">{vehicle.vin}</p>
				</div>
			{/if}

			{#if vehicle.initialMileage}
				<div class="space-y-1">
					<p class="text-sm font-medium text-muted-foreground">Initial mileage</p>
					<p class="text-base font-semibold">
						{formatNumber(vehicle.initialMileage, 0)}
						{distanceLabel}
					</p>
				</div>
			{/if}

			{#if vehicle.purchaseDate}
				<div class="space-y-1">
					<p class="text-sm font-medium text-muted-foreground">Purchase date</p>
					<p class="text-base font-semibold">
						{formatDate(new Date(vehicle.purchaseDate))}
					</p>
				</div>
			{/if}

			{#if vehicle.purchasePrice}
				<div class="space-y-1">
					<p class="text-sm font-medium text-muted-foreground">Purchase price</p>
					<p class="text-base font-semibold">{formatCurrency(vehicle.purchasePrice)}</p>
				</div>
			{/if}
		</div>
	</CardContent>
</Card>
