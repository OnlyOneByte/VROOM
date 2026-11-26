<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { Check, ChevronDown, RotateCcw, Share2 } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import {
		DEFAULT_EXPLORE,
		EXPLORE_COMPARES,
		EXPLORE_INTERVALS,
		EXPLORE_METRICS,
		EXPLORE_SPLITS,
		allowedSplits,
		metricInfo,
		metricLabel,
		normalizeExplore,
		type ExploreQuery
	} from './query-state';

	interface Props {
		query: ExploreQuery;
		onChange: (_query: ExploreQuery) => void;
		driverSplit?: boolean;
		/** The page's Range and Cars chips, placed after Split by. */
		filters?: Snippet;
	}

	let { query, onChange, driverSplit = false, filters }: Props = $props();

	type Menu = 'metric' | 'per' | 'split' | 'compare';
	let open = $state<Menu | null>(null);
	let copied = $state<'done' | 'failed' | null>(null);

	let distanceWord = $derived(
		settingsStore.unitPreferences.distanceUnit === 'kilometers' ? 'km' : 'mile'
	);
	let metrics = $derived(
		EXPLORE_METRICS.map(m => ({ value: m.value, label: metricLabel(m.value, distanceWord) }))
	);
	let splits = $derived(
		EXPLORE_SPLITS.filter(
			s =>
				allowedSplits(query.metric, query.compare).includes(s.value) &&
				(driverSplit || s.value !== 'driver' || query.split === 'driver')
		)
	);
	let moneyMetric = $derived(['cost', 'costPerDistance'].includes(metricInfo(query.metric).metric));
	const COSTS = [
		{ value: 'running', label: 'Running costs' },
		{ value: 'all', label: 'All costs' }
	];
	let metricText = $derived(
		`${metricLabel(query.metric, distanceWord)}${moneyMetric && query.inc === 'all' ? ', all costs' : ''}`
	);
	let isDefault = $derived(
		JSON.stringify({ ...query, hide: [] }) === JSON.stringify({ ...DEFAULT_EXPLORE, hide: [] })
	);

	const labelOf = (options: ReadonlyArray<{ value: string; label: string }>, value: string) =>
		options.find(o => o.value === value)?.label ?? value;

	function update(patch: Partial<ExploreQuery>) {
		const chipButton =
			open && document.querySelector<HTMLElement>(`[aria-controls="explore-menu-${open}"]`);
		open = null;
		chipButton?.focus();
		onChange(
			normalizeExplore({
				...query,
				...patch,
				hide: patch.split || patch.metric ? [] : query.hide,
				sel: undefined,
				seg: undefined
			})
		);
	}

	let alignEnd = $state(false);

	async function toggle(menu: Menu, button: HTMLElement) {
		if (open === menu) {
			open = null;
			return;
		}
		// 256 px menu plus a 16 px margin: right-align when it would run off the viewport.
		alignEnd = button.getBoundingClientRect().left + 272 > window.innerWidth;
		open = menu;
		await tick();
		button.parentElement?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
	}

	function closeMenu(wrapper: HTMLElement) {
		open = null;
		wrapper.querySelector<HTMLElement>('button')?.focus();
	}

	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyLink() {
		clearTimeout(copyTimer);
		try {
			await navigator.clipboard.writeText(location.href);
			copied = 'done';
		} catch {
			copied = 'failed';
		}
		copyTimer = setTimeout(() => (copied = null), 2000);
	}
</script>

