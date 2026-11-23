<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { Car, Plus, Check, ListChecks } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { gotoWithQuery } from '#lib/utils/navigation.ts';
	import FloatingActionButton from '#lib/components/common/floating-action-button.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import ChartCard from '#lib/components/charts/ChartCard.svelte';
	import DashboardHero from '#lib/components/dashboard/DashboardHero.svelte';
	import NeedsAttentionCard from '#lib/components/dashboard/NeedsAttentionCard.svelte';
	import VehicleRowsCard from '#lib/components/dashboard/VehicleRowsCard.svelte';
	import RecentActivityCard from '#lib/components/dashboard/RecentActivityCard.svelte';
	import RecurringCostCard from '#lib/components/dashboard/RecurringCostCard.svelte';
	import SharedWithMeCard from '#lib/components/dashboard/SharedWithMeCard.svelte';
	import {
		attentionItems,
		combinePeriodSpend,
		highestMonth,
		periodStartSeconds,
		PERIOD_PHRASES,
		RUNNING_CATEGORIES,
		type VehicleRow
	} from '#lib/components/dashboard/dashboard-data.ts';
	import {
		handleErrorWithNotification,
		logLoadFailure,
		userFacingErrorMessage
	} from '#lib/utils/error-handling.ts';
	import { latest } from '#lib/utils/latest-request.ts';
	import { formatCurrency, formatDate, formatDateWith } from '#lib/utils/formatters.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { IsMobile } from '#lib/hooks/is-mobile.svelte.ts';
	import { costBucketColor } from '#lib/utils/cost-bucket.ts';
	import { buildChartConfig } from '#lib/utils/chart-colors.ts';
	import { formatCurrencyAxis, parseMonthToDate } from '#lib/utils/chart-formatters.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { expenseApi } from '#lib/services/expense-api.ts';
	import { reminderApi } from '#lib/services/reminder-api.ts';
	import { insuranceApi } from '#lib/services/insurance-api.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import { shareApi } from '#lib/services/share-api.ts';
	import type {
		AnalyticsQueryResponse,
		DistanceUnit,
		Expense,
		ExpenseSummary,
		InsurancePolicy,
		ReceivedShare,
		RecurringCostSummary,
		ReminderWithVehicles,
		Vehicle
	} from '#lib/types/index.ts';
	import type { TimePeriod } from '#lib/constants/time-periods.ts';

	const TREND_TITLE = 'Last 12 months';
	const TREND_DESCRIPTION = 'Running costs by month';
	const RECENT_COUNT = 4;
	const TREND_MONTHS = 6;

	const chartModules = import('#lib/components/charts/index.ts');
	chartModules.catch(() => undefined);

	interface PeriodData {
		summaries: ExpenseSummary[];
		perDistance: AnalyticsQueryResponse | null;
	}

	let isLoading = $state(true);
	let isUpdatingPeriod = $state(false);
	let loadError = $state<string | null>(null);
	let period = $state<TimePeriod>('30d');
	let shownPeriod: TimePeriod = '30d';

	let vehicles = $state<Vehicle[]>([]);
	let allTimeSummary = $state<ExpenseSummary | null>(null);
	let periodData = $state<PeriodData>({ summaries: [], perDistance: null });
	let recentExpensesList = $state<Expense[]>([]);
	let remindersList = $state<ReminderWithVehicles[]>([]);
	let policies = $state<InsurancePolicy[]>([]);
	let invitations = $state<ReceivedShare[]>([]);
	let invitationsError = $state<string | null>(null);
	let pendingInvitations = $derived(invitations.filter(share => share.status === 'pending'));
	let recurringCost = $state<RecurringCostSummary>({ count: 0, monthlyTotal: 0 });
	let spendTrend = $state<AnalyticsQueryResponse | null>(null);
	let runningByMonth = $state<AnalyticsQueryResponse | null>(null);
	let trendFailed = $state(false);

	let ownedVehicles = $derived(vehicles.filter(v => !v.sharedAccess));
	let sharedVehicles = $derived(vehicles.filter(v => v.sharedAccess));
	let hasLoaded = $state(false);
	const isNarrow = new IsMobile(1024);
	let showFab = $derived(hasLoaded && !loadError);
	let canLogFillup = $derived(showFab && ownedVehicles.length > 0);
	let noVehicles = $derived(hasLoaded && !loadError && vehicles.length === 0);
	let needsFirstExpense = $derived(
		hasLoaded && !loadError && ownedVehicles.length > 0 && (allTimeSummary?.expenseCount ?? 0) === 0
	);
	let onboardingSteps = $derived([
		{ label: 'Add a vehicle', route: routes.vehicleNew, done: ownedVehicles.length > 0 },
		{ label: 'Log an expense or fill-up', route: routes.expenseNew, done: false },
		{ label: 'See what it costs', route: routes.analytics, done: false }
	]);
	let currentStep = $derived(onboardingSteps.findIndex(step => !step.done));

	let pageDescription = $derived.by(() => {
		if (loadError || (isLoading && !hasLoaded)) return 'Overview of your vehicles';
		if (vehicles.length === 0) return 'Welcome to VROOM';
		const count = `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`;
		return sharedVehicles.length > 0 ? `${count}, incl. ${sharedVehicles.length} shared` : count;
	});

	let spend = $derived(combinePeriodSpend(periodData.summaries));
	let distanceUnit = $derived<DistanceUnit>(settingsStore.unitPreferences.distanceUnit);
	let distanceLabel = $derived(getDistanceUnitLabel(distanceUnit, true));

	let vehicleRows = $derived.by((): VehicleRow[] => {
		const perVehicle = new Map(
			(periodData.perDistance?.series ?? []).map(series => [series.key, series.values[0] ?? null])
		);
		const trends = new Map(
			(spendTrend?.series ?? []).map(series => [series.key, series.values.map(v => v ?? 0)])
		);
		return vehicles.map(v => {
			const model = `${v.year} ${v.make} ${v.model}`;
			const notes = [
				v.nickname ? model : null,
				v.financing?.isActive ? 'Financed' : null,
				v.sharedAccess ? `Shared by ${v.sharedAccess.sharedBy}` : null
			].filter(Boolean);
			return {
				id: v.id,
				name: v.nickname || model,
				detail: notes.join(' · '),
				isElectric: v.vehicleType === 'electric',
				spend: spend.byVehicle.get(v.id) ?? 0,
				runningPerDistance: perVehicle.get(v.id) ?? null,
				trend: trends.get(v.id) ?? null
			};
		});
	});

	let monthlyRunning = $derived(
		(runningByMonth?.buckets ?? []).map((bucket, i) => ({
			date: parseMonthToDate(bucket),
			amount: runningByMonth?.series[0]?.values[i] ?? 0
		}))
	);
	let peakMonth = $derived(highestMonth(monthlyRunning));
	let trendData = $derived(
		monthlyRunning.map(m => ({
			month: formatDateWith(m.date, { month: 'short' }),
			amount: m.amount
		}))
	);
	let trendTicks = $derived(
		trendData.map(m => m.month).filter((_, i) => (trendData.length - 1 - i) % 2 === 0)
	);
	const trendSeries = [{ key: 'amount', label: 'Running costs', color: costBucketColor('energy') }];
	const trendConfig = buildChartConfig(trendSeries);
	let trendInsight = $derived(
		peakMonth
			? `Highest: ${formatDateWith(peakMonth.date, { month: 'long', year: 'numeric' })}, ${formatCurrency(peakMonth.amount)}.`
			: ''
	);

	let recentExpenses = $derived.by(() => {
		const names = new Map(vehicles.map(v => [v.id, getVehicleDisplayName(v)]));
		return recentExpensesList.map(e => ({
			id: e.id,
			amount: e.amount,
			category: e.category,
			date: new Date(e.date),
			description: e.description,
			location: e.location,
			vehicleName: names.get(e.vehicleId) || 'Unknown Vehicle'
		}));
	});

	let attention = $derived.by(() => {
		const names = new Map(vehicles.map(v => [v.id, getVehicleDisplayName(v)]));
		return attentionItems(remindersList, policies, id => names.get(id), formatDate, Date.now());
	});

	onMount(loadDashboardData);

	const nextPeriodRequest = latest();

	function monthsAgoSeconds(months: number): number {
		const now = new Date();
		return Math.floor(new Date(now.getFullYear(), now.getMonth() - months, 1).getTime() / 1000);
	}

	function sharedSummaries(selected: TimePeriod, shared: Vehicle[]): Promise<ExpenseSummary[]> {
		return Promise.all(
			shared.map(v =>
				expenseApi.getExpenseSummary({ vehicleId: v.id, period: selected }).catch(() => null)
			)
		).then(rows => rows.filter((row): row is ExpenseSummary => row !== null));
	}

	async function loadPeriod(selected: TimePeriod, shared: Vehicle[]): Promise<PeriodData> {
		const nowSec = Math.floor(Date.now() / 1000);
		const [owned, perDistance, sharedRows] = await Promise.all([
			expenseApi.getExpenseSummary({ period: selected }),
			analyticsApi
				.query({
					metric: 'costPerDistance',
					interval: 'none',
					groupBy: 'vehicle',
					include: 'all',
					categories: RUNNING_CATEGORIES,
					start: periodStartSeconds(selected, Date.now()),
					end: nowSec
				})
				.catch(() => null),
			sharedSummaries(selected, shared)
		]);
		return { summaries: [owned, ...sharedRows], perDistance };
	}

	async function fetchInvitations(): Promise<{ list: ReceivedShare[]; error: string | null }> {
		try {
			return { list: await shareApi.listReceived(), error: null };
		} catch (error) {
			logLoadFailure(error, "Couldn't load your invitations");
			return { list: [], error: userFacingErrorMessage(error) };
		}
	}

	async function retryInvitations() {
		const result = await fetchInvitations();
		invitations = result.list;
		invitationsError = result.error;
	}

	function dropInvitation(share: ReceivedShare) {
		invitations = invitations.filter(s => s.id !== share.id);
	}

	async function loadDashboardData() {
		isLoading = true;
		isUpdatingPeriod = false;
		loadError = null;
		const isCurrentPeriod = nextPeriodRequest();
		const selected = period;
		try {
			const [
				loadedVehicles,
				allTimeData,
				recentResponse,
				loadedReminders,
				loadedRecurringCost,
				loadedPolicies,
				loadedInvitations,
				ownedPeriod,
				loadedSpendTrend,
				loadedRunningByMonth
			] = await Promise.all([
				vehicleApi.getVehicles({ includeShared: true }),
				expenseApi.getExpenseSummary({ period: 'all' }),
				expenseApi.getAllExpenses({ limit: RECENT_COUNT }),
				reminderApi.list().catch(() => [] as ReminderWithVehicles[]),
				reminderApi.getRecurringCost().catch(() => ({ count: 0, monthlyTotal: 0 })),
				insuranceApi.getAllPolicies().catch(() => [] as InsurancePolicy[]),
				fetchInvitations(),
				loadPeriod(selected, []),
				analyticsApi
					.query({
						metric: 'cost',
						interval: 'month',
						groupBy: 'vehicle',
						include: 'all',
						start: monthsAgoSeconds(TREND_MONTHS - 1)
					})
					.catch(() => null),
				analyticsApi
					.query({
						metric: 'cost',
						interval: 'month',
						groupBy: 'none',
						include: 'all',
						categories: RUNNING_CATEGORIES,
						start: monthsAgoSeconds(11)
					})
					.catch(() => null)
			]);
			const shared = loadedVehicles.filter(v => v.sharedAccess);
			const sharedRows = shared.length > 0 ? await sharedSummaries(selected, shared) : [];
			vehicles = loadedVehicles;
			allTimeSummary = allTimeData;
			if (isCurrentPeriod()) {
				periodData = {
					summaries: [...ownedPeriod.summaries, ...sharedRows],
					perDistance: ownedPeriod.perDistance
				};
				shownPeriod = selected;
			}
			recentExpensesList = recentResponse.data;
			remindersList = loadedReminders;
			recurringCost = loadedRecurringCost;
			policies = loadedPolicies;
			invitations = loadedInvitations.list;
			invitationsError = loadedInvitations.error;
			spendTrend = loadedSpendTrend;
			runningByMonth = loadedRunningByMonth;
			trendFailed = loadedRunningByMonth === null;
			hasLoaded = true;
		} catch (error) {
			loadError = userFacingErrorMessage(error);
			logLoadFailure(error, "Couldn't load the dashboard");
		} finally {
			isLoading = false;
		}
	}

	function handleLogFillup() {
		const query: Record<string, string> = { category: 'fuel', returnTo: routes.dashboard };
		if (ownedVehicles.length === 1) {
			query['vehicleId'] = ownedVehicles[0]!.id;
		}
		gotoWithQuery(resolve(routes.expenseNew), query);
	}

	async function handlePeriodChange(next: TimePeriod) {
		period = next;
		isUpdatingPeriod = true;
		const isCurrent = nextPeriodRequest();
		try {
			const data = await loadPeriod(next, sharedVehicles);
			if (isCurrent()) {
				periodData = data;
				shownPeriod = next;
			}
		} catch (error) {
			if (!isCurrent()) return;
			period = shownPeriod;
			handleErrorWithNotification(error, "Couldn't load the expense summary");
		} finally {
			if (isCurrent()) isUpdatingPeriod = false;
		}
	}
