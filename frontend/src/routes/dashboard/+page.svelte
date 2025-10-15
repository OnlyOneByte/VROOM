<script lang="ts">
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth.js';
	import { appStore } from '$lib/stores/app.js';
	import type { AuthState, AppState } from '$lib/types/index.js';
	import { Plus, Car, TrendingUp, DollarSign } from 'lucide-svelte';

	let authState = $state<AuthState>({
		user: null,
		isAuthenticated: false,
		isLoading: true,
		error: null,
		token: null
	});
	let appState = $state<AppState>({
		vehicles: [],
		selectedVehicle: null,
		notifications: [],
		isLoading: false,
		isMobileMenuOpen: false
	});

	onMount(() => {
		// Subscribe to auth store
		const unsubscribeAuth = authStore.subscribe(state => {
			authState = state;
		});

		// Subscribe to app store
		const unsubscribeApp = appStore.subscribe(state => {
			appState = state;
		});

		// Load vehicles when component mounts
		loadVehicles();

		return () => {
			unsubscribeAuth();
			unsubscribeApp();
		};
	});

	async function loadVehicles() {
		if (!authState.isAuthenticated) return;

		appStore.setLoading(true);
		try {
			const response = await fetch('/api/vehicles', {
				credentials: 'include'
			});

			if (response.ok) {
				const result = await response.json();
				const vehicles = result.data || [];
				appStore.setVehicles(vehicles);
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
			<p class="text-gray-600">Welcome back, {authState.user?.displayName || 'User'}!</p>
		</div>

		<a href="/vehicles/new" class="btn btn-primary inline-flex items-center gap-2">
			<Plus class="h-4 w-4" />
			Add Vehicle
		</a>
	</div>

	<!-- Quick Stats -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
		<div class="card">
			<div class="flex items-center gap-3">
				<div class="p-2 bg-blue-100 rounded-lg">
					<Car class="h-6 w-6 text-blue-600" />
				</div>
				<div>
					<p class="text-sm text-gray-600">Total Vehicles</p>
					<p class="text-2xl font-bold text-gray-900">{appState.vehicles.length}</p>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="flex items-center gap-3">
				<div class="p-2 bg-green-100 rounded-lg">
					<DollarSign class="h-6 w-6 text-green-600" />
				</div>
				<div>
					<p class="text-sm text-gray-600">This Month</p>
					<p class="text-2xl font-bold text-gray-900">$0.00</p>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="flex items-center gap-3">
				<div class="p-2 bg-purple-100 rounded-lg">
					<TrendingUp class="h-6 w-6 text-purple-600" />
				</div>
				<div>
					<p class="text-sm text-gray-600">Avg. Cost/Mile</p>
					<p class="text-2xl font-bold text-gray-900">$0.00</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Vehicles Section -->
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold text-gray-900">Your Vehicles</h2>
			{#if appState.vehicles.length > 0}
				<a href="/vehicles" class="text-primary-600 hover:text-primary-700 text-sm font-medium">
					View All
				</a>
			{/if}
		</div>

		{#if appState.isLoading}
			<div class="card">
				<div class="flex items-center justify-center py-8">
					<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
				</div>
			</div>
		{:else if appState.vehicles.length === 0}
			<div class="card text-center py-12">
				<Car class="h-12 w-12 text-gray-400 mx-auto mb-4" />
				<h3 class="text-lg font-medium text-gray-900 mb-2">No vehicles yet</h3>
				<p class="text-gray-600 mb-6">Add your first vehicle to start tracking expenses</p>
				<a href="/vehicles/new" class="btn btn-primary inline-flex items-center gap-2">
					<Plus class="h-4 w-4" />
					Add Your First Vehicle
				</a>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{#each appState.vehicles.slice(0, 6) as vehicle}
					<div class="card hover:shadow-md transition-shadow duration-200">
						<div class="flex items-start justify-between mb-3">
							<div>
								<h3 class="font-semibold text-gray-900">
									{vehicle.nickname || `${vehicle.make} ${vehicle.model}`}
								</h3>
								<p class="text-sm text-gray-600">
									{vehicle.year}
									{vehicle.make}
									{vehicle.model}
								</p>
							</div>
							<Car class="h-5 w-5 text-gray-400" />
						</div>

						{#if vehicle.licensePlate}
							<p class="text-xs text-gray-500 mb-3">
								License: {vehicle.licensePlate}
							</p>
						{/if}

						<div class="flex justify-between items-center">
							<div class="text-sm">
								<span class="text-gray-600">Recent expenses:</span>
								<span class="font-medium text-gray-900">$0.00</span>
							</div>
							<a
								href="/vehicles/{vehicle.id}"
								class="text-primary-600 hover:text-primary-700 text-sm font-medium"
							>
								View Details
							</a>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
