<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import TagInput from '#lib/components/expenses/form/TagInput.svelte';
	import { categoryLabels } from '#lib/utils/expense-helpers.ts';
	import { amountPlaceholder, amountStep, getCurrencySymbol } from '#lib/utils/formatters.ts';
	import type { ReminderFormState } from './reminder-form-state.svelte';
	import { EXPENSE_CATEGORIES, isFuelAllowed } from './reminder-form-model';

	interface Props {
		form: ReminderFormState;
	}

	let { form }: Props = $props();

	const currencySymbol = $derived(getCurrencySymbol(form.currency));
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
			<div class="relative">
				<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
					<span class="text-muted-foreground">{currencySymbol}</span>
				</div>
				<Input
					id="reminder-expense-amount"
					type="number"
					step={amountStep(form.currency)}
					min="0"
					bind:value={form.values.expenseAmount}
					placeholder={amountPlaceholder(form.currency)}
					class={currencySymbol.length > 1 ? 'pl-14' : 'pl-8'}
					aria-invalid={!!form.errors['expenseAmount']}
				/>
			</div>
			{#if form.errors['expenseAmount']}<FormFieldError>
					{form.errors['expenseAmount']}
				</FormFieldError>{/if}
		</div>
	</div>
	{#if form.errors['expenseCategory']}<FormFieldError>
			{form.errors['expenseCategory']}
		</FormFieldError>{/if}
</div>
<TagInput bind:tags={form.values.expenseTags} />
