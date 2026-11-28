<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { amountStep, currencyName, getCurrencySymbol } from '#lib/utils/formatters.ts';

	interface Props {
		id: string;
		value?: number | string | null | undefined;
		ref?: HTMLInputElement | null;
		currency?: string;
		min?: string;
		required?: boolean;
		placeholder?: string;
		onblur?: () => void;
		'aria-invalid'?: boolean;
		'aria-describedby'?: string | undefined;
	}

	let {
		id,
		value = $bindable(),
		ref = $bindable(null),
		currency,
		min = '0',
		required,
		placeholder,
		onblur,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby
	}: Props = $props();

	let symbol = $derived(getCurrencySymbol(currency));
	let empty = $derived(value === null || value === undefined || value === '');
	let symbolWidth = $state(0);
	let padding = $derived(
		symbolWidth > 0 ? `calc(${symbolWidth}px + 1.25rem)` : `calc(1.125rem + ${symbol.length}ch)`
	);
	let describedBy = $derived([ariaDescribedby, `${id}-currency`].filter(Boolean).join(' '));
</script>

<div class="relative">
	<span
		bind:clientWidth={symbolWidth}
		class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-base md:text-sm {empty
			? 'text-muted-foreground'
			: 'text-foreground'}"
		aria-hidden="true"
	>
		{symbol}
	</span>
	<span id="{id}-currency" class="sr-only">Currency: {currencyName(currency)}</span>
	<Input
		bind:ref
		{id}
		type="number"
		inputmode="decimal"
		step={amountStep(currency)}
		{min}
		{required}
		{placeholder}
		{onblur}
		bind:value
		aria-invalid={ariaInvalid}
		aria-describedby={describedBy}
		style="padding-left: {padding}"
		class="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
	/>
</div>