{#snippet radios(
	label: string,
	value: string,
	options: ReadonlyArray<{ value: string; label: string }>,
	onPick: (_value: string) => void
)}
	<div class="space-y-1" role="group" aria-label={label}>
		<p class="mb-1 text-sm font-medium" aria-hidden="true">{label}</p>
		{#each options as option (option.value)}
			<button
				type="button"
				aria-pressed={option.value === value}
				class="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
				onclick={() => onPick(option.value)}
			>
				<Check
					class="h-4 w-4 shrink-0 {option.value === value ? '' : 'invisible'}"
					aria-hidden="true"
				/>
				{option.label}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet chip(menu: Menu, prefix: string, text: string, body: Snippet)}
	<!-- shortcut: a plain disclosure instead of the kit Popover, whose floating-ui would add
	     ~13 KB to the /analytics first view; move to Popover if that cost moves off the route. -->
	<div
		class="relative max-w-full"
		data-chip-menu
		role="presentation"
		onkeydown={e => e.key === 'Escape' && open === menu && closeMenu(e.currentTarget)}
		onfocusout={e => {
			if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget) open = null;
		}}
	>
		<Button
			variant="outline"
			class="h-10 max-w-full gap-1.5 rounded-full px-4"
			aria-expanded={open === menu}
			aria-controls="explore-menu-{menu}"
			onclick={e => toggle(menu, e.currentTarget)}
		>
			<span class="text-muted-foreground">{prefix}</span>
			<span class="min-w-0 truncate font-medium">{text}</span>
			<ChevronDown class="h-4 w-4 shrink-0" aria-hidden="true" />
		</Button>
		{#if open === menu}
			<div
				id="explore-menu-{menu}"
				class="absolute top-full z-50 mt-1 max-h-[70vh] w-64 max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto rounded-[var(--r-lg)] border bg-popover p-3 text-popover-foreground shadow-[var(--shadow-pop)] {alignEnd
					? 'right-0'
					: 'left-0'}"
			>
				{@render body()}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet metricMenu()}
	{@render radios('Metric', query.metric, metrics, v =>
		update({ metric: v as ExploreQuery['metric'] })
	)}
	{#if moneyMetric}
		{@render radios('Costs', query.inc, COSTS, v => update({ inc: v as ExploreQuery['inc'] }))}
		<p class="text-xs text-muted-foreground">
			{query.inc === 'all'
				? 'All costs, including insurance and loan or lease payments.'
				: 'Running costs: everything except insurance and loan or lease payments.'}
		</p>
	{/if}
{/snippet}

{#snippet perMenu()}
	{@render radios('By', query.per, EXPLORE_INTERVALS, v =>
		update({ per: v as ExploreQuery['per'] })
	)}
{/snippet}

{#snippet splitMenu()}
	{@render radios('Split by', query.split, splits, v =>
		update({ split: v as ExploreQuery['split'] })
	)}
	{#if query.compare === 'cars'}
		<p class="text-xs text-muted-foreground">
			Each car gets its own chart on one shared scale, so the split is by car.
		</p>
	{:else if query.compare !== 'none'}
		<p class="text-xs text-muted-foreground">
			A comparison draws one total line, so the split is off while comparing.
		</p>
	{/if}
{/snippet}

{#snippet compareMenu()}
	{@render radios('Compare with', query.compare, EXPLORE_COMPARES, v =>
		update({ compare: v as ExploreQuery['compare'] })
	)}
{/snippet}

<svelte:window
	onpointerdown={e => {
		if (open && !(e.target as Element | null)?.closest?.('[data-chip-menu]')) open = null;
	}}
/>

<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Chart options">
	{@render chip('metric', 'Metric', metricText, metricMenu)}
	{@render chip('per', 'By', labelOf(EXPLORE_INTERVALS, query.per), perMenu)}
	{@render chip('split', 'Split by', labelOf(EXPLORE_SPLITS, query.split), splitMenu)}
	{@render chip(
		'compare',
		'Compare',
		query.compare === 'none' ? 'None' : labelOf(EXPLORE_COMPARES, query.compare),
		compareMenu
	)}
	{@render filters?.()}
	<Button variant="outline" class="h-10 gap-1.5 rounded-full px-4" onclick={copyLink}>
		{#if copied === 'done'}
			<Check class="h-4 w-4" aria-hidden="true" />
		{:else}
			<Share2 class="h-4 w-4" aria-hidden="true" />
		{/if}
		{copied === 'done' ? 'Link copied' : copied === 'failed' ? "Couldn't copy" : 'Copy link'}
	</Button>
	{#if !isDefault}
		<Button variant="ghost" class="h-10 rounded-full" onclick={() => onChange(DEFAULT_EXPLORE)}>
			<RotateCcw class="mr-1 h-4 w-4" aria-hidden="true" />
			Reset
		</Button>
	{/if}
	<span class="sr-only" aria-live="polite">
		{copied === 'done' ? 'Link copied' : copied === 'failed' ? "Couldn't copy the link" : ''}
	</span>
</div>
