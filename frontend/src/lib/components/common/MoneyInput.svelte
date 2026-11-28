<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { amountStep, getCurrencySymbol } from '#lib/utils/formatters.ts';

	interface Props {
		id: string;
		value?: number | null | undefined;
		currency?: string;
		min?: string;
		required?: boolean;
		'aria-invalid'?: boolean;
		'aria-describedby'?: string | undefined;
	}

	let {
		id,
		value = $bindable(),
		currency,
		min = '0',
		required,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby
	}: Props = $props();

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
		{id}
		type="number"
		inputmode="decimal"
		step={amountStep(currency)}
		{min}
		{required}
		bind:value
		aria-invalid={ariaInvalid}
		aria-describedby={ariaDescribedby}
		style="padding-left: calc(1.125rem + {symbol.length}ch)"
		class="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
	/>
</div>
