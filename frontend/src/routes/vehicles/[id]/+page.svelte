<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { parseMonthToDate } from '#lib/utils/chart-formatters.ts';
	import { onMount, untrack, type Component } from 'svelte';
	import {
		Plus,
		FileText,
		Download,
		CircleAlert,
		Users,
		LoaderCircle,
		WifiOff,
		Ellipsis,
		ChevronRight
	} from '@lucide/svelte';
	import FloatingActionButton from '#lib/components/common/floating-action-button.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '#lib/components/ui/tabs/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import * as CardFull from '#lib/components/ui/card/index.ts';
	import ChartCard from '#lib/components/charts/ChartCard.svelte';
	import VehicleHeader from '#lib/components/vehicles/VehicleHeader.svelte';
	import VehiclePhotoCarousel from '#lib/components/vehicles/VehiclePhotoCarousel.svelte';
	import VehicleInfoCard from '#lib/components/vehicles/VehicleInfoCard.svelte';
	import CostPerMileHero from '#lib/components/vehicles/CostPerMileHero.svelte';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import { distanceDriven } from '#lib/utils/cost-per-distance.ts';
	import { lastTwelveMonths } from '#lib/utils/fuel-economy.ts';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '#lib/components/ui/collapsible/index.ts';
	import { resolveCurrentOdometer } from '#lib/utils/financing-calculations.ts';
	import FuelEfficiencyStatsCard from '#lib/components/vehicles/FuelEfficiencyStatsCard.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	let InsuranceTab = $state<Component<{ vehicleId: string; readOnly?: boolean }> | null>(null);
	let hasLoadedInsurance = $state(false);
	import { categoryLabels } from '#lib/utils/expense-helpers.ts';
	import { getFuelEfficiencyLabel, getElectricEfficiencyLabel } from '#lib/utils/units.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { getCategoryChartColor } from '#lib/utils/chart-colors.ts';
	import { hasActiveFilters as checkActiveFilters } from '#lib/utils/expense-filters.ts';
	import { COMMON_MESSAGES, VEHICLE_MESSAGES } from '#lib/constants/messages.ts';
	import { type TimePeriod } from '#lib/constants/time-periods.ts';
	import { SCROLL_HEIGHTS } from '#lib/constants/ui.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { expenseApi } from '#lib/services/expense-api.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import {
		ApiError,
		handleErrorWithNotification,
		logLoadFailure,
		userFacingErrorMessage
	} from '#lib/utils/error-handling.ts';
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
	import { latest } from '#lib/utils/latest-request.ts';
	import { loadWhenIdle } from '#lib/utils/idle.ts';
	import { onlineStatus } from '#lib/stores/offline.svelte.ts';
	import { loadCachedVehicles } from '#lib/utils/offline-storage.ts';
	import { useExpenseListReload } from '../../expenses/expense-list-reload.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let vehicleId = $derived(data.vehicleId);

	let isLoading = $state(true);
	let vehicleLoadError = $state<string | null>(null);
	let isLoadingSummary = $state(false);
	let isLoadingVehicleStats = $state(false);
	let isLoadingStats = $derived(isLoadingSummary || isLoadingVehicleStats);
	let vehicle = $state<Vehicle | null>(null);
	let showingCachedVehicle = $state(false);
	let activeTab = $state('overview');
	let visitedTabs = $state<Record<string, boolean>>({ overview: true });
	let vehicleStatsData = $state<VehicleStats | null>(null);
	const selectedStatsPeriod: TimePeriod = 'all';

	let summary = $state<ExpenseSummary | null>(null);
	let fuelEfficiencyPoints = $state<FuelEfficiencyPoint[]>([]);
	let isLoadingFuelEfficiency = $state(true);
	let yearStats = $state<VehicleStats | null>(null);
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
	let isLoadingPhotos = $state(false);
	let showUploadDialog = $state(false);

	let shareOpen = $state(false);
	let moreMenuOpen = $state(false);
	let detailsOpen = $state(false);
	let hasOpenedDetails = $state(false);
	let hasOpenedUpload = $state(false);

	const CATEGORY_CHART_TITLE = 'Expense by Category';
	const CATEGORY_CHART_DESCRIPTION = 'Distribution for this vehicle';
	const CHARTS_LOAD_ERROR = "Charts couldn't be loaded. Check your connection and reload.";
	const fuelChartLoading = import('#lib/components/charts/FuelEfficiencyTrendChart.svelte');
	const loadSpendCharts = () =>
		Promise.all([
			import('#lib/components/charts/ExpenseTrendChart.svelte'),
			import('#lib/components/charts/index.ts')
		]);
	const loadExpensesTab = () =>
		Promise.all([
			import('#lib/components/expenses/ExpenseSearchFilters.svelte'),
			import('#lib/components/expenses/ExpensesTable.svelte')
		]);
	const loadOdometerTab = () => import('#lib/components/vehicles/OdometerTab.svelte');
	const loadFinanceTab = () => import('#lib/components/vehicles/FinanceTab.svelte');
	const loadUploadDialog = () => import('#lib/components/common/MediaCaptureDialog.svelte');

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

	let recentFuelEfficiency = $derived(lastTwelveMonths(fuelEfficiencyData));

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

	let distanceUnit = $derived(
		vehicle?.unitPreferences?.distanceUnit ?? settingsStore.unitPreferences.distanceUnit
	);
	let currentOdometer = $derived(
		vehicle
			? resolveCurrentOdometer(
					vehicleStatsData?.currentOdometer,
					vehicleStatsData?.currentMileage,
					vehicle.initialMileage
				)
			: null
	);
	let distanceSoFar = $derived(
		vehicleStatsData ? distanceDriven(currentOdometer, vehicle?.initialMileage) : null
	);

	let hasExpenseData = $derived((summary?.expenseCount ?? 0) > 0);

	let hasActiveFilters = $derived(
		checkActiveFilters(searchTerm, filters) || !!expenseCategoryFilter
	);

	let vehicleDisplayName = $derived(
		vehicle ? vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}` : ''
	);

	const trendDescription = 'All Time';
	let fuelChartTitle = $derived(
		vehicle?.vehicleType === 'electric' ? 'Electric Efficiency' : 'Fuel Efficiency'
	);
	let fuelChartDescription = $derived.by(() => {
		const units = vehicle?.unitPreferences ?? settingsStore.unitPreferences;
		return `Measured in ${
			vehicle?.vehicleType === 'electric'
				? getElectricEfficiencyLabel(units.distanceUnit, units.chargeUnit)
				: getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)
		}`;
	});

	let isOwner = $derived(!vehicle?.sharedAccess);
	let canWrite = $derived(!vehicle?.sharedAccess || vehicle.sharedAccess.level === 'editor');
	let showAddExpenseAction = $derived(canWrite && activeTab !== 'odometer');
	let addExpenseHref = $derived(
		`${resolve(routes.expenseNew)}?vehicleId=${vehicleId}&returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`
	);

	let coverPhotoUrl = $derived.by(() => {
		const cover = vehiclePhotos.find(p => p.isCover);
		if (!cover) return null;
		return vehicleApi.getPhotoThumbnailUrl(vehicleId, cover.id);
	});

	function loadInsuranceTab() {
		if (hasLoadedInsurance) return Promise.resolve();
		hasLoadedInsurance = true;
		return import('#lib/components/insurance/InsuranceTab.svelte').then(
			m => {
				InsuranceTab = m.default;
			},
			() => {
				hasLoadedInsurance = false;
			}
		);
	}

	async function loadPage() {
		isLoading = true;
		const vehicleRequest = loadVehicle();
		summarySettled = loadSummary();
		vehicleSettled = vehicleRequest;
		void loadFuelEfficiency();
		void loadVehicleStats();
		await vehicleRequest;
		if (vehicle && isOwner && !showingCachedVehicle) void loadPhotos();
		isLoading = false;
	}

	onMount(() => {
		void loadPage();
	});

	$effect(() => {
		if (showingCachedVehicle && onlineStatus.current) untrack(loadPage);
	});

	$effect(() => {
		visitedTabs[activeTab] = true;
	});

	let hasPrefetchedTabs = false;
	$effect(() => {
		if (isLoading || !vehicle || hasPrefetchedTabs) return;
		hasPrefetchedTabs = true;
		loadWhenIdle([
			loadExpensesTab,
			loadSpendCharts,
			loadOdometerTab,
			loadFinanceTab,
			loadInsuranceTab,
			...(isOwner ? [loadUploadDialog] : [])
		]);
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

	let vehicleSettled: Promise<void> = Promise.resolve();
	let summarySettled: Promise<void> = Promise.resolve();
	let statsError = $state<string | null>(null);

	async function notifyUnlessPageFailed(error: unknown, context: string) {
		await vehicleSettled;
		if (vehicle && !showingCachedVehicle) handleErrorWithNotification(error, context);
		else logLoadFailure(error, context);
	}

	async function loadVehicle() {
		vehicleLoadError = null;
		try {
			vehicle = await vehicleApi.getVehicle(vehicleId);
			showingCachedVehicle = false;
		} catch (error) {
			if (error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 400)) {
				handleErrorWithNotification(error, "Couldn't load this vehicle");
				goto(resolve(routes.dashboard));
				return;
			}
			const cached = onlineStatus.current
				? undefined
				: loadCachedVehicles().find(v => v.id === vehicleId);
			if (cached) {
				vehicle = cached;
				showingCachedVehicle = true;
				return;
			}
			logLoadFailure(error, "Couldn't load this vehicle");
			vehicleLoadError = userFacingErrorMessage(error);
		}
	}

	const nextSummaryRequest = latest();
	const nextVehicleStatsRequest = latest();

	async function loadSummary() {
		const isCurrent = nextSummaryRequest();
		isLoadingSummary = true;
		summaryLoadError = null;
		try {
			const loaded = await expenseApi.getExpenseSummary({
				vehicleId,
				period: selectedStatsPeriod
			});
			if (isCurrent()) summary = loaded;
		} catch (error) {
			if (!isCurrent()) return;
			logLoadFailure(error, "Couldn't load the expense summary");
			summaryLoadError = userFacingErrorMessage(error);
		} finally {
			if (isCurrent()) isLoadingSummary = false;
		}
	}

	const nextFuelEfficiencyRequest = latest();

	async function loadFuelEfficiency() {
		const isCurrent = nextFuelEfficiencyRequest();
		isLoadingFuelEfficiency = true;
		void vehicleApi.getVehicleStats(vehicleId, '1y').then(
			loaded => {
				if (isCurrent()) yearStats = loaded;
			},
			error => {
				if (isCurrent()) logLoadFailure(error, "Couldn't load the last 12 months of fuel stats");
			}
		);
		try {
			const result = await analyticsApi.getFuelEfficiency({ vehicleId });
			if (isCurrent()) fuelEfficiencyPoints = result.fuelEfficiencyTrend;
		} catch (error) {
			if (isCurrent())
				void vehicleSettled.then(() =>
					notifyUnlessPageFailed(error, `Couldn't load ${fuelChartTitle.toLowerCase()}`)
				);
		} finally {
			if (isCurrent()) isLoadingFuelEfficiency = false;
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
			logLoadFailure(error, "Couldn't load expenses");
			expensesLoadError = userFacingErrorMessage(error);
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
		const isCurrent = nextVehicleStatsRequest();
		isLoadingVehicleStats = true;
		try {
			const loaded = await vehicleApi.getVehicleStats(vehicleId, selectedStatsPeriod);
			if (isCurrent()) {
				vehicleStatsData = loaded;
				statsError = null;
			}
		} catch (error) {
			if (!isCurrent()) return;
			statsError = userFacingErrorMessage(error);
			await summarySettled;
			if (hasExpenseData) logLoadFailure(error, "Couldn't load the vehicle's stats");
			else void notifyUnlessPageFailed(error, "Couldn't load the vehicle's stats");
		} finally {
			if (isCurrent()) isLoadingVehicleStats = false;
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
			handleErrorWithNotification(err, "Couldn't export expenses");
		} finally {
			isExporting = false;
		}
	}

	async function loadPhotos() {
		isLoadingPhotos = true;
		try {
			const photosResult = await vehicleApi.getPhotos(vehicleId);
			vehiclePhotos = photosResult.data;
		} catch (error) {
			handleErrorWithNotification(error, "Couldn't load photos");
		} finally {
			isLoadingPhotos = false;
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
			handleErrorWithNotification(error, "Couldn't delete the photo");
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
			handleErrorWithNotification(error, "Couldn't set the cover photo");
		}
	}
