<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { Plus, Search, ListFilter, X, FileText } from 'lucide-svelte';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Card, CardContent } from '$lib/components/ui/card';
	import ExpensesTable from '$lib/components/expenses/ExpensesTable.svelte';
	import ExpenseTrendChart from '$lib/components/charts/ExpenseTrendChart.svelte';
	import FuelEfficiencyTrendChart from '$lib/components/charts/FuelEfficiencyTrendChart.svelte';
	import CategoryPieChart from '$lib/components/charts/CategoryPieChart.svelte';
	import VehicleHeader from '$lib/components/vehicles/VehicleHeader.svelte';
	import VehicleInfoCard from '$lib/components/vehicles/VehicleInfoCard.svelte';
	import ExpenseOverviewCard from '$lib/components/vehicles/ExpenseOverviewCard.svelte';
	import FuelEfficiencyStatsCard from '$lib/components/vehicles/FuelEfficiencyStatsCard.svelte';
	import FinancingCard from '$lib/components/vehicles/FinancingCard.svelte';
	import PeriodSelector from '$lib/components/vehicles/PeriodSelector.svelte';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
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
	import type { Vehicle, Expense, ExpenseFilters, VehicleStats } from '$lib/types.js';
	import type { PageData } from './$types';

	// Props from page load
	let { data }: { data: PageData } = $props();
	const vehicleId = data.vehicleId;

	// Component state
	let isLoading = $state(true);
	let isLoadingStats = $state(false);
	let vehicle = $state<Vehicle | null>(null);
	let expenses = $state<Expense[]>([]);
	let showFilters = $state(false);
	let activeTab = $state('overview');
	let vehicleStatsData = $state<VehicleStats | null>(null);
	let selectedStatsPeriod = $state<TimePeriod>('all');

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

					<!-- Expense Trend Chart -->
					<ExpenseTrendChart
						data={expenseTrendData}
						period={selectedStatsPeriod}
						isLoading={isLoadingStats}
					/>

					<!-- Fuel Efficiency Trend Chart -->
					{#if fuelEfficiencyData.length >= 2 && vehicle}
						<FuelEfficiencyTrendChart
							data={fuelEfficiencyData}
							fuelType={vehicle.vehicleType || 'gas'}
							isLoading={isLoadingStats}
						/>
					{/if}

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
								<Search class="h-5 w-5 text-gray-400" />
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
						<div id="expense-filters" class="border-t border-gray-200 pt-4 space-y-4">
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								<!-- Category Filter -->
								<div>
									<label for="category-filter" class="block text-sm font-medium text-gray-700 mb-2"
										>Category</label
									>
									<select id="category-filter" bind:value={filters.category} class="form-input">
										<option value={undefined}>{COMMON_MESSAGES.ALL_CATEGORIES}</option>
										{#each Object.entries(categoryLabels) as [value, label]}
											<option {value}>{label}</option>
										{/each}
									</select>
								</div>

								<!-- Start Date -->
								<div>
									<label
										for="start-date-filter"
										class="block text-sm font-medium text-gray-700 mb-2">Start Date</label
									>
									<DatePicker
										id="start-date-filter"
										bind:value={filters.startDate}
										placeholder="Select start date"
									/>
								</div>

								<!-- End Date -->
								<div>
									<label for="end-date-filter" class="block text-sm font-medium text-gray-700 mb-2"
										>End Date</label
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
				<div class="card">
					<div class="flex items-center justify-between mb-4">
						<h2 class="text-lg font-semibold text-gray-900">
							All Expenses ({filteredExpenses.length})
						</h2>
					</div>

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
				</div>
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
			<TabsContent value="loan" class="space-y-6">
				<FinancingCard {vehicle} />
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
			bg-gray-900 hover:bg-gray-800
			text-white shadow-2xl hover:shadow-gray-900/50
			transition-all duration-300 sm:hover:scale-110
			border-0 group
		"
		aria-label="Add expense"
	>
		<Plus class="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" />
		<span class="font-bold text-lg">{COMMON_MESSAGES.ADD_EXPENSE}</span>
	</Button>
{/if}
