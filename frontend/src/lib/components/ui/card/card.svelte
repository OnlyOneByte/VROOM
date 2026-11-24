<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		variant?: 'default' | 'section';
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-variant={variant}
	class={cn(
		variant === 'section'
			? 'text-foreground flex flex-col gap-3 border-t pt-4 [&>[data-slot^=card-]]:px-0'
			: 'bg-card text-card-foreground flex flex-col gap-6 rounded-[var(--r-lg)] border py-6',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
