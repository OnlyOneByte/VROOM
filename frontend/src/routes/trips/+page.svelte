<script lang="ts">
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { MapPin, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { routes } from '#lib/routes.ts';
	import { tripApi } from '#lib/services/trip-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import type { Trip, TripSummary, Vehicle } from '#lib/types/index.ts';
	import { tripDistance } from '#lib/types/index.ts';
	import {
		capitalize,
		formatCurrency,
		formatDate,
		formatNumber,
		formatNumberUpTo,
		formatRate
	} from '#lib/utils/formatters.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { logLoadFailure, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import HeroFigure from '#lib/components/common/hero-figure.svelte';
	import NoVehiclesEmptyState from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import TripForm from '#lib/components/trips/TripForm.svelte';

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let trips = $state<Trip[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let summary = $state<TripSummary | null>(null);
	let totalCount = $state(0);

	let distLabel = $derived(getDistanceUnitLabel(settingsStore.unitPreferences.distanceUnit, true));
	let loggable = $derived(vehicles.filter(v => v.sharedAccess?.level !== 'viewer'));
	let editable = $derived(new Set(loggable.map(v => v.id)));
	let vehicleNames = $derived(new Map(vehicles.map(v => [v.id, getVehicleDisplayName(v)])));
	let vehicleDistLabels = $derived(
		new Map(
			vehicles.map(v => [
				v.id,
				getDistanceUnitLabel(
					(v.unitPreferences ?? settingsStore.unitPreferences).distanceUnit,
					true
				)
			])
		)
	);
	const tripDistLabel = (vehicleId: string): string =>
		vehicleDistLabels.get(vehicleId) ?? distLabel;

	function route(trip: Trip): string {
		if (!trip.startLocation && !trip.endLocation) return 'Trip';
		return `${trip.startLocation ?? '—'} → ${trip.endLocation ?? '—'}`;
	}

	let formOpen = $state(false);
	let editingTrip = $state<Trip | null>(null);

	function openCreate() {
		editingTrip = null;
		formOpen = true;
	}

	function openEdit(trip: Trip) {
		editingTrip = trip;
		formOpen = true;
	}

	let deleteTarget = $state<Trip | null>(null);
	let deleteOpen = $state(false);
	let keepOdometer = $state(true);

	function openDelete(trip: Trip) {
		deleteTarget = trip;
		keepOdometer = true;
		deleteOpen = true;
	}

	async function confirmDelete() {
		const target = deleteTarget;
		if (!target) return;
		try {
			await tripApi.delete(target.id, keepOdometer);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to delete trip:', error);
			appStore.showError(`Couldn't delete the trip. ${userFacingErrorMessage(error)}`);
			throw error;
		}
		appStore.addNotification({ type: 'success', message: 'Trip deleted' });
		deleteTarget = null;
		await load();
	}

	async function load() {
		isLoading = true;
		loadError = null;
		try {
			const [tripPage, vehicleList, tripSummary] = await Promise.all([
				tripApi.list({ limit: 100 }),
				vehicleApi.getVehicles({ includeShared: true }),
				tripApi.getSummary()
			]);
			trips = tripPage.data;
			totalCount = tripPage.pagination.totalCount;
			vehicles = vehicleList;
			summary = tripSummary;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load trips:', error);
			loadError = userFacingErrorMessage(error);
			logLoadFailure(error, "Couldn't load trips");
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

{#snippet summarySection(s: TripSummary)}
	<Card.Root variant="section" data-testid="trip-summary-card">
		<Card.Header>
			<Card.Title level={2} class="sr-only">Mileage Summary</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-5">
			{#if s.rate > 0}
				<HeroFigure label="Business mileage value" value={formatCurrency(s.businessMileageValue)}>
					{#snippet meta()}
						<span class="tabular-nums">
							{formatNumberUpTo(s.businessDistance, 1)}
							{distLabel} business at {formatRate(s.rate)}/{distLabel}
						</span>
					{/snippet}
				</HeroFigure>
			{:else}
				<HeroFigure
					label="Business distance"
					value="{formatNumberUpTo(s.businessDistance, 1)} {distLabel}"
				>
					{#snippet meta()}
						<a
							href="{resolve(routes.settings)}#business-mileage-rate"
							class="inline-flex min-h-10 items-center rounded-sm font-medium text-accent-ink underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-0"
						>
							Set a mileage rate to see what it’s worth
						</a>
					{/snippet}
				</HeroFigure>
			{/if}
			<dl class="grid grid-cols-3 gap-4">
				<div>
					<dt class="text-xs text-muted-foreground">Trips</dt>
					<dd class="font-(family-name:--font-fig) text-2xl leading-tight font-bold tabular-nums">
						{formatNumber(s.tripCount, 0)}
					</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Total</dt>
					<dd class="font-(family-name:--font-fig) text-2xl leading-tight font-bold tabular-nums">
						{formatNumberUpTo(s.totalDistance, 1)}
						<span class="text-sm font-semibold text-muted-foreground">{distLabel}</span>
					</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Avg / trip</dt>
					<dd class="font-(family-name:--font-fig) text-2xl leading-tight font-bold tabular-nums">
						{formatNumber(s.averageTripDistance, 0)}
						<span class="text-sm font-semibold text-muted-foreground">{distLabel}</span>
					</dd>
				</div>
			</dl>
		</Card.Content>
	</Card.Root>
{/snippet}

{#snippet tripRow(trip: Trip)}
	<li class="flex items-center gap-3 py-3 sm:gap-4" data-testid="trip-card-{trip.id}">
		<div class="min-w-0 flex-1 space-y-1">
			<p class="line-clamp-2 font-semibold break-words">{route(trip)}</p>
			<p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
				<Badge variant={trip.purpose === 'business' ? 'info' : 'secondary'}>
					{capitalize(trip.purpose)}
				</Badge>
				<span class="whitespace-nowrap">{formatDate(trip.tripDate)}</span>
				<span class="max-w-40 truncate">{vehicleNames.get(trip.vehicleId) ?? 'Vehicle'}</span>
			</p>
			{#if trip.note}
				<p class="line-clamp-2 text-sm break-words text-muted-foreground">{trip.note}</p>
			{/if}
		</div>
		<div class="shrink-0 text-right">
			<p class="font-(family-name:--font-fig) text-2xl leading-none font-bold tabular-nums">
				{formatNumber(tripDistance(trip), 0)}
				<span class="text-sm font-semibold text-muted-foreground">
					{tripDistLabel(trip.vehicleId)}
				</span>
			</p>
			<p class="mt-1 text-xs text-muted-foreground tabular-nums">
				{formatNumber(trip.startOdometer, 0)} → {formatNumber(trip.endOdometer, 0)}
			</p>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			{#if editable.has(trip.vehicleId)}
				<Button variant="ghost" size="icon" aria-label="Edit trip" onclick={() => openEdit(trip)}>
					<Pencil class="h-4 w-4" />
				</Button>
			{/if}
			{#if authStore.user?.demo !== true && editable.has(trip.vehicleId)}
				<Button
					variant="ghost"
					size="icon"
					class="text-destructive hover:text-destructive"
					aria-label="Delete trip"
					onclick={() => openDelete(trip)}
				>
					<Trash2 class="h-4 w-4" />
				</Button>
			{/if}
		</div>
	</li>
{/snippet}

<div class="mx-auto max-w-5xl space-y-6">
	<PageHeader title="Trips" description="Track mileage and trips across your vehicles">
		{#snippet actions()}
			{#if !isLoading && !loadError && trips.length > 0 && loggable.length > 0}
				<Button size="lg" onclick={openCreate}>
					<Plus class="mr-2 h-4 w-4" />
					Log Trip
				</Button>
			{:else if isLoading}
				<Skeleton class="h-10 w-full sm:w-36" />
			{/if}
		{/snippet}
	</PageHeader>

	{#if isLoading}
		<div class="space-y-3" aria-hidden="true">
			<Skeleton class="h-32 w-full" />
			{#each Array(3) as _, i (i)}
				<Skeleton class="h-16 w-full" />
			{/each}
		</div>
	{:else if loadError}
		<LoadErrorCard title="Couldn't load trips" message={loadError} onRetry={load} />
	{:else if trips.length === 0 && vehicles.length === 0}
		<NoVehiclesEmptyState
			description="Every trip belongs to a vehicle. Add one, then log trips with their start and end odometer."
		/>
	{:else if trips.length === 0}
		<EmptyState>
			{#snippet icon()}
				<MapPin class="mb-4 h-12 w-12 text-muted-foreground" />
			{/snippet}
			{#snippet title()}
				No trips yet
			{/snippet}
			{#snippet description()}
				Log trips with their start and end odometer and a purpose (business, personal, commute) to
				build a mileage-reimbursement report and feed your vehicle's odometer history.
			{/snippet}
			{#snippet action()}
				{#if loggable.length > 0}
					<Button size="lg" onclick={openCreate}>
						<Plus class="mr-2 h-4 w-4" />
						Log Trip
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		{#if summary}
			{@render summarySection(summary)}
		{/if}

		<Card.Root variant="section">
			<Card.Header>
				<Card.Title level={2} class="text-base">
					{formatNumber(totalCount, 0)} trip{totalCount === 1 ? '' : 's'}
				</Card.Title>
			</Card.Header>
			<Card.Content>
				<ul class="divide-y divide-border" role="list">
					{#each trips as trip (trip.id)}
						{@render tripRow(trip)}
					{/each}
				</ul>
				{#if trips.length < totalCount}
					<p
						class="pt-3 text-center text-sm text-muted-foreground"
						data-testid="trip-list-truncation"
					>
						Showing {formatNumber(trips.length, 0)} of {formatNumber(totalCount, 0)} trips
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	<TripForm bind:open={formOpen} vehicles={loggable} trip={editingTrip} onSaved={load} />

	<ConfirmDialog
		bind:open={deleteOpen}
		title="Delete this trip?"
		description="This removes the trip from your mileage log. This cannot be undone."
		confirmLabel="Delete Trip"
		onConfirm={confirmDelete}
	>
		<label class="flex items-start gap-3 rounded-md border border-border-strong p-3 text-sm">
			<Checkbox bind:checked={keepOdometer} aria-label="Keep the linked odometer reading" />
			<span>
				<span class="font-medium">Keep the linked odometer reading</span>
				<span class="block text-muted-foreground">
					This trip added a reading to the vehicle's odometer history. Leave this checked to keep
					it, or uncheck to remove that reading too.
				</span>
			</span>
		</label>
	</ConfirmDialog>
</div>
