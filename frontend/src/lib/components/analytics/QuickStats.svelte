<script lang="ts">
	import { Car, DollarSign, Activity, TrendingUp } from 'lucide-svelte';
	import * as Card from '$lib/components/ui/card';
	import type { QuickStatsResponse } from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';

	let { data }: { data: QuickStatsResponse } = $props();
</script>

<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
	<Card.Root>
		<Card.Content class="p-4 sm:p-6">
			<div class="flex items-center justify-between">
				<div class="space-y-1">
					<p class="text-xs text-muted-foreground sm:text-sm">Total Vehicles</p>
					<p class="text-xl font-bold sm:text-2xl">{data.vehicleCount}</p>
				</div>
				<Car class="h-6 w-6 text-muted-foreground sm:h-8 sm:w-8" />
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Content class="p-4 sm:p-6">
			<div class="flex items-center justify-between">
				<div class="space-y-1">
					<p class="text-xs text-muted-foreground sm:text-sm">YTD Spending</p>
					<p class="text-xl font-bold sm:text-2xl">{formatCurrency(data.ytdSpending)}</p>
				</div>
				<DollarSign class="h-6 w-6 text-muted-foreground sm:h-8 sm:w-8" />
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Content class="p-4 sm:p-6">
			<div class="flex items-center justify-between">
				<div class="space-y-1">
					<p class="text-xs text-muted-foreground sm:text-sm">Avg MPG</p>
					<p class="text-xl font-bold sm:text-2xl">
						{data.avgMpg != null ? data.avgMpg.toFixed(1) : 'N/A'}
					</p>
				</div>
				<Activity class="h-6 w-6 text-muted-foreground sm:h-8 sm:w-8" />
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Content class="p-4 sm:p-6">
			<div class="flex items-center justify-between">
				<div class="space-y-1">
					<p class="text-xs text-muted-foreground sm:text-sm">Fleet Health</p>
					<p class="text-xl font-bold sm:text-2xl">{data.fleetHealthScore}</p>
				</div>
				<TrendingUp class="h-6 w-6 text-muted-foreground sm:h-8 sm:w-8" />
			</div>
		</Card.Content>
	</Card.Root>
</div>