</script>

{#snippet fuelChartPlaceholder(error: string | null)}
	<ChartCard
		title={fuelChartTitle}
		description={fuelChartDescription}
		level={3}
		height={280}
		isLoading={!error}
		{error}
	>
		{null}
	</ChartCard>
{/snippet}

{#snippet spendChartPlaceholders(error: string | null)}
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<ChartCard
			title="Expense Trends"
			description={trendDescription}
			height={300}
			isLoading={!error}
			{error}
		>
			{null}
		</ChartCard>
		{#if categoryChartData.length > 0 || summary === null}
			<ChartCard
				title={CATEGORY_CHART_TITLE}
				description={CATEGORY_CHART_DESCRIPTION}
				height={300}
				isLoading={!error}
				{error}
			>
				{null}
			</ChartCard>
		{/if}
	</div>
{/snippet}

{#snippet tabLoading()}
	<div class="flex justify-center p-8">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{/snippet}

{#snippet tabLoadError()}
	<div class="rounded-lg border bg-card p-6">
		<div class="mb-4 flex items-center gap-3 text-destructive">
			<CircleAlert class="h-5 w-5" />
			<p class="font-medium">Couldn't load this tab</p>
		</div>
		<p class="text-sm text-muted-foreground">Check your connection and reload the page.</p>
	</div>
{/snippet}

<svelte:head>
	<title>{vehicleDisplayName} - VROOM Car Tracker</title>
	<meta name="description" content="Vehicle details and expense tracking" />
</svelte:head>

{#if isLoading}
	<div class="space-y-6" data-testid="vehicle-page-skeleton">
		<div class="flex items-center gap-3">
			<Skeleton class="h-10 w-10 shrink-0 rounded-md" />
			<div class="min-w-0">
				<div class="flex h-9 flex-col justify-center gap-1 max-sm:short:h-[4.5rem]">
					<Skeleton class="h-8 w-48" />
					<Skeleton class="hidden h-8 w-24 max-sm:short:block" />
				</div>
				<div class="mt-1 flex h-12 flex-col justify-center gap-2 sm:h-6 max-sm:short:hidden">
					<Skeleton class="h-4 w-44" />
					<Skeleton class="h-4 w-28 sm:hidden" />
				</div>
			</div>
		</div>
		<Skeleton class="mb-8 h-[2.875rem] w-full sm:h-9" />
		<CostPerMileHero
			summary={null}
			distance={null}
			distanceUnit={settingsStore.unitPreferences.distanceUnit}
			vehicleType="gas"
		/>
		<div class="divide-y rounded-xl border bg-card">
			{#each Array(3) as _, i (i)}
				<div class="flex items-center justify-between gap-3 p-4">
					<div class="space-y-1">
						<Skeleton class="h-4 w-32" />
						<Skeleton class="h-3 w-48" />
					</div>
					<Skeleton class="h-5 w-16" />
				</div>
			{/each}
		</div>
	</div>
{:else if vehicleLoadError}
	<LoadErrorCard title="Couldn't load this vehicle" message={vehicleLoadError} onRetry={loadPage} />
{:else if vehicle}
	<div class="space-y-6 pb-24 short:pb-0">
		<div class="flex items-start justify-between gap-4 sm:flex-wrap">
			<div class="min-w-0 grow basis-[min-content]">
				<VehicleHeader
					{vehicle}
					displayName={vehicleDisplayName}
					{coverPhotoUrl}
					odometer={vehicleStatsData ? currentOdometer : null}
					odometerLoading={isLoadingVehicleStats && vehicleStatsData === null}
					{distanceUnit}
				/>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				{#if isOwner && !showingCachedVehicle}
					<Button
						variant="outline"
						size="sm"
						onclick={() => (shareOpen = true)}
						class="hidden h-10 shrink-0 lg:inline-flex"
					>
						<Users class="h-4 w-4 mr-2" aria-hidden="true" />
						Share
					</Button>
					<div class="lg:hidden">
						<Popover.Root bind:open={moreMenuOpen}>
							<Popover.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="outline" size="icon-lg" aria-label="More actions">
										<Ellipsis class="h-4 w-4" />
									</Button>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content align="end" class="flex w-48 flex-col p-1">
								<Button
									variant="ghost"
									class="h-10 w-full justify-start"
									onclick={() => {
										moreMenuOpen = false;
										shareOpen = true;
									}}
								>
									<Users class="mr-2 h-4 w-4" aria-hidden="true" />
									Share
								</Button>
							</Popover.Content>
						</Popover.Root>
					</div>
				{/if}
				{#if showAddExpenseAction}
					<Button
						size="lg"
						class="hidden lg:inline-flex short:inline-flex max-sm:w-10 max-sm:has-[>svg]:px-0"
						href={addExpenseHref}
						aria-label={COMMON_MESSAGES.ADD_EXPENSE}
					>
						<Plus class="h-4 w-4 sm:mr-2" aria-hidden="true" />
						<span class="hidden sm:inline">{COMMON_MESSAGES.ADD_EXPENSE}</span>
					</Button>
				{/if}
			</div>
		</div>
		{#if isOwner && !showingCachedVehicle}
			{#await import('#lib/components/vehicles/ShareVehicleDialog.svelte') then { default: ShareVehicleDialog }}
				<ShareVehicleDialog bind:open={shareOpen} {vehicleId} vehicleName={vehicleDisplayName} />
			{/await}
		{/if}

		{#if showingCachedVehicle}
			<Alert variant="warning" role="status" data-testid="vehicle-offline-notice">
				<WifiOff class="h-4 w-4" />
				<AlertTitle>You're offline</AlertTitle>
				<AlertDescription>
					These are the details saved on this device. Costs, charts and history load when you
					reconnect. Expenses you add now sync automatically.
				</AlertDescription>
			</Alert>
			<VehicleInfoCard {vehicle} {isOwner} />
		{:else}
			<Tabs bind:value={activeTab} class="space-y-6">
				<TabsList class="grid w-full grid-cols-4">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="expenses">Expenses</TabsTrigger>
					<TabsTrigger value="loan">Finance</TabsTrigger>
					<TabsTrigger value="odometer">Odometer</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" class="space-y-6">
					{#if summaryLoadError && !isLoadingStats}
						<LoadErrorCard
							title="Couldn't load the expense summary"
							message={summaryLoadError}
							onRetry={loadSummary}
						/>
					{:else if summary && !hasExpenseData}
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
									<Button href={addExpenseHref}>
										<Plus class="h-4 w-4 mr-2" />
										{COMMON_MESSAGES.ADD_EXPENSE}
									</Button>
								{/if}
							{/snippet}
						</EmptyState>
					{:else}
						<CostPerMileHero
							{summary}
							distance={distanceSoFar}
							distanceLoading={isLoadingVehicleStats && vehicleStatsData === null && !statsError}
							distanceError={vehicleStatsData === null ? statsError : null}
							onRetryDistance={loadVehicleStats}
							{distanceUnit}
							vehicleType={vehicle.vehicleType}
							logMileageHref={canWrite
								? resolve(paramRoutes.vehicleOdometerNew, { id: vehicleId })
								: undefined}
						/>

						<FuelEfficiencyStatsCard
							{vehicleId}
							{vehicleStatsData}
							{isLoadingStats}
							{yearStats}
							trendLoading={isLoadingFuelEfficiency}
							unitPreferences={vehicle?.unitPreferences}
							vehicleType={vehicle?.vehicleType}
							trend={fuelEfficiencyData}
						>
							{#snippet chart()}
								{#await fuelChartLoading}
									{@render fuelChartPlaceholder(null)}
								{:then { default: FuelEfficiencyTrendChart }}
									<FuelEfficiencyTrendChart
										data={recentFuelEfficiency}
										fuelType={vehicle?.vehicleType || 'gas'}
										unitPreferences={vehicle?.unitPreferences}
										isLoading={isLoadingFuelEfficiency}
										level={3}
									/>
								{:catch}
									{@render fuelChartPlaceholder(CHARTS_LOAD_ERROR)}
								{/await}
							{/snippet}
						</FuelEfficiencyStatsCard>
					{/if}

					<Collapsible
						bind:open={detailsOpen}
						onOpenChange={open => {
							if (!open) return;
							hasOpenedDetails = true;
							void loadInsuranceTab();
						}}
						class="rounded-xl border bg-card"
					>
						<CollapsibleTrigger
							class="flex min-h-12 w-full items-center gap-2 rounded-xl px-4 text-left text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-6"
						>
							<ChevronRight
								class="h-4 w-4 shrink-0 transition-transform {detailsOpen ? 'rotate-90' : ''}"
								aria-hidden="true"
							/>
							Details, insurance and photos
						</CollapsibleTrigger>
						<CollapsibleContent class="space-y-6 border-t p-4 sm:p-6">
							{#if hasOpenedDetails}
								<VehicleInfoCard {vehicle} {isOwner} />
								{#if InsuranceTab}
									<InsuranceTab {vehicleId} readOnly={!isOwner} />
								{/if}
								<VehiclePhotoCarousel
									{vehicleId}
									photos={vehiclePhotos}
									{isOwner}
									isLoading={isLoadingPhotos}
									onUpload={() => {
										hasOpenedUpload = true;
										showUploadDialog = true;
									}}
									onDelete={handleDeletePhoto}
									onSetCover={handleSetCover}
								/>
							{/if}
						</CollapsibleContent>
					</Collapsible>
				</TabsContent>

				<TabsContent value="expenses" class="space-y-6">
					{#if visitedTabs['expenses']}
						{#if hasExpenseData}
							{#await loadSpendCharts()}
								{@render spendChartPlaceholders(null)}
							{:then [{ default: ExpenseTrendChart }, { AppPieChart }]}
								<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
									<ExpenseTrendChart
										data={expenseTrendData}
										description={trendDescription}
										isLoading={isLoadingStats}
									/>
									{#if categoryChartData.length > 0 || summary === null}
										<AppPieChart
											title={CATEGORY_CHART_TITLE}
											description={CATEGORY_CHART_DESCRIPTION}
											data={categoryChartData}
											isLoading={isLoadingStats}
										/>
									{/if}
								</div>
							{:catch}
								{@render spendChartPlaceholders(CHARTS_LOAD_ERROR)}
							{/await}
						{/if}
						{#await loadExpensesTab()}
							{@render tabLoading()}
						{:then [{ default: ExpenseSearchFilters }, { default: ExpensesTable }]}
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
										<Button
											variant="outline"
											size="sm"
											onclick={handleExportCsv}
											disabled={isExporting}
										>
											<Download class="mr-2 h-4 w-4" />
											{isExporting ? 'Exporting…' : 'Export CSV'}
										</Button>
									{/if}
								</CardFull.Header>
								<CardFull.Content>
									{#if expensesLoadError && !isLoadingPage}
										<LoadErrorCard
											compact
											title="Couldn't load expenses"
											message={expensesLoadError}
											onRetry={() => fetchExpensesPage(currentOffset)}
										/>
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
											emptyActionHref={addExpenseHref}
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
						{:catch}
							{@render tabLoadError()}
						{/await}
					{/if}
				</TabsContent>

				<TabsContent value="odometer" class="space-y-6">
					{#if visitedTabs['odometer']}
						{#await loadOdometerTab()}
							{@render tabLoading()}
						{:then { default: OdometerTab }}
							<OdometerTab {vehicleId} {canWrite} unitPreferences={vehicle?.unitPreferences} />
						{:catch}
							{@render tabLoadError()}
						{/await}
					{/if}
				</TabsContent>

				<TabsContent value="loan" class="space-y-4 sm:space-y-6">
					{#if visitedTabs['loan']}
						{#await loadFinanceTab()}
							{@render tabLoading()}
						{:then { default: FinanceTab }}
							<FinanceTab {vehicle} {vehicleId} {isOwner} {vehicleStatsData} />
						{:catch}
							{@render tabLoadError()}
						{/await}
					{/if}
				</TabsContent>
			</Tabs>
		{/if}

		{#if hasOpenedUpload}
			{#await loadUploadDialog() then { default: MediaCaptureDialog }}
				<MediaCaptureDialog
					bind:open={showUploadDialog}
					title="Upload Vehicle Photos"
					description="Upload or capture photos of your vehicle (JPEG, PNG, WebP up to 10MB)"
					onUpload={file => vehicleApi.uploadPhoto(vehicleId, file)}
					onUploadComplete={result => handlePhotoUploadComplete(result as Photo)}
					onClose={() => (showUploadDialog = false)}
				/>
			{/await}
		{/if}
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
			<Button onclick={() => goto(resolve(routes.dashboard))}>
				{VEHICLE_MESSAGES.BACK_TO_DASHBOARD}
			</Button>
		{/snippet}
	</EmptyState>
{/if}

{#if vehicle && showAddExpenseAction}
	<FloatingActionButton href={addExpenseHref} label={COMMON_MESSAGES.ADD_EXPENSE} />
{/if}
