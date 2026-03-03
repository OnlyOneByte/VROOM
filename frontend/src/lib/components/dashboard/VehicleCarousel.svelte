<script lang="ts">
	import { goto } from '$app/navigation';
	import { Car, Calendar, TrendingUp, DollarSign, Image as ImageIcon } from 'lucide-svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Carousel from '$lib/components/ui/carousel';
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
		coverPhotoUrl?: string | null;
	}

	interface Props {
		vehicles: VehicleOverview[];
		isLoading?: boolean;
	}

	let { vehicles, isLoading = false }: Props = $props();

	function handleVehicleClick(vehicleId: string) {
		goto(`/vehicles/${vehicleId}`);
	}
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>Your Fleet</Card.Title>
				<Card.Description>Click on a vehicle to view details</Card.Description>
			</div>
			<div class="p-2 rounded-lg bg-chart-2/10">
				<Car class="h-5 w-5 text-chart-2" />
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{#each Array(3) as _, i (i)}
					<Skeleton class="h-64 w-full" />
				{/each}
			</div>
		{:else if vehicles.length > 0}
			<Carousel.Root
				opts={{
					align: 'start',
					loop: false
				}}
				class="w-full relative"
			>
				<Carousel.Content class="-ml-2 md:-ml-4">
					{#each vehicles as vehicle (vehicle.id)}
						<Carousel.Item
							class="pl-2 md:pl-4 basis-[85%] sm:basis-[70%] md:basis-1/2 lg:basis-1/3"
						>
							<div class="p-1">
								<Card.Root
									class="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group"
									onclick={() => handleVehicleClick(vehicle.id)}
									role="button"
									tabindex={0}
									onkeydown={e => e.key === 'Enter' && handleVehicleClick(vehicle.id)}
								>
									<!-- Image area -->
									<div
										class="relative h-40 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center overflow-hidden"
									>
										{#if vehicle.coverPhotoUrl}
											<img
												src={vehicle.coverPhotoUrl}
												alt={vehicle.name}
												class="absolute inset-0 h-full w-full object-cover group-hover:scale-110 transition-transform duration-300"
											/>
										{:else}
											<div
												class="absolute inset-0 bg-gradient-to-br from-primary/20 to-accent/20 group-hover:scale-110 transition-transform duration-300"
											></div>
											<ImageIcon class="h-16 w-16 text-muted-foreground/40 relative z-10" />
										{/if}
										{#if vehicle.hasActiveFinancing}
											<Badge
												variant="secondary"
												class="absolute top-3 right-3 z-20 bg-background/90 backdrop-blur-sm"
											>
												Financed
											</Badge>
										{/if}
									</div>

									<Card.Content class="p-4 flex flex-col h-[200px]">
										<!-- Vehicle Name -->
										<div class="mb-3">
											<h3 class="font-semibold text-lg leading-tight">
												{vehicle.nickname || vehicle.name}
											</h3>
											{#if vehicle.nickname}
												<p class="text-sm text-muted-foreground">{vehicle.name}</p>
											{/if}
										</div>

										<!-- Stats - Fixed height container -->
										<div class="space-y-2 flex-1">
											<div class="flex items-center justify-between text-sm">
												<span class="text-muted-foreground flex items-center gap-1.5">
													<TrendingUp class="h-3.5 w-3.5" />
													Last 30 Days
												</span>
												<span class="font-semibold">{formatCurrency(vehicle.recentExpenses)}</span>
											</div>
											<div class="flex items-center justify-between text-sm">
												<span class="text-muted-foreground flex items-center gap-1.5">
													<DollarSign class="h-3.5 w-3.5" />
													Total Expenses
												</span>
												<span class="font-semibold">{formatCurrency(vehicle.totalExpenses)}</span>
											</div>
											<div class="flex items-center justify-between text-sm">
												<span class="text-muted-foreground flex items-center gap-1.5">
													<Calendar class="h-3.5 w-3.5" />
													Last Activity
												</span>
												<span class="text-muted-foreground">
													{vehicle.lastActivity
														? formatRelativeTime(vehicle.lastActivity)
														: 'No activity'}
												</span>
											</div>
										</div>

										<!-- Action Button -->
										<Button
											variant="outline"
											size="sm"
											class="w-full mt-3"
											onclick={e => {
												e.stopPropagation();
												goto(`/expenses/new?vehicleId=${vehicle.id}&returnTo=/dashboard`);
											}}
										>
											Add Expense
										</Button>
									</Card.Content>
								</Card.Root>
							</div>
						</Carousel.Item>
					{/each}
				</Carousel.Content>
				{#if vehicles.length > 1}
					<Carousel.Previous
						variant="ghost"
						class="left-2 md:left-4 bg-background/90 hover:bg-background shadow-md"
					/>
					<Carousel.Next
						variant="ghost"
						class="right-2 md:right-4 bg-background/90 hover:bg-background shadow-md"
					/>
				{/if}
			</Carousel.Root>
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
					<Button href="/vehicles/new">Add Vehicle</Button>
				{/snippet}
			</EmptyState>
		{/if}
	</Card.Content>
</Card.Root>
