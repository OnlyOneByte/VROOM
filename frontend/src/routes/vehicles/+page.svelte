<script lang="ts">
	import { onMount } from 'svelte';
	import { appStore } from '$lib/stores/app.js';
	import { Plus, Car, Search, Filter, DollarSign, Gauge, TrendingUp } from 'lucide-svelte';
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
	let dashboardStats = $derived(() => {
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
				const vehicles = await response.json();
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
				const response = await fetch(`/api/vehicles/${vehicle.id}/expenses`, {
					credentials: 'include'
				});

				if (response.ok) {
					const expenses = await response.json();
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

		const recentExpenses = expenses.filter(e => new Date(e.date) > thirtyDaysAgo);
		const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
		const recentAmount = recentExpenses.reduce((sum, e) => sum + e.amount, 0);

		// Calculate fuel efficiency if fuel expenses exist
		const fuelExpenses = expenses.filter(e => e.type === 'fuel' && e.gallons && e.mileage);
		let avgMpg = 0;
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
		}

		vehicleStats[vehicleId] = {
			totalExpenses: totalAmount,
			recentExpenses: recentAmount,
			expenseCount: expenses.length,
			recentExpenseCount: recentExpenses.length,
			avgMpg: Math.round(avgMpg * 10) / 10,
			lastExpenseDate:
				expenses.length > 0
					? new Date(Math.max(...expenses.map(e => new Date(e.date).getTime())))
					: null
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

	function formatDate(date: Date): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(date);
	}
</script>

<svelte:head>
	<title>Vehicles - VROOM Car Tracker</title>
	<meta name="description" content="Manage your vehicles" />
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Vehicle Dashboard</h1>
			<p class="text-gray-600">Manage your vehicle fleet and track expenses</p>
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
						<p class="text-2xl font-bold text-gray-900">{dashboardStats().totalVehicles}</p>
					</div>
					<Car class="h-8 w-8 text-primary-600" />
				</div>
			</div>

			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Active Loans</p>
						<p class="text-2xl font-bold text-gray-900">{dashboardStats().activeLoans}</p>
					</div>
					<DollarSign class="h-8 w-8 text-orange-600" />
				</div>
			</div>

			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Last 30 Days</p>
						<p class="text-2xl font-bold text-gray-900">
							{formatCurrency(dashboardStats().totalRecentExpenses)}
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
							{formatCurrency(dashboardStats().averageExpensePerVehicle)}
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
			<input
				type="text"
				placeholder="Search vehicles..."
				class="form-input pl-10"
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
				<div class="card hover:shadow-lg transition-all duration-200 cursor-pointer group">
					<!-- Vehicle Header -->
					<div class="flex items-start justify-between mb-4">
						<div class="flex-1 min-w-0">
							<h3 class="font-semibold text-gray-900 mb-1 truncate">
								{getVehicleDisplayName(vehicle)}
							</h3>
							<p class="text-sm text-gray-600 mb-1">
								{vehicle.year}
								{vehicle.make}
								{vehicle.model}
							</p>
							{#if vehicle.licensePlate}
								<p class="text-xs text-gray-500 font-mono">
									{vehicle.licensePlate}
								</p>
							{/if}
						</div>
						<div class="flex-shrink-0 ml-3">
							<Car class="h-6 w-6 text-gray-400 group-hover:text-primary-600 transition-colors" />
							{#if vehicle.loan?.isActive}
								<div
									class="w-2 h-2 bg-orange-500 rounded-full mt-1 ml-auto"
									title="Active Loan"
								></div>
							{/if}
						</div>
					</div>

					<!-- Vehicle Stats Grid -->
					<div class="grid grid-cols-2 gap-3 mb-4">
						<div class="bg-gray-50 rounded-lg p-3">
							<p class="text-xs text-gray-600 mb-1">Total Expenses</p>
							<p class="font-semibold text-gray-900 text-sm">
								{formatCurrency(stats.totalExpenses || 0)}
							</p>
						</div>

						<div class="bg-gray-50 rounded-lg p-3">
							<p class="text-xs text-gray-600 mb-1">Last 30 Days</p>
							<p class="font-semibold text-gray-900 text-sm">
								{formatCurrency(stats.recentExpenses || 0)}
							</p>
						</div>

						{#if stats.avgMpg > 0}
							<div class="bg-gray-50 rounded-lg p-3">
								<p class="text-xs text-gray-600 mb-1">Avg MPG</p>
								<p class="font-semibold text-gray-900 text-sm">
									{stats.avgMpg}
								</p>
							</div>
						{:else}
							<div class="bg-gray-50 rounded-lg p-3">
								<p class="text-xs text-gray-600 mb-1">Expenses</p>
								<p class="font-semibold text-gray-900 text-sm">
									{stats.expenseCount || 0} total
								</p>
							</div>
						{/if}

						<div class="bg-gray-50 rounded-lg p-3">
							<p class="text-xs text-gray-600 mb-1">Last Activity</p>
							<p class="font-semibold text-gray-900 text-sm">
								{#if stats.lastExpenseDate}
									{formatDate(stats.lastExpenseDate)}
								{:else}
									No expenses
								{/if}
							</p>
						</div>
					</div>

					<!-- Vehicle Details -->
					<div class="space-y-2 mb-4 text-sm">
						{#if vehicle.purchaseDate}
							<div class="flex justify-between">
								<span class="text-gray-600">Purchased:</span>
								<span class="text-gray-900">{formatDate(new Date(vehicle.purchaseDate))}</span>
							</div>
						{/if}

						{#if vehicle.initialMileage}
							<div class="flex justify-between">
								<span class="text-gray-600">Initial Mileage:</span>
								<span class="text-gray-900">{vehicle.initialMileage.toLocaleString()} mi</span>
							</div>
						{/if}

						{#if vehicle.loan?.isActive}
							<div class="flex justify-between">
								<span class="text-gray-600">Loan Balance:</span>
								<span class="text-gray-900 font-medium">
									{formatCurrency(vehicle.loan.currentBalance)}
								</span>
							</div>
						{/if}
					</div>

					<!-- Action Buttons -->
					<div class="flex gap-2">
						<a href="/vehicles/{vehicle.id}" class="btn btn-primary flex-1 text-center text-sm">
							View Details
						</a>
						<a
							href="/vehicles/{vehicle.id}/expenses/new"
							class="btn btn-secondary flex-1 text-center text-sm"
						>
							Add Expense
						</a>
					</div>

					<!-- Quick Actions (Mobile) -->
					<div class="mt-3 pt-3 border-t border-gray-100 mobile-only">
						<div class="flex justify-between text-xs">
							<button class="text-primary-600 hover:text-primary-700 font-medium">
								Quick Entry
							</button>
							<button class="text-gray-600 hover:text-gray-700 font-medium"> Analytics </button>
							<button class="text-gray-600 hover:text-gray-700 font-medium"> Share </button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
