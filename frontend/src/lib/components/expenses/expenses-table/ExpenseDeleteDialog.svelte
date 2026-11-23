<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import type { Expense } from '#lib/types/index.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import { getCategoryBadgeClasses, getCategoryIcon } from '#lib/utils/expense-helpers.ts';

	interface Props {
		open: boolean;
		expense: Expense | null;
		onConfirm: () => Promise<void>;
	}

	let { open = $bindable(), expense, onConfirm }: Props = $props();
</script>

<ConfirmDialog
	bind:open
	title="Delete Expense"
	description={expense?.groupId
		? "This is a split expense shared across multiple vehicles. Deleting it removes the entire split — every vehicle's portion — not just one. This action cannot be undone."
		: 'Are you sure you want to delete this expense? This action cannot be undone.'}
	{onConfirm}
>
	{#if expense}
		{@const IconComponent = getCategoryIcon(expense.category)}
		<div class="bg-muted rounded-lg p-3">
			<div class="flex items-center gap-3">
				<div class="p-2 rounded-lg {getCategoryBadgeClasses(expense.category)}">
					<IconComponent class="h-4 w-4" />
				</div>
				<div class="flex-1">
					<p class="font-medium text-foreground">
						{expense.description || expense.tags?.join(', ') || 'Expense'}
					</p>
					<p class="text-sm text-muted-foreground">
						{formatDate(new Date(expense.date))} • {formatCurrency(expense.amount)}
					</p>
					{#if expense.tags && expense.tags.length > 0}
						<div class="flex flex-wrap gap-1 mt-2">
							{#each expense.tags as tag (tag)}
								<Badge variant="secondary" class="font-normal">
									{tag}
								</Badge>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</ConfirmDialog>
