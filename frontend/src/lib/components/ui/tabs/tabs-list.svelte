<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '#lib/utils.js';

	let { ref = $bindable(null), class: className, ...restProps }: TabsPrimitive.ListProps = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	class={cn(
		'bg-sunk text-muted-foreground inline-flex h-auto w-fit gap-0.5 sm:h-10 items-center justify-center rounded-full p-[3px]',
		className
	)}
	{...restProps}
/>
