<script lang="ts">
	import { Arc, PieChart } from 'layerchart';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { ExpenseCategory } from '$lib/types';

	interface CategoryChartData {
		category: ExpenseCategory;
		name: string;
		amount: number;
		percentage: number;
		color: string;
	}

	interface Props {
		data: CategoryChartData[];
		isLoading?: boolean;
		error?: string | null;
	}

	let { data, isLoading = false, error = null }: Props = $props();

	// Chart configuration for shadcn styling
	let chartConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		data.forEach(item => {
			config[item.category] = {
				label: item.name,
				color: item.color
			};
		});
		return config;
	});
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Expense Distribution</Card.Title>
		<Card.Description>Breakdown by category</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col md:flex-row gap-6">
		<!-- Pie Chart -->
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
				<Chart.Container
					config={chartConfig}
					class="mx-auto aspect-square max-h-[250px] w-full max-w-[250px]"
				>
					<PieChart
						{data}
						key="category"
						value="amount"
						cRange={data.map(d => d.color)}
						c="color"
						props={{
							pie: {
								innerRadius: 60,
								outerRadius: 120,
								padAngle: 0.02,
								cornerRadius: 4
							}
						}}
					>
						{#snippet tooltip()}
							<Chart.Tooltip hideLabel />
						{/snippet}
						{#snippet arc({ props })}
							<Arc {...props} />
						{/snippet}
					</PieChart>
				</Chart.Container>
			{:else}
				<div class="h-[250px] w-full">
					<EmptyState class="h-full">
						{#snippet title()}
							No expense data available
						{/snippet}
						{#snippet description()}
							Add expenses to see distribution
						{/snippet}
					</EmptyState>
				</div>
			{/if}
		</div>

		<!-- Legend/Summary -->
		<div class="flex-1 space-y-1.5 min-w-0" role="list" aria-label="Expense categories">
			{#each data as category (category.category)}
				<div
					class="flex items-center justify-between p-2 rounded-lg"
					role="listitem"
					aria-label="Category {category.name}: {formatCurrency(
						category.amount
					)}, {category.percentage.toFixed(1)}%"
				>
					<div class="flex items-center gap-2">
						<div
							class="w-3 h-3 rounded-full"
							style:background-color={category.color}
							aria-hidden="true"
						></div>
						<span class="text-sm font-medium">{category.name}</span>
					</div>
					<div class="text-right">
						<div class="text-sm font-bold">{formatCurrency(category.amount)}</div>
						<div class="text-xs text-muted-foreground">{category.percentage.toFixed(1)}%</div>
					</div>
				</div>
			{/each}
		</div>
	</Card.Content>
</Card.Root>
