<script lang="ts">
	interface Props {
		label: string;
		value: string | number;
		unit?: string;
		class?: string;
	}

	let { label, value, unit, class: className = '' }: Props = $props();
</script>

<div class="flex flex-col space-y-1 p-4 rounded-lg border bg-card {className}">
	<span class="text-sm font-medium text-muted-foreground">{label}</span>
	<span class="text-2xl font-bold">{value}</span>
	{#if unit}
		<span class="text-xs text-muted-foreground">{unit}</span>
	{/if}
</div>
