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
		label?: string;
		class?: string;
		disabled?: boolean;
		id?: string;
		'aria-invalid'?: boolean;
		'aria-describedby'?: string;
	}

	let {
		value = $bindable(undefined),
		placeholder = 'Pick a date',
		label,
		class: className,
		disabled = false,
		id,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby
	}: Props = $props();

	const df = new DateFormatter(currentLocale(), {
		dateStyle: 'long'
	});
	const shortDf = new DateFormatter(currentLocale(), {
		dateStyle: 'medium'
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
		calendarValue ? (label ?? df.format(calendarValue.toDate(getLocalTimeZone()))) : placeholder
	);
	let shortValue = $derived(
		calendarValue && !label ? shortDf.format(calendarValue.toDate(getLocalTimeZone())) : null
	);

	let content = $state<HTMLElement | null>(null);

	function focusDay(event: Event) {
		const day = [
			'[data-selected]',
			'[data-today]',
			':not([data-disabled]):not([data-outside-month])'
		]
			.map(state => content?.querySelector<HTMLElement>(`[data-bits-day]${state}`))
			.find(Boolean);
		if (!day) return;
		event.preventDefault();
		day.focus({ preventScroll: true });
		requestAnimationFrame(() => day.scrollIntoView?.({ block: 'nearest' }));
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
					'h-11.5 w-full min-w-0 justify-start rounded-[var(--r-md)] border-[1.5px] bg-surface px-3 text-left font-normal has-[>svg]:px-3',
					shortValue && '@container',
					!value && 'text-muted-foreground',
					className
				)}
				aria-invalid={ariaInvalid}
				aria-describedby={describedBy}
				{...props}
			>
				<CalendarIcon class="size-4" />
				<span id={valueId} class={cn('min-w-0 truncate', shortValue && '@max-[10rem]:hidden')}>
					{displayValue}
				</span>
				{#if shortValue}
					<span class="hidden min-w-0 truncate @max-[10rem]:inline" aria-hidden="true">
						{shortValue}
					</span>
				{/if}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-0" onOpenAutoFocus={focusDay}>
		<div bind:this={content} onkeydowncapture={keepSelectedOnEnter}>
			<Calendar type="single" bind:value={calendarValue as never} />
		</div>
	</Popover.Content>
</Popover.Root>
