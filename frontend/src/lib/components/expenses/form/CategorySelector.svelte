<script lang="ts">
	import { Fuel, Wrench, CreditCard, FileText, Sparkles, Coffee } from '@lucide/svelte';
	import { Label } from '$lib/components/ui/label';
	import { FormFieldError } from '$lib/components/ui/form-field';

	interface Props {
		value: string;
		error?: string;
		touched?: boolean;
		onSelect: (_value: string) => void;
	}

	let { value, error, touched = false, onSelect }: Props = $props();

	const categories = [
		{ value: 'fuel', label: 'Fuel', description: 'Gas and fuel costs', icon: Fuel },
		{
			value: 'maintenance',
			label: 'Maintenance',
			description: 'Keeping the car running',
			icon: Wrench
		},
		{
			value: 'financial',
			label: 'Financial',
			description: 'Insurance, loan payment, lease payment, etc',
			icon: CreditCard
		},
		{
			value: 'regulatory',
			label: 'Regulatory',
			description: 'Registration, tickets, inspections, etc',
			icon: FileText
		},
		{
			value: 'enhancement',
			label: 'Enhancement',
			description: 'Optional improvements',
			icon: Sparkles
		},
		{
			value: 'misc',
			label: 'Misc Operating Costs',
			description: 'Tolls, parking, etc.',
			icon: Coffee
		}
	];
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
			{@const Icon = category.icon}
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
