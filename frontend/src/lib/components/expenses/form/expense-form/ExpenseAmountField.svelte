<script lang="ts">
	import Input from '#lib/components/ui/input/input.svelte';
	import Label from '#lib/components/ui/label/label.svelte';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { amountPlaceholder, amountStep, getCurrencySymbol } from '#lib/utils/formatters.ts';

	interface Props {
		amount: string;
		amountError?: string;
		ref?: HTMLInputElement | null;
		onAmountBlur: () => void;
	}

	let { amount = $bindable(), amountError, ref = $bindable(null), onAmountBlur }: Props = $props();

	const currencySymbol = $derived(getCurrencySymbol());
</script>

<div class="space-y-1">
	<Label for="amount">Amount *</Label>
	<div
		class="flex items-baseline gap-1 border-b-2 transition-colors focus-within:border-primary {amountError
			? 'border-destructive'
			: 'border-input'}"
	>
		<span
			class="text-4xl font-bold tracking-tight lg:text-5xl {amount
				? 'text-foreground'
				: 'text-muted-foreground'}"
			aria-hidden="true"
		>
			{currencySymbol}
		</span>
		<Input
			bind:ref
			id="amount"
			type="number"
			inputmode="decimal"
			step={amountStep()}
			min="0"
			bind:value={amount}
			placeholder={amountPlaceholder()}
			class="h-auto [appearance:textfield] rounded-none border-0 bg-transparent px-0 py-1 text-4xl font-bold tracking-tight tabular-nums shadow-none focus-visible:ring-0 sm:h-auto md:text-4xl lg:text-5xl dark:bg-transparent aria-invalid:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			onblur={onAmountBlur}
			aria-invalid={!!amountError}
			aria-describedby={amountError ? 'amount-error' : undefined}
		/>
	</div>
	{#if amountError}
		<FormFieldError id="amount-error">{amountError}</FormFieldError>
	{/if}
</div>
