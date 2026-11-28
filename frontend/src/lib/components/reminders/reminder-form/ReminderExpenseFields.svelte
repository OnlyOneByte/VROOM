<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import MoneyInput from '#lib/components/common/MoneyInput.svelte';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import TagInput from '#lib/components/expenses/form/TagInput.svelte';
	import { categoryLabels } from '#lib/utils/expense-helpers.ts';
	import type { ReminderFormState } from './reminder-form-state.svelte';
	import { EXPENSE_CATEGORIES, isFuelAllowed } from './reminder-form-model';

	interface Props {
		form: ReminderFormState;
	}

	let { form }: Props = $props();

	const fuelAllowed = $derived(isFuelAllowed(form.values));
</script>

<div class="space-y-2">
	<div class="grid grid-cols-2 gap-3">
		<div class="space-y-2">
			<Label for="reminder-expense-category">Category *</Label>
			<Select.Root type="single" bind:value={form.values.expenseCategory}>
				<Select.Trigger
					id="reminder-expense-category"
					class="w-full"
					aria-invalid={!!form.errors['expenseCategory']}
				>
					{categoryLabels[form.values.expenseCategory]}
				</Select.Trigger>
				<Select.Content>
					{#each EXPENSE_CATEGORIES as c (c)}
						{@const unavailable = c === 'fuel' && !fuelAllowed}
						<Select.Item value={c} label={categoryLabels[c]} disabled={unavailable}>
							{categoryLabels[c]}{#if unavailable}<span class="sr-only">, </span><span
									class="text-xs text-muted-foreground"
								>
									One vehicle only
								</span>{/if}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="reminder-expense-amount">Amount *</Label>
			<MoneyInput
				id="reminder-expense-amount"
				currency={form.currency}
				bind:value={form.values.expenseAmount}
				aria-invalid={!!form.errors['expenseAmount']}
				aria-describedby={form.errors['expenseAmount']
					? 'reminder-expense-amount-error'
					: undefined}
			/>
			{#if form.errors['expenseAmount']}<FormFieldError id="reminder-expense-amount-error">
					{form.errors['expenseAmount']}
				</FormFieldError>{/if}
		</div>
	</div>
	{#if form.errors['expenseCategory']}<FormFieldError>
			{form.errors['expenseCategory']}
		</FormFieldError>{/if}
</div>
<TagInput bind:tags={form.values.expenseTags} />
