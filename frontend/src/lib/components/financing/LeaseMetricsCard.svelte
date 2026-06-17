<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Progress } from '$lib/components/ui/progress';
	import { Gauge } from '@lucide/svelte';
	import {
		calculateLeaseMetrics,
		leaseTotalMileageAllowance
	} from '$lib/utils/financing-calculations';
	import { getDistanceUnitLabel } from '$lib/utils/units';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import type { VehicleFinancing, UnitPreferences } from '$lib/types';

	interface Props {
		financing: VehicleFinancing;
		currentMileage: number | null;
		initialMileage?: number | null;
		unitPreferences?: UnitPreferences;
	}

	let { financing, currentMileage, initialMileage = null, unitPreferences }: Props = $props();

	// Resolve distance label from vehicle unitPreferences, falling back to global settings
	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);
	let distLabel = $derived(getDistanceUnitLabel(units.distanceUnit, true));

	let leaseMetrics = $derived.by(() => {
		try {
			return calculateLeaseMetrics(financing, currentMileage, initialMileage);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating lease metrics:', error);
			return null;
		}
	});

	// The WHOLE-LEASE allowance (annual mileageLimit × termMonths/12), NOT the bare annual number. The
	// burn bar / displayed limit / limitOdometer below all compare against LIFETIME driven miles
	// (leaseMetrics.mileageUsed = current−initial), so using the annual limit over-reported usage ~Nx on
	// an N-year lease — e.g. 24k driven on an on-pace 36-mo/12k-yr lease showed "24k/12k, 100% RED" while
	// this card's own "left" figure (leaseMetrics.mileageRemaining, which already routes through
	// leaseTotalMileageAllowance) said "12k left" (#140, the #64/#110/#115 annual-vs-total class — the
	// one card the #115 PaymentMetricsGrid fix missed). ONE source of truth for the whole-lease budget.
	let totalMileageAllowance = $derived(leaseTotalMileageAllowance(financing));

	let mileageUsagePercentage = $derived.by(() => {
		if (!leaseMetrics || totalMileageAllowance <= 0) return 0;
		return Math.min(100, (leaseMetrics.mileageUsed / totalMileageAllowance) * 100);
	});

	let progressIndicatorClass = $derived(
		mileageUsagePercentage > 90
			? '[&_[data-slot=progress-indicator]]:bg-destructive'
			: mileageUsagePercentage > 75
				? '[&_[data-slot=progress-indicator]]:bg-chart-5'
				: '[&_[data-slot=progress-indicator]]:bg-chart-2'
	);

	// Odometer values: start-of-year odometer and the limit odometer
	let startOdometer = $derived(initialMileage ?? 0);
	let currentOdometer = $derived(currentMileage ?? startOdometer);
	let limitOdometer = $derived(startOdometer + totalMileageAllowance);
</script>

{#if financing.financingType === 'lease' && financing.mileageLimit && currentMileage !== null && leaseMetrics}
	<Card role="region" aria-labelledby="mileage-heading">
		<CardHeader class="p-4 sm:p-6">
			<CardTitle class="flex items-center gap-2 text-base sm:text-lg" id="mileage-heading">
				<Gauge class="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
				Mileage
			</CardTitle>
		</CardHeader>
		<CardContent class="space-y-4 p-4 sm:p-6">
			<!-- Burn bar -->
			<div class="space-y-2">
				<div class="flex justify-between text-xs sm:text-sm">
					<span class="text-muted-foreground">
						{leaseMetrics.mileageUsed.toLocaleString()}
						<span class="text-muted-foreground/60">
							/ {totalMileageAllowance.toLocaleString()}
							{distLabel}
						</span>
					</span>
					<span class="font-medium">{Math.round(mileageUsagePercentage)}%</span>
				</div>
				<div>
					<Progress
						value={mileageUsagePercentage}
						max={100}
						class="h-2.5 sm:h-3 {progressIndicatorClass}"
						aria-label="Mileage usage"
					/>
				</div>
			</div>

			<!-- Odometer row -->
			<div class="flex items-center justify-between text-xs sm:text-sm text-muted-foreground">
				<span>
					Odometer: <span class="font-medium text-foreground"
						>{currentOdometer.toLocaleString()}</span
					>
					<span class="text-muted-foreground/60"
						>/ {limitOdometer.toLocaleString()} {distLabel}</span
					>
				</span>
				<span class="font-medium text-foreground">
					{leaseMetrics.mileageRemaining.toLocaleString()} left
				</span>
			</div>
		</CardContent>
	</Card>
{/if}
