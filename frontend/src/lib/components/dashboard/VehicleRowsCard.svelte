<script lang="ts">
	import { resolve } from '$app/paths';
	import { Car, Zap } from '@lucide/svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { paramRoutes } from '#lib/routes.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import type { VehicleRow } from './dashboard-data';

	interface Props {
		rows: VehicleRow[];
		periodLabel: string;
		distanceLabel: string;
	}

	let { rows, periodLabel, distanceLabel }: Props = $props();

	const SPARK_WIDTH = 64;
	const SPARK_HEIGHT = 20;

	function sparkPoints(values: number[]): string {
		const max = Math.max(...values, 0);
		const step = values.length > 1 ? SPARK_WIDTH / (values.length - 1) : 0;
		return values
			.map((value, i) => {
				const y =
					max > 0 ? SPARK_HEIGHT - 2 - (value / max) * (SPARK_HEIGHT - 4) : SPARK_HEIGHT / 2;
				return `${Math.round(i * step * 10) / 10},${Math.round(y * 10) / 10}`;
			})
			.join(' ');
	}
</script>

<Card.Root class="gap-0 py-0" data-testid="vehicle-rows">
	<Card.Header class="flex flex-row items-center justify-between gap-3 px-5 py-4">
		<Card.Title level={2} class="text-lg">Your vehicles</Card.Title>
		<p class="text-xs text-muted-foreground">{periodLabel} · per {distanceLabel}</p>
	</Card.Header>
	<Card.Content class="px-0">
		<ul class="divide-y border-t" role="list">
			{#each rows as row (row.id)}
				<li class="relative flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
					<span
						class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
						aria-hidden="true"
					>
						{#if row.isElectric}<Zap class="size-4" />{:else}<Car class="size-4" />{/if}
					</span>
					<div class="min-w-0 flex-1">
						<a
							href={resolve(paramRoutes.vehicle, { id: row.id })}
							class="block truncate rounded-sm text-sm font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							{row.name}
						</a>
						<p class="truncate text-xs text-muted-foreground">{row.detail}</p>
					</div>
					{#if row.trend && row.trend.some(value => value > 0)}
						<svg
							class="hidden shrink-0 text-chart-2 min-[400px]:block"
							width={SPARK_WIDTH}
							height={SPARK_HEIGHT}
							viewBox="0 0 {SPARK_WIDTH} {SPARK_HEIGHT}"
							aria-hidden="true"
							data-testid="vehicle-sparkline"
						>
							<polyline
								points={sparkPoints(row.trend)}
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linejoin="round"
								stroke-linecap="round"
							/>
						</svg>
					{/if}
					<div class="shrink-0 text-right">
						<p class="text-sm font-semibold tabular-nums text-foreground">
							{formatCurrency(row.spend)}
						</p>
						<p class="text-xs tabular-nums text-muted-foreground">
							{#if row.runningPerDistance === null}
								<span aria-hidden="true">—</span>
								<span class="sr-only">No running cost per {distanceLabel} for this period</span>
							{:else}
								{formatCurrency(row.runningPerDistance)}/{distanceLabel}
							{/if}
						</p>
					</div>
				</li>
			{/each}
		</ul>
	</Card.Content>
</Card.Root>
