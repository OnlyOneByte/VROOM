<script lang="ts">
	import { ArrowLeft, Shield, Trash2 } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { categoryLabels } from '#lib/utils/expense-helpers.ts';
	import { formatCurrency, formatDate, dateOnlyToISO } from '#lib/utils/formatters.ts';
	import ExpensePhotoSection from '../ExpensePhotoSection.svelte';
	import ExpenseFormHeader from './ExpenseFormHeader.svelte';

	interface Props {
		category: string;
		amount: string;
		date: string;
		description: string;
		tags: string[];
		policyId: string | null;
		photoEntityId: string | null;
		isDeleting: boolean;
		onBack: () => void;
		onEditTerm: () => void;
		onForceDelete: () => void;
	}

	let {
		category,
		amount,
		date,
		description,
		tags,
		policyId,
		photoEntityId,
		isDeleting,
		onBack,
		onEditTerm,
		onForceDelete
	}: Props = $props();
</script>

<div class="space-y-6">
	<ExpenseFormHeader title="Insurance Expense" {onBack}>
		{#snippet subtitle()}This expense is managed by an insurance policy{/snippet}
	</ExpenseFormHeader>

	<div class="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
		<Shield class="mt-0.5 h-5 w-5 shrink-0 text-chart-3" />
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium text-foreground">Managed by insurance policy</p>
			<p class="mt-1 text-xs text-muted-foreground">
				This expense was automatically created from an insurance term. To change the amount or
				split, edit the insurance policy term.
			</p>
			{#if policyId}
				<Button variant="outline" size="sm" class="mt-3" onclick={onEditTerm}>
					<Shield class="mr-2 h-4 w-4" />
					Edit Insurance Term
				</Button>
			{/if}
		</div>
	</div>

	<div class="rounded-lg border bg-card p-6 space-y-4">
		<div class="grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="text-muted-foreground">Category</p>
				<p class="font-medium text-foreground">
					{categoryLabels[category as keyof typeof categoryLabels] ?? category}
				</p>
			</div>
			<div>
				<p class="text-muted-foreground">Total Amount</p>
				<p class="font-medium text-foreground">
					{formatCurrency(parseFloat(amount) || 0)}
				</p>
			</div>
			<div>
				<p class="text-muted-foreground">Date</p>
				<p class="font-medium text-foreground">
					{formatDate(dateOnlyToISO(date))}
				</p>
			</div>
			{#if description}
				<div>
					<p class="text-muted-foreground">Description</p>
					<p class="font-medium text-foreground">{description}</p>
				</div>
			{/if}
		</div>
		{#if tags.length > 0}
			<div>
				<p class="text-sm text-muted-foreground">Tags</p>
				<div class="mt-1 flex flex-wrap gap-1">
					{#each tags as tag (tag)}
						<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{tag}</span>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	{#if photoEntityId !== null}
		<div class="rounded-lg border bg-card p-6">
			<ExpensePhotoSection entityType="expense" entityId={photoEntityId} />
		</div>
	{/if}

	<div class="flex justify-center gap-3">
		<Button variant="outline" onclick={onBack}>
			<ArrowLeft class="mr-2 h-4 w-4" />
			Back to Expenses
		</Button>
		<Button variant="destructive" onclick={onForceDelete} disabled={isDeleting}>
			<Trash2 class="mr-2 h-4 w-4" />
			Force Delete
		</Button>
	</div>
</div>
