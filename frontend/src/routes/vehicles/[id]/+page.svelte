<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { parseMonthToDate } from '#lib/utils/chart-formatters.ts';
	import { onMount, type Component } from 'svelte';
	import { Plus, FileText, Download, CircleAlert, Users } from '@lucide/svelte';
	import FloatingActionButton from '#lib/components/common/floating-action-button.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '#lib/components/ui/tabs/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { Card, CardContent } from '#lib/components/ui/card/index.ts';
	import * as CardFull from '#lib/components/ui/card/index.ts';
	import ExpensesTable from '#lib/components/expenses/ExpensesTable.svelte';
	import ExpenseSearchFilters from '#lib/components/expenses/ExpenseSearchFilters.svelte';
	import ExpenseTrendChart from '#lib/components/charts/ExpenseTrendChart.svelte';
	import FuelEfficiencyTrendChart from '#lib/components/charts/FuelEfficiencyTrendChart.svelte';
	import { AppPieChart } from '#lib/components/charts/index.ts';
	import VehicleHeader from '#lib/components/vehicles/VehicleHeader.svelte';
	import ShareVehicleDialog from '#lib/components/vehicles/ShareVehicleDialog.svelte';
	import VehiclePhotoCarousel from '#lib/components/vehicles/VehiclePhotoCarousel.svelte';
	import MediaCaptureDialog from '#lib/components/common/MediaCaptureDialog.svelte';
	import VehicleInfoCard from '#lib/components/vehicles/VehicleInfoCard.svelte';
	import ExpenseOverviewCard from '#lib/components/vehicles/ExpenseOverviewCard.svelte';
	import FuelEfficiencyStatsCard from '#lib/components/vehicles/FuelEfficiencyStatsCard.svelte';
	import PeriodSelector from '#lib/components/common/period-selector.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import FinanceTab from '#lib/components/vehicles/FinanceTab.svelte';
	import OdometerTab from '#lib/components/vehicles/OdometerTab.svelte';
	let InsuranceTab = $state<Component<{ vehicleId: string; readOnly?: boolean }> | null>(null);
	let hasLoadedInsurance = $state(false);
	import { categoryLabels } from '#lib/utils/expense-helpers.ts';
	import { getCategoryChartColor } from '#lib/utils/chart-colors.ts';
	import { hasActiveFilters as checkActiveFilters } from '#lib/utils/expense-filters.ts';
	import { COMMON_MESSAGES, VEHICLE_MESSAGES } from '#lib/constants/messages.ts';
	import { type TimePeriod } from '#lib/constants/time-periods.ts';
	import { SCROLL_HEIGHTS } from '#lib/constants/ui.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { expenseApi } from '#lib/services/expense-api.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';
	import type {
		Vehicle,
		Expense,
		ExpenseFilters,
		VehicleStats,
		Photo,
		ExpenseSummary,
		FuelEfficiencyPoint,
		ExpenseCategory
	} from '#lib/types/index.ts';
	import { useExpenseListReload } from '../../expenses/expense-list-reload.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let vehicleId = $derived(data.vehicleId);

	let isLoading = $state(true);
	let isLoadingStats = $state(false);
	let vehicle = $state<Vehicle | null>(null);
	let activeTab = $state('overview');
	let vehicleStatsData = $state<VehicleStats | null>(null);
	let selectedStatsPeriod = $state<TimePeriod>('all');

	let summary = $state<ExpenseSummary | null>(null);
	let fuelEfficiencyPoints = $state<FuelEfficiencyPoint[]>([]);
	let summaryLoadError = $state<string | null>(null);

	let expenses = $state<Expense[]>([]);
	let currentOffset = $state(0);
	let pageSize = $state(20);
	let totalCount = $state(0);
	let isLoadingPage = $state(false);
	let hasLoadedExpensesTab = $state(false);
	let expensesLoadError = $state<string | null>(null);
	let expenseSortBy = $state<'date' | 'amount'>('date');
	let expenseSortDir = $state<'asc' | 'desc'>('desc');

	let vehiclePhotos = $state<Photo[]>([]);
	let showUploadDialog = $state(false);

	let shareOpen = $state(false);

	let searchTerm = $state('');
	let filters = $state<ExpenseFilters>({});
	let expenseCategoryFilter = $state<string>('');

	let expenseTrendData = $derived.by(() => {
		if (!summary?.monthlyTrend.length) return [];
		return summary.monthlyTrend.map(item => ({
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

	let localStats = $derived({
		totalExpenses: summary?.totalAmount ?? 0,
		recentExpenses: summary?.recentAmount ?? 0,
		monthlyAverage: summary?.monthlyAverage ?? 0
	});

	let hasExpenseData = $derived((summary?.expenseCount ?? 0) > 0);

	let hasActiveFilters = $derived(
		checkActiveFilters(searchTerm, filters) || !!expenseCategoryFilter
	);

	let vehicleDisplayName = $derived(
		vehicle ? vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}` : ''
	);

	let isOwner = $derived(!vehicle?.sharedAccess);
	let canWrite = $derived(!vehicle?.sharedAccess || vehicle.sharedAccess.level === 'editor');

	let coverPhotoUrl = $derived.by(() => {
		const cover = vehiclePhotos.find(p => p.isCover);
		if (!cover) return null;
		return vehicleApi.getPhotoThumbnailUrl(vehicleId, cover.id);
	});

	$effect(() => {
		if (!isLoading && !hasLoadedInsurance && activeTab === 'overview') {
			hasLoadedInsurance = true;
			import('#lib/components/insurance/InsuranceTab.svelte').then(m => {
				InsuranceTab = m.default;
			});
		}
	});

	onMount(async () => {
		await Promise.all([loadVehicle(), loadSummary(), loadFuelEfficiency(), loadVehicleStats()]);
		if (vehicle && isOwner) {
			await loadPhotos();
		}
		isLoading = false;
	});

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

	$effect(() => {
		if (activeTab === 'expenses' && !hasLoadedExpensesTab && !isLoading) {
			hasLoadedExpensesTab = true;
			void fetchExpensesPage(0);
		}
	});

	function filterKey(): string {
		return JSON.stringify([
			expenseCategoryFilter,
			filters.startDate ?? '',
			filters.endDate ?? '',
			filters.tags ?? []
		]);
	}

	const expenseListReload = useExpenseListReload({
		ready: () => hasLoadedExpensesTab,
		search: () => searchTerm,
		filterKey,
		reload: () => fetchExpensesPage(0)
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

	function buildExpenseListParams(offset: number) {
		return {
			limit: pageSize,
			offset,
			...(expenseCategoryFilter && { category: expenseCategoryFilter }),
			...(filters.startDate && { startDate: filters.startDate }),
			...(filters.endDate && { endDate: filters.endDate }),
			...(filters.tags?.length && { tags: filters.tags }),
			...(searchTerm.trim() && { search: searchTerm.trim() }),
			sortBy: expenseSortBy,
			sortDir: expenseSortDir
		};
	}

	async function fetchExpensesPage(offset: number) {
		isLoadingPage = true;
		expensesLoadError = null;
		try {
			const result = await expenseApi.getExpensesByVehicle(
				vehicleId,
				buildExpenseListParams(offset)
			);
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

	function handleExpenseSortChange(by: 'date' | 'amount', dir: 'asc' | 'desc') {
		expenseSortBy = by;
		expenseSortDir = dir;
		fetchExpensesPage(0);
	}

	function handleExpenseCategoryChange(category: string) {
		expenseCategoryFilter = category;
		expenseListReload.reloadNow();
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
		const remaining = Math.max(0, totalCount - 1);
		const offset =
			currentOffset >= remaining ? Math.max(0, currentOffset - pageSize) : currentOffset;
		await Promise.all([fetchExpensesPage(offset), loadSummary(), loadFuelEfficiency()]);
	}

	function handlePageChange(offset: number) {
		fetchExpensesPage(offset);
	}

	function clearFilters() {
		searchTerm = '';
		filters = {};
		expenseCategoryFilter = '';
		expenseListReload.reloadNow();
	}

	let isExporting = $state(false);
	async function handleExportCsv() {
		isExporting = true;
		try {
			await expenseApi.downloadExpensesCsv({
				vehicleId,
				category: expenseCategoryFilter || undefined,
				startDate: filters.startDate,
				endDate: filters.endDate,
				search: searchTerm.trim() || undefined,
				tags: filters.tags?.length ? filters.tags : undefined
			});
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
		<div class="flex items-center gap-4">
			<Skeleton class="h-10 w-10 rounded-md" />
			<div class="space-y-2">
				<Skeleton class="h-8 w-64" />
				<Skeleton class="h-5 w-48" />
			</div>
		</div>

		<div class="space-y-6">
			<Skeleton class="h-10 w-full" />
			<div class="flex justify-end">
				<Skeleton class="h-10 w-[180px]" />
			</div>

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
		<div class="flex items-start justify-between gap-4">
			<VehicleHeader {vehicle} displayName={vehicleDisplayName} {coverPhotoUrl} />
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

		<Tabs bind:value={activeTab} class="space-y-6">
			<TabsList class="grid w-full grid-cols-4">
				<TabsTrigger value="overview">Overview</TabsTrigger>
				<TabsTrigger value="expenses">Expenses</TabsTrigger>
				<TabsTrigger value="loan">Finance</TabsTrigger>
				<TabsTrigger value="odometer">Odometer</TabsTrigger>
			</TabsList>

			<TabsContent value="overview" class="space-y-6">
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

				{#if InsuranceTab}
					<InsuranceTab {vehicleId} readOnly={!isOwner} />
				{/if}

				{#if summaryLoadError && !isLoadingStats}
					<div class="rounded-lg border bg-card p-6">
						<div class="mb-4 flex items-center gap-3 text-destructive">
							<CircleAlert class="h-5 w-5" />
							<p class="font-medium">Failed to load expense summary</p>
						</div>
						<p class="mb-4 text-sm text-muted-foreground">{summaryLoadError}</p>
						<Button onclick={loadSummary}>Retry</Button>
					</div>
				{:else if !hasExpenseData}
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
					<PeriodSelector
						selectedPeriod={selectedStatsPeriod}
						isLoading={isLoadingStats}
						onPeriodChange={handlePeriodChange}
					/>

					<ExpenseOverviewCard stats={localStats} />

					<FuelEfficiencyStatsCard
						{vehicleId}
						{vehicleStatsData}
						{isLoadingStats}
						{selectedStatsPeriod}
					/>

					<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
						<ExpenseTrendChart
							data={expenseTrendData}
							description={selectedStatsPeriod === 'all'
								? 'All Time'
								: `Last ${selectedStatsPeriod}`}
							isLoading={isLoadingStats}
						/>

						{#if vehicle}
							<FuelEfficiencyTrendChart
								data={fuelEfficiencyData}
								fuelType={vehicle.vehicleType || 'gas'}
								unitPreferences={vehicle.unitPreferences}
								isLoading={false}
							/>
						{/if}
					</div>

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

			<TabsContent value="expenses" class="space-y-6">
				<ExpenseSearchFilters
					{searchTerm}
					bind:filters
					{expenses}
					onSearchChange={v => (searchTerm = v)}
					onClearFilters={clearFilters}
				/>

				<CardFull.Root>
					<CardFull.Header class="flex flex-row items-center justify-between gap-2 space-y-0">
						<CardFull.Title>All Expenses ({totalCount})</CardFull.Title>
						{#if totalCount > 0 && isOwner}
							<Button variant="outline" size="sm" onclick={handleExportCsv} disabled={isExporting}>
								<Download class="mr-2 h-4 w-4" />
								{isExporting ? 'Exporting…' : 'Export CSV'}
							</Button>
						{/if}
					</CardFull.Header>
					<CardFull.Content>
						{#if expensesLoadError && !isLoadingPage}
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
								{expenses}
								showVehicleColumn={false}
								{canWrite}
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
								activeCategory={expenseCategoryFilter}
								onCategoryChange={handleExpenseCategoryChange}
							/>
						{/if}
					</CardFull.Content>
				</CardFull.Root>
			</TabsContent>

			<TabsContent value="odometer" class="space-y-6">
				<OdometerTab {vehicleId} {canWrite} unitPreferences={vehicle?.unitPreferences} />
			</TabsContent>

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

{#if vehicle && canWrite}
	<FloatingActionButton
		href={`${resolve(routes.expenseNew)}?vehicleId=${vehicleId}&returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`}
		label={COMMON_MESSAGES.ADD_EXPENSE}
		ariaLabel="Add expense"
	/>
{/if}
