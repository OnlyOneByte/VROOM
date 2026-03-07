<script lang="ts">
	import { DollarSign, Clock, TrendingUp } from '@lucide/svelte';
	import { StatCardGrid } from '$lib/components/charts';
	import { formatCurrency } from '$lib/utils/formatters';

	interface LocalStats {
		totalExpenses: number;
		recentExpenses: number;
		monthlyAverage: number;
	}

	interface Props {
		stats: LocalStats;
	}

	let { stats }: Props = $props();

	const statItems = $derived([
		{
			label: 'Total Expenses',
			value: formatCurrency(stats.totalExpenses),
			unit: 'all time',
			icon: DollarSign,
			iconColor: 'primary'
		},
		{
			label: 'Last 30 Days',
			value: formatCurrency(stats.recentExpenses),
			unit: 'recent spending',
			icon: Clock,
			iconColor: 'chart-1'
		},
		{
			label: 'Monthly Average',
			value: formatCurrency(stats.monthlyAverage),
			unit: 'last 12 months',
			icon: TrendingUp,
			iconColor: 'chart-2'
		}
	]);
</script>

<StatCardGrid items={statItems} columns={3} />
