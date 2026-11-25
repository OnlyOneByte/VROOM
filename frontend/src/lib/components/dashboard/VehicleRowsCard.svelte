<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { paramRoutes, routes } from '#lib/routes.ts';
	import { buildVehicleColorMap } from '#lib/utils/chart-colors.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import type { VehicleRow } from './dashboard-data';

	interface Props {
		rows: VehicleRow[];
		periodLabel: string;
		distanceLabel: string;
	}

	let { rows, periodLabel, distanceLabel }: Props = $props();

	let colors = $derived(buildVehicleColorMap(rows.map(row => row.id)));
</script>

<Card.Root variant="section" data-testid="vehicle-rows">
	<Card.Header class="flex flex-row items-center justify-between gap-3">
		<p class="flex items-baseline gap-1.5">
			<Card.Title level={2} class="text-base">Your garage</Card.Title>
			<span class="text-sm text-muted-foreground">· {periodLabel}</span>
		</p>
		<a
			href={resolve(routes.vehicles)}
			class="rounded-sm text-sm font-semibold text-accent-ink outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
		>
			All<span class="sr-only"> vehicles</span>
		</a>
	</Card.Header>
	<Card.Content>
		<ul class="divide-y divide-border" role="list">
			{#each rows as row (row.id)}
				<li class="relative flex items-center gap-4 py-3">
					<span
						class="h-9 w-1.5 shrink-0 rounded-full"
						style:background={colors[row.id]}
						aria-hidden="true"
					></span>
					<div class="min-w-0 flex-1">
						<a
							href={resolve(paramRoutes.vehicle, { id: row.id })}
							class="block truncate rounded-sm font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							{row.name}
						</a>
						<p class="truncate text-sm text-muted-foreground">{row.detail}</p>
					</div>
					<div class="shrink-0 text-right">
						<p class="font-semibold tabular-nums text-foreground">
							{formatCurrency(row.spend)}
						</p>
						<p class="text-xs font-semibold tabular-nums text-muted-foreground">
							{#if row.runningPerDistance === null}
								<span aria-hidden="true">—</span>
								<span class="sr-only">No running cost per {distanceLabel} for this period</span>
							{:else}
								{formatCurrency(row.runningPerDistance)}/{distanceLabel}, {periodLabel}
							{/if}
						</p>
					</div>
				</li>
			{/each}
		</ul>
	</Card.Content>
</Card.Root>
