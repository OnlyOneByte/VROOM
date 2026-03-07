<script lang="ts">
	import { StatCardGrid } from '$lib/components/charts';
	import { Banknote, Calendar, TrendingUp, Hash, DollarSign, TriangleAlert } from '@lucide/svelte';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { getDistanceUnitLabel } from '$lib/utils/units';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import type { VehicleFinancing, UnitPreferences } from '$lib/types';
	import type { AmortizationEntry } from '$lib/utils/financing-calculations';

	interface Props {
		financing: VehicleFinancing;
		totalInterestPaid: number;
		totalPrincipalPaid: number;
		estimatedPayoffDate: Date;
		paymentsCount: number;
		amortizationSchedule?: AmortizationEntry[];
		mileageUsed?: number;
		unitPreferences?: UnitPreferences;
	}

	let {
		financing,
		totalInterestPaid,
		totalPrincipalPaid,
		estimatedPayoffDate,
		paymentsCount,
		amortizationSchedule = [],
		mileageUsed = 0,
		unitPreferences
	}: Props = $props();

	// Resolve distance label from vehicle unitPreferences, falling back to global settings
	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);
	let distLabel = $derived(getDistanceUnitLabel(units.distanceUnit, true));

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

	let metricItems = $derived.by(() => {
		const items: Array<{
			label: string;
			value: string | number;
			icon: typeof TrendingUp;
			iconColor: string;
			subtitle: string;
		}> = [];

		if (isLoanWithApr) {
			items.push({
				label: 'Principal vs Interest',
				value: formatCurrency(totalPrincipalPaid),
				subtitle: `+ ${formatCurrency(totalInterestPaid)} interest`,
				icon: TrendingUp,
				iconColor: 'chart-1'
			});
		}

		items.push({
			label: 'Payments Made',
			value: paymentsCount,
			subtitle: `of ${financing.termMonths} scheduled`,
			icon: Hash,
			iconColor: 'chart-3'
		});

		items.push({
			label: financing.financingType === 'lease' ? 'Lease End Date' : 'Estimated Payoff',
			value: formatDate(estimatedPayoffDate),
			subtitle: `${remainingMonths} month${remainingMonths !== 1 ? 's' : ''} remaining`,
			icon: Calendar,
			iconColor: 'chart-4'
		});

		if (isLoanWithApr) {
			items.push({
				label: 'Total Cost of Loan',
				value: formatCurrency(totalCostOfLoan),
				subtitle: `${interestPercentage}% over principal`,
				icon: Banknote,
				iconColor: 'chart-5'
			});
		}

		if (financing.financingType === 'lease' && financing.residualValue) {
			items.push({
				label: 'Residual Value (Buyout)',
				value: formatCurrency(financing.residualValue),
				subtitle: 'End-of-lease purchase option',
				icon: DollarSign,
				iconColor: 'chart-5'
			});
		}

		if (
			financing.financingType === 'lease' &&
			financing.mileageLimit &&
			financing.excessMileageFee
		) {
			items.push({
				label: 'Mileage Overage',
				value: excessMiles > 0 ? formatCurrency(overageCost) : '$0.00',
				subtitle: `${excessMiles > 0 ? `${excessMiles.toLocaleString()} ${distLabel} over` : 'Within limit'} · $${financing.excessMileageFee.toFixed(2)}/${distLabel}`,
				icon: TriangleAlert,
				iconColor: excessMiles > 0 ? 'destructive' : 'chart-2'
			});
		}

		return items;
	});
</script>

<StatCardGrid items={metricItems} columns={4} />
