<script lang="ts">
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle
	} from '#lib/components/ui/alert-dialog/index.ts';
	import { LoaderCircle } from '@lucide/svelte';
	import { cn } from '#lib/utils.ts';

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
		// AlertDialog Action auto-closes unless its default is prevented.
		e.preventDefault();
		if (isWorking) return;
		isWorking = true;
		try {
			await onConfirm();
			open = false;
		} catch {
			// Caller shows the error; stay open so the user can retry.
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
