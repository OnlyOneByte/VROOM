<script lang="ts">
	import { DollarSign } from 'lucide-svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import StatCard from '$lib/components/ui/stat-card.svelte';
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
</script>

<Card>
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			<DollarSign class="h-5 w-5" />
			Expense Overview
		</CardTitle>
	</CardHeader>
	<CardContent>
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			<StatCard
				label="Total Expenses"
				value={formatCurrency(stats.totalExpenses)}
				unit="all time"
			/>
			<StatCard
				label="Last 30 Days"
				value={formatCurrency(stats.recentExpenses)}
				unit="recent spending"
			/>
			<StatCard
				label="Monthly Average"
				value={formatCurrency(stats.monthlyAverage)}
				unit="last 12 months"
			/>
		</div>
	</CardContent>
</Card>
