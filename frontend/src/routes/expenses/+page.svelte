<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Clock,
		CircleCheck,
		Calendar,
		DollarSign,
		Search,
		FileText,
		TrendingUp,
		X,
		Car,
		ChevronDown,
		Receipt,
		Tag
	} from 'lucide-svelte';
	import { offlineExpenseQueue } from '$lib/stores/offline.svelte';
	import { removeOfflineExpense } from '$lib/utils/offline-storage';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi } from '$lib/services/expense-api';
	import type { Expense, Vehicle, ExpenseCategory, ExpenseSummary } from '$lib/types';

	// Extended Expense type with vehicle info
	type ExpenseWithVehicle = Expense & { vehicle?: Vehicle };
	import { formatCurrency } from '$lib/utils/formatters';
	import { categoryLabels, getCategoryIcon, getCategoryColor } from '$lib/utils/expense-helpers';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { extractUniqueTags } from '$lib/utils/expense-filters';
	import { COMMON_MESSAGES, EXPENSE_MESSAGES } from '$lib/constants/messages';
	import { DISPLAY_LIMITS } from '$lib/constants/limits';
	import DateRangePicker from '$lib/components/common/date-range-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as CardNs from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import ExpensesTable from '$lib/components/expenses/ExpensesTable.svelte';
	import { StatCardGrid } from '$lib/components/charts';
	import FloatingActionButton from '$lib/components/common/floating-action-button.svelte';
	import PageHeader from '$lib/components/common/page-header.svelte';

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
	let summary = $state<ExpenseSummary | null>(null);

	// Pagination state
	let currentOffset = $state(0);
	let pageSize = $state(20);
	let totalCount = $state(0);
	let isLoadingPage = $state(false);

	// Filters and search
	let searchTerm = $state('');
	let selectedVehicleId = $state<string | undefined>(undefined);
	let selectedCategory = $state<string | undefined>(undefined);
	let startDate = $state<string | undefined>(undefined);
	let endDate = $state<string | undefined>(undefined);

	// Track previous date values to detect changes from the DateRangePicker binding
	let prevStartDate = $state<string | undefined>(undefined);
	let prevEndDate = $state<string | undefined>(undefined);

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

	// Collapsible state
	let overviewOpen = $state(false);

	let pendingExpenses = $derived(offlineExpenseQueue.current.filter(expense => !expense.synced));
	let syncedExpenses = $derived(offlineExpenseQueue.current.filter(expense => expense.synced));

	// Get all unique tags from expenses
	let allTags = $derived(extractUniqueTags(expenses));

	const statCards = $derived([
		{
			label: EXPENSE_MESSAGES.TOTAL_EXPENSES,
			value: formatCurrency(summary?.totalAmount ?? 0),
			icon: DollarSign,
			iconColor: 'primary'
		},
		{
			label: EXPENSE_MESSAGES.TOTAL_COUNT,
			value: (summary?.expenseCount ?? 0).toString(),
			icon: FileText,
			iconColor: 'chart-1'
		},
		{
			label: EXPENSE_MESSAGES.MONTHLY_AVERAGE,
			value: formatCurrency(summary?.monthlyAverage ?? 0),
			icon: TrendingUp,
			iconColor: 'chart-2'
		},
		{
			label: EXPENSE_MESSAGES.LAST_EXPENSE,
			value: formatCurrency(summary?.recentAmount ?? 0),
			icon: Calendar,
			iconColor: 'chart-5'
		}
	]);

	// Detect date range changes from the DateRangePicker binding (after initial load)
	$effect(() => {
		const s = startDate;
		const e = endDate;
		if (isLoading) return; // skip during initial mount
		if (s !== prevStartDate || e !== prevEndDate) {
			prevStartDate = s;
			prevEndDate = e;
			handleFilterChange();
		}
	});

	onMount(async () => {
		await settingsStore.load();
		const loadedVehicles = await vehicleApi.getVehicles();
		vehicles = loadedVehicles;
		await fetchPageAndSummary();
		isLoading = false;
	});

	/** Build the params object for the current filter state. */
	function buildListParams(offset: number) {
		return {
			limit: pageSize,
			offset,
			...(selectedVehicleId && { vehicleId: selectedVehicleId }),
			...(selectedCategory && { category: selectedCategory }),
			...(startDate && { startDate }),
			...(endDate && { endDate }),
			...(selectedTags.length > 0 && { tags: selectedTags })
		};
	}

	/** Build summary params from current filter state. */
	function buildSummaryParams() {
		return {
			...(selectedVehicleId && { vehicleId: selectedVehicleId })
		};
	}

	/** Fetch a page of expenses and the summary in parallel. */
	async function fetchPageAndSummary(offset = 0) {
		isLoadingPage = true;
		try {
			const [pageResult, summaryResult] = await Promise.all([
				expenseApi.getAllExpenses(buildListParams(offset)),
				expenseApi.getExpenseSummary(buildSummaryParams())
			]);

			expenses = pageResult.data.map(expense => ({
				...expense,
				vehicle: vehicles.find(v => v.id === expense.vehicleId)
			}));
			totalCount = pageResult.totalCount;
			currentOffset = offset;
			summary = summaryResult;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load expenses:', error);
		} finally {
			isLoadingPage = false;
		}
	}

	/** Fetch only the current page (used for pagination navigation). */
	async function fetchPage(offset: number) {
		isLoadingPage = true;
		try {
			const pageResult = await expenseApi.getAllExpenses(buildListParams(offset));
			expenses = pageResult.data.map(expense => ({
				...expense,
				vehicle: vehicles.find(v => v.id === expense.vehicleId)
			}));
			totalCount = pageResult.totalCount;
			currentOffset = offset;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load expenses page:', error);
		} finally {
			isLoadingPage = false;
		}
	}

	/** Called when any filter changes — reset to page 0 and re-fetch both. */
	function handleFilterChange() {
		currentOffset = 0;
		fetchPageAndSummary(0);
	}

	function handleVehicleChange(v: string) {
		selectedVehicleId = v === '' ? undefined : v;
		handleFilterChange();
	}

	function handlePageChange(offset: number) {
		fetchPage(offset);
	}

	function clearFilters() {
		searchTerm = '';
		tagSearchTerm = '';
		tagMatchMode = 'any';
		selectedVehicleId = undefined;
		selectedCategory = undefined;
		selectedTags = [];
		startDate = undefined;
		endDate = undefined;
		currentOffset = 0;
		fetchPageAndSummary(0);
	}

	function addTag(tag: string): void {
		if (!selectedTags.includes(tag)) {
			selectedTags = [...selectedTags, tag];
			handleFilterChange();
		}
		tagSearchTerm = '';
		tagSearchFocused = true;
		tagInputEl?.focus();
	}

	function removeTag(tag: string): void {
		selectedTags = selectedTags.filter(t => t !== tag);
		handleFilterChange();
	}

	function handleTagKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
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

	async function handleDeleteExpense(_deletedExpense: ExpenseWithVehicle) {
		// Re-fetch current page and summary after deletion
		await fetchPageAndSummary(currentOffset);
	}

	// Client-side search filter (applied on top of server-paginated data)
	let displayExpenses = $derived.by(() => {
		if (!searchTerm.trim()) return expenses;
		const term = searchTerm.toLowerCase();
		return expenses.filter(
			expense =>
				expense.description?.toLowerCase().includes(term) ||
				expense.category.toLowerCase().includes(term) ||
				expense.amount.toString().includes(term) ||
				expense.vehicle?.make?.toLowerCase().includes(term) ||
				expense.vehicle?.model?.toLowerCase().includes(term) ||
				expense.vehicle?.nickname?.toLowerCase().includes(term)
		);
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
		<Skeleton class="h-40 w-full" />
		<Skeleton class="h-64 w-full" />
	</div>
{:else}
	<div class="space-y-6 pb-24">
		<!-- Header -->
		<PageHeader
			title="All Expenses"
			description="Track and categorize expenses across all vehicles"
		/>

		<!-- Search, Vehicle & Filters -->
		<CardNs.Root>
			<CardNs.Header>
				<div class="flex items-center justify-between gap-3">
					<div>
						<CardNs.Title>Search & Filters</CardNs.Title>
						<CardNs.Description>Find and filter your expenses</CardNs.Description>
					</div>
					<div class="flex items-center gap-2">
						<DateRangePicker
							bind:startValue={startDate}
							bind:endValue={endDate}
							placeholder="Date range"
							class="w-auto"
						/>
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
							onValueChange={handleVehicleChange}
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
							class="border rounded-lg p-2 min-h-[42px] bg-background border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background"
						>
							<div class="flex flex-wrap gap-1.5 items-center">
								{#each selectedTags as tag (tag)}
									<Badge variant="secondary" class="gap-1 pr-1">
										{tag}
										<button
											type="button"
											onclick={() => removeTag(tag)}
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
										onkeydown={handleTagKeydown}
										onfocus={() => (tagSearchFocused = true)}
										onblur={() => setTimeout(() => (tagSearchFocused = false), 200)}
										placeholder={selectedTags.length > 0
											? 'Add more tags...'
											: 'Search and add tags...'}
										class="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
										aria-label="Search tags"
									/>
								</div>
							</div>
						</div>

						{#if tagSearchFocused && tagSuggestions.length > 0}
							<div
								class="absolute z-50 left-0 right-0 mt-1 border border-border rounded-lg shadow-lg bg-popover max-h-48 overflow-y-auto"
							>
								{#each tagSuggestions.slice(0, 8) as suggestion (suggestion)}
									<button
										type="button"
										onclick={() => addTag(suggestion)}
										class="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent text-sm"
									>
										<Tag class="h-3.5 w-3.5 text-muted-foreground" />
										{suggestion}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Clear Filters -->
				{#if searchTerm || selectedVehicleId || selectedTags.length > 0 || startDate || endDate}
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
									{formatCurrency(summary?.totalAmount ?? 0)} across {summary?.expenseCount ?? 0}
									expense{(summary?.expenseCount ?? 0) !== 1 ? 's' : ''}
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
						<StatCardGrid items={statCards} columns={4} />

						<!-- Category Breakdown -->
						{#if summary && summary.categoryBreakdown.length > 0}
							<div class="space-y-3">
								<div class="flex items-center gap-2">
									<Receipt class="h-4 w-4 text-muted-foreground" />
									<p class="text-sm font-medium">
										{EXPENSE_MESSAGES.EXPENSES_BY_CATEGORY}
									</p>
								</div>
								<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
									{#each summary.categoryBreakdown as item (item.category)}
										{@const IconComponent = getCategoryIcon(item.category as ExpenseCategory)}
										<div class="p-3 rounded-lg border hover:bg-muted/50 transition-colors">
											<div class="flex items-center gap-2">
												<div
													class="p-1.5 rounded-lg {getCategoryColor(
														item.category as ExpenseCategory
													)} shrink-0"
												>
													<IconComponent class="h-3.5 w-3.5" />
												</div>
												<span class="text-xs sm:text-sm font-medium">
													{categoryLabels[item.category as ExpenseCategory]}
												</span>
											</div>
											<p class="text-sm font-bold mt-1.5">
												{formatCurrency(item.amount)}
											</p>
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
						{#each pendingExpenses as expense (expense.id)}
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
								<Clock class="h-4 w-4 text-chart-5 flex-shrink-0" />
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
						{#each syncedExpenses.slice(0, DISPLAY_LIMITS.RECENT_SYNCED_EXPENSES) as expense (expense.id)}
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
								<CircleCheck class="h-4 w-4 text-chart-2" />
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
						<CardNs.Title>Expenses ({totalCount})</CardNs.Title>
						<CardNs.Description>All recorded expenses</CardNs.Description>
					</div>
					<div class="p-2 rounded-lg bg-primary/10">
						<DollarSign class="h-5 w-5 text-primary" />
					</div>
				</div>
			</CardNs.Header>
			<CardNs.Content>
				<ExpensesTable
					expenses={displayExpenses}
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
						selectedCategory ||
						selectedTags.length > 0 ||
						startDate ||
						endDate
					)}
					{totalCount}
					{currentOffset}
					{pageSize}
					{isLoadingPage}
					onPageChange={handlePageChange}
				/>
			</CardNs.Content>
		</CardNs.Root>
	</div>

	<!-- Floating Action Button -->
	<FloatingActionButton
		href="/expenses/new"
		label={COMMON_MESSAGES.ADD_EXPENSE}
		ariaLabel="Add expense"
	/>
{/if}
