<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
	import { cn, type WithElementRef } from '#lib/utils.js';

	type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, 'type'> &
			({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		'data-slot': dataSlot = 'input',
		...restProps
	}: Props = $props();
</script>

{#if type === 'file'}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			'selection:bg-primary selection:text-primary-foreground border-border-strong bg-surface placeholder:text-muted-foreground flex h-11.5 w-full min-w-0 rounded-[var(--r-md)] border-[1.5px] px-3.5 pt-2.5 text-sm font-medium outline-none transition-[color,box-shadow,border-color] disabled:cursor-not-allowed disabled:opacity-50',
			'focus-visible:border-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px]',
			'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-2 aria-invalid:border-destructive',
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			'border-border-strong bg-surface selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground flex h-11.5 w-full min-w-0 rounded-[var(--r-md)] border-[1.5px] px-3.5 py-1 text-base tabular-nums outline-none md:text-sm transition-[color,box-shadow,border-color] disabled:cursor-not-allowed disabled:opacity-50',
			'focus-visible:border-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px]',
			'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-2 aria-invalid:border-destructive',
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
