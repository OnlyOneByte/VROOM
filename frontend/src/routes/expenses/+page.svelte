<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { focusLeftOn } from '#lib/utils/focus.ts';
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
		Images,
		Ellipsis,
		LoaderCircle,
		Plus,
		SlidersHorizontal,
		WifiOff
	} from '@lucide/svelte';
	import { offlineExpenseQueue, onlineStatus } from '#lib/stores/offline.svelte.ts';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import { removeOfflineExpense } from '#lib/utils/offline-storage.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { expenseApi } from '#lib/services/expense-api.ts';
	import type { Expense, Vehicle, ExpenseSummary, PaginatedResponse } from '#lib/types/index.ts';
	import { latest } from '#lib/utils/latest-request.ts';

	type ExpenseWithVehicle = Expense & { vehicle?: Vehicle };
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import {
		handleErrorWithNotification,
		userFacingErrorMessage
	} from '#lib/utils/error-handling.ts';
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
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import ExpenseTagFilter from '#lib/components/expenses/ExpenseTagFilter.svelte';
	import OfflineExpenseCards from '#lib/components/expenses/OfflineExpenseCards.svelte';
	import ExpenseOverviewSection from '#lib/components/expenses/ExpenseOverviewSection.svelte';
	import ImportExpensesDialog from '#lib/components/expenses/ImportExpensesDialog.svelte';
	import ImportFromPhotosDialog from '#lib/components/expenses/ImportFromPhotosDialog.svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import * as Sheet from '#lib/components/ui/sheet/index.ts';
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
			label: EXPENSE_MESSAGES.LAST_30_DAYS,
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

	let offlineLoad = $state(false);
	let isRetryingLoad = $state(false);
	let loadFailures = $state(0);
	let expensesHeading = $state<HTMLElement | null>(null);

	onMount(loadInitial);

	$effect(() => {
		if (offlineLoad && onlineStatus.current) untrack(loadInitial);
	});

	async function loadInitial() {
		isLoading = loadError === null;
		offlineLoad = false;
		try {
			const [, loadedVehicles] = await Promise.all([
				settingsStore.load(),
				vehicleApi.getVehicles(),
				fetchPageAndSummary(0, { throwOnFailure: true })
			]);
			vehicles = loadedVehicles;
			loadError = null;
		} catch (error) {
			if (onlineStatus.current) {
				loadError = userFacingErrorMessage(error);
				loadFailures += 1;
				handleErrorWithNotification(error, "Couldn't load expenses");
			} else {
				loadError = null;
				offlineLoad = true;
			}
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

	const nextListRequest = latest();
	const nextSummaryRequest = latest();
	let pageError = $state<{ message: string; offset: number } | null>(null);

	function applyPage(pageResult: PaginatedResponse<Expense>, offset: number) {
		expenses = pageResult.data;
		totalCount = pageResult.pagination.totalCount;
		currentOffset = offset;
		pageError = null;
	}

	function failPage(error: unknown, offset: number) {
		pageError = {
			message: userFacingErrorMessage(error),
			offset
		};
		handleErrorWithNotification(error, "Couldn't load expenses");
	}

	async function fetchPageAndSummary(offset = 0, { throwOnFailure = false } = {}) {
		const isCurrentList = nextListRequest();
		const isCurrentSummary = nextSummaryRequest();
		isLoadingPage = true;
		try {
			const [pageResult, summaryResult] = await Promise.allSettled([
				expenseApi.getAllExpenses(buildListParams(offset)),
				expenseApi.getExpenseSummary(buildSummaryParams())
			]);
			if (throwOnFailure) {
				if (pageResult.status === 'rejected') throw pageResult.reason;
				if (summaryResult.status === 'rejected') throw summaryResult.reason;
			}

			const listReported = isCurrentList();
			if (listReported) {
				if (pageResult.status === 'fulfilled') applyPage(pageResult.value, offset);
				else failPage(pageResult.reason, offset);
			}
			if (isCurrentSummary()) {
				if (summaryResult.status === 'fulfilled') summary = summaryResult.value;
				else if (!listReported || pageResult.status === 'fulfilled')
					handleErrorWithNotification(summaryResult.reason, "Couldn't load the expense summary");
			}
		} finally {
			if (isCurrentList()) isLoadingPage = false;
		}
	}

	async function fetchPage(offset: number) {
		const isCurrent = nextListRequest();
		isLoadingPage = true;
		try {
			const pageResult = await expenseApi.getAllExpenses(buildListParams(offset));
			if (isCurrent()) applyPage(pageResult, offset);
		} catch (error) {
			if (isCurrent()) failPage(error, offset);
		} finally {
			if (isCurrent()) isLoadingPage = false;
		}
	}

	async function focusExpensesAfter(origin: Element | null) {
		await tick();
		if (focusLeftOn(origin)) expensesHeading?.focus();
	}

	async function retryLoad() {
		if (isRetryingLoad) return;
		const origin = document.activeElement;
		isRetryingLoad = true;
		try {
			await loadInitial();
		} finally {
			isRetryingLoad = false;
		}
		if (!loadError && !offlineLoad) await focusExpensesAfter(origin);
	}

	async function retryPage() {
		if (isLoadingPage) return;
		const origin = document.activeElement;
		await fetchPageAndSummary(pageError?.offset ?? currentOffset);
		if (!pageError) await focusExpensesAfter(origin);
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
			handleErrorWithNotification(err, "Couldn't export the expenses");
		} finally {
			isExporting = false;
		}
	}

	let importOpen = $state(false);
	let photosImportOpen = $state(false);
	let toolsMenuOpen = $state(false);
	let filtersSheetOpen = $state(false);
	let sheetFilterCount = $derived(
		(selectedVehicleId ? 1 : 0) + (startDate || endDate ? 1 : 0) + selectedTags.length
	);
	function openTool(open: () => void) {
		toolsMenuOpen = false;
		open();
	}
	async function exportFromTools() {
		await handleExportCsv();
		toolsMenuOpen = false;
	}
	function handleImported() {
		currentOffset = 0;
		fetchPageAndSummary(0);
	}

	function handleTagsChange(tags: string[]) {
		selectedTags = tags;
		handleFilterChange();
	}

	async function handleDeleteExpense(_deletedExpense: ExpenseWithVehicle) {
		await fetchPageAndSummary(currentOffset);
	}

	let vehicleById = $derived(new Map(vehicles.map(v => [v.id, v])));
	let displayExpenses = $derived<ExpenseWithVehicle[]>(
		expenses.map(expense => ({ ...expense, vehicle: vehicleById.get(expense.vehicleId) }))
	);
</script>

{#snippet vehicleFilter()}
	<Select.Root type="single" value={selectedVehicleId ?? ''} onValueChange={handleVehicleChange}>
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
			<Select.Item value="" label={COMMON_MESSAGES.ALL_VEHICLES}>
				{COMMON_MESSAGES.ALL_VEHICLES}
			</Select.Item>
			{#each vehicles as vehicle (vehicle.id)}
				<Select.Item value={vehicle.id} label={getVehicleDisplayName(vehicle)}>
					{getVehicleDisplayName(vehicle)}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/snippet}

{#snippet dateFilter(className: string)}
	<DateRangePicker
		bind:startValue={startDate}
		bind:endValue={endDate}
		placeholder="Date range"
		class={className}
	/>
{/snippet}

{#snippet importExportActions(variant: 'outline' | 'ghost', buttonClass: string)}
	<Button {variant} class={buttonClass} onclick={() => openTool(() => (photosImportOpen = true))}>
		<Images class="mr-2 h-4 w-4" />
		Import from Photos
	</Button>
	<Button {variant} class={buttonClass} onclick={() => openTool(() => (importOpen = true))}>
		<Upload class="mr-2 h-4 w-4" />
		Import CSV
	</Button>
	{#if totalCount > 0}
		<Button {variant} class={buttonClass} onclick={exportFromTools} disabled={isExporting}>
			<Download class="mr-2 h-4 w-4" />
			{isExporting ? 'Exporting…' : 'Export CSV'}
		</Button>
	{/if}
{/snippet}

{#snippet addExpenseHeaderAction()}
	<Button size="lg" class="hidden lg:inline-flex" href={resolve(routes.expenseNew)}>
		<Plus class="mr-2 h-4 w-4" />
		{COMMON_MESSAGES.ADD_EXPENSE}
	</Button>
{/snippet}

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
		<div class="rounded-lg border bg-card p-6" data-testid="expenses-load-error">
			<div role="alert">
				{#key loadFailures}
					<div class="mb-4 flex items-center gap-3 text-destructive">
						<CircleAlert class="h-5 w-5" />
						<p class="font-medium">Couldn't load expenses</p>
					</div>
					<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
				{/key}
			</div>
			<Button size="lg" onclick={retryLoad} aria-disabled={isRetryingLoad}>
				{#if isRetryingLoad}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
					Retrying…
				{:else}
					Retry
				{/if}
			</Button>
		</div>
	</div>
{:else if offlineLoad}
	<div class="space-y-6 pb-24">
		<PageHeader
			title="All Expenses"
			description="Track and categorize expenses across all vehicles"
		>
			{#snippet actions()}
				{@render addExpenseHeaderAction()}
			{/snippet}
		</PageHeader>
		<Alert variant="warning" role="status" data-testid="expenses-offline-notice">
			<WifiOff class="h-4 w-4" />
			<AlertTitle>You're offline</AlertTitle>
			<AlertDescription>
				Your expense history loads when you reconnect. Expenses you add now are saved on this device
				and sync automatically.
			</AlertDescription>
		</Alert>
		<OfflineExpenseCards
			{pendingExpenses}
			{needsAttentionExpenses}
			{syncedExpenses}
			onRemovePending={removeOfflineExpense}
			onRemoveNeedsAttention={removeOfflineExpense}
		/>
	</div>

	<FloatingActionButton href={resolve(routes.expenseNew)} label={COMMON_MESSAGES.ADD_EXPENSE} />
{:else if vehicles.length === 0 && (summary?.expenseCount ?? 0) === 0}
	<div class="space-y-6">
		<PageHeader
			title="All Expenses"
			description="Track and categorize expenses across all vehicles"
		/>
		<EmptyState>
			{#snippet icon()}
				<Car class="h-12 w-12 text-muted-foreground mb-4" />
			{/snippet}
			{#snippet title()}
				Add a vehicle first
			{/snippet}
			{#snippet description()}
				Every expense belongs to a vehicle. Add one, then log fill-ups, repairs and other costs.
			{/snippet}
			{#snippet action()}
				<Button size="lg" href={resolve(routes.vehicleNew)}>
					<Plus class="mr-2 h-4 w-4" />
					Add Vehicle
				</Button>
			{/snippet}
		</EmptyState>
	</div>
{:else}
	<div class="space-y-6 pb-24">
		<PageHeader
			title="All Expenses"
			description="Track and categorize expenses across all vehicles"
		>
			{#snippet actions()}
				<div class="hidden sm:flex sm:items-center sm:gap-2">
					{@render importExportActions('outline', '')}
				</div>
				<div class="sm:hidden">
					<Popover.Root bind:open={toolsMenuOpen}>
						<Popover.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="outline" size="lg">
									<Ellipsis class="mr-2 h-4 w-4" />
									Import & export
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content align="start" class="flex w-56 flex-col gap-2 p-1">
							{@render importExportActions('ghost', 'h-10 w-full justify-start')}
						</Popover.Content>
					</Popover.Root>
				</div>
				{@render addExpenseHeaderAction()}
			{/snippet}
		</PageHeader>

		<CardNs.Root class="max-sm:gap-0 max-sm:py-4">
			<CardNs.Header class="max-sm:hidden">
				<div class="flex items-center justify-between gap-3">
					<div>
						<CardNs.Title>Search & Filters</CardNs.Title>
						<CardNs.Description>Find and filter your expenses</CardNs.Description>
					</div>
					<div class="flex items-center gap-2">
						{@render dateFilter('w-auto')}
					</div>
				</div>
			</CardNs.Header>
			<CardNs.Content class="flex flex-col gap-4 max-sm:px-4">
				<div class="flex gap-3">
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
					<div class="hidden sm:block sm:w-56">
						{@render vehicleFilter()}
					</div>
					<Button
						variant="outline"
						class="h-10 shrink-0 sm:hidden"
						aria-haspopup="dialog"
						onclick={() => (filtersSheetOpen = true)}
					>
						<SlidersHorizontal class="h-4 w-4" />
						{sheetFilterCount > 0 ? `Filters · ${sheetFilterCount}` : 'Filters'}
					</Button>
				</div>

				<div class="hidden sm:block">
					<ExpenseTagFilter {allTags} {selectedTags} onTagsChange={handleTagsChange} />
				</div>

				{#if searchTerm || selectedVehicleId || selectedTags.length > 0 || startDate || endDate || categoryFilter}
					<div class="flex justify-end sm:pt-2">
						<Button variant="outline" size="sm" class="h-10 sm:h-8" onclick={clearFilters}>
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
						<CardNs.Title
							bind:ref={expensesHeading}
							tabindex={-1}
							class="w-fit rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							Expenses ({totalCount})
						</CardNs.Title>
						<CardNs.Description>All recorded expenses</CardNs.Description>
					</div>
					<div class="p-2 rounded-lg bg-primary/10">
						<DollarSign class="h-5 w-5 text-primary" />
					</div>
				</div>
			</CardNs.Header>
			<CardNs.Content>
				{#if pageError}
					<div class="py-6" role="alert" data-testid="expenses-page-error">
						<div class="mb-4 flex items-center gap-3 text-destructive">
							<CircleAlert class="h-5 w-5" />
							<p class="font-medium">Couldn't load expenses</p>
						</div>
						<p class="mb-4 text-sm text-muted-foreground">{pageError.message}</p>
						<Button size="lg" onclick={retryPage} aria-disabled={isLoadingPage}>
							{#if isLoadingPage}
								<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
								Retrying…
							{:else}
								Retry
							{/if}
						</Button>
					</div>
				{:else}
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
				{/if}
			</CardNs.Content>
		</CardNs.Root>
	</div>

	<FloatingActionButton href={resolve(routes.expenseNew)} label={COMMON_MESSAGES.ADD_EXPENSE} />

	<Sheet.Root bind:open={filtersSheetOpen}>
		<Sheet.Content side="bottom" class="max-h-[85vh] overflow-y-auto">
			<Sheet.Header>
				<Sheet.Title>Filters</Sheet.Title>
				<Sheet.Description>Narrow the list by vehicle, date and tags.</Sheet.Description>
			</Sheet.Header>
			<div class="space-y-4 px-4">
				{@render vehicleFilter()}
				{@render dateFilter('w-full')}
				<ExpenseTagFilter {allTags} {selectedTags} onTagsChange={handleTagsChange} />
			</div>
			<Sheet.Footer class="pb-[max(1rem,env(safe-area-inset-bottom))]">
				<Button size="lg" class="w-full" onclick={() => (filtersSheetOpen = false)}>
					Show results
				</Button>
			</Sheet.Footer>
		</Sheet.Content>
	</Sheet.Root>

	<ImportExpensesDialog bind:open={importOpen} {vehicles} onImported={handleImported} />
	<ImportFromPhotosDialog bind:open={photosImportOpen} {vehicles} onImported={handleImported} />
{/if}
