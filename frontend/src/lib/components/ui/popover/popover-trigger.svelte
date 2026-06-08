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
	<!-- Forward the `child` snippet to the PRIMITIVE's own `child` prop so bits-ui
	     renders ONLY the delegated element (merging its trigger behavior via `props`)
	     instead of wrapping it in its own <button>. Rendering child *inside*
	     <Trigger> emits a button-in-button (nested-interactive) whose outer button
	     has no accessible name (button-name) — a real a11y bug the date pickers hit. -->
	<PopoverPrimitive.Trigger {...restProps} {child} />
{:else}
	<PopoverPrimitive.Trigger {...restProps}>
		{@render children?.()}
	</PopoverPrimitive.Trigger>
{/if}
