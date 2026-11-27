<script lang="ts">
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import type { Expense, Vehicle } from '#lib/types/index.ts';
	import { DELETE_TITLE, deleteDescription } from '../../expense-delete-copy';

	interface Props {
		open: boolean;
		isInsuranceManaged: boolean;
		isGroupEditMode: boolean;
		groupId: string | null;
		originalExpense: Expense | null;
		vehicle?: Vehicle | null;
		onConfirm: () => Promise<void>;
	}

	let {
		open = $bindable(),
		isInsuranceManaged,
		isGroupEditMode,
		groupId,
		originalExpense,
		vehicle = null,
		onConfirm
	}: Props = $props();

	const kind = $derived(
		isInsuranceManaged && groupId ? 'insurance' : isGroupEditMode && groupId ? 'split' : 'single'
	);
</script>

<ConfirmDialog
	bind:open
	title={DELETE_TITLE}
	description={originalExpense ? deleteDescription(originalExpense, vehicle, kind) : ''}
	{onConfirm}
/>
