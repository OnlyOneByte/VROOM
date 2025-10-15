<script lang="ts">
	import { onMount } from 'svelte';

	import { Car, ArrowLeft } from 'lucide-svelte';
	import { getVehicleAnalytics } from '$lib/utils/analytics-api';
	import { appStore } from '$lib/stores/app';
	import type { AppState } from '$lib/types/index.js';
	import FuelEfficiencyMonitor from '$lib/components/analytics/FuelEfficiencyMonitor.svelte';

	let vehicleId = $state('');

	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Get available vehicles from app store
	let appState = $state<AppState>({
		vehicles: [],
		selectedVehicle: null,
		notifications: [],
		isLoading: false,
		isMobileMenuOpen: false
	});

	onMount(() => {
		// Get vehicle ID from URL params
		const urlParams = new URLSearchParams(window.location.search);
		vehicleId = urlParams.get('vehicle') || '';

		// Subscribe to app state for vehicles
		const unsubscribe = appStore.subscribe(state => {
			appState = state;
		});

		// Load vehicle data if we have an ID
		if (vehicleId) {
			loadVehicleData();
		} else if (appState.vehicles.length > 0) {
			// Default to first vehicle if no ID specified
			vehicleId = appState.vehicles[0]?.id ?? '';
			loadVehicleData();
		}

		return unsubscribe;
	});

	async function loadVehicleData() {
		if (!vehicleId) return;

		try {
			isLoading = true;
			error = null;

			await getVehicleAnalytics(vehicleId);
		} catch (err) {
			console.error('Error loading vehicle analytics:', err);
			error = err instanceof Error ? err.message : 'Failed to load vehicle data';
		} finally {
			isLoading = false;
		}
	}

	function handleVehicleChange(newVehicleId: string) {
		vehicleId = newVehicleId;

		// Update URL without page reload
		const url = new URL(window.location.href);
		url.searchParams.set('vehicle', vehicleId);
		window.history.replaceState({}, '', url.toString());

		loadVehicleData();
	}

	// Find current vehicle info
	let currentVehicle = $derived.by(() => {
		return appState.vehicles.find(v => v.id === vehicleId) || null;
	});
</script>

<svelte:head>
	<title>Fuel Efficiency Monitor - VROOM Car Tracker</title>
	<meta name="description" content="Monitor fuel efficiency and get alerts for your vehicles" />
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center space-x-4">
		<a
			href="/analytics"
			class="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors"
		>
			<ArrowLeft class="h-5 w-5 mr-1" />
			Back to Analytics
		</a>
	</div>

	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Fuel Efficiency Monitor</h1>
			<p class="text-gray-600">Track and analyze fuel efficiency trends</p>
		</div>
	</div>

	<!-- Vehicle Selector -->
	{#if appState.vehicles.length > 1}
		<div class="bg-white p-4 rounded-lg shadow border">
			<label for="vehicle-select" class="block text-sm font-medium text-gray-700 mb-2">
				Select Vehicle
			</label>
			<select
				id="vehicle-select"
				bind:value={vehicleId}
				onchange={e => handleVehicleChange((e.target as HTMLSelectElement).value)}
				class="block w-full max-w-xs rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
			>
				{#each appState.vehicles as vehicle}
					<option value={vehicle.id}>
						{vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
					</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if isLoading}
		<div class="flex items-center justify-center h-64">
			<div class="text-center">
				<Car class="h-8 w-8 text-blue-500 animate-pulse mx-auto mb-4" />
				<p class="text-gray-600">Loading fuel efficiency data...</p>
			</div>
		</div>
	{:else if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-6">
			<div class="flex items-center">
				<div class="text-red-400 text-2xl mr-3">⚠️</div>
				<div>
					<h3 class="text-lg font-medium text-red-800">Error Loading Data</h3>
					<p class="text-red-700">{error}</p>
					<button
						onclick={loadVehicleData}
						class="mt-2 text-sm text-red-600 hover:text-red-500 underline"
					>
						Try again
					</button>
				</div>
			</div>
		</div>
	{:else if !currentVehicle}
		<div class="text-center py-12">
			<Car class="h-12 w-12 text-gray-400 mx-auto mb-4" />
			<h3 class="text-lg font-medium text-gray-900 mb-2">No Vehicle Selected</h3>
			<p class="text-gray-600">Please select a vehicle to view fuel efficiency data.</p>
		</div>
	{:else}
		<!-- Fuel Efficiency Monitor Component -->
		<FuelEfficiencyMonitor
			{vehicleId}
			vehicleName={currentVehicle.nickname ||
				`${currentVehicle.year} ${currentVehicle.make} ${currentVehicle.model}`}
		/>
	{/if}
</div>
