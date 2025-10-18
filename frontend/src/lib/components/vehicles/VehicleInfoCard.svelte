<script lang="ts">
	import { Car, Settings } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { settingsStore } from '$lib/stores/settings';
	import { getDistanceUnitLabel } from '$lib/utils/units';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import type { Vehicle } from '$lib/types';

	interface Props {
		vehicle: Vehicle;
	}

	let { vehicle }: Props = $props();
</script>

<Card>
	<CardHeader>
		<div class="flex items-center justify-between">
			<CardTitle class="flex items-center gap-2">
				<Car class="h-5 w-5" />
				Vehicle Information
			</CardTitle>
			<Button
				variant="outline"
				size="icon"
				href="/vehicles/{vehicle.id}/edit"
				aria-label="Edit vehicle"
			>
				<Settings class="h-5 w-5" />
			</Button>
		</div>
	</CardHeader>
	<CardContent>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
			<div class="space-y-1">
				<p class="text-sm font-medium text-muted-foreground">Make & Model</p>
				<p class="text-base font-semibold">{vehicle.make} {vehicle.model}</p>
			</div>

			<div class="space-y-1">
				<p class="text-sm font-medium text-muted-foreground">Year</p>
				<p class="text-base font-semibold">{vehicle.year}</p>
			</div>

			{#if vehicle.licensePlate}
				<div class="space-y-1">
					<p class="text-sm font-medium text-muted-foreground">License Plate</p>
					<p class="text-base font-semibold font-mono">{vehicle.licensePlate}</p>
				</div>
			{/if}

			{#if vehicle.initialMileage}
				<div class="space-y-1">
					<p class="text-sm font-medium text-muted-foreground">Initial Mileage</p>
					<p class="text-base font-semibold">
						{vehicle.initialMileage.toLocaleString()}
						{getDistanceUnitLabel($settingsStore.settings?.distanceUnit || 'miles', true)}
					</p>
				</div>
			{/if}

			{#if vehicle.purchaseDate}
				<div class="space-y-1">
					<p class="text-sm font-medium text-muted-foreground">Purchase Date</p>
					<p class="text-base font-semibold">
						{formatDate(new Date(vehicle.purchaseDate))}
					</p>
				</div>
			{/if}

			{#if vehicle.purchasePrice}
				<div class="space-y-1">
					<p class="text-sm font-medium text-muted-foreground">Purchase Price</p>
					<p class="text-base font-semibold">{formatCurrency(vehicle.purchasePrice)}</p>
				</div>
			{/if}
		</div>
	</CardContent>
</Card>
