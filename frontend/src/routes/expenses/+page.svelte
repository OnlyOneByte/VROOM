<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		Plus,
		Clock,
		CircleCheck,
		Calendar,
		DollarSign,
		Search,
		ListFilter,
		FileText,
		TrendingUp,
		X,
		Car,
		ChevronDown,
		Receipt,
		Tag
	} from 'lucide-svelte';
	import { offlineExpenses } from '$lib/stores/offline';
	import { removeOfflineExpense } from '$lib/utils/offline-storage';
	import { settingsStore } from '$lib/stores/settings';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi } from '$lib/services/expense-api';
	import type { Expense, Vehicle, ExpenseCategory, ExpenseFilters } from '$lib/types.js';

	// Extended Expense type with vehicle info
	type ExpenseWithVehicle = Expense & { vehicle?: Vehicle };
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { categoryLabels, getCategoryIcon, getCategoryColor } from '$lib/utils/expense-helpers';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { extractUniqueTags } from '$lib/utils/expense-filters';
	import { COMMON_MESSAGES, EXPENSE_MESSAGES } from '$lib/constants/messages';
	import { DISPLAY_LIMITS } from '$lib/constants/limits';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent } from '$lib/components/ui/card';
	import * as CardNs from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import ExpensesTable from '$lib/components/expenses/ExpensesTable.svelte';

	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import * as Select from '$lib/components/ui/select';

	// Component state
	let isLoading = $state(true);
	let expenses = $state<ExpenseWithVehicle[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let filteredExpenses = $state<ExpenseWithVehicle[]>([]);

	// Filters and search
	let searchTerm = $state('');
	let selectedVehicleId = $state<string | undefined>(undefined);
	let filters = $state<ExpenseFilters>({});

	// Tag filter state
	let selectedTags = $state<string[]>([]);
	let tagSearchTerm = $state('');
	let tagSearchFocused = $state(false);
	let tagInputEl = $state<HTMLInputElement | null>(null);

	// Filtered tag suggestions based on search input
	let tagSuggestions = $derived.by(() => {
		if (!tagSearchTerm.trim()) return allTags.filter(t => !selectedTags.includes(t));
		const term = tagSearchTerm.toLowerCase();
		return allTags.filter(t => !selectedTags.includes(t) && t.toLowerCase().includes(term));
	});

	// Collapsible state for filter sections
	let basicFiltersOpen = $state(false);

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
	let allTags = $derived(extractUniqueTags(expenses));

	const statCards = $derived([
		{
			label: EXPENSE_MESSAGES.TOTAL_EXPENSES,
			value: formatCurrency(summaryStats.totalAmount),
			icon: DollarSign,
			color: 'text-primary-600',
			bgColor: 'bg-primary-50'
		},
		{
			label: EXPENSE_MESSAGES.TOTAL_COUNT,
			value: summaryStats.expenseCount.toString(),
			icon: FileText,
			color: 'text-blue-600',
			bgColor: 'bg-blue-50'
		},
		{
			label: EXPENSE_MESSAGES.MONTHLY_AVERAGE,
			value: formatCurrency(summaryStats.monthlyAverage),
			icon: TrendingUp,
			color: 'text-green-600',
			bgColor: 'bg-green-50'
		},
		{
			label: EXPENSE_MESSAGES.LAST_EXPENSE,
			value: summaryStats.lastExpenseDate ? formatDate(summaryStats.lastExpenseDate) : 'None',
			icon: Calendar,
			color: 'text-orange-600',
			bgColor: 'bg-orange-50'
		}
	]);

	onMount(async () => {
		await settingsStore.load();
		await loadExpenses();
	});

	async function loadExpenses() {
		isLoading = true;
		try {
			// Load vehicles and expenses in parallel via API services
			const [loadedVehicles, loadedExpenses] = await Promise.all([
				vehicleApi.getVehicles(),
				expenseApi.getAllExpenses()
			]);
			vehicles = loadedVehicles;

			// Map vehicle info to each expense
			expenses = loadedExpenses.map(expense => ({
				...expense,
				vehicle: vehicles.find(v => v.id === expense.vehicleId)
			}));

			applyFiltersAndSort();
			calculateSummaryStats();
		} catch (error) {
			console.error('Failed to load expenses:', error);
		} finally {
			isLoading = false;
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
					expense.tags?.some(tag => tag.toLowerCase().includes(term)) ||
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

	function addTag(tag: string): void {
		if (!selectedTags.includes(tag)) {
			selectedTags = [...selectedTags, tag];
			filters = { ...filters, tags: selectedTags.length > 0 ? selectedTags : undefined };
		}
		tagSearchTerm = '';
		tagSearchFocused = false;
	}

	function removeTag(tag: string): void {
		selectedTags = selectedTags.filter(t => t !== tag);
		filters = { ...filters, tags: selectedTags.length > 0 ? selectedTags : undefined };
	}

	function handleTagKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && tagSuggestions.length > 0) {
			e.preventDefault();
			addTag(tagSuggestions[0]);
		} else if (e.key === 'Backspace' && !tagSearchTerm && selectedTags.length > 0) {
			removeTag(selectedTags[selectedTags.length - 1]);
		} else if (e.key === 'Escape') {
			tagSearchFocused = false;
			tagInputEl?.blur();
		}
	}

	async function handleDeleteExpense(deletedExpense: ExpenseWithVehicle) {
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

{#if isLoading}
	<div class="space-y-6">
		<div>
			<Skeleton class="h-8 w-48 mb-2" />
			<Skeleton class="h-5 w-72" />
		</div>
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
			{#each Array(4) as _, i (i)}
				<Card>
					<CardContent class="p-6">
						<div class="space-y-3">
							<Skeleton class="h-4 w-24" />
							<Skeleton class="h-8 w-32" />
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
		<Skeleton class="h-64 w-full" />
	</div>
{:else}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold tracking-tight">All Expenses</h1>
				<p class="text-muted-foreground mt-1">Track and categorize expenses across all vehicles</p>
			</div>
		</div>

		<!-- Summary Stats Cards -->
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
			{#each statCards as stat}
				<Card>
					<CardContent class="p-6">
						<div class="flex items-center justify-between">
							<div class="space-y-1">
								<p class="text-sm font-medium text-muted-foreground">{stat.label}</p>
								<p class="text-2xl font-bold">{stat.value}</p>
							</div>
							<div class="p-3 rounded-xl {stat.bgColor}">
								<stat.icon class="h-6 w-6 {stat.color}" />
							</div>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>

		<!-- Category Summary -->
		{#if Object.keys(summaryStats.categoryTotals).length > 0}
			<CardNs.Root>
				<CardNs.Header>
					<div class="flex items-center justify-between">
						<div>
							<CardNs.Title>{EXPENSE_MESSAGES.EXPENSES_BY_CATEGORY}</CardNs.Title>
							<CardNs.Description>Breakdown of spending by type</CardNs.Description>
						</div>
						<div class="p-2 rounded-lg bg-blue-50">
							<Receipt class="h-5 w-5 text-blue-600" />
						</div>
					</div>
				</CardNs.Header>
				<CardNs.Content>
					<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
						{#each Object.entries(summaryStats.categoryTotals) as [category, amount]}
							{@const IconComponent = getCategoryIcon(category as ExpenseCategory)}
							<div
								class="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
							>
								<div class="flex items-center gap-2">
									<div class="p-2 rounded-lg {getCategoryColor(category as ExpenseCategory)}">
										<IconComponent class="h-4 w-4" />
									</div>
									<span class="text-sm font-medium"
										>{categoryLabels[category as ExpenseCategory]}</span
									>
								</div>
								<span class="text-sm font-bold">{formatCurrency(amount)}</span>
							</div>
						{/each}
					</div>
				</CardNs.Content>
			</CardNs.Root>
		{/if}

		<!-- Offline Expenses Section -->
		{#if pendingExpenses.length > 0}
			<CardNs.Root>
				<CardNs.Header>
					<div class="flex items-center justify-between">
						<div>
							<CardNs.Title>
								{EXPENSE_MESSAGES.PENDING_SYNC} ({pendingExpenses.length})
							</CardNs.Title>
							<CardNs.Description>These expenses are waiting to be synced</CardNs.Description>
						</div>
						<div class="p-2 rounded-lg bg-orange-50">
							<Clock class="h-5 w-5 text-orange-600" />
						</div>
					</div>
				</CardNs.Header>
				<CardNs.Content>
					<div class="space-y-3">
						{#each pendingExpenses as expense}
							<div
								class="flex items-center gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg"
							>
								<button
									onclick={() => removeOfflineExpense(expense.id)}
									class="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
									title="Delete pending expense"
								>
									<X class="h-4 w-4" />
								</button>
								<div class="flex-1">
									<div class="flex items-center gap-2 mb-1">
										<Badge variant="secondary" class="capitalize">{expense.category}</Badge>
										{#if expense.tags && expense.tags.length > 0}
											<span class="text-sm text-muted-foreground">{expense.tags.join(', ')}</span>
										{/if}
										<span class="text-sm text-muted-foreground">{expense.date}</span>
									</div>
									<div class="text-sm text-muted-foreground">
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
				</CardNs.Content>
			</CardNs.Root>
		{/if}

		<!-- Synced Offline Expenses -->
		{#if syncedExpenses.length > 0}
			<CardNs.Root>
				<CardNs.Header>
					<div class="flex items-center justify-between">
						<div>
							<CardNs.Title>
								{EXPENSE_MESSAGES.RECENTLY_SYNCED} ({syncedExpenses.length})
							</CardNs.Title>
							<CardNs.Description>Successfully synced to the server</CardNs.Description>
						</div>
						<div class="p-2 rounded-lg bg-green-50">
							<CircleCheck class="h-5 w-5 text-green-600" />
						</div>
					</div>
				</CardNs.Header>
				<CardNs.Content>
					<div class="space-y-3">
						{#each syncedExpenses.slice(0, DISPLAY_LIMITS.RECENT_SYNCED_EXPENSES) as expense}
							<div
								class="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg"
							>
								<div class="flex-1">
									<div class="flex items-center gap-2 mb-1">
										<Badge variant="secondary" class="capitalize">{expense.category}</Badge>
										{#if expense.tags && expense.tags.length > 0}
											<span class="text-sm text-muted-foreground">{expense.tags.join(', ')}</span>
										{/if}
										<span class="text-sm text-muted-foreground">{expense.date}</span>
									</div>
									<div class="text-sm text-muted-foreground">
										${expense.amount.toFixed(2)}
										{#if expense.description}
											• {expense.description}
										{/if}
									</div>
								</div>
								<CircleCheck class="h-4 w-4 text-green-500" />
							</div>
						{/each}
					</div>
				</CardNs.Content>
			</CardNs.Root>
		{/if}

		<!-- Search, Vehicle & Filters -->
		<CardNs.Root>
			<CardNs.Header>
				<div class="flex items-center justify-between">
					<div>
						<CardNs.Title>Search & Filters</CardNs.Title>
						<CardNs.Description>Find and filter your expenses</CardNs.Description>
					</div>
					<div class="p-2 rounded-lg bg-purple-50">
						<Search class="h-5 w-5 text-purple-600" />
					</div>
				</div>
			</CardNs.Header>
			<CardNs.Content class="space-y-4">
				<!-- Search Bar + Vehicle Selector Row -->
				<div class="flex flex-col sm:flex-row gap-3">
					<div class="flex-1 relative">
						<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
							<Search class="h-5 w-5 text-muted-foreground" />
						</div>
						<Input
							type="text"
							bind:value={searchTerm}
							placeholder="Search expenses, tags, vehicles..."
							class="pl-10 w-full"
						/>
					</div>
					<div class="sm:w-56">
						<Select.Root
							type="single"
							value={selectedVehicleId ?? ''}
							onValueChange={v => {
								selectedVehicleId = v === '' ? undefined : v;
								handleFilterChange();
							}}
						>
							<Select.Trigger class="w-full">
								<div class="flex items-center gap-2">
									<Car class="h-4 w-4 text-muted-foreground flex-shrink-0" />
									<span class="truncate">
										{#if selectedVehicleId}
											{@const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId)}
											{selectedVehicle
												? getVehicleDisplayName(selectedVehicle)
												: COMMON_MESSAGES.ALL_VEHICLES}
										{:else}
											{COMMON_MESSAGES.ALL_VEHICLES}
										{/if}
									</span>
								</div>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="" label={COMMON_MESSAGES.ALL_VEHICLES}
									>{COMMON_MESSAGES.ALL_VEHICLES}</Select.Item
								>
								{#each vehicles as vehicle (vehicle.id)}
									<Select.Item value={vehicle.id} label={getVehicleDisplayName(vehicle)}>
										{getVehicleDisplayName(vehicle)}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				<!-- Active Tag Filters (always visible when tags exist) -->
				{#if allTags.length > 0}
					<div class="space-y-2">
						<p class="text-sm font-medium text-muted-foreground">Tags</p>
						<div class="flex flex-wrap gap-2">
							{#each allTags as tag}
								<button
									onclick={() => toggleTag(tag)}
									class="px-3 py-1 rounded-full text-sm font-medium transition-colors {selectedTags.includes(
										tag
									)
										? 'bg-primary text-primary-foreground'
										: 'bg-muted text-muted-foreground hover:bg-accent'}"
								>
									{tag}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Filter Sections -->
				<div class="border-t divide-y">
					<!-- Category and Date Filters -->
					<Collapsible bind:open={basicFiltersOpen}>
						<CollapsibleTrigger
							class="flex items-center justify-between w-full py-3 hover:bg-muted/50 transition-colors rounded-lg px-2"
						>
							<div class="flex items-center gap-2">
								<ListFilter class="h-4 w-4 text-muted-foreground" />
								<span class="font-medium">Category & Date Filters</span>
							</div>
							<ChevronDown
								class="h-4 w-4 text-muted-foreground transition-transform duration-200 {basicFiltersOpen
									? 'rotate-180'
									: ''}"
							/>
						</CollapsibleTrigger>
						<CollapsibleContent>
							<div class="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 px-2">
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
											filters.category = v === '' ? undefined : (v as ExpenseCategory);
											handleFilterChange();
										}}
									>
										<Select.Trigger id="category-filter" class="w-full">
											{#if filters.category}
												{categoryLabels[filters.category]}
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
						</CollapsibleContent>
					</Collapsible>
				</div>

				<!-- Clear Filters Button -->
				{#if searchTerm || selectedVehicleId || filters.category || selectedTags.length > 0 || filters.startDate || filters.endDate}
					<div class="flex justify-end pt-2">
						<Button variant="outline" size="sm" onclick={clearFilters}>
							<X class="h-4 w-4 mr-2" />
							{COMMON_MESSAGES.CLEAR_FILTERS}
						</Button>
					</div>
				{/if}
			</CardNs.Content>
		</CardNs.Root>

		<!-- Expense List -->
		<CardNs.Root>
			<CardNs.Header>
				<div class="flex items-center justify-between">
					<div>
						<CardNs.Title>Expenses ({filteredExpenses.length})</CardNs.Title>
						<CardNs.Description>All recorded expenses</CardNs.Description>
					</div>
					<div class="p-2 rounded-lg bg-primary-50">
						<DollarSign class="h-5 w-5 text-primary-600" />
					</div>
				</div>
			</CardNs.Header>
			<CardNs.Content>
				<ExpensesTable
					expenses={filteredExpenses}
					{vehicles}
					showVehicleColumn={true}
					returnTo="/expenses"
					onDelete={handleDeleteExpense}
					emptyTitle={COMMON_MESSAGES.NO_EXPENSES}
					emptyDescription={EXPENSE_MESSAGES.NO_EXPENSES_DESC}
					emptyActionLabel={COMMON_MESSAGES.ADD_FIRST_EXPENSE}
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
			</CardNs.Content>
		</CardNs.Root>
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
		<span class="font-bold text-lg">{COMMON_MESSAGES.ADD_EXPENSE}</span>
	</Button>
{/if}
