<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { amountStep, getCurrencySymbol } from '#lib/utils/formatters.ts';

	type Props = Omit<HTMLInputAttributes, 'type' | 'value' | 'step'> & {
		value?: number | null | undefined;
		currency?: string;
	};

	let { value = $bindable(), currency, min = '0', ...restProps }: Props = $props();

	let symbol = $derived(getCurrencySymbol(currency));
	let empty = $derived(value === null || value === undefined || (value as unknown) === '');
</script>

<div class="relative">
	<span
		class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-base md:text-sm {empty
			? 'text-muted-foreground'
			: 'text-foreground'}"
		aria-hidden="true"
	>
		{symbol}
	</span>
	<Input
		type="number"
		inputmode="decimal"
		step={amountStep(currency)}
		{min}
		bind:value
		style="padding-left: calc(1.125rem + {symbol.length}ch)"
		class="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
		{...restProps}
	/>
</div>
