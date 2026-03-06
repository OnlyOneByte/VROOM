<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Plus,
		LoaderCircle,
		Gauge,
		Link as LinkIcon,
		ChevronLeft,
		ChevronRight,
		Pencil,
		Trash2
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import type { ChartConfig } from '$lib/components/ui/chart';
	import * as Dialog from '$lib/components/ui/dialog';
	import { AppLineChart } from '$lib/components/charts';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { odometerApi } from '$lib/services/odometer-api';
	import { formatDate, formatNumber } from '$lib/utils/formatters';
	import { getDistanceUnitLabel } from '$lib/utils/units';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import type { OdometerEntry, PaginatedOdometerResponse, UnitPreferences } from '$lib/types';

	const PAGE_SIZE = 20;
	const MIN_CHART_POINTS = 2;

	let { vehicleId, unitPreferences }: { vehicleId: string; unitPreferences?: UnitPreferences } =
		$props();

	// Resolve distance label from vehicle unitPreferences, falling back to global settings
	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);
	let distLabel = $derived(getDistanceUnitLabel(units.distanceUnit, true));

	// State
	let entries = $state<OdometerEntry[]>([]);
	let totalCount = $state(0);
	let offset = $state(0);
	let isLoading = $state(true);
	let isPageLoading = $state(false);
	let error = $state<string | null>(null);

	// Delete dialog state
	let deleteDialogOpen = $state(false);
	let deletingEntry = $state<OdometerEntry | null>(null);
	let isDeleting = $state(false);
	let deleteError = $state<string | null>(null);

	// Derived pagination
	let currentPage = $derived(Math.floor(offset / PAGE_SIZE) + 1);
	let totalPages = $derived(Math.max(1, Math.ceil(totalCount / PAGE_SIZE)));
	let hasPrevious = $derived(offset > 0);
	let hasNext = $derived(offset + entries.length < totalCount);

	// Chart data: sorted ascending by date for the line chart
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
			const response: PaginatedOdometerResponse = await odometerApi.getEntries(vehicleId, {
				limit: PAGE_SIZE,
				offset: newOffset
			});
			entries = response.data;
			totalCount = response.totalCount;
			offset = response.offset;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load odometer entries';
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

	function openDeleteDialog(entry: OdometerEntry) {
		deletingEntry = entry;
		deleteError = null;
		deleteDialogOpen = true;
	}

	async function handleDelete() {
		if (!deletingEntry) return;
		isDeleting = true;
		deleteError = null;
		try {
			await odometerApi.delete(deletingEntry.id);
			deleteDialogOpen = false;
			deletingEntry = null;
			await loadEntries(offset);
		} catch (e) {
			deleteError = e instanceof Error ? e.message : 'Failed to delete reading';
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
			Failed to load odometer entries
		{/snippet}
		{#snippet description()}
			{error}
		{/snippet}
		{#snippet action()}
			<Button variant="outline" onclick={() => loadEntries(0)}>Try Again</Button>
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
			<Button href="/vehicles/{vehicleId}/odometer/new">
				<Plus class="h-4 w-4 mr-2" />
				Add Reading
			</Button>
		{/snippet}
	</EmptyState>
{:else}
	<div class="space-y-6">
		<!-- Add Reading Button -->
		<div class="flex justify-end">
			<Button href="/vehicles/{vehicleId}/odometer/new">
				<Plus class="h-4 w-4 mr-2" />
				Add Reading
			</Button>
		</div>

		<!-- Mileage Over Time Chart -->
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
				yAxisFormat={v => formatNumber(v, 0)}
			/>
		{/if}

		<!-- Entries List -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Readings ({totalCount})</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if isPageLoading}
					<div class="flex justify-center py-6">
						<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				{:else}
					{#each entries as entry (entry.id)}
						<div class="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
							<div class="flex items-start gap-3">
								<!-- Icon: distinguish manual vs linked -->
								{#if entry.linkedEntityType}
									<div
										class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chart-1/10"
									>
										<LinkIcon class="h-4 w-4 text-chart-1" />
									</div>
								{:else}
									<div
										class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10"
									>
										<Gauge class="h-4 w-4 text-primary" />
									</div>
								{/if}

								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-semibold text-foreground">
											{formatOdometer(entry.odometer)}
											{distLabel}
										</span>
										{#if entry.linkedEntityType}
											<span
												class="inline-flex items-center rounded-full bg-chart-1/10 px-2 py-0.5 text-xs font-medium text-chart-1"
											>
												{entry.linkedEntityType}
											</span>
										{:else}
											<span
												class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
											>
												manual
											</span>
										{/if}
									</div>

									<p class="text-sm text-muted-foreground">
										{formatDate(entry.recordedAt)}
									</p>

									{#if entry.note}
										<p class="mt-1 text-sm text-muted-foreground">{entry.note}</p>
									{/if}

									{#if entry.linkedEntityType === 'expense' && entry.linkedEntityId}
										<a
											href="/expenses/{entry.linkedEntityId}"
											class="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
										>
											<LinkIcon class="h-3 w-3" />
											View expense
										</a>
									{/if}
								</div>
							</div>

							<!-- Edit/Delete buttons (manual entries only) -->
							{#if !entry.linkedEntityType}
								<div class="flex shrink-0 gap-1">
									<Button
										variant="ghost"
										size="icon"
										class="h-8 w-8"
										title="Edit reading"
										href="/vehicles/{vehicleId}/odometer/{entry.id}/edit?returnTo=/vehicles/{vehicleId}"
									>
										<Pencil class="h-3.5 w-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="h-8 w-8 text-destructive hover:text-destructive"
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

		<!-- Pagination -->
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

<!-- Delete Confirmation Dialog -->
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
