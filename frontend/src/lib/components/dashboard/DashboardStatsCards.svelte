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
			color: 'text-primary-600',
			bgColor: 'bg-primary-50'
		},
		{
			label: 'Total Expenses',
			value: formatCurrency(totalExpenses),
			icon: DollarSign,
			color: 'text-blue-600',
			bgColor: 'bg-blue-50'
		},
		{
			label: 'Monthly Average',
			value: formatCurrency(monthlyAverage),
			icon: TrendingUp,
			color: 'text-green-600',
			bgColor: 'bg-green-50'
		},
		{
			label: 'Active Financing',
			value: activeFinancing.toString(),
			icon: CreditCard,
			color: 'text-orange-600',
			bgColor: 'bg-orange-50'
		}
	]);
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
	{#each stats as stat}
		<Card>
			<CardContent class="p-6">
				{#if isLoading}
					<div class="space-y-3">
						<Skeleton class="h-4 w-24" />
						<Skeleton class="h-8 w-32" />
					</div>
				{:else}
					<div class="flex items-center justify-between">
						<div class="space-y-1">
							<p class="text-sm font-medium text-muted-foreground">{stat.label}</p>
							<p class="text-2xl font-bold">{stat.value}</p>
						</div>
						<div class="p-3 rounded-xl {stat.bgColor}">
							<svelte:component this={stat.icon} class="h-6 w-6 {stat.color}" />
						</div>
					</div>
				{/if}
			</CardContent>
		</Card>
	{/each}
</div>
