<script lang="ts">
	import { onMount } from 'svelte';
	import { TrendingUp, ChartPie } from 'lucide-svelte';
	import FloatingActionButton from '$lib/components/common/floating-action-button.svelte';
	import PageHeader from '$lib/components/common/page-header.svelte';
	import DashboardStatsCards from '$lib/components/dashboard/DashboardStatsCards.svelte';
	import ExpenseTrendChart from '$lib/components/charts/ExpenseTrendChart.svelte';
	import { AppPieChart } from '$lib/components/charts';
	import RecentActivityCard from '$lib/components/dashboard/RecentActivityCard.svelte';
	import VehicleCarousel from '$lib/components/dashboard/VehicleCarousel.svelte';
	import PeriodSelector from '$lib/components/vehicles/PeriodSelector.svelte';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import { getCategoryColor as getCategoryChartColor } from '$lib/utils/chart-colors';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi } from '$lib/services/expense-api';
	import type { Vehicle, Expense, ExpenseCategory, ExpenseSummary, Photo } from '$lib/types';
	import type { TimePeriod } from '$lib/constants/time-periods';

	let isLoading = $state(true);
	let selectedPeriod = $state<TimePeriod>('all');

	// Raw data
	let vehicles = $state<Vehicle[]>([]);
	let allTimeSummary = $state<ExpenseSummary | null>(null);
	let periodSummary = $state<ExpenseSummary | null>(null);
	let recentExpensesList = $state<Expense[]>([]);
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
			date: new Date(`${t.period}-01`),
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

	onMount(async () => {
		await loadDashboardData();
		isLoading = false;
	});

	async function loadDashboardData() {
		try {
			const [loadedVehicles, allTimeData, periodData, recentResponse] = await Promise.all([
				vehicleApi.getVehicles(),
				expenseApi.getExpenseSummary({ period: 'all' }),
				selectedPeriod !== 'all'
					? expenseApi.getExpenseSummary({ period: selectedPeriod })
					: Promise.resolve(null),
				expenseApi.getAllExpenses({ limit: 5 })
			]);
			vehicles = loadedVehicles;
			allTimeSummary = allTimeData;
			periodSummary = periodData ?? allTimeData;
			recentExpensesList = recentResponse.data;

			// Load photos and per-vehicle stats in parallel (single query for all vehicles)
			const [photoResults, vehicleStats] = await Promise.all([
				Promise.allSettled(loadedVehicles.map(v => vehicleApi.getPhotos(v.id))),
				expenseApi.getVehicleStats()
			]);

			const photosMap = new Map<string, Photo[]>();
			const statsMap = new Map<
				string,
				{ totalAmount: number; recentAmount: number; lastActivity: Date | null }
			>();
			loadedVehicles.forEach((v, i) => {
				const photoResult = photoResults[i];
				if (photoResult && photoResult.status === 'fulfilled') {
					photosMap.set(v.id, photoResult.value);
				}
			});
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
			handleErrorWithNotification(error, 'Failed to load dashboard data');
		}
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
		description={stats.totalVehicles > 0
			? `Overview of your ${stats.totalVehicles} vehicle${stats.totalVehicles !== 1 ? 's' : ''}`
			: 'Welcome! Get started by adding your first vehicle'}
	/>

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

		<!-- Recent Activity -->
		<RecentActivityCard expenses={recentExpenses} {isLoading} />
	{/if}
</div>

<FloatingActionButton href="/vehicles/new" label="Add Vehicle" />
