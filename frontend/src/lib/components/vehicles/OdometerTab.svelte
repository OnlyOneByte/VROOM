<script module lang="ts">
	import type { AnyScale } from 'layerchart';
	import {
		TIME_X_PADDING,
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
				const ticks: Date[] = (scale.ticks?.(count) ?? []).filter(
					(tick: Date) => scale(tick) >= TIME_X_PADDING[0]
				);
				const labels = ticks.map(format);
				return ticks.filter((_tick, i) => i === 0 || labels[i] !== labels[i - 1]);
			}
		};
	}
</script>

<script lang="ts">
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { cn } from '#lib/utils.js';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { paramRoutes } from '#lib/routes.ts';
	import {
		Plus,
		LoaderCircle,
		Gauge,
		ChevronLeft,
		ChevronRight,
		Pencil,
		Receipt,
		Trash2
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
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
	const MIN_CHART_POINTS = 2;

	let {
		vehicleId,
		unitPreferences,
		canWrite = true
	}: { vehicleId: string; unitPreferences?: UnitPreferences; canWrite?: boolean } = $props();

	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);
	let distLabel = $derived(getDistanceUnitLabel(units.distanceUnit, true));

	let entries = $state<OdometerHistoryEntry[]>([]);
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
		entries
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
		await loadEntries(0);
		isLoading = false;
	});

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

	function formatOdometer(value: number): string {
		return formatNumber(value, 0);
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
			await loadEntries(offset);
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
			<Button variant="outline" onclick={() => loadEntries(0)}>Retry</Button>
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
					Add Reading
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{:else}
	<div class="space-y-6">
		{#if canWrite}
			<div class="flex justify-end">
				<Button href={resolve(paramRoutes.vehicleOdometerNew, { id: vehicleId })}>
					<Plus class="h-4 w-4 mr-2" />
					Add Reading
				</Button>
			</div>
		{/if}

		{#if chartData.length >= MIN_CHART_POINTS}
			<AppLineChart
				title="Mileage Over Time"
				description="Odometer readings plotted by date"
				data={chartData}
				x="date"
				y="odometer"
				{series}
				config={chartConfig}
				height={280}
				yDomain={mileageYDomain(chartData.map(d => d.odometer))}
				xAxisProps={mileageXAxisProps(chartData.map(d => d.date))}
				yAxisFormat={v => formatNumber(v, 0)}
				tooltipFormat={unitTooltip(distLabel, 0)}
				tooltipLabelFormat={formatDayLabel}
			/>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title level={2}>Readings ({totalCount})</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if isPageLoading}
					<div class="flex justify-center py-6">
						<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				{:else}
					{#each entries as entry (`${entry.source}-${entry.sourceId}`)}
						<div class="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
							<div class="flex items-start gap-3">
								<div
									class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10"
								>
									<Gauge class="h-4 w-4 text-primary" />
								</div>

								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-semibold text-foreground">
											{formatOdometer(entry.odometer)}
											{distLabel}
										</span>
										<span
											class={cn(
												'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
												entry.source === 'manual'
													? 'bg-primary/10 text-primary'
													: 'bg-muted text-muted-foreground'
											)}
										>
											{entry.source}
										</span>
									</div>

									<p class="text-sm text-muted-foreground">
										{formatDate(entry.recordedAt)}
									</p>

									{#if entry.note}
										<p class="mt-1 text-sm text-muted-foreground">{entry.note}</p>
									{/if}
								</div>
							</div>

							{#if canWrite && entry.source === 'expense'}
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 shrink-0"
									aria-label="Open expense"
									title="Open expense"
									href={resolve(paramRoutes.expenseEdit, { id: entry.sourceId }) +
										`?returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`}
								>
									<Receipt class="h-3.5 w-3.5" />
								</Button>
							{:else if canWrite}
								<div class="flex shrink-0 gap-1">
									<Button
										variant="ghost"
										size="icon"
										class="h-8 w-8"
										aria-label="Edit reading"
										title="Edit reading"
										href={resolve(paramRoutes.vehicleOdometerEntryEdit, {
											id: vehicleId,
											entryId: entry.sourceId
										}) + `?returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}`}
									>
										<Pencil class="h-3.5 w-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="h-8 w-8 text-destructive hover:text-destructive"
										aria-label="Delete reading"
										title="Delete reading"
										onclick={() => openDeleteDialog(entry)}
									>
										<Trash2 class="h-3.5 w-3.5" />
									</Button>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>

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
