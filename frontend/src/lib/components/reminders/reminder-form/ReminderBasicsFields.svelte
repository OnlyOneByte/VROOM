<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import type { ReminderFormState } from './reminder-form-state.svelte';

	interface Props {
		form: ReminderFormState;
	}

	let { form }: Props = $props();
</script>

<div class="space-y-2">
	<Label for="reminder-type">Type *</Label>
	<Select.Root type="single" bind:value={form.values.kind}>
		<Select.Trigger id="reminder-type" class="w-full">
			{form.values.kind === 'expense' ? 'Recurring expense' : 'Notification'}
		</Select.Trigger>
		<Select.Content>
			<Select.Item value="notification" label="Notification">Notification</Select.Item>
			<Select.Item value="expense" label="Recurring expense">Recurring expense</Select.Item>
		</Select.Content>
	</Select.Root>
	<p class="text-xs text-muted-foreground">
		{form.values.kind === 'expense'
			? 'Auto-creates an expense on each due date (e.g. insurance premium, loan payment).'
			: 'Just notifies you when due (e.g. rotate tires, renew registration).'}
	</p>
</div>

<div class="space-y-2">
	<Label for="reminder-name">Name *</Label>
	<Input
		id="reminder-name"
		bind:value={form.values.name}
		placeholder={form.values.kind === 'expense'
			? 'e.g. Car insurance premium'
			: 'e.g. Rotate tires'}
		aria-invalid={!!form.errors['name']}
	/>
	{#if form.errors['name']}<FormFieldError>{form.errors['name']}</FormFieldError>{/if}
</div>

<div class="space-y-2">
	<Label for="reminder-trigger-mode">Trigger when</Label>
	<Select.Root type="single" bind:value={form.values.triggerMode}>
		<Select.Trigger id="reminder-trigger-mode" class="w-full">
			{form.values.triggerMode === 'mileage'
				? 'At a mileage interval'
				: form.values.triggerMode === 'both'
					? 'Time or mileage (whichever first)'
					: 'On a time schedule'}
		</Select.Trigger>
		<Select.Content>
			<Select.Item value="time" label="On a time schedule">On a time schedule</Select.Item>
			<Select.Item value="mileage" label="At a mileage interval">At a mileage interval</Select.Item>
			<Select.Item value="both" label="Time or mileage (whichever first)">
				Time or mileage (whichever first)
			</Select.Item>
		</Select.Content>
	</Select.Root>
	<p class="text-xs text-muted-foreground">
		{form.values.triggerMode === 'mileage'
			? 'Due when the odometer reaches the next service milestone.'
			: form.values.triggerMode === 'both'
				? 'Due on the date OR the mileage milestone, whichever arrives first.'
				: 'Due on a recurring date schedule.'}
	</p>
</div>
