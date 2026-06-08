<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
	import { TrendingUp, ChartPie, CircleAlert, Fuel } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { gotoWithQuery } from '$lib/utils/navigation';
	import FloatingActionButton from '$lib/components/common/floating-action-button.svelte';
	import PageHeader from '$lib/components/common/page-header.svelte';
	import DashboardStatsCards from '$lib/components/dashboard/DashboardStatsCards.svelte';
	import ExpenseTrendChart from '$lib/components/charts/ExpenseTrendChart.svelte';
	import { AppPieChart } from '$lib/components/charts';
	import RecentActivityCard from '$lib/components/dashboard/RecentActivityCard.svelte';
	import DueRemindersCard from '$lib/components/dashboard/DueRemindersCard.svelte';
	import VehicleCarousel from '$lib/components/dashboard/VehicleCarousel.svelte';
	import PeriodSelector from '$lib/components/common/period-selector.svelte';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import { getCategoryColor as getCategoryChartColor } from '$lib/utils/chart-colors';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { parseMonthToDate } from '$lib/utils/chart-formatters';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi } from '$lib/services/expense-api';
	import { reminderApi } from '$lib/services/reminder-api';
	import type {
		Vehicle,
		Expense,
		ExpenseCategory,
		ExpenseSummary,
		Photo,
		ReminderWithVehicles
	} from '$lib/types';
	import type { TimePeriod } from '$lib/constants/time-periods';

	// Reminders due now or within the next 2 weeks surface on the dashboard.
	const UPCOMING_WINDOW_DAYS = 14;

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let selectedPeriod = $state<TimePeriod>('all');

	// Raw data
	let vehicles = $state<Vehicle[]>([]);
	let allTimeSummary = $state<ExpenseSummary | null>(null);
	let periodSummary = $state<ExpenseSummary | null>(null);
	let recentExpensesList = $state<Expense[]>([]);
	let remindersList = $state<ReminderWithVehicles[]>([]);
	let vehiclePhotosMap = $state<Map<string, Photo[]>>(new Map());
	let vehicleStatsMap = $state<
		Map<string, { totalAmount: number; recentAmount: number; lastActivity: Date | null }>
	>(new Map());

	// Derived: vehicle overview cards with per-vehicle expense stats
	let vehicleOverviews = $derived.by(() => {
		return vehicles.map(v => {
			const photos = vehiclePhotosMap.get(v.id) || [];
			const coverPhoto = photos.find(p => p.isCover);
			const coverPhotoUrl = coverPhoto
				? vehicleApi.getPhotoThumbnailUrl(v.id, coverPhoto.id)
				: null;
			const vStats = vehicleStatsMap.get(v.id);

			return {
				id: v.id,
				name: `${v.year} ${v.make} ${v.model}`,
				nickname: v.nickname,
				recentExpenses: vStats?.recentAmount ?? 0,
				totalExpenses: vStats?.totalAmount ?? 0,
				lastActivity: vStats?.lastActivity ?? null,
				hasActiveFinancing: v.financing?.isActive || false,
				coverPhotoUrl
			};
		});
	});

	// Derived: stats for cards — always uses all-time data, unaffected by period selector
	let stats = $derived.by(() => ({
		totalVehicles: vehicles.length,
		totalExpenses: allTimeSummary?.totalAmount ?? 0,
		monthlyAverage: allTimeSummary?.monthlyAverage ?? 0,
		activeFinancing: vehicles.filter(v => v.financing?.isActive).length
	}));

	// Derived: monthly trend chart data from period-filtered summary
	let trendChartData = $derived.by(() => {
		if (!periodSummary?.monthlyTrend) return [];
		return periodSummary.monthlyTrend.map(t => ({
			// Local-time parse: `new Date('YYYY-MM-01')` is midnight UTC and shifts the
			// month label back one for negative-offset users (cycle 211).
			date: parseMonthToDate(t.period),
			amount: t.amount
		}));
	});

	// Derived: category breakdown chart data from period-filtered summary
	let categoryChartData = $derived.by(() => {
		if (!periodSummary?.categoryBreakdown) return [];
		const total = periodSummary.categoryBreakdown.reduce((sum, c) => sum + c.amount, 0);
		return periodSummary.categoryBreakdown.map(c => ({
			key: c.category,
			label: categoryLabels[c.category as ExpenseCategory] || c.category,
			value: c.amount,
			percentage: total > 0 ? (c.amount / total) * 100 : 0,
			color: getCategoryChartColor(c.category)
		}));
	});

	// Derived: recent activity with vehicle names
	let recentExpenses = $derived.by(() => {
		const vehicleMap = new Map(
			vehicles.map(v => [v.id, v.nickname || `${v.year} ${v.make} ${v.model}`])
		);
		return recentExpensesList.map(e => ({
			id: e.id,
			amount: e.amount,
			category: e.category,
			date: new Date(e.date),
			description: e.description,
			vehicleName: vehicleMap.get(e.vehicleId) || 'Unknown Vehicle'
		}));
	});

	// Derived: active reminders due now or within the next UPCOMING_WINDOW_DAYS,
	// soonest first. "Due now" (overdue) matches the /reminders isDue rule exactly
	// (nextDueDate <= now) so the two views never disagree.
	let dueReminders = $derived.by(() => {
		const now = Date.now();
		const horizon = now + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
		const vehicleMap = new Map(vehicles.map(v => [v.id, getVehicleDisplayName(v)]));
		return remindersList
			.filter(r => r.reminder.isActive)
			// This is the TIME-axis "due soon" widget. A pure-mileage reminder has a null nextDueDate
			// (its due-ness is odometer-based, surfaced on the /reminders page) — exclude it here, and
			// the narrowing lets the date math below treat nextDueDate as a string.
			.filter(
				(r): r is typeof r & { reminder: { nextDueDate: string } } =>
					r.reminder.nextDueDate !== null
			)
			.filter(r => new Date(r.reminder.nextDueDate).getTime() <= horizon)
			.sort(
				(a, b) =>
					new Date(a.reminder.nextDueDate).getTime() - new Date(b.reminder.nextDueDate).getTime()
			)
			.map(r => ({
				id: r.reminder.id,
				name: r.reminder.name,
				nextDueDate: r.reminder.nextDueDate,
				isOverdue: new Date(r.reminder.nextDueDate).getTime() <= now,
				expenseAmount: r.reminder.expenseAmount,
				vehicleNames: r.vehicleIds
					.map(id => vehicleMap.get(id))
					.filter(Boolean)
					.join(', ')
			}));
	});

	onMount(loadDashboardData);

	async function loadDashboardData() {
		isLoading = true;
		loadError = null;
		try {
			const [loadedVehicles, allTimeData, periodData, recentResponse, loadedReminders] =
				await Promise.all([
					vehicleApi.getVehicles(),
					expenseApi.getExpenseSummary({ period: 'all' }),
					selectedPeriod !== 'all'
						? expenseApi.getExpenseSummary({ period: selectedPeriod })
						: Promise.resolve(null),
					expenseApi.getAllExpenses({ limit: 5 }),
					// Reminders are a secondary widget — a failure here must not blank the
					// whole dashboard, so degrade to an empty list rather than rejecting.
					reminderApi.list().catch(() => [] as ReminderWithVehicles[])
				]);
			vehicles = loadedVehicles;
			allTimeSummary = allTimeData;
			periodSummary = periodData ?? allTimeData;
			recentExpensesList = recentResponse.data;
			remindersList = loadedReminders;

			// Load photos and per-vehicle stats in parallel. Photos come back in ONE
			// request grouped by vehicleId (batch endpoint), not one call per vehicle.
			const [photosByVehicle, vehicleStats] = await Promise.all([
				vehicleApi.getAllVehiclePhotos().catch(() => ({}) as Record<string, Photo[]>),
				expenseApi.getVehicleStats()
			]);

			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map created and consumed within async function, not reactive state
			const photosMap = new Map<string, Photo[]>();
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map created and consumed within async function, not reactive state
			const statsMap = new Map<
				string,
				{ totalAmount: number; recentAmount: number; lastActivity: Date | null }
			>();
			for (const v of loadedVehicles) {
				const vehiclePhotos = photosByVehicle[v.id];
				if (vehiclePhotos) {
					photosMap.set(v.id, vehiclePhotos);
				}
			}
			for (const vs of vehicleStats) {
				statsMap.set(vs.vehicleId, {
					totalAmount: vs.totalAmount,
					recentAmount: vs.recentAmount,
					lastActivity: vs.lastExpenseDate ? new Date(vs.lastExpenseDate) : null
				});
			}
			vehiclePhotosMap = photosMap;
			vehicleStatsMap = statsMap;
		} catch (error) {
			// Persist the error so the page can show a retry affordance instead of
			// silently rendering the empty "add your first vehicle" state — which a
			// returning user would misread as their data having vanished.
			loadError = error instanceof Error ? error.message : 'Failed to load dashboard data';
			handleErrorWithNotification(error, 'Failed to load dashboard data');
		} finally {
			isLoading = false;
		}
	}

	// Quick-add a fill-up: deep-link to the expense form pre-set to the fuel
	// category, returning to the dashboard on save. When the user owns exactly one
	// vehicle, preselect it so the flow is genuinely two taps; with several, the
	// form's own vehicle picker (defaults to the first) handles the choice.
	function handleLogFillup() {
		const query: Record<string, string> = { category: 'fuel', returnTo: routes.dashboard };
		if (vehicles.length === 1) {
			query['vehicleId'] = vehicles[0]!.id;
		}
		gotoWithQuery(resolve(routes.expenseNew), query);
	}

	async function handlePeriodChange(period: TimePeriod) {
		selectedPeriod = period;
		try {
			if (period === 'all' && allTimeSummary) {
				periodSummary = allTimeSummary;
			} else {
				periodSummary = await expenseApi.getExpenseSummary({ period });
			}
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load expense summary');
		}
	}
