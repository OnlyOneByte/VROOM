<script lang="ts">
	import { costBucketColor } from '#lib/utils/cost-bucket.ts';
	import { formatNumberUpTo } from '#lib/utils/formatters.ts';

	interface Props {
		running: number;
		ownership: number;
		valueLabel: string;
		caption: string;
		label: string;
		max?: number;
		class?: string;
	}

	let {
		running,
		ownership,
		valueLabel,
		caption,
		label,
		max = 80,
		class: className = ''
	}: Props = $props();

	const CENTER = 110;
	const ARC_RADIUS = 88;
	const SWEEP = 270;
	const START = 225;
	const MINOR_STEPS = 4;

	let scale = $derived(max > 0 ? max : 80);

	function amount(value: number): number {
		return Number.isNaN(value) || value <= 0 ? 0 : value;
	}

	function clamp(value: number): number {
		return Math.min(amount(value), scale);
	}

	function angleOf(value: number): number {
		return START - (SWEEP * clamp(value)) / scale;
	}

	function point(angle: number, radius: number): [number, number] {
		const rad = (angle * Math.PI) / 180;
		return [CENTER + radius * Math.cos(rad), CENTER - radius * Math.sin(rad)];
	}

	function round(value: number): number {
		return Math.round(value * 100) / 100;
	}

	function arc(from: number, to: number): string {
		const [x1, y1] = point(angleOf(from), ARC_RADIUS);
		const [x2, y2] = point(angleOf(to), ARC_RADIUS);
		const large = angleOf(from) - angleOf(to) > 180 ? 1 : 0;
		return `M${round(x1)},${round(y1)} A${ARC_RADIUS},${ARC_RADIUS} 0 ${large} 1 ${round(x2)},${round(y2)}`;
	}

	let runningEnd = $derived(clamp(running));
	let total = $derived(clamp(amount(running) + amount(ownership)));
	let sweepDegrees = $derived((SWEEP * total) / scale);

	let ticks = $derived(
		Array.from({ length: 4 * MINOR_STEPS + 1 }, (_, i) => {
			const value = (scale * i) / (4 * MINOR_STEPS);
			const major = i % MINOR_STEPS === 0;
			const angle = angleOf(value);
			const [x1, y1] = point(angle, 95);
			const [x2, y2] = point(angle, major ? 80 : 88);
			const [lx, ly] = point(angle, 66);
			return { value, major, x1, y1, x2, y2, lx, ly: ly + 5 };
		})
	);

	let needle = $derived.by(() => {
		const angle = angleOf(total);
		const [x1, y1] = point(angle + 180, 16);
		const [x2, y2] = point(angle, 86);
		return { x1, y1, x2, y2 };
	});
</script>

<svg
	class="dial block w-full max-w-50 lg:max-w-80 {className}"
	viewBox="0 0 220 220"
	role="img"
	aria-label={label}
	data-slot="dial"
>
	<circle class="fill-surface stroke-border-strong" cx="110" cy="110" r="104" stroke-width="7" />
	{#if runningEnd > 0}
		<path
			data-arc="running"
			d={arc(0, runningEnd)}
			fill="none"
			stroke={costBucketColor('upkeep')}
			stroke-width="7"
		/>
	{/if}
	{#if total > runningEnd}
		<path
			data-arc="ownership"
			d={arc(runningEnd, total)}
			fill="none"
			stroke={costBucketColor('ownership')}
			stroke-width="7"
		/>
	{/if}
	{#each ticks as tick, i (i)}
		<line
			class="stroke-foreground"
			x1={tick.x1}
			y1={tick.y1}
			x2={tick.x2}
			y2={tick.y2}
			stroke-width={tick.major ? 2.4 : 1.1}
		/>
		{#if tick.major}
			<text class="dial-figure fill-foreground" x={tick.lx} y={tick.ly} text-anchor="middle">
				{formatNumberUpTo(tick.value, 1)}
			</text>
		{/if}
	{/each}
	<g class="dial-needle" style="--dial-sweep: {sweepDegrees}deg" data-slot="dial-needle">
		<line
			class="stroke-needle"
			x1={needle.x1}
			y1={needle.y1}
			x2={needle.x2}
			y2={needle.y2}
			stroke-width="3.4"
			stroke-linecap="round"
		/>
	</g>
	<circle class="fill-needle" cx="110" cy="110" r="8" />
	<circle class="fill-surface" cx="110" cy="110" r="3" />
	<text class="dial-caption fill-foreground" x="110" y="145" text-anchor="middle">{caption}</text>
	<text
		class="dial-value fill-foreground"
		x="110"
		y="178"
		text-anchor="middle"
		font-size={valueLabel.length > 5 ? 20 : valueLabel.length > 3 ? 26 : 34}
	>
		{valueLabel}
	</text>
</svg>

<style>
	.dial {
		font-family: var(--font-fig, 'Barlow Condensed', var(--font-sans, ui-sans-serif), sans-serif);
		font-variant-numeric: tabular-nums;
	}

	.dial-figure {
		font-size: 16px;
		font-weight: 500;
	}

	.dial-caption {
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.dial-value {
		font-weight: 700;
	}

	.dial-needle {
		transform-box: view-box;
		transform-origin: 110px 110px;
	}

	@media (prefers-reduced-motion: no-preference) {
		.dial-needle {
			animation: dial-settle 400ms ease-out both;
		}
	}

	@keyframes dial-settle {
		from {
			transform: rotate(calc(-1 * var(--dial-sweep)));
		}
	}
</style>
