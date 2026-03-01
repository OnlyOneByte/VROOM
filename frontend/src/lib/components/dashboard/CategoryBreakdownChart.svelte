<script lang="ts">
	import { Arc, PieChart } from 'layerchart';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import { formatCurrency } from '$lib/utils/formatters';
	import { PieChartIcon } from 'lucide-svelte';

	interface CategoryData {
		category: string;
		name: string;
		amount: number;
		percentage: number;
		color: string;
	}

	interface Props {
		data: CategoryData[];
		isLoading?: boolean;
	}

	let { data, isLoading = false }: Props = $props();

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
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>Expense by Category</Card.Title>
				<Card.Description>Distribution across all vehicles</Card.Description>
			</div>
			<div class="p-2 rounded-lg bg-chart-1/10">
				<PieChartIcon class="h-5 w-5 text-chart-1" />
			</div>
		</div>
	</Card.Header>
	<Card.Content class="flex flex-col md:flex-row gap-6">
		<div class="flex-1 flex items-center justify-center">
			{#if isLoading}
				<Skeleton class="h-[250px] w-full max-w-[250px]" />
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
							No expense data
						{/snippet}
						{#snippet description()}
							Add expenses to see category breakdown
						{/snippet}
					</EmptyState>
				</div>
			{/if}
		</div>

		<div class="flex-1 space-y-1.5 min-w-0">
			{#each data as category (category.category)}
				<div class="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
					<div class="flex items-center gap-2">
						<div class="w-3 h-3 rounded-full" style:background-color={category.color}></div>
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
