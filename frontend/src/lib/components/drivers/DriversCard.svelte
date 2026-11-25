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

	const miles = (n: number) => `${formatNumber(n, 0)} ${unit}`;
	const percent = (share: number | null) => (share === null ? '' : `${Math.round(share * 100)}%`);
	let summary = $derived(
		shown.map(d => `${d.name}: ${miles(d.distance.total)} ${percent(d.share)}`).join('; ')
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
				<table class="w-full text-sm">
					<caption class="sr-only">Distance and running costs paid by each driver</caption>
					<thead class="sr-only">
						<tr><th>Driver</th><th>Distance</th><th>Share</th><th>Paid</th></tr>
					</thead>
					<tbody>
						{#each shown as driver (driver.driverId)}
							<tr class="h-10">
								<th scope="row" class="text-left font-normal">
									<span class="inline-flex items-center gap-2">
										<span
											class="size-2.5 shrink-0 rounded-full"
											style:background-color={driverColor(driver)}
											aria-hidden="true"
										></span>
										{driver.name}
										{#if driver.you && stats.scope === 'everyone'}
											<span class="text-muted-foreground">(you)</span>
										{/if}
									</span>
								</th>
								<td class="text-right tabular-nums">
									{miles(driver.distance.total)}
									{#if driver.distance.estimated > 0}
										<span class="block text-xs text-muted-foreground">
											{formatNumber(driver.distance.estimated, 0)} estimated
										</span>
									{/if}
								</td>
								<td class="text-right tabular-nums text-muted-foreground">
									{percent(driver.share)}
								</td>
								<td class="text-right tabular-nums">
									{formatCurrency(driver.runningCostsPaid)} paid
								</td>
							</tr>
						{/each}
						{#if stats.distance && stats.distance.unattributed > 0}
							<tr class="h-10 text-muted-foreground">
								<th scope="row" class="text-left font-normal">Unattributed</th>
								<td class="text-right tabular-nums">{miles(stats.distance.unattributed)}</td>
								<td></td>
								<td></td>
							</tr>
						{/if}
					</tbody>
				</table>
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
