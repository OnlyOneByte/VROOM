<script lang="ts">
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props extends PopoverPrimitive.TriggerProps {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
		children?: Snippet;
	}

	let { child, children, ...restProps }: Props = $props();
</script>

{#if child}
	<!-- Pass `child` to the primitive's own prop: rendering it inside a bits-ui trigger nests a button in a button, which breaks accessible names. -->
	<PopoverPrimitive.Trigger {...restProps} {child} />
{:else}
	<PopoverPrimitive.Trigger {...restProps}>
		{@render children?.()}
	</PopoverPrimitive.Trigger>
{/if}
