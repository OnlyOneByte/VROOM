<script lang="ts">
	import { Save } from '@lucide/svelte';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { formatCurrency, formatDateWith } from '#lib/utils/formatters.ts';
	import type { Expense } from '#lib/types/index.ts';

	interface Props {
		open: boolean;
		isInsuranceManaged: boolean;
		isGroupEditMode: boolean;
		groupId: string | null;
		originalExpense: Expense | null;
		onConfirm: () => Promise<void>;
	}

	let {
		open = $bindable(),
		isInsuranceManaged,
		isGroupEditMode,
		groupId,
		originalExpense,
		onConfirm
	}: Props = $props();

	let description = $derived(
		isInsuranceManaged && groupId
			? 'This will delete the insurance expense group and all its child expenses. This action cannot be undone.'
			: isGroupEditMode && groupId
				? "This is a split expense shared across multiple vehicles. Deleting it removes the entire split — every vehicle's portion — not just one. This action cannot be undone."
				: 'Are you sure you want to delete this expense? This action cannot be undone.'
	);
</script>

<ConfirmDialog
	bind:open
	title="Delete Expense"
	{description}
	confirmLabel="Delete Expense"
	{onConfirm}
>
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
						{formatCurrency(originalExpense.amount)} on {formatDateWith(
							new Date(originalExpense.date),
							{}
						)}
					</p>
				</div>
			</div>
		</div>
	{/if}
</ConfirmDialog>
