<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { AnalyticsInsight } from '#lib/types/index.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import { getVolumeUnitLabel } from '#lib/utils/units.ts';
	import type { AnalyticsDateRange } from '../analytics-filters';

	interface Props {
		dateRange: AnalyticsDateRange;
		vehicleIds?: string[];
		onApply: (_query: Record<string, string>) => void;
	}

	let { dateRange, vehicleIds, onApply }: Props = $props();

	const MAX_CARDS = 4;
	let insights = $state<AnalyticsInsight[]>([]);

	let start = $derived(dateRange.startDate);
	let end = $derived(dateRange.endDate);
	let cars = $derived(vehicleIds?.join(',') ?? '');

	$effect(() => {
		const controller = new AbortController();
		insights = [];
		analyticsApi
			.insights(
				{ start, end, vehicleIds: cars ? cars.split(',') : undefined },
				{ signal: controller.signal }
			)
			.then(result => (insights = result.slice(0, MAX_CARDS)))
			.catch(() => {
				if (!controller.signal.aborted) insights = [];
			});
		return () => controller.abort();
	});

	function display(insight: AnalyticsInsight): string {
		switch (insight.unit) {
			case 'money':
				return formatCurrency(insight.value);
			case 'days':
				return `${insight.value} ${insight.value === 1 ? 'day' : 'days'}`;
			case 'percent':
				return `${insight.value}%`;
			case 'moneyPerVolume':
				return `${formatCurrency(insight.value)}/${getVolumeUnitLabel(settingsStore.unitPreferences.volumeUnit, true)}`;
		}
	}
</script>

{#if insights.length > 0}
	<section aria-labelledby="insights-heading" class="space-y-3">
		<h2 id="insights-heading" class="text-lg font-semibold">Things we noticed</h2>
		<ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			{#each insights as insight (insight.id)}
				<li>
					<Card.Root class="h-full gap-2 py-4">
						<Card.Header class="px-4">
							<Card.Description>{insight.title}</Card.Description>
							<Card.Title class="text-2xl font-bold tabular-nums">{display(insight)}</Card.Title>
						</Card.Header>
						<Card.Content class="flex-1 px-4 text-sm text-muted-foreground">
							{insight.sentence}
						</Card.Content>
						<Card.Footer class="px-2">
							<Button
								variant="ghost"
								class="h-10"
								aria-label={`Show in Chart: ${insight.title}`}
								onclick={() => onApply(insight.query)}
							>
								Show in Chart
								<ArrowRight class="ml-1 h-4 w-4" aria-hidden="true" />
							</Button>
						</Card.Footer>
					</Card.Root>
				</li>
			{/each}
		</ul>
	</section>
{/if}