</script>

{#snippet invitationsCard()}
	<SharedWithMeCard
		pending={pendingInvitations}
		loadError={invitationsError}
		onRetry={retryInvitations}
		onAccepted={loadDashboardData}
		onDeclined={dropInvitation}
	/>
{/snippet}

{#snippet heroSection()}
	<DashboardHero
		{period}
		total={spend.total}
		previousTotal={spend.previousTotal}
		buckets={spend.buckets}
		runningPerDistance={periodData.perDistance?.totals.perDistance ?? null}
		runningScope={sharedVehicles.length > 0 ? 'on your vehicles' : null}
		{distanceLabel}
		isLoading={!hasLoaded}
		isUpdating={isUpdatingPeriod}
		onPeriodChange={handlePeriodChange}
	/>
{/snippet}

{#snippet vehiclesSection()}
	<VehicleRowsCard rows={vehicleRows} periodLabel={PERIOD_PHRASES[period].chip} {distanceLabel} />
{/snippet}

{#snippet chartSection()}
	{#await chartModules}
		<ChartCard title={TREND_TITLE} level={2} description={TREND_DESCRIPTION} isLoading>
			{null}
		</ChartCard>
	{:then { AppBarChart }}
		<AppBarChart
			level={2}
			title={TREND_TITLE}
			description={TREND_DESCRIPTION}
			data={trendData}
			x="month"
			y="amount"
			series={trendSeries}
			config={trendConfig}
			yAxisFormat={formatCurrencyAxis}
			xAxisProps={{ ticks: trendTicks, format: (v: string) => v }}
			error={trendFailed ? "Couldn't load the monthly running costs." : null}
		>
			{#snippet footer()}
				{#if trendInsight}
					<p class="text-xs text-muted-foreground" data-testid="trend-insight">
						{trendInsight}
					</p>
				{/if}
			{/snippet}
		</AppBarChart>
	{:catch}
		<ChartCard
			title={TREND_TITLE}
			level={2}
			description={TREND_DESCRIPTION}
			error="Charts couldn't be loaded. Check your connection and reload."
		>
			{null}
		</ChartCard>
	{/await}
{/snippet}

{#snippet attentionSection()}
	{#if attention.length > 0}
		<NeedsAttentionCard items={attention} />
	{/if}
	{#if invitationsError || pendingInvitations.length > 0}
		{@render invitationsCard()}
	{/if}
{/snippet}

{#snippet recentSection()}
	<RecentActivityCard expenses={recentExpenses} />
{/snippet}

{#snippet recurringSection()}
	{#if recurringCost.count > 0}
		<RecurringCostCard count={recurringCost.count} monthlyTotal={recurringCost.monthlyTotal} />
	{/if}
{/snippet}

{#snippet checklist()}
	<EmptyState>
		{#snippet icon()}
			<ListChecks class="mb-4 h-12 w-12 text-muted-foreground" />
		{/snippet}
		{#snippet title()}
			{ownedVehicles.length === 0 ? 'Add your first vehicle' : 'Log your first expense'}
		{/snippet}
		{#snippet description()}
			Three steps to see what your vehicles really cost.
		{/snippet}
		{#snippet action()}
			<ol role="list" class="w-full max-w-sm space-y-3" aria-label="Getting started">
				{#each onboardingSteps as step, i (step.label)}
					<li class="flex items-center gap-3" aria-current={i === currentStep ? 'step' : undefined}>
						<span
							class="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium {step.done
								? 'border-primary bg-primary text-primary-foreground'
								: i === currentStep
									? 'border-primary text-primary'
									: 'border-border text-muted-foreground'}"
							aria-hidden="true"
						>
							{#if step.done}<Check class="size-4" />{:else}{i + 1}{/if}
						</span>
						{#if step.done}
							<span class="text-sm text-muted-foreground line-through">{step.label}</span>
							<span class="sr-only">(done)</span>
						{:else if i === currentStep}
							<span class="text-sm font-medium text-foreground">{step.label}</span>
						{:else}
							<a
								href={resolve(step.route)}
								class="text-sm text-muted-foreground underline-offset-4 hover:underline"
							>
								{step.label}
							</a>
						{/if}
					</li>
				{/each}
			</ol>
			{#if ownedVehicles.length === 0}
				<Button size="lg" class="mt-6" href={resolve(routes.vehicleNew)}>
					<Plus class="mr-2 h-4 w-4" />
					Add Vehicle
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{/snippet}

<svelte:head>
	<title>Dashboard - VROOM Car Tracker</title>
	<meta name="description" content="Your vehicle expense dashboard" />
</svelte:head>

<div class="space-y-6 pb-24 short:pb-0">
	<PageHeader title="Dashboard" description={pageDescription}>
		{#snippet actions()}
			{#if canLogFillup}
				<Button
					variant="outline"
					size="lg"
					class="hidden lg:inline-flex"
					href={resolve(routes.vehicleNew)}
				>
					<Car class="mr-2 h-4 w-4" />
					Add Vehicle
				</Button>
				<Button size="lg" class="hidden lg:inline-flex short:inline-flex" onclick={handleLogFillup}>
					<Plus class="mr-2 h-4 w-4" />
					Log Fill-up
				</Button>
			{:else if showFab && !noVehicles}
				<Button
					size="lg"
					class="hidden lg:inline-flex short:inline-flex"
					href={resolve(routes.vehicleNew)}
				>
					<Plus class="mr-2 h-4 w-4" />
					Add Vehicle
				</Button>
			{:else if isLoading && !hasLoaded}
				<Skeleton class="hidden h-10 lg:block lg:w-36" />
			{/if}
		{/snippet}
	</PageHeader>

	{#if loadError && !isLoading}
		<LoadErrorCard
			title="Couldn't load the dashboard"
			message={loadError}
			onRetry={loadDashboardData}
		/>
	{:else if noVehicles}
		{@render checklist()}

		{@render invitationsCard()}
	{:else if needsFirstExpense}
		{@render checklist()}

		{@render invitationsCard()}
		<NeedsAttentionCard items={attention} />
		<VehicleRowsCard rows={vehicleRows} periodLabel={PERIOD_PHRASES[period].chip} {distanceLabel} />
		{#if recurringCost.count > 0}
			<RecurringCostCard count={recurringCost.count} monthlyTotal={recurringCost.monthlyTotal} />
		{/if}
	{:else}
		{#if isNarrow.current}
			<div class="space-y-6">
				{@render heroSection()}
				{#if hasLoaded}
					{@render attentionSection()}
					{@render vehiclesSection()}
					{@render recentSection()}
					{@render chartSection()}
					{@render recurringSection()}
				{/if}
			</div>
		{:else}
			<div class="grid grid-cols-3 items-start gap-6">
				<div class="col-span-2 space-y-6">
					{@render heroSection()}
					{#if hasLoaded}
						{@render vehiclesSection()}
						{@render chartSection()}
					{/if}
				</div>
				{#if hasLoaded}
					<div class="space-y-6">
						{@render attentionSection()}
						{@render recentSection()}
						{@render recurringSection()}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

{#if canLogFillup}
	<FloatingActionButton label="Log Fill-up" onclick={handleLogFillup} />
{:else if showFab && !noVehicles}
	<FloatingActionButton href={resolve(routes.vehicleNew)} label="Add Vehicle" />
{/if}
