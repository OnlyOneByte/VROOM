<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { driverApi } from '#lib/services/driver-api.ts';
	import type { DistanceUnit, DriverStats } from '#lib/types/index.ts';
	import { driverColor } from '#lib/utils/driver-helpers.ts';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';

	interface Props {
		vehicleId: string;
		distanceUnit: DistanceUnit;
		from: Date;
		to: Date;
		description?: string;
	}

	let { vehicleId, distanceUnit, from, to, description = 'Last 30 days' }: Props = $props();

	let stats = $state<DriverStats | null>(null);
	let phase = $state<'loading' | 'ready' | 'hidden' | 'error'>('loading');
	let unit = $derived(getDistanceUnitLabel(distanceUnit, true));
	let shown = $derived((stats?.drivers ?? []).filter(d => d.distance.total > 0));
	let total = $derived(stats?.distance?.total ?? 0);

	async function load(car: string, start: Date, end: Date) {
		phase = 'loading';
		try {
			stats = await driverApi.stats(car, { from: start, to: end });
			phase = stats ? 'ready' : 'hidden';
		} catch {
			phase = 'error';
		}
	}

	$effect(() => {
		void load(vehicleId, from, to);
	});

	const distanceText = (n: number) => `${formatNumber(n, 0)} ${unit}`;
	const percent = (share: number | null) => (share === null ? '' : `${Math.round(share * 100)}%`);
	let summary = $derived(
		[
			...shown.map(d => ({ name: d.name, distance: d.distance.total })),
			{ name: 'Unattributed', distance: stats?.distance?.unattributed ?? 0 }
		]
			.filter(part => part.distance > 0)
			.map(
				part =>
					`${part.name}: ${distanceText(part.distance)}, ${percent(part.distance / total)} of the bar`
			)
			.join('; ')
	);
</script>

{#if phase !== 'hidden'}
	<Card>
		<CardHeader>
			<CardTitle>{stats?.scope === 'own' ? 'Your driving' : 'Drivers'}</CardTitle>
			<CardDescription>{description}</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if phase === 'loading'}
				<div class="space-y-3" aria-label="Loading drivers">
					<Skeleton class="h-3 w-full" />
					<Skeleton class="h-6 w-48" />
					<Skeleton class="h-6 w-40" />
				</div>
			{:else if phase === 'error'}
				<div class="flex items-center justify-between gap-3 text-sm" role="alert">
					<span>Couldn't load the driver figures.</span>
					<Button size="lg" variant="outline" onclick={() => load(vehicleId, from, to)}>
						Retry
					</Button>
				</div>
			{:else if stats && shown.length === 0}
				<p class="text-sm text-muted-foreground">No distance logged in this period yet.</p>
			{:else if stats}
				{#if stats.scope === 'everyone' && total > 0}
					<div
						class="flex h-3 overflow-hidden rounded-full bg-muted"
						role="img"
						aria-label={summary}
					>
						{#each shown as driver (driver.driverId)}
							<span
								class="h-full"
								style:width="{(driver.distance.total / total) * 100}%"
								style:background-color={driverColor(driver)}
							></span>
						{/each}
					</div>
				{/if}
				<ul class="divide-y text-sm" aria-label="Distance and running costs paid by each driver">
					{#each shown as driver (driver.driverId)}
						<li class="py-2">
							<div class="flex items-center gap-2">
								<span
									class="size-2.5 shrink-0 rounded-full"
									style:background-color={driverColor(driver)}
									aria-hidden="true"
								></span>
								<span class="min-w-0 flex-1 truncate font-medium">
									{driver.name}
									{#if driver.you && stats.scope === 'everyone'}
										<span class="font-normal text-muted-foreground">(you)</span>
									{/if}
								</span>
								<span class="tabular-nums">{distanceText(driver.distance.total)}</span>
							</div>
							<p class="pl-4.5 text-xs text-muted-foreground tabular-nums">
								{[
									driver.share === null ? '' : `${percent(driver.share)} of the distance`,
									driver.distance.estimated > 0
										? `${formatNumber(driver.distance.estimated, 0)} estimated`
										: '',
									`${formatCurrency(driver.runningCostsPaid)} paid`
								]
									.filter(Boolean)
									.join(' · ')}
							</p>
						</li>
					{/each}
					{#if stats.distance && stats.distance.unattributed > 0}
						<li class="flex items-center gap-2 py-2 text-muted-foreground">
							<span class="flex-1 pl-4.5">Unattributed</span>
							<span class="tabular-nums">{distanceText(stats.distance.unattributed)}</span>
						</li>
					{/if}
				</ul>
				{#if stats.costPerDistance !== null}
					<p class="text-xs text-muted-foreground">
						Running costs come to {formatCurrency(stats.costPerDistance, undefined, 2)} per {unit}.
						Estimated distance is the gap between readings, credited to whoever logged the reading
						that closes it.
					</p>
				{/if}
			{/if}
		</CardContent>
	</Card>
{/if}
