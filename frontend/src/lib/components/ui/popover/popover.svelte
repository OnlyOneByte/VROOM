<script lang="ts">
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		children?: Snippet;
	}

	let { open = $bindable(false), children, ...restProps }: Props = $props();
</script>

<PopoverPrimitive.Root bind:open {...restProps}>
	{@render children?.()}
</PopoverPrimitive.Root>
