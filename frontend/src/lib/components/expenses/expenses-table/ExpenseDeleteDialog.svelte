<script lang="ts">
	import { LoaderCircle, Trash2 } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle
	} from '$lib/components/ui/alert-dialog';
	import type { Expense } from '$lib/types';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { getCategoryBadgeClasses, getCategoryIcon } from '$lib/utils/expense-helpers';

	interface Props {
		open: boolean;
		expense: Expense | null;
		isDeleting: boolean;
		onConfirm: () => void;
	}

	let { open = $bindable(), expense, isDeleting, onConfirm }: Props = $props();
</script>

<AlertDialog bind:open>
	<AlertDialogContent>
		<AlertDialogHeader>
			<AlertDialogTitle>Delete Expense</AlertDialogTitle>
			<AlertDialogDescription>
				{#if expense?.groupId}
					This is a split expense shared across multiple vehicles. Deleting it removes the entire
					split — every vehicle's portion — not just one. This action cannot be undone.
				{:else}
					Are you sure you want to delete this expense? This action cannot be undone.
				{/if}
			</AlertDialogDescription>
		</AlertDialogHeader>

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

		<AlertDialogFooter>
			<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
			<AlertDialogAction
				onclick={onConfirm}
				disabled={isDeleting}
				class="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
			>
				{#if isDeleting}
					<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
					Deleting...
				{:else}
					<Trash2 class="h-4 w-4 mr-2" />
					Delete
				{/if}
			</AlertDialogAction>
		</AlertDialogFooter>
	</AlertDialogContent>
</AlertDialog>
