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
	import * as Table from '#lib/components/ui/table/index.ts';
	import type { ChartA11y } from './chart-a11y.ts';

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
		summary?: Snippet | undefined;
		footer?: Snippet | undefined;
		animationClass?: 'chart-line-animated' | 'chart-bar-animated';
		table?: ChartA11y | undefined;
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
		summary,
		footer,
		animationClass,
		table,
		class: className,
		children
	}: Props = $props();

	let placeholderHeight = $derived(height ?? 300);
	let stateLevel = $derived(level === 2 ? (3 as const) : (4 as const));

	// LayerChart measures 0x0 in hidden containers; gate rendering on visibility.
	let gate = createVisibilityWatch();

	const READY_CLASS_MAP: Record<string, string> = {
		'chart-line-animated': 'chart-line-animate-ready',
		'chart-bar-animated': 'chart-bar-animate-ready'
	};
	let readyClass = $derived(animationClass ? (READY_CLASS_MAP[animationClass] ?? '') : '');

	const VIEW_OPTIONS = [
		['chart', 'Chart'],
		['table', 'Table']
	] as const;
	let view = $state<'chart' | 'table'>('chart');
	let canToggle = $derived(!isLoading && !error && !isEmpty && !!table);

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
			<div class="flex shrink-0 items-center gap-2">
				{#if canToggle}
					<div
						role="group"
						aria-label="Show {title} as"
						class="bg-muted inline-flex rounded-md p-0.5"
					>
						{#each VIEW_OPTIONS as [option, optionLabel] (option)}
							<button
								type="button"
								aria-pressed={view === option}
								onclick={() => (view = option)}
								class="focus-visible:ring-ring/50 min-h-10 rounded-sm px-3 text-xs font-medium outline-none focus-visible:ring-[3px] {view ===
								option
									? 'bg-background text-foreground shadow-xs'
									: 'text-muted-foreground hover:text-foreground'}"
							>
								{optionLabel}
							</button>
						{/each}
					</div>
				{/if}
				{#if icon}
					{@render icon()}
				{/if}
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if summary}
			<div class="mb-4">{@render summary()}</div>
		{/if}
		{#if isLoading}
			<Skeleton class="w-full" style="height: {placeholderHeight}px" />
		{:else if error}
			<div style="height: {placeholderHeight}px">
				<EmptyState class="h-full" level={stateLevel} action={onRetry ? retryAction : undefined}>
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
				<EmptyState class="h-full" level={stateLevel}>
					{#snippet title()}
						{emptyTitle}
					{/snippet}
					{#snippet description()}
						{emptyDescription}
					{/snippet}
				</EmptyState>
			</div>
		{:else if canToggle && table && view === 'table'}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="overflow-auto rounded-md border"
				style="max-height: {placeholderHeight}px"
				role="region"
				aria-label="{title} table"
				tabindex="0"
			>
				<table class="w-full text-sm">
					<Table.Caption class="sr-only">{table.caption}</Table.Caption>
					<Table.Header class="bg-card sticky top-0">
						<Table.Row>
							<Table.Head scope="col">{table.categoryLabel}</Table.Head>
							{#each table.columns as column (column.key)}
								<Table.Head scope="col" class="text-right">{column.label}</Table.Head>
							{/each}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each table.rows as row, i (i)}
							<Table.Row>
								<Table.Head scope="row" class="font-normal">{row.label}</Table.Head>
								{#each row.cells as cell, c (c)}
									<Table.Cell class="text-right tabular-nums">{cell}</Table.Cell>
								{/each}
							</Table.Row>
						{/each}
					</Table.Body>
				</table>
			</div>
			{#if legend}
				{@render legend()}
			{/if}
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
		{#if footer}
			<div class="mt-4">{@render footer()}</div>
		{/if}
	</Card.Content>
</Card.Root>
