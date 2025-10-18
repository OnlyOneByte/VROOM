<script lang="ts">
	import { Chart, Svg, Pie, Arc, Group, Tooltip } from 'layerchart';
	import {
		Card,
		CardHeader,
		CardTitle,
		CardDescription,
		CardContent
	} from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { ExpenseCategory } from '$lib/types';

	// Chart configuration constants
	const CHART_HEIGHT = 300;
	const PIE_INNER_RADIUS = 60;
	const PIE_OUTER_RADIUS = 120;
	const PIE_PAD_ANGLE = 0.02;
	const PIE_CORNER_RADIUS = 4;
	const CHART_PADDING = { left: 20, right: 20, top: 20, bottom: 20 };

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
</script>

<Card>
	<CardHeader>
		<CardTitle>Expense Distribution</CardTitle>
		<CardDescription>Breakdown by category</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col xl:flex-row gap-6">
		<!-- Pie Chart -->
		<div class="flex-1">
			{#if isLoading}
				<Skeleton class="h-[{CHART_HEIGHT}px] w-full" />
			{:else if error}
				<div class="h-[{CHART_HEIGHT}px]">
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
				<div class="h-[{CHART_HEIGHT}px]">
					<Chart
						{data}
						x="amount"
						y="category"
						c="category"
						cDomain={data.map(d => d.category)}
						cRange={data.map(d => d.color)}
						padding={CHART_PADDING}
					>
						<Svg>
							<Group center>
								<Pie
									{data}
									range={[0, 360]}
									innerRadius={PIE_INNER_RADIUS}
									outerRadius={PIE_OUTER_RADIUS}
									padAngle={PIE_PAD_ANGLE}
									cornerRadius={PIE_CORNER_RADIUS}
									let:arcs
								>
									{#each arcs as arc (arc.data.category)}
										<Arc
											startAngle={arc.startAngle}
											endAngle={arc.endAngle}
											fill={arc.data.color}
											stroke="white"
											stroke-width="2"
											class="transition-opacity hover:opacity-80 cursor-pointer"
											data={arc.data}
										/>
									{/each}
								</Pie>
							</Group>
						</Svg>
						<Tooltip.Root let:data>
							<Tooltip.Header>
								{data.name}
							</Tooltip.Header>
							<Tooltip.List>
								<Tooltip.Item label="Amount" value={formatCurrency(data.amount)} />
								<Tooltip.Item label="Percentage" value={`${data.percentage.toFixed(1)}%`} />
							</Tooltip.List>
						</Tooltip.Root>
					</Chart>
				</div>
			{:else}
				<div class="h-[{CHART_HEIGHT}px]">
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
		<div class="flex-1 space-y-2" role="list" aria-label="Expense categories">
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
	</CardContent>
</Card>
