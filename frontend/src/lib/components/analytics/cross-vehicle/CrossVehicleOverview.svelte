<script lang="ts">
	import {
		TableBody,
		TableCaption,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '#lib/components/ui/table/index.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import type { CarValue, CategoryMatrix, CrossHero } from './cross-overview';

	interface Props {
		hero: CrossHero | null;
		running: CarValue[];
		allIn: CarValue[];
		matrix: CategoryMatrix;
		vehicleColors?: Record<string, string>;
		rangeText: string;
		distanceUnit: string;
	}

	let { hero, running, allIn, matrix, vehicleColors, rangeText, distanceUnit }: Props = $props();

	let rangePhrase = $derived(
		/^(Last |Year to date|All time)/.test(rangeText) ? rangeText.toLowerCase() : rangeText
	);
	let unitWord = $derived(distanceUnit === 'km' ? 'kilometer' : 'mile');
	let rate = (v: number) => formatCurrency(v, undefined, 2);
	let whole = (v: number) => formatCurrency(v, undefined, 0);
	const flush =
		'[&_td:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th:first-child]:pl-0 [&_th:last-child]:pr-0';
</script>

{#snippet bars(id: string, title: string, rows: CarValue[])}
	<div class="space-y-3">
		<h2 class="text-base font-semibold" {id}>{title}</h2>
		<ul class="space-y-2" aria-labelledby={id}>
			{#each rows as row (row.vehicleId)}
				<li
					class="grid grid-cols-[minmax(0,10rem)_minmax(4rem,1fr)_auto] items-center gap-3 text-sm"
				>
					<span class="break-words">{row.label}</span>
					<span class="h-2.5 rounded-full bg-muted-foreground/15" aria-hidden="true">
						<span
							class="block h-full rounded-full"
							style:width="{Math.max(2, row.share * 100)}%"
							style:background-color={vehicleColors?.[row.vehicleId] ?? 'var(--chart-1)'}
						></span>
					</span>
					<span class="font-semibold tabular-nums">{rate(row.value)}/{distanceUnit}</span>
				</li>
			{/each}
		</ul>
	</div>
{/snippet}

<section aria-label="Cross-vehicle overview" class="space-y-8">
	{#if hero}
		<p class="max-w-xl text-base text-muted-foreground md:text-lg">
			Which car costs the most to run, and to own? <strong class="text-foreground">
				{hero.cheapest}
			</strong>
			{#if hero.cheapest === hero.costliest}
				is cheapest to run but costs the most per {unitWord} all in{#if hero.reason}, mostly {hero.reason}{/if}.
			{:else}
				is cheapest to run; <strong class="text-foreground">{hero.costliest}</strong> costs the most
				per {unitWord} all in{#if hero.reason}, mostly {hero.reason}{/if}.
			{/if}
		</p>
	{/if}

	{#if running.length > 0 || allIn.length > 0}
		<div class="grid gap-6 md:grid-cols-2 md:gap-10">
			{#if running.length > 0}
				{@render bars(
					'running-cost-title',
					`Running cost per ${distanceUnit}, ${rangePhrase}`,
					running
				)}
			{/if}
			{#if allIn.length > 0}
				{@render bars('all-in-cost-title', `All-in cost per ${distanceUnit}, lifetime`, allIn)}
			{/if}
		</div>
	{/if}

	{#if matrix.rows.length > 0}
		<div class="space-y-2">
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="relative w-full overflow-x-auto rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				role="region"
				aria-label="Where the money went, all time"
				tabindex="0"
			>
				<table class="w-full caption-bottom text-sm {flush}">
					<TableCaption
						class="mt-0 mb-2 caption-top text-left text-base font-semibold text-foreground"
					>
						Where the money went, all time
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">Category</TableHead>
							{#each matrix.cars as car (car.vehicleId)}
								<TableHead scope="col" class="text-right">{car.label}</TableHead>
							{/each}
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each matrix.rows as row (row.category)}
							<TableRow>
								<TableHead scope="row" class="font-normal">{row.label}</TableHead>
								{#each row.amounts as amount, i (matrix.cars[i]?.vehicleId)}
									<TableCell class="text-right tabular-nums">
										{#if amount == null}
											<span aria-hidden="true">—</span><span class="sr-only">
												Not shared with you
											</span>
										{:else}
											{whole(amount)}
										{/if}
									</TableCell>
								{/each}
							</TableRow>
						{/each}
					</TableBody>
				</table>
			</div>
			{#if matrix.more > 0}
				<p class="text-sm text-muted-foreground">
					And {matrix.more} more {matrix.more === 1 ? 'car' : 'cars'}, with lower totals. Filter by
					car to see one.
				</p>
			{/if}
		</div>
	{/if}
</section>
