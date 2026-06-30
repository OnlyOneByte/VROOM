<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
	import { Calendar, DollarSign, Search, FileText, TrendingUp, X, Car, CircleAlert, Download, Upload, Images } from '@lucide/svelte';
	import { offlineExpenseQueue } from '$lib/stores/offline.svelte';
	import { removeOfflineExpense } from '$lib/utils/offline-storage';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi } from '$lib/services/expense-api';
	import type { Expense, Vehicle, ExpenseSummary } from '$lib/types';

	// Extended Expense type with vehicle info
	type ExpenseWithVehicle = Expense & { vehicle?: Vehicle };
	import { formatCurrency } from '$lib/utils/formatters';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { extractUniqueTags } from '$lib/utils/expense-filters';
	import { COMMON_MESSAGES, EXPENSE_MESSAGES } from '$lib/constants/messages';
	import DateRangePicker from '$lib/components/common/date-range-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as CardNs from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import ExpensesTable from '$lib/components/expenses/ExpensesTable.svelte';
	import FloatingActionButton from '$lib/components/common/floating-action-button.svelte';
	import PageHeader from '$lib/components/common/page-header.svelte';
	import ExpenseTagFilter from '$lib/components/expenses/ExpenseTagFilter.svelte';
	import OfflineExpenseCards from '$lib/components/expenses/OfflineExpenseCards.svelte';
	import ExpenseOverviewSection from '$lib/components/expenses/ExpenseOverviewSection.svelte';
	import ImportExpensesDialog from '$lib/components/expenses/ImportExpensesDialog.svelte';
	import ImportFromPhotosDialog from '$lib/components/expenses/ImportFromPhotosDialog.svelte';
	import * as Select from '$lib/components/ui/select';

	// Component state
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
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
	let startDate = $state<string | undefined>(undefined);
	let endDate = $state<string | undefined>(undefined);

	// Track previous date values to detect changes from the DateRangePicker binding
	let prevStartDate = $state<string | undefined>(undefined);
	let prevEndDate = $state<string | undefined>(undefined);

	// Tag filter state
	let selectedTags = $state<string[]>([]);
	let tagMatchMode = $state<'any' | 'all'>('any');

	// Server-side sort state (default date desc — matches prior behavior).
	let sortBy = $state<'date' | 'amount'>('date');
	let sortDir = $state<'asc' | 'desc'>('desc');

	// Server-side category filter ('' = all). Owned here so it spans ALL pages, not
	// just the current 20-row slice (the table's local filter only narrowed the page).
	let categoryFilter = $state<string>('');

	// Partition the offline queue three ways. A PARKED row (needsAttention, #79) is unsynced but must NOT
	// appear in "Pending Sync" — it's not waiting to sync, it's permanently unsyncable until the user fixes
	// it. Surface it in its own "Needs attention" section so a malformed entry is visible, not silently
	// stuck (NORTH_STAR #1 — no silent loss). Mirrors getPendingExpenses/getNeedsAttentionExpenses, but over
	// the reactive in-memory queue so the lists update live as sync parks/clears rows.
	let pendingExpenses = $derived(
		offlineExpenseQueue.current.filter(expense => !expense.synced && !expense.needsAttention)
	);
	let needsAttentionExpenses = $derived(
		offlineExpenseQueue.current.filter(expense => !expense.synced && expense.needsAttention)
	);
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

	// Server-side search: debounce searchTerm changes and re-fetch page 0 so
	// matches on OTHER pages are found (client-side filtering only saw the
	// current 20-row page, which silently hid valid results).
	let searchDebounce: ReturnType<typeof setTimeout> | undefined;
	// Plain (non-reactive) guard: writing it must NOT re-trigger this effect,
	// otherwise the cleanup below would cancel the just-armed timer on the
	// self-triggered re-run and the search would never fire.
	let prevSearchTerm = '';
	$effect(() => {
		const term = searchTerm;
		if (isLoading) return; // skip during initial mount
		if (term === prevSearchTerm) return;
		prevSearchTerm = term;
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => handleFilterChange(), 300);
		// Cancel a pending debounce on the next searchTerm change or on unmount,
		// so we don't fire a fetch / setState after teardown.
		return () => clearTimeout(searchDebounce);
	});

	onMount(loadInitial);

	/**
	 * Initial page load. Previously these awaits were unguarded, so a failure in
	 * settings/vehicles/expenses left `isLoading` stuck `true` forever (permanent
	 * skeleton). Now a failure surfaces a persistent error + Retry, matching the
	 * insurance/dashboard/analytics routes.
	 */
	async function loadInitial() {
		isLoading = true;
		loadError = null;
		try {
			await settingsStore.load();
			vehicles = await vehicleApi.getVehicles();
			await fetchPageAndSummary();
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Failed to load expenses';
			handleErrorWithNotification(error, 'Failed to load expenses');
		} finally {
			isLoading = false;
		}
	}

	/** Build the params object for the current filter state. */
	function buildListParams(offset: number) {
		return {
			limit: pageSize,
			offset,
			...(selectedVehicleId && { vehicleId: selectedVehicleId }),
			...(startDate && { startDate }),
			...(endDate && { endDate }),
			...(selectedTags.length > 0 && { tags: selectedTags }),
			...(searchTerm.trim() && { search: searchTerm.trim() }),
			...(categoryFilter && { category: categoryFilter }),
			sortBy,
			sortDir
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
			totalCount = pageResult.pagination.totalCount;
			currentOffset = offset;
			summary = summaryResult;
		} catch (error) {
			// Re-throw during the initial load so loadInitial() can show the full-page
			// error+retry; for later filter/delete refreshes show a toast (the page is
			// already rendered, so a non-destructive notification is the right scope).
			if (isLoading) throw error;
			handleErrorWithNotification(error, 'Failed to load expenses');
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
			totalCount = pageResult.pagination.totalCount;
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

	/** Sort changed in the table — re-fetch from page 0 so the sort spans ALL pages. */
	function handleSortChange(by: 'date' | 'amount', dir: 'asc' | 'desc') {
		sortBy = by;
		sortDir = dir;
		currentOffset = 0;
		fetchPage(0);
	}

	/** Category changed in the table — re-fetch from page 0 so it filters ALL pages. */
	function handleCategoryChange(category: string) {
		categoryFilter = category;
		currentOffset = 0;
		// Re-fetch the page only (not the summary). The Expense Overview card is the
		// all-category total, scoped by vehicle only — same as search/date/tags, which
		// also don't rescope it. Keeping that consistent avoids changing the card's
		// meaning when a category is picked.
		fetchPage(0);
	}

	function clearFilters() {
		searchTerm = '';
		tagMatchMode = 'any';
		selectedVehicleId = undefined;
		selectedTags = [];
		startDate = undefined;
		endDate = undefined;
		categoryFilter = '';
		currentOffset = 0;
		fetchPageAndSummary(0);
	}

	let isExporting = $state(false);
	async function handleExportCsv() {
		isExporting = true;
		try {
			// Export mirrors EVERY active list filter (vehicle, category, date range,
			// search, tags) so the CSV is exactly what the user is viewing — not a
			// broader set. (Previously it omitted category/search/tags.)
			await expenseApi.downloadExpensesCsv({
				vehicleId: selectedVehicleId,
				category: categoryFilter || undefined,
				startDate,
				endDate,
				search: searchTerm.trim() || undefined,
				tags: selectedTags.length > 0 ? selectedTags : undefined
			});
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to export expenses');
		} finally {
			isExporting = false;
		}
	}

	// CSV import (dialog previews then commits). On success, reload from page 0 so
	// the freshly-imported rows are visible and counts/summary refresh.
	let importOpen = $state(false);
	let photosImportOpen = $state(false);
	function handleImported() {
		currentOffset = 0;
		fetchPageAndSummary(0);
	}

	function handleTagsChange(tags: string[]) {
		selectedTags = tags;
		handleFilterChange();
	}

	function handleMatchModeChange(mode: 'any' | 'all') {
		tagMatchMode = mode;
	}

	async function handleDeleteExpense(_deletedExpense: ExpenseWithVehicle) {
		// Re-fetch current page and summary after deletion
		await fetchPageAndSummary(currentOffset);
	}

	// Search is now applied server-side (description + category) across ALL pages,
	// so the rows we receive are already filtered — no client-side narrowing needed.
	// (The previous client-only filter silently missed matches on other pages.)
	let displayExpenses = $derived(expenses);
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
{:else if loadError}
	<!-- Error state: a failed initial load must surface a retry, not hang on the
	     skeleton forever (the previous unguarded onMount) nor render an empty list. -->
	<div class="space-y-6">
		<PageHeader
			title="All Expenses"
			description="Track and categorize expenses across all vehicles"
		/>
		<div class="rounded-lg border bg-card p-6">
			<div class="mb-4 flex items-center gap-3 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Failed to load expenses</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
			<Button onclick={loadInitial}>Retry</Button>
		</div>
	</div>
{:else}
	<div class="space-y-6 pb-24">
		<!-- Header -->
		<PageHeader
			title="All Expenses"
			description="Track and categorize expenses across all vehicles"
		>
			{#snippet actions()}
				<!-- Import is always available — a user with no expenses yet is exactly who
				     wants to import. Export only makes sense once there's something to export. -->
				<Button variant="outline" onclick={() => (importOpen = true)}>
					<Upload class="mr-2 h-4 w-4" />
					Import CSV
				</Button>
				<Button variant="outline" onclick={() => (photosImportOpen = true)}>
					<Images class="mr-2 h-4 w-4" />
					Import from Photos
				</Button>
				{#if totalCount > 0}
					<Button variant="outline" onclick={handleExportCsv} disabled={isExporting}>
						<Download class="mr-2 h-4 w-4" />
						{isExporting ? 'Exporting…' : 'Export CSV'}
					</Button>
				{/if}
			{/snippet}
		</PageHeader>

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
				<ExpenseTagFilter
					{allTags}
					{selectedTags}
					{tagMatchMode}
					onTagsChange={handleTagsChange}
					onMatchModeChange={handleMatchModeChange}
				/>

				<!-- Clear Filters. Mirror the SAME predicate as `hasActiveFilters` passed to
				     the table (and `clearFilters`, which resets categoryFilter): a category-only
				     filter is still an active filter, so the Clear affordance must appear for it. -->
				{#if searchTerm || selectedVehicleId || selectedTags.length > 0 || startDate || endDate || categoryFilter}
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
		<ExpenseOverviewSection {summary} {statCards} />

		<!-- Offline Expenses Section -->
		<OfflineExpenseCards
			{pendingExpenses}
			{needsAttentionExpenses}
			{syncedExpenses}
			onRemovePending={removeOfflineExpense}
			onRemoveNeedsAttention={removeOfflineExpense}
		/>

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
					returnTo={resolve(routes.expenses)}
					onDelete={handleDeleteExpense}
					emptyTitle={COMMON_MESSAGES.NO_EXPENSES}
					emptyDescription={EXPENSE_MESSAGES.NO_EXPENSES_DESC}
					emptyActionLabel={COMMON_MESSAGES.ADD_FIRST_EXPENSE}
					emptyActionHref={resolve(routes.expenseNew)}
					scrollHeight="600px"
					onClearFilters={clearFilters}
					hasActiveFilters={!!(
						searchTerm ||
						selectedVehicleId ||
						selectedTags.length > 0 ||
						startDate ||
						endDate ||
						categoryFilter
					)}
					{totalCount}
					{currentOffset}
					{pageSize}
					{isLoadingPage}
					onPageChange={handlePageChange}
					activeSortBy={sortBy}
					activeSortDir={sortDir}
					onSortChange={handleSortChange}
					activeCategory={categoryFilter}
					onCategoryChange={handleCategoryChange}
				/>
			</CardNs.Content>
		</CardNs.Root>
	</div>

	<!-- Floating Action Button -->
	<FloatingActionButton
		href={resolve(routes.expenseNew)}
		label={COMMON_MESSAGES.ADD_EXPENSE}
		ariaLabel="Add expense"
	/>

	<!-- CSV import dialog (previews via dryRun, then commits) -->
	<ImportExpensesDialog bind:open={importOpen} {vehicles} onImported={handleImported} />
	<ImportFromPhotosDialog bind:open={photosImportOpen} {vehicles} onImported={handleImported} />
{/if}
