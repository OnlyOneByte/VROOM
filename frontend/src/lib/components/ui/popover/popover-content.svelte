<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import type { Snippet } from "svelte";

	interface Props {
		class?: string;
		align?: "start" | "center" | "end";
		sideOffset?: number;
		children?: Snippet;
	}

	let {
		class: className,
		align = "center",
		sideOffset = 4,
		children,
		...restProps
	}: Props = $props();
</script>

<PopoverPrimitive.Content
	{align}
	{sideOffset}
	class={cn(
		"z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</PopoverPrimitive.Content>
