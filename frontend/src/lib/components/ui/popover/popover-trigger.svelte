<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import type { Snippet } from "svelte";

	interface Props extends PopoverPrimitive.TriggerProps {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
		children?: Snippet;
	}

	let { child, children, ...restProps }: Props = $props();
</script>

{#if child}
	<PopoverPrimitive.Trigger {...restProps}>
		{@render child({ props: restProps })}
	</PopoverPrimitive.Trigger>
{:else}
	<PopoverPrimitive.Trigger {...restProps}>
		{@render children?.()}
	</PopoverPrimitive.Trigger>
{/if}
