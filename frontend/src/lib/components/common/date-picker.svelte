<script lang="ts">
	import { currentLocale } from '#lib/utils/formatters.ts';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import {
		type DateValue,
		DateFormatter,
		getLocalTimeZone,
		parseDate
	} from '@internationalized/date';
	import { cn } from '#lib/utils.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Calendar } from '#lib/components/ui/calendar/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';

	interface Props {
		value?: string | undefined;
		placeholder?: string;
		class?: string;
		disabled?: boolean;
		id?: string;
		'aria-invalid'?: boolean;
		'aria-describedby'?: string;
	}

	let {
		value = $bindable(undefined),
		placeholder = 'Pick a date',
		class: className,
		disabled = false,
		id,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby
	}: Props = $props();

	const df = new DateFormatter(currentLocale(), {
		dateStyle: 'long'
	});

	let calendarValue = $state<DateValue>();
	let open = $state(false);

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

	$effect(() => {
		if (calendarValue) {
			const newValue = calendarValue.toString();
			if (newValue !== value) {
				value = newValue;
				open = false;
			}
		} else if (value) {
			value = undefined;
		}
	});

	let displayValue = $derived(
		calendarValue ? df.format(calendarValue.toDate(getLocalTimeZone())) : placeholder
	);

	let content = $state<HTMLElement | null>(null);

	function focusDay(event: Event) {
		const day = ['[data-selected]', '[data-today]', ':not([data-disabled])']
			.map(state => content?.querySelector<HTMLElement>(`[data-bits-day]${state}`))
			.find(Boolean);
		if (!day) return;
		event.preventDefault();
		day.focus();
	}

	function keepSelectedOnEnter(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		if (
			!(event.target instanceof Element) ||
			!event.target.matches('[data-bits-day][data-selected]')
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		open = false;
	}

	let valueId = $derived(id ? `${id}-value` : undefined);
	let describedBy = $derived([valueId, ariaDescribedby].filter(Boolean).join(' ') || undefined);
</script>

<Popover.Root bind:open>
	<Popover.Trigger {disabled} {id}>
		{#snippet child({ props })}
			<Button
				variant="outline"
				class={cn(
					'h-10 w-full justify-start text-left font-normal sm:h-9',
					!value && 'text-muted-foreground',
					className
				)}
				aria-invalid={ariaInvalid}
				aria-describedby={describedBy}
				{...props}
			>
				<CalendarIcon class="mr-2 size-4" />
				<span id={valueId}>{displayValue}</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-0" onOpenAutoFocus={focusDay}>
		<div bind:this={content} onkeydowncapture={keepSelectedOnEnter}>
			<Calendar type="single" bind:value={calendarValue as never} />
		</div>
	</Popover.Content>
</Popover.Root>
