<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
	import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_INFO } from '#lib/constants/expense-categories.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { RadioGroup } from '#lib/components/ui/radio-group/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';

	interface Props {
		value: string;
		error?: string;
		touched?: boolean;
		disabledValues?: readonly string[];
		onSelect: (_value: string) => void;
	}

	let { value, error, touched = false, disabledValues = [], onSelect }: Props = $props();

	let showError = $derived(touched && !!error);

	const categories = EXPENSE_CATEGORIES.map(value => ({ value, ...EXPENSE_CATEGORY_INFO[value] }));
</script>

<div class="space-y-2">
	<Label id="category-label">Category *</Label>
	<RadioGroup
		{value}
		onValueChange={next => {
			if (next && next !== value) onSelect(next);
		}}
		orientation="horizontal"
		class="flex flex-wrap gap-2 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2 ring-offset-background"
		tabindex={-1}
		aria-labelledby="category-label"
		aria-invalid={showError ? 'true' : undefined}
		aria-describedby={showError ? 'category-error' : undefined}
	>
		{#each categories as category (category.value)}
			{@const checked = value === category.value}
			<RadioGroupPrimitive.Item
				value={category.value}
				disabled={disabledValues.includes(category.value)}
				aria-describedby="category-{category.value}-description"
				class="inline-flex h-10 items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 {checked
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground'} {showError
					? 'border-destructive'
					: ''}"
			>
				{category.shortLabel}
			</RadioGroupPrimitive.Item>
		{/each}
	</RadioGroup>
	<div hidden>
		{#each categories as category (category.value)}
			<span id="category-{category.value}-description">{category.description}</span>
		{/each}
	</div>
	{#if showError}
		<FormFieldError id="category-error">{error}</FormFieldError>
	{/if}
</div>
