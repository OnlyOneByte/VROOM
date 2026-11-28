<script lang="ts" module>
	type PickerCalendarComponent = (typeof import('./date-picker-calendar.svelte'))['default'];

	let calendarModule: Promise<PickerCalendarComponent> | undefined;
	let PickerCalendar = $state<PickerCalendarComponent>();

	function loadCalendar(): Promise<PickerCalendarComponent> {
		calendarModule ??= import('./date-picker-calendar.svelte').then(
			module => (PickerCalendar = module.default),
			error => {
				calendarModule = undefined;
				throw error;
			}
		);
		return calendarModule;
	}

	function prefetchCalendar() {
		loadCalendar().catch(() => {});
	}
</script>

<script lang="ts">
	import { formatDateWith } from '#lib/utils/formatters.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { cn } from '#lib/utils.js';
	import { Button } from '#lib/components/ui/button/index.js';
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

	$effect(() => {
		if (!open) return;
		loadCalendar().catch(error => {
			open = false;
			appStore.showError(`Couldn't open the calendar. ${userFacingErrorMessage(error)}`);
		});
	});

	let displayValue = $derived(
		selected ? (label ?? formatDateWith(selected, { dateStyle: 'long' })) : placeholder
	);
	let shortValue = $derived(
		selected && !label ? formatDateWith(selected, { dateStyle: 'medium' }) : null
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
	<Popover.Trigger {disabled} {id} onpointerenter={prefetchCalendar} onfocusin={prefetchCalendar}>
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
	{#if PickerCalendar}
		<Popover.Content class="w-auto p-0" onOpenAutoFocus={focusDay}>
			<div bind:this={content} onkeydowncapture={keepSelectedOnEnter}>
				<PickerCalendar bind:value onpick={() => (open = false)} />
			</div>
		</Popover.Content>
	{/if}
</Popover.Root>
