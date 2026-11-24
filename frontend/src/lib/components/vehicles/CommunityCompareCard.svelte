<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { LoaderCircle, Users } from '@lucide/svelte';
	import { routes } from '#lib/routes.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import {
		communityApi,
		type CompareMetric,
		type CompareResult
	} from '#lib/services/community-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { logLoadFailure, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import {
		getDistanceUnitLabel,
		getElectricEfficiencyLabel,
		getFuelEfficiencyLabel
	} from '#lib/utils/units.ts';
	import {
		loadVehicleCatalog,
		suggestCatalogModel,
		type CatalogModel
	} from '#lib/utils/vehicle-catalog.ts';
	import type { UnitPreferences, Vehicle } from '#lib/types/index.ts';

	interface Props {
		vehicle: Vehicle;
		isOwner: boolean;
		onVehicleUpdated?: (_vehicle: Vehicle) => void;
	}

	let { vehicle, isOwner, onVehicleUpdated }: Props = $props();

	const headingId = $props.id();

	function metricLabel(metric: CompareMetric['metric']): string {
		switch (metric) {
			case 'efficiency':
				return vehicle.vehicleType === 'electric' ? 'Efficiency' : 'Fuel efficiency';
			case 'running_cost':
				return 'Running cost';
			case 'maintenance':
				return 'Maintenance per year';
			case 'insurance':
				return 'Insurance per year';
		}
	}

	let result = $state<CompareResult | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let suggestion = $state<{ model: CatalogModel; makeName: string } | null>(null);
	let heading = $state<HTMLElement | null>(null);
	let confirming = $state(false);
	let dismissed = $state(false);

	let dismissKey = $derived(`vroom.community.model-dismissed.${vehicle.id}`);
	let serverOff = $derived(settingsStore.settings?.communityStatsMode === 'off');
	let minGroup = $derived(settingsStore.settings?.communityStatsMinGroup ?? 30);
	let metrics = $derived(result?.metrics ?? []);
	let featureOff = $derived(metrics.length > 0 && metrics.every(m => m.status === 'feature_off'));
	let optInRequired = $derived(metrics.some(m => m.status === 'opt_in_required'));
	let awaitingRefresh = $derived(metrics.some(m => m.status === 'awaiting_refresh'));
	let needsModel = $derived(metrics.some(m => m.status === 'needs_model'));
	let anyOk = $derived(metrics.some(m => m.status === 'ok'));
	let anyTooFew = $derived(metrics.some(m => m.status === 'too_few'));
	let units = $derived<UnitPreferences>(
		result?.units ?? vehicle.unitPreferences ?? settingsStore.unitPreferences
	);

	async function findSuggestion() {
		const catalog = await loadVehicleCatalog().catch(() => null);
		const model = catalog ? suggestCatalogModel(catalog, vehicle.make, vehicle.model) : undefined;
		const makeName = catalog?.makes.find(make => make.id === model?.makeId)?.name;
		return model && makeName ? { model, makeName } : null;
	}

	async function load({ quiet = false } = {}) {
		if (!quiet) loading = true;
		error = null;
		try {
			result = await communityApi.compare(vehicle.id);
			suggestion =
				isOwner && result.metrics.some(m => m.status === 'needs_model')
					? await findSuggestion()
					: null;
		} catch (e) {
			logLoadFailure(e, 'community comparisons');
			error = userFacingErrorMessage(e);
		} finally {
			loading = false;
		}
	}

	async function focusHeading() {
		await tick();
		heading?.focus();
	}

	function readDismissed(): boolean {
		try {
			return localStorage.getItem(dismissKey) === '1';
		} catch {
			return false;
		}
	}

	onMount(() => {
		dismissed = readDismissed();
		if (!serverOff) void load();
	});

	async function confirmModel() {
		if (!suggestion || confirming) return;
		confirming = true;
		try {
			const updated = await vehicleApi.updateVehicle(vehicle.id, {
				catalogModelId: suggestion.model.id
			});
			onVehicleUpdated?.(updated);
			await load({ quiet: true });
			await focusHeading();
		} catch (e) {
			appStore.showError(`Couldn't save the model. ${userFacingErrorMessage(e)}`);
		} finally {
			confirming = false;
		}
	}

	function dismissModel() {
		dismissed = true;
		void focusHeading();
		try {
			localStorage.setItem(dismissKey, '1');
		} catch {
			return;
		}
	}

	function amount(metric: CompareMetric, value: number): string {
		if (metric.unit === 'cents_per_distance') {
			return formatCurrency(value / 100, result?.currency ?? undefined, 2);
		}
		if (metric.unit === 'cents_per_year') {
			return formatCurrency(value / 100, result?.currency ?? undefined, 0);
		}
		return formatNumber(value, 1);
	}

	function suffix(metric: CompareMetric): string {
		switch (metric.unit) {
			case 'distance_per_volume':
				return ` ${getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)}`;
			case 'distance_per_charge':
				return ` ${getElectricEfficiencyLabel(units.distanceUnit, units.chargeUnit)}`;
			case 'cents_per_distance':
				return `/${getDistanceUnitLabel(units.distanceUnit, true)}`;
			case 'cents_per_year':
				return '/yr';
			default:
				return '';
		}
	}

	function format(metric: CompareMetric, value: number): string {
		return `${amount(metric, value)}${suffix(metric)}`;
	}

	function noDataHint(metric: CompareMetric): string {
		if (!isOwner && (metric.metric === 'running_cost' || metric.metric === 'insurance')) {
			return 'Only the owner can compare this.';
		}
		switch (metric.metric) {
			case 'efficiency':
				return 'Log at least 3 fill-ups with odometer readings to compare.';
			case 'running_cost':
				return `Log fuel or maintenance with odometer readings over at least ${units.distanceUnit === 'miles' ? '310 mi' : '500 km'} to compare.`;
			case 'maintenance':
				return 'Comparisons start once this vehicle has a full year of records.';
			case 'insurance':
				return 'Set a region in Settings and keep a full year of insurance to compare.';
		}
	}

	function rangeText(metric: CompareMetric): string {
		const bucket = metric.bucket;
		if (!bucket || metric.yours === null) return '';
		const yoursShown = amount(metric, metric.yours);
		const othersShown = amount(metric, bucket.mean);
		const position =
			yoursShown === othersShown ? 'the same as' : metric.yours > bucket.mean ? 'above' : 'below';
		return `Your ${format(metric, metric.yours)} is ${position} the others' average of ${format(metric, bucket.mean)}`;
	}

	function barGeometry(metric: CompareMetric) {
		const bucket = metric.bucket;
		if (!bucket || metric.yours === null) return null;
		const lo = Math.min(metric.yours, bucket.mean) * 0.8;
		const hi = Math.max(metric.yours, bucket.mean) * 1.2;
		const at = (value: number) => (hi > lo ? ((value - lo) / (hi - lo)) * 100 : 50);
		return { others: at(bucket.mean), yours: at(metric.yours) };
	}
