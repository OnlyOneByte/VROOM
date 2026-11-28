<script lang="ts">
	import Input from '#lib/components/ui/input/input.svelte';
	import Label from '#lib/components/ui/label/label.svelte';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import MoneyInput from '#lib/components/common/MoneyInput.svelte';
	import { amountPlaceholder, amountStep, getCurrencySymbol } from '#lib/utils/formatters.ts';

	interface Props {
		amount: string;
		amountError?: string;
		ref?: HTMLInputElement | null;
		quick?: boolean;
		onAmountBlur: () => void;
		currency?: string;
	}

	let {
		amount = $bindable(),
		amountError,
		ref = $bindable(null),
		quick = false,
		onAmountBlur,
		currency
	}: Props = $props();

	const currencySymbol = $derived(getCurrencySymbol(currency));
	const numberClass =
		'[appearance:textfield] rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent aria-invalid:ring-0 aria-invalid:border-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
</script>

<div class="min-w-0 {quick ? 'space-y-1 text-center' : 'space-y-2'}">
	<Label for="amount" class={quick ? 'sr-only' : ''}>Amount *</Label>
	{#if quick}
		<div
			class="inline-flex max-w-full items-start justify-center gap-1 border-b-2 font-(family-name:--font-fig) font-bold transition-colors {amountError
				? 'border-destructive text-destructive'
				: 'border-transparent text-foreground focus-within:border-needle'}"
			data-testid="quick-amount-figure"
		>
			<span
				class="mt-1.5 text-3xl leading-none sm:mt-2 sm:text-5xl {amount
					? ''
					: 'text-muted-foreground/40'}"
				aria-hidden="true"
			>
				{currencySymbol}
			</span>
			<Input
				bind:ref
				id="amount"
				type="number"
				inputmode="decimal"
				step={amountStep(currency)}
				min="0"
				bind:value={amount}
				placeholder={amountPlaceholder(currency)}
				class="h-auto min-w-[3ch] py-0 text-center text-7xl leading-none tabular-nums caret-needle placeholder:text-muted-foreground/40 [field-sizing:content] sm:h-auto sm:text-8xl md:text-8xl {numberClass}"
				onblur={onAmountBlur}
				aria-invalid={!!amountError}
				aria-describedby={amountError ? 'amount-error' : undefined}
			/>
		</div>
	{:else}
		<MoneyInput
			bind:ref
			id="amount"
			{currency}
			bind:value={amount}
			onblur={onAmountBlur}
			aria-invalid={!!amountError}
			aria-describedby={amountError ? 'amount-error' : undefined}
		/>
	{/if}
	{#if amountError}
		<FormFieldError id="amount-error">{amountError}</FormFieldError>
	{/if}
</div>
