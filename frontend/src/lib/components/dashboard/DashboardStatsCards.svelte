<script lang="ts">
	import { Car, DollarSign, TrendingUp, CreditCard } from '@lucide/svelte';
	import { StatCardGrid } from '$lib/components/charts';
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
			iconColor: 'primary'
		},
		{
			label: 'Total Expenses',
			value: formatCurrency(totalExpenses),
			icon: DollarSign,
			iconColor: 'chart-1'
		},
		{
			label: 'Monthly Average',
			value: formatCurrency(monthlyAverage),
			icon: TrendingUp,
			iconColor: 'chart-2'
		},
		{
			label: 'Active Financing',
			value: activeFinancing.toString(),
			icon: CreditCard,
			iconColor: 'chart-5'
		}
	]);
</script>

<StatCardGrid items={stats} columns={4} {isLoading} />
