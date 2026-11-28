<script module lang="ts">
	import type { AnyScale } from '#lib/components/charts/index.ts';
	import {
		fittedTimeTicks,
		formatDateTick,
		monthlyXAxisProps
	} from '#lib/utils/chart-formatters.ts';

	const DAY_TICKS_MAX_SPAN_MS = 90 * 24 * 60 * 60 * 1000;
	const MAX_X_TICKS = 4;

	export function mileageYDomain(values: number[]): [number, number] {
		const min = Math.min(...values);
		const max = Math.max(...values);
		const pad = max > min ? (max - min) * 0.1 : Math.max(max * 0.01, 1);
		return [Math.max(0, min - pad), max + pad];
	}

	export function mileageXAxisProps(dates: Date[]) {
		const times = dates.map(d => d.getTime());
		const span = Math.max(...times) - Math.min(...times);
		const format = span < DAY_TICKS_MAX_SPAN_MS ? formatDateTick : monthlyXAxisProps(0).format;
		const count = Math.min(dates.length, MAX_X_TICKS);
		return {
			format,
			ticks: (scale: AnyScale) => {
				const ticks = fittedTimeTicks(count, format)(scale);
				const labels = ticks.map(format);
				return ticks.filter((_tick, i) => i === 0 || labels[i] !== labels[i - 1]);
			}
		};
	}
</script>

<script lang="ts">
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { cn } from '#lib/utils.js';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { paramRoutes } from '#lib/routes.ts';
	import { Plus, LoaderCircle, Gauge, ChevronLeft, ChevronRight, Trash2 } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import type { ChartConfig } from '#lib/components/ui/chart/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { AppLineChart } from '#lib/components/charts/index.ts';
	import { formatDayLabel, unitTooltip } from '#lib/utils/chart-formatters.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { odometerApi } from '#lib/services/odometer-api.ts';
	import { odometerHistoryApi } from '#lib/services/odometer-history-api.ts';
	import { formatDate, formatNumber } from '#lib/utils/formatters.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type {
		OdometerHistoryEntry,
		PaginatedResponse,
		UnitPreferences
	} from '#lib/types/index.ts';

	const PAGE_SIZE = 20;
	const CHART_READING_LIMIT = 100;
	const MIN_CHART_POINTS = 2;

	let {
		vehicleId,
		unitPreferences,
		canWrite = true
	}: { vehicleId: string; unitPreferences?: UnitPreferences; canWrite?: boolean } = $props();

	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);
	let distLabel = $derived(getDistanceUnitLabel(units.distanceUnit, true));

	let entries = $state<OdometerHistoryEntry[]>([]);
	let chartEntries = $state<OdometerHistoryEntry[]>([]);
	let chartIsCapped = $state(false);
	let chartError = $state<string | null>(null);
	let totalCount = $state(0);
	let offset = $state(0);
	let isLoading = $state(true);
	let isPageLoading = $state(false);
	let error = $state<string | null>(null);

	let deleteDialogOpen = $state(false);
	let deletingEntry = $state<OdometerHistoryEntry | null>(null);
	let isDeleting = $state(false);
	let deleteError = $state<string | null>(null);

	let currentPage = $derived(Math.floor(offset / PAGE_SIZE) + 1);
	let totalPages = $derived(Math.max(1, Math.ceil(totalCount / PAGE_SIZE)));
	let hasPrevious = $derived(offset > 0);
	let hasNext = $derived(offset + entries.length < totalCount);

	let chartData = $derived(
		chartEntries
			.filter(e => e.recordedAt)
			.map(e => ({
				date: new Date(e.recordedAt),
				odometer: e.odometer
			}))
			.sort((a, b) => a.date.getTime() - b.date.getTime())
	);

	const chartConfig: ChartConfig = {
		odometer: {
			label: 'Odometer',
			color: 'var(--chart-1)'
		}
	};

	const series = [
		{
			key: 'odometer',
			label: 'Odometer',
			color: 'var(--chart-1)'
		}
	];

	onMount(async () => {
		await loadAll(0);
		isLoading = false;
	});

	async function loadAll(listOffset: number) {
		await Promise.all([loadEntries(listOffset), loadChartEntries()]);
	}

	async function loadChartEntries() {
		try {
			const response = await odometerHistoryApi.getHistory(vehicleId, {
				limit: CHART_READING_LIMIT,
				offset: 0
			});
			chartEntries = response.data;
			chartIsCapped = response.pagination.totalCount > response.data.length;
			chartError = null;
		} catch (e) {
			chartEntries = [];
			chartIsCapped = false;
			chartError = userFacingErrorMessage(e);
		}
	}

	async function loadEntries(newOffset: number) {
		isPageLoading = true;
		error = null;
		try {
			const response: PaginatedResponse<OdometerHistoryEntry> = await odometerHistoryApi.getHistory(
				vehicleId,
				{ limit: PAGE_SIZE, offset: newOffset }
			);
			entries = response.data;
			totalCount = response.pagination.totalCount;
			offset = response.pagination.offset;
		} catch (e) {
			error = userFacingErrorMessage(e);
		} finally {
			isPageLoading = false;
		}
	}

	function goToPreviousPage() {
		if (hasPrevious) {
			loadEntries(Math.max(0, offset - PAGE_SIZE));
		}
	}

	function goToNextPage() {
		if (hasNext) {
			loadEntries(offset + PAGE_SIZE);
		}
	}

	let latest = $derived(chartEntries[0] ?? (offset === 0 ? entries[0] : undefined));

	function formatOdometer(value: number): string {
		return formatNumber(value, 0);
	}

	function gainSince(index: number): number | null {
		const older = entries[index + 1];
		const entry = entries[index];
		if (!older || !entry) return null;
		const gain = entry.odometer - older.odometer;
		return gain > 0 ? gain : null;
	}

	function rowHref(entry: OdometerHistoryEntry): string {
		const returnTo = `?returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`;
		return entry.source === 'expense'
			? resolve(paramRoutes.expenseEdit, { id: entry.sourceId }) + returnTo
			: resolve(paramRoutes.vehicleOdometerEntryEdit, {
					id: vehicleId,
					entryId: entry.sourceId
				}) + returnTo;
	}

	function openDeleteDialog(entry: OdometerHistoryEntry) {
		deletingEntry = entry;
		deleteError = null;
		deleteDialogOpen = true;
	}

	async function handleDelete() {
		if (!deletingEntry) return;
		isDeleting = true;
		deleteError = null;
		try {
			await odometerApi.delete(deletingEntry.sourceId);
			deleteDialogOpen = false;
			deletingEntry = null;
			await loadAll(offset);
		} catch (e) {
			deleteError = `Couldn't delete the reading. ${userFacingErrorMessage(e)}`;
		} finally {
			isDeleting = false;
		}
	}
