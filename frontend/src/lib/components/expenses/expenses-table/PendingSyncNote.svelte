<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import { syncManager } from '#lib/utils/sync/sync-manager.ts';
	import { clearSaveFailure, queuedEditHref } from '#lib/utils/sync/announce-failure.ts';
	import { removeOfflineExpense } from '#lib/utils/offline-storage.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import type { PendingRowState } from '#lib/utils/sync/pending-rows.ts';
	import { retryDelete } from '#lib/utils/pending-deletes.svelte.ts';
	import { applyMyChanges, discardForLatest, retryEdit } from '#lib/utils/pending-edits.svelte.ts';
	import { expenseEditHref } from './expense-table-actions';

	interface Props {
		pending: PendingRowState;
		entryId: string;
		returnTo: string;
		label: string;
		deleteKey?: string;
	}

	let { pending, entryId, returnTo, label, deleteKey = entryId }: Props = $props();
	let confirmDiscard = $state(false);
</script>

{#if pending.status === 'saving'}
	<span
		class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
		data-testid="pending-sync-note"
	>
		Unsynced
	</span>
{:else if pending.kind === 'delete'}
	<div class="flex flex-wrap items-center gap-2 whitespace-normal" data-testid="delete-failed-note">
		<span class="text-xs text-destructive">Not deleted: {pending.error}</span>
		<Button
			variant="outline"
			size="sm"
			class="h-7"
			aria-label="Retry deleting {label}"
			onclick={event => {
				event.stopPropagation();
				retryDelete(deleteKey);
			}}
		>
			Retry
		</Button>
	</div>
{:else if pending.kind === 'edit' && pending.conflict}
	<div class="flex flex-wrap items-center gap-2 whitespace-normal" data-testid="edit-conflict-note">
		<span class="text-xs text-destructive">{pending.error}</span>
		<Button
			variant="outline"
			size="sm"
			class="h-7"
			aria-label="Apply my changes to {label}"
			onclick={event => {
				event.stopPropagation();
				applyMyChanges(entryId);
			}}
		>
			Apply my changes
		</Button>
		<Button
			variant="ghost"
			size="sm"
			class="h-7"
			aria-label="Reload {label} without my changes"
			onclick={event => {
				event.stopPropagation();
				discardForLatest(entryId);
				window.location.reload();
			}}
		>
			Reload
		</Button>
	</div>
{:else if pending.kind === 'edit'}
	<div class="flex flex-wrap items-center gap-2 whitespace-normal" data-testid="edit-failed-note">
		<span class="text-xs text-destructive">Changes not saved: {pending.error}</span>
		<Button
			variant="outline"
			size="sm"
			class="h-7"
			aria-label="Retry saving changes to {label}"
			onclick={event => {
				event.stopPropagation();
				retryEdit(entryId);
			}}
		>
			Retry
		</Button>
		<Button
			variant="ghost"
			size="sm"
			class="h-7"
			aria-label="Edit {label}"
			href={expenseEditHref(entryId, returnTo)}
		>
			Edit
		</Button>
	</div>
{:else}
	<div class="flex flex-wrap items-center gap-2 whitespace-normal" data-testid="pending-sync-error">
		<span class="text-xs text-destructive">Not saved: {pending.error}</span>
		<Button
			variant="outline"
			size="sm"
			class="h-7"
			aria-label="Retry saving {label}"
			onclick={() => syncManager.retryEntry(entryId)}
		>
			Retry
		</Button>
		{#if pending.editable}
			<Button
				variant="ghost"
				size="sm"
				class="h-7"
				aria-label="Edit {label}"
				href={queuedEditHref(entryId, returnTo)}
			>
				Edit
			</Button>
		{/if}
		<Button
			variant="ghost"
			size="sm"
			class="h-7 text-destructive hover:text-destructive"
			aria-label="Discard {label}"
			onclick={() => (confirmDiscard = true)}
		>
			Discard
		</Button>
	</div>
	<ConfirmDialog
		bind:open={confirmDiscard}
		title={pending.reachedServer
			? "Discard the photos that didn't upload?"
			: 'Discard this unsynced expense?'}
		description={pending.reachedServer
			? `${label} reached the server and stays there. Discarding removes the photos that didn't upload, which are only on this device.`
			: `${label} was never synced to the server. Discarding it deletes it and any photos attached to it from this device for good.`}
		confirmLabel={pending.reachedServer ? 'Discard photos' : 'Discard'}
		onConfirm={() => {
			removeOfflineExpense(entryId);
			clearSaveFailure(entryId);
		}}
	/>
{/if}
