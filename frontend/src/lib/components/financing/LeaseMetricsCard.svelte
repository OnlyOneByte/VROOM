<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Progress } from '$lib/components/ui/progress';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Calendar, Clock, Gauge, TriangleAlert } from 'lucide-svelte';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { calculateLeaseMetrics } from '$lib/utils/financing-calculations';
	import type { VehicleFinancing } from '$lib/types';

	interface Props {
		financing: VehicleFinancing;
		currentMileage: number | null;
		initialMileage?: number | null;
	}

	let { financing, currentMileage, initialMileage = null }: Props = $props();

	// Calculate lease metrics with error handling
	let leaseMetrics = $derived.by(() => {
		try {
			return calculateLeaseMetrics(financing, currentMileage, initialMileage);
		} catch (error) {
			console.error('Error calculating lease metrics:', error);
			return null;
		}
	});

	// Calculate mileage usage percentage with error handling
	let mileageUsagePercentage = $derived.by(() => {
		try {
			if (!leaseMetrics || !financing.mileageLimit || financing.mileageLimit <= 0) return 0;
			return Math.min(100, (leaseMetrics.mileageUsed / financing.mileageLimit) * 100);
		} catch (error) {
			console.error('Error calculating mileage usage percentage:', error);
			return 0;
		}
	});

	// Determine mileage progress color
	let mileageProgressColor = $derived(
		mileageUsagePercentage > 90
			? 'bg-destructive'
			: mileageUsagePercentage > 75
				? 'bg-chart-5'
				: 'bg-chart-2'
	);

	// Calculate lease end date with error handling
	let leaseEndDate = $derived.by(() => {
		try {
			if (financing.endDate) {
				const date = new Date(financing.endDate);
				if (!isNaN(date.getTime())) return date;
			}
			const startDate = new Date(financing.startDate);
			if (isNaN(startDate.getTime())) return new Date();
			const endDate = new Date(startDate);
			endDate.setMonth(endDate.getMonth() + financing.termMonths);
			return endDate;
		} catch (error) {
			console.error('Error calculating lease end date:', error);
			return new Date();
		}
	});
</script>

