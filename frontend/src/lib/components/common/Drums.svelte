<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { currentLocale, formatCurrency } from '#lib/utils/formatters.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';

	interface Props {
		amount: number;
		currency?: string;
		cents?: boolean;
		size?: 'sm' | 'lg';
		class?: string;
	}

	let { amount, currency, cents = false, size = 'sm', class: className = '' }: Props = $props();

	type Cell = { key: string; char: string; kind: 'digit' | 'cent' | 'sep' };

	let currencyCode = $derived(currency || settingsStore.settings?.currencyUnit || 'USD');
	let fractionDigits = $derived(cents ? undefined : 0);
	let value = $derived(Number.isFinite(amount) ? amount : 0);
	let label = $derived(formatCurrency(value, currencyCode, fractionDigits));

	let cells = $derived.by((): Cell[] => {
		const parts = new Intl.NumberFormat(currentLocale(), {
			style: 'currency',
			currency: currencyCode,
			...(fractionDigits === 0 && { minimumFractionDigits: 0, maximumFractionDigits: 0 })
		}).formatToParts(value);
		const out: Cell[] = [];
		for (const part of parts) {
			if (part.type === 'group' || part.type === 'literal') continue;
			const kind = part.type === 'integer' ? 'digit' : part.type === 'fraction' ? 'cent' : 'sep';
			for (const char of kind === 'sep' ? [part.value] : [...part.value]) {
				out.push({ key: '', char, kind });
			}
		}
		return out.map((cell, i) => ({ ...cell, key: `${out.length - i}` }));
	});

	function roll(_node: Element) {
		return {
			duration: prefersReducedMotion.current ? 0 : 300,
			css: (t: number) => `transform: translateY(${(1 - t) * -100}%)`
		};
	}
</script>

<span
	class="drums inline-flex w-max shrink-0 flex-nowrap whitespace-nowrap bg-bar {size === 'lg'
		? 'drums-lg'
		: 'drums-sm'} {className}"
	style="--drum-cells: {cells.length}"
	role="img"
	aria-label={label}
	data-slot="drums"
>
	{#each cells as cell (cell.key)}
		<span
			class="drum-cell {cell.kind === 'sep'
				? 'drum-sep text-bar-fg'
				: cell.kind === 'cent'
					? 'bg-bar-on text-bar'
					: 'drum-digit text-bar-on'}"
			data-kind={cell.kind}
			aria-hidden="true"
		>
			{#key cell.char}
				<span class="block" in:roll>{cell.char}</span>
			{/key}
		</span>
	{/each}
</span>

<style>
	.drums {
		gap: 0.08em;
		padding: 0.15em;
		font-family: var(--font-fig, 'Barlow Condensed', var(--font-sans, ui-sans-serif), sans-serif);
		font-size: min(var(--drum-size), calc((100vw - 2.5rem) / (var(--drum-cells) * 0.96)));
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.drum-cell {
		display: grid;
		place-items: center;
		width: 0.86em;
		height: 1.3em;
		overflow: hidden;
	}

	.drum-sep {
		width: auto;
		min-width: 0.5em;
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
</style>
