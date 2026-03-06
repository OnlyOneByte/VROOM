<script lang="ts">
	import { cn } from '$lib/utils.js';

	let {
		id,
		class: className,
		children,
		...restProps
	}: {
		id?: string;
		class?: string;
		children?: any;
		[key: string]: any;
	} = $props();
</script>

<p {id} class={cn('text-sm text-muted-foreground', className)} {...restProps}>
	{@render children?.()}
</p>
