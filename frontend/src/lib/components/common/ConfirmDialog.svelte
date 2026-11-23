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
	import type { Snippet } from 'svelte';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import { cn } from '#lib/utils.ts';

	interface Props {
		open: boolean;
		title: string;
		description: string;
		confirmLabel?: string;
		cancelLabel?: string;
		destructive?: boolean;
		onConfirm: () => void | Promise<void>;
		onCloseAutoFocus?: (_event: Event) => void;
		children?: Snippet;
	}

	let {
		open = $bindable(),
		title,
		description,
		confirmLabel = 'Delete',
		cancelLabel = 'Cancel',
		destructive = true,
		onConfirm,
		onCloseAutoFocus,
		children
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
	<AlertDialogContent {onCloseAutoFocus}>
		<AlertDialogHeader>
			<AlertDialogTitle>{title}</AlertDialogTitle>
			<AlertDialogDescription>{description}</AlertDialogDescription>
		</AlertDialogHeader>
		{@render children?.()}
		<AlertDialogFooter>
			<AlertDialogCancel disabled={isWorking}>{cancelLabel}</AlertDialogCancel>
			<AlertDialogAction
				onclick={handleConfirm}
				aria-disabled={isWorking}
				class={cn(
					destructive &&
						buttonVariants({
							variant: 'destructive',
							class: 'aria-disabled:focus-visible:ring-destructive'
						})
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