</script>

{#if !serverOff && !featureOff}
	<section aria-labelledby={headingId} class="space-y-4" data-testid="community-compare">
		<div class="flex items-center gap-2">
			<Users class="h-5 w-5 text-muted-foreground" aria-hidden="true" />
			<h2
				id={headingId}
				bind:this={heading}
				tabindex="-1"
				class="text-lg font-semibold rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				Compare with others
			</h2>
		</div>

		{#if loading}
			<div class="space-y-3" data-testid="community-compare-loading">
				{#each [0, 1, 2] as row (row)}
					<Skeleton class="h-10 w-full" />
				{/each}
			</div>
		{:else if error}
			<LoadErrorCard
				compact
				title="Couldn't load community comparisons"
				message={error}
				onRetry={load}
				onRecovered={focusHeading}
				data-testid="community-compare-error"
			/>
		{:else if awaitingRefresh}
			<p class="text-sm text-muted-foreground" data-testid="community-compare-awaiting">
				You're in. Comparisons appear after the next daily refresh includes your vehicles.
			</p>
		{:else if optInRequired}
			<div class="space-y-3" data-testid="community-compare-opt-in">
				<p class="text-sm text-muted-foreground">
					See how {isOwner ? 'your' : 'this'}
					{vehicle.model} compares with other owners on this server.
				</p>
				<Button href={`${resolve(routes.settings)}#community-comparisons`} variant="outline">
					Turn on community stats
				</Button>
			</div>
		{:else}
			{#if needsModel && isOwner && suggestion && !dismissed}
				<div
					class="space-y-3 rounded-lg border bg-muted/40 p-4"
					data-testid="community-compare-needs-model"
				>
					<p class="text-sm font-medium">
						Is this a {suggestion.makeName}
						{suggestion.model.name}?
					</p>
					<div class="flex flex-wrap gap-2">
						<Button size="sm" class="h-10 sm:h-8" onclick={confirmModel} disabled={confirming}>
							{#if confirming}
								<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
							{/if}
							Yes
						</Button>
						<Button
							size="sm"
							variant="outline"
							class="h-10 sm:h-8"
							onclick={dismissModel}
							disabled={confirming}
						>
							No, it's something else
						</Button>
					</div>
				</div>
			{/if}

			<ul class="divide-y rounded-lg border">
				{#each metrics as metric (metric.metric)}
					{#if metric.status !== 'needs_model' || !isOwner || !suggestion || dismissed}
						<li class="space-y-2 p-4" data-testid="community-compare-{metric.metric}">
							<p class="text-sm font-medium">{metricLabel(metric.metric)}</p>
							{#if metric.status === 'ok' && metric.bucket && metric.yours !== null}
								{@const bar = barGeometry(metric)}
								<p class="text-sm">
									You <span class="font-semibold tabular-nums">{format(metric, metric.yours)}</span>
									· Others
									<span class="font-semibold tabular-nums">
										{format(metric, metric.bucket.mean)}
									</span>
									<span class="text-muted-foreground">(average)</span>
									<span class="text-muted-foreground">· about {metric.bucket.n} owners</span>
								</p>
								{#if bar}
									<div
										class="relative h-2 w-full rounded-full bg-muted"
										role="img"
										aria-label={rangeText(metric)}
									>
										<div
											class="absolute inset-y-[-2px] w-0.5 bg-muted-foreground"
											style="left: {bar.others}%"
										></div>
										<div
											class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
											style="left: {bar.yours}%"
										></div>
									</div>
								{/if}
							{:else if metric.status === 'needs_model'}
								<p class="text-sm text-muted-foreground">
									{isOwner
										? 'Pick the model from the list when you edit this vehicle to compare fuel efficiency.'
										: 'Only the owner can compare this.'}
								</p>
							{:else if metric.status === 'not_enough_data'}
								<p class="text-sm text-muted-foreground">
									Not enough owners yet for a reliable average. It shows once more people with a
									similar vehicle have opted in.
								</p>
							{:else if metric.status === 'too_few'}
								<p class="text-sm text-muted-foreground">Not enough owners yet.</p>
							{:else}
								<p class="text-sm text-muted-foreground">{noDataHint(metric)}</p>
							{/if}
						</li>
					{/if}
				{/each}
			</ul>

			{#if anyTooFew}
				<p class="text-xs text-muted-foreground">
					Comparisons appear once about {minGroup} people on this server with a similar vehicle have opted
					in.
				</p>
			{/if}
			{#if anyOk}
				<p class="text-xs text-muted-foreground">
					Updated daily. Anonymous averages from opted-in owners, including you.
				</p>
			{/if}
		{/if}
	</section>
{/if}
