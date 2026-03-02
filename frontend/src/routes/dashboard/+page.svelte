<script lang="ts">
	import { onMount } from 'svelte';
	import { Plus } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import DashboardStatsCards from '$lib/components/dashboard/DashboardStatsCards.svelte';
	import MonthlyTrendChart from '$lib/components/dashboard/MonthlyTrendChart.svelte';
	import CategoryBreakdownChart from '$lib/components/dashboard/CategoryBreakdownChart.svelte';
	import RecentActivityCard from '$lib/components/dashboard/RecentActivityCard.svelte';
	import VehicleCarousel from '$lib/components/dashboard/VehicleCarousel.svelte';
	import PeriodSelector from '$lib/components/vehicles/PeriodSelector.svelte';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi } from '$lib/services/expense-api';
	import type { Vehicle, Expense, ExpenseCategory, Photo } from '$lib/types';
	import type { TimePeriod } from '$lib/constants/time-periods';

	let isLoading = $state(true);
	let selectedPeriod = $state<TimePeriod>('all');

	// Raw data — fetched once
	let vehicles = $state<Vehicle[]>([]);
	let allExpenses = $state<Expense[]>([]);
	let vehiclePhotosMap = $state<Map<string, Photo[]>>(new Map());

	// Derived: vehicle overview cards
	let vehicleOverviews = $derived.by(() => {
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		return vehicles.map(v => {
			const vExpenses = allExpenses.filter(e => e.vehicleId === v.id);
			const recentExpenses = vExpenses
				.filter(e => new Date(e.date) > thirtyDaysAgo)
				.reduce((sum, e) => sum + e.amount, 0);
			const totalExpenses = vExpenses.reduce((sum, e) => sum + e.amount, 0);
			const lastActivity =
				vExpenses.length > 0
					? new Date(Math.max(...vExpenses.map(e => new Date(e.date).getTime())))
					: null;

			const photos = vehiclePhotosMap.get(v.id) || [];
			const coverPhoto = photos.find(p => p.isCover);
			const coverPhotoUrl = coverPhoto
				? vehicleApi.getPhotoThumbnailUrl(v.id, coverPhoto.id)
				: null;

			return {
				id: v.id,
				name: `${v.year} ${v.make} ${v.model}`,
				nickname: v.nickname,
				recentExpenses,
				totalExpenses,
				lastActivity,
				hasActiveFinancing: v.financing?.isActive || false,
				coverPhotoUrl
			};
		});
	});

	// Derived: filtered expenses based on selected period
	let filteredExpenses = $derived.by(() => {
		if (selectedPeriod === 'all') return allExpenses;
		const startDate = new Date();
		switch (selectedPeriod) {
			case '7d':
				startDate.setDate(startDate.getDate() - 7);
				break;
			case '30d':
				startDate.setDate(startDate.getDate() - 30);
				break;
			case '90d':
				startDate.setDate(startDate.getDate() - 90);
				break;
			case '1y':
				startDate.setFullYear(startDate.getFullYear() - 1);
				break;
		}
		return allExpenses.filter(e => new Date(e.date) >= startDate);
	});

	// Derived: stats cards
	let stats = $derived.by(() => {
		const totalVehicles = vehicles.length;
		const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
		const activeFinancing = vehicles.filter(v => v.financing?.isActive).length;

		// Monthly average from unique months in filtered data
		const months = new Set(
			filteredExpenses.map(e => {
				const d = new Date(e.date);
				return `${d.getFullYear()}-${d.getMonth()}`;
			})
		);
		const monthlyAverage = months.size > 0 ? totalExpenses / months.size : 0;

		return { totalVehicles, totalExpenses, monthlyAverage, activeFinancing };
	});

	// Derived: monthly trend chart data
	let trendChartData = $derived.by(() => {
		const monthlyMap = new Map<string, number>();
		for (const e of filteredExpenses) {
			const d = new Date(e.date);
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			monthlyMap.set(key, (monthlyMap.get(key) || 0) + e.amount);
		}
		return Array.from(monthlyMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([period, amount]) => ({ date: new Date(`${period}-01`), amount }));
	});

	// Derived: category breakdown chart data
	let categoryChartData = $derived.by(() => {
		const colors: Record<string, string> = {
			fuel: 'hsl(var(--chart-1))',
			maintenance: 'hsl(var(--chart-5))',
			financial: 'hsl(var(--chart-2))',
			regulatory: 'hsl(var(--chart-4))',
			enhancement: 'hsl(var(--chart-3))',
			misc: 'hsl(var(--muted-foreground))'
		};

		const categoryMap = new Map<string, number>();
		let total = 0;
		for (const e of filteredExpenses) {
			total += e.amount;
			categoryMap.set(e.category, (categoryMap.get(e.category) || 0) + e.amount);
		}

		return Array.from(categoryMap.entries()).map(([category, amount]) => ({
			category,
			name: categoryLabels[category as ExpenseCategory] || category,
			amount,
			percentage: total > 0 ? (amount / total) * 100 : 0,
			color: (colors[category] ?? colors['misc']) as string
		}));
	});

	// Derived: recent activity
	let recentExpenses = $derived.by(() => {
		const vehicleMap = new Map(
			vehicles.map(v => [v.id, v.nickname || `${v.year} ${v.make} ${v.model}`])
		);
		return [...allExpenses]
			.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
			.slice(0, 5)
			.map(e => ({
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
			const [loadedVehicles, loadedExpenses] = await Promise.all([
				vehicleApi.getVehicles(),
				expenseApi.getAllExpenses()
			]);
			vehicles = loadedVehicles;
			allExpenses = loadedExpenses;

			// Load photos for all vehicles in parallel
			const photoResults = await Promise.allSettled(
				loadedVehicles.map(v => vehicleApi.getPhotos(v.id))
			);
			const photosMap = new Map<string, Photo[]>();
			loadedVehicles.forEach((v, i) => {
				const result = photoResults[i];
				if (result && result.status === 'fulfilled') {
					photosMap.set(v.id, result.value);
				}
			});
			vehiclePhotosMap = photosMap;
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load dashboard data');
		}
	}

	function handlePeriodChange(period: TimePeriod) {
		selectedPeriod = period;
	}
</script>

<svelte:head>
	<title>Dashboard - VROOM Car Tracker</title>
	<meta name="description" content="Your vehicle expense dashboard" />
</svelte:head>

<div class="space-y-6 pb-24 sm:pb-0">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Dashboard</h1>
			<p class="text-muted-foreground mt-1">
				{#if stats.totalVehicles > 0}
					Overview of your {stats.totalVehicles} vehicle{stats.totalVehicles !== 1 ? 's' : ''}
				{:else}
					Welcome! Get started by adding your first vehicle
				{/if}
			</p>
		</div>
	</div>

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
			<MonthlyTrendChart data={trendChartData} {isLoading} />
			<CategoryBreakdownChart data={categoryChartData} {isLoading} />
		</div>

		<!-- Recent Activity -->
		<RecentActivityCard expenses={recentExpenses} {isLoading} />
	{/if}
</div>

<Button
	href="/vehicles/new"
	class="fixed bottom-4 left-4 right-4 z-50 h-16 rounded-full sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto flex items-center justify-center gap-2 pl-6 pr-10 bg-foreground hover:bg-foreground/90 text-background shadow-2xl transition-all duration-300 sm:hover:scale-110 border-0 group"
	aria-label="Add vehicle"
>
	<Plus class="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" />
	<span class="font-bold text-lg">Add Vehicle</span>
</Button>
