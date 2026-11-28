<script lang="ts">
	import { Switch as SwitchPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		checked = $bindable(false),
		...restProps
	}: WithoutChildrenOrChild<SwitchPrimitive.RootProps> = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	class={cn(
		'data-[state=checked]:bg-success data-[state=unchecked]:bg-border-strong focus-visible:ring-ring/50 peer relative inline-flex h-6.5 w-11 shrink-0 items-center rounded-full px-0.5 before:absolute before:left-1/2 before:top-1/2 before:size-10 before:-translate-x-1/2 before:-translate-y-1/2 border border-transparent outline-none transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class={cn(
			'bg-surface dark:data-[state=checked]:bg-sunk dark:data-[state=unchecked]:bg-foreground pointer-events-none block size-5 rounded-full ring-0 motion-safe:transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0'
		)}
	/>
</SwitchPrimitive.Root>
