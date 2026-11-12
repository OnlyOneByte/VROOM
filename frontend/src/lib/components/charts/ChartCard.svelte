<script lang="ts">
	import { animateOnView } from '#lib/utils/animate-on-view.ts';
	import { createVisibilityWatch } from '#lib/utils/visibility-watch.svelte.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		isLoading?: boolean;
		error?: string | null;
		isEmpty?: boolean;
		emptyTitle?: string;
		emptyDescription?: string;
		height?: number;
		icon?: Snippet;
		animationClass?: 'chart-line-animated' | 'chart-bar-animated' | 'chart-pie-animated';
		class?: string;
		children: Snippet;
	}

	let {
		title,
		description,
		isLoading = false,
		error = null,
		isEmpty = false,
		emptyTitle = 'No data available',
		emptyDescription = 'Add data to see this chart',
		height,
		icon,
		animationClass,
		class: className,
		children
	}: Props = $props();

	let placeholderHeight = $derived(height ?? 300);

	// LayerChart measures 0x0 in hidden containers; gate rendering on visibility.
	let gate = createVisibilityWatch();

	const READY_CLASS_MAP: Record<string, string> = {
		'chart-line-animated': 'chart-line-animate-ready',
		'chart-bar-animated': 'chart-bar-animate-ready',
		'chart-pie-animated': 'chart-pie-animate-ready'
	};
	let readyClass = $derived(animationClass ? (READY_CLASS_MAP[animationClass] ?? '') : '');
</script>

<Card.Root class={className}>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>{title}</Card.Title>
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
				<EmptyState class="h-full">
					{#snippet title()}
						Failed to load chart
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
		{/if}
	</Card.Content>
</Card.Root>
