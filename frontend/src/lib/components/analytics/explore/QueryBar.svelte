<script lang="ts">
	import { RotateCcw, SlidersHorizontal } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import * as Sheet from '#lib/components/ui/sheet/index.ts';
	import { IsMobile } from '#lib/hooks/is-mobile.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import {
		DEFAULT_EXPLORE,
		EXPLORE_COMPARES,
		EXPLORE_INTERVALS,
		EXPLORE_METRICS,
		EXPLORE_SPLITS,
		allowedSplits,
		describeQuery,
		metricInfo,
		metricLabel,
		normalizeExplore,
		type ExploreQuery
	} from './query-state';

	interface Props {
		query: ExploreQuery;
		onChange: (_query: ExploreQuery) => void;
	}

	let { query, onChange }: Props = $props();

	const isMobile = new IsMobile();
	let editing = $state(false);

	let distanceWord = $derived(
		settingsStore.unitPreferences.distanceUnit === 'kilometers' ? 'km' : 'mile'
	);
	let metrics = $derived(
		EXPLORE_METRICS.map(m => ({ value: m.value, label: metricLabel(m.value, distanceWord) }))
	);
	let splits = $derived(
		EXPLORE_SPLITS.filter(s => allowedSplits(query.metric, query.compare).includes(s.value))
	);
	let moneyMetric = $derived(['cost', 'costPerDistance'].includes(metricInfo(query.metric).metric));
	const COSTS = [
		{ value: 'running', label: 'Running costs' },
		{ value: 'all', label: 'All costs' }
	];
	let isDefault = $derived(
		JSON.stringify({ ...query, hide: [] }) === JSON.stringify({ ...DEFAULT_EXPLORE, hide: [] })
	);

	function update(patch: Partial<ExploreQuery>) {
		onChange(
			normalizeExplore({
				...query,
				...patch,
				hide: patch.split ? [] : query.hide,
				sel: undefined,
				seg: undefined
			})
		);
	}
</script>

{#snippet field(
	id: string,
	label: string,
	value: string,
	options: ReadonlyArray<{ value: string; label: string }>,
	onPick: (_value: string) => void
)}
	<fieldset class="space-y-1">
		<legend class="mb-1 text-sm font-medium">{label}</legend>
		<RadioGroup.Root
			{value}
			onValueChange={v => v && onPick(v)}
			aria-label={label}
			class="grid grid-cols-2 gap-1"
		>
			{#each options as option (option.value)}
				<Label
					for="{id}-{option.value}"
					class="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 font-normal hover:bg-muted"
				>
					<RadioGroup.Item value={option.value} id="{id}-{option.value}" />
					{option.label}
				</Label>
			{/each}
		</RadioGroup.Root>
	</fieldset>
{/snippet}

<div class="rounded-lg border bg-card p-3 md:p-4">
	<div class="flex items-start justify-between gap-3">
		<p class="min-w-0 text-sm md:text-base" aria-live="polite">
			<span class="font-medium">{describeQuery(query, distanceWord)}</span>
			{#if moneyMetric}
				<span class="block text-xs text-muted-foreground md:text-sm">
					{query.inc === 'all'
						? 'All costs, including financing, insurance and fees.'
						: 'Running costs only: fuel, maintenance and misc.'}
				</span>
			{/if}
		</p>
		<div class="flex shrink-0 items-center gap-1">
			{#if !isDefault && !isMobile.current}
				<Button variant="ghost" size="sm" onclick={() => onChange(DEFAULT_EXPLORE)}>
					<RotateCcw class="mr-1 h-4 w-4" aria-hidden="true" />
					Reset
				</Button>
			{/if}
			<Button
				variant="outline"
				size="sm"
				aria-haspopup="dialog"
				aria-expanded={editing}
				onclick={() => (editing = true)}
			>
				<SlidersHorizontal class="mr-1 h-4 w-4" aria-hidden="true" />
				Edit
			</Button>
		</div>
	</div>
</div>

<Sheet.Root bind:open={editing}>
	<Sheet.Content
		side={isMobile.current ? 'bottom' : 'right'}
		class={isMobile.current ? 'max-h-[85vh] overflow-y-auto' : 'overflow-y-auto sm:max-w-md'}
	>
		<Sheet.Header>
			<Sheet.Title>Edit the chart</Sheet.Title>
			<Sheet.Description>Pick what to measure and how to split it.</Sheet.Description>
		</Sheet.Header>
		<div class="space-y-5 px-4">
			{@render field('explore-metric', 'Show', query.metric, metrics, v =>
				update({ metric: v as ExploreQuery['metric'], hide: [] })
			)}
			{@render field('explore-per', 'Per', query.per, EXPLORE_INTERVALS, v =>
				update({ per: v as ExploreQuery['per'] })
			)}
			{@render field('explore-split', 'Split by', query.split, splits, v =>
				update({ split: v as ExploreQuery['split'] })
			)}
			{#if query.compare !== 'none'}
				<p class="-mt-3 text-xs text-muted-foreground">
					A comparison draws one total line, so the split is off while comparing.
				</p>
			{/if}
			{@render field('explore-compare', 'Compare with', query.compare, EXPLORE_COMPARES, v =>
				update({ compare: v as ExploreQuery['compare'] })
			)}
			{@render field('explore-include', 'Costs', query.inc, COSTS, v =>
				update({ inc: v as ExploreQuery['inc'] })
			)}
		</div>
		<Sheet.Footer class="pb-[max(1rem,env(safe-area-inset-bottom))]">
			{#if !isDefault}
				<Button variant="ghost" onclick={() => onChange(DEFAULT_EXPLORE)}>
					<RotateCcw class="mr-1 h-4 w-4" aria-hidden="true" />
					Reset
				</Button>
			{/if}
			<Button size="lg" class="w-full" onclick={() => (editing = false)}>Done</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
