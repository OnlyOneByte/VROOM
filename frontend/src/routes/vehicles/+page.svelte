<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Plus } from '@lucide/svelte';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import NoVehiclesEmptyState from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import SharedWithMeCard from '#lib/components/dashboard/SharedWithMeCard.svelte';
	import { combinePeriodSpend } from '#lib/components/dashboard/dashboard-data.ts';
	import { loadPeriodSpend, type PeriodData } from '#lib/components/dashboard/period-spend.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { shareApi } from '#lib/services/share-api.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { buildVehicleColorMap } from '#lib/utils/chart-colors.ts';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import type { ReceivedShare, Vehicle } from '#lib/types/index.ts';

	let vehicles = $state<Vehicle[]>([]);
	let periodData = $state<PeriodData>({ summaries: [], perDistance: null });
	let odometers = $state(new Map<string, number>());
	let invitations = $state<ReceivedShare[]>([]);
	let invitationsError = $state<string | null>(null);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);

	let owned = $derived(vehicles.filter(v => !v.sharedAccess));
	let shared = $derived(vehicles.filter(v => v.sharedAccess));
	let spend = $derived(combinePeriodSpend(periodData.summaries));
	let perDistance = $derived(
		new Map(
			(periodData.perDistance?.series ?? []).map(series => [series.key, series.values[0] ?? null])
		)
	);
	let colors = $derived(buildVehicleColorMap(vehicles.map(v => v.id)));
	let distanceLabel = $derived(
		getDistanceUnitLabel(settingsStore.unitPreferences.distanceUnit, true)
	);
	let title = $derived(
		isLoading || loadError ? 'Garage' : `${owned.length} vehicle${owned.length === 1 ? '' : 's'}`
	);

	async function fetchInvitations() {
		try {
			invitations = await shareApi.listReceived();
			invitationsError = null;
		} catch (error) {
			invitationsError = userFacingErrorMessage(error);
		}
	}

	async function loadOdometers(list: Vehicle[]) {
		const readings = await Promise.all(
			list.map(v =>
				vehicleApi
					.getVehicleStats(v.id, '30d')
					.then(stats => [v.id, stats.currentOdometer] as const)
					.catch(() => [v.id, null] as const)
			)
		);
		odometers = new Map(
			readings.filter((r): r is readonly [string, number] => typeof r[1] === 'number')
		);
	}

	async function load() {
		isLoading = true;
		loadError = null;
		try {
			const list = await vehicleApi.getVehicles({ includeShared: true });
			const [data] = await Promise.all([
				loadPeriodSpend(
					'30d',
					list.filter(v => v.sharedAccess)
				),
				fetchInvitations()
			]);
			vehicles = list;
			periodData = data;
			void loadOdometers(list);
		} catch (error) {
			loadError = userFacingErrorMessage(error);
		} finally {
			isLoading = false;
		}
	}

	onMount(load);

	function meta(v: Vehicle): string {
		const odometer = odometers.get(v.id);
		return [
			v.nickname ? `${v.year} ${v.make} ${v.model}` : null,
			v.vehicleType === 'electric' ? 'electric' : null,
			v.licensePlate || null,
			odometer !== undefined ? `${formatNumber(odometer, 0)} ${distanceLabel}` : null,
			v.sharedAccess ? `Shared by ${v.sharedAccess.sharedBy}` : null
		]
			.filter(Boolean)
			.join(' · ');
	}

	function running(v: Vehicle): string {
		const value = perDistance.get(v.id);
		return typeof value === 'number'
			? `30 days · ${formatCurrency(value, undefined, 2)}/${distanceLabel}`
			: '30 days';
	}
</script>

<svelte:head>
	<title>Garage - VROOM Car Tracker</title>
	<meta name="description" content="Your vehicles and what each costs to run" />
</svelte:head>

{#snippet vehicleRow(v: Vehicle)}
	<li class="relative flex items-center gap-4 py-4 sm:gap-6" data-testid="garage-row">
		<span
			class="h-13 w-1.5 shrink-0 self-center rounded-full"
			style:background={colors[v.id]}
			aria-hidden="true"
		></span>
		<div class="min-w-0 flex-1">
			<a
				href={resolve(paramRoutes.vehicle, { id: v.id })}
				class="block rounded-sm font-(family-name:--font-fig) text-[30px] leading-none font-bold uppercase break-words outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				{v.nickname || `${v.year} ${v.make} ${v.model}`}
			</a>
			<p class="mt-1 text-sm text-muted-foreground">{meta(v)}</p>
		</div>
		<div class="shrink-0 text-right">
			<p class="font-(family-name:--font-fig) text-[30px] leading-none font-bold tabular-nums">
				{formatCurrency(spend.byVehicle.get(v.id) ?? 0, undefined, 0)}
			</p>
			<p class="mt-1 text-xs font-semibold text-muted-foreground tabular-nums">{running(v)}</p>
		</div>
	</li>
{/snippet}

<div class="mx-auto max-w-5xl space-y-6">
	<PageHeader
		{title}
		description="Running costs over the last 30 days. Open a car for its all-in cost per mile."
	>
		{#snippet actions()}
			{#if !isLoading && !loadError && owned.length > 0}
				<Button size="lg" href={resolve(routes.vehicleNew)}>
					<Plus class="mr-2 h-4 w-4" />
					Add vehicle
				</Button>
			{:else if isLoading}
				<Skeleton class="hidden h-10 sm:block sm:w-36" />
			{/if}
		{/snippet}
	</PageHeader>

	{#if isLoading}
		<div class="space-y-4" aria-hidden="true">
			{#each [0, 1, 2] as i (i)}
				<Skeleton class="h-16 w-full" />
			{/each}
		</div>
	{:else if loadError}
		<LoadErrorCard title="Couldn't load your garage" message={loadError} onRetry={load} />
	{:else}
		{#if owned.length === 0}
			<NoVehiclesEmptyState
				description="Add your first vehicle to see what it costs to run, a mile at a time."
			/>
		{:else}
			<ul class="divide-y divide-border border-b border-border" aria-label="Your vehicles">
				{#each owned as v (v.id)}
					{@render vehicleRow(v)}
				{/each}
			</ul>
		{/if}

		<section aria-labelledby="garage-shared" class="space-y-3">
			<h2 id="garage-shared" class="font-semibold">Shared with you</h2>
			<SharedWithMeCard
				pending={invitations}
				loadError={invitationsError}
				onRetry={fetchInvitations}
				onAccepted={load}
				onDeclined={share => (invitations = invitations.filter(s => s.id !== share.id))}
			/>
			{#if shared.length > 0}
				<ul class="divide-y divide-border" aria-label="Vehicles shared with you">
					{#each shared as v (v.id)}
						{@render vehicleRow(v)}
					{/each}
				</ul>
			{:else if invitations.length === 0 && !invitationsError}
				<p class="text-sm text-muted-foreground">No one has shared a vehicle with you yet.</p>
			{/if}
		</section>
	{/if}
</div>
