<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { routes } from '#lib/routes.ts';
	import {
		Search,
		X,
		Download,
		Upload,
		Images,
		Ellipsis,
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
	import { dateOnlyToISO, formatDate, formatNumber } from '#lib/utils/formatters.ts';
	import {
		handleErrorWithNotification,
		logLoadFailure,
		userFacingErrorMessage
	} from '#lib/utils/error-handling.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { extractUniqueTags } from '#lib/utils/expense-filters.ts';
	import { COMMON_MESSAGES, EXPENSE_MESSAGES } from '#lib/constants/messages.ts';
	import DateRangePicker from '#lib/components/common/date-range-picker.svelte';
	import Input from '#lib/components/ui/input/input.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import ExpensesTable from '#lib/components/expenses/ExpensesTable.svelte';
	import NoVehiclesEmptyState from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import ExpenseTagFilter from '#lib/components/expenses/ExpenseTagFilter.svelte';
	import OfflineExpenseCards from '#lib/components/expenses/OfflineExpenseCards.svelte';
	import {
		matchesFilters,
		withPendingByMonth,
		withPendingInSummary
	} from '#lib/utils/sync/pending-rows.ts';
	import { usePendingRows } from '#lib/utils/sync/pending-rows.svelte.ts';
	import { forgetRecentlySynced, recentlySynced } from '#lib/utils/sync/recently-synced.svelte.ts';
	import { isDeleteHidden } from '#lib/utils/pending-deletes.svelte.ts';
	import { editedRows } from '#lib/utils/pending-edits.svelte.ts';
	import FilterPills from '#lib/components/expenses/FilterPills.svelte';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import * as Sheet from '#lib/components/ui/sheet/index.ts';
	import { useExpenseListReload } from './expense-list-reload.svelte';
	import {
		expenseCategoryList,
		expenseUrlFiltersQuery,
		parseExpenseUrlFilters,
		type ExpenseUrlFilters
	} from './expense-url-filters.ts';
	import {
		EXPENSE_CATEGORIES,
		EXPENSE_CATEGORY_INFO,
		type ExpenseCategory
	} from '#lib/constants/expense-categories.ts';

	const phone = new MediaQuery('width < 40rem');
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let expenses = $state<Expense[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let summary = $state<ExpenseSummary | null>(null);
	let summaryRequestedAt = $state<number | undefined>();

	let currentOffset = $state(0);
	let pageSize = $state(20);
	let totalCount = $state(0);
	let totalCountFiltered = $state(false);
	let isLoadingPage = $state(false);

	const URL_WRITE_DELAY_MS = 300;
	const urlFilters = parseExpenseUrlFilters(page.url.searchParams);

	let searchTerm = $state(urlFilters.q);
	let selectedVehicleId = $state<string | undefined>(urlFilters.vehicleId);
	let startDate = $state<string | undefined>(urlFilters.startDate);
	let endDate = $state<string | undefined>(urlFilters.endDate);

	let selectedTags = $state<string[]>(urlFilters.tags);

	let sortBy = $state<'date' | 'amount'>('date');
	let sortDir = $state<'asc' | 'desc'>('desc');

	let categoryFilter = $state<string>(urlFilters.category ?? '');

	let queuedExpenses = $derived(
		offlineExpenseQueue.current.filter(expense => !expense.synced && !expense.needsAttention)
	);
	let needsAttentionExpenses = $derived(
		offlineExpenseQueue.current.filter(expense => !expense.synced && expense.needsAttention)
	);
	let syncedExpenses = $derived(offlineExpenseQueue.current.filter(expense => expense.synced));

	let allTags = $derived(extractUniqueTags(expenses));

	const pending = usePendingRows({
		match: expense => !selectedVehicleId || expense.vehicleId === selectedVehicleId,
		refresh: () => fetchPageAndSummary(currentOffset, { keepMonthTotals: true }),
		listedIds: () => listedExpenseIds,
		summaryRequestedAt: () => summaryRequestedAt
	});
	let listedExpenseIds = $derived(new Set(expenses.map(expense => expense.id)));
	let pendingFilters = $derived({
		vehicleId: selectedVehicleId,
		categories: expenseCategoryList(categoryFilter),
		startDate,
		endDate,
		search: searchTerm,
		tags: selectedTags
	});
	let pendingMatching = $derived(pending.rows.filter(row => matchesFilters(row, pendingFilters)));
	let pendingListRows = $derived(currentOffset === 0 ? pendingMatching : []);
	let loadingRows = $derived([
		...pendingListRows,
		...recentlySynced().filter(
			row => matchesFilters(row, pendingFilters) && !pendingListRows.some(p => p.id === row.id)
		)
	]);
	let deletingRows = $derived(expenses.filter(isDeleteHidden));
	let edited = $derived(editedRows(expenses.filter(expense => !isDeleteHidden(expense))));
	let shownSummary = $derived.by(() => {
		const now = Date.now();
		const withQueued = withPendingInSummary(summary, pending.saving, now);
		const withoutRemoved = withPendingInSummary(
			withQueued,
			[...deletingRows, ...edited.before],
			now,
			-1
		);
		return withPendingInSummary(withoutRemoved, edited.after, now);
	});
	const expenseListReload = useExpenseListReload({
		ready: () => !isLoading,
		search: () => searchTerm,
		filterKey: () => JSON.stringify([startDate ?? '', endDate ?? '']),
		reload: handleFilterChange
	});

	let offlineLoad = $state(false);
	let expensesList = $state<HTMLElement | null>(null);
	let filtersActive = $derived(
		Boolean(
			searchTerm.trim() ||
			selectedVehicleId ||
			selectedTags.length > 0 ||
			startDate ||
			endDate ||
			categoryFilter
		)
	);
	let countLine = $derived.by(() => {
		const count =
			totalCount +
			pendingMatching.filter(row => pending.states.get(row.id)?.status === 'saving').length -
			deletingRows.length;
		const expenses = `${formatNumber(count, 0)} ${count === 1 ? 'expense' : 'expenses'}`;
		if (totalCountFiltered) {
			return `${expenses} ${count === 1 ? 'matches' : 'match'} your filters`;
		}
		if (vehicles.length === 0) return expenses;
		return `${expenses} across ${formatNumber(vehicles.length, 0)} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}`;
	});

	let activeFilterSummary = $derived.by(() => {
		const parts: string[] = [];
		const vehicle = vehicles.find(v => v.id === selectedVehicleId);
		if (vehicle) parts.push(getVehicleDisplayName(vehicle));
		const categories = expenseCategoryList(categoryFilter);
		if (categories.length > 0) {
			parts.push(categories.map(c => EXPENSE_CATEGORY_INFO[c as ExpenseCategory].label).join(', '));
		}
		const day = (value: string) => formatDate(dateOnlyToISO(value));
		if (startDate && endDate) parts.push(`${day(startDate)} – ${day(endDate)}`);
		else if (startDate) parts.push(`From ${day(startDate)}`);
		else if (endDate) parts.push(`Until ${day(endDate)}`);
		if (selectedTags.length > 0) parts.push(`Tagged ${selectedTags.join(', ')}`);
		const term = searchTerm.trim();
		if (term) parts.push(`“${term}”`);
		return parts.length > 0 ? `Filtered by ${parts.join(' · ')}` : '';
	});

	function currentUrlFilters(): ExpenseUrlFilters {
		return {
			vehicleId: selectedVehicleId,
			category: categoryFilter || undefined,
			startDate,
			endDate,
			tags: [...selectedTags],
			q: searchTerm
		};
	}

	$effect(() => {
		const filters = currentUrlFilters();
		if (isLoading) return;
		const timer = setTimeout(
			() =>
				untrack(() => {
					const query = expenseUrlFiltersQuery(filters, new URLSearchParams(location.search));
					if (query === location.search) return;
					// eslint-disable-next-line svelte/no-navigation-without-resolve -- the path is resolved; only the query string is added
					goto(`${resolve(routes.expenses)}${query}${location.hash}`, {
						state: page.state,
						shallow: true,
						replace: true
					});
				}),
			URL_WRITE_DELAY_MS
		);
		return () => clearTimeout(timer);
	});

	afterNavigate(navigation => {
		if (navigation.type === 'enter' || !navigation.to) return;
		if (navigation.type === 'goto' && navigation.shallow) return;
		const next = parseExpenseUrlFilters(navigation.to.url.searchParams);
		if (!isLoading && next.vehicleId && !vehicles.some(v => v.id === next.vehicleId)) {
			next.vehicleId = undefined;
		}
		if (expenseUrlFiltersQuery(next) === expenseUrlFiltersQuery(currentUrlFilters())) return;
		searchTerm = next.q;
		selectedVehicleId = next.vehicleId;
		startDate = next.startDate;
		endDate = next.endDate;
		selectedTags = next.tags;
		categoryFilter = next.category ?? '';
		if (isLoading) void loadInitial();
		else expenseListReload.reloadNow();
	});

	onMount(loadInitial);

	$effect(() => {
		if (offlineLoad && onlineStatus.current) untrack(loadInitial);
	});

	async function loadInitial() {
		isLoading = loadError === null;
		offlineLoad = false;
		try {
			const vehiclesRequest = vehicleApi.getVehicles();
			if (selectedVehicleId) {
				const known = await vehiclesRequest;
				if (!known.some(v => v.id === selectedVehicleId)) selectedVehicleId = undefined;
			}
			const [, loadedVehicles] = await Promise.all([
				settingsStore.load(),
				vehiclesRequest,
				fetchPageAndSummary(0, { throwOnFailure: true })
			]);
			vehicles = loadedVehicles;
			loadError = null;
		} catch (error) {
			if (onlineStatus.current) {
				loadError = userFacingErrorMessage(error);
				logLoadFailure(error, "Couldn't load expenses");
			} else {
				loadError = null;
				offlineLoad = true;
			}
		} finally {
			isLoading = false;
			forgetRecentlySynced();
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
	const nextMonthTotalsRequest = latest();
	let monthTotals = $state<ReadonlyMap<string, number>>(new Map());

	async function loadMonthTotals(keepShown = false) {
		const isCurrent = nextMonthTotalsRequest();
		if (!keepShown) monthTotals = new Map();
		const {
			limit: _limit,
			offset: _offset,
			sortBy: _by,
			sortDir: _dir,
			...filters
		} = buildListParams(0);
		try {
			const months = await expenseApi.getMonthlyTotals(filters);
			if (isCurrent()) monthTotals = new Map(months.map(m => [m.month, m.amount]));
		} catch (error) {
			if (!isCurrent()) return;
			monthTotals = new Map();
			logLoadFailure(error, "Couldn't load the month totals");
		}
	}
	let pageError = $state<{ message: string; offset: number } | null>(null);

	function applyPage(pageResult: PaginatedResponse<Expense>, offset: number, filtered: boolean) {
		expenses = pageResult.data;
		totalCount = pageResult.pagination.totalCount;
		totalCountFiltered = filtered;
		currentOffset = offset;
		pageError = null;
	}

	function failPage(error: unknown, offset: number) {
		pageError = {
			message: userFacingErrorMessage(error),
			offset
		};
		logLoadFailure(error, "Couldn't load expenses");
	}

	async function fetchPageAndSummary(
		offset = 0,
		{ throwOnFailure = false, keepMonthTotals = false } = {}
	) {
		const isCurrentList = nextListRequest();
		const isCurrentSummary = nextSummaryRequest();
		const filtered = filtersActive;
		const requestedAt = Date.now();
		isLoadingPage = true;
		void loadMonthTotals(keepMonthTotals);
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
				if (pageResult.status === 'fulfilled') applyPage(pageResult.value, offset, filtered);
				else failPage(pageResult.reason, offset);
			}
			if (isCurrentSummary()) {
				if (summaryResult.status === 'fulfilled') {
					summary = summaryResult.value;
					summaryRequestedAt = requestedAt;
				} else if (!listReported || pageResult.status === 'fulfilled') {
					failSummary(summaryResult.reason);
				}
			}
		} finally {
			if (isCurrentList()) isLoadingPage = false;
		}
	}

	function failSummary(error: unknown) {
		logLoadFailure(error, "Couldn't load the expense summary");
	}

	async function fetchPage(offset: number) {
		const isCurrent = nextListRequest();
		const filtered = filtersActive;
		isLoadingPage = true;
		try {
			const pageResult = await expenseApi.getAllExpenses(buildListParams(offset));
			if (isCurrent()) applyPage(pageResult, offset, filtered);
		} catch (error) {
			if (isCurrent()) failPage(error, offset);
		} finally {
			if (isCurrent()) isLoadingPage = false;
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
		void loadMonthTotals();
	}

	function clearFilters() {
		searchTerm = '';
		clearSheetFilters();
	}

	function clearSheetFilters() {
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

	type ImportDialogModule = typeof import('#lib/components/expenses/ImportExpensesDialog.svelte');
	type PhotosDialogModule = typeof import('#lib/components/expenses/ImportFromPhotosDialog.svelte');
	let importDialog = $state<Promise<ImportDialogModule | null> | null>(null);
	let photosDialog = $state<Promise<PhotosDialogModule | null> | null>(null);

	function dialogLoadFailed(error: unknown) {
		appStore.showError(`Couldn't open this dialog. ${userFacingErrorMessage(error)}`);
	}

	function openImport() {
		importDialog ??= import('#lib/components/expenses/ImportExpensesDialog.svelte').catch(error => {
			importDialog = null;
			importOpen = false;
			dialogLoadFailed(error);
			return null;
		});
		importOpen = true;
	}

	function openPhotosImport() {
		photosDialog ??= import('#lib/components/expenses/ImportFromPhotosDialog.svelte').catch(
			error => {
				photosDialog = null;
				photosImportOpen = false;
				dialogLoadFailed(error);
				return null;
			}
		);
		photosImportOpen = true;
	}
	let toolsMenuOpen = $state(false);
	let filtersSheetOpen = $state(false);
	let sheetFilterCount = $derived(
		(selectedVehicleId ? 1 : 0) +
			(startDate || endDate ? 1 : 0) +
			selectedTags.length +
			expenseCategoryList(categoryFilter).length
	);
	let vehicleOptions = $derived([
		{ value: '', label: 'All' },
		...vehicles.map(vehicle => ({ value: vehicle.id, label: getVehicleDisplayName(vehicle) }))
	]);
	const categoryOptions = EXPENSE_CATEGORIES.map(category => ({
		value: category,
		label: EXPENSE_CATEGORY_INFO[category].shortLabel
	}));
	const sortOptions = [
		{ value: 'date-desc', label: 'Newest' },
		{ value: 'date-asc', label: 'Oldest' },
		{ value: 'amount-desc', label: 'Highest' },
		{ value: 'amount-asc', label: 'Lowest' }
	];
	function chooseSort(value: string) {
		const [by, dir] = value.split('-') as ['date' | 'amount', 'asc' | 'desc'];
		handleSortChange(by, dir);
	}
	function toggleCategory(category: string) {
		const current = expenseCategoryList(categoryFilter);
		const next = current.includes(category)
			? current.filter(value => value !== category)
			: [...current, category];
		handleCategoryChange(next.join(','));
	}
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
	let shownMonthTotals = $derived.by(() => {
		const withQueued = withPendingByMonth(
			monthTotals,
			pending.saving.filter(row => matchesFilters(row, pendingFilters))
		);
		const withoutRemoved = withPendingByMonth(withQueued, [...deletingRows, ...edited.before], -1);
		return withPendingByMonth(withoutRemoved, edited.after);
	});
	let displayExpenses = $derived<ExpenseWithVehicle[]>(
		[...pendingListRows, ...expenses].map(expense => ({
			...expense,
			vehicle: vehicleById.get(expense.vehicleId)
		}))
	);
</script>

{#snippet dateFilter(className: string)}
	<DateRangePicker
		bind:startValue={startDate}
		bind:endValue={endDate}
		placeholder="Date range"
		class={className}
	/>
{/snippet}

{#snippet importExportActions(variant: 'outline' | 'ghost', buttonClass: string)}
	<Button {variant} class={buttonClass} onclick={() => openTool(openPhotosImport)}>
		<Images class="mr-2 h-4 w-4" />
		Import from Photos
	</Button>
	<Button {variant} class={buttonClass} onclick={() => openTool(openImport)}>
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
	<Button size="lg" href={resolve(routes.expenseNew)}>
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
		{#if loadingRows.length > 0}
			<div data-testid="pending-rows-while-loading">
				<ExpensesTable
					expenses={loadingRows}
					{vehicles}
					showVehicleColumn={false}
					scrollHeight="auto"
					canWrite={false}
					ledger
					returnTo={resolve(routes.expenses)}
					pendingStates={pending.states}
				/>
			</div>
		{/if}
		<Skeleton class="h-40 w-full" />
		<Skeleton class="h-64 w-full" />
	</div>
{:else if loadError}
	<div class="space-y-6">
		<PageHeader
			variant="display"
			eyebrow="Log"
			title="Expenses"
			description="Track and categorize expenses across all vehicles"
		/>
		<LoadErrorCard
			data-testid="expenses-load-error"
			title="Couldn't load expenses"
			message={loadError}
			onRetry={loadInitial}
			onRecovered={() => expensesList?.focus()}
		/>
	</div>
{:else if offlineLoad}
	<div class="space-y-6">
		<PageHeader
			variant="display"
			eyebrow="Log"
			title="Expenses"
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
			pendingExpenses={queuedExpenses}
			{needsAttentionExpenses}
			{syncedExpenses}
			onRemovePending={removeOfflineExpense}
			onRemoveNeedsAttention={removeOfflineExpense}
		/>
	</div>
{:else if vehicles.length === 0 && (shownSummary?.expenseCount ?? 0) === 0}
	<div class="space-y-6">
		<PageHeader
			variant="display"
			eyebrow="Log"
			title="Expenses"
			description="Track and categorize expenses across all vehicles"
		/>
		<NoVehiclesEmptyState
			description="Every expense belongs to a vehicle. Add one, then log fill-ups, repairs and other costs."
		/>
	</div>
{:else}
	<div class="space-y-6">
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0 flex-1">
				<PageHeader variant="display" eyebrow="Log" title="Expenses" description={countLine}>
					{#snippet actions()}
						<div class="hidden sm:flex sm:items-center sm:gap-2 short:hidden">
							{@render importExportActions('outline', '')}
						</div>
					{/snippet}
				</PageHeader>
			</div>
			<div class="shrink-0 sm:hidden short:block">
				<Popover.Root bind:open={toolsMenuOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="icon-lg" aria-label="Import and export">
								<Ellipsis class="h-4 w-4" />
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content align="end" class="flex w-56 flex-col gap-2 p-1">
						{@render importExportActions('ghost', 'h-10 w-full justify-start')}
					</Popover.Content>
				</Popover.Root>
			</div>
		</div>

		<div class="flex flex-col gap-3">
			<div class="flex gap-3 sm:max-w-2xl">
				<div class="flex-1 relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
						<Search class="h-5 w-5 text-muted-foreground" />
					</div>
					<Input
						type="text"
						bind:value={searchTerm}
						placeholder="Search “Costco”, “tires” or “42.50”"
						class="pl-10 w-full h-12 sm:h-11"
						aria-label="Search expenses and vehicles"
					/>
				</div>
				<Button
					variant="outline"
					class="h-12 shrink-0 rounded-full px-4 sm:h-11"
					aria-haspopup="dialog"
					aria-expanded={filtersSheetOpen}
					onclick={() => (filtersSheetOpen = true)}
				>
					<SlidersHorizontal class="h-4 w-4" />
					{sheetFilterCount > 0 ? `Filters · ${sheetFilterCount}` : 'Filters'}
				</Button>
			</div>

			{#if filtersActive}
				<div class="flex items-center justify-between gap-3">
					<p class="min-w-0 text-sm text-muted-foreground" data-testid="active-filter-summary">
						{activeFilterSummary}
					</p>
					<Button variant="outline" size="sm" class="h-10 shrink-0" onclick={clearFilters}>
						<X class="h-4 w-4 mr-2" />
						{COMMON_MESSAGES.CLEAR_FILTERS}
					</Button>
				</div>
			{/if}
		</div>

		<OfflineExpenseCards
			pendingExpenses={[]}
			needsAttentionExpenses={[]}
			{syncedExpenses}
			onRemovePending={removeOfflineExpense}
			onRemoveNeedsAttention={removeOfflineExpense}
		/>

		<div
			bind:this={expensesList}
			role="region"
			aria-label="Expenses"
			tabindex={-1}
			class="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
		>
			{#if pageError}
				<LoadErrorCard
					compact
					data-testid="expenses-page-error"
					title="Couldn't load expenses"
					message={pageError.message}
					onRetry={() => fetchPageAndSummary(pageError?.offset ?? currentOffset)}
					onRecovered={() => expensesList?.focus()}
				/>
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
					hasActiveFilters={totalCountFiltered}
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
					monthTotals={shownMonthTotals}
					pendingStates={pending.states}
					ledger
				/>
			{/if}
		</div>
	</div>

	<Sheet.Root bind:open={filtersSheetOpen}>
		<Sheet.Content
			side={phone.current ? 'bottom' : 'right'}
			class="max-h-[85vh] overflow-y-auto sm:max-h-none sm:w-[26rem] sm:max-w-full"
		>
			<Sheet.Header>
				<Sheet.Title class="font-(family-name:--font-fig) text-3xl uppercase">Filters</Sheet.Title>
				<Sheet.Description>
					Narrow the list by vehicle, category, date and tags, and pick the order.
				</Sheet.Description>
			</Sheet.Header>
			<div class="space-y-5 px-4">
				<FilterPills
					label="Vehicle"
					options={vehicleOptions}
					selected={[selectedVehicleId ?? '']}
					onToggle={value => handleVehicleChange(value === selectedVehicleId ? '' : value)}
				/>
				<FilterPills
					label="Category"
					options={categoryOptions}
					selected={expenseCategoryList(categoryFilter)}
					onToggle={toggleCategory}
				/>
				<FilterPills
					label="Sort"
					options={sortOptions}
					selected={[`${sortBy}-${sortDir}`]}
					onToggle={chooseSort}
				/>
				<div class="space-y-2" role="group" aria-labelledby="expense-dates-label">
					<p id="expense-dates-label" class="text-sm font-medium">Dates</p>
					{@render dateFilter('w-full')}
				</div>
				<ExpenseTagFilter {allTags} {selectedTags} onTagsChange={handleTagsChange} />
			</div>
			<Sheet.Footer class="flex-row justify-end gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
				<Button
					variant="outline"
					size="lg"
					onclick={clearSheetFilters}
					disabled={sheetFilterCount === 0}
				>
					Clear
				</Button>
				<Button size="lg" onclick={() => (filtersSheetOpen = false)}>
					{`Show ${formatNumber(totalCount, 0)} ${totalCount === 1 ? 'result' : 'results'}`}
				</Button>
			</Sheet.Footer>
		</Sheet.Content>
	</Sheet.Root>

	{#await importDialog then module}
		{#if module}
			<module.default bind:open={importOpen} {vehicles} onImported={handleImported} />
		{/if}
	{/await}
	{#await photosDialog then module}
		{#if module}
			<module.default bind:open={photosImportOpen} {vehicles} onImported={handleImported} />
		{/if}
	{/await}
{/if}
