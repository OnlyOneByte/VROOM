<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import {
		Calendar,
		DollarSign,
		Search,
		FileText,
		TrendingUp,
		X,
		Car,
		CircleAlert,
		Download,
		Upload,
		Images
	} from '@lucide/svelte';
	import { offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
	import { removeOfflineExpense } from '#lib/utils/offline-storage.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { expenseApi } from '#lib/services/expense-api.ts';
	import type { Expense, Vehicle, ExpenseSummary } from '#lib/types/index.ts';

	type ExpenseWithVehicle = Expense & { vehicle?: Vehicle };
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { extractUniqueTags } from '#lib/utils/expense-filters.ts';
	import { COMMON_MESSAGES, EXPENSE_MESSAGES } from '#lib/constants/messages.ts';
	import DateRangePicker from '#lib/components/common/date-range-picker.svelte';
	import Input from '#lib/components/ui/input/input.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as CardNs from '#lib/components/ui/card/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import ExpensesTable from '#lib/components/expenses/ExpensesTable.svelte';
	import FloatingActionButton from '#lib/components/common/floating-action-button.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import ExpenseTagFilter from '#lib/components/expenses/ExpenseTagFilter.svelte';
	import OfflineExpenseCards from '#lib/components/expenses/OfflineExpenseCards.svelte';
	import ExpenseOverviewSection from '#lib/components/expenses/ExpenseOverviewSection.svelte';
	import ImportExpensesDialog from '#lib/components/expenses/ImportExpensesDialog.svelte';
	import ImportFromPhotosDialog from '#lib/components/expenses/ImportFromPhotosDialog.svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { useExpenseListReload } from './expense-list-reload.svelte';

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let expenses = $state<Expense[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let summary = $state<ExpenseSummary | null>(null);

	let currentOffset = $state(0);
	let pageSize = $state(20);
	let totalCount = $state(0);
	let isLoadingPage = $state(false);

	let searchTerm = $state('');
	let selectedVehicleId = $state<string | undefined>(undefined);
	let startDate = $state<string | undefined>(undefined);
	let endDate = $state<string | undefined>(undefined);

	let selectedTags = $state<string[]>([]);
	let tagMatchMode = $state<'any' | 'all'>('any');

	let sortBy = $state<'date' | 'amount'>('date');
	let sortDir = $state<'asc' | 'desc'>('desc');

	let categoryFilter = $state<string>('');

	let pendingExpenses = $derived(
		offlineExpenseQueue.current.filter(expense => !expense.synced && !expense.needsAttention)
	);
	let needsAttentionExpenses = $derived(
		offlineExpenseQueue.current.filter(expense => !expense.synced && expense.needsAttention)
	);
	let syncedExpenses = $derived(offlineExpenseQueue.current.filter(expense => expense.synced));

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

	const expenseListReload = useExpenseListReload({
		ready: () => !isLoading,
		search: () => searchTerm,
		filterKey: () => JSON.stringify([startDate ?? '', endDate ?? '']),
		reload: handleFilterChange
	});

	onMount(loadInitial);

	async function loadInitial() {
		isLoading = true;
		loadError = null;
		try {
			const [, loadedVehicles] = await Promise.all([
				settingsStore.load(),
				vehicleApi.getVehicles(),
				fetchPageAndSummary()
			]);
			vehicles = loadedVehicles;
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Failed to load expenses';
			handleErrorWithNotification(error, 'Failed to load expenses');
		} finally {
			isLoading = false;
		}
	}

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

	function buildSummaryParams() {
		return {
			...(selectedVehicleId && { vehicleId: selectedVehicleId })
		};
	}

	async function fetchPageAndSummary(offset = 0) {
		isLoadingPage = true;
		try {
			const [pageResult, summaryResult] = await Promise.all([
				expenseApi.getAllExpenses(buildListParams(offset)),
				expenseApi.getExpenseSummary(buildSummaryParams())
			]);

			expenses = pageResult.data;
			totalCount = pageResult.pagination.totalCount;
			currentOffset = offset;
			summary = summaryResult;
		} catch (error) {
			if (isLoading) throw error;
			handleErrorWithNotification(error, 'Failed to load expenses');
		} finally {
			isLoadingPage = false;
		}
	}

	async function fetchPage(offset: number) {
		isLoadingPage = true;
		try {
			const pageResult = await expenseApi.getAllExpenses(buildListParams(offset));
			expenses = pageResult.data;
			totalCount = pageResult.pagination.totalCount;
			currentOffset = offset;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load expenses page:', error);
		} finally {
			isLoadingPage = false;
		}
	}

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

	function handleSortChange(by: 'date' | 'amount', dir: 'asc' | 'desc') {
		sortBy = by;
		sortDir = dir;
		currentOffset = 0;
		fetchPage(0);
	}

	function handleCategoryChange(category: string) {
		categoryFilter = category;
		currentOffset = 0;
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
		expenseListReload.reloadNow();
	}

	let isExporting = $state(false);
	async function handleExportCsv() {
		isExporting = true;
		try {
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
		await fetchPageAndSummary(currentOffset);
	}

	let vehicleById = $derived(new Map(vehicles.map(v => [v.id, v])));
	let displayExpenses = $derived<ExpenseWithVehicle[]>(
		expenses.map(expense => ({ ...expense, vehicle: vehicleById.get(expense.vehicleId) }))
	);
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
		<PageHeader
			title="All Expenses"
			description="Track and categorize expenses across all vehicles"
		>
			{#snippet actions()}
				<Button variant="outline" onclick={() => (photosImportOpen = true)}>
					<Images class="mr-2 h-4 w-4" />
					Import from Photos
				</Button>
				<Button variant="outline" onclick={() => (importOpen = true)}>
					<Upload class="mr-2 h-4 w-4" />
					Import CSV
				</Button>
				{#if totalCount > 0}
					<Button variant="outline" onclick={handleExportCsv} disabled={isExporting}>
						<Download class="mr-2 h-4 w-4" />
						{isExporting ? 'Exporting…' : 'Export CSV'}
					</Button>
				{/if}
			{/snippet}
		</PageHeader>

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
							aria-label="Search expenses and vehicles"
						/>
					</div>
					<div class="sm:w-56">
						<Select.Root
							type="single"
							value={selectedVehicleId ?? ''}
							onValueChange={handleVehicleChange}
						>
							<Select.Trigger aria-label="Vehicle filter" class="w-full">
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

				<ExpenseTagFilter
					{allTags}
					{selectedTags}
					{tagMatchMode}
					onTagsChange={handleTagsChange}
					onMatchModeChange={handleMatchModeChange}
				/>

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

		<ExpenseOverviewSection {summary} {statCards} />

		<OfflineExpenseCards
			{pendingExpenses}
			{needsAttentionExpenses}
			{syncedExpenses}
			onRemovePending={removeOfflineExpense}
			onRemoveNeedsAttention={removeOfflineExpense}
		/>

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

	<FloatingActionButton href={resolve(routes.expenseNew)} label={COMMON_MESSAGES.ADD_EXPENSE} />

	<ImportExpensesDialog bind:open={importOpen} {vehicles} onImported={handleImported} />
	<ImportFromPhotosDialog bind:open={photosImportOpen} {vehicles} onImported={handleImported} />
{/if}
