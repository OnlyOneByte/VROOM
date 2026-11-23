<script lang="ts">
	import { formatNumber } from '#lib/utils/formatters.ts';
	import Input from '#lib/components/ui/input/input.svelte';
	import Label from '#lib/components/ui/label/label.svelte';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';

	interface Props {
		value?: string;
		required: boolean;
		error?: string;
		previousFuelMileage: number | null;
		distanceLabel: string;
		describedBy?: string;
		onInput: () => void;
		onBlur: () => void;
	}

	let {
		value = $bindable(''),
		required,
		error,
		previousFuelMileage,
		distanceLabel,
		describedBy,
		onInput,
		onBlur
	}: Props = $props();

	const lastReading = $derived(previousFuelMileage ? formatNumber(previousFuelMileage, 0) : null);
</script>

<div class="min-w-0 space-y-2">
	<Label for="mileage">
		Odometer {required ? '*' : '(Optional)'}
	</Label>
	<div class="relative">
		<Input
			id="mileage"
			type="number"
			inputmode="numeric"
			min="0"
			bind:value
			placeholder={lastReading ? undefined : '123456'}
			class="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none {lastReading
				? 'pr-24'
				: ''}"
			oninput={onInput}
			onblur={onBlur}
			aria-invalid={!!error}
			aria-describedby={[
				error ? 'mileage-error' : null,
				lastReading ? 'mileage-last' : null,
				describedBy
			]
				.filter(Boolean)
				.join(' ') || undefined}
		/>
		{#if lastReading}
			<span
				class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground tabular-nums"
				aria-hidden="true"
			>
				last {lastReading}
			</span>
			<span id="mileage-last" class="sr-only">
				Previous fuel entry: {lastReading}
				{distanceLabel.toLowerCase()}
			</span>
		{/if}
	</div>
	{#if error}
		<FormFieldError id="mileage-error">{error}</FormFieldError>
	{/if}
</div>
