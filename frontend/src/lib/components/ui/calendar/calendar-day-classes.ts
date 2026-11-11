import { buttonVariants } from '$lib/components/ui/button/index.js';
import { cn } from '$lib/utils.js';

/** Day-cell classes shared by the single and range calendars; each adds only its selection styling. */
export const calendarDayBaseClass = cn(
	buttonVariants({ variant: 'ghost' }),
	'size-(--cell-size) flex select-none flex-col items-center justify-center gap-1 whitespace-nowrap p-0 font-normal leading-none',
	'[&[data-outside-month]:not([data-selected])]:text-muted-foreground [&[data-outside-month]:not([data-selected])]:hover:text-accent-foreground',
	'data-[disabled]:text-muted-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
	'dark:hover:text-accent-foreground',
	'focus:border-ring focus:ring-ring/50 focus:relative',
	'[&>span]:text-xs [&>span]:opacity-70'
);
