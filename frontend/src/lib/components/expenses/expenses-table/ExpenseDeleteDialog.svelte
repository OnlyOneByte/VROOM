<script lang="ts">
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import type { Expense, Vehicle } from '#lib/types/index.ts';
	import { DELETE_TITLE, deleteDescription } from '../expense-delete-copy';

	interface Props {
		open: boolean;
		expense: Expense | null;
		vehicle?: Vehicle | null;
		onConfirm: () => Promise<void>;
	}

	let { open = $bindable(), expense, vehicle = null, onConfirm }: Props = $props();
</script>

<ConfirmDialog
	bind:open
	title={DELETE_TITLE}
	description={expense
		? deleteDescription(expense, vehicle, expense.groupId ? 'split' : 'single')
		: ''}
	{onConfirm}
/>
