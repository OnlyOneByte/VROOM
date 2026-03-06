<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Banknote, Calendar, TrendingUp, Hash, DollarSign, TriangleAlert } from 'lucide-svelte';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import type { VehicleFinancing } from '$lib/types.js';
	import type { AmortizationEntry } from '$lib/utils/financing-calculations';

	interface Props {
		financing: VehicleFinancing;
		totalInterestPaid: number;
		totalPrincipalPaid: number;
		estimatedPayoffDate: Date;
		paymentsCount: number;
		amortizationSchedule?: AmortizationEntry[];
		mileageUsed?: number;
	}

	let {
		financing,
		totalInterestPaid,
		totalPrincipalPaid,
		estimatedPayoffDate,
		paymentsCount,
		amortizationSchedule = [],
		mileageUsed = 0
	}: Props = $props();

	let isLoanWithApr = $derived(
		financing.financingType === 'loan' && financing.apr != null && financing.apr > 0
	);

	// Remaining term in months
	let remainingMonths = $derived(Math.max(0, financing.termMonths - paymentsCount));

	// Total cost of loan = original amount + total projected interest from amortization schedule
	let totalCostOfLoan = $derived.by(() => {
		if (!isLoanWithApr || amortizationSchedule.length === 0) return financing.originalAmount;
		const totalProjectedInterest = amortizationSchedule.reduce(
			(sum, entry) => sum + entry.interestAmount,
			0
		);
		return financing.originalAmount + totalProjectedInterest;
	});

	let interestPercentage = $derived.by(() => {
		if (financing.originalAmount <= 0) return 0;
		const totalInterest = totalCostOfLoan - financing.originalAmount;
		return Math.round((totalInterest / financing.originalAmount) * 100);
	});

	// Lease mileage overage
	let excessMiles = $derived(
		financing.financingType === 'lease' && financing.mileageLimit
			? Math.max(0, mileageUsed - financing.mileageLimit)
			: 0
	);

	let overageCost = $derived(excessMiles * (financing.excessMileageFee ?? 0));
</script>

<div
	class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
	role="list"
	aria-label="Payment metrics"
>
	<!-- Principal vs Interest (loans only) -->
	{#if isLoanWithApr}
		<Card role="listitem">
			<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<p
							class="text-xs sm:text-sm font-medium text-muted-foreground"
							id="principal-interest-label"
						>
							Principal vs Interest
						</p>
						<p
							class="text-xl sm:text-2xl font-bold text-chart-2"
							aria-labelledby="principal-interest-label"
						>
							{formatCurrency(totalPrincipalPaid)}
						</p>
						<p class="text-xs text-muted-foreground">
							+ {formatCurrency(totalInterestPaid)} interest
						</p>
					</div>
					<div class="rounded-full bg-chart-1/10 p-2" aria-hidden="true">
						<TrendingUp class="h-4 w-4 sm:h-5 sm:w-5 text-chart-1" />
					</div>
				</div>
			</CardContent>
		</Card>
	{/if}

	<!-- Payments Made -->
	<Card role="listitem">
		<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
			<div class="flex items-start justify-between">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm font-medium text-muted-foreground" id="payments-count-label">
						Payments Made
					</p>
					<p class="text-xl sm:text-2xl font-bold" aria-labelledby="payments-count-label">
						{paymentsCount}
					</p>
					<p class="text-xs text-muted-foreground">
						of {financing.termMonths} scheduled
					</p>
				</div>
				<div class="rounded-full bg-chart-3/10 p-2" aria-hidden="true">
					<Hash class="h-4 w-4 sm:h-5 sm:w-5 text-chart-3" />
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- Estimated Payoff Date / Lease End Date + Remaining Term -->
	<Card role="listitem">
		<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
			<div class="flex items-start justify-between">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm font-medium text-muted-foreground" id="payoff-date-label">
						{financing.financingType === 'lease' ? 'Lease End Date' : 'Estimated Payoff'}
					</p>
					<time
						class="text-lg sm:text-2xl font-bold break-words block"
						datetime={estimatedPayoffDate.toISOString()}
						aria-labelledby="payoff-date-label">{formatDate(estimatedPayoffDate)}</time
					>
					<p class="text-xs text-muted-foreground">
						{remainingMonths} month{remainingMonths !== 1 ? 's' : ''} remaining
					</p>
				</div>
				<div class="rounded-full bg-chart-4/10 p-2" aria-hidden="true">
					<Calendar class="h-4 w-4 sm:h-5 sm:w-5 text-chart-4" />
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- Total Cost of Loan (loans with APR only) -->
	{#if isLoanWithApr}
		<Card role="listitem">
			<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<p class="text-xs sm:text-sm font-medium text-muted-foreground" id="total-cost-label">
							Total Cost of Loan
						</p>
						<p class="text-xl sm:text-2xl font-bold" aria-labelledby="total-cost-label">
							{formatCurrency(totalCostOfLoan)}
						</p>
						<p class="text-xs text-muted-foreground">
							{interestPercentage}% over principal
						</p>
					</div>
					<div class="rounded-full bg-chart-5/10 p-2" aria-hidden="true">
						<Banknote class="h-4 w-4 sm:h-5 sm:w-5 text-chart-5" />
					</div>
				</div>
			</CardContent>
		</Card>
	{/if}

	<!-- Residual Value (leases only) -->
	{#if financing.financingType === 'lease' && financing.residualValue}
		<Card role="listitem">
			<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<p
							class="text-xs sm:text-sm font-medium text-muted-foreground"
							id="residual-value-label"
						>
							Residual Value (Buyout)
						</p>
						<p class="text-xl sm:text-2xl font-bold" aria-labelledby="residual-value-label">
							{formatCurrency(financing.residualValue)}
						</p>
						<p class="text-xs text-muted-foreground">End-of-lease purchase option</p>
					</div>
					<div class="rounded-full bg-chart-5/10 p-2" aria-hidden="true">
						<DollarSign class="h-4 w-4 sm:h-5 sm:w-5 text-chart-5" />
					</div>
				</div>
			</CardContent>
		</Card>
	{/if}

	<!-- Mileage Overage (leases with mileage limit and excess fee) -->
	{#if financing.financingType === 'lease' && financing.mileageLimit && financing.excessMileageFee}
		<Card role="listitem">
			<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<p
							class="text-xs sm:text-sm font-medium text-muted-foreground"
							id="mileage-overage-label"
						>
							Mileage Overage
						</p>
						<p
							class="text-xl sm:text-2xl font-bold {excessMiles > 0 ? 'text-destructive' : ''}"
							aria-labelledby="mileage-overage-label"
						>
							{excessMiles > 0 ? formatCurrency(overageCost) : '$0.00'}
						</p>
						<p class="text-xs text-muted-foreground">
							{excessMiles > 0 ? `${excessMiles.toLocaleString()} mi over` : 'Within limit'}
							· ${financing.excessMileageFee.toFixed(2)}/mi
						</p>
					</div>
					<div
						class="rounded-full {excessMiles > 0 ? 'bg-destructive/10' : 'bg-chart-2/10'} p-2"
						aria-hidden="true"
					>
						<TriangleAlert
							class="h-4 w-4 sm:h-5 sm:w-5 {excessMiles > 0 ? 'text-destructive' : 'text-chart-2'}"
						/>
					</div>
				</div>
			</CardContent>
		</Card>
	{/if}
</div>
