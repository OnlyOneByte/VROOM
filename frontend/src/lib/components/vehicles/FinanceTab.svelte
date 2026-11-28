<script lang="ts">
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { onMount } from 'svelte';
	import { CreditCard, CircleAlert } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { Card, CardContent } from '#lib/components/ui/card/index.ts';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import PaymentMetricsGrid from '#lib/components/financing/PaymentMetricsGrid.svelte';
	import FinancingCharts from '#lib/components/financing/FinancingCharts.svelte';
	import PaymentPlannerDialog from '#lib/components/financing/PaymentPlannerDialog.svelte';
	import PaymentHistory from '#lib/components/financing/PaymentHistory.svelte';
	import NextPaymentCard from '#lib/components/financing/NextPaymentCard.svelte';
	import LeaseMetricsCard from '#lib/components/financing/LeaseMetricsCard.svelte';
	import LoanHero from '#lib/components/financing/LoanHero.svelte';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { expenseApi } from '#lib/services/expense-api.ts';
	import {
		calculateAmortizationSchedule,
		calculatePayoffDate,
		derivePaymentEntries,
		resolveCurrentOdometer
	} from '#lib/utils/financing-calculations.ts';
	import type { Expense, Vehicle, VehicleStats, DerivedPaymentEntry } from '#lib/types/index.ts';

	const EXPENSE_PAGE_SIZE = 100;

	interface Props {
		vehicle: Vehicle;
		vehicleId: string;
		vehicleStatsData: VehicleStats | null;
		isOwner?: boolean;
	}

	let { vehicle, vehicleId, vehicleStatsData, isOwner = true }: Props = $props();

	let loanHidden = $derived(!!vehicle.sharedAccess && vehicle.sharedAccess.seesFinancials !== true);

	let payments = $state<DerivedPaymentEntry[]>([]);
	let paymentsLoaded = $state(false);
	let isLoadingPayments = $state(false);
	let paymentHistoryError = $state<string | null>(null);
	let hasAttemptedPaymentLoad = $state(false);
	let showPaymentPlanner = $state(false);

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

	let nextPayment = $derived.by(() => {
		const lastPayment = payments.at(-1);
		return {
			lastPaymentDate: lastPayment ? new Date(lastPayment.expense.date) : undefined,
			assumeLastDuePaid: !paymentsLoaded
		};
	});

	let estimatedPayoffDate = $derived.by(() => {
		try {
			const financing = vehicle?.financing;
			if (!financing || !financing.isActive) return new Date();
			return calculatePayoffDate(financing, nextPayment);
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
			const financingId = vehicle.financing.id;
			const financialExpenses: Expense[] = [];
			for (let offset = 0; ; offset += EXPENSE_PAGE_SIZE) {
				const page = await expenseApi.getExpensesByVehicle(vehicleId, {
					limit: EXPENSE_PAGE_SIZE,
					offset,
					category: 'financial'
				});
				financialExpenses.push(...page.data);
				if (!page.pagination.hasMore || page.data.length === 0) break;
			}
			const financingExpenses = financialExpenses.filter(
				e => e.sourceType === 'financing' && e.sourceId === financingId
			);
			payments = derivePaymentEntries(financingExpenses, vehicle.financing);
			paymentsLoaded = true;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error loading payment history:', error);
			paymentHistoryError = userFacingErrorMessage(error);
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
	<h2 class="sr-only">Financing</h2>
	{#if vehicle.financing.originalAmount && vehicle.financing.originalAmount > 0}
		{#if vehicle.financing.financingType === 'loan' && vehicle.financing.paymentAmount > 0}
			<LoanHero
				financing={vehicle.financing}
				{payments}
				{paymentsLoaded}
				paymentsLoading={isLoadingPayments || !hasAttemptedPaymentLoad}
				payoffDate={estimatedPayoffDate}
			/>
		{/if}

		<div
			class="grid gap-6 empty:hidden lg:grid-cols-2 lg:items-start lg:[&>:only-child]:col-span-2"
			data-testid="finance-next-payment-grid"
		>
			{#if vehicle.financing.paymentAmount && vehicle.financing.paymentAmount > 0}
				<NextPaymentCard
					financing={vehicle.financing}
					lastPayment={payments.at(-1)}
					{paymentsLoaded}
					{isOwner}
					recordPaymentHref={`${resolve(routes.expenseNew)}?vehicleId=${vehicleId}&category=financial&financingId=${vehicle.financing.id}&amount=${vehicle.financing.paymentAmount}&returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`}
					showProgress={vehicle.financing.financingType !== 'loan'}
					onChangePayment={() => (showPaymentPlanner = true)}
				/>
			{/if}
			<FinancingCharts financing={vehicle.financing} {amortizationSchedule} />
		</div>

		{#if vehicle.financing.financingType !== 'loan' && vehicle.financing.paymentAmount && vehicle.financing.paymentAmount > 0}
			<PaymentMetricsGrid
				financing={vehicle.financing}
				{totalInterestPaid}
				{totalPrincipalPaid}
				{estimatedPayoffDate}
				paymentsCount={payments.length}
				{amortizationSchedule}
				mileageUsed={Math.max(
					0,
					(resolveCurrentOdometer(
						vehicleStatsData?.currentOdometer,
						vehicleStatsData?.currentMileage,
						vehicle.initialMileage
					) ?? 0) - (vehicle.initialMileage ?? 0)
				)}
				unitPreferences={vehicle.unitPreferences}
			/>
		{/if}
	{:else}
		<Alert variant="destructive">
			<CircleAlert class="h-4 w-4" />
			<AlertTitle>Invalid financing data</AlertTitle>
			<AlertDescription>
				The financing information for this vehicle is incomplete or invalid. Please update the
				financing details.
			</AlertDescription>
		</Alert>
	{/if}

	{#if vehicle.financing.financingType === 'lease'}
		<LeaseMetricsCard
			financing={vehicle.financing}
			currentMileage={resolveCurrentOdometer(
				vehicleStatsData?.currentOdometer,
				vehicleStatsData?.currentMileage,
				vehicle.initialMileage
			)}
			initialMileage={vehicle.initialMileage ?? null}
			unitPreferences={vehicle.unitPreferences}
		/>
	{/if}

	{#if vehicle.financing.financingType === 'loan' && (!vehicle.financing.apr || vehicle.financing.apr <= 0)}
		<Alert>
			<CircleAlert class="h-4 w-4" />
			<AlertTitle>APR not set</AlertTitle>
			<AlertDescription>
				The APR (annual percentage rate) is not set for this loan. Some features like the
				amortization schedule and interest calculations will not be available.
			</AlertDescription>
		</Alert>
	{/if}

	{#if vehicle.financing.financingType === 'loan'}
		<PaymentPlannerDialog
			financing={vehicle.financing}
			bind:open={showPaymentPlanner}
			onPaymentAmountSaved={handlePaymentAmountChange}
			{nextPayment}
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
			<AlertTitle>Couldn't load payment history</AlertTitle>
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
					Retry
				</Button>
			</AlertDescription>
		</Alert>
	{:else}
		<PaymentHistory {payments} financing={vehicle.financing} />
	{/if}
{:else if loanHidden}
	<EmptyState>
		{#snippet icon()}
			<CreditCard class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			Loan details are private
		{/snippet}
		{#snippet description()}
			Only the owner can see this vehicle's loan or lease, unless they share it with you
		{/snippet}
	</EmptyState>
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
