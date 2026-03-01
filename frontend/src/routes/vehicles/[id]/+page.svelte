<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { Plus, Search, ListFilter, X, FileText, CreditCard, AlertCircle } from 'lucide-svelte';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Card, CardContent } from '$lib/components/ui/card';
	import * as CardFull from '$lib/components/ui/card';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import ExpensesTable from '$lib/components/expenses/ExpensesTable.svelte';
	import ExpenseTrendChart from '$lib/components/charts/ExpenseTrendChart.svelte';
	import FuelEfficiencyTrendChart from '$lib/components/charts/FuelEfficiencyTrendChart.svelte';
	import CategoryPieChart from '$lib/components/charts/CategoryPieChart.svelte';
	import VehicleHeader from '$lib/components/vehicles/VehicleHeader.svelte';
	import VehicleInfoCard from '$lib/components/vehicles/VehicleInfoCard.svelte';
	import ExpenseOverviewCard from '$lib/components/vehicles/ExpenseOverviewCard.svelte';
	import FuelEfficiencyStatsCard from '$lib/components/vehicles/FuelEfficiencyStatsCard.svelte';
	import PeriodSelector from '$lib/components/vehicles/PeriodSelector.svelte';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import FinancingSummaryHeader from '$lib/components/financing/FinancingSummaryHeader.svelte';
	import PaymentMetricsGrid from '$lib/components/financing/PaymentMetricsGrid.svelte';
	import FinancingCharts from '$lib/components/financing/FinancingCharts.svelte';
	import PaymentCalculator from '$lib/components/financing/PaymentCalculator.svelte';
	import PaymentHistory from '$lib/components/financing/PaymentHistory.svelte';
	import NextPaymentCard from '$lib/components/financing/NextPaymentCard.svelte';
	import LeaseMetricsCard from '$lib/components/financing/LeaseMetricsCard.svelte';
	import {
		prepareExpenseTrendData,
		prepareFuelEfficiencyData,
		prepareCategoryChartData,
		filterExpensesByPeriod,
		groupExpensesByCategory,
		categoryLabels
	} from '$lib/utils/expense-helpers';
	import {
		filterExpenses,
		hasActiveFilters as checkActiveFilters
	} from '$lib/utils/expense-filters';
	import { COMMON_MESSAGES, VEHICLE_MESSAGES, MAINTENANCE_MESSAGES } from '$lib/constants/messages';
	import {
		DAYS_IN_RECENT_PERIOD,
		MONTHS_IN_AVERAGE_PERIOD,
		type TimePeriod
	} from '$lib/constants/time-periods';
	import { SCROLL_HEIGHTS } from '$lib/constants/ui';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi } from '$lib/services/expense-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import {
		calculateAmortizationSchedule,
		calculateNextPaymentDate,
		calculatePayoffDate
	} from '$lib/utils/financing-calculations';
	import type {
		Vehicle,
		Expense,
		ExpenseFilters,
		VehicleStats,
		VehicleFinancingPayment
	} from '$lib/types.js';
	import type { PageData } from './$types';

	// Props from page load
	let { data }: { data: PageData } = $props();
	const vehicleId = data.vehicleId;

	// Component state
	let isLoading = $state(true);
	let isLoadingStats = $state(false);
	let isLoadingPayments = $state(false);
	let vehicle = $state<Vehicle | null>(null);
	let expenses = $state<Expense[]>([]);
	let payments = $state<VehicleFinancingPayment[]>([]);
	let showFilters = $state(false);
	let activeTab = $state('overview');
	let vehicleStatsData = $state<VehicleStats | null>(null);
	let selectedStatsPeriod = $state<TimePeriod>('all');
	let paymentHistoryError = $state<string | null>(null);
	let hasAttemptedPaymentLoad = $state(false);

	// Filters and search
	let searchTerm = $state('');
	let filters = $state<ExpenseFilters>({});

	// Derived state for charts and stats
	let expenseTrendData = $derived(prepareExpenseTrendData(expenses, selectedStatsPeriod));
	let fuelEfficiencyData = $derived(prepareFuelEfficiencyData(expenses));
	let periodFilteredExpenses = $derived(filterExpensesByPeriod(expenses, selectedStatsPeriod));
	let periodExpensesByCategory = $derived(groupExpensesByCategory(periodFilteredExpenses));
	let categoryChartData = $derived(prepareCategoryChartData(periodExpensesByCategory));

	// Filtered expenses based on search and filters
	let filteredExpenses = $derived(filterExpenses(expenses, searchTerm, filters));

	// Check if any filters are active
	let hasActiveFilters = $derived(checkActiveFilters(searchTerm, filters));

	// Local stats for quick calculations (complementary to API stats)
	let localStats = $derived.by(() => {
		const recentPeriodDate = new SvelteDate();
		recentPeriodDate.setDate(recentPeriodDate.getDate() - DAYS_IN_RECENT_PERIOD);

		const recentExpenses = expenses.filter(e => new Date(e.date) > recentPeriodDate);
		const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
		const recentAmount = recentExpenses.reduce((sum, e) => sum + e.amount, 0);

		// Calculate monthly average
		const averagePeriodDate = new SvelteDate();
		averagePeriodDate.setMonth(averagePeriodDate.getMonth() - MONTHS_IN_AVERAGE_PERIOD);
		const recentExpensesYear = expenses.filter(
			expense => new Date(expense.date) >= averagePeriodDate
		);
		const monthlyAverage =
			recentExpensesYear.length > 0
				? recentExpensesYear.reduce((sum, expense) => sum + expense.amount, 0) /
					MONTHS_IN_AVERAGE_PERIOD
				: 0;

		return {
			totalExpenses: totalAmount,
			recentExpenses: recentAmount,
			monthlyAverage
		};
	});

	let vehicleDisplayName = $derived(
		vehicle ? vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}` : ''
	);

	// Financing derived state with error handling
	let progressPercentage = $derived.by(() => {
		try {
			if (!vehicle?.financing?.isActive) return 0;
			const financing = vehicle.financing;
			if (!financing.originalAmount || financing.originalAmount <= 0) return 0;
			return (
				((financing.originalAmount - financing.currentBalance) / financing.originalAmount) * 100
			);
		} catch (error) {
			console.error('Error calculating progress percentage:', error);
			return 0;
		}
	});

	let totalInterestPaid = $derived.by(() => {
		try {
			return payments.reduce((sum, payment) => sum + (payment.interestAmount || 0), 0);
		} catch (error) {
			console.error('Error calculating total interest paid:', error);
			return 0;
		}
	});

	let estimatedPayoffDate = $derived.by(() => {
		try {
			const financing = vehicle?.financing;
			if (!financing || !financing.isActive) return new Date();
			return calculatePayoffDate(financing);
		} catch (error) {
			console.error('Error calculating payoff date:', error);
			return new Date();
		}
	});

	let nextPaymentDate = $derived.by(() => {
		try {
			const financing = vehicle?.financing;
			if (!financing || !financing.isActive) return new Date();
			const lastPayment =
				payments.length > 0 && payments[0] ? new Date(payments[0].paymentDate) : undefined;
			return calculateNextPaymentDate(financing, lastPayment);
		} catch (error) {
			console.error('Error calculating next payment date:', error);
			return new Date();
		}
	});

	let amortizationSchedule = $derived.by(() => {
		try {
			const financing = vehicle?.financing;
			if (!financing || !financing.isActive) return [];
			return calculateAmortizationSchedule(financing, payments.length);
		} catch (error) {
			console.error('Error calculating amortization schedule:', error);
			return [];
		}
	});

	// Load data on mount
	onMount(async () => {
		await Promise.all([loadVehicle(), loadExpenses()]);
		// Load stats after initial data is loaded
		if (vehicle && expenses.length > 0) {
			await loadVehicleStats();
		}
		isLoading = false;
	});

	// Reload stats when period changes
	$effect(() => {
		if (!isLoading && selectedStatsPeriod) {
			loadVehicleStats();
		}
	});

	// Load payment history when financing tab becomes active
	$effect(() => {
		if (
			activeTab === 'loan' &&
			vehicle?.financing?.isActive &&
			!hasAttemptedPaymentLoad &&
			!isLoadingPayments
		) {
			loadPaymentHistory();
		}
	});

	async function loadVehicle() {
		try {
			vehicle = await vehicleApi.getVehicle(vehicleId);
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load vehicle');
			goto('/dashboard');
		}
	}

	async function loadExpenses() {
		try {
			expenses = await expenseApi.getExpensesByVehicle(vehicleId);
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load expenses');
		}
	}

	async function loadVehicleStats() {
		isLoadingStats = true;
		try {
			vehicleStatsData = await vehicleApi.getVehicleStats(vehicleId, selectedStatsPeriod);
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load vehicle statistics');
		} finally {
			isLoadingStats = false;
		}
	}

	async function loadPaymentHistory() {
		if (!vehicle?.financing?.isActive) return;

		isLoadingPayments = true;
		paymentHistoryError = null;
		hasAttemptedPaymentLoad = true;

		try {
			payments = await vehicleApi.getFinancingPayments(vehicleId);
		} catch (error) {
			console.error('Error loading payment history:', error);
			paymentHistoryError = 'Failed to load payment history. Please try again.';
			// Don't show notification for payment history errors - show inline error instead
		} finally {
			isLoadingPayments = false;
		}
	}

	async function handleDeleteExpense(deletedExpense: Expense) {
		expenses = expenses.filter(e => e.id !== deletedExpense.id);
		// Reload stats after deletion
		await loadVehicleStats();
	}

	function clearFilters() {
		searchTerm = '';
		filters = {};
	}

	function handlePeriodChange(period: TimePeriod) {
		selectedStatsPeriod = period;
	}
</script>

<svelte:head>
	<title>{vehicleDisplayName} - VROOM Car Tracker</title>
	<meta name="description" content="Vehicle details and expense tracking" />
</svelte:head>

{#if isLoading}
	<div class="space-y-6">
		<!-- Header Skeleton -->
		<div class="flex items-center gap-4">
			<Skeleton class="h-10 w-10 rounded-md" />
			<div class="space-y-2">
				<Skeleton class="h-8 w-64" />
				<Skeleton class="h-5 w-48" />
			</div>
		</div>

		<!-- Tabs Skeleton -->
		<div class="space-y-6">
			<Skeleton class="h-10 w-full" />
			<div class="flex justify-end">
				<Skeleton class="h-10 w-[180px]" />
			</div>

			<!-- Stats Grid Skeleton -->
			<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
				{#each Array(4) as _}
					<Card>
						<CardContent class="p-6 space-y-2">
							<Skeleton class="h-4 w-24" />
							<Skeleton class="h-8 w-32" />
						</CardContent>
					</Card>
				{/each}
			</div>
		</div>
	</div>
{:else if vehicle}
	<div class="space-y-6">
		<!-- Header -->
		<VehicleHeader {vehicle} displayName={vehicleDisplayName} />

		<!-- Tabs Navigation -->
		<Tabs bind:value={activeTab} class="space-y-6">
			<TabsList class="grid w-full grid-cols-4">
				<TabsTrigger value="overview">Overview</TabsTrigger>
				<TabsTrigger value="expenses">Expenses</TabsTrigger>
				<TabsTrigger value="maintenance">Reminders</TabsTrigger>
				<TabsTrigger value="loan">Finance</TabsTrigger>
			</TabsList>

			<!-- Overview Tab -->
			<TabsContent value="overview" class="space-y-6">
				<!-- Vehicle Information Card -->
				<VehicleInfoCard {vehicle} />

				{#if expenses.length === 0}
					<!-- No Expenses Empty State -->
					<EmptyState>
						{#snippet icon()}
							<FileText class="h-12 w-12 text-muted-foreground mb-4" />
						{/snippet}
						{#snippet title()}
							{COMMON_MESSAGES.NO_EXPENSES}
						{/snippet}
						{#snippet description()}
							Start tracking expenses for this vehicle to see insights and trends
						{/snippet}
						{#snippet action()}
							<Button href="/expenses/new?vehicleId={vehicleId}&returnTo=/vehicles/{vehicleId}">
								<Plus class="h-4 w-4 mr-2" />
								{COMMON_MESSAGES.ADD_EXPENSE}
							</Button>
						{/snippet}
					</EmptyState>
				{:else}
					<!-- Period Selector -->
					<PeriodSelector
						selectedPeriod={selectedStatsPeriod}
						isLoading={isLoadingStats}
						onPeriodChange={handlePeriodChange}
					/>

					<!-- Expense Overview -->
					<ExpenseOverviewCard stats={localStats} />

					<!-- Mileage & Fuel Statistics -->
					<FuelEfficiencyStatsCard
						{vehicleId}
						{vehicleStatsData}
						{isLoadingStats}
						{selectedStatsPeriod}
					/>

					<!-- Trend Charts - Side by Side on Desktop -->
					<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
						<!-- Expense Trend Chart -->
						<ExpenseTrendChart
							data={expenseTrendData}
							period={selectedStatsPeriod}
							isLoading={isLoadingStats}
						/>

						<!-- Fuel Efficiency Trend Chart -->
						{#if vehicle}
							<FuelEfficiencyTrendChart
								data={fuelEfficiencyData}
								fuelType={vehicle.vehicleType || 'gas'}
								isLoading={isLoadingStats}
							/>
						{/if}
					</div>

					<!-- Expenses by Category with Pie Chart -->
					{#if categoryChartData.length > 0}
						<CategoryPieChart data={categoryChartData} isLoading={isLoadingStats} />
					{/if}
				{/if}
			</TabsContent>

			<!-- Expenses Tab -->
			<TabsContent value="expenses" class="space-y-6">
				<!-- Search and Filters -->
				<div class="card space-y-4">
					<!-- Search Bar -->
					<div class="flex gap-2">
						<div class="flex-1 relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
								<Search class="h-5 w-5 text-muted-foreground" />
							</div>
							<Input
								type="text"
								bind:value={searchTerm}
								placeholder={COMMON_MESSAGES.SEARCH_EXPENSES}
								class="pl-10 w-full"
								aria-label="Search expenses"
							/>
						</div>
						<Button
							variant="outline"
							onclick={() => (showFilters = !showFilters)}
							aria-label="Toggle filters"
							aria-expanded={showFilters}
							aria-controls="expense-filters"
						>
							<ListFilter class="h-4 w-4 mr-2" />
							{COMMON_MESSAGES.FILTERS}
						</Button>
					</div>

					<!-- Filter Panel -->
					{#if showFilters}
						<div id="expense-filters" class="border-t border-border pt-4 space-y-4">
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								<!-- Category Filter -->
								<div>
									<label
										for="category-filter"
										class="block text-sm font-medium text-muted-foreground mb-2">Category</label
									>
									<Select.Root
										type="single"
										value={filters.category ?? ''}
										onValueChange={v => {
											filters.category = v === '' ? undefined : v;
										}}
									>
										<Select.Trigger id="category-filter" class="w-full">
											{#if filters.category}
												{categoryLabels[filters.category as import('$lib/types').ExpenseCategory] ||
													filters.category}
											{:else}
												{COMMON_MESSAGES.ALL_CATEGORIES}
											{/if}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="" label={COMMON_MESSAGES.ALL_CATEGORIES}
												>{COMMON_MESSAGES.ALL_CATEGORIES}</Select.Item
											>
											{#each Object.entries(categoryLabels) as [value, label]}
												<Select.Item {value} {label}>{label}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>

								<!-- Start Date -->
								<div>
									<label
										for="start-date-filter"
										class="block text-sm font-medium text-muted-foreground mb-2">Start Date</label
									>
									<DatePicker
										id="start-date-filter"
										bind:value={filters.startDate}
										placeholder="Select start date"
									/>
								</div>

								<!-- End Date -->
								<div>
									<label
										for="end-date-filter"
										class="block text-sm font-medium text-muted-foreground mb-2">End Date</label
									>
									<DatePicker
										id="end-date-filter"
										bind:value={filters.endDate}
										placeholder="Select end date"
									/>
								</div>
							</div>

							<div class="flex justify-end">
								<Button variant="outline" onclick={clearFilters} aria-label="Clear all filters">
									<X class="h-4 w-4 mr-2" />
									{COMMON_MESSAGES.CLEAR_FILTERS}
								</Button>
							</div>
						</div>
					{/if}
				</div>

				<!-- Expense List -->
				<CardFull.Root>
					<CardFull.Header>
						<CardFull.Title>All Expenses ({filteredExpenses.length})</CardFull.Title>
					</CardFull.Header>
					<CardFull.Content>
						<ExpensesTable
							expenses={filteredExpenses}
							showVehicleColumn={false}
							returnTo="/vehicles/{vehicleId}"
							onDelete={handleDeleteExpense}
							emptyTitle={COMMON_MESSAGES.NO_EXPENSES}
							emptyDescription="Start tracking expenses for this vehicle"
							emptyActionLabel={COMMON_MESSAGES.ADD_EXPENSE}
							emptyActionHref="/expenses/new?vehicleId={vehicleId}&returnTo=/vehicles/{vehicleId}"
							scrollHeight={SCROLL_HEIGHTS.TABLE_DEFAULT}
							onClearFilters={clearFilters}
							{hasActiveFilters}
						/>
					</CardFull.Content>
				</CardFull.Root>
			</TabsContent>

			<!-- Maintenance Tab -->
			<TabsContent value="maintenance" class="space-y-6">
				<EmptyState>
					{#snippet icon()}
						<FileText class="h-12 w-12 text-muted-foreground mb-4" />
					{/snippet}
					{#snippet title()}
						{MAINTENANCE_MESSAGES.COMING_SOON}
					{/snippet}
					{#snippet description()}
						{MAINTENANCE_MESSAGES.COMING_SOON_DESC}
					{/snippet}
				</EmptyState>
			</TabsContent>

			<!-- Finance Tab -->
			<TabsContent value="loan" class="space-y-4 sm:space-y-6">
				{#if vehicle.financing?.isActive}
					<!-- Financing Summary Header -->
					{#if vehicle.financing.originalAmount && vehicle.financing.originalAmount > 0}
						<FinancingSummaryHeader financing={vehicle.financing} {progressPercentage} />
					{:else}
						<Alert variant="destructive">
							<AlertCircle class="h-4 w-4" />
							<AlertTitle>Invalid Financing Data</AlertTitle>
							<AlertDescription>
								The financing information for this vehicle is incomplete or invalid. Please update
								the financing details.
							</AlertDescription>
						</Alert>
					{/if}

					<!-- Payment Metrics Grid -->
					{#if vehicle.financing.paymentAmount && vehicle.financing.paymentAmount > 0}
						<PaymentMetricsGrid
							financing={vehicle.financing}
							{totalInterestPaid}
							{estimatedPayoffDate}
							{nextPaymentDate}
						/>
					{/if}

					<!-- Next Payment Card (Prominent) -->
					{#if vehicle.financing.paymentAmount && vehicle.financing.paymentAmount > 0}
						<NextPaymentCard
							financing={vehicle.financing}
							lastPayment={payments.length > 0 ? payments[0] : undefined}
						/>
					{/if}

					<!-- Lease Metrics (if applicable) -->
					{#if vehicle.financing.financingType === 'lease'}
						<LeaseMetricsCard
							financing={vehicle.financing}
							currentMileage={vehicle.initialMileage || null}
							initialMileage={vehicle.initialMileage || null}
						/>
					{/if}

					<!-- Missing APR Warning (for loans) -->
					{#if vehicle.financing.financingType === 'loan' && (!vehicle.financing.apr || vehicle.financing.apr <= 0)}
						<Alert>
							<AlertCircle class="h-4 w-4" />
							<AlertTitle>APR Not Set</AlertTitle>
							<AlertDescription>
								The APR (Annual Percentage Rate) is not set for this loan. Some features like the
								amortization schedule and interest calculations will not be available.
							</AlertDescription>
						</Alert>
					{/if}

					<!-- Charts Section - Responsive Grid -->
					<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
						<FinancingCharts financing={vehicle.financing} {payments} {amortizationSchedule} />
					</div>

					<!-- Payment Calculator (Loans only) -->
					{#if vehicle.financing.financingType === 'loan'}
						<PaymentCalculator financing={vehicle.financing} />
					{/if}

					<!-- Payment History Loading State -->
					{#if isLoadingPayments}
						<Card>
							<CardContent class="p-6 space-y-4">
								<div class="flex items-center gap-2">
									<Skeleton class="h-5 w-32" />
								</div>
								<div class="space-y-3">
									{#each Array(3) as _}
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
						<!-- Payment History Error -->
						<Alert variant="destructive">
							<AlertCircle class="h-4 w-4" />
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
						<!-- Payment History -->
						<PaymentHistory {payments} financing={vehicle.financing} />
					{/if}
				{:else}
					<!-- No Financing Empty State -->
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
			</TabsContent>
		</Tabs>
	</div>
{:else}
	<!-- Vehicle Not Found State -->
	<EmptyState>
		{#snippet icon()}
			<FileText class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			{VEHICLE_MESSAGES.VEHICLE_NOT_FOUND}
		{/snippet}
		{#snippet description()}
			{VEHICLE_MESSAGES.VEHICLE_NOT_FOUND_DESC}
		{/snippet}
		{#snippet action()}
			<Button onclick={() => goto('/dashboard')}>{VEHICLE_MESSAGES.BACK_TO_DASHBOARD}</Button>
		{/snippet}
	</EmptyState>
{/if}

<!-- Floating Action Button -->
{#if vehicle}
	<Button
		href="/expenses/new?vehicleId={vehicleId}&returnTo=/vehicles/{vehicleId}"
		class="
			fixed bottom-4 left-4 right-4 z-50 h-16 rounded-full
			sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto
			flex items-center justify-center gap-2 pl-6 pr-10
			bg-foreground hover:bg-foreground/90
			text-background shadow-2xl
			transition-all duration-300 sm:hover:scale-110
			border-0 group
		"
		aria-label="Add expense"
	>
		<Plus class="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" />
		<span class="font-bold text-lg">{COMMON_MESSAGES.ADD_EXPENSE}</span>
	</Button>
{/if}
