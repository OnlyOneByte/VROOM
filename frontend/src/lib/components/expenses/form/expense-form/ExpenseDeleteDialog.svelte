<script lang="ts">
	import { LoaderCircle, Save } from '@lucide/svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import type { Expense } from '#lib/types/index.ts';

	interface Props {
		open: boolean;
		isInsuranceManaged: boolean;
		isGroupEditMode: boolean;
		groupId: string | null;
		originalExpense: Expense | null;
		isDeleting: boolean;
		onConfirm: () => void;
	}

	let {
		open = $bindable(),
		isInsuranceManaged,
		isGroupEditMode,
		groupId,
		originalExpense,
		isDeleting,
		onConfirm
	}: Props = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Expense</AlertDialog.Title>
			<AlertDialog.Description>
				{#if isInsuranceManaged && groupId}
					This will delete the insurance expense group and all its child expenses. This action
					cannot be undone.
				{:else if isGroupEditMode && groupId}
					This is a split expense shared across multiple vehicles. Deleting it removes the entire
					split — every vehicle's portion — not just one. This action cannot be undone.
				{:else}
					Are you sure you want to delete this expense? This action cannot be undone.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>

		{#if originalExpense}
			<div class="bg-muted rounded-lg p-3">
				<div class="flex items-center gap-3">
					<div class="p-2 rounded-lg bg-destructive/10 text-destructive">
						<Save class="h-4 w-4" />
					</div>
					<div>
						<p class="font-medium text-foreground">
							{originalExpense.description || originalExpense.tags?.join(', ') || 'Expense'}
						</p>
						<p class="text-sm text-muted-foreground">
							{formatCurrency(originalExpense.amount)} on {new Date(
								originalExpense.date
							).toLocaleDateString()}
						</p>
					</div>
				</div>
			</div>
		{/if}

		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={isDeleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={onConfirm}
				disabled={isDeleting}
				class="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
			>
				{#if isDeleting}
					<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
					Deleting...
				{:else}
					Delete Expense
				{/if}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
