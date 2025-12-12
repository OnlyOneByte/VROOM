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
	import type { ExpenseCategory } from '$lib/types';
	import type { TimePeriod } from '$lib/constants/time-periods';

	let isLoading = $state(true);
	let selectedPeriod = $state<TimePeriod>('all');

	let dashboardData = $state<any>(null);
	let vehicleDetails = $state<any[]>([]);
	let recentExpenses = $state<any[]>([]);

	let stats = $derived.by(() => {
		if (!dashboardData) {
			return { totalVehicles: 0, totalExpenses: 0, monthlyAverage: 0, activeFinancing: 0 };
		}
		const monthlyAverage =
			dashboardData.monthlyTrends.length > 0
				? dashboardData.monthlyTrends.reduce((sum: number, t: any) => sum + t.amount, 0) /
					dashboardData.monthlyTrends.length
				: 0;
		return {
			totalVehicles: dashboardData.vehicles.length,
			totalExpenses: dashboardData.totalExpenses,
			monthlyAverage,
			activeFinancing: vehicleDetails.filter(v => v.hasActiveFinancing).length
		};
	});

	let trendChartData = $derived(
		dashboardData?.monthlyTrends.map((t: any) => ({
			date: new Date(t.period),
			amount: t.amount
		})) || []
	);

	let categoryChartData = $derived.by(() => {
		if (!dashboardData?.categoryBreakdown) return [];
		const colors: Record<string, string> = {
			fuel: 'hsl(217, 91%, 60%)',
			maintenance: 'hsl(25, 95%, 53%)',
			insurance: 'hsl(262, 83%, 58%)',
			registration: 'hsl(142, 71%, 45%)',
			parking: 'hsl(48, 96%, 53%)',
			tolls: 'hsl(330, 81%, 60%)',
			cleaning: 'hsl(189, 94%, 43%)',
			other: 'hsl(215, 16%, 47%)'
		};
		return Object.entries(dashboardData.categoryBreakdown).map(
			([category, data]: [string, any]) => ({
				category,
				name: categoryLabels[category as ExpenseCategory] || category,
				amount: data.amount,
				percentage: data.percentage,
				color: (colors[category] ?? colors['other']) as string
			})
		);
	});

	onMount(async () => {
		await loadDashboardData();
		isLoading = false;
	});

	$effect(() => {
		if (!isLoading && selectedPeriod) {
			loadDashboardData();
		}
	});

	async function loadDashboardData() {
		try {
			const params = new URLSearchParams();
			params.append('groupBy', 'month');
			if (selectedPeriod !== 'all') {
				const endDate = new Date();
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
				params.append('startDate', startDate.toISOString());
				params.append('endDate', endDate.toISOString());
			}
			// NOTE: Analytics endpoint removed - using mock data for now
			// TODO: Implement client-side analytics or restore backend endpoint
			dashboardData = {
				vehicles: [],
				totalExpenses: 0,
				monthlyTrends: [],
				categoryBreakdown: {},
				fuelEfficiency: {
					averageMPG: 0,
					totalVolume: 0,
					totalFuelCost: 0,
					averageCostPerGallon: 0
				},
				costPerMile: { totalCostPerMile: 0, totalCost: 0, totalMiles: 0 }
			};
			await Promise.all([loadVehicleDetails(), loadRecentExpenses()]);
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to load dashboard data');
		}
	}

	async function loadVehicleDetails() {
		try {
			const response = await fetch('/api/v1/vehicles', { credentials: 'include' });
			if (!response.ok) return;
			const result = await response.json();
			const vehicles = result.data || [];
			const vehicleDetailsPromises = vehicles.map(async (vehicle: any) => {
				try {
					const expensesResponse = await fetch(`/api/v1/expenses?vehicleId=${vehicle.id}`, {
						credentials: 'include'
					});
					if (!expensesResponse.ok) {
						return {
							id: vehicle.id,
							name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
							nickname: vehicle.nickname,
							recentExpenses: 0,
							totalExpenses: 0,
							lastActivity: null,
							hasActiveFinancing: vehicle.financing?.isActive || false
						};
					}
					const expensesResult = await expensesResponse.json();
					const expenses = expensesResult.data || [];
					const thirtyDaysAgo = new Date();
					thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
					const recentExpenses = expenses
						.filter((e: any) => new Date(e.date) > thirtyDaysAgo)
						.reduce((sum: number, e: any) => sum + e.amount, 0);
					const totalExpenses = expenses.reduce((sum: number, e: any) => sum + e.amount, 0);
					const lastActivity =
						expenses.length > 0
							? new Date(Math.max(...expenses.map((e: any) => new Date(e.date).getTime())))
							: null;
					return {
						id: vehicle.id,
						name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
						nickname: vehicle.nickname,
						recentExpenses,
						totalExpenses,
						lastActivity,
						hasActiveFinancing: vehicle.financing?.isActive || false
					};
				} catch {
					return {
						id: vehicle.id,
						name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
						nickname: vehicle.nickname,
						recentExpenses: 0,
						totalExpenses: 0,
						lastActivity: null,
						hasActiveFinancing: vehicle.financing?.isActive || false
					};
				}
			});
			vehicleDetails = await Promise.all(vehicleDetailsPromises);
		} catch (error) {
			console.error('Failed to load vehicle details:', error);
		}
	}

	async function loadRecentExpenses() {
		try {
			const response = await fetch('/api/v1/expenses?limit=10', { credentials: 'include' });
			if (!response.ok) return;
			const result = await response.json();
			const expenses = result.data || [];
			const vehiclesResponse = await fetch('/api/v1/vehicles', { credentials: 'include' });
			if (!vehiclesResponse.ok) return;
			const vehiclesResult = await vehiclesResponse.json();
			const vehicles = vehiclesResult.data || [];
			const vehicleMap = new Map(
				vehicles.map((v: any) => [v.id, v.nickname || `${v.year} ${v.make} ${v.model}`])
			);
			recentExpenses = expenses
				.map((e: any) => ({
					id: e.id,
					amount: e.amount,
					category: e.category,
					date: new Date(e.date),
					description: e.description,
					vehicleName: vehicleMap.get(e.vehicleId) || 'Unknown Vehicle'
				}))
				.slice(0, 5);
		} catch (error) {
			console.error('Failed to load recent expenses:', error);
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

<div class="space-y-6">
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
		<VehicleCarousel vehicles={vehicleDetails} {isLoading} />
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
	class="fixed bottom-4 left-4 right-4 z-50 h-16 rounded-full sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto flex items-center justify-center gap-2 pl-6 pr-10 bg-gray-900 hover:bg-gray-800 text-white shadow-2xl hover:shadow-gray-900/50 transition-all duration-300 sm:hover:scale-110 border-0 group"
	aria-label="Add vehicle"
>
	<Plus class="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" />
	<span class="font-bold text-lg">Add Vehicle</span>
</Button>
