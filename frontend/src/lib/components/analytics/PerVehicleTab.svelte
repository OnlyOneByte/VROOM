<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { LoaderCircle, SearchX } from '@lucide/svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Progress } from '#lib/components/ui/progress/index.ts';
	import { analyticsApi, getDefaultDateRange } from '#lib/services/analytics-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { AppPieChart } from '#lib/components/charts/index.ts';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import { buildCategoryPieData } from '#lib/utils/chart-colors.ts';
	import type {
		Vehicle,
		VehicleHealthResponse,
		VehicleTCOResponse,
		VehicleExpensesResponse
	} from '#lib/types/index.ts';
	import { formatCurrency, formatNumberUpTo } from '#lib/utils/formatters.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { getCostPerDistanceLabel, getDistanceUnitLabel } from '#lib/utils/units.ts';
	import type { AnalyticsDateRange } from './analytics-filters';

	interface Props {
		dateRange?: AnalyticsDateRange;
		preferredVehicleId?: string;
		filterLabel?: string;
		onClearFilters?: () => void;
	}

	let {
		dateRange = getDefaultDateRange(),
		preferredVehicleId,
		filterLabel,
		onClearFilters
	}: Props = $props();

	let vehicles = $state<Vehicle[]>([]);
	let selectedVehicleId = $state<string>('');
	let health = $state<VehicleHealthResponse | null>(null);
	let tco = $state<VehicleTCOResponse | null>(null);
	let expenses = $state<VehicleExpensesResponse | null>(null);
	let isLoadingVehicles = $state(true);
	let isLoadingData = $state(false);
	let error = $state<string | null>(null);
	let request = 0;
	let vehiclesLoadError = $state<string | null>(null);

	async function loadVehicles() {
		try {
			isLoadingVehicles = true;
			vehicles = await vehicleApi.getVehicles();
			vehiclesLoadError = null;
		} catch (e) {
			vehiclesLoadError = userFacingErrorMessage(e);
		} finally {
			isLoadingVehicles = false;
		}
	}

	async function loadVehicleData(vehicleId: string) {
		const current = ++request;
		try {
			isLoadingData = true;
			const [healthData, tcoData, expensesData] = await Promise.all([
				analyticsApi.getVehicleHealth(vehicleId),
				analyticsApi.getVehicleTCO(vehicleId),
				analyticsApi.getVehicleExpenses(vehicleId, dateRange)
			]);
			if (current !== request) return;
			health = healthData;
			tco = tcoData;
			expenses = expensesData;
			error = null;
		} catch (e) {
			if (current !== request) return;
			error = userFacingErrorMessage(e);
		} finally {
			if (current === request) isLoadingData = false;
		}
	}

	function handleVehicleChange(value: string | undefined) {
		if (value) {
			selectedVehicleId = value;
			error = null;
		}
	}

	onMount(() => {
		loadVehicles();
	});

	$effect(() => {
		if (isLoadingVehicles || vehicles.length === 0) return;
		const preferred = vehicles.find(v => v.id === preferredVehicleId)?.id;
		selectedVehicleId = untrack(
			() =>
				preferred ??
				(vehicles.some(v => v.id === selectedVehicleId) ? selectedVehicleId : vehicles[0]!.id)
		);
	});

	$effect(() => {
		void dateRange.startDate;
		void dateRange.endDate;
		if (selectedVehicleId) untrack(() => void loadVehicleData(selectedVehicleId));
	});

	let selectedVehicle = $derived(vehicles.find(v => v.id === selectedVehicleId));

	let units = $derived(selectedVehicle?.unitPreferences ?? settingsStore.unitPreferences);
	let costPerDistLabel = $derived(getCostPerDistanceLabel(units.distanceUnit));
	let distLongLabel = $derived(getDistanceUnitLabel(units.distanceUnit));

	// Tier colours fail WCAG contrast as text on their tint; the ring and a label carry the tier.
	function getScoreBgColor(score: number): string {
		if (score >= 70) return 'bg-chart-2/10';
		if (score >= 40) return 'bg-chart-5/10';
		return 'bg-destructive/10';
	}

	function getScoreLabel(score: number): string {
		if (score >= 70) return 'Good';
		if (score >= 40) return 'Fair';
		return 'Needs attention';
	}

	let tcoSummaryItems = $derived.by(() => {
		if (!tco) return [];
		return [
			{ label: 'Total Cost', value: formatCurrency(tco.totalCost) },
			{
				label: costPerDistLabel,
				value: tco.costPerDistance != null ? formatCurrency(tco.costPerDistance) : 'N/A'
			},
			{ label: 'Cost per Month', value: formatCurrency(tco.costPerMonth) },
			{ label: `Total ${distLongLabel}`, value: formatNumberUpTo(tco.totalDistance, 1) }
		];
	});

	let expensePieData = $derived(buildCategoryPieData(expenses?.expenseBreakdown ?? []));
