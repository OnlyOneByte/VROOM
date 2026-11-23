<script lang="ts">
	import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_INFO } from '#lib/constants/expense-categories.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { getCategoryIcon } from '#lib/utils/expense-helpers.ts';

	interface Props {
		value: string;
		error?: string;
		touched?: boolean;
		onSelect: (_value: string) => void;
	}

	let { value, error, touched = false, onSelect }: Props = $props();

	const categories = EXPENSE_CATEGORIES.map(value => ({ value, ...EXPENSE_CATEGORY_INFO[value] }));
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
					<div class="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
						<Icon
							class="h-5 w-5 shrink-0 {value === category.value
								? 'text-primary'
								: 'text-muted-foreground'}"
						/>
						<span class="font-medium text-sm text-foreground">
							{category.shortLabel}
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
