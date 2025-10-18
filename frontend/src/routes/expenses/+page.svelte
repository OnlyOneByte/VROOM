<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Plus,
		Clock,
		CheckCircle,
		Calendar,
		DollarSign,
		Search,
		ListFilter,
		FileText,
		TrendingUp,
		X,
		Car,
		ChevronDown
	} from 'lucide-svelte';
	import { offlineExpenses } from '$lib/stores/offline';
	import { removeOfflineExpense } from '$lib/utils/offline-storage';
	import { settingsStore } from '$lib/stores/settings';
	import type { ExpenseCategory, ExpenseFilters } from '$lib/types.js';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { categoryLabels, getCategoryIcon, getCategoryColor } from '$lib/utils/expense-helpers';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Button } from '$lib/components/ui/button';
	import ExpensesTable from '$lib/components/expenses/ExpensesTable.svelte';

	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import * as Select from '$lib/components/ui/select';

	// Component state
	let loading = $state(true);
	let expenses = $state<any[]>([]);
	let vehicles = $state<any[]>([]);
	let filteredExpenses = $state<any[]>([]);

	// Filters and search
	let searchTerm = $state('');
	let selectedVehicleId = $state<string | undefined>(undefined);
	let filters = $state<ExpenseFilters>({});

	// Tag filter state
	let selectedTags = $state<string[]>([]);

	// Collapsible state for filter sections
	let basicFiltersOpen = $state(false);
	let tagsFilterOpen = $state(false);

	// Summary stats
	let summaryStats = $state({
		totalAmount: 0,
		expenseCount: 0,
		categoryTotals: {} as Record<string, number>,
		monthlyAverage: 0,
		lastExpenseDate: null as Date | null
	});

	let pendingExpenses = $derived($offlineExpenses.filter(expense => !expense.synced));
	let syncedExpenses = $derived($offlineExpenses.filter(expense => expense.synced));

	// Get all unique tags from expenses
	let allTags = $derived(Array.from(new Set(expenses.flatMap(e => e.tags || []))).sort());

	onMount(async () => {
		await settingsStore.load();
		await loadExpenses();
	});

	async function loadExpenses() {
		loading = true;
		try {
			// Load vehicles first to map vehicle info to expenses
			const vehiclesResponse = await fetch('/api/vehicles');
			if (vehiclesResponse.ok) {
				const vehiclesResult = await vehiclesResponse.json();
				vehicles = vehiclesResult.data || [];
			}

			// Load all expenses in a single request
			const expensesResponse = await fetch('/api/expenses');
			if (expensesResponse.ok) {
				const expensesResult = await expensesResponse.json();
				const allExpenses = expensesResult.data || [];

				// Map vehicle info to each expense
				expenses = allExpenses.map((expense: any) => ({
					...expense,
					vehicle: vehicles.find(v => v.id === expense.vehicleId)
				}));

				applyFiltersAndSort();
				calculateSummaryStats();
			}
		} catch (error) {
			console.error('Failed to load expenses:', error);
		} finally {
			loading = false;
		}
	}

	function applyFiltersAndSort() {
		let filtered = [...expenses];

		// Apply vehicle filter
		if (selectedVehicleId) {
			filtered = filtered.filter(expense => expense.vehicleId === selectedVehicleId);
		}

		// Apply search filter
		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(
				expense =>
					expense.description?.toLowerCase().includes(term) ||
					expense.tags?.some((tag: string) => tag.toLowerCase().includes(term)) ||
					expense.category.toLowerCase().includes(term) ||
					expense.amount.toString().includes(term) ||
					expense.vehicle?.make?.toLowerCase().includes(term) ||
					expense.vehicle?.model?.toLowerCase().includes(term) ||
					expense.vehicle?.nickname?.toLowerCase().includes(term)
			);
		}

		// Apply category filter
		if (filters.category) {
			filtered = filtered.filter(expense => expense.category === filters.category);
		}

		// Apply tags filter
		if (filters.tags && filters.tags.length > 0) {
			filtered = filtered.filter(expense => filters.tags!.some(tag => expense.tags?.includes(tag)));
		}

		// Apply date range filter
		if (filters.startDate) {
			filtered = filtered.filter(expense => new Date(expense.date) >= new Date(filters.startDate!));
		}
		if (filters.endDate) {
			filtered = filtered.filter(expense => new Date(expense.date) <= new Date(filters.endDate!));
		}

		filteredExpenses = filtered;
	}

	function calculateSummaryStats() {
		// Calculate stats based on filtered expenses
		const expensesToCalculate = selectedVehicleId
			? expenses.filter(e => e.vehicleId === selectedVehicleId)
			: expenses;

		const totalAmount = expensesToCalculate.reduce((sum, expense) => sum + expense.amount, 0);
		const categoryTotals = expensesToCalculate.reduce(
			(acc, expense) => {
				acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
				return acc;
			},
			{} as Record<string, number>
		);

		// Calculate monthly average (last 12 months)
		const twelveMonthsAgo = new Date();
		twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
		const recentExpenses = expensesToCalculate.filter(
			expense => new Date(expense.date) >= twelveMonthsAgo
		);
		const monthlyAverage =
			recentExpenses.length > 0
				? recentExpenses.reduce((sum, expense) => sum + expense.amount, 0) / 12
				: 0;

		const lastExpenseDate =
			expensesToCalculate.length > 0
				? new Date(
						Math.max(...expensesToCalculate.map(expense => new Date(expense.date).getTime()))
					)
				: null;

		summaryStats = {
			totalAmount,
			expenseCount: expensesToCalculate.length,
			categoryTotals,
			monthlyAverage,
			lastExpenseDate
		};
	}

	function handleSearch() {
		applyFiltersAndSort();
	}

	function handleFilterChange() {
		applyFiltersAndSort();
		calculateSummaryStats();
	}

	function clearFilters() {
		searchTerm = '';
		selectedVehicleId = undefined;
		selectedTags = [];
		filters = {};
		applyFiltersAndSort();
		calculateSummaryStats();
	}

	function toggleTag(tag: string): void {
		if (selectedTags.includes(tag)) {
			selectedTags = selectedTags.filter(t => t !== tag);
		} else {
			selectedTags = [...selectedTags, tag];
		}
		filters = { ...filters, tags: selectedTags.length > 0 ? selectedTags : undefined };
	}

	async function handleDeleteExpense(deletedExpense: any) {
		expenses = expenses.filter(e => e.id !== deletedExpense.id);
		applyFiltersAndSort();
		calculateSummaryStats();
	}

	// Reactive updates
	$effect(() => {
		handleSearch();
	});

	$effect(() => {
		handleFilterChange();
	});
