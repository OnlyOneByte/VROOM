<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '$lib/routes';
	import { onMount } from 'svelte';
	import { CreditCard, CircleAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import PaymentMetricsGrid from '$lib/components/financing/PaymentMetricsGrid.svelte';
	import FinancingCharts from '$lib/components/financing/FinancingCharts.svelte';
	import PaymentPlannerDialog from '$lib/components/financing/PaymentPlannerDialog.svelte';
	import PaymentHistory from '$lib/components/financing/PaymentHistory.svelte';
	import NextPaymentCard from '$lib/components/financing/NextPaymentCard.svelte';
	import LeaseMetricsCard from '$lib/components/financing/LeaseMetricsCard.svelte';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi } from '$lib/services/expense-api';
	import {
		calculateAmortizationSchedule,
		calculatePayoffDate,
		derivePaymentEntries
	} from '$lib/utils/financing-calculations';
	import type { Vehicle, VehicleStats, DerivedPaymentEntry } from '$lib/types';

	interface Props {
		vehicle: Vehicle;
		vehicleId: string;
		vehicleStatsData: VehicleStats | null;
	}

	let { vehicle, vehicleId, vehicleStatsData }: Props = $props();

	// Payment state
	let payments = $state<DerivedPaymentEntry[]>([]);
	let isLoadingPayments = $state(false);
	let paymentHistoryError = $state<string | null>(null);
	let hasAttemptedPaymentLoad = $state(false);
	let showPaymentPlanner = $state(false);

	// Financing derived state
	let progressPercentage = $derived.by(() => {
		try {
			if (!vehicle?.financing?.isActive) return 0;
			const financing = vehicle.financing;
			if (!financing.originalAmount || financing.originalAmount <= 0) return 0;
			const balance = financing.computedBalance ?? financing.originalAmount;
			return ((financing.originalAmount - balance) / financing.originalAmount) * 100;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating progress percentage:', error);
			return 0;
		}
	});

	let totalInterestPaid = $derived.by(() => {
		try {
			return payments.reduce((sum, payment) => sum + (payment.interestAmount || 0), 0);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating total interest paid:', error);
			return 0;
		}
	});

	let totalPrincipalPaid = $derived.by(() => {
		try {
			return payments.reduce((sum, payment) => sum + (payment.principalAmount || 0), 0);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating total principal paid:', error);
			return 0;
		}
	});

	let estimatedPayoffDate = $derived.by(() => {
		try {
			const financing = vehicle?.financing;
			if (!financing || !financing.isActive) return new Date();
			return calculatePayoffDate(financing);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating payoff date:', error);
			return new Date();
		}
	});

	let amortizationSchedule = $derived.by(() => {
		try {
			const financing = vehicle?.financing;
			if (!financing || !financing.isActive) return [];
			return calculateAmortizationSchedule(financing, payments.length);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating amortization schedule:', error);
			return [];
		}
	});

	// Load payment history on mount
	onMount(() => {
		if (vehicle?.financing?.isActive && !hasAttemptedPaymentLoad) {
			loadPaymentHistory();
		}
	});

	async function loadPaymentHistory() {
		if (!vehicle?.financing?.isActive) return;

		isLoadingPayments = true;
		paymentHistoryError = null;
		hasAttemptedPaymentLoad = true;

		try {
			const result = await expenseApi.getExpensesByVehicle(vehicleId, {
				limit: 100,
				category: 'financial'
			});
			const financingExpenses = result.data.filter(e => e.isFinancingPayment === true);
			payments = derivePaymentEntries(financingExpenses, vehicle.financing);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error loading payment history:', error);
			paymentHistoryError = 'Failed to load payment history. Please try again.';
		} finally {
			isLoadingPayments = false;
		}
	}

	async function handlePaymentAmountChange(newAmount: number) {
		if (!vehicle?.financing) return;
		await vehicleApi.updatePaymentAmount(vehicle.financing.id, newAmount);
		vehicle.financing.paymentAmount = newAmount;
	}
</script>

