<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { appStore } from '$lib/stores/app.js';
	import {
		Plus,
		Car,
		Search,
		Filter,
		DollarSign,
		Gauge,
		TrendingUp,
		Calendar,
		Fuel,
		Wrench,
		AlertCircle,
		ArrowRight
	} from 'lucide-svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import type { Vehicle, Expense, AppState } from '$lib/types/index.js';

	let appState = $state<AppState>({
		vehicles: [],
		selectedVehicle: null,
		notifications: [],
		isLoading: false,
		isMobileMenuOpen: false
	});
	let searchTerm = $state('');
	let selectedFilter = $state('all');
	let vehicleExpenses = $state<Record<string, Expense[]>>({});
	let vehicleStats = $state<Record<string, any>>({});

	let filteredVehicles = $derived(
		appState.vehicles.filter((vehicle: Vehicle) => {
			// Apply search filter
			if (searchTerm) {
				const search = searchTerm.toLowerCase();
				const matchesSearch =
					vehicle.make.toLowerCase().includes(search) ||
					vehicle.model.toLowerCase().includes(search) ||
					vehicle.nickname?.toLowerCase().includes(search) ||
					vehicle.licensePlate?.toLowerCase().includes(search);
				if (!matchesSearch) return false;
			}

			// Apply category filter
			if (selectedFilter === 'all') return true;
			if (selectedFilter === 'with-loans') return !!vehicle.loan?.isActive;
			if (selectedFilter === 'recent') {
				const oneMonthAgo = new Date();
				oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
				return new Date(vehicle.createdAt) > oneMonthAgo;
			}

			return true;
		})
	);

	// Calculate dashboard summary statistics
	let dashboardStats = $derived.by(() => {
		const totalVehicles = appState.vehicles.length;
		const activeLoans = appState.vehicles.filter((v: Vehicle) => v.loan?.isActive).length;

		// Calculate total recent expenses (last 30 days)
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		let totalRecentExpenses = 0;
		let totalExpenses = 0;

		Object.values(vehicleExpenses).forEach(expenses => {
			expenses.forEach(expense => {
				totalExpenses += expense.amount;
				if (new Date(expense.date) > thirtyDaysAgo) {
					totalRecentExpenses += expense.amount;
				}
			});
		});

		return {
			totalVehicles,
			activeLoans,
			totalRecentExpenses,
			totalExpenses,
			averageExpensePerVehicle: totalVehicles > 0 ? totalExpenses / totalVehicles : 0
		};
	});

	onMount(() => {
		const unsubscribe = appStore.subscribe(state => {
			appState = state;
		});

		loadVehicles();

		return unsubscribe;
	});

	async function loadVehicles() {
		appStore.setLoading(true);
		try {
			const response = await fetch('/api/vehicles', {
				credentials: 'include'
			});

			if (response.ok) {
				const result = await response.json();
				const vehicles = result.data || [];
				appStore.setVehicles(vehicles);

				// Load expenses for each vehicle
				await loadVehicleExpenses(vehicles);
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Failed to load vehicles'
				});
			}
		} catch {
			appStore.addNotification({
				type: 'error',
				message: 'Error loading vehicles'
			});
		} finally {
			appStore.setLoading(false);
		}
	}

	async function loadVehicleExpenses(vehicles: Vehicle[]) {
		const expensePromises = vehicles.map(async vehicle => {
			try {
				const response = await fetch(`/api/expenses?vehicleId=${vehicle.id}`, {
					credentials: 'include'
				});

				if (response.ok) {
					const result = await response.json();
					const expenses = result.data || [];
					vehicleExpenses[vehicle.id] = expenses;

					// Calculate vehicle statistics
					calculateVehicleStats(vehicle.id, expenses);
				}
			} catch (error) {
				console.error(`Failed to load expenses for vehicle ${vehicle.id}:`, error);
				vehicleExpenses[vehicle.id] = [];
			}
		});

		await Promise.all(expensePromises);
	}

	function calculateVehicleStats(vehicleId: string, expenses: Expense[]) {
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
		const sixtyDaysAgo = new Date();
		sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

		const recentExpenses = expenses.filter(e => new Date(e.date) > thirtyDaysAgo);
		const previousMonthExpenses = expenses.filter(
			e => new Date(e.date) > sixtyDaysAgo && new Date(e.date) <= thirtyDaysAgo
		);

		const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
		const recentAmount = recentExpenses.reduce((sum, e) => sum + e.amount, 0);
		const previousAmount = previousMonthExpenses.reduce((sum, e) => sum + e.amount, 0);

		// Calculate trend (comparing last 30 days to previous 30 days)
		let trend = 0;
		if (previousAmount > 0) {
			trend = ((recentAmount - previousAmount) / previousAmount) * 100;
		}

		// Calculate fuel efficiency if fuel expenses exist
		const fuelExpenses = expenses.filter(e => e.type === 'fuel' && e.gallons && e.mileage);
		let avgMpg = 0;
		let currentMileage = 0;
		if (fuelExpenses.length > 1) {
			// Calculate MPG for each fuel-up and average them
			const mpgValues = [];
			for (let i = 1; i < fuelExpenses.length; i++) {
				const current = fuelExpenses[i];
				const previous = fuelExpenses[i - 1];
				if (current?.mileage && previous?.mileage && current?.gallons) {
					const miles = current.mileage - previous.mileage;
					const mpg = miles / current.gallons;
					if (mpg > 0 && mpg < 100) {
						// Reasonable MPG range
						mpgValues.push(mpg);
					}
				}
			}
			avgMpg =
				mpgValues.length > 0 ? mpgValues.reduce((sum, mpg) => sum + mpg, 0) / mpgValues.length : 0;
			currentMileage = Math.max(...fuelExpenses.map(e => e.mileage || 0));
		}

		// Calculate cost per mile
		let costPerMile = 0;
		if (currentMileage > 0) {
			const vehicle = appState.vehicles.find(v => v.id === vehicleId);
			const initialMileage = vehicle?.initialMileage || 0;
			const milesDriven = currentMileage - initialMileage;
			if (milesDriven > 0) {
				costPerMile = totalAmount / milesDriven;
			}
		}

		// Get maintenance expenses
		const maintenanceExpenses = expenses.filter(e => e.category === 'maintenance');
		const lastMaintenanceDate =
			maintenanceExpenses.length > 0
				? new Date(Math.max(...maintenanceExpenses.map(e => new Date(e.date).getTime())))
				: null;

		// Days since last maintenance
		const daysSinceLastMaintenance = lastMaintenanceDate
			? Math.floor((Date.now() - lastMaintenanceDate.getTime()) / (1000 * 60 * 60 * 24))
			: null;

		vehicleStats[vehicleId] = {
			totalExpenses: totalAmount,
			recentExpenses: recentAmount,
			expenseCount: expenses.length,
			recentExpenseCount: recentExpenses.length,
			avgMpg: Math.round(avgMpg * 10) / 10,
			currentMileage,
			costPerMile: Math.round(costPerMile * 100) / 100,
			trend: Math.round(trend),
			lastExpenseDate:
				expenses.length > 0
					? new Date(Math.max(...expenses.map(e => new Date(e.date).getTime())))
					: null,
			lastMaintenanceDate,
			daysSinceLastMaintenance,
			maintenanceCount: maintenanceExpenses.length
		};
	}

	function getVehicleDisplayName(vehicle: Vehicle): string {
		return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(amount);
	}

	function getRelativeTime(date: Date | null): string {
		if (!date) return 'Never';
		const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 7) return `${days} days ago`;
		if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
		if (days < 365) return `${Math.floor(days / 30)} months ago`;
		return `${Math.floor(days / 365)} years ago`;
	}

	function navigateToVehicle(vehicleId: string) {
		goto(`/vehicles/${vehicleId}`);
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
			<h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
			<p class="text-gray-600">
				{#if appState.vehicles.length > 0}
					Manage your vehicle fleet and track expenses
				{:else}
					Welcome! Add your first vehicle to get started
				{/if}
			</p>
		</div>

		<a href="/vehicles/new" class="btn btn-primary inline-flex items-center gap-2">
			<Plus class="h-4 w-4" />
			Add Vehicle
		</a>
	</div>

	<!-- Dashboard Statistics -->
	{#if !appState.isLoading && appState.vehicles.length > 0}
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Total Vehicles</p>
						<p class="text-2xl font-bold text-gray-900">{dashboardStats.totalVehicles}</p>
					</div>
					<Car class="h-8 w-8 text-primary-600" />
				</div>
			</div>

			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Active Loans</p>
						<p class="text-2xl font-bold text-gray-900">{dashboardStats.activeLoans}</p>
					</div>
					<DollarSign class="h-8 w-8 text-orange-600" />
				</div>
			</div>

			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Last 30 Days</p>
						<p class="text-2xl font-bold text-gray-900">
							{formatCurrency(dashboardStats.totalRecentExpenses)}
						</p>
					</div>
					<TrendingUp class="h-8 w-8 text-green-600" />
				</div>
			</div>

			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Avg per Vehicle</p>
						<p class="text-2xl font-bold text-gray-900">
							{formatCurrency(dashboardStats.averageExpensePerVehicle)}
						</p>
					</div>
					<Gauge class="h-8 w-8 text-blue-600" />
				</div>
			</div>
		</div>
	{/if}

	<!-- Search and Filters -->
	<div class="flex flex-col sm:flex-row gap-4">
		<div class="relative flex-1">
			<Search class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
			<Input
				type="text"
				placeholder="Search vehicles..."
				class="pl-10"
				bind:value={searchTerm}
			/>
		</div>

		<div class="flex gap-2">
			<select class="form-input min-w-0 sm:min-w-[140px]" bind:value={selectedFilter}>
				<option value="all">All Vehicles</option>
				<option value="recent">Recently Added</option>
				<option value="with-loans">With Loans</option>
			</select>

			<button class="btn btn-secondary inline-flex items-center gap-2 desktop-only">
				<Filter class="h-4 w-4" />
				More Filters
			</button>
		</div>
	</div>

	<!-- Vehicles Grid -->
	{#if appState.isLoading}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{#each Array(6) as _}
				<div class="card animate-pulse">
					<div class="h-4 bg-gray-200 rounded mb-2"></div>
					<div class="h-3 bg-gray-200 rounded mb-4 w-3/4"></div>
					<div class="h-3 bg-gray-200 rounded mb-2 w-1/2"></div>
					<div class="h-3 bg-gray-200 rounded w-2/3"></div>
				</div>
			{/each}
		</div>
	{:else if filteredVehicles.length === 0}
		<div class="card text-center py-12">
			<Car class="h-12 w-12 text-gray-400 mx-auto mb-4" />
			{#if searchTerm}
				<h3 class="text-lg font-medium text-gray-900 mb-2">No vehicles found</h3>
				<p class="text-gray-600 mb-6">Try adjusting your search terms</p>
				<button class="btn btn-secondary" onclick={() => (searchTerm = '')}> Clear Search </button>
			{:else}
				<h3 class="text-lg font-medium text-gray-900 mb-2">No vehicles yet</h3>
				<p class="text-gray-600 mb-6">Add your first vehicle to start tracking expenses</p>
				<a href="/vehicles/new" class="btn btn-primary inline-flex items-center gap-2">
					<Plus class="h-4 w-4" />
					Add Your First Vehicle
				</a>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
			{#each filteredVehicles as vehicle}
				{@const stats = vehicleStats[vehicle.id] || {}}
				<div
					class="bg-white rounded-2xl p-6 shadow-sm hover:shadow-2xl transition-all duration-300 cursor-pointer group relative overflow-hidden border border-gray-100"
					onclick={() => navigateToVehicle(vehicle.id)}
					role="button"
					tabindex="0"
					onkeydown={e => e.key === 'Enter' && navigateToVehicle(vehicle.id)}
				>
					<!-- Gradient accent bar -->
					<div
						class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary-500 to-primary-600"
					></div>

					<!-- Vehicle Header -->
					<div class="flex items-start justify-between mb-4">
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 mb-1">
								<h3 class="font-bold text-gray-900 text-lg truncate">
									{getVehicleDisplayName(vehicle)}
								</h3>
								{#if vehicle.loan?.isActive}
									<span
										class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800"
										title="Active Loan"
									>
										Loan
									</span>
								{/if}
							</div>
							<p class="text-sm text-gray-600 font-medium mb-1">
								{vehicle.year}
								{vehicle.make}
								{vehicle.model}
							</p>
							{#if vehicle.licensePlate}
								<p
									class="text-xs text-gray-500 font-mono bg-gray-100 inline-block px-2 py-0.5 rounded"
								>
									{vehicle.licensePlate}
								</p>
							{/if}
						</div>
						<div class="flex-shrink-0 ml-3">
							<div
								class="p-3 rounded-xl bg-gradient-to-br from-primary-50 to-primary-100 group-hover:from-primary-100 group-hover:to-primary-200 transition-all"
							>
								<Car class="h-6 w-6 text-primary-600" />
							</div>
						</div>
					</div>

					<!-- Key Metrics - Prominent Display -->
					<div class="grid grid-cols-2 gap-3 mb-4">
						<!-- Total Expenses -->
						<div
							class="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3 border border-blue-200"
						>
							<div class="flex items-center gap-1 mb-1">
								<DollarSign class="h-3.5 w-3.5 text-blue-600" />
								<p class="text-xs font-medium text-blue-900">Total Spent</p>
							</div>
							<p class="font-bold text-gray-900 text-lg">
								{formatCurrency(stats.totalExpenses || 0)}
							</p>
						</div>

						<!-- Recent Expenses with Trend -->
						<div
							class="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3 border border-green-200"
						>
							<div class="flex items-center gap-1 mb-1">
								<TrendingUp class="h-3.5 w-3.5 text-green-600" />
								<p class="text-xs font-medium text-green-900">Last 30 Days</p>
							</div>
							<div class="flex items-baseline gap-2">
								<p class="font-bold text-gray-900 text-lg">
									{formatCurrency(stats.recentExpenses || 0)}
								</p>
								{#if stats.trend !== undefined && stats.trend !== 0}
									<span
										class="text-xs font-semibold {stats.trend > 0
											? 'text-red-600'
											: 'text-green-600'}"
									>
										{stats.trend > 0 ? '+' : ''}{stats.trend}%
									</span>
								{/if}
							</div>
						</div>

						<!-- MPG or Cost per Mile -->
						{#if stats.avgMpg > 0}
							<div
								class="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3 border border-purple-200"
							>
								<div class="flex items-center gap-1 mb-1">
									<Fuel class="h-3.5 w-3.5 text-purple-600" />
									<p class="text-xs font-medium text-purple-900">Avg MPG</p>
								</div>
								<p class="font-bold text-gray-900 text-lg">{stats.avgMpg}</p>
							</div>
						{:else}
							<div
								class="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-3 border border-gray-200"
							>
								<div class="flex items-center gap-1 mb-1">
									<Gauge class="h-3.5 w-3.5 text-gray-600" />
									<p class="text-xs font-medium text-gray-900">Expenses</p>
								</div>
								<p class="font-bold text-gray-900 text-lg">{stats.expenseCount || 0}</p>
							</div>
						{/if}

						<!-- Cost per Mile or Mileage -->
						{#if stats.costPerMile > 0}
							<div
								class="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-3 border border-orange-200"
							>
								<div class="flex items-center gap-1 mb-1">
									<Gauge class="h-3.5 w-3.5 text-orange-600" />
									<p class="text-xs font-medium text-orange-900">Cost/Mile</p>
								</div>
								<p class="font-bold text-gray-900 text-lg">
									${stats.costPerMile.toFixed(2)}
								</p>
							</div>
						{:else}
							<div
								class="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-3 border border-gray-200"
							>
								<div class="flex items-center gap-1 mb-1">
									<Calendar class="h-3.5 w-3.5 text-gray-600" />
									<p class="text-xs font-medium text-gray-900">Last Activity</p>
								</div>
								<p class="font-semibold text-gray-900 text-sm">
									{#if stats.lastExpenseDate}
										{getRelativeTime(stats.lastExpenseDate)}
									{:else}
										None
									{/if}
								</p>
							</div>
						{/if}
					</div>

					<!-- Additional Info & Alerts -->
					<div class="space-y-2 mb-4">
						<!-- Maintenance Alert -->
						{#if stats.daysSinceLastMaintenance !== null}
							{#if stats.daysSinceLastMaintenance > 90}
								<div class="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
									<AlertCircle class="h-4 w-4 text-red-600 flex-shrink-0" />
									<p class="text-xs text-red-800 font-medium">
										Maintenance overdue ({stats.daysSinceLastMaintenance} days)
									</p>
								</div>
							{:else if stats.daysSinceLastMaintenance > 60}
								<div
									class="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg"
								>
									<Wrench class="h-4 w-4 text-yellow-600 flex-shrink-0" />
									<p class="text-xs text-yellow-800 font-medium">
										Maintenance due soon ({stats.daysSinceLastMaintenance} days)
									</p>
								</div>
							{:else}
								<div
									class="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg"
								>
									<Wrench class="h-4 w-4 text-green-600 flex-shrink-0" />
									<p class="text-xs text-green-800 font-medium">
										Last service: {getRelativeTime(stats.lastMaintenanceDate)}
									</p>
								</div>
							{/if}
						{/if}

						<!-- Current Mileage -->
						{#if stats.currentMileage > 0}
							<div class="flex items-center justify-between text-sm">
								<span class="text-gray-600 flex items-center gap-1">
									<Gauge class="h-3.5 w-3.5" />
									Current Mileage
								</span>
								<span class="text-gray-900 font-semibold">
									{stats.currentMileage.toLocaleString()} mi
								</span>
							</div>
						{/if}

						<!-- Loan Info -->
						{#if vehicle.loan?.isActive}
							<div class="flex items-center justify-between text-sm">
								<span class="text-gray-600">Loan Balance</span>
								<span class="text-gray-900 font-semibold">
									{formatCurrency(vehicle.loan.currentBalance)}
								</span>
							</div>
							<!-- Loan Progress Bar -->
							<div class="mt-2">
								<div class="flex justify-between text-xs text-gray-600 mb-1">
									<span>Loan Progress</span>
									<span>
										{Math.round(
											((vehicle.loan.originalAmount - vehicle.loan.currentBalance) /
												vehicle.loan.originalAmount) *
												100
										)}% paid
									</span>
								</div>
								<div class="w-full bg-gray-200 rounded-full h-1.5">
									<div
										class="bg-gradient-to-r from-orange-500 to-orange-600 h-1.5 rounded-full transition-all duration-300"
										style="width: {((vehicle.loan.originalAmount - vehicle.loan.currentBalance) /
											vehicle.loan.originalAmount) *
											100}%"
									></div>
								</div>
							</div>
						{/if}
					</div>

					<!-- Action Buttons -->
					<div class="flex gap-2 pt-3 border-t border-gray-100">
						<button
							class="btn btn-primary flex-1 text-center text-sm inline-flex items-center justify-center gap-1 group/btn"
							onclick={e => {
								e.stopPropagation();
								navigateToVehicle(vehicle.id);
							}}
						>
							View Details
							<ArrowRight
								class="h-3.5 w-3.5 group-hover/btn:translate-x-0.5 transition-transform"
							/>
						</button>
						<a
							href="/vehicles/{vehicle.id}/expenses/new"
							class="btn btn-secondary flex-1 text-center text-sm inline-flex items-center justify-center gap-1"
							onclick={e => e.stopPropagation()}
						>
							<Plus class="h-3.5 w-3.5" />
							Add Expense
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