{#if financing.financingType === 'lease' && leaseMetrics}
	<Card role="region" aria-labelledby="lease-info-heading">
		<CardHeader class="p-4 sm:p-6">
			<CardTitle class="flex items-center gap-2 text-base sm:text-lg" id="lease-info-heading">
				<Calendar class="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
				Lease Information
			</CardTitle>
		</CardHeader>
		<CardContent class="space-y-4 sm:space-y-6 p-4 sm:p-6">
			<!-- Lease Timeline -->
			<div class="space-y-2" role="group" aria-label="Lease timeline">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Clock class="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
						<span class="text-xs sm:text-sm font-medium" id="lease-end-label">Lease End Date</span>
					</div>
					<time
						class="text-xs sm:text-sm font-bold"
						datetime={leaseEndDate.toISOString()}
						aria-labelledby="lease-end-label">{formatDate(leaseEndDate)}</time
					>
				</div>
				<div class="flex items-center justify-between text-xs sm:text-sm text-muted-foreground">
					<span id="months-remaining-label">Months Remaining</span>
					<span class="font-medium" aria-labelledby="months-remaining-label"
						>{leaseMetrics.monthsRemaining} months</span
					>
				</div>
				<div class="flex items-center justify-between text-xs sm:text-sm text-muted-foreground">
					<span id="days-remaining-label">Days Remaining</span>
					<span class="font-medium" aria-labelledby="days-remaining-label"
						>{leaseMetrics.daysRemaining} days</span
					>
				</div>
			</div>

			<!-- Mileage Information -->
			{#if financing.mileageLimit && currentMileage !== null}
				<div class="space-y-3" role="group" aria-labelledby="mileage-status-heading">
					<div class="flex items-center gap-2">
						<Gauge class="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
						<span class="text-xs sm:text-sm font-medium" id="mileage-status-heading"
							>Mileage Status</span
						>
					</div>

					<!-- Mileage Progress Bar -->
					<div class="space-y-2">
						<div class="flex justify-between text-xs sm:text-sm">
							<span class="text-muted-foreground">Usage</span>
							<span class="font-medium" aria-label="Mileage usage percentage"
								>{Math.round(mileageUsagePercentage)}%</span
							>
						</div>
						<div class="relative">
							<Progress
								value={mileageUsagePercentage}
								max={100}
								class="h-2 sm:h-3"
								aria-label="Mileage usage progress"
								aria-valuenow={Math.round(mileageUsagePercentage)}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-describedby="mileage-status-heading"
							/>
							<div
								class="absolute top-0 left-0 h-2 sm:h-3 rounded-full transition-all {mileageProgressColor}"
								style="width: {mileageUsagePercentage}%"
								aria-hidden="true"
							></div>
						</div>
					</div>

					<!-- Mileage Details Grid -->
					<div
						class="grid grid-cols-2 gap-3 sm:gap-4 pt-2"
						role="list"
						aria-label="Mileage details"
					>
						<div class="space-y-1" role="listitem">
							<p class="text-xs text-muted-foreground" id="mileage-limit-label">Mileage Limit</p>
							<p class="text-base sm:text-lg font-bold" aria-labelledby="mileage-limit-label">
								{financing.mileageLimit.toLocaleString()}
							</p>
						</div>
						<div class="space-y-1" role="listitem">
							<p class="text-xs text-muted-foreground" id="current-mileage-label">
								Current Mileage
							</p>
							<p class="text-base sm:text-lg font-bold" aria-labelledby="current-mileage-label">
								{currentMileage.toLocaleString()}
							</p>
						</div>
						<div class="space-y-1" role="listitem">
							<p class="text-xs text-muted-foreground" id="miles-used-label">Miles Used</p>
							<p class="text-base sm:text-lg font-bold" aria-labelledby="miles-used-label">
								{leaseMetrics.mileageUsed.toLocaleString()}
							</p>
						</div>
						<div class="space-y-1" role="listitem">
							<p class="text-xs text-muted-foreground" id="miles-remaining-label">
								Miles Remaining
							</p>
							<p class="text-base sm:text-lg font-bold" aria-labelledby="miles-remaining-label">
								{leaseMetrics.mileageRemaining.toLocaleString()}
							</p>
						</div>
					</div>

					<!-- Projected Mileage -->
					<div class="pt-2 space-y-2">
						<div class="flex items-center justify-between text-xs sm:text-sm">
							<span class="text-muted-foreground" id="projected-mileage-label"
								>Projected Final Mileage</span
							>
							<span class="font-bold" aria-labelledby="projected-mileage-label"
								>{Math.round(leaseMetrics.projectedFinalMileage).toLocaleString()}</span
							>
						</div>

						<!-- Warning if over mileage -->
						{#if leaseMetrics.isOverMileage}
							<Alert variant="destructive" class="p-3 sm:p-4" role="alert" aria-live="polite">
								<TriangleAlert class="h-4 w-4 flex-shrink-0" aria-hidden="true" />
								<AlertDescription>
									<div class="space-y-1">
										<p class="text-xs sm:text-sm font-semibold">
											Projected to exceed mileage limit
										</p>
										<p class="text-xs sm:text-sm">
											Excess Miles: {Math.round(leaseMetrics.projectedExcessMiles).toLocaleString()}
										</p>
										{#if financing.excessMileageFee}
											<p class="text-xs sm:text-sm">
												Potential Fee: {formatCurrency(leaseMetrics.projectedExcessFee)}
												<span class="text-xs">
													(${financing.excessMileageFee.toFixed(2)}/mile)
												</span>
											</p>
										{/if}
									</div>
								</AlertDescription>
							</Alert>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Residual Value -->
			{#if financing.residualValue}
				<div class="pt-2 border-t">
					<div class="flex items-center justify-between">
						<span
							class="text-xs sm:text-sm font-medium text-muted-foreground"
							id="residual-value-label">Residual Value (Buyout)</span
						>
						<span class="text-base sm:text-lg font-bold" aria-labelledby="residual-value-label"
							>{formatCurrency(financing.residualValue)}</span
						>
					</div>
				</div>
			{/if}
		</CardContent>
	</Card>
{/if}
