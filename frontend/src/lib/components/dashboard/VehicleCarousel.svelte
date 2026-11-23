<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { gotoWithQuery } from '#lib/utils/navigation.ts';
	import {
		ArrowLeft,
		ArrowRight,
		Car,
		Calendar,
		TrendingUp,
		DollarSign,
		Plus,
		Users,
		Zap
	} from '@lucide/svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Carousel from '#lib/components/ui/carousel/index.ts';
	import type { CarouselAPI } from '#lib/components/ui/carousel/context.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { formatCurrency, formatRelativeTime } from '#lib/utils/formatters.ts';

	interface VehicleOverview {
		id: string;
		name: string;
		nickname?: string | null;
		recentExpenses: number;
		totalExpenses: number;
		lastActivity: Date | null;
		hasActiveFinancing: boolean;
		coverPhotoUrl?: string | null;
		sharedBy?: string | null;
		make?: string;
		vehicleType?: string;
	}

	interface Props {
		vehicles: VehicleOverview[];
		isLoading?: boolean;
		addVehicleHref?: string;
	}

	let { vehicles, isLoading = false, addVehicleHref }: Props = $props();
	const uid = $props.id();
	const titleId = `${uid}-fleet-title`;
	const carouselId = `${uid}-fleet-carousel`;

	let canScrollPrev = $state(false);
	let canScrollNext = $state(false);
	let carousel = $state<HTMLElement | null>(null);
	let arrows = $state<HTMLElement | null>(null);
	let carouselApi = $state<CarouselAPI>();
	let showArrows = $derived(!isLoading && (canScrollPrev || canScrollNext));

	function pageWithKeys(event: KeyboardEvent) {
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			carouselApi?.scrollPrev();
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			carouselApi?.scrollNext();
		}
	}

	function trackScrollRange(api: CarouselAPI | undefined) {
		if (!api) return;
		carouselApi = api;
		const sync = () => {
			canScrollPrev = api.canScrollPrev();
			canScrollNext = api.canScrollNext();
			const focusedArrow = arrows?.contains(document.activeElement) ?? false;
			if (!canScrollPrev && !canScrollNext && focusedArrow) {
				carousel?.focus();
			}
		};
		sync();
		api.on('select', sync);
		api.on('reInit', sync);
	}
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between gap-2">
			<div class="min-w-0">
				<Card.Title level={2} id={titleId}>Your Fleet</Card.Title>
				<Card.Description class="hidden sm:block">
					Click on a vehicle to view details
				</Card.Description>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				{#if addVehicleHref}
					<Button
						variant="ghost"
						size="lg"
						href={addVehicleHref}
						class="lg:hidden {showArrows ? 'max-sm:w-10' : ''}"
					>
						<Plus class="h-4 w-4 {showArrows ? 'sm:mr-2' : 'mr-2'}" />
						<span class={showArrows ? 'max-sm:sr-only' : ''}>Add Vehicle</span>
					</Button>
				{/if}
				{#if showArrows}
					<div bind:this={arrows} class="flex items-center gap-2" data-testid="fleet-arrows">
						<Button
							variant="outline"
							size="icon-lg"
							class="rounded-full"
							aria-controls={carouselId}
							aria-disabled={!canScrollPrev}
							onclick={() => carouselApi?.scrollPrev()}
							onkeydown={pageWithKeys}
						>
							<ArrowLeft class="size-4" />
							<span class="sr-only">Previous slide</span>
						</Button>
						<Button
							variant="outline"
							size="icon-lg"
							class="rounded-full"
							aria-controls={carouselId}
							aria-disabled={!canScrollNext}
							onclick={() => carouselApi?.scrollNext()}
							onkeydown={pageWithKeys}
						>
							<ArrowRight class="size-4" />
							<span class="sr-only">Next slide</span>
						</Button>
					</div>
				{:else}
					<div class="p-2 rounded-lg bg-chart-2/10 {addVehicleHref ? 'hidden lg:block' : ''}">
						<Car class="h-5 w-5 text-chart-2" />
					</div>
				{/if}
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
				setApi={trackScrollRange}
				bind:ref={carousel}
				id={carouselId}
				tabindex={-1}
				aria-labelledby={titleId}
				class="w-full relative rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<Carousel.Content class="-ml-2 md:-ml-4">
					{#each vehicles as vehicle (vehicle.id)}
						<Carousel.Item
							class="pl-2 md:pl-4 basis-[85%] sm:basis-[70%] md:basis-1/2 lg:basis-1/3"
						>
							<div class="p-1">
								<!-- Not a link: a link would nest the Add-Expense button inside it. -->
								<Card.Root class="overflow-hidden hover:bg-accent/50 transition-colors group">
									{#if vehicle.coverPhotoUrl}
										<div
											class="relative h-40 overflow-hidden bg-muted"
											data-testid="fleet-card-header"
										>
											<img
												src={vehicle.coverPhotoUrl}
												alt={vehicle.name}
												class="absolute inset-0 h-full w-full object-cover motion-safe:sm:group-hover:scale-110 transition-transform duration-300"
											/>
										</div>
									{/if}

									<Card.Content class="relative p-4 flex flex-col h-[200px]">
										<!-- Stretched-link overlay: the action button must stay above it (z-10). -->
										<div class="mb-3">
											<div class="flex items-start gap-3">
												{#if !vehicle.coverPhotoUrl}
													<span
														class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
														aria-hidden="true"
														data-testid="fleet-card-avatar"
													>
														{#if vehicle.vehicleType === 'electric'}
															<Zap class="h-5 w-5" />
														{:else}
															<Car class="h-5 w-5" />
														{/if}
													</span>
												{/if}
												<div class="min-w-0 flex-1">
													<h3 class="font-semibold text-lg leading-tight">
														<a
															href={resolve(paramRoutes.vehicle, { id: vehicle.id })}
															class="block rounded-sm after:absolute after:inset-0 after:content-[''] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
														>
															<span class="line-clamp-2 break-words">
																{vehicle.nickname || vehicle.name}
															</span>
														</a>
													</h3>
												</div>
												{#if vehicle.hasActiveFinancing || vehicle.sharedBy}
													<div class="flex max-w-[50%] shrink-0 flex-wrap justify-end gap-1">
														{#if vehicle.hasActiveFinancing}
															<Badge variant="secondary">Financed</Badge>
														{/if}
														{#if vehicle.sharedBy}
															<Badge
																variant="secondary"
																class="inline-flex max-w-full items-center gap-1"
															>
																<Users class="h-3 w-3 shrink-0" aria-hidden="true" />
																<span class="truncate">Shared by {vehicle.sharedBy}</span>
															</Badge>
														{/if}
													</div>
												{/if}
											</div>
											{#if vehicle.nickname}
												<p class="mt-1 truncate text-sm text-muted-foreground">{vehicle.name}</p>
											{/if}
										</div>

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

										<Button
											variant="outline"
											size="lg"
											class="relative z-10 w-full mt-3"
											onclick={() => {
												gotoWithQuery(resolve(routes.expenseNew), {
													vehicleId: vehicle.id,
													returnTo: routes.dashboard
												});
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
					<Button href={resolve(routes.vehicleNew)}>Add Vehicle</Button>
				{/snippet}
			</EmptyState>
		{/if}
	</Card.Content>
</Card.Root>
