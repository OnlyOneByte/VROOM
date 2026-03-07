<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '$lib/routes';
	import { gotoWithQuery } from '$lib/utils/navigation';
	import { Car, Calendar } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { formatCurrency, formatRelativeTime } from '$lib/utils/formatters';

	interface VehicleOverview {
		id: string;
		name: string;
		nickname?: string | null;
		recentExpenses: number;
		totalExpenses: number;
		lastActivity: Date | null;
		hasActiveFinancing: boolean;
	}

	interface Props {
		vehicles: VehicleOverview[];
		isLoading?: boolean;
	}

	let { vehicles, isLoading = false }: Props = $props();

	function handleRowClick(vehicleId: string) {
		goto(resolve(paramRoutes.vehicle, { id: vehicleId }));
	}
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>Fleet Overview</Card.Title>
				<Card.Description>Quick view of all your vehicles</Card.Description>
			</div>
			<div class="p-2 rounded-lg bg-chart-2/10">
				<Car class="h-5 w-5 text-chart-2" />
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<div class="space-y-3">
				{#each Array(3) as _, i (i)}
					<Skeleton class="h-16 w-full" />
				{/each}
			</div>
		{:else if vehicles.length > 0}
			<div class="rounded-md border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Vehicle</Table.Head>
							<Table.Head class="text-right">Last 30 Days</Table.Head>
							<Table.Head class="text-right">Total</Table.Head>
							<Table.Head class="hidden md:table-cell">Last Activity</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each vehicles as vehicle (vehicle.id)}
							<Table.Row class="cursor-pointer hover:bg-muted/50">
								<Table.Cell
									class="font-medium"
									onclick={() => handleRowClick(vehicle.id)}
									role="button"
									tabindex={0}
									onkeydown={e => e.key === 'Enter' && handleRowClick(vehicle.id)}
								>
									<div class="flex items-center gap-2">
										<div class="flex flex-col">
											<span class="font-semibold">{vehicle.nickname || vehicle.name}</span>
											{#if vehicle.nickname}
												<span class="text-xs text-muted-foreground">{vehicle.name}</span>
											{/if}
										</div>
										{#if vehicle.hasActiveFinancing}
											<Badge variant="secondary" class="text-xs">Financed</Badge>
										{/if}
									</div>
								</Table.Cell>
								<Table.Cell class="text-right">
									<span class="font-semibold">{formatCurrency(vehicle.recentExpenses)}</span>
								</Table.Cell>
								<Table.Cell class="text-right">
									<span class="font-semibold">{formatCurrency(vehicle.totalExpenses)}</span>
								</Table.Cell>
								<Table.Cell class="hidden md:table-cell">
									{#if vehicle.lastActivity}
										<div class="flex items-center gap-1.5 text-sm text-muted-foreground">
											<Calendar class="h-3.5 w-3.5" />
											{formatRelativeTime(vehicle.lastActivity)}
										</div>
									{:else}
										<span class="text-sm text-muted-foreground">No activity</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right">
									<Button
										variant="ghost"
										size="sm"
										onclick={e => {
											e.stopPropagation();
											gotoWithQuery(resolve(routes.expenseNew), {
												vehicleId: vehicle.id,
												returnTo: routes.dashboard
											});
										}}
									>
										Add Expense
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{:else}
			<EmptyState>
				{#snippet icon()}
					<Car class="h-12 w-12 text-muted-foreground" />
				{/snippet}
				{#snippet title()}
					No vehicles yet
				{/snippet}
				{#snippet description()}
					Add your first vehicle to start tracking
				{/snippet}
				{#snippet action()}
					<Button href={resolve(routes.vehicleNew)}>Add Vehicle</Button>
				{/snippet}
			</EmptyState>
		{/if}
	</Card.Content>
</Card.Root>