</script>

<svelte:head>
	<title>Expenses - VROOM Car Tracker</title>
	<meta name="description" content="Track and manage your vehicle expenses" />
</svelte:head>

{#if loading}
	<div class="flex items-center justify-center py-12">
		<div class="loading-spinner h-8 w-8"></div>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold text-gray-900">All Expenses</h1>
				<p class="text-gray-600">Track and categorize expenses across all vehicles</p>
			</div>
		</div>

		<!-- Vehicle Filter -->
		<div class="card">
			<div class="flex items-center gap-3">
				<Car class="h-5 w-5 text-gray-600" />
				<Select.Root
					type="single"
					value={selectedVehicleId ?? ''}
					onValueChange={v => {
						selectedVehicleId = v === '' ? undefined : v;
						handleFilterChange();
					}}
				>
					<Select.Trigger class="flex-1">
						{#if selectedVehicleId}
							{@const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId)}
							{#if selectedVehicle}
								{getVehicleDisplayName(selectedVehicle)}
							{:else}
								All Vehicles
							{/if}
						{:else}
							All Vehicles
						{/if}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="" label="All Vehicles">All Vehicles</Select.Item>
						{#each vehicles as vehicle (vehicle.id)}
							<Select.Item value={vehicle.id} label={getVehicleDisplayName(vehicle)}>
								{getVehicleDisplayName(vehicle)}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<!-- Summary Cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Total Expenses</p>
						<p class="text-2xl font-bold text-gray-900">
							{formatCurrency(summaryStats.totalAmount)}
						</p>
					</div>
					<DollarSign class="h-8 w-8 text-primary-600" />
				</div>
			</div>

			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Total Count</p>
						<p class="text-2xl font-bold text-gray-900">{summaryStats.expenseCount}</p>
					</div>
					<FileText class="h-8 w-8 text-blue-600" />
				</div>
			</div>

			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Monthly Average</p>
						<p class="text-2xl font-bold text-gray-900">
							{formatCurrency(summaryStats.monthlyAverage)}
						</p>
					</div>
					<TrendingUp class="h-8 w-8 text-green-600" />
				</div>
			</div>

			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Last Expense</p>
						<p class="text-lg font-bold text-gray-900">
							{summaryStats.lastExpenseDate ? formatDate(summaryStats.lastExpenseDate) : 'None'}
						</p>
					</div>
					<Calendar class="h-8 w-8 text-orange-600" />
				</div>
			</div>
		</div>

		<!-- Category Summary -->
		{#if Object.keys(summaryStats.categoryTotals).length > 0}
			<div class="card">
				<h3 class="text-lg font-semibold text-gray-900 mb-4">Expenses by Category</h3>
				<div class="grid grid-cols-2 md:grid-cols-3 gap-4">
					{#each Object.entries(summaryStats.categoryTotals) as [category, amount]}
						{@const IconComponent = getCategoryIcon(category as ExpenseCategory)}
						<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
							<div class="flex items-center gap-2">
								<div class="p-2 rounded-lg {getCategoryColor(category as ExpenseCategory)}">
									<IconComponent class="h-4 w-4" />
								</div>
								<span class="text-sm font-medium text-gray-700"
									>{categoryLabels[category as ExpenseCategory]}</span
								>
							</div>
							<span class="text-sm font-bold text-gray-900">{formatCurrency(amount)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Offline Expenses Section -->
		{#if pendingExpenses.length > 0}
			<div class="card">
				<div class="flex items-center gap-2 mb-4">
					<Clock class="h-5 w-5 text-orange-500" />
					<h2 class="text-lg font-semibold text-gray-900">
						Pending Sync ({pendingExpenses.length})
					</h2>
				</div>

				<div class="space-y-3">
					{#each pendingExpenses as expense}
						<div
							class="flex items-center gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg"
						>
							<button
								onclick={() => removeOfflineExpense(expense.id)}
								class="text-gray-400 hover:text-red-600 transition-colors flex-shrink-0"
								title="Delete pending expense"
							>
								<X class="h-4 w-4" />
							</button>
							<div class="flex-1">
								<div class="flex items-center gap-2 mb-1">
									<span class="font-medium text-gray-900 capitalize">{expense.type}</span>
									<span class="text-sm text-gray-500">•</span>
									<span class="text-sm text-gray-600">{expense.date}</span>
								</div>
								<div class="text-sm text-gray-600">
									${expense.amount.toFixed(2)}
									{#if expense.description}
										• {expense.description}
									{/if}
								</div>
							</div>
							<Clock class="h-4 w-4 text-orange-500 flex-shrink-0" />
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Synced Offline Expenses -->
		{#if syncedExpenses.length > 0}
			<div class="card">
				<div class="flex items-center gap-2 mb-4">
					<CheckCircle class="h-5 w-5 text-green-500" />
					<h2 class="text-lg font-semibold text-gray-900">
						Recently Synced ({syncedExpenses.length})
					</h2>
				</div>

				<div class="space-y-3">
					{#each syncedExpenses.slice(0, 5) as expense}
						<div
							class="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg"
						>
							<div class="flex-1">
								<div class="flex items-center gap-2 mb-1">
									<span class="font-medium text-gray-900 capitalize">{expense.type}</span>
									<span class="text-sm text-gray-500">•</span>
									<span class="text-sm text-gray-600">{expense.date}</span>
								</div>
								<div class="text-sm text-gray-600">
									${expense.amount.toFixed(2)}
									{#if expense.description}
										• {expense.description}
									{/if}
								</div>
							</div>
							<CheckCircle class="h-4 w-4 text-green-500" />
						</div>
					{/each}
				</div>
			</div>
		{/if}

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
					/>
				</div>
			</div>

			<!-- Filter Sections -->
			<div class="border-t border-gray-200 divide-y divide-gray-200">
				<!-- Category and Date Filters -->
				<Collapsible bind:open={basicFiltersOpen}>
					<CollapsibleTrigger
						class="flex items-center justify-between w-full py-3 hover:bg-gray-50 transition-colors rounded-lg px-2"
					>
						<div class="flex items-center gap-2">
							<ListFilter class="h-4 w-4 text-gray-600" />
							<span class="font-medium text-gray-900">Category & Date Filters</span>
						</div>
						<ChevronDown
							class="h-4 w-4 text-gray-600 transition-transform duration-200 {basicFiltersOpen
								? 'rotate-180'
								: ''}"
						/>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div class="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 px-2">
							<!-- Category Filter -->
							<div>
								<label for="category-filter" class="block text-sm font-medium text-gray-700 mb-2"
									>Category</label
								>
								<Select.Root
									type="single"
									value={filters.category ?? ''}
									onValueChange={v => {
										filters.category = v === '' ? undefined : (v as ExpenseCategory);
										handleFilterChange();
									}}
								>
									<Select.Trigger id="category-filter" class="w-full">
										{#if filters.category}
											{categoryLabels[filters.category]}
										{:else}
											All Categories
										{/if}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="" label="All Categories">All Categories</Select.Item>
										{#each Object.entries(categoryLabels) as [value, label]}
											<Select.Item {value} {label}>{label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>

							<!-- Start Date -->
							<div>
								<label for="start-date-filter" class="block text-sm font-medium text-gray-700 mb-2"
									>Start Date</label
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
					</CollapsibleContent>
				</Collapsible>

				<!-- Tags Filter -->
				{#if allTags.length > 0}
					<Collapsible bind:open={tagsFilterOpen}>
						<CollapsibleTrigger
							class="flex items-center justify-between w-full py-3 hover:bg-gray-50 transition-colors rounded-lg px-2"
						>
							<div class="flex items-center gap-2">
								<FileText class="h-4 w-4 text-gray-600" />
								<span class="font-medium text-gray-900">Tags</span>
								{#if selectedTags.length > 0}
									<span
										class="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700"
									>
										{selectedTags.length} selected
									</span>
								{/if}
							</div>
							<ChevronDown
								class="h-4 w-4 text-gray-600 transition-transform duration-200 {tagsFilterOpen
									? 'rotate-180'
									: ''}"
							/>
						</CollapsibleTrigger>
						<CollapsibleContent>
							<div class="flex flex-wrap gap-2 pb-4 px-2">
								{#each allTags as tag}
									<button
										onclick={() => toggleTag(tag)}
										class="px-3 py-1 rounded-full text-sm font-medium transition-colors {selectedTags.includes(
											tag
										)
											? 'bg-primary-600 text-white'
											: 'bg-gray-100 text-gray-700 hover:bg-gray-200'}"
									>
										{tag}
									</button>
								{/each}
							</div>
						</CollapsibleContent>
					</Collapsible>
				{/if}
			</div>

			<!-- Clear Filters Button -->
			{#if searchTerm || selectedVehicleId || filters.category || selectedTags.length > 0 || filters.startDate || filters.endDate}
				<div class="flex justify-end pt-2">
					<button onclick={clearFilters} class="btn btn-outline inline-flex items-center gap-2">
						<X class="h-4 w-4" />
						Clear Filters
					</button>
				</div>
			{/if}
		</div>

		<!-- Expense List -->
		<div class="card">
			<div class="flex items-center justify-between mb-4">
				<h3 class="text-lg font-semibold text-gray-900">
					Expenses ({filteredExpenses.length})
				</h3>
			</div>

			<ExpensesTable
				expenses={filteredExpenses}
				{vehicles}
				showVehicleColumn={true}
				returnTo="/expenses"
				onDelete={handleDeleteExpense}
				emptyTitle="No expenses yet"
				emptyDescription="Start tracking your vehicle expenses to see insights and analytics."
				emptyActionLabel="Add First Expense"
				emptyActionHref="/expenses/new"
				scrollHeight="600px"
				onClearFilters={clearFilters}
				hasActiveFilters={!!(
					searchTerm ||
					selectedVehicleId ||
					filters.category ||
					selectedTags.length > 0 ||
					filters.startDate ||
					filters.endDate
				)}
			/>
		</div>
	</div>

	<!-- Floating Action Button -->
	<Button
		href="/expenses/new"
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