</script>

{#if isLoadingVehicles && !vehiclesLoadError}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if vehiclesLoadError}
	<LoadErrorCard
		title="Couldn't load your vehicles"
		message={vehiclesLoadError}
		onRetry={loadVehicles}
	/>
{:else if vehicles.length === 0}
	<div class="rounded-lg border bg-card p-6 text-center">
		<p class="text-muted-foreground mb-4">No vehicles found. Add a vehicle to see analytics.</p>
		<Button href={resolve(routes.vehicleNew)}>Add Vehicle</Button>
	</div>
{:else}
	<div class="space-y-6">
		<Card.Root>
			<Card.Header>
				<Card.Title>Select Vehicle</Card.Title>
				<Card.Description>Choose a vehicle to view detailed analytics</Card.Description>
			</Card.Header>
			<Card.Content>
				<Select.Root type="single" value={selectedVehicleId} onValueChange={handleVehicleChange}>
					<Select.Trigger aria-label="Select vehicle" class="w-full">
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

		{#if isLoadingData && !error}
			<div class="flex justify-center p-12">
				<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		{:else if error}
			<LoadErrorCard
				title="Couldn't load vehicle analytics"
				message={error}
				onRetry={() => selectedVehicleId && loadVehicleData(selectedVehicleId)}
			/>
		{:else if health && tco && expenses}
			<Card.Root>
				<Card.Header>
					<Card.Title>Vehicle Health Score</Card.Title>
					<Card.Description>{health.vehicleName}</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="space-y-6">
						<div class="flex items-center gap-4">
							<div
								class="flex h-20 w-20 items-center justify-center rounded-full {getScoreBgColor(
									health.overallScore
								)}"
							>
								<span class="text-3xl font-bold text-foreground">
									{health.overallScore}
								</span>
							</div>
							<div>
								<p class="text-sm text-muted-foreground">Overall Score</p>
								<p class="text-lg font-medium">{getScoreLabel(health.overallScore)} · out of 100</p>
							</div>
						</div>

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

			{#if filterLabel}
				<p class="text-sm text-muted-foreground">
					The health score and totals cover this car's whole history. The breakdown below follows
					the date range.
				</p>
			{/if}

			<StatCardGrid items={tcoSummaryItems} columns={4} />

			{#if filterLabel && onClearFilters && expensePieData.length === 0}
				<EmptyState level={3}>
					{#snippet icon()}
						<div class="mb-4 rounded-full bg-muted p-4">
							<SearchX class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
						</div>
					{/snippet}
					{#snippet title()}No expenses for {filterLabel}{/snippet}
					{#snippet description()}
						This car has no expenses in the chosen dates. Try a longer date range.
					{/snippet}
					{#snippet action()}
						<Button variant="outline" onclick={onClearFilters}>Clear filters</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<AppPieChart
					title="Expense Breakdown"
					description="Category distribution"
					data={expensePieData}
				/>
			{/if}
		{/if}
	</div>
{/if}
