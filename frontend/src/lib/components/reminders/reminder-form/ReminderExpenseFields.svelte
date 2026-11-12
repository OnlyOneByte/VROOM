<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import TagInput from '#lib/components/expenses/form/TagInput.svelte';
	import { categoryLabels } from '#lib/utils/expense-helpers.ts';
	import type { ReminderFormState } from './reminder-form-state.svelte';
	import { EXPENSE_CATEGORIES } from './reminder-form-model';

	interface Props {
		form: ReminderFormState;
	}

	let { form }: Props = $props();
</script>

<div class="grid grid-cols-2 gap-3">
	<div class="space-y-2">
		<Label for="reminder-expense-category">Category *</Label>
		<Select.Root type="single" bind:value={form.values.expenseCategory}>
			<Select.Trigger id="reminder-expense-category" class="w-full">
				{categoryLabels[form.values.expenseCategory]}
			</Select.Trigger>
			<Select.Content>
				{#each EXPENSE_CATEGORIES as c (c)}
					<Select.Item value={c} label={categoryLabels[c]}>{categoryLabels[c]}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<div class="space-y-2">
		<Label for="reminder-expense-amount">Amount *</Label>
		<div class="relative">
			<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
				<span class="text-muted-foreground">$</span>
			</div>
			<Input
				id="reminder-expense-amount"
				type="number"
				step="0.01"
				min="0"
				bind:value={form.values.expenseAmount}
				placeholder="0.00"
				class="pl-8"
				aria-invalid={!!form.errors['expenseAmount']}
			/>
		</div>
		{#if form.errors['expenseAmount']}<FormFieldError>{form.errors['expenseAmount']}</FormFieldError
			>{/if}
	</div>
</div>
<TagInput bind:tags={form.values.expenseTags} />
