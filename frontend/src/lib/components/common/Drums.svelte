<script lang="ts">
	import { onMount } from 'svelte';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';

	interface Props {
		amount: number;
		currency?: string;
		cents?: boolean;
		size?: 'sm' | 'lg';
		class?: string;
	}

	let { amount, currency, cents = false, size = 'sm', class: className = '' }: Props = $props();

	type Cell = { key: string; char: string; kind: 'digit' | 'cent' | 'sep'; width: number };

	const DIGIT_EM = 0.86;
	const SEP_EM_PER_CHAR = 0.55;
	const SEP_MIN_EM = 0.5;
	const GAP_EM = 0.08;
	const PADDING_EM = 0.3;

	let value = $derived(Number.isNaN(amount) ? 0 : amount);
	let label = $derived(formatCurrency(value, currency, cents ? undefined : 0));
	let decimalMark = $derived(formatNumber(1.5, 1).replace(/\d/g, ''));
	let groupMark = $derived(formatNumber(1000, 0).replace(/\d/g, ''));

	function sepCell(char: string): Cell {
		return {
			key: '',
			char,
			kind: 'sep',
			width: Math.max(SEP_MIN_EM, SEP_EM_PER_CHAR * char.length)
		};
	}

	let cells = $derived.by((): Cell[] => {
		const out: Cell[] = [];
		let pending = '';
		let afterDecimal = false;
		const flush = () => {
			const text = pending.trim();
			if (text) out.push(sepCell(text));
			pending = '';
		};
		for (const char of label) {
			if (/\d/.test(char)) {
				flush();
				out.push({ key: '', char, kind: afterDecimal ? 'cent' : 'digit', width: DIGIT_EM });
			} else if (cents && char === decimalMark && !afterDecimal) {
				flush();
				afterDecimal = true;
				out.push(sepCell(char));
			} else if (groupMark && char === groupMark && !afterDecimal) {
				continue;
			} else {
				pending += char.replace(/\s/u, ' ');
			}
		}
		flush();
		return out.map((cell, i) => ({ ...cell, key: `${out.length - i}` }));
	});

	let widthEm = $derived(
		cells.reduce((sum, cell) => sum + cell.width, 0) +
			GAP_EM * Math.max(cells.length - 1, 0) +
			PADDING_EM
	);

	let mounted = false;
	onMount(() => {
		mounted = true;
	});

	function rollIn(node: HTMLElement) {
		if (mounted) node.dataset['roll'] = '';
	}
</script>

<span
	class="drums inline-flex w-max max-w-full shrink-0 flex-nowrap whitespace-nowrap bg-bar {size ===
	'lg'
		? 'drums-lg'
		: 'drums-sm'} {className}"
	style="--drum-width: {widthEm}"
	role="img"
	aria-label={label}
	data-slot="drums"
>
	{#each cells as cell (cell.key)}
		<span
			class="drum-cell {cell.kind === 'sep'
				? 'text-bar-fg'
				: cell.kind === 'cent'
					? 'bg-bar-on text-bar'
					: 'drum-digit text-bar-on'}"
			style="width: {cell.width}em"
			data-kind={cell.kind}
			aria-hidden="true"
		>
			{#key cell.char}
				<span class="block" use:rollIn>{cell.char}</span>
			{/key}
		</span>
	{/each}
</span>

<style>
	.drums {
		gap: 0.08em;
		padding: 0.15em;
		font-family: var(--font-fig, 'Barlow Condensed', var(--font-sans, ui-sans-serif), sans-serif);
		font-size: min(var(--drum-size), calc((100cqi - 2.5rem) / var(--drum-width)));
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.drum-cell {
		display: grid;
		flex: none;
		place-items: center;
		height: 1.3em;
		overflow: hidden;
	}

	.drum-digit {
		background-color: color-mix(in oklch, var(--bar-on) 9%, var(--bar));
	}

	.drums-sm {
		--drum-size: 26px;
		border-radius: 8px;
	}

	.drums-sm .drum-cell {
		border-radius: 4px;
	}

	.drums-lg {
		--drum-size: 56px;
		border-radius: 10px;
	}

	.drums-lg .drum-cell {
		border-radius: 6px;
	}

	@media (min-width: 64rem) {
		.drums-sm {
			--drum-size: 34px;
		}

		.drums-lg {
			--drum-size: 74px;
		}
	}

	@media (prefers-reduced-motion: no-preference) {
		.drums :global([data-roll]) {
			animation: drum-roll 300ms ease-out;
		}
	}

	@keyframes drum-roll {
		from {
			transform: translateY(100%);
		}
	}
</style>
