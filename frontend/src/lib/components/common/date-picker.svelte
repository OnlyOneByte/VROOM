<script lang="ts">
	import { currentLocale } from '#lib/utils/formatters.ts';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { cn } from '#lib/utils.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';

	let calendarModule: Promise<typeof import('./date-picker-calendar.svelte')> | undefined;
	const loadCalendar = () => (calendarModule ??= import('./date-picker-calendar.svelte'));

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

	const df = new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'long' });
	const shortDf = new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium' });

	function localDate(text: string | undefined): Date | undefined {
		const match = text?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!match) return undefined;
		const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
		const date = new Date(`${match[0]}T00:00:00`);
		return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
			? date
			: undefined;
	}

	let open = $state(false);
	let selected = $derived(localDate(value));

	$effect(() => {
		if (value && !selected) value = undefined;
	});

	let displayValue = $derived(selected ? (label ?? df.format(selected)) : placeholder);
	let shortValue = $derived(selected && !label ? shortDf.format(selected) : null);

	let content = $state<HTMLElement | null>(null);

	function focusDay(event?: Event) {
		const day = [
			'[data-selected]',
			'[data-today]',
			':not([data-disabled]):not([data-outside-month])'
		]
			.map(state => content?.querySelector<HTMLElement>(`[data-bits-day]${state}`))
			.find(Boolean);
		if (!day) return;
		event?.preventDefault();
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
				onpointerenter={loadCalendar}
				onfocusin={loadCalendar}
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
			{#await loadCalendar() then { default: PickerCalendar }}
				<PickerCalendar bind:value onpick={() => (open = false)} onready={() => focusDay()} />
			{/await}
		</div>
	</Popover.Content>
</Popover.Root>
