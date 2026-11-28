<script lang="ts">
	import type { ChartState } from 'layerchart';
	import { nextIndex } from './chart-a11y.ts';
	import type { ChartAnnotations } from './types.ts';

	interface Props {
		annotations: ChartAnnotations;
		context: ChartState<Record<string, unknown>> | undefined;
	}

	let { annotations, context }: Props = $props();

	let markers = $derived(annotations.markers ?? []);
	let density = $derived(annotations.density ?? []);
	let maxDensity = $derived(Math.max(0, ...density.map(d => d.value)));
	let active = $state<number | null>(null);
	let laneWidth = $state(0);
	let shown = $derived(active === null ? undefined : markers[active]);

	function left(at: unknown): number | null {
		const scale = context?.xScale as
			(((_v: unknown) => number | undefined) & { bandwidth?: () => number }) | undefined;
		if (!scale) return null;
		const x = scale(at);
		if (x == null || !Number.isFinite(x)) return null;
		return (context?.padding.left ?? 0) + x + (scale.bandwidth?.() ?? 0) / 2;
	}

	const MARKER_SPACING = 24;
	const GROUP_HALF_WIDTH = 12;
	const PILL_GAP = 2;

	type Group = { start: number; end: number; x: number; members: number[]; services: number };

	function pillWidth(g: Group): number {
		return g.members.length === 1 ? 12 : Math.max(16, 7 * String(g.services).length + 8);
	}

	let groups = $derived.by(() => {
		const placed = markers
			.map((marker, index) => ({ index, x: left(marker.at) }))
			.filter((p): p is { index: number; x: number } => p.x !== null)
			.sort((a, b) => a.x - b.x);
		const runs: Group[] = [];
		for (const p of placed) {
			const services = markers[p.index]?.rows?.length ?? 1;
			const last = runs.at(-1);
			if (last && p.x - last.x < MARKER_SPACING) {
				last.members.push(p.index);
				last.services += services;
				last.end = p.x;
				last.x = (last.start + p.x) / 2;
			} else {
				runs.push({ start: p.x, end: p.x, x: p.x, members: [p.index], services });
			}
		}
		const place = (g: Group): Group => {
			const mid = (g.start + g.end) / 2;
			if (g.members.length === 1) return { ...g, x: mid };
			const half = Math.max(GROUP_HALF_WIDTH, pillWidth(g) / 2 + 2);
			const edge = laneWidth > 0 ? laneWidth - half : Infinity;
			return { ...g, x: Math.max(Math.min(mid, edge), half) };
		};
		const out: Group[] = [];
		for (const run of runs) {
			let g = place(run);
			let prev = out.at(-1);
			while (
				prev &&
				g.x - prev.x < Math.max(MARKER_SPACING, (pillWidth(prev) + pillWidth(g)) / 2 + PILL_GAP)
			) {
				out.pop();
				g = place({
					start: prev.start,
					end: g.end,
					x: 0,
					members: [...prev.members, ...g.members],
					services: prev.services + g.services
				});
				prev = out.at(-1);
			}
			out.push(g);
		}
		return out;
	});
	let activeGroup = $derived(
		active === null ? undefined : groups.find(g => g.members.includes(active as number))
	);
	const TIP_MONTHS = 3;
	let tipMembers = $derived.by(() => {
		const members = activeGroup?.members ?? [];
		const at = Math.max(0, members.indexOf(active as number));
		const from = Math.min(Math.max(0, at - 1), Math.max(0, members.length - TIP_MONTHS));
		const shown = members.slice(from, from + TIP_MONTHS);
		return { shown, hidden: members.length - shown.length };
	});

	function describe(index: number): string {
		const marker = markers[index];
		if (!marker) return '';
		const detail = marker.detail ? ` ${marker.detail}` : '';
		return `${annotations.formatAt(marker.at)}: ${marker.label}.${detail} ${index + 1} of ${markers.length}.`;
	}

	function handleKey(event: KeyboardEvent) {
		const count = markers.length;
		if (count === 0) return;
		const next = nextIndex(event.key, active, count);
		if (next === undefined) return;
		event.preventDefault();
		active = next;
	}

	let summary = $derived(
		[
			`${annotations.label}: ${markers.length} ${markers.length === 1 ? 'marker' : 'markers'}.`,
			markers.length > 0 ? 'Use the arrow keys to step through them.' : '',
			density.some(d => d.value > 0) ? 'The strip under them is listed in Table view.' : '',
			annotations.note ?? ''
		]
			.filter(Boolean)
			.join(' ')
	);
	let tipWidth = $state(0);

	function tipLeft(x: number): number {
		return Math.min(Math.max(0, x - tipWidth / 2), Math.max(0, laneWidth - tipWidth));
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	role="group"
	aria-label={summary}
	tabindex={markers.length > 0 ? 0 : -1}
	onkeydown={handleKey}
	onblur={() => (active = null)}
	onmouseleave={() => (active = null)}
	class="focus-visible:ring-ring/50 relative mb-1 h-6 rounded-sm outline-none focus-visible:ring-[3px]"
	data-annotation-lane
	bind:clientWidth={laneWidth}
>
	{#each density as d, i (i)}
		{@const x = left(d.at)}
		{#if x !== null && d.value > 0}
			<span
				class="bg-muted-foreground absolute bottom-0 h-1.5 w-2 -translate-x-1/2 rounded-[1px]"
				style="left: {x}px; opacity: {0.2 + 0.6 * (d.value / (maxDensity || 1))}"
				title={d.label}
				aria-hidden="true"
			></span>
		{/if}
	{/each}
	{#each groups as group (group.members[0])}
		{@const isActive = active !== null && group.members.includes(active)}
		{#if group.members.length === 1}
			<span
				class="border-foreground bg-background absolute top-0.5 size-3 -translate-x-1/2 rounded-full border-2 {isActive
					? 'ring-ring/60 ring-2'
					: ''}"
				style="left: {group.x}px"
				onmouseenter={() => (active = group.members[0] ?? null)}
				aria-hidden="true"
				data-annotation-marker
			></span>
		{:else}
			<span
				class="border-foreground bg-background absolute top-0 h-4 min-w-4 -translate-x-1/2 rounded-full border-2 px-0.5 text-center text-xs leading-3 font-semibold tabular-nums {isActive
					? 'ring-ring/60 ring-2'
					: ''}"
				style="left: {group.x}px"
				onmouseenter={() => (active = group.members[0] ?? null)}
				onclick={() => (active = group.members[0] ?? null)}
				aria-hidden="true"
				data-annotation-marker
				data-annotation-group={group.members.length}
			>
				{group.services}
			</span>
		{/if}
	{/each}
	{#if activeGroup && activeGroup.members.length > 1}
		<div
			class="bg-popover text-popover-foreground pointer-events-none absolute top-6 z-10 w-max max-w-56 rounded-md border px-2 py-1 text-xs shadow-md"
			style="left: {tipLeft(activeGroup.x)}px"
			bind:clientWidth={tipWidth}
			aria-hidden="true"
			data-annotation-group-tip
		>
			{#each tipMembers.shown as index (index)}
				{@const marker = markers[index]}
				{#if marker}
					<div class={index === active ? 'font-medium' : ''}>
						<span class="text-muted-foreground">{annotations.formatAt(marker.at)}:</span>
						{marker.label}
						{#if marker.detail}<div class="truncate font-normal">{marker.detail}</div>{/if}
					</div>
				{/if}
			{/each}
			{#if tipMembers.hidden > 0}
				<div class="text-muted-foreground">+{tipMembers.hidden} more</div>
			{/if}
		</div>
	{:else if shown}
		{@const x = left(shown.at)}
		{#if x !== null}
			<div
				class="bg-popover text-popover-foreground pointer-events-none absolute top-6 z-10 w-max max-w-56 rounded-md border px-2 py-1 text-xs shadow-md"
				style="left: {tipLeft(x)}px"
				bind:clientWidth={tipWidth}
				aria-hidden="true"
			>
				<div class="text-muted-foreground">{annotations.formatAt(shown.at)}</div>
				<div class="font-medium">{shown.label}</div>
				{#if shown.detail}<div>{shown.detail}</div>{/if}
			</div>
		{/if}
	{/if}
</div>
{#if annotations.note}
	<p class="text-muted-foreground mb-1 text-xs" aria-hidden="true">{annotations.note}</p>
{/if}
<p class="sr-only" aria-live="polite">{active === null ? '' : describe(active)}</p>
