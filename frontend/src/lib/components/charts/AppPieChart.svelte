<script lang="ts">
	import { PieChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import ChartCard from './ChartCard.svelte';
	import { createVisibilityWatch } from '$lib/utils/visibility-watch.svelte';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { Snippet } from 'svelte';

	interface PieDataItem {
		key: string;
		label: string;
		value: number;
		color: string;
		percentage?: number;
	}

	interface Props {
		title: string;
		description?: string;
		data: PieDataItem[];
		isLoading?: boolean;
		error?: string | null;
		icon?: Snippet;
		showLegend?: boolean;
		class?: string;
	}

	let {
		title,
		description,
		data,
		isLoading = false,
		error = null,
		icon,
		showLegend = true,
		class: className
	}: Props = $props();

	let isEmpty = $derived(data.length === 0);

	let chartConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const item of data) {
			config[item.key] = { label: item.label, color: item.color };
		}
		return config;
	});

	// Gate PieChart rendering until the container is visible in the viewport.
	// The SVG motion tween (endAngle sweep from 0→2π) fires at mount time,
	// so we must delay mounting until the user can see it. Uses synchronous
	// MutationObserver + offsetParent check instead of async IntersectionObserver.
	let pieGate = createVisibilityWatch();
</script>

<ChartCard {title} {description} {isLoading} {error} {isEmpty} {icon} class={className}>
	<div class="flex flex-col md:flex-row gap-6">
		<div class="flex-1 flex items-center justify-center overflow-hidden" bind:this={pieGate.el}>
			<div class="mx-auto aspect-square max-h-[250px] w-full max-w-[250px]">
				{#if pieGate.visible}
					<Chart.Container config={chartConfig} class="aspect-square h-full w-full overflow-hidden">
						<PieChart
							{data}
							key="key"
							value="value"
							label="label"
							cRange={data.map(d => d.color)}
							innerRadius={0.5}
							padAngle={0.02}
							cornerRadius={4}
							props={{
								pie: {
									motion: {
										type: 'tween',
										duration: 800,
										easing: (t: number) => 1 - Math.pow(1 - t, 3)
									}
								}
							}}
						>
							{#snippet tooltip()}
								<Chart.Tooltip hideLabel />
							{/snippet}
						</PieChart>
					</Chart.Container>
				{/if}
			</div>
		</div>

		{#if showLegend}
			<div class="flex-1 space-y-1.5 min-w-0" role="list" aria-label="Categories">
				{#each data as item (item.key)}
					<div class="flex items-center justify-between rounded-lg p-2" role="listitem">
						<div class="flex items-center gap-2">
							<div
								class="h-3 w-3 rounded-full shrink-0"
								style:background-color={item.color}
								aria-hidden="true"
							></div>
							<span class="text-sm font-medium">{item.label}</span>
						</div>
						<div class="text-right">
							<div class="text-sm font-bold">{formatCurrency(item.value)}</div>
							{#if item.percentage != null}
								<div class="text-xs text-muted-foreground">
									{item.percentage.toFixed(1)}%
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</ChartCard>
