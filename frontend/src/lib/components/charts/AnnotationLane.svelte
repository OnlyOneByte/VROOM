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
	{#each markers as marker, i (i)}
		{@const x = left(marker.at)}
		{#if x !== null}
			<span
				class="border-foreground bg-background absolute top-0.5 size-3 -translate-x-1/2 rounded-full border-2 {active ===
				i
					? 'ring-ring/60 ring-2'
					: ''}"
				style="left: {x}px"
				onmouseenter={() => (active = i)}
				aria-hidden="true"
				data-annotation-marker
			></span>
		{/if}
	{/each}
	{#if shown}
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
