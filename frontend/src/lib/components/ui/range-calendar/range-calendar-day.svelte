<script lang="ts">
	import { RangeCalendar as RangeCalendarPrimitive } from 'bits-ui';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: RangeCalendarPrimitive.DayProps = $props();
</script>

<RangeCalendarPrimitive.Day
	bind:ref
	class={cn(
		buttonVariants({ variant: 'ghost' }),
		'size-(--cell-size) flex select-none flex-col items-center justify-center gap-1 whitespace-nowrap p-0 font-normal leading-none',
		'[&[data-today][data-disabled]]:text-muted-foreground data-[range-middle]:rounded-none',
		'data-[range-start]:bg-primary dark:data-[range-start]:hover:bg-accent data-[range-start]:text-primary-foreground',
		'data-[range-end]:bg-primary dark:data-[range-end]:hover:bg-accent data-[range-end]:text-primary-foreground',
		'[&[data-outside-month]:not([data-selected])]:text-muted-foreground [&[data-outside-month]:not([data-selected])]:hover:text-accent-foreground',
		'data-[disabled]:text-muted-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
		'data-[unavailable]:line-through',
		'dark:data-[range-middle]:hover:bg-accent/0',
		'dark:hover:text-accent-foreground',
		'focus:border-ring focus:ring-ring/50 focus:relative',
		'[&>span]:text-xs [&>span]:opacity-70',
		className
	)}
	{...restProps}
/>
