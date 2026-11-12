<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import { capitalize } from '#lib/utils/formatters.ts';
	import type { ReminderFormState } from './reminder-form-state.svelte';
	import { FREQUENCIES, INTERVAL_UNITS } from './reminder-form-model';

	interface Props {
		form: ReminderFormState;
	}

	let { form }: Props = $props();

	let pluralSuffix = $derived(
		form.values.intervalValue && parseInt(form.values.intervalValue, 10) > 1 ? 's' : ''
	);
</script>

<div class="space-y-2">
	<Label for="reminder-frequency">Frequency *</Label>
	<Select.Root type="single" bind:value={form.values.frequency}>
		<Select.Trigger id="reminder-frequency" class="w-full">
			{capitalize(form.values.frequency)}
		</Select.Trigger>
		<Select.Content>
			{#each FREQUENCIES as f (f)}
				<Select.Item value={f} label={capitalize(f)}>
					{capitalize(f)}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
</div>

{#if form.values.frequency === 'custom'}
	<div class="grid grid-cols-2 gap-3">
		<div class="space-y-2">
			<Label for="reminder-interval-value">Every</Label>
			<Input
				id="reminder-interval-value"
				type="number"
				min="1"
				bind:value={form.values.intervalValue}
				placeholder="3"
				aria-invalid={!!form.errors['intervalValue']}
			/>
			{#if form.errors['intervalValue']}<FormFieldError
					>{form.errors['intervalValue']}</FormFieldError
				>{/if}
		</div>
		<div class="space-y-2">
			<Label for="reminder-interval-unit">Unit</Label>
			<Select.Root type="single" bind:value={form.values.intervalUnit}>
				<Select.Trigger id="reminder-interval-unit" class="w-full">
					{form.values.intervalUnit}{pluralSuffix}
				</Select.Trigger>
				<Select.Content>
					{#each INTERVAL_UNITS as u (u)}
						<Select.Item value={u} label={u}>{u}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>
{/if}

<div class="space-y-2">
	<Label for="reminder-start">Start date *</Label>
	<DatePicker
		id="reminder-start"
		bind:value={form.values.startDate}
		placeholder="Select start date"
	/>
</div>

<div class="space-y-2">
	<Label for="reminder-end">End date (optional)</Label>
	<DatePicker id="reminder-end" bind:value={form.values.endDate} placeholder="No end date" />
	{#if form.errors['endDate']}<FormFieldError>{form.errors['endDate']}</FormFieldError>{/if}
</div>
