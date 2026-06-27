<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '$lib/routes';
	import { parseMonthToDate } from '$lib/utils/chart-formatters';
	import { onMount, type Component } from 'svelte';
	import { Plus, FileText, Download, CircleAlert, Users } from '@lucide/svelte';
	import FloatingActionButton from '$lib/components/common/floating-action-button.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Card, CardContent } from '$lib/components/ui/card';
	import * as CardFull from '$lib/components/ui/card';
	import ExpensesTable from '$lib/components/expenses/ExpensesTable.svelte';
	import ExpenseSearchFilters from '$lib/components/expenses/ExpenseSearchFilters.svelte';
	import ExpenseTrendChart from '$lib/components/charts/ExpenseTrendChart.svelte';
	import FuelEfficiencyTrendChart from '$lib/components/charts/FuelEfficiencyTrendChart.svelte';
	import { AppPieChart } from '$lib/components/charts';
	import VehicleHeader from '$lib/components/vehicles/VehicleHeader.svelte';
	import ShareVehicleDialog from '$lib/components/vehicles/ShareVehicleDialog.svelte';
	import VehiclePhotoCarousel from '$lib/components/vehicles/VehiclePhotoCarousel.svelte';
	import MediaCaptureDialog from '$lib/components/common/MediaCaptureDialog.svelte';
	import VehicleInfoCard from '$lib/components/vehicles/VehicleInfoCard.svelte';
	import ExpenseOverviewCard from '$lib/components/vehicles/ExpenseOverviewCard.svelte';
	import FuelEfficiencyStatsCard from '$lib/components/vehicles/FuelEfficiencyStatsCard.svelte';
	import PeriodSelector from '$lib/components/common/period-selector.svelte';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import FinanceTab from '$lib/components/vehicles/FinanceTab.svelte';
	import OdometerTab from '$lib/components/vehicles/OdometerTab.svelte';
	// Lazy-loaded InsuranceTab — only import when overview tab has been viewed
	let InsuranceTab = $state<Component<{ vehicleId: string; readOnly?: boolean }> | null>(null);
	let hasLoadedInsurance = $state(false);
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import { getCategoryColor as getCategoryChartColor } from '$lib/utils/chart-colors';
	import {
		filterExpenses,
		hasActiveFilters as checkActiveFilters
	} from '$lib/utils/expense-filters';
	import { COMMON_MESSAGES, VEHICLE_MESSAGES } from '$lib/constants/messages';
	import { type TimePeriod } from '$lib/constants/time-periods';
	import { SCROLL_HEIGHTS } from '$lib/constants/ui';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi } from '$lib/services/expense-api';
	import { analyticsApi } from '$lib/services/analytics-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import type {
		Vehicle,
		Expense,
		ExpenseFilters,
		VehicleStats,
		Photo,
		ExpenseSummary,
		FuelEfficiencyPoint,
		ExpenseCategory
	} from '$lib/types';
	import type { PageData } from './$types';

	// Props from page load
	let { data }: { data: PageData } = $props();
	let vehicleId = $derived(data.vehicleId);

	// Component state
	let isLoading = $state(true);
	let isLoadingStats = $state(false);
	let vehicle = $state<Vehicle | null>(null);
	let activeTab = $state('overview');
	let vehicleStatsData = $state<VehicleStats | null>(null);
	let selectedStatsPeriod = $state<TimePeriod>('all');

	// Server-provided summary and fuel efficiency data
	let summary = $state<ExpenseSummary | null>(null);
	let fuelEfficiencyPoints = $state<FuelEfficiencyPoint[]>([]);
	// A summary load FAILURE must not fall through to the "no expenses yet" empty state —
	// a returning user would think their data vanished (four-states: error ≠ empty).
	let summaryLoadError = $state<string | null>(null);

	// Paginated expenses state (for Expenses tab)
	let expenses = $state<Expense[]>([]);
	let currentOffset = $state(0);
	let pageSize = $state(20);
	let totalCount = $state(0);
	let isLoadingPage = $state(false);
	let hasLoadedExpensesTab = $state(false);
	// Same class for the Expenses tab: a fetch failure must show error+retry, not an empty table.
	let expensesLoadError = $state<string | null>(null);
	// Server-side sort for the Expenses tab (default date desc).
	let expenseSortBy = $state<'date' | 'amount'>('date');
	let expenseSortDir = $state<'asc' | 'desc'>('desc');

	// Photos state
	let vehiclePhotos = $state<Photo[]>([]);
	let showUploadDialog = $state(false);

	// Share dialog (vehicle-sharing T11) — owner invites/manages access to this vehicle.
	let shareOpen = $state(false);

	// Filters and search
	let searchTerm = $state('');
	let filters = $state<ExpenseFilters>({});

	// Derived chart data from server summary
	let expenseTrendData = $derived.by(() => {
		if (!summary?.monthlyTrend.length) return [];
		return summary.monthlyTrend.map(item => ({
			// parseMonthToDate builds a LOCAL-midnight Date; `new Date('YYYY-MM-01')` parses as
			// midnight UTC, which shifts the x-axis label back a month for negative-offset users.
			date: parseMonthToDate(item.period),
			amount: item.amount,
			count: item.count
		}));
	});

	let fuelEfficiencyData = $derived.by(() => {
		return fuelEfficiencyPoints.map(point => ({
			date: new Date(point.date),
			efficiency: point.efficiency,
			mileage: point.mileage
		}));
	});

	let categoryChartData = $derived.by(() => {
		if (!summary?.categoryBreakdown.length) return [];
		const total = summary.categoryBreakdown.reduce((sum, item) => sum + item.amount, 0);
		if (total === 0) return [];
		return summary.categoryBreakdown
			.map(item => ({
				key: item.category,
				label: categoryLabels[item.category as ExpenseCategory] || item.category,
				value: item.amount,
				percentage: (item.amount / total) * 100,
				color: getCategoryChartColor(item.category)
			}))
			.sort((a, b) => b.value - a.value);
	});

	// Stats for ExpenseOverviewCard from server summary
	let localStats = $derived({
		totalExpenses: summary?.totalAmount ?? 0,
		recentExpenses: summary?.recentAmount ?? 0,
		monthlyAverage: summary?.monthlyAverage ?? 0
	});

	// Whether the overview has any expense data (from summary)
	let hasExpenseData = $derived((summary?.expenseCount ?? 0) > 0);

	// Filtered expenses based on search and filters (client-side on current page)
	let filteredExpenses = $derived(filterExpenses(expenses, searchTerm, filters));

	// Check if any filters are active
	let hasActiveFilters = $derived(checkActiveFilters(searchTerm, filters));

	let vehicleDisplayName = $derived(
		vehicle ? vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}` : ''
	);

	// vehicle-sharing T12b-3b: gate the edit affordances by the viewer's access level. The single-vehicle
	// GET returns `sharedAccess { level }` for a NON-owner (undefined for the owner). Two capabilities:
	//   - isOwner  → owner-ONLY affordances (edit vehicle info, finance, share management, photos, CSV
	//     export) — all of these stay strict `validateVehicleOwnership` server-side, so a non-owner must
	//     not see a button that would 404.
	//   - canWrite → owner OR an accepted EDITOR (expense + odometer add/edit/delete) — widened
	//     server-side in T5b-2/T6 via `requireVehicleWrite`.
	// This is defense-in-depth UX: the backend already enforces every denial; hiding the chrome avoids a
	// viewer clicking an affordance that errors. An owned vehicle carries no `sharedAccess` → isOwner=true.
	let isOwner = $derived(!vehicle?.sharedAccess);
	let canWrite = $derived(!vehicle?.sharedAccess || vehicle.sharedAccess.level === 'editor');

	let coverPhotoUrl = $derived.by(() => {
		const cover = vehiclePhotos.find(p => p.isCover);
		if (!cover) return null;
		return vehicleApi.getPhotoThumbnailUrl(vehicleId, cover.id);
	});

	// Lazy-load InsuranceTab when overview tab is active and page has loaded. T12b-3c: loaded for a
	// shared viewer/editor too (read-only) now that the per-vehicle policies LIST (T8b) AND the claims
	// sub-reads (C475) are both widened to shared read; the render-site passes `readOnly={!isOwner}`.
	$effect(() => {
		if (!isLoading && !hasLoadedInsurance && activeTab === 'overview') {
			hasLoadedInsurance = true;
			import('$lib/components/insurance/InsuranceTab.svelte').then(m => {
				InsuranceTab = m.default;
			});
		}
	});

	// Load data on mount. T12b-3c: the vehicle PHOTOS read (GET /photos/vehicle/:id) is owner-only
	// server-side AND the photo carousel is already isOwner-gated (T12b-3b), so for a shared viewer/
	// editor the fetch is pure waste that only produces a "vehicle not found" error toast (a
	// four-states violation). Load the vehicle FIRST to establish isOwner, then fetch photos only for
	// the owner; summary + fuel-efficiency are shared-readable (T5b-3 / T8a) so they fire for everyone.
	onMount(async () => {
		await loadVehicle();
		await Promise.all([
			...(isOwner ? [loadPhotos()] : []),
			loadSummary(),
			loadFuelEfficiency()
		]);
		// Load stats after initial data is loaded
		if (vehicle) {
			await loadVehicleStats();
		}
		isLoading = false;
	});

	// Reload stats when period changes (skip initial — onMount already loads)
	let previousStatsPeriod = $state<TimePeriod | null>(null);
	$effect(() => {
		if (
			!isLoading &&
			selectedStatsPeriod &&
			previousStatsPeriod !== null &&
			selectedStatsPeriod !== previousStatsPeriod
		) {
			void loadVehicleStats();
			void loadSummary();
		}
		previousStatsPeriod = selectedStatsPeriod;
	});

	// Load expenses tab data when tab becomes active for the first time
	$effect(() => {
		if (activeTab === 'expenses' && !hasLoadedExpensesTab && !isLoading) {
			hasLoadedExpensesTab = true;
			void fetchExpensesPage(0);
		}
	});

	async function loadVehicle() {
		try {
			vehicle = await vehicleApi.getVehicle(vehicleId);
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load vehicle');
			goto(resolve(routes.dashboard));
		}
	}

	async function loadSummary() {
		isLoadingStats = true;
		summaryLoadError = null;
		try {
			summary = await expenseApi.getExpenseSummary({
				vehicleId,
				period: selectedStatsPeriod
			});
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load expense summary');
			summaryLoadError = error instanceof Error ? error.message : 'Failed to load expense summary';
		} finally {
			isLoadingStats = false;
		}
	}

	async function loadFuelEfficiency() {
		try {
			const result = await analyticsApi.getFuelEfficiency({ vehicleId });
			fuelEfficiencyPoints = result.fuelEfficiencyTrend;
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load fuel efficiency data');
		}
	}

	async function fetchExpensesPage(offset: number) {
		isLoadingPage = true;
		expensesLoadError = null;
		try {
			const result = await expenseApi.getExpensesByVehicle(vehicleId, {
				limit: pageSize,
				offset,
				sortBy: expenseSortBy,
				sortDir: expenseSortDir
			});
			expenses = result.data;
			totalCount = result.pagination.totalCount;
			currentOffset = offset;
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load expenses');
			expensesLoadError = error instanceof Error ? error.message : 'Failed to load expenses';
		} finally {
			isLoadingPage = false;
		}
	}

	/** Sort changed in the Expenses tab — re-fetch from page 0 so it spans all pages. */
	function handleExpenseSortChange(by: 'date' | 'amount', dir: 'asc' | 'desc') {
		expenseSortBy = by;
		expenseSortDir = dir;
		fetchExpensesPage(0);
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

	async function handleDeleteExpense(_deletedExpense: Expense) {
		// Re-fetch current page, summary, and fuel efficiency after deletion
		await Promise.all([fetchExpensesPage(currentOffset), loadSummary(), loadFuelEfficiency()]);
	}

	function handlePageChange(offset: number) {
		fetchExpensesPage(offset);
	}

	function clearFilters() {
		searchTerm = '';
		filters = {};
	}

	// Export THIS vehicle's expenses as CSV (server-generated, vehicle-scoped).
	// Mirrors the global expenses page; the endpoint already filters by vehicleId.
	let isExporting = $state(false);
	async function handleExportCsv() {
		isExporting = true;
		try {
			await expenseApi.downloadExpensesCsv({ vehicleId });
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to export expenses');
		} finally {
			isExporting = false;
		}
	}

	function handlePeriodChange(period: TimePeriod) {
		selectedStatsPeriod = period;
	}

	async function loadPhotos() {
		try {
			const photosResult = await vehicleApi.getPhotos(vehicleId);
			vehiclePhotos = photosResult.data;
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load photos');
		}
	}

	function handlePhotoUploadComplete(photo: Photo) {
		vehiclePhotos = [...vehiclePhotos, photo];
	}

	async function handleDeletePhoto(photoId: string) {
		try {
			await vehicleApi.deletePhoto(vehicleId, photoId);
			vehiclePhotos = vehiclePhotos.filter(p => p.id !== photoId);
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to delete photo');
		}
	}

	async function handleSetCover(photoId: string) {
		try {
			const updated = await vehicleApi.setCoverPhoto(vehicleId, photoId);
			vehiclePhotos = vehiclePhotos.map(p => ({
				...p,
				isCover: p.id === updated.id
			}));
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to set cover photo');
		}
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
				{#each Array(4) as _, i (i)}
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
	<div class="space-y-6 pb-24">
		<!-- Header -->
		<div class="flex items-start justify-between gap-4">
			<VehicleHeader {vehicle} displayName={vehicleDisplayName} {coverPhotoUrl} />
			<!-- Share management is owner-only (server keeps strict validateVehicleOwnership on /shares). -->
			{#if isOwner}
				<Button variant="outline" size="sm" onclick={() => (shareOpen = true)} class="shrink-0">
					<Users class="mr-2 h-4 w-4" />
					Share
				</Button>
			{/if}
		</div>
		{#if isOwner}
			<ShareVehicleDialog bind:open={shareOpen} {vehicleId} vehicleName={vehicleDisplayName} />
		{/if}

		<!-- Tabs Navigation -->
		<Tabs bind:value={activeTab} class="space-y-6">
			<TabsList class="grid w-full grid-cols-4">
				<TabsTrigger value="overview">Overview</TabsTrigger>
				<TabsTrigger value="expenses">Expenses</TabsTrigger>
				<TabsTrigger value="loan">Finance</TabsTrigger>
				<TabsTrigger value="odometer">Odometer</TabsTrigger>
			</TabsList>

			<!-- Overview Tab -->
			<TabsContent value="overview" class="space-y-6">
				<!-- Vehicle Info + Photos: side-by-side on desktop, stacked on mobile -->
				<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
					<VehicleInfoCard {vehicle} {isOwner} />
					<VehiclePhotoCarousel
						{vehicleId}
						photos={vehiclePhotos}
						{isOwner}
						onUpload={() => (showUploadDialog = true)}
						onDelete={handleDeletePhoto}
						onSetCover={handleSetCover}
					/>
				</div>

				<!-- Insurance Summary (lazy-loaded). T12b-3c: shown to a shared viewer/editor in READ-ONLY
				     mode (readOnly={!isOwner}) — the per-vehicle policies LIST (T8b) + the claims sub-reads
				     (C475) are both widened to shared read, and the InsuranceTab tree hides every mutate
				     affordance (add/edit/renew/delete policy + term, file/edit/delete claim, upload/delete
				     document) when readOnly. Insurance WRITES stay owner-only server-side (validateInsurance-
				     Ownership denies BOTH viewer and editor), so readOnly tracks !isOwner, not !canWrite. -->
				{#if InsuranceTab}
					<InsuranceTab {vehicleId} readOnly={!isOwner} />
				{/if}

				{#if summaryLoadError && !isLoadingStats}
					<!-- Error state takes precedence over the empty state: a summary load
					     failure must NOT render "No expenses yet" (a returning user would think
					     their data vanished). Mirrors the dashboard/analytics error+retry idiom. -->
					<div class="rounded-lg border bg-card p-6">
						<div class="mb-4 flex items-center gap-3 text-destructive">
							<CircleAlert class="h-5 w-5" />
							<p class="font-medium">Failed to load expense summary</p>
						</div>
						<p class="mb-4 text-sm text-muted-foreground">{summaryLoadError}</p>
						<Button onclick={loadSummary}>Retry</Button>
					</div>
				{:else if !hasExpenseData}
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
							<!-- Logging an expense is a WRITE (owner or accepted editor) — hide for a viewer. -->
							{#if canWrite}
								<Button
									href={`${resolve(routes.expenseNew)}?vehicleId=${vehicleId}&returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`}
								>
									<Plus class="h-4 w-4 mr-2" />
									{COMMON_MESSAGES.ADD_EXPENSE}
								</Button>
							{/if}
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

					<!-- Trend Charts - Side by Side on Desktop -->
					<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
						<!-- Expense Trend Chart -->
						<ExpenseTrendChart
							data={expenseTrendData}
							description={selectedStatsPeriod === 'all'
								? 'All Time'
								: `Last ${selectedStatsPeriod}`}
							isLoading={isLoadingStats}
						/>

						<!-- Fuel Efficiency Trend Chart -->
						{#if vehicle}
							<FuelEfficiencyTrendChart
								data={fuelEfficiencyData}
								fuelType={vehicle.vehicleType || 'gas'}
								unitPreferences={vehicle.unitPreferences}
								isLoading={false}
							/>
						{/if}
					</div>

					<!-- Expenses by Category with Pie Chart -->
					{#if categoryChartData.length > 0}
						<AppPieChart
							title="Expense by Category"
							description="Distribution across all vehicles"
							data={categoryChartData}
							isLoading={isLoadingStats}
						/>
					{/if}
				{/if}
			</TabsContent>

			<!-- Expenses Tab -->
			<TabsContent value="expenses" class="space-y-6">
				<ExpenseSearchFilters
					{searchTerm}
					bind:filters
					{expenses}
					onSearchChange={v => (searchTerm = v)}
					onClearFilters={clearFilters}
				/>

				<!-- Expense List -->
				<CardFull.Root>
					<CardFull.Header class="flex flex-row items-center justify-between gap-2 space-y-0">
						<CardFull.Title>All Expenses ({totalCount})</CardFull.Title>
						<!-- CSV export is owner-only: the server /expenses/export keeps strict
						     validateVehicleOwnership (T5b-3b export-read widening is deferred), so a shared
						     invitee hitting it would 404. Hide rather than show a button that errors. -->
						{#if totalCount > 0 && isOwner}
							<Button variant="outline" size="sm" onclick={handleExportCsv} disabled={isExporting}>
								<Download class="mr-2 h-4 w-4" />
								{isExporting ? 'Exporting…' : 'Export CSV'}
							</Button>
						{/if}
					</CardFull.Header>
					<CardFull.Content>
						{#if expensesLoadError && !isLoadingPage}
							<!-- Load failure must show error+retry, not the table's "No expenses" empty
							     state (which would falsely imply this vehicle has zero expenses). -->
							<div class="flex flex-col items-center gap-3 py-8 text-center">
								<CircleAlert class="h-8 w-8 text-destructive" />
								<p class="font-medium">Failed to load expenses</p>
								<p class="text-sm text-muted-foreground">{expensesLoadError}</p>
								<Button variant="outline" onclick={() => fetchExpensesPage(currentOffset)}>
									Retry
								</Button>
							</div>
						{:else}
							<ExpensesTable
								expenses={filteredExpenses}
								showVehicleColumn={false}
								canWrite={canWrite}
								returnTo={resolve(paramRoutes.vehicle, { id: vehicleId })}
								onDelete={handleDeleteExpense}
								emptyTitle={COMMON_MESSAGES.NO_EXPENSES}
								emptyDescription="Start tracking expenses for this vehicle"
								emptyActionLabel={COMMON_MESSAGES.ADD_EXPENSE}
								emptyActionHref={`${resolve(routes.expenseNew)}?vehicleId=${vehicleId}&returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`}
								scrollHeight={SCROLL_HEIGHTS.TABLE_DEFAULT}
								onClearFilters={clearFilters}
								{hasActiveFilters}
								{totalCount}
								{currentOffset}
								{pageSize}
								{isLoadingPage}
								onPageChange={handlePageChange}
								activeSortBy={expenseSortBy}
								activeSortDir={expenseSortDir}
								onSortChange={handleExpenseSortChange}
							/>
						{/if}
					</CardFull.Content>
				</CardFull.Root>
			</TabsContent>

			<!-- Odometer Tab -->
			<TabsContent value="odometer" class="space-y-6">
				<OdometerTab {vehicleId} {canWrite} unitPreferences={vehicle?.unitPreferences} />
			</TabsContent>

			<!-- Finance Tab -->
			<TabsContent value="loan" class="space-y-4 sm:space-y-6">
				{#if vehicle}
					<FinanceTab {vehicle} {vehicleId} {isOwner} {vehicleStatsData} />
				{/if}
			</TabsContent>
		</Tabs>

		<MediaCaptureDialog
			bind:open={showUploadDialog}
			title="Upload Vehicle Photos"
			description="Upload or capture photos of your vehicle (JPEG, PNG, WebP up to 10MB)"
			onUpload={file => vehicleApi.uploadPhoto(vehicleId, file)}
			onUploadComplete={result => handlePhotoUploadComplete(result as Photo)}
			onClose={() => (showUploadDialog = false)}
		/>
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
			<Button onclick={() => goto(resolve(routes.dashboard))}
				>{VEHICLE_MESSAGES.BACK_TO_DASHBOARD}</Button
			>
		{/snippet}
	</EmptyState>
{/if}

<!-- Floating Action Button — logging an expense is a WRITE; hide for a viewer (owner/editor only). -->
{#if vehicle && canWrite}
	<FloatingActionButton
		href={`${resolve(routes.expenseNew)}?vehicleId=${vehicleId}&returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`}
		label={COMMON_MESSAGES.ADD_EXPENSE}
		ariaLabel="Add expense"
	/>
{/if}
