<script lang="ts">
	import { animateOnView } from '#lib/utils/animate-on-view.ts';
	import { createVisibilityWatch } from '#lib/utils/visibility-watch.svelte.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { LoaderCircle } from '@lucide/svelte';
	import { tick, type Snippet } from 'svelte';
	import { focusLeftOn } from '#lib/utils/focus.ts';

	interface Props {
		title: string;
		level?: 2 | 3 | 4;
		description?: string;
		isLoading?: boolean;
		error?: string | null;
		onRetry?: () => unknown;
		isEmpty?: boolean;
		emptyTitle?: string;
		emptyDescription?: string;
		height?: number;
		icon?: Snippet;
		legend?: Snippet;
		animationClass?: 'chart-line-animated' | 'chart-bar-animated';
		class?: string;
		children: Snippet;
	}

	let {
		title,
		level = 2,
		description,
		isLoading = false,
		error = null,
		onRetry,
		isEmpty = false,
		emptyTitle = 'No data available',
		emptyDescription = 'Add data to see this chart',
		height,
		icon,
		legend,
		animationClass,
		class: className,
		children
	}: Props = $props();

	let placeholderHeight = $derived(height ?? 300);

	// LayerChart measures 0x0 in hidden containers; gate rendering on visibility.
	let gate = createVisibilityWatch();

	const READY_CLASS_MAP: Record<string, string> = {
		'chart-line-animated': 'chart-line-animate-ready',
		'chart-bar-animated': 'chart-bar-animate-ready'
	};
	let readyClass = $derived(animationClass ? (READY_CLASS_MAP[animationClass] ?? '') : '');

	let isRetrying = $state(false);
	let titleEl = $state<HTMLElement | null>(null);

	async function retry() {
		if (isRetrying || !onRetry) return;
		const origin = document.activeElement;
		isRetrying = true;
		try {
			await onRetry();
		} finally {
			isRetrying = false;
		}
		await tick();
		if (!error && focusLeftOn(origin)) {
			titleEl?.focus();
		}
	}
</script>

{#snippet retryAction()}
	<Button variant="outline" size="lg" onclick={retry} aria-disabled={isRetrying}>
		{#if isRetrying}
			<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
			Retrying…
		{:else}
			Retry
		{/if}
	</Button>
{/snippet}

<Card.Root class={className}>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title bind:ref={titleEl} tabindex={-1} {level}>{title}</Card.Title>
				{#if description}
					<Card.Description>{description}</Card.Description>
				{/if}
			</div>
			{#if icon}
				{@render icon()}
			{/if}
		</div>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<Skeleton class="w-full" style="height: {placeholderHeight}px" />
		{:else if error}
			<div style="height: {placeholderHeight}px">
				<EmptyState class="h-full" action={onRetry ? retryAction : undefined}>
					{#snippet title()}
						Couldn't load the chart
					{/snippet}
					{#snippet description()}
						{error}
					{/snippet}
				</EmptyState>
			</div>
		{:else if isEmpty}
			<div style="height: {placeholderHeight}px">
				<EmptyState class="h-full">
					{#snippet title()}
						{emptyTitle}
					{/snippet}
					{#snippet description()}
						{emptyDescription}
					{/snippet}
				</EmptyState>
			</div>
		{:else}
			<div bind:this={gate.el} style="min-height: {placeholderHeight}px">
				{#if gate.visible}
					{#if animationClass}
						<div class={readyClass} use:animateOnView={animationClass}>
							{@render children()}
						</div>
					{:else}
						{@render children()}
					{/if}
				{:else}
					<Skeleton class="w-full" style="height: {placeholderHeight}px" />
				{/if}
			</div>
			{#if legend}
				{@render legend()}
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
