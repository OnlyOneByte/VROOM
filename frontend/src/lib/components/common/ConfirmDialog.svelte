<script lang="ts">
	/**
	 * Reusable confirmation dialog for destructive (or otherwise consequential)
	 * actions — a styled, disclosing replacement for the native browser `confirm()`.
	 * Uses the AlertDialog kit (the semantically-correct role: it interrupts and
	 * demands an explicit choice). Controlled via `bind:open`.
	 *
	 * `onConfirm` may be async: while it runs the confirm button shows a spinner and
	 * both buttons disable. The dialog closes only on SUCCESS — if `onConfirm` throws,
	 * the dialog stays open (so the caller's error toast is visible and the user can
	 * retry or cancel), matching the ExpensesTable delete-dialog ergonomics.
	 */
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
	import { LoaderCircle } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	interface Props {
		open: boolean;
		title: string;
		description: string;
		/** Confirm button label. Defaults to "Delete" (the dominant use). */
		confirmLabel?: string;
		cancelLabel?: string;
		/** Style the confirm button as destructive (red). Default true. */
		destructive?: boolean;
		/** The action to run on confirm. May be async; see the stay-open-on-error note. */
		onConfirm: () => void | Promise<void>;
	}

	let {
		open = $bindable(),
		title,
		description,
		confirmLabel = 'Delete',
		cancelLabel = 'Cancel',
		destructive = true,
		onConfirm
	}: Props = $props();

	let isWorking = $state(false);

	async function handleConfirm(e: Event) {
		// Prevent the AlertDialog Action's default auto-close so we control closing
		// (only on success) and can show the in-flight spinner.
		e.preventDefault();
		if (isWorking) return;
		isWorking = true;
		try {
			await onConfirm();
			open = false;
		} catch {
			// Stay open; the caller surfaces its own error toast. Re-enable the buttons.
		} finally {
			isWorking = false;
		}
	}
</script>

<AlertDialog bind:open>
	<AlertDialogContent>
		<AlertDialogHeader>
			<AlertDialogTitle>{title}</AlertDialogTitle>
			<AlertDialogDescription>{description}</AlertDialogDescription>
		</AlertDialogHeader>
		<AlertDialogFooter>
			<AlertDialogCancel disabled={isWorking}>{cancelLabel}</AlertDialogCancel>
			<AlertDialogAction
				onclick={handleConfirm}
				disabled={isWorking}
				class={cn(
					destructive &&
						'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
				)}
			>
				{#if isWorking}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
					Working…
				{:else}
					{confirmLabel}
				{/if}
			</AlertDialogAction>
		</AlertDialogFooter>
	</AlertDialogContent>
</AlertDialog>
