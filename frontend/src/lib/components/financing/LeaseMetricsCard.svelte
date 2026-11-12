<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.ts';
	import { Progress } from '#lib/components/ui/progress/index.ts';
	import { Gauge } from '@lucide/svelte';
	import {
		calculateLeaseMetrics,
		leaseTotalMileageAllowance
	} from '#lib/utils/financing-calculations.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { VehicleFinancing, UnitPreferences } from '#lib/types/index.ts';

	interface Props {
		financing: VehicleFinancing;
		currentMileage: number | null;
		initialMileage?: number | null;
		unitPreferences?: UnitPreferences;
	}

	let { financing, currentMileage, initialMileage = null, unitPreferences }: Props = $props();

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
