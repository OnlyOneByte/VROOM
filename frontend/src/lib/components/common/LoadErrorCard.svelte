<script lang="ts">
	import { tick } from 'svelte';
	import { CircleAlert, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { focusFirstButton, focusLeftOn, focusMainHeading } from '#lib/utils/focus.ts';

	interface Props {
		title: string;
		message: string;
		onRetry: () => unknown;
		compact?: boolean;
		onRecovered?: () => void;
		'data-testid'?: string;
	}

	let {
		title,
		message,
		onRetry,
		compact = false,
		onRecovered,
		'data-testid': testId
	}: Props = $props();

	let card = $state<HTMLDivElement | null>(null);
	let isRetrying = $state(false);
	let failures = $state(0);

	async function retry() {
		if (isRetrying) return;
		const origin = document.activeElement;
		const container = card?.parentElement ?? null;
		const dialog = card?.closest<HTMLElement>('[role="dialog"]') ?? null;
		isRetrying = true;
		try {
			await onRetry();
		} finally {
			isRetrying = false;
		}
		await tick();
		if (card?.isConnected) {
			failures += 1;
			return;
		}
		if (!focusLeftOn(origin)) return;
		const scope = container?.isConnected ? container : (dialog ?? document.querySelector('main'));
		const retryAgain = scope?.querySelector<HTMLElement>('[data-slot="load-error-card"] button');
		if (retryAgain) retryAgain.focus();
		else if (onRecovered) onRecovered();
		else if (dialog) focusFirstButton(dialog);
		else focusMainHeading();
	}
</script>

<div
	bind:this={card}
	class="rounded-lg border bg-card {compact ? 'p-4' : 'p-6'}"
	data-slot="load-error-card"
	data-testid={testId}
>
	<div role="alert">
		{#key failures}
			<div class="flex items-center text-destructive {compact ? 'mb-2 gap-2' : 'mb-4 gap-3'}">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">{title}</p>
			</div>
			<p class="text-sm text-muted-foreground {compact ? 'mb-3' : 'mb-4'}">{message}</p>
		{/key}
	</div>
	<Button size="lg" onclick={retry} aria-disabled={isRetrying}>
		{#if isRetrying}
			<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
			Retrying…
		{:else}
			Retry
		{/if}
	</Button>
</div>
