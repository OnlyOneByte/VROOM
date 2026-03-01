<script lang="ts">
	import { onMount } from 'svelte';
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

	// Filters and search
	let searchTerm = $state('');
	let selectedVehicleId = $state<string | undefined>(undefined);
	let filters = $state<ExpenseFilters>({});

	// Tag filter state
	let selectedTags = $state<string[]>([]);
	let tagMatchMode = $state<'any' | 'all'>('any');
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
	let overviewOpen = $state(false);

	// Summary stats
	let summaryStats = $derived.by(() => {
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

		return {
			totalAmount,
			expenseCount: expensesToCalculate.length,
			categoryTotals,
			monthlyAverage,
			lastExpenseDate
		};
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
			color: 'text-primary',
			bgColor: 'bg-primary/10'
		},
		{
			label: EXPENSE_MESSAGES.TOTAL_COUNT,
			value: summaryStats.expenseCount.toString(),
			icon: FileText,
			color: 'text-chart-1',
			bgColor: 'bg-chart-1/10'
		},
		{
			label: EXPENSE_MESSAGES.MONTHLY_AVERAGE,
			value: formatCurrency(summaryStats.monthlyAverage),
			icon: TrendingUp,
			color: 'text-chart-2',
			bgColor: 'bg-chart-2/10'
		},
		{
			label: EXPENSE_MESSAGES.LAST_EXPENSE,
			value: summaryStats.lastExpenseDate ? formatDate(summaryStats.lastExpenseDate) : 'None',
			icon: Calendar,
			color: 'text-chart-5',
			bgColor: 'bg-chart-5/10'
		}
	]);

	onMount(async () => {
		await settingsStore.load();
		await loadExpenses();
	});

	async function loadExpenses() {
		isLoading = true;
		try {
			const [loadedVehicles, loadedExpenses] = await Promise.all([
				vehicleApi.getVehicles(),
				expenseApi.getAllExpenses()
			]);
			vehicles = loadedVehicles;

			expenses = loadedExpenses.map(expense => ({
				...expense,
				vehicle: vehicles.find(v => v.id === expense.vehicleId)
			}));
		} catch (error) {
			console.error('Failed to load expenses:', error);
		} finally {
			isLoading = false;
		}
	}

	// Derived: filtered expenses based on all filter state
	let filteredExpenses = $derived.by(() => {
		let filtered = [...expenses];

		if (selectedVehicleId) {
			filtered = filtered.filter(expense => expense.vehicleId === selectedVehicleId);
		}

		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(
				expense =>
					expense.description?.toLowerCase().includes(term) ||
					expense.category.toLowerCase().includes(term) ||
					expense.amount.toString().includes(term) ||
					expense.vehicle?.make?.toLowerCase().includes(term) ||
					expense.vehicle?.model?.toLowerCase().includes(term) ||
					expense.vehicle?.nickname?.toLowerCase().includes(term)
			);
		}

		if (filters.category) {
			filtered = filtered.filter(expense => expense.category === filters.category);
		}

		if (filters.tags && filters.tags.length > 0) {
			if (tagMatchMode === 'all') {
				filtered = filtered.filter(expense =>
					filters.tags!.every(tag => expense.tags?.includes(tag))
				);
			} else {
				filtered = filtered.filter(expense =>
					filters.tags!.some(tag => expense.tags?.includes(tag))
				);
			}
		}

		if (filters.startDate) {
			filtered = filtered.filter(expense => new Date(expense.date) >= new Date(filters.startDate!));
		}
		if (filters.endDate) {
			filtered = filtered.filter(expense => new Date(expense.date) <= new Date(filters.endDate!));
		}

		return filtered;
	});

	function clearFilters() {
		searchTerm = '';
		tagSearchTerm = '';
		tagMatchMode = 'any';
		selectedVehicleId = undefined;
		selectedTags = [];
		filters = {};
	}

	function addTag(tag: string): void {
		if (!selectedTags.includes(tag)) {
			selectedTags = [...selectedTags, tag];
			filters = { ...filters, tags: selectedTags.length > 0 ? selectedTags : undefined };
		}
		tagSearchTerm = '';
		tagSearchFocused = true;
		tagInputEl?.focus();
	}

	function removeTag(tag: string): void {
		selectedTags = selectedTags.filter(t => t !== tag);
		filters = { ...filters, tags: selectedTags.length > 0 ? selectedTags : undefined };
	}

	function handleTagKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			// Try exact match first, then first suggestion
			const exactMatch = allTags.find(
				t => !selectedTags.includes(t) && t.toLowerCase() === tagSearchTerm.trim().toLowerCase()
			);
			if (exactMatch) {
				addTag(exactMatch);
			} else if (tagSuggestions.length > 0) {
				const firstSuggestion = tagSuggestions[0];
				if (firstSuggestion) addTag(firstSuggestion);
			}
		} else if (e.key === 'Backspace' && !tagSearchTerm && selectedTags.length > 0) {
			const lastTag = selectedTags[selectedTags.length - 1];
			if (lastTag) removeTag(lastTag);
		} else if (e.key === 'Escape') {
			tagSearchFocused = false;
			tagInputEl?.blur();
		}
	}

	async function handleDeleteExpense(deletedExpense: ExpenseWithVehicle) {
		expenses = expenses.filter(e => e.id !== deletedExpense.id);
	}
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
		<Skeleton class="h-40 w-full" />
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

		<!-- Search, Vehicle & Filters (moved to top) -->
		<CardNs.Root>
			<CardNs.Header>
				<div class="flex items-center justify-between">
					<div>
						<CardNs.Title>Search & Filters</CardNs.Title>
						<CardNs.Description>Find and filter your expenses</CardNs.Description>
					</div>
					<div class="p-2 rounded-lg bg-accent">
						<Search class="h-5 w-5 text-accent-foreground" />
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
							placeholder="Search expenses, vehicles..."
							class="pl-10 w-full"
						/>
					</div>
					<div class="sm:w-56">
						<Select.Root
							type="single"
							value={selectedVehicleId ?? ''}
							onValueChange={v => {
								selectedVehicleId = v === '' ? undefined : v;
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

				<!-- Tag Search Input -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<p class="text-sm font-medium text-muted-foreground">Tags</p>
						{#if selectedTags.length > 1}
							<div
								class="flex items-center rounded-md border text-xs"
								role="radiogroup"
								aria-label="Tag match mode"
							>
								<button
									role="radio"
									aria-checked={tagMatchMode === 'any'}
									class="px-2.5 py-1 rounded-l-md transition-colors {tagMatchMode === 'any'
										? 'bg-primary text-primary-foreground'
										: 'text-muted-foreground hover:bg-muted'}"
									onclick={() => {
										tagMatchMode = 'any';
									}}
								>
									Any
								</button>
								<button
									role="radio"
									aria-checked={tagMatchMode === 'all'}
									class="px-2.5 py-1 rounded-r-md transition-colors {tagMatchMode === 'all'
										? 'bg-primary text-primary-foreground'
										: 'text-muted-foreground hover:bg-muted'}"
									onclick={() => {
										tagMatchMode = 'all';
									}}
								>
									All
								</button>
							</div>
						{/if}
					</div>
					<div class="relative">
						<div
							class="flex flex-wrap items-center gap-1.5 min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
							role="combobox"
							tabindex="-1"
							aria-expanded={tagSearchFocused && tagSuggestions.length > 0}
							aria-controls="tag-suggestions-list"
							onclick={() => tagInputEl?.focus()}
							onkeydown={e => {
								if (e.key === 'Enter' || e.key === ' ') tagInputEl?.focus();
							}}
						>
							{#each selectedTags as tag}
								<Badge variant="secondary" class="gap-1 pr-1">
									{tag}
									<button
										onclick={e => {
											e.stopPropagation();
											removeTag(tag);
										}}
										class="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
										aria-label="Remove tag {tag}"
									>
										<X class="h-3 w-3" />
									</button>
								</Badge>
							{/each}
							<div class="flex items-center gap-1.5 flex-1 min-w-[120px]">
								<Tag class="h-4 w-4 text-muted-foreground flex-shrink-0" />
								<input
									bind:this={tagInputEl}
									bind:value={tagSearchTerm}
									onfocus={() => (tagSearchFocused = true)}
									onblur={() => setTimeout(() => (tagSearchFocused = false), 300)}
									onkeydown={handleTagKeydown}
									placeholder={selectedTags.length > 0
										? 'Add more tags...'
										: 'Search and add tags...'}
									class="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
									aria-label="Search tags"
								/>
							</div>
						</div>

						{#if tagSearchFocused && tagSuggestions.length > 0}
							<div
								class="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md"
								role="listbox"
								id="tag-suggestions-list"
							>
								{#each tagSuggestions.slice(0, 8) as suggestion}
									<button
										onmousedown={e => {
											e.preventDefault();
											addTag(suggestion);
										}}
										class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
										role="option"
										aria-selected={false}
									>
										<Tag class="h-3.5 w-3.5 text-muted-foreground" />
										{suggestion}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Category and Date Filters -->
				<div class="border-t divide-y">
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

				<!-- Clear Filters -->
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

		<!-- Expense Overview (collapsible) -->
		<CardNs.Root>
			<Collapsible bind:open={overviewOpen}>
				<CardNs.Header class="pb-0">
					<CollapsibleTrigger class="flex items-center justify-between w-full">
						<div class="flex items-center gap-3">
							<div class="p-2 rounded-lg bg-chart-1/10">
								<TrendingUp class="h-5 w-5 text-chart-1" />
							</div>
							<div class="text-left">
								<CardNs.Title>Expense Overview</CardNs.Title>
								<CardNs.Description>
									{formatCurrency(summaryStats.totalAmount)} across {summaryStats.expenseCount}
									expense{summaryStats.expenseCount !== 1 ? 's' : ''}
								</CardNs.Description>
							</div>
						</div>
						<ChevronDown
							class="h-5 w-5 text-muted-foreground transition-transform duration-200 {overviewOpen
								? 'rotate-180'
								: ''}"
						/>
					</CollapsibleTrigger>
				</CardNs.Header>
				<CollapsibleContent>
					<CardNs.Content class="space-y-6">
						<!-- Stats Grid -->
						<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
							{#each statCards as stat}
								<div class="flex items-center justify-between p-4 rounded-lg border">
									<div class="space-y-1">
										<p class="text-sm font-medium text-muted-foreground">
											{stat.label}
										</p>
										<p class="text-xl font-bold">{stat.value}</p>
									</div>
									<div class="p-2.5 rounded-xl {stat.bgColor}">
										<stat.icon class="h-5 w-5 {stat.color}" />
									</div>
								</div>
							{/each}
						</div>

						<!-- Category Breakdown -->
						{#if Object.keys(summaryStats.categoryTotals).length > 0}
							<div class="space-y-3">
								<div class="flex items-center gap-2">
									<Receipt class="h-4 w-4 text-muted-foreground" />
									<p class="text-sm font-medium">
										{EXPENSE_MESSAGES.EXPENSES_BY_CATEGORY}
									</p>
								</div>
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
												<span class="text-sm font-medium">
													{categoryLabels[category as ExpenseCategory]}
												</span>
											</div>
											<span class="text-sm font-bold">
												{formatCurrency(amount)}
											</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</CardNs.Content>
				</CollapsibleContent>
			</Collapsible>
		</CardNs.Root>

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
						<div class="p-2 rounded-lg bg-chart-5/10">
							<Clock class="h-5 w-5 text-chart-5" />
						</div>
					</div>
				</CardNs.Header>
				<CardNs.Content>
					<div class="space-y-3">
						{#each pendingExpenses as expense}
							<div
								class="flex items-center gap-3 p-3 bg-chart-5/10 border border-chart-5/20 rounded-lg"
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
										<Badge variant="secondary" class="capitalize">
											{expense.category}
										</Badge>
										{#if expense.tags && expense.tags.length > 0}
											<span class="text-sm text-muted-foreground">
												{expense.tags.join(', ')}
											</span>
										{/if}
										<span class="text-sm text-muted-foreground">
											{expense.date}
										</span>
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
						<div class="p-2 rounded-lg bg-chart-2/10">
							<CircleCheck class="h-5 w-5 text-chart-2" />
						</div>
					</div>
				</CardNs.Header>
				<CardNs.Content>
					<div class="space-y-3">
						{#each syncedExpenses.slice(0, DISPLAY_LIMITS.RECENT_SYNCED_EXPENSES) as expense}
							<div
								class="flex items-center justify-between p-3 bg-chart-2/10 border border-chart-2/20 rounded-lg"
							>
								<div class="flex-1">
									<div class="flex items-center gap-2 mb-1">
										<Badge variant="secondary" class="capitalize">
											{expense.category}
										</Badge>
										{#if expense.tags && expense.tags.length > 0}
											<span class="text-sm text-muted-foreground">
												{expense.tags.join(', ')}
											</span>
										{/if}
										<span class="text-sm text-muted-foreground">
											{expense.date}
										</span>
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

		<!-- Expense List -->
		<CardNs.Root>
			<CardNs.Header>
				<div class="flex items-center justify-between">
					<div>
						<CardNs.Title>Expenses ({filteredExpenses.length})</CardNs.Title>
						<CardNs.Description>All recorded expenses</CardNs.Description>
					</div>
					<div class="p-2 rounded-lg bg-primary/10">
						<DollarSign class="h-5 w-5 text-primary" />
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
