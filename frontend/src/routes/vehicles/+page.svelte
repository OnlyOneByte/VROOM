<script lang="ts">
	import { onMount } from 'svelte';
	import { appStore } from '$lib/stores/app.js';
	import { Plus, Car, Search, Filter } from 'lucide-svelte';
	import type { Vehicle } from '$lib/types.js';

	let appState = $state({ vehicles: [], isLoading: false });
	let searchTerm = $state('');
	let filteredVehicles = $derived(
		appState.vehicles.filter(vehicle => {
			if (!searchTerm) return true;
			const search = searchTerm.toLowerCase();
			return (
				vehicle.make.toLowerCase().includes(search) ||
				vehicle.model.toLowerCase().includes(search) ||
				vehicle.nickname?.toLowerCase().includes(search) ||
				vehicle.licensePlate?.toLowerCase().includes(search)
			);
		})
	);

	onMount(() => {
		const unsubscribe = appStore.subscribe((state) => {
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
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Failed to load vehicles'
				});
			}
		} catch (error) {
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
	<title>Vehicles - VROOM Car Tracker</title>
	<meta name="description" content="Manage your vehicles" />
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Vehicles</h1>
			<p class="text-gray-600">Manage your vehicle fleet</p>
		</div>
		
		<a 
			href="/vehicles/new" 
			class="btn btn-primary inline-flex items-center gap-2"
		>
			<Plus class="h-4 w-4" />
			Add Vehicle
		</a>
	</div>

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
		
		<button class="btn btn-secondary inline-flex items-center gap-2">
			<Filter class="h-4 w-4" />
			Filters
		</button>
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
				<p class="text-gray-600 mb-6">
					Try adjusting your search terms
				</p>
				<button 
					class="btn btn-secondary"
					onclick={() => searchTerm = ''}
				>
					Clear Search
				</button>
			{:else}
				<h3 class="text-lg font-medium text-gray-900 mb-2">No vehicles yet</h3>
				<p class="text-gray-600 mb-6">
					Add your first vehicle to start tracking expenses
				</p>
				<a href="/vehicles/new" class="btn btn-primary inline-flex items-center gap-2">
					<Plus class="h-4 w-4" />
					Add Your First Vehicle
				</a>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{#each filteredVehicles as vehicle}
				<div class="card hover:shadow-md transition-shadow duration-200">
					<div class="flex items-start justify-between mb-4">
						<div class="flex-1">
							<h3 class="font-semibold text-gray-900 mb-1">
								{vehicle.nickname || `${vehicle.make} ${vehicle.model}`}
							</h3>
							<p class="text-sm text-gray-600">
								{vehicle.year} {vehicle.make} {vehicle.model}
							</p>
							{#if vehicle.licensePlate}
								<p class="text-xs text-gray-500 mt-1">
									License: {vehicle.licensePlate}
								</p>
							{/if}
						</div>
						<Car class="h-6 w-6 text-gray-400 flex-shrink-0" />
					</div>

					<div class="space-y-2 mb-4">
						{#if vehicle.purchaseDate}
							<div class="text-sm">
								<span class="text-gray-600">Purchased:</span>
								<span class="text-gray-900">
									{new Date(vehicle.purchaseDate).toLocaleDateString()}
								</span>
							</div>
						{/if}
						
						{#if vehicle.initialMileage}
							<div class="text-sm">
								<span class="text-gray-600">Initial Mileage:</span>
								<span class="text-gray-900">{vehicle.initialMileage.toLocaleString()} mi</span>
							</div>
						{/if}

						<div class="text-sm">
							<span class="text-gray-600">Recent expenses:</span>
							<span class="font-medium text-gray-900">$0.00</span>
						</div>
					</div>

					<div class="flex gap-2">
						<a 
							href="/vehicles/{vehicle.id}" 
							class="btn btn-primary flex-1 text-center"
						>
							View Details
						</a>
						<a 
							href="/vehicles/{vehicle.id}/expenses/new" 
							class="btn btn-secondary flex-1 text-center"
						>
							Add Expense
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>