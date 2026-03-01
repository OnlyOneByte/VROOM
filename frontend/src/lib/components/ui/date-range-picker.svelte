<script lang="ts">
	import CalendarIcon from 'lucide-svelte/icons/calendar';
	import {
		type DateValue,
		DateFormatter,
		getLocalTimeZone,
		parseDate
	} from '@internationalized/date';
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { RangeCalendar } from '$lib/components/ui/range-calendar/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';

	interface Props {
		startValue?: string | undefined;
		endValue?: string | undefined;
		placeholder?: string;
		class?: string;
		disabled?: boolean;
		id?: string;
	}

	let {
		startValue = $bindable(undefined),
		endValue = $bindable(undefined),
		placeholder = 'Pick a date range',
		class: className,
		disabled = false,
		id
	}: Props = $props();

	const df = new DateFormatter('en-US', {
		dateStyle: 'medium'
	});

	let rangeValue = $state<{ start: DateValue; end: DateValue } | undefined>(undefined);
	let open = $state(false);

	// Sync string values to range DateValue
	$effect(() => {
		if (startValue && endValue) {
			try {
				rangeValue = { start: parseDate(startValue), end: parseDate(endValue) };
			} catch {
				rangeValue = undefined;
			}
		} else {
			rangeValue = undefined;
		}
	});

	// Sync range DateValue back to strings
	$effect(() => {
		if (rangeValue?.start && rangeValue?.end) {
			const newStart = rangeValue.start.toString();
			const newEnd = rangeValue.end.toString();
			if (newStart !== startValue || newEnd !== endValue) {
				startValue = newStart;
				endValue = newEnd;
				open = false;
			}
		}
	});

	let displayValue = $derived.by(() => {
		if (rangeValue?.start && rangeValue?.end) {
			const start = df.format(rangeValue.start.toDate(getLocalTimeZone()));
			const end = df.format(rangeValue.end.toDate(getLocalTimeZone()));
			return `${start} – ${end}`;
		}
		return placeholder;
	});

	function clearRange() {
		rangeValue = undefined;
		startValue = undefined;
		endValue = undefined;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				variant="outline"
				class={cn(
					'w-full justify-start text-left font-normal',
					!rangeValue && 'text-muted-foreground',
					className
				)}
				{disabled}
				{id}
				{...props}
			>
				<CalendarIcon class="mr-2 size-4" />
				<span class="truncate">{displayValue}</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-0" align="start">
		<RangeCalendar bind:value={rangeValue} numberOfMonths={2} captionLayout="dropdown" disableDaysOutsideMonth />
		{#if rangeValue}
			<div class="border-t p-2 flex justify-end">
				<Button variant="ghost" size="sm" onclick={clearRange}>Clear</Button>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
