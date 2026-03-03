<script lang="ts">
	import { Car, DollarSign, TrendingUp, CreditCard } from 'lucide-svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { formatCurrency } from '$lib/utils/formatters';

	interface Props {
		totalVehicles: number;
		totalExpenses: number;
		monthlyAverage: number;
		activeFinancing: number;
		isLoading?: boolean;
	}

	let {
		totalVehicles,
		totalExpenses,
		monthlyAverage,
		activeFinancing,
		isLoading = false
	}: Props = $props();

	const stats = $derived([
		{
			label: 'Total Vehicles',
			value: totalVehicles.toString(),
			icon: Car,
			color: 'text-primary',
			bgColor: 'bg-primary/10'
		},
		{
			label: 'Total Expenses',
			value: formatCurrency(totalExpenses),
			icon: DollarSign,
			color: 'text-chart-1',
			bgColor: 'bg-chart-1/10'
		},
		{
			label: 'Monthly Average',
			value: formatCurrency(monthlyAverage),
			icon: TrendingUp,
			color: 'text-chart-2',
			bgColor: 'bg-chart-2/10'
		},
		{
			label: 'Active Financing',
			value: activeFinancing.toString(),
			icon: CreditCard,
			color: 'text-chart-5',
			bgColor: 'bg-chart-5/10'
		}
	]);
</script>

<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
	{#each stats as stat (stat.label)}
		<Card>
			<CardContent class="p-4 sm:p-6">
				{#if isLoading}
					<div class="space-y-3">
						<Skeleton class="h-4 w-24" />
						<Skeleton class="h-8 w-32" />
					</div>
				{:else}
					<div class="flex items-center gap-2">
						<div class="p-2 sm:p-3 rounded-xl {stat.bgColor} shrink-0">
							<stat.icon class="h-4 w-4 sm:h-5 sm:w-5 {stat.color}" />
						</div>
						<p class="text-xs sm:text-sm font-medium text-muted-foreground">{stat.label}</p>
					</div>
					<p class="text-xl sm:text-2xl font-bold mt-2">{stat.value}</p>
				{/if}
			</CardContent>
		</Card>
	{/each}
</div>
