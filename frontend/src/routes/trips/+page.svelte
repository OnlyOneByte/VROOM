<script lang="ts">
	import { onMount } from 'svelte';
	import { Car, CircleAlert, MapPin, Route } from '@lucide/svelte';
	import { tripApi } from '$lib/services/trip-api';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import type { Trip, TripSummary, Vehicle } from '$lib/types';
	import { tripDistance } from '$lib/types';
	import { capitalize, formatDate } from '$lib/utils/formatters';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { getDistanceUnitLabel } from '$lib/utils/units';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { appStore } from '$lib/stores/app.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as CardNs from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import PageHeader from '$lib/components/common/page-header.svelte';

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let trips = $state<Trip[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let summary = $state<TripSummary | null>(null);
	// Total trips across all pages (the summary counts ALL trips, so the list must not silently show only
	// page 1 while the summary says more — the dashboard/expenses "page-1-masquerades-as-all" class).
	let totalCount = $state(0);

	let distLabel = $derived(getDistanceUnitLabel(settingsStore.unitPreferences.distanceUnit, true));
	// vehicleId -> display name, so each trip card can name its vehicle (graceful fallback if deleted).
	let vehicleNames = $derived(
		new Map(vehicles.map((v) => [v.id, getVehicleDisplayName(v)]))
	);

	async function load() {
		isLoading = true;
		loadError = null;
		try {
			// Request the max page (100) so the read-only list shows as much as one fetch allows; the
			// "Showing N of M" footer below surfaces any remainder rather than silently truncating (a full
			// paginator lands with the T6b-2 form cycle). The summary counts ALL trips regardless.
			const [tripPage, vehicleList, tripSummary] = await Promise.all([
				tripApi.list({ limit: 100 }),
				vehicleApi.getVehicles(),
				tripApi.getSummary()
			]);
			trips = tripPage.data;
			totalCount = tripPage.pagination.totalCount;
			vehicles = vehicleList;
			summary = tripSummary;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load trips:', error);
			// Persist the failure so we don't fall through to the "No trips yet" empty state — that
			// masquerades a fetch failure as "you have none" (the dashboard/reminders load-error discipline).
			loadError = error instanceof Error ? error.message : 'Failed to load trips';
			appStore.addNotification({ type: 'error', message: 'Failed to load trips' });
		} finally {
			isLoading = false;
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Trips - VROOM Car Tracker</title>
	<meta name="description" content="Track and manage your vehicle trips" />
</svelte:head>

<div class="space-y-6">
	<PageHeader title="Trips" description="Track mileage and trips across your vehicles" />

	{#if isLoading}
		<div class="space-y-3">
			<Skeleton class="h-28 w-full" />
			{#each Array(3) as _, i (i)}
				<Skeleton class="h-24 w-full" />
			{/each}
		</div>
	{:else if loadError}
		<div class="rounded-lg border bg-card p-6">
			<div class="mb-4 flex items-center gap-3 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Failed to load trips</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
			<button
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
				onclick={load}>Retry</button
			>
		</div>
	{:else if trips.length === 0}
		<EmptyState>
			{#snippet icon()}
				<MapPin class="h-12 w-12 text-muted-foreground mb-4" />
			{/snippet}
			{#snippet title()}
				No trips yet
			{/snippet}
			{#snippet description()}
				Log trips with their start and end odometer and a purpose (business, personal, commute) to
				build a mileage-reimbursement report and feed your vehicle's odometer history.
			{/snippet}
		</EmptyState>
	{:else}
		<!-- Mileage-summary card (R4): the reimbursement rollup across the listed trips. -->
		{#if summary}
			<CardNs.Card data-testid="trip-summary-card">
				<CardNs.CardHeader class="p-4 sm:p-6">
					<CardNs.CardTitle class="flex items-center gap-2 text-base sm:text-lg">
						<Route class="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
						Mileage Summary
					</CardNs.CardTitle>
				</CardNs.CardHeader>
				<CardNs.CardContent class="grid grid-cols-2 gap-4 p-4 pt-0 sm:grid-cols-4 sm:p-6 sm:pt-0">
					<div>
						<p class="text-xs text-muted-foreground">Total</p>
						<p class="text-lg font-semibold">
							{summary.totalMiles.toLocaleString()} <span class="text-sm font-normal">{distLabel}</span>
						</p>
					</div>
					<div>
						<p class="text-xs text-muted-foreground">Trips</p>
						<p class="text-lg font-semibold">{summary.tripCount}</p>
					</div>
					<div>
						<p class="text-xs text-muted-foreground">Business</p>
						<p class="text-lg font-semibold">
							{summary.businessMiles.toLocaleString()}
							<span class="text-sm font-normal">{distLabel}</span>
						</p>
					</div>
					<div>
						<p class="text-xs text-muted-foreground">Avg / trip</p>
						<p class="text-lg font-semibold">
							{Math.round(summary.averageTripMiles).toLocaleString()}
							<span class="text-sm font-normal">{distLabel}</span>
						</p>
					</div>
				</CardNs.CardContent>
			</CardNs.Card>
		{/if}

		<div class="space-y-3">
			{#each trips as trip (trip.id)}
				<CardNs.Card data-testid="trip-card-{trip.id}">
					<CardNs.CardContent class="flex items-start justify-between gap-4 py-4">
						<div class="min-w-0 space-y-1">
							<div class="flex items-center gap-2">
								<Badge variant="secondary">{capitalize(trip.purpose)}</Badge>
								<span class="text-sm text-muted-foreground">{formatDate(trip.tripDate)}</span>
							</div>
							<p class="font-medium">
								{tripDistance(trip).toLocaleString()}
								{distLabel}
								<span class="text-sm font-normal text-muted-foreground">
									({trip.startOdometer.toLocaleString()} → {trip.endOdometer.toLocaleString()})
								</span>
							</p>
							{#if trip.startLocation || trip.endLocation}
								<p class="flex items-center gap-1 text-sm text-muted-foreground">
									<MapPin class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
									{trip.startLocation ?? '—'} → {trip.endLocation ?? '—'}
								</p>
							{/if}
							{#if trip.note}
								<p class="text-sm text-muted-foreground">{trip.note}</p>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
							<Car class="h-4 w-4" aria-hidden="true" />
							<span class="truncate">{vehicleNames.get(trip.vehicleId) ?? 'Vehicle'}</span>
						</div>
					</CardNs.CardContent>
				</CardNs.Card>
			{/each}
		</div>

		<!-- Surface any trips beyond this page (the list requests up to 100; the summary counts ALL). Without
		     this, a >100-trip user would see the summary count exceed the visible cards with no explanation. -->
		{#if trips.length < totalCount}
			<p class="text-center text-sm text-muted-foreground" data-testid="trip-list-truncation">
				Showing {trips.length.toLocaleString()} of {totalCount.toLocaleString()} trips
			</p>
		{/if}
	{/if}
</div>
