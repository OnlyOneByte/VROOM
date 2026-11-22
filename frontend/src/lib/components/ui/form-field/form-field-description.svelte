<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '#lib/utils.js';

	let {
		id,
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLParagraphElement> = $props();
</script>

<p {id} class={cn('text-sm text-muted-foreground', className)} {...restProps}>
	{@render children?.()}
</p>
