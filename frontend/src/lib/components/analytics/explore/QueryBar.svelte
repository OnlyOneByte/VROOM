<script lang="ts">
	import { RotateCcw, SlidersHorizontal } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import * as Sheet from '#lib/components/ui/sheet/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { IsMobile } from '#lib/hooks/is-mobile.svelte.ts';
	import {
		DEFAULT_EXPLORE,
		EXPLORE_COMPARES,
		EXPLORE_INTERVALS,
		EXPLORE_METRICS,
		EXPLORE_SPLITS,
		allowedSplits,
		describeQuery,
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

	let splits = $derived(EXPLORE_SPLITS.filter(s => allowedSplits(query.metric).includes(s.value)));
	let isDefault = $derived(
		JSON.stringify({ ...query, hide: [] }) === JSON.stringify({ ...DEFAULT_EXPLORE, hide: [] })
	);

	function update(patch: Partial<ExploreQuery>) {
		onChange(normalizeExplore({ ...query, ...patch, hide: patch.split ? [] : query.hide }));
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
			<span class="font-medium">{describeQuery(query)}</span>{query.inc === 'all'
				? ', financing and fees included'
				: ''}
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
			{@render field('explore-metric', 'Show', query.metric, EXPLORE_METRICS, v =>
				update({ metric: v as ExploreQuery['metric'], hide: [] })
			)}
			{@render field('explore-per', 'Per', query.per, EXPLORE_INTERVALS, v =>
				update({ per: v as ExploreQuery['per'] })
			)}
			{@render field('explore-split', 'Split by', query.split, splits, v =>
				update({ split: v as ExploreQuery['split'] })
			)}
			{@render field('explore-compare', 'Compare with', query.compare, EXPLORE_COMPARES, v =>
				update({ compare: v as ExploreQuery['compare'] })
			)}
			<div class="flex min-h-10 items-center gap-2">
				<Switch
					id="explore-include"
					checked={query.inc === 'all'}
					onCheckedChange={checked => update({ inc: checked ? 'all' : 'running' })}
				/>
				<Label for="explore-include" class="font-normal">Include financing and fees</Label>
			</div>
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
