<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import { capitalize, toDateInputValue } from '#lib/utils/formatters.ts';
	import type { ReminderFormState } from './reminder-form-state.svelte';
	import { FREQUENCIES, INTERVAL_UNITS } from './reminder-form-model';

	interface Props {
		form: ReminderFormState;
	}

	let { form }: Props = $props();

	let pluralSuffix = $derived(
		form.values.intervalValue && parseInt(form.values.intervalValue, 10) > 1 ? 's' : ''
	);

	const EVERY: Record<string, string> = {
		weekly: 'every week',
		monthly: 'every month',
		yearly: 'every year'
	};
	let every = $derived(
		EVERY[form.values.frequency] ??
			(parseInt(form.values.intervalValue, 10) > 0
				? `every ${parseInt(form.values.intervalValue, 10)} ${form.values.intervalUnit}${pluralSuffix}`
				: null)
	);
	// A new reminder's start date is its first due date, so today means due the moment it's saved.
	let startHint = $derived.by(() => {
		if (!form.isNew || !form.values.startDate) return null;
		const isExpense = form.values.kind === 'expense';
		const first = isExpense ? 'The first expense is added' : 'It’s first due';
		const then = every ? `, then ${every}` : '';
		if (form.values.startDate !== toDateInputValue(new Date()))
			return `${first} on this date${then}.`;
		return isExpense
			? `${first} today${then}, so it’s added right away. Pick a later date if the first one isn’t due yet.`
			: `${first} today${then}, so it’s due as soon as you save. Pick a later date if it isn’t due yet.`;
	});
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
			{#if form.errors['intervalValue']}<FormFieldError>
					{form.errors['intervalValue']}
				</FormFieldError>{/if}
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
		aria-describedby={startHint ? 'reminder-start-hint' : undefined}
	/>
	{#if startHint}
		<p id="reminder-start-hint" class="text-sm text-muted-foreground">{startHint}</p>
	{/if}
</div>

<div class="space-y-2">
	<Label for="reminder-end">End date (optional)</Label>
	<DatePicker
		id="reminder-end"
		bind:value={form.values.endDate}
		placeholder="No end date"
		aria-invalid={!!form.errors['endDate']}
		aria-describedby={form.errors['endDate'] ? 'reminder-end-error' : undefined}
	/>
	{#if form.errors['endDate']}<FormFieldError id="reminder-end-error">
			{form.errors['endDate']}
		</FormFieldError>{/if}
</div>
