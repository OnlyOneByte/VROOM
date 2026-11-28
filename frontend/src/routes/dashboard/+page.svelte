<script lang="ts">
	import { usePendingRows } from '#lib/utils/sync/pending-rows.svelte.ts';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { Plus, Check, ListChecks } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { gotoWithQuery } from '#lib/utils/navigation.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import ChartCard from '#lib/components/charts/ChartCard.svelte';
	import DashboardHero from '#lib/components/dashboard/DashboardHero.svelte';
	import NeedsAttentionCard from '#lib/components/dashboard/NeedsAttentionCard.svelte';
	import VehicleRowsCard from '#lib/components/dashboard/VehicleRowsCard.svelte';
	import RecentActivityCard from '#lib/components/dashboard/RecentActivityCard.svelte';
	import RecurringCostCard from '#lib/components/dashboard/RecurringCostCard.svelte';
	import SharedWithMeCard from '#lib/components/dashboard/SharedWithMeCard.svelte';
	import {
		loadPeriodSpend,
		sharedSummaries,
		type PeriodData
	} from '#lib/components/dashboard/period-spend.ts';
	import {
		attentionItems,
		combinePeriodSpend,
		highestMonth,
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
	import { vehicleKindNote } from '#lib/utils/vehicle-kind.ts';
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

	const TREND_TITLE = 'Running cost by month';
	const TREND_DESCRIPTION = 'Last 12 months';
	const RECENT_COUNT = 4;

	const chartModules = import('#lib/components/charts/index.ts');
	chartModules.catch(() => undefined);

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
	let runningByMonth = $state<AnalyticsQueryResponse | null>(null);
	let trendFailed = $state(false);

	let ownedVehicles = $derived(vehicles.filter(v => !v.sharedAccess));
	let sharedVehicles = $derived(vehicles.filter(v => v.sharedAccess));
	let hasLoaded = $state(false);
	const isNarrow = new IsMobile(1024);
	let showActions = $derived(hasLoaded && !loadError);
	let canLogFillup = $derived(showActions && ownedVehicles.length > 0);
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

	let spend = $derived(combinePeriodSpend(periodData.summaries));
	let distanceUnit = $derived<DistanceUnit>(settingsStore.unitPreferences.distanceUnit);
	let distanceLabel = $derived(getDistanceUnitLabel(distanceUnit, true));

	let vehicleRows = $derived.by((): VehicleRow[] => {
		const perVehicle = new Map(
			(periodData.perDistance?.series ?? []).map(series => [series.key, series.values[0] ?? null])
		);
		return vehicles.map(v => {
			const model = `${v.year} ${v.make} ${v.model}`;
			const notes = [
				vehicleKindNote(v.vehicleKind),
				v.nickname ? model : null,
				v.vehicleType === 'electric' ? 'Electric' : v.vehicleType === 'hybrid' ? 'Hybrid' : null,
				v.financing?.isActive ? 'Financed' : null,
				v.sharedAccess ? `Shared by ${v.sharedAccess.sharedBy}` : null
			].filter(Boolean);
			return {
				id: v.id,
				name: v.nickname || model,
				detail: notes.join(' · '),
				spend: spend.byVehicle.get(v.id) ?? 0,
				runningPerDistance: perVehicle.get(v.id) ?? null
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

	const pending = usePendingRows({
		match: () => true,
		refresh: () =>
			expenseApi.getAllExpenses({ limit: RECENT_COUNT }).then(
				response => {
					recentExpensesList = response.data;
				},
				error => logLoadFailure(error, "Couldn't refresh recent expenses")
			),
		listedIds: () => listedExpenseIds
	});
	let listedExpenseIds = $derived(new Set(recentExpensesList.map(expense => expense.id)));

	let recentExpenses = $derived.by(() => {
		const names = new Map(vehicles.map(v => [v.id, getVehicleDisplayName(v)]));
		return [...pending.rows, ...recentExpensesList].slice(0, 4).map(e => {
			const sync = pending.states.get(e.id);
			return {
				id: e.id,
				amount: e.amount,
				category: e.category,
				date: new Date(e.date),
				description: e.description,
				location: e.location,
				vehicleName: names.get(e.vehicleId) || 'Unknown vehicle',
				...(sync && { syncNote: sync.status === 'failed' ? 'Not saved' : 'Unsynced' })
			};
		});
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
				loadedRunningByMonth
			] = await Promise.all([
				vehicleApi.getVehicles({ includeShared: true }),
				expenseApi.getExpenseSummary({ period: 'all' }),
				expenseApi.getAllExpenses({ limit: RECENT_COUNT }),
				reminderApi.list().catch(() => [] as ReminderWithVehicles[]),
				reminderApi.getRecurringCost().catch(() => ({ count: 0, monthlyTotal: 0 })),
				insuranceApi.getAllPolicies().catch(() => [] as InsurancePolicy[]),
				fetchInvitations(),
				loadPeriodSpend(selected, []),
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
			const data = await loadPeriodSpend(next, sharedVehicles);
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
	>
		{#snippet actions()}
			{@render primaryAction()}
		{/snippet}
	</DashboardHero>
{/snippet}

{#snippet primaryAction()}
	{#if canLogFillup}
		<Button size="lg" variant="outline" onclick={handleLogFillup}>
			<Plus class="mr-2 h-4 w-4" />
			Log fill-up
		</Button>
	{:else if showActions && !noVehicles}
		<Button size="lg" variant="outline" href={resolve(routes.vehicleNew)}>
			<Plus class="mr-2 h-4 w-4" />
			Add vehicle
		</Button>
	{:else if isLoading && !hasLoaded}
		<Skeleton class="h-10 w-36" data-testid="primary-action-placeholder" />
	{/if}
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
		<NeedsAttentionCard items={attention} showAll />
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
									: 'border-border-strong text-muted-foreground'}"
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
					Add vehicle
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{/snippet}

<svelte:head>
	<title>Dashboard - VROOM Car Tracker</title>
	<meta name="description" content="Your vehicle expense dashboard" />
</svelte:head>

<div class="mx-auto max-w-6xl space-y-10">
	<div class="sr-only"><PageHeader title="Dashboard" /></div>

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
		<div class="flex justify-end">{@render primaryAction()}</div>
		{@render checklist()}

		{@render invitationsCard()}
		<NeedsAttentionCard items={attention} showAll />
		<VehicleRowsCard rows={vehicleRows} periodLabel={PERIOD_PHRASES[period].chip} {distanceLabel} />
		{#if recurringCost.count > 0}
			<RecurringCostCard count={recurringCost.count} monthlyTotal={recurringCost.monthlyTotal} />
		{/if}
	{:else}
		{#if isNarrow.current}
			<div class="space-y-10">
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
			{@render heroSection()}
			{#if hasLoaded}
				<div class="grid grid-cols-2 items-start gap-x-12 gap-y-10">
					<div class="space-y-10">
						{@render attentionSection()}
						{@render vehiclesSection()}
					</div>
					<div class="space-y-10">
						{@render chartSection()}
						{@render recentSection()}
						{@render recurringSection()}
					</div>
				</div>
			{/if}
		{/if}
	{/if}
</div>
