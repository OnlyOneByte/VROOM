<script lang="ts">
	import DatePicker from '$lib/components/common/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { FormFieldError } from '$lib/components/ui/form-field';

	interface Props {
		date: string;
		amount: string;
		/** Already gated on touched by the parent. */
		dateError?: string;
		/** Already gated on touched by the parent. */
		amountError?: string;
		onAmountBlur: () => void;
	}

	let {
		date = $bindable(),
		amount = $bindable(),
		dateError,
		amountError,
		onAmountBlur
	}: Props = $props();
</script>

<div class="space-y-2">
	<Label for="date">Date *</Label>
	<DatePicker
		id="date"
		bind:value={date}
		placeholder="Select date"
		aria-invalid={!!dateError}
		aria-describedby={dateError ? 'date-error' : undefined}
	/>
	{#if dateError}
		<FormFieldError id="date-error">{dateError}</FormFieldError>
	{/if}
</div>

<div class="space-y-2">
	<Label for="amount">Amount *</Label>
	<div class="relative">
		<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
			<span class="text-muted-foreground">$</span>
		</div>
		<Input
			id="amount"
			type="number"
			step="0.01"
			min="0"
			bind:value={amount}
			placeholder="0.00"
			class="pl-8"
			onblur={onAmountBlur}
			aria-invalid={!!amountError}
			aria-describedby={amountError ? 'amount-error' : undefined}
		/>
	</div>
	{#if amountError}
		<FormFieldError id="amount-error">{amountError}</FormFieldError>
	{/if}
</div>