</script>

{#if isLoading}
	<div class="flex justify-center p-8">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if error && entries.length === 0}
	<EmptyState>
		{#snippet icon()}
			<Gauge class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			Couldn't load odometer readings
		{/snippet}
		{#snippet description()}
			{error}
		{/snippet}
		{#snippet action()}
			<Button variant="outline" onclick={() => loadAll(0)}>Retry</Button>
		{/snippet}
	</EmptyState>
{:else if totalCount === 0}
	<EmptyState>
		{#snippet icon()}
			<Gauge class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			No odometer readings yet
		{/snippet}
		{#snippet description()}
			Track your vehicle's mileage by adding odometer readings manually or through expenses with
			mileage.
		{/snippet}
		{#snippet action()}
			{#if canWrite}
				<Button href={resolve(paramRoutes.vehicleOdometerNew, { id: vehicleId })}>
					<Plus class="h-4 w-4 mr-2" />
					Add reading
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{:else}
	<div class="space-y-6">
		<div class="flex items-end justify-between gap-4">
			{#if latest}
				<div>
					<p class="text-sm text-muted-foreground">Latest reading</p>
					<p class="font-(family-name:--font-fig) text-3xl leading-none font-bold tabular-nums">
						{formatOdometer(latest.odometer)}
						<span class="text-base font-semibold text-muted-foreground">{distLabel}</span>
					</p>
				</div>
			{/if}
			{#if canWrite}
				<Button class="ml-auto" href={resolve(paramRoutes.vehicleOdometerNew, { id: vehicleId })}>
					<Plus class="h-4 w-4 mr-2" />
					Add reading
				</Button>
			{/if}
		</div>

		{#if chartError || chartData.length >= MIN_CHART_POINTS}
			<AppLineChart
				title="Mileage Over Time"
				description={chartIsCapped
					? `Your latest ${CHART_READING_LIMIT} readings`
					: 'Odometer readings plotted by date'}
				data={chartData}
				x="date"
				y="odometer"
				{series}
				config={chartConfig}
				height={280}
				error={chartError}
				onRetry={loadChartEntries}
				yDomain={mileageYDomain(chartData.map(d => d.odometer))}
				xAxisProps={mileageXAxisProps(chartData.map(d => d.date))}
				yAxisFormat={v => formatNumber(v, 0)}
				tooltipFormat={unitTooltip(distLabel, 0)}
				tooltipLabelFormat={formatDayLabel}
			/>
		{/if}

		<section aria-labelledby="odometer-readings-heading" class="space-y-3">
			<h2 class="text-base font-semibold" id="odometer-readings-heading">
				{formatNumber(totalCount, 0)}
				{totalCount === 1 ? 'reading' : 'readings'}
			</h2>
			{#if isPageLoading}
				<div class="flex justify-center py-6">
					<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			{:else}
				<ul class="divide-y border-y">
					{#each entries as entry, i (`${entry.source}-${entry.sourceId}`)}
						{@const href = canWrite ? rowHref(entry) : undefined}
						{@const gain = gainSince(i)}
						<li class="flex items-center gap-3">
							<svelte:element
								this={href ? 'a' : 'div'}
								{href}
								class={cn(
									'flex min-w-0 flex-1 items-center justify-between gap-4 py-3',
									href &&
										'-mx-2 rounded-md px-2 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50'
								)}
							>
								<span class="min-w-0">
									<span class="block font-semibold tabular-nums text-foreground">
										{formatOdometer(entry.odometer)}
										{distLabel}
									</span>
									<span class="block text-sm text-muted-foreground">
										{formatDate(entry.recordedAt)}{entry.source === 'expense'
											? ' · from an expense'
											: ''}
									</span>
									{#if entry.note}
										<span class="mt-1 block text-sm text-muted-foreground">{entry.note}</span>
									{/if}
								</span>
								{#if gain !== null}
									<span class="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
										+{formatOdometer(gain)}
										{distLabel}
									</span>
								{/if}
							</svelte:element>
							{#if canWrite && entry.source === 'manual' && authStore.user?.demo !== true}
								<Button
									variant="ghost"
									size="icon"
									class="h-10 w-10 shrink-0 text-destructive hover:text-destructive"
									aria-label="Delete reading"
									title="Delete reading"
									onclick={() => openDeleteDialog(entry)}
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if totalPages > 1}
			<div class="flex items-center justify-center gap-4">
				<Button
					variant="outline"
					size="sm"
					disabled={!hasPrevious || isPageLoading}
					onclick={goToPreviousPage}
				>
					<ChevronLeft class="h-4 w-4 mr-1" />
					Previous
				</Button>
				<span class="text-sm text-muted-foreground">
					Page {currentPage} of {totalPages}
				</span>
				<Button
					variant="outline"
					size="sm"
					disabled={!hasNext || isPageLoading}
					onclick={goToNextPage}
				>
					Next
					<ChevronRight class="h-4 w-4 ml-1" />
				</Button>
			</div>
		{/if}
	</div>
{/if}

<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete Reading</Dialog.Title>
			<Dialog.Description>
				Are you sure you want to delete this odometer reading
				{#if deletingEntry}
					({formatOdometer(deletingEntry.odometer)} {distLabel})?
				{:else}
					?
				{/if}
				This action cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		{#if deleteError}
			<p class="text-sm text-destructive">{deleteError}</p>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (deleteDialogOpen = false)}>Cancel</Button>
			<Button variant="destructive" disabled={isDeleting} onclick={handleDelete}>
				{#if isDeleting}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
				{/if}
				Delete
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
