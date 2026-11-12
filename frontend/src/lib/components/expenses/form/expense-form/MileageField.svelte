<script lang="ts">
	import { Gauge } from '@lucide/svelte';
	import Input from '#lib/components/ui/input/input.svelte';
	import Label from '#lib/components/ui/label/label.svelte';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';

	interface Props {
		value?: string;
		required: boolean;
		error?: string;
		previousFuelMileage: number | null;
		distanceLabel: string;
		onInput: () => void;
		onBlur: () => void;
	}

	let {
		value = $bindable(''),
		required,
		error,
		previousFuelMileage,
		distanceLabel,
		onInput,
		onBlur
	}: Props = $props();
</script>

<div class="space-y-2">
	<Label for="mileage">
		Current Mileage {required ? '*' : '(Optional)'}
	</Label>
	<div class="relative">
		<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
			<Gauge class="h-5 w-5 text-muted-foreground" />
		</div>
		<Input
			id="mileage"
			type="number"
			min="0"
			bind:value
			placeholder="123456"
			class="pl-10"
			oninput={onInput}
			onblur={onBlur}
			aria-invalid={!!error}
			aria-describedby={error ? 'mileage-error' : undefined}
		/>
	</div>
	{#if previousFuelMileage}
		<p class="text-xs text-muted-foreground">
			Previous fuel entry: {previousFuelMileage.toLocaleString()}
			{distanceLabel.toLowerCase()}
		</p>
	{/if}
	{#if error}
		<FormFieldError id="mileage-error">{error}</FormFieldError>
	{/if}
</div>
