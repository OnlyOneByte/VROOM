<script lang="ts">
	import type { ExpenseCategory } from '$lib/types';
	import { Label } from '$lib/components/ui/label';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import { getCategoryIcon } from '$lib/utils/expense-helpers';

	interface Props {
		value: string;
		error?: string;
		touched?: boolean;
		onSelect: (_value: string) => void;
	}

	let { value, error, touched = false, onSelect }: Props = $props();

	/**
	 * The picker's own short labels, NOT the canonical `categoryLabels`: these cards share a 2-col
	 * mobile grid, where a multi-word label wraps to a second line and floats the icon mid-card,
	 * breaking the row rhythm against its single-line siblings. Each description carries the detail
	 * the one-word label drops — including, for `fuel`, that the bucket also holds EV charging
	 * (the canonical label is "Fuel & Charging"). Icons come from the shared `CATEGORY_ICONS`
	 * assignment so the icon on the card a user picks is the icon the table then shows the row with.
	 */
	const categories = [
		{ value: 'fuel', label: 'Fuel', description: 'Gas, diesel, and EV charging' },
		{
			value: 'maintenance',
			label: 'Maintenance',
			description: 'Keeping the car running'
		},
		{
			value: 'financial',
			label: 'Financial',
			description: 'Insurance, loan payment, lease payment, etc'
		},
		{
			value: 'regulatory',
			label: 'Regulatory',
			description: 'Registration, tickets, inspections, etc'
		},
		{
			value: 'enhancement',
			label: 'Enhancement',
			description: 'Optional improvements'
		},
		{
			value: 'misc',
			label: 'Misc',
			description: 'Tolls, parking, etc.'
		}
	] as const satisfies readonly { value: ExpenseCategory; label: string; description: string }[];
</script>

<div class="space-y-3">
	<Label for="category">Category *</Label>
	<div
		class="grid grid-cols-2 sm:grid-cols-3 gap-3"
		role="group"
		aria-labelledby="category"
		aria-describedby={touched && error ? 'category-error' : undefined}
	>
		{#each categories as category (category.value)}
			{@const Icon = getCategoryIcon(category.value)}
			<button
				type="button"
				onclick={() => onSelect(category.value)}
				class="p-4 rounded-lg border-2 transition-all text-left {value === category.value
					? 'border-primary bg-primary/5 shadow-md'
					: 'border-input hover:border-muted-foreground/30 bg-background'} {touched && error
					? 'border-destructive'
					: ''}"
				aria-pressed={value === category.value}
			>
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<Icon
							class="h-5 w-5 {value === category.value ? 'text-primary' : 'text-muted-foreground'}"
						/>
						<span class="font-medium text-sm text-foreground">
							{category.label}
						</span>
					</div>
					<p class="text-xs text-muted-foreground">
						{category.description}
					</p>
				</div>
			</button>
		{/each}
	</div>
	{#if touched && error}
		<FormFieldError id="category-error">{error}</FormFieldError>
	{/if}
</div>
