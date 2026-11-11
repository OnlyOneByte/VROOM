<script lang="ts">
	/** Confirmation dialog for destructive actions. It stays open if onConfirm throws, so the caller's error stays visible. */
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
		confirmLabel?: string;
		cancelLabel?: string;
		destructive?: boolean;
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
					destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
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
