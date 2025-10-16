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
	import { Calendar } from '$lib/components/ui/calendar/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';

	interface Props {
		value?: string | undefined;
		placeholder?: string;
		class?: string;
		disabled?: boolean;
		id?: string;
	}

	let {
		value = $bindable(undefined),
		placeholder = 'Pick a date',
		class: className,
		disabled = false,
		id
	}: Props = $props();

	const df = new DateFormatter('en-US', {
		dateStyle: 'long'
	});

	let calendarValue = $state<DateValue>();
	let open = $state(false);

	// Sync string value to DateValue
	$effect(() => {
		if (!value) {
			calendarValue = undefined;
		} else {
			try {
				calendarValue = parseDate(value);
			} catch {
				calendarValue = undefined;
			}
		}
	});

	// Sync DateValue back to string
	$effect(() => {
		if (calendarValue) {
			const newValue = calendarValue.toString();
			if (newValue !== value) {
				value = newValue;
				open = false; // Close popover when date is selected
			}
		} else if (value) {
			value = undefined;
		}
	});

	let displayValue = $derived(
		calendarValue
			? df.format(calendarValue.toDate(getLocalTimeZone()))
			: placeholder
	);
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				variant="outline"
				class={cn(
					'w-full justify-start text-left font-normal',
					!value && 'text-muted-foreground',
					className
				)}
				{disabled}
				{id}
				{...props}
			>
				<CalendarIcon class="mr-2 size-4" />
				{displayValue}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-0">
		<Calendar type="single" bind:value={calendarValue as never} initialFocus />
	</Popover.Content>
</Popover.Root>
