<script lang="ts">
	interface Props {
		/** Primary metric label */
		label: string;
		/** Primary metric value */
		value: string | number;
		/** Optional unit for primary metric */
		unit?: string;
		/** Optional secondary metric label */
		secondaryLabel?: string;
		/** Optional secondary metric value */
		secondaryValue?: string | number;
		/** Optional unit for secondary metric */
		secondaryUnit?: string;
		/** Additional CSS classes */
		class?: string;
	}

	let {
		label,
		value,
		unit,
		secondaryLabel,
		secondaryValue,
		secondaryUnit,
		class: className = ''
	}: Props = $props();
</script>

<div class="flex flex-col p-4 rounded-lg border bg-card {className}">
	<div class="flex items-start justify-between gap-4">
		<!-- Primary Metric -->
		<div class="flex-1 space-y-1 min-w-0">
			<span class="text-sm font-medium text-muted-foreground">{label}</span>
			<div class="flex items-baseline gap-1 flex-wrap">
				<span class="text-2xl font-bold">{value}</span>
				{#if unit}
					<span class="text-xs text-muted-foreground">{unit}</span>
				{/if}
			</div>
		</div>

		{#if secondaryLabel && secondaryValue !== undefined}
			<!-- Divider -->
			<div class="w-px bg-border self-stretch my-1"></div>

			<!-- Secondary Metric -->
			<div class="flex-1 space-y-1 min-w-0">
				<span class="text-sm font-medium text-muted-foreground">{secondaryLabel}</span>
				<div class="flex items-baseline gap-1 flex-wrap">
					<span class="text-2xl font-bold">{secondaryValue}</span>
					{#if secondaryUnit}
						<span class="text-xs text-muted-foreground">{secondaryUnit}</span>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
