<script lang="ts">
	import { onMount } from 'svelte';
	import { LoaderCircle, CircleAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Progress } from '$lib/components/ui/progress';
	import { analyticsApi, getDefaultDateRange } from '$lib/services/analytics-api';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { AppPieChart, StatCardGrid } from '$lib/components/charts';
	import { buildCategoryPieData } from '$lib/utils/chart-colors';
	import type {
		Vehicle,
		VehicleHealthResponse,
		VehicleTCOResponse,
		VehicleExpensesResponse
	} from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { getCostPerDistanceLabel, getDistanceUnitLabel } from '$lib/utils/units';

	let vehicles = $state<Vehicle[]>([]);
	let selectedVehicleId = $state<string>('');
	let health = $state<VehicleHealthResponse | null>(null);
	let tco = $state<VehicleTCOResponse | null>(null);
	let expenses = $state<VehicleExpensesResponse | null>(null);
	let isLoadingVehicles = $state(true);
	let isLoadingData = $state(false);
	let error = $state<string | null>(null);

	async function loadVehicles() {
		try {
			isLoadingVehicles = true;
			vehicles = await vehicleApi.getVehicles();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load vehicles';
		} finally {
			isLoadingVehicles = false;
		}
	}

	async function loadVehicleData(vehicleId: string) {
		try {
			isLoadingData = true;
			error = null;
			const [healthData, tcoData, expensesData] = await Promise.all([
				analyticsApi.getVehicleHealth(vehicleId),
				analyticsApi.getVehicleTCO(vehicleId),
				analyticsApi.getVehicleExpenses(vehicleId, getDefaultDateRange())
			]);
			health = healthData;
			tco = tcoData;
			expenses = expensesData;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load vehicle data';
		} finally {
			isLoadingData = false;
		}
	}

	function handleVehicleChange(value: string | undefined) {
		if (value) {
			selectedVehicleId = value;
			loadVehicleData(value);
		}
	}

	onMount(() => {
		loadVehicles();
	});

	// After vehicles load, auto-select the first vehicle
	$effect(() => {
		if (!isLoadingVehicles && vehicles.length > 0 && !selectedVehicleId) {
			const id = vehicles[0]!.id;
			selectedVehicleId = id;
			void loadVehicleData(id);
		}
	});

	let selectedVehicle = $derived(vehicles.find(v => v.id === selectedVehicleId));

	// Dynamic unit labels — per-vehicle view uses selected vehicle's unit preferences
	let units = $derived(selectedVehicle?.unitPreferences ?? settingsStore.unitPreferences);
	let costPerDistLabel = $derived(getCostPerDistanceLabel(units.distanceUnit));
	let distLongLabel = $derived(getDistanceUnitLabel(units.distanceUnit));

	// --- Health Score ---
	function getScoreColor(score: number): string {
		if (score >= 70) return 'text-chart-2';
		if (score >= 40) return 'text-chart-5';
		return 'text-destructive';
	}

	function getScoreBgColor(score: number): string {
		if (score >= 70) return 'bg-chart-2/10';
		if (score >= 40) return 'bg-chart-5/10';
		return 'bg-destructive/10';
	}

	// --- TCO Summary Stat Cards ---
	let tcoSummaryItems = $derived.by(() => {
		if (!tco) return [];
		return [
			{ label: 'Total Cost', value: formatCurrency(tco.totalCost) },
			{
				label: costPerDistLabel,
				value: tco.costPerDistance != null ? formatCurrency(tco.costPerDistance) : 'N/A'
			},
			{ label: 'Cost per Month', value: formatCurrency(tco.costPerMonth) },
			{ label: `Total ${distLongLabel}`, value: tco.totalDistance.toLocaleString() }
		];
	});

	// --- Expense Category Breakdown → AppPieChart ---
	let expensePieData = $derived(buildCategoryPieData(expenses?.expenseBreakdown ?? []));
</script>

{#if isLoadingVehicles}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if vehicles.length === 0}
	<div class="rounded-lg border bg-card p-6 text-center">
		<p class="text-muted-foreground mb-4">No vehicles found. Add a vehicle to see analytics.</p>
		<Button href="/vehicles/new">Add Vehicle</Button>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Vehicle Selector -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Select Vehicle</Card.Title>
				<Card.Description>Choose a vehicle to view detailed analytics</Card.Description>
			</Card.Header>
			<Card.Content>
				<Select.Root type="single" value={selectedVehicleId} onValueChange={handleVehicleChange}>
					<Select.Trigger class="w-full">
						{#if selectedVehicle}
							{selectedVehicle.year}
							{selectedVehicle.make}
							{selectedVehicle.model}
						{:else}
							Select a vehicle
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each vehicles as vehicle (vehicle.id)}
							<Select.Item value={vehicle.id} label="{vehicle.year} {vehicle.make} {vehicle.model}">
								{vehicle.year}
								{vehicle.make}
								{vehicle.model}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Card.Content>
		</Card.Root>

		{#if isLoadingData}
			<div class="flex justify-center p-12">
				<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		{:else if error}
			<div class="rounded-lg border bg-card p-6">
				<div class="flex items-center gap-3 text-destructive mb-4">
					<CircleAlert class="h-5 w-5" />
					<p class="font-medium">Failed to load vehicle analytics</p>
				</div>
				<p class="text-sm text-muted-foreground mb-4">{error}</p>
				<Button onclick={() => selectedVehicleId && loadVehicleData(selectedVehicleId)}>
					Retry
				</Button>
			</div>
		{:else if health && tco && expenses}
			<!-- Section 1: Vehicle Health Score -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Vehicle Health Score</Card.Title>
					<Card.Description>{health.vehicleName}</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="space-y-6">
						<!-- Overall Score Badge -->
						<div class="flex items-center gap-4">
							<div
								class="flex h-20 w-20 items-center justify-center rounded-full {getScoreBgColor(
									health.overallScore
								)}"
							>
								<span class="text-3xl font-bold {getScoreColor(health.overallScore)}">
									{health.overallScore}
								</span>
							</div>
							<div>
								<p class="text-sm text-muted-foreground">Overall Score</p>
								<p class="text-lg font-medium">out of 100</p>
							</div>
						</div>

						<!-- Sub-scores with Progress bars -->
						<div class="grid gap-5 md:grid-cols-3">
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Maintenance Regularity</span>
									<span class="text-sm font-bold">{health.maintenanceRegularity}/100</span>
								</div>
								<Progress value={health.maintenanceRegularity} max={100} class="h-2" />
							</div>
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Mileage Adherence</span>
									<span class="text-sm font-bold">{health.mileageIntervalAdherence}/100</span>
								</div>
								<Progress value={health.mileageIntervalAdherence} max={100} class="h-2" />
							</div>
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Insurance Coverage</span>
									<span class="text-sm font-bold">{health.insuranceCoverage}/100</span>
								</div>
								<Progress value={health.insuranceCoverage} max={100} class="h-2" />
							</div>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Section 2: TCO Dashboard -->
			<StatCardGrid items={tcoSummaryItems} columns={4} />

			<!-- Expense Category Breakdown (migrated to AppPieChart) -->
			<AppPieChart
				title="Expense Breakdown"
				description="Category distribution"
				data={expensePieData}
			/>
		{/if}
	</div>
{/if}
