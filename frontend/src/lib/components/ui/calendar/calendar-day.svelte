<script lang="ts">
	import { cn } from '#lib/utils.js';
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import { calendarDayBaseClass } from './calendar-day-classes.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: CalendarPrimitive.DayProps = $props();
</script>

<CalendarPrimitive.Day
	bind:ref
	class={cn(
		calendarDayBaseClass,
		'[&[data-today]:not([data-selected])]:bg-accent [&[data-today]:not([data-selected])]:text-accent-foreground [&[data-today][data-disabled]]:text-muted-foreground',
		'data-[selected]:bg-primary dark:data-[selected]:hover:bg-accent/50 data-[selected]:text-primary-foreground',
		'data-[unavailable]:text-muted-foreground data-[unavailable]:line-through',
		className
	)}
	{...restProps}
/>
