<script module lang="ts">
	export type ReminderRowGroup = 'due' | 'upcoming' | 'paused';
</script>

<script lang="ts">
	import { Bell, BellRing, Ellipsis, Gauge, Pause, Pencil, Receipt, Trash2 } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import type { ReminderWithVehicles } from '#lib/types/index.ts';
	import { formatCurrency, formatDate, formatNumber } from '#lib/utils/formatters.ts';
	import { frequencyLabel, isMileageTracking } from '#lib/utils/reminder-helpers.ts';

	interface Props {
		item: ReminderWithVehicles;
		group: ReminderRowGroup;
		vehicleNames: Map<string, string>;
		servicing: boolean;
		now?: number;
		onEdit: (_item: ReminderWithVehicles) => void;
		onDelete: (_item: ReminderWithVehicles) => void;
		onToggleActive: (_item: ReminderWithVehicles) => void;
		onMarkServiced: (_item: ReminderWithVehicles) => void;
		onViewExpenses: (_item: ReminderWithVehicles) => void;
	}

	let {
		item,
		group,
		vehicleNames,
		servicing,
		now = Date.now(),
		onEdit,
		onDelete,
		onToggleActive,
		onMarkServiced,
		onViewExpenses
	}: Props = $props();

	const DAY_MS = 86_400_000;
	const SOON_DAYS = 30;

	let menuOpen = $state(false);

	let reminder = $derived(item.reminder);
	let vehicleIds = $derived(item.vehicleIds ?? []);
	let mileage = $derived(isMileageTracking(reminder));
	let daysLeft = $derived(
		reminder.nextDueDate === null
			? null
			: Math.ceil((new Date(reminder.nextDueDate).getTime() - now) / DAY_MS)
	);

	let status = $derived.by((): { text: string; tone: 'warning' | 'muted' } => {
		if (group === 'paused') return { text: 'Paused', tone: 'muted' };
		if (group === 'due') return { text: 'Due now', tone: 'warning' };
		if (daysLeft !== null) {
			const tone = daysLeft <= SOON_DAYS ? 'warning' : 'muted';
			if (daysLeft <= 0) return { text: 'Today', tone };
			if (daysLeft === 1) return { text: 'Tomorrow', tone };
			return { text: `In ${formatNumber(daysLeft, 0)} days`, tone };
		}
		if (reminder.nextDueOdometer !== null) {
			return { text: `At ${formatNumber(reminder.nextDueOdometer, 0)}`, tone: 'muted' };
		}
		return { text: 'Scheduled', tone: 'muted' };
	});

	let meta = $derived.by(() => {
		const parts: string[] = [];
		if (vehicleIds.length > 0) {
			parts.push(vehicleIds.map(id => vehicleNames.get(id) ?? 'Vehicle').join(', '));
		}
		if (reminder.nextDueDate !== null) parts.push(formatDate(reminder.nextDueDate));
		else if (reminder.nextDueOdometer !== null && group === 'paused') {
			parts.push(`at ${formatNumber(reminder.nextDueOdometer, 0)} on the odometer`);
		}
		if (reminder.expenseAmount != null) parts.push(`~${formatCurrency(reminder.expenseAmount)}`);
		const every = frequencyLabel(reminder);
		if (every) parts.push(every.toLowerCase());
		return parts.join(' · ');
	});

	let canResume = $derived(group === 'paused' && vehicleIds.length > 0);

	function choose(action: (_item: ReminderWithVehicles) => void) {
		menuOpen = false;
		action(item);
	}
</script>

<li class="flex items-center gap-3 py-3" data-testid="reminder-card-{reminder.id}">
	<span
		class="flex size-6 shrink-0 items-center justify-center {group === 'due'
			? 'text-warning'
			: 'text-muted-foreground'}"
		aria-hidden="true"
	>
		{#if reminder.type === 'expense'}
			<Receipt class="size-5" />
		{:else if mileage}
			<Gauge class="size-5" />
		{:else if group === 'due'}
			<BellRing class="size-5" />
		{:else}
			<Bell class="size-5" />
		{/if}
	</span>

	<div class="min-w-0 flex-1">
		<p class="truncate font-semibold">{reminder.name}</p>
		{#if meta}
			<p class="text-sm text-muted-foreground">{meta}</p>
		{/if}
		{#if vehicleIds.length === 0 && group === 'paused'}
			<p class="text-sm text-muted-foreground">No vehicle. Edit to choose one, then resume.</p>
		{/if}
		{#if reminder.description}
			<p class="truncate text-sm text-muted-foreground">{reminder.description}</p>
		{/if}
	</div>

	<div class="flex shrink-0 flex-col items-end">
		<p
			class="text-sm font-semibold {status.tone === 'warning'
				? 'text-warning'
				: 'text-muted-foreground'}"
		>
			{status.text}
		</p>
		{#if group !== 'paused' && mileage}
			<Button
				variant="link"
				class="h-10 px-0"
				disabled={servicing}
				onclick={() => onMarkServiced(item)}
			>
				{servicing ? 'Marking…' : 'Mark serviced'}
			</Button>
		{:else if canResume}
			<Button variant="link" class="h-10 px-0" onclick={() => onToggleActive(item)}>Resume</Button>
		{/if}
	</div>

	<Popover.Root bind:open={menuOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					class="shrink-0"
					aria-label="More actions for {reminder.name}"
				>
					<Ellipsis class="size-4" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="end" class="flex w-52 flex-col gap-1 p-1">
			<Button variant="ghost" class="h-10 w-full justify-start" onclick={() => choose(onEdit)}>
				<Pencil />
				Edit
			</Button>
			{#if reminder.type === 'expense'}
				<Button
					variant="ghost"
					class="h-10 w-full justify-start"
					onclick={() => choose(onViewExpenses)}
				>
					<Receipt />
					View expenses
				</Button>
			{/if}
			{#if reminder.isActive}
				<Button
					variant="ghost"
					class="h-10 w-full justify-start"
					onclick={() => choose(onToggleActive)}
				>
					<Pause />
					Pause
				</Button>
			{/if}
			<Button
				variant="ghost"
				class="h-10 w-full justify-start text-destructive hover:text-destructive"
				onclick={() => choose(onDelete)}
			>
				<Trash2 />
				Delete
			</Button>
		</Popover.Content>
	</Popover.Root>
</li>