</script>

<svelte:head>
	<title>Dashboard - VROOM Car Tracker</title>
	<meta name="description" content="Your vehicle expense dashboard" />
</svelte:head>

<div class="space-y-6 pb-24">
	<!-- Header -->
	<PageHeader
		title="Dashboard"
		description={loadError
			? 'Overview of your vehicles'
			: stats.totalVehicles > 0
				? `Overview of your ${stats.totalVehicles} vehicle${stats.totalVehicles !== 1 ? 's' : ''}`
				: 'Welcome! Get started by adding your first vehicle'}
	>
		{#snippet actions()}
			<!-- Quick-add the most common action. Only meaningful once a vehicle
			     exists; hidden in the error/empty states. Visible on mobile too —
			     the FAB is "Add Vehicle", so this is the only fast path to a fill-up. -->
			{#if !loadError && stats.totalVehicles > 0}
				<Button onclick={handleLogFillup}>
					<Fuel class="mr-2 h-4 w-4" />
					Log Fill-up
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if loadError && !isLoading}
		<!-- Error state: a load failure must NOT silently fall through to the empty
		     "add your first vehicle" view (a returning user would think their data
		     vanished). Mirror the analytics route's error+retry idiom. -->
		<div class="rounded-lg border bg-card p-6">
			<div class="mb-4 flex items-center gap-3 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Failed to load dashboard data</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
			<Button onclick={loadDashboardData}>Retry</Button>
		</div>
	{:else}
		<!-- Stats Cards -->
		<DashboardStatsCards
			totalVehicles={stats.totalVehicles}
			totalExpenses={stats.totalExpenses}
			monthlyAverage={stats.monthlyAverage}
			activeFinancing={stats.activeFinancing}
			{isLoading}
		/>

		<!-- Vehicle Carousel -->
		{#if stats.totalVehicles > 0}
			<VehicleCarousel vehicles={vehicleOverviews} {isLoading} />
		{/if}

		<!-- Period Selector -->
		{#if stats.totalVehicles > 0}
			<PeriodSelector {selectedPeriod} {isLoading} onPeriodChange={handlePeriodChange} />
		{/if}

		<!-- Charts Row -->
		{#if stats.totalVehicles > 0}
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<ExpenseTrendChart data={trendChartData} title="Monthly Expense Trends" {isLoading}>
					{#snippet icon()}
						<TrendingUp class="h-5 w-5 text-primary" />
					{/snippet}
				</ExpenseTrendChart>
				<AppPieChart
					title="Expense by Category"
					description="Distribution across all vehicles"
					data={categoryChartData}
					{isLoading}
				>
					{#snippet icon()}
						<ChartPie class="h-5 w-5 text-chart-1" />
					{/snippet}
				</AppPieChart>
			</div>

			<!-- Recent Activity + Upcoming Reminders -->
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<RecentActivityCard expenses={recentExpenses} {isLoading} />
				<DueRemindersCard reminders={dueReminders} {isLoading} />
			</div>
		{/if}
	{/if}
</div>

<FloatingActionButton href={resolve(routes.vehicleNew)} label="Add Vehicle" />
