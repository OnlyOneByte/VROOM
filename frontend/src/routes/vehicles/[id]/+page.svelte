<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { appStore } from '$lib/stores/app.js';
	import { settingsStore } from '$lib/stores/settings';
	import {
		getVolumeUnitLabel,
		getChargeUnitLabel,
		getDistanceUnitLabel,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel
	} from '$lib/utils/units';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import {
		ArrowLeft,
		Car,
		DollarSign,
		Gauge,
		CreditCard,
		Search,
		ListFilter,
		X,
		FileText,
		Settings,
		Plus
	} from 'lucide-svelte';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import StatCard from '$lib/components/ui/stat-card.svelte';
	import StatCardDual from '$lib/components/ui/stat-card-dual.svelte';
	import ExpensesTable from '$lib/components/expenses/ExpensesTable.svelte';
	import ExpenseTrendChart from '$lib/components/charts/ExpenseTrendChart.svelte';
	import FuelEfficiencyTrendChart from '$lib/components/charts/FuelEfficiencyTrendChart.svelte';
	import CategoryPieChart from '$lib/components/charts/CategoryPieChart.svelte';
	import {
		prepareExpenseTrendData,
		prepareFuelEfficiencyData,
		prepareCategoryChartData,
		filterExpensesByPeriod,
		groupExpensesByCategory,
		categoryLabels
	} from '$lib/utils/expense-helpers';
	import {
		PERIOD_OPTIONS,
		DAYS_IN_RECENT_PERIOD,
		MONTHS_IN_AVERAGE_PERIOD,
		isValidPeriod,
		type TimePeriod
	} from '$lib/constants/time-periods';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
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

	let selectedPeriodOption = $derived(
		PERIOD_OPTIONS.find(opt => opt.value === selectedStatsPeriod)
	);

	// Derived state for charts and stats
	let expenseTrendData = $derived(prepareExpenseTrendData(expenses, selectedStatsPeriod));
	let fuelEfficiencyData = $derived(prepareFuelEfficiencyData(expenses));
	let periodFilteredExpenses = $derived(filterExpensesByPeriod(expenses, selectedStatsPeriod));
	let periodExpensesByCategory = $derived(groupExpensesByCategory(periodFilteredExpenses));
	let categoryChartData = $derived(prepareCategoryChartData(periodExpensesByCategory));

	// Filtered expenses based on search and filters
	let filteredExpenses = $derived.by(() => {
		// Early return if no filters applied (performance optimization)
		if (
			!searchTerm &&
			!filters.category &&
			!filters.tags?.length &&
			!filters.startDate &&
			!filters.endDate
		) {
			return expenses;
		}

		let filtered = [...expenses];

		// Apply search filter
		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(
				expense =>
					expense.description?.toLowerCase().includes(term) ||
					expense.tags?.some(tag => tag.toLowerCase().includes(term)) ||
					expense.category.toLowerCase().includes(term) ||
					expense.amount.toString().includes(term)
			);
		}

		// Apply category filter
		if (filters.category) {
			filtered = filtered.filter(expense => expense.category === filters.category);
		}

		// Apply tags filter
		if (filters.tags && filters.tags.length > 0) {
			filtered = filtered.filter(expense => filters.tags!.some(tag => expense.tags.includes(tag)));
		}

		// Apply date range filter
		if (filters.startDate) {
			filtered = filtered.filter(expense => new Date(expense.date) >= new Date(filters.startDate!));
		}
		if (filters.endDate) {
			filtered = filtered.filter(expense => new Date(expense.date) <= new Date(filters.endDate!));
		}

		return filtered;
	});

	// Check if any filters are active
	let hasActiveFilters = $derived(
		searchTerm.trim() !== '' ||
			!!filters.category ||
			(filters.tags?.length ?? 0) > 0 ||
			!!filters.startDate ||
			!!filters.endDate
	);

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

		const lastExpenseDate =
			expenses.length > 0
				? new Date(Math.max(...expenses.map(e => new Date(e.date).getTime())))
				: null;

		return {
			totalExpenses: totalAmount,
			recentExpenses: recentAmount,
			expenseCount: expenses.length,
			monthlyAverage,
			lastExpenseDate
		};
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

	async function loadVehicle() {
		try {
			const response = await fetch(`/api/vehicles/${vehicleId}`, {
				credentials: 'include'
			});

			if (!response.ok) {
				appStore.addNotification({
					type: 'error',
					message: 'Vehicle not found'
				});
				goto('/dashboard');
				return;
			}

			const result = await response.json();
			vehicle = result.data || result;
		} catch (error) {
			console.error('Error loading vehicle:', error);
			appStore.addNotification({
				type: 'error',
				message: 'Error loading vehicle'
			});
			goto('/dashboard');
		} finally {
			isLoading = false;
		}
	}

	async function loadExpenses() {
		try {
			const response = await fetch(`/api/expenses?vehicleId=${vehicleId}`, {
				credentials: 'include'
			});

			if (response.ok) {
				const result = await response.json();
				const data = result.data || result || [];
				// Validate that we received an array
				expenses = Array.isArray(data) ? data : [];
				if (!Array.isArray(data)) {
					console.warn('Invalid expenses data received, expected array');
				}
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Failed to load expenses'
				});
			}
		} catch (error) {
			console.error('Error loading expenses:', error);
			appStore.addNotification({
				type: 'error',
				message: 'Failed to load expenses'
			});
		}
	}

	async function loadVehicleStats() {
		isLoadingStats = true;
		try {
			const response = await fetch(
				`/api/vehicles/${vehicleId}/stats?period=${selectedStatsPeriod}`,
				{
					credentials: 'include'
				}
			);

			if (response.ok) {
				const result = await response.json();
				vehicleStatsData = result.data;
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Failed to load vehicle statistics'
				});
			}
		} catch (error) {
			console.error('Error loading vehicle stats:', error);
			appStore.addNotification({
				type: 'error',
				message: 'Failed to load vehicle statistics'
			});
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

	function getVehicleDisplayName(): string {
		if (!vehicle) return '';
		return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
	}
</script>

<svelte:head>
	<title>{getVehicleDisplayName()} - VROOM Car Tracker</title>
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
		<div class="flex items-center gap-4">
			<Button
				variant="outline"
				size="icon"
				onclick={() => goto('/dashboard')}
				aria-label="Back to dashboard"
			>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<div>
				<h1 class="text-2xl font-bold text-gray-900">{getVehicleDisplayName()}</h1>
				<p class="text-gray-600">{vehicle.year} {vehicle.make} {vehicle.model}</p>
			</div>
		</div>

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
								href="/vehicles/{vehicleId}/edit"
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

				{#if expenses.length === 0}
					<!-- No Expenses Empty State -->
					<EmptyState>
						{#snippet icon()}
							<FileText class="h-12 w-12 text-muted-foreground mb-4" />
						{/snippet}
						{#snippet title()}
							No expenses yet
						{/snippet}
						{#snippet description()}
							Start tracking expenses for this vehicle to see insights and trends
						{/snippet}
						{#snippet action()}
							<Button href="/expenses/new?vehicleId={vehicleId}&returnTo=/vehicles/{vehicleId}">
								<Plus class="h-4 w-4 mr-2" />
								Add Expense
							</Button>
						{/snippet}
					</EmptyState>
				{:else}
					<!-- Period Selector -->
					<div class="flex justify-end">
						<Select.Root
							type="single"
							value={selectedStatsPeriod}
							onValueChange={value => {
								if (value && isValidPeriod(value)) {
									selectedStatsPeriod = value;
								}
							}}
						>
							<Select.Trigger
								class="w-[180px]"
								disabled={isLoadingStats}
								aria-label="Select time period"
							>
								<span class="flex items-center gap-2">
									{#if isLoadingStats}
										<span
											class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
										></span>
									{/if}
									{selectedPeriodOption?.label || 'Select period'}
								</span>
							</Select.Trigger>
							<Select.Content>
								{#each PERIOD_OPTIONS as option}
									<Select.Item value={option.value} label={option.label}>
										{option.label}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<!-- Expense Overview -->
					<Card>
						<CardHeader>
							<CardTitle class="flex items-center gap-2">
								<DollarSign class="h-5 w-5" />
								Expense Overview
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								<StatCard
									label="Total Expenses"
									value={formatCurrency(localStats.totalExpenses)}
									unit="all time"
								/>
								<StatCard
									label="Last 30 Days"
									value={formatCurrency(localStats.recentExpenses)}
									unit="recent spending"
								/>
								<StatCard
									label="Monthly Average"
									value={formatCurrency(localStats.monthlyAverage)}
									unit="last 12 months"
								/>
							</div>
						</CardContent>
					</Card>

					<!-- Mileage & Fuel Statistics -->
					{#if isLoadingStats}
						<Card>
							<CardHeader>
								<CardTitle class="flex items-center gap-2">
									<Gauge class="h-5 w-5" />
									Mileage & Fuel Statistics
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
									{#each Array(3) as _}
										<div class="flex flex-col p-4 rounded-lg border bg-card">
											<div class="flex items-start justify-between gap-4">
												<div class="flex-1 space-y-1">
													<Skeleton class="h-4 w-24" />
													<Skeleton class="h-8 w-20" />
												</div>
												<div class="w-px bg-border self-stretch my-1"></div>
												<div class="flex-1 space-y-1">
													<Skeleton class="h-4 w-20" />
													<Skeleton class="h-8 w-16" />
												</div>
											</div>
										</div>
									{/each}
								</div>
							</CardContent>
						</Card>
					{:else if vehicleStatsData && vehicleStatsData.fuelExpenseCount > 0}
						<Card>
							<CardHeader>
								<CardTitle class="flex items-center gap-2">
									<Gauge class="h-5 w-5" />
									Mileage & Fuel Statistics
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
									{#if vehicleStatsData.currentMileage !== null}
										<StatCardDual
											label="Current {$settingsStore.settings?.distanceUnit === 'kilometers'
												? 'Odometer'
												: 'Mileage'}"
											value={vehicleStatsData.currentMileage.toLocaleString()}
											unit={getDistanceUnitLabel(
												$settingsStore.settings?.distanceUnit || 'miles',
												false
											)}
											secondaryLabel="{$settingsStore.settings?.distanceUnit === 'kilometers'
												? 'Distance'
												: 'Miles'} Driven"
											secondaryValue={vehicleStatsData.totalMileage.toLocaleString()}
											secondaryUnit={selectedStatsPeriod === 'all'
												? 'lifetime'
												: `in ${selectedStatsPeriod}`}
										/>
									{/if}

									{#if vehicleStatsData.totalFuelConsumed > 0}
										<StatCardDual
											label="Fuel Consumed"
											value={vehicleStatsData.totalFuelConsumed.toFixed(1)}
											unit={getVolumeUnitLabel(
												$settingsStore.settings?.volumeUnit || 'gallons_us',
												true
											)}
											secondaryLabel="Total Fuel Cost"
											secondaryValue={formatCurrency(vehicleStatsData.totalFuelCost)}
											secondaryUnit="{vehicleStatsData.fuelExpenseCount} fill-ups"
										/>
									{/if}

									{#if vehicleStatsData.totalChargeConsumed > 0}
										<StatCardDual
											label="Charge Consumed"
											value={vehicleStatsData.totalChargeConsumed.toFixed(1)}
											unit={getChargeUnitLabel($settingsStore.settings?.chargeUnit || 'kwh', true)}
											secondaryLabel="Total Charge Cost"
											secondaryValue={formatCurrency(vehicleStatsData.totalFuelCost)}
											secondaryUnit="{vehicleStatsData.fuelExpenseCount} charges"
										/>
									{/if}

									{#if vehicleStatsData.averageMpg !== null}
										<StatCardDual
											label="Average {getFuelEfficiencyLabel(
												$settingsStore.settings?.distanceUnit || 'miles',
												$settingsStore.settings?.volumeUnit || 'gallons_us'
											)}"
											value={vehicleStatsData.averageMpg.toFixed(1)}
											unit="fuel efficiency"
											secondaryLabel="Cost per {getDistanceUnitLabel(
												$settingsStore.settings?.distanceUnit || 'miles',
												true
											)}"
											secondaryValue={vehicleStatsData.costPerMile !== null
												? formatCurrency(vehicleStatsData.costPerMile)
												: 'N/A'}
											secondaryUnit="fuel only"
										/>
									{/if}

									{#if vehicleStatsData.averageMilesPerKwh !== null}
										<StatCardDual
											label="Efficiency"
											value={vehicleStatsData.averageMilesPerKwh.toFixed(2)}
											unit={getElectricEfficiencyLabel(
												$settingsStore.settings?.distanceUnit || 'miles',
												$settingsStore.settings?.chargeUnit || 'kwh'
											)}
											secondaryLabel="Cost per {getDistanceUnitLabel(
												$settingsStore.settings?.distanceUnit || 'miles',
												true
											)}"
											secondaryValue={vehicleStatsData.costPerMile !== null
												? formatCurrency(vehicleStatsData.costPerMile)
												: 'N/A'}
											secondaryUnit="charge only"
										/>
									{/if}
								</div>
							</CardContent>
						</Card>
					{:else if vehicleStatsData}
						<EmptyState>
							{#snippet icon()}
								<Gauge class="h-12 w-12 text-muted-foreground mb-4" />
							{/snippet}
							{#snippet title()}
								No fuel data yet
							{/snippet}
							{#snippet description()}
								Add fuel expenses with mileage to see detailed fuel statistics
							{/snippet}
							{#snippet action()}
								<Button
									href="/expenses/new?vehicleId={vehicleId}&returnTo=/vehicles/{vehicleId}&category=fuel"
								>
									<Plus class="h-4 w-4 mr-2" />
									Add Fuel Expense
								</Button>
							{/snippet}
						</EmptyState>
					{/if}

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
								placeholder="Search expenses..."
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
							Filters
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
										<option value={undefined}>All Categories</option>
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
									Clear Filters
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
						emptyTitle="No expenses yet"
						emptyDescription="Start tracking expenses for this vehicle"
						emptyActionLabel="Add Expense"
						emptyActionHref="/expenses/new?vehicleId={vehicleId}&returnTo=/vehicles/{vehicleId}"
						scrollHeight="600px"
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
						Maintenance reminders coming soon
					{/snippet}
					{#snippet description()}
						Set up reminders for oil changes, tire rotations, and more
					{/snippet}
				</EmptyState>
			</TabsContent>

			<!-- Finance Tab -->
			<TabsContent value="loan" class="space-y-6">
				{#if vehicle.financing?.isActive}
					<Card>
						<CardHeader>
							<CardTitle class="flex items-center gap-2">
								<CreditCard class="h-5 w-5" />
								{vehicle.financing.financingType === 'loan'
									? 'Loan'
									: vehicle.financing.financingType === 'lease'
										? 'Lease'
										: 'Financing'} Information
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
								<div class="capitalize">
									<StatCard label="Type" value={vehicle.financing.financingType} />
								</div>
								<StatCard
									label={vehicle.financing.financingType === 'loan'
										? 'Lender'
										: vehicle.financing.financingType === 'lease'
											? 'Leasing Company'
											: 'Provider'}
									value={vehicle.financing.provider}
								/>
								<StatCard
									label="Current Balance"
									value={formatCurrency(vehicle.financing.currentBalance)}
								/>
								<StatCard
									label="Original Amount"
									value={formatCurrency(vehicle.financing.originalAmount)}
								/>

								{#if vehicle.financing.apr !== undefined && vehicle.financing.apr !== null}
									<StatCard label="APR" value="{vehicle.financing.apr}%" />
								{/if}

								<StatCard
									label="{vehicle.financing.financingType === 'lease' ? 'Lease' : ''} Payment"
									value={formatCurrency(vehicle.financing.paymentAmount)}
								/>
								<StatCard label="Term" value={vehicle.financing.termMonths} unit="months" />

								{#if vehicle.financing.financingType === 'lease'}
									{#if vehicle.financing.residualValue}
										<StatCard
											label="Residual Value"
											value={formatCurrency(vehicle.financing.residualValue)}
										/>
									{/if}

									{#if vehicle.financing.mileageLimit}
										<StatCard
											label="Annual {$settingsStore.settings?.distanceUnit === 'kilometers'
												? 'Distance'
												: 'Mileage'} Limit"
											value={vehicle.financing.mileageLimit.toLocaleString()}
											unit={getDistanceUnitLabel(
												$settingsStore.settings?.distanceUnit || 'miles',
												false
											)}
										/>
									{/if}

									{#if vehicle.financing.excessMileageFee}
										<StatCard
											label="Excess {$settingsStore.settings?.distanceUnit === 'kilometers'
												? 'Distance'
												: 'Mileage'} Fee"
											value={formatCurrency(vehicle.financing.excessMileageFee)}
											unit="/{getDistanceUnitLabel(
												$settingsStore.settings?.distanceUnit || 'miles',
												true
											)}"
										/>
									{/if}
								{/if}
							</div>

							<!-- Progress Bar -->
							<div class="mt-6 pt-6 border-t">
								<div class="flex justify-between text-sm text-muted-foreground mb-2">
									<span>
										{vehicle.financing.financingType === 'loan'
											? 'Loan'
											: vehicle.financing.financingType === 'lease'
												? 'Lease'
												: 'Payment'} Progress
									</span>
									<span class="font-semibold">
										{Math.round(
											((vehicle.financing.originalAmount - vehicle.financing.currentBalance) /
												vehicle.financing.originalAmount) *
												100
										)}% paid
									</span>
								</div>
								<div class="w-full bg-secondary rounded-full h-3">
									<div
										class="bg-primary h-3 rounded-full transition-all duration-300"
										style="width: {((vehicle.financing.originalAmount -
											vehicle.financing.currentBalance) /
											vehicle.financing.originalAmount) *
											100}%"
									></div>
								</div>
							</div>
						</CardContent>
					</Card>
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
			</TabsContent>
		</Tabs>
	</div>
{:else}
	<!-- Vehicle Not Found State -->
	<EmptyState>
		{#snippet icon()}
			<Car class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			Vehicle not found
		{/snippet}
		{#snippet description()}
			The vehicle you're looking for doesn't exist or you don't have access to it.
		{/snippet}
		{#snippet action()}
			<Button onclick={() => goto('/dashboard')}>Back to Dashboard</Button>
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
		<span class="font-bold text-lg">Add Expense</span>
	</Button>
{/if}
