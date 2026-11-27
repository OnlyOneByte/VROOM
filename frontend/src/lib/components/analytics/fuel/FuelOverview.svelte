<script lang="ts">
	import type { FuelAdvancedResponse, FuelStatsResponse } from '#lib/types/index.ts';
	import { parseMonthToDate } from '#lib/utils/chart-formatters.ts';
	import { formatCurrency, formatDateWith, formatNumber } from '#lib/utils/formatters.ts';
	import {
		Table,
		TableBody,
		TableCaption,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '#lib/components/ui/table/index.ts';
	import { chargerRows, economyRows, fillupRows, homeSplit, priceSummary } from './fuel-overview';

	interface Props {
		fuelStats: FuelStatsResponse;
		fuelAdvanced?: FuelAdvancedResponse | null;
		vehicleColors: Record<string, string>;
		rangeText: string;
		volumeUnit: string;
		chargeUnit: string;
		efficiencyUnit: string;
		electricEfficiencyUnit: string;
		showCharging: boolean;
	}

	let {
		fuelStats,
		fuelAdvanced,
		vehicleColors,
		rangeText,
		volumeUnit,
		chargeUnit,
		efficiencyUnit,
		electricEfficiencyUnit,
		showCharging
	}: Props = $props();

	let price = $derived(priceSummary(fuelStats.gasPriceHistory));
	let charging = $derived(showCharging ? fuelStats.charging : undefined);
	let economy = $derived(economyRows(fuelAdvanced?.vehicleRadar ?? []));
	let fillups = $derived(fillupRows(fuelStats.fillupsByVehicle));
	let chargers = $derived(charging ? chargerRows(charging.byChargerType) : []);
	let split = $derived(charging ? homeSplit(charging.byChargerType) : null);
	let money = (v: number) => formatCurrency(v, undefined, 2);
	let rate = (v: number) => formatCurrency(v, undefined, 3);
	let percent = (share: number) => `${formatNumber(share * 100, 0)}%`;
	let monthName = (month: string) =>
		formatDateWith(parseMonthToDate(month), { month: 'long', year: 'numeric' });
	let rangePhrase = $derived(
		/^(Last |Year to date|All time)/.test(rangeText) ? rangeText.toLowerCase() : rangeText
	);
	let sessions = $derived(charging?.sessions.currentYear ?? 0);
</script>

<section aria-label="Fuel and charging overview" class="grid gap-6 md:grid-cols-2 md:gap-10">
	{#if price}
		<div class="space-y-2">
			<h2 class="text-sm font-normal text-muted-foreground">{price.fuelType}, {rangePhrase}</h2>
			<p
				class="font-(family-name:--font-fig) text-6xl leading-none font-bold tabular-nums lg:text-7xl"
			>
				{money(price.average)}
			</p>
			<p class="max-w-md text-base text-muted-foreground md:text-lg">
				per {volumeUnit} on average.
				{#if price.months > 1}
					Monthly averages stayed between <strong class="text-foreground">
						{money(price.low)}
					</strong>
					and <strong class="text-foreground">{money(price.high)}</strong>; {monthName(
						price.cheapestMonth
					)} was the cheapest month.
				{/if}
			</p>
		</div>
	{/if}

	<div class="min-w-0 space-y-6 md:self-end">
		{#if charging && (charging.sessions.currentYear > 0 || charging.averageCost.perEnergyUnit != null)}
			<div class="space-y-2">
				<h2 class="text-sm font-normal text-muted-foreground">Charging</h2>
				<p class="max-w-md text-base md:text-lg">
					{#if charging.averageCost.perEnergyUnit != null}
						<strong>{rate(charging.averageCost.perEnergyUnit)}</strong>
						per {chargeUnit} on average across
					{/if}
					<strong>{formatNumber(sessions, 0)}</strong>
					{sessions === 1 ? 'session' : 'sessions'}{#if charging.efficiency.avgEfficiency != null},
						at <strong>{formatNumber(charging.efficiency.avgEfficiency, 1)}</strong>
						{electricEfficiencyUnit}{/if}{#if charging.averageCost.perEnergyUnit == null}, with no
						costs recorded{/if}.
				</p>
				{#if split}
					<p class="max-w-md text-base md:text-lg">
						<strong>{percent(split.homeShare)}</strong> of energy came from home at
						<strong>{rate(split.homeRate)}</strong>
						per {chargeUnit}{#if split.awayRate != null}; away from home it cost
							<strong>{rate(split.awayRate)}</strong>{/if}.
					</p>
				{/if}
			</div>
		{/if}

		{#if economy.length > 0}
			<div class="space-y-3">
				<h2 class="text-base font-semibold" id="fuel-economy-title">Fuel economy</h2>
				<ul class="space-y-2" aria-labelledby="fuel-economy-title">
					{#each economy as row (row.vehicleId)}
						<li
							class="grid grid-cols-[minmax(0,10rem)_minmax(4rem,1fr)_auto] items-center gap-3 text-sm"
						>
							<span class="break-words">{row.label}</span>
							<span class="h-2.5 rounded-full bg-muted-foreground/15" aria-hidden="true">
								<span
									class="block h-full rounded-full"
									style:width="{Math.max(2, row.share * 100)}%"
									style:background-color={vehicleColors[row.vehicleId] ?? 'var(--chart-1)'}
								></span>
							</span>
							<span class="font-semibold tabular-nums">
								{formatNumber(row.value, 1)}
								{efficiencyUnit}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
</section>

{#if fillups.length > 0 || chargers.length > 0}
	<div class="grid gap-6 md:grid-cols-2 md:gap-10">
		{#if fillups.length > 0}
			<Table>
				<TableCaption
					class="mt-0 mb-2 caption-top text-left text-base font-semibold text-foreground"
				>
					Fill-ups
				</TableCaption>
				<TableHeader>
					<TableRow>
						<TableHead>Car</TableHead>
						<TableHead class="text-right">Fill-ups</TableHead>
						<TableHead class="text-right">{volumeUnit}</TableHead>
						<TableHead class="text-right">Avg price</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each fillups as row (row.vehicleId)}
						<TableRow>
							<TableCell class="whitespace-normal">{row.label}</TableCell>
							<TableCell class="text-right tabular-nums">{formatNumber(row.count, 0)}</TableCell>
							<TableCell class="text-right tabular-nums">{formatNumber(row.volume, 0)}</TableCell>
							<TableCell class="text-right tabular-nums">
								{row.avgPrice != null ? money(row.avgPrice) : '—'}
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		{/if}
		{#if chargers.length > 0}
			<Table>
				<TableCaption
					class="mt-0 mb-2 caption-top text-left text-base font-semibold text-foreground"
				>
					Charging
				</TableCaption>
				<TableHeader>
					<TableRow>
						<TableHead>Where</TableHead>
						<TableHead class="text-right">Sessions</TableHead>
						<TableHead class="text-right">Share of energy</TableHead>
						<TableHead class="text-right">Per {chargeUnit}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each chargers as row (row.key)}
						<TableRow>
							<TableCell>{row.label}</TableCell>
							<TableCell class="text-right tabular-nums">{formatNumber(row.sessions, 0)}</TableCell>
							<TableCell class="text-right tabular-nums">{percent(row.share)}</TableCell>
							<TableCell class="text-right tabular-nums">
								{row.rate != null ? rate(row.rate) : '—'}
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		{/if}
	</div>
{/if}
