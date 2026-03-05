<script lang="ts">
	import '$lib/components/analytics/pie-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';
	import { PieChart } from 'layerchart';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { Snippet } from 'svelte';

	interface CategoryData {
		category: string;
		name?: string;
		label?: string;
		amount: number;
		percentage: number;
		color: string;
	}

	interface Props {
		data: CategoryData[];
		title?: string;
		description?: string;
		isLoading?: boolean;
		error?: string | null;
		icon?: Snippet;
	}

	let {
		data,
		title = 'Expense by Category',
		description = 'Distribution across all vehicles',
		isLoading = false,
		error = null,
		icon
	}: Props = $props();

	let chartConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const item of data) {
			const displayName = item.name ?? item.label ?? item.category;
			config[item.category] = { label: displayName, color: item.color };
		}
		return config;
	});
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>{title}</Card.Title>
				<Card.Description>{description}</Card.Description>
			</div>
			{#if icon}
				<div class="rounded-lg bg-chart-1/10 p-2">
					{@render icon()}
				</div>
			{/if}
		</div>
	</Card.Header>
	<Card.Content class="flex flex-col md:flex-row gap-6">
		<div class="flex-1 flex items-center justify-center">
			{#if isLoading}
				<Skeleton class="h-[250px] w-full max-w-[250px]" />
			{:else if error}
				<div class="h-[250px] w-full">
					<EmptyState class="h-full">
						{#snippet title()}
							Failed to load chart
						{/snippet}
						{#snippet description()}
							{error}
						{/snippet}
					</EmptyState>
				</div>
			{:else if data.length > 0}
				<div
					use:animateOnView={'chart-pie-animated'}
					class="mx-auto aspect-square max-h-[250px] w-full max-w-[250px]"
				>
					<Chart.Container config={chartConfig} class="h-full w-full">
						<PieChart
							{data}
							key="category"
							value="amount"
							label="name"
							cRange={data.map(d => d.color)}
							innerRadius={60}
							outerRadius={120}
							padAngle={0.02}
							cornerRadius={4}
						>
							{#snippet tooltip()}
								<Chart.Tooltip hideLabel />
							{/snippet}
						</PieChart>
					</Chart.Container>
				</div>
			{:else}
				<div class="h-[250px] w-full">
					<EmptyState class="h-full">
						{#snippet title()}
							No data available
						{/snippet}
						{#snippet description()}
							Add expenses to see breakdown
						{/snippet}
					</EmptyState>
				</div>
			{/if}
		</div>

		<div class="flex-1 space-y-1.5 min-w-0" role="list" aria-label="Categories">
			{#each data as item (item.category)}
				<div class="flex items-center justify-between rounded-lg p-2" role="listitem">
					<div class="flex items-center gap-2">
						<div
							class="h-3 w-3 rounded-full"
							style:background-color={item.color}
							aria-hidden="true"
						></div>
						<span class="text-sm font-medium">{item.name ?? item.label ?? item.category}</span>
					</div>
					<div class="text-right">
						<div class="text-sm font-bold">{formatCurrency(item.amount)}</div>
						<div class="text-xs text-muted-foreground">{item.percentage.toFixed(1)}%</div>
					</div>
				</div>
			{/each}
		</div>
	</Card.Content>
</Card.Root>
