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
