<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { MapPin } from '@lucide/svelte';
	import { routes } from '#lib/routes.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { tripApi } from '#lib/services/trip-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { capitalize, formatDate, formatNumber } from '#lib/utils/formatters.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import type { Trip } from '#lib/types/index.ts';
	import { tripDistance } from '#lib/types/trip.ts';
	import type { DistanceUnit } from '#lib/types/settings.ts';

	interface Props {
		vehicleId: string;
		distanceUnit: DistanceUnit;
	}

	let { vehicleId, distanceUnit }: Props = $props();

	const TRIP_LIMIT = 100;

	let trips = $state<Trip[]>([]);
	let totalCount = $state(0);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);

	let unit = $derived(getDistanceUnitLabel(distanceUnit, true));

	async function load() {
		isLoading = true;
		loadError = null;
		try {
			const page = await tripApi.list({ vehicleId, limit: TRIP_LIMIT });
			trips = page.data;
			totalCount = page.pagination.totalCount;
		} catch (error) {
			loadError = userFacingErrorMessage(error);
		} finally {
			isLoading = false;
		}
	}

	let loadingMore = $state(false);

	async function loadMore() {
		loadingMore = true;
		try {
			const next = await tripApi.list({ vehicleId, limit: TRIP_LIMIT, offset: trips.length });
			const shown = new Set(trips.map(t => t.id));
			trips = [...trips, ...next.data.filter(t => !shown.has(t.id))];
			totalCount = next.pagination.totalCount;
		} catch (error) {
			appStore.showError(`Couldn't load more trips. ${userFacingErrorMessage(error)}`);
		} finally {
			loadingMore = false;
		}
	}

	onMount(load);

	function route(trip: Trip): string {
		if (trip.startLocation && trip.endLocation)
			return `${trip.startLocation} → ${trip.endLocation}`;
		return trip.startLocation || trip.endLocation || 'Trip';
	}
</script>

{#if isLoading}
	<div class="space-y-3" aria-hidden="true">
		{#each [0, 1, 2] as i (i)}
			<Skeleton class="h-14 w-full" />
		{/each}
	</div>
{:else if loadError}
	<LoadErrorCard title="Couldn't load this car's trips" message={loadError} onRetry={load} />
{:else if trips.length === 0}
	<EmptyState level={2}>
		{#snippet icon()}
			<MapPin class="mb-4 h-12 w-12 text-muted-foreground" />
		{/snippet}
		{#snippet title()}
			No trips for this car yet
		{/snippet}
		{#snippet description()}
			Log business miles on the Trips page and they show here too.
		{/snippet}
		{#snippet action()}
			<a
				href={resolve(routes.trips)}
				class="text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
			>
				Go to Trips
			</a>
		{/snippet}
	</EmptyState>
{:else}
	<Card.Root variant="section" data-testid="vehicle-trips">
		<Card.Header class="flex flex-row items-center justify-between gap-3">
			<Card.Title level={2} class="text-base">
				{totalCount} trip{totalCount === 1 ? '' : 's'}
				{#if totalCount > trips.length}
					<span class="font-normal text-muted-foreground"> · latest {trips.length}</span>
				{/if}
			</Card.Title>
			<a
				href={resolve(routes.trips)}
				class="-my-1 -mr-2 inline-flex min-h-7 items-center rounded-sm px-2 text-sm font-semibold text-accent-ink outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				All trips
			</a>
		</Card.Header>
		<Card.Content>
			<ul class="divide-y divide-border" role="list">
				{#each trips as trip (trip.id)}
					<li class="flex items-center justify-between gap-4 py-3">
						<div class="min-w-0">
							<p class="truncate font-semibold">{route(trip)}</p>
							<p class="text-sm text-muted-foreground">
								{formatDate(trip.tripDate)} · {capitalize(trip.purpose)}
							</p>
						</div>
						<p class="shrink-0 font-semibold tabular-nums">
							{formatNumber(tripDistance(trip), 0)}
							{unit}
						</p>
					</li>
				{/each}
			</ul>
			{#if trips.length < totalCount}
				<div class="flex justify-center pt-3">
					<Button variant="outline" size="lg" disabled={loadingMore} onclick={loadMore}>
						{loadingMore ? 'Loading…' : 'Load more trips'}
					</Button>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
{/if}
