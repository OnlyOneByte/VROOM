<script lang="ts">
	import { RangeCalendar as RangeCalendarPrimitive } from 'bits-ui';
	import { cn } from '#lib/utils.js';
	import { calendarDayBaseClass } from '#lib/components/ui/calendar/calendar-day-classes.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: RangeCalendarPrimitive.DayProps = $props();
</script>

<RangeCalendarPrimitive.Day
	bind:ref
	class={cn(
		calendarDayBaseClass,
		'[&[data-today][data-disabled]]:text-muted-foreground data-[range-middle]:rounded-none',
		'data-[range-start]:bg-primary dark:data-[range-start]:hover:bg-accent data-[range-start]:text-primary-foreground',
		'data-[range-end]:bg-primary dark:data-[range-end]:hover:bg-accent data-[range-end]:text-primary-foreground',
		'data-[unavailable]:line-through',
		'dark:data-[range-middle]:hover:bg-accent/0',
		className
	)}
	{...restProps}
/>
