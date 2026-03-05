<script lang="ts">
	interface LegendItem {
		key: string;
		label: string;
		color: string;
	}

	interface Props {
		items: LegendItem[];
		ariaLabel?: string;
		class?: string;
	}

	let { items, ariaLabel, class: className }: Props = $props();
</script>

{#if items.length > 0}
	<div class="flex flex-wrap gap-3 {className ?? ''}" role="list" aria-label={ariaLabel}>
		{#each items as item (item.key)}
			<div class="flex items-center gap-1.5" role="listitem">
				<div
					class="h-2.5 w-2.5 rounded-full shrink-0"
					style:background-color={item.color}
					aria-hidden="true"
				></div>
				<span class="text-xs text-muted-foreground">{item.label}</span>
			</div>
		{/each}
	</div>
{/if}
