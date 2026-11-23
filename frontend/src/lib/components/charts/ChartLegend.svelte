<script lang="ts">
	interface LegendItem {
		key: string;
		label: string;
		color: string;
	}

	interface Props {
		items: LegendItem[];
		ariaLabel?: string;
		hiddenKeys?: readonly string[];
		onToggle?: (_key: string) => void;
		class?: string;
	}

	let { items, ariaLabel, hiddenKeys = [], onToggle, class: className }: Props = $props();
</script>

{#if items.length > 0 && onToggle}
	<div
		class="flex flex-wrap gap-2 {className ?? ''}"
		role="group"
		aria-label={ariaLabel ?? 'Show or hide series'}
	>
		{#each items as item (item.key)}
			{@const hidden = hiddenKeys.includes(item.key)}
			<button
				type="button"
				class="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {hidden
					? 'text-muted-foreground line-through'
					: 'text-foreground'}"
				aria-pressed={!hidden}
				onclick={() => onToggle(item.key)}
			>
				<span
					class="h-2.5 w-2.5 shrink-0 rounded-full {hidden ? 'opacity-40' : ''}"
					style:background-color={item.color}
					aria-hidden="true"
				></span>
				{item.label}
			</button>
		{/each}
	</div>
{:else if items.length > 0}
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