{#if vehicle.financing?.isActive}
	{#if vehicle.financing.originalAmount && vehicle.financing.originalAmount > 0}
		{#if vehicle.financing.paymentAmount && vehicle.financing.paymentAmount > 0}
			<NextPaymentCard
				financing={vehicle.financing}
				lastPayment={payments.length > 0 ? payments[0] : undefined}
				recordPaymentHref={`${resolve(routes.expenseNew)}?vehicleId=${vehicleId}&category=financial&isFinancingPayment=true&amount=${vehicle.financing.paymentAmount}&returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`}
				{progressPercentage}
				onChangePayment={() => (showPaymentPlanner = true)}
			/>
		{/if}

		{#if vehicle.financing.paymentAmount && vehicle.financing.paymentAmount > 0}
			<PaymentMetricsGrid
				financing={vehicle.financing}
				{totalInterestPaid}
				{totalPrincipalPaid}
				{estimatedPayoffDate}
				paymentsCount={payments.length}
				{amortizationSchedule}
				mileageUsed={Math.max(
					0,
					(vehicleStatsData?.currentMileage ?? vehicle.initialMileage ?? 0) -
						(vehicle.initialMileage ?? 0)
				)}
				unitPreferences={vehicle.unitPreferences}
			/>
		{/if}
	{:else}
		<Alert variant="destructive">
			<CircleAlert class="h-4 w-4" />
			<AlertTitle>Invalid Financing Data</AlertTitle>
			<AlertDescription>
				The financing information for this vehicle is incomplete or invalid. Please update the
				financing details.
			</AlertDescription>
		</Alert>
	{/if}

	{#if vehicle.financing.financingType === 'lease'}
		<LeaseMetricsCard
			financing={vehicle.financing}
			currentMileage={vehicleStatsData?.currentMileage ?? vehicle.initialMileage ?? null}
			initialMileage={vehicle.initialMileage ?? null}
			unitPreferences={vehicle.unitPreferences}
		/>
	{/if}

	{#if vehicle.financing.financingType === 'loan' && (!vehicle.financing.apr || vehicle.financing.apr <= 0)}
		<Alert>
			<CircleAlert class="h-4 w-4" />
			<AlertTitle>APR Not Set</AlertTitle>
			<AlertDescription>
				The APR (Annual Percentage Rate) is not set for this loan. Some features like the
				amortization schedule and interest calculations will not be available.
			</AlertDescription>
		</Alert>
	{/if}

	<FinancingCharts financing={vehicle.financing} {amortizationSchedule} />

	{#if vehicle.financing.financingType === 'loan'}
		<PaymentPlannerDialog
			financing={vehicle.financing}
			bind:open={showPaymentPlanner}
			onPaymentAmountSaved={handlePaymentAmountChange}
		/>
	{/if}

	{#if isLoadingPayments}
		<Card>
			<CardContent class="p-6 space-y-4">
				<div class="flex items-center gap-2">
					<Skeleton class="h-5 w-32" />
				</div>
				<div class="space-y-3">
					{#each Array(3) as _, i (i)}
						<div class="flex gap-4">
							<Skeleton class="h-12 w-12 rounded-full" />
							<div class="flex-1 space-y-2">
								<Skeleton class="h-4 w-24" />
								<Skeleton class="h-6 w-32" />
								<Skeleton class="h-4 w-full" />
							</div>
						</div>
					{/each}
				</div>
			</CardContent>
		</Card>
	{:else if paymentHistoryError}
		<Alert variant="destructive">
			<CircleAlert class="h-4 w-4" />
			<AlertTitle>Error Loading Payment History</AlertTitle>
			<AlertDescription>
				{paymentHistoryError}
				<Button
					variant="outline"
					size="sm"
					class="mt-2"
					onclick={() => {
						hasAttemptedPaymentLoad = false;
						loadPaymentHistory();
					}}
				>
					Try Again
				</Button>
			</AlertDescription>
		</Alert>
	{:else}
		<PaymentHistory {payments} financing={vehicle.financing} />
	{/if}
{:else}
	<EmptyState>
		{#snippet icon()}
			<CreditCard class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			No active financing
		{/snippet}
		{#snippet description()}
			This vehicle doesn't have active financing
		{/snippet}
	</EmptyState>
{/if}
