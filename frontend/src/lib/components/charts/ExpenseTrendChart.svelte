<script lang="ts">
	import { Chart, Svg, Area, Axis, Tooltip } from 'layerchart';
	import {
		Card,
		CardHeader,
		CardTitle,
		CardDescription,
		CardContent
	} from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/ui/empty-state.svelte';

	// Chart configuration constants
	const CHART_HEIGHT = 300;
	const CHART_PADDING = { left: 60, bottom: 40, top: 20, right: 20 };

	interface ExpenseTrendData {
		date: Date;
		amount: number;
		count: number;
	}

	interface Props {
		data: ExpenseTrendData[];
		period: string;
		isLoading?: boolean;
		error?: string | null;
	}

	let { data, period, isLoading = false, error = null }: Props = $props();

	// Format period label for display
	let periodLabel = $derived.by(() => {
		switch (period) {
			case '7d':
				return 'Last 7 Days';
			case '30d':
				return 'Last 30 Days';
			case '90d':
				return 'Last 90 Days';
			case '1y':
				return 'Last Year';
			case 'all':
				return 'All Time';
			default:
				return period;
		}
	});

	// Format date for display (full format for tooltip)
	function formatDate(date: Date): string {
		return new Date(date).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	// Format date for axis (shorter format)
	function formatAxisDate(date: Date): string {
		const d = new Date(date);
		// For shorter periods, show month/day
		if (period === '7d' || period === '30d') {
			return d.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric'
			});
		}
		// For longer periods, show month/year
		return d.toLocaleDateString('en-US', {
			month: 'short',
			year: '2-digit'
		});
	}

	// Format currency
	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(amount);
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>Expense Trends</CardTitle>
		<CardDescription>{periodLabel}</CardDescription>
	</CardHeader>
	<CardContent>
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
				<Chart {data} x="date" y="amount" padding={CHART_PADDING}>
					<Svg>
						<Axis placement="bottom" format={formatAxisDate} />
						<Axis placement="left" format={value => formatCurrency(value)} />
						<Area class="fill-primary/20 stroke-primary stroke-2" />
					</Svg>
					<Tooltip.Root let:data>
						<Tooltip.Header>
							{formatDate(data.date)}
						</Tooltip.Header>
						<Tooltip.List>
							<Tooltip.Item label="Amount" value={formatCurrency(data.amount)} />
							<Tooltip.Item label="Count" value={`${data.count} expenses`} />
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
						Add expenses to see trends
					{/snippet}
				</EmptyState>
			</div>
		{/if}
	</CardContent>
</Card>
