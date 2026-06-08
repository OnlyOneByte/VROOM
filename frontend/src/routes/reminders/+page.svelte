<script lang="ts">
	import { onMount } from 'svelte';
	import { Bell, BellRing, Calendar, RefreshCw, Trash2, Car, CircleAlert, Plus, Pencil, Check, History } from '@lucide/svelte';
	import { reminderApi } from '$lib/services/reminder-api';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import type { ReminderNotification, ReminderWithVehicles, Vehicle } from '$lib/types';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { appStore } from '$lib/stores/app.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as CardNs from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import PageHeader from '$lib/components/common/page-header.svelte';
	import ReminderForm from '$lib/components/reminders/ReminderForm.svelte';
	import ConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';

	let isLoading = $state(true);
	let isTriggering = $state(false);
	let loadError = $state<string | null>(null);
	let reminders = $state<ReminderWithVehicles[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let notifications = $state<ReminderNotification[]>([]);

	// reminderId -> name, so a notification (which carries only reminderId) can
	// show which reminder fired. Falls back gracefully if the reminder was deleted.
	let reminderNames = $derived(
		new Map(reminders.map((r) => [r.reminder.id, r.reminder.name]))
	);
	let unreadNotifications = $derived(notifications.filter((n) => !n.isRead));

	// Create/edit form (dialog) state.
	let formOpen = $state(false);
	let editingReminder = $state<ReminderWithVehicles | null>(null);

	function openCreate() {
		editingReminder = null;
		formOpen = true;
	}

	function openEdit(item: ReminderWithVehicles) {
		editingReminder = item;
		formOpen = true;
	}

	// Map vehicleId -> display name for quick lookup.
	let vehicleNames = $derived(
		new Map(vehicles.map((v) => [v.id, getVehicleDisplayName(v)]))
	);

	// A reminder is "due" when its nextDueDate is today or in the past.
	function isDue(r: ReminderWithVehicles): boolean {
		return new Date(r.reminder.nextDueDate).getTime() <= Date.now();
	}

	let dueReminders = $derived(reminders.filter((r) => r.reminder.isActive && isDue(r)));
	let upcomingReminders = $derived(
		reminders.filter((r) => r.reminder.isActive && !isDue(r))
	);
	let inactiveReminders = $derived(reminders.filter((r) => !r.reminder.isActive));

	async function load() {
		isLoading = true;
		loadError = null;
		try {
			const [reminderList, vehicleList, notificationList] = await Promise.all([
				reminderApi.list(),
				vehicleApi.getVehicles(),
				reminderApi.getNotifications()
			]);
			reminders = reminderList;
			vehicles = vehicleList;
			notifications = notificationList;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load reminders:', error);
			// Persist the failure so we don't fall through to the "No reminders yet"
			// empty state — that masquerades a fetch failure as "you have none", which
			// reads as data loss to a returning user. Mirrors dashboard/expenses.
			loadError = error instanceof Error ? error.message : 'Failed to load reminders';
			appStore.addNotification({ type: 'error', message: 'Failed to load reminders' });
		} finally {
			isLoading = false;
		}
	}

	async function runDueReminders() {
		isTriggering = true;
		try {
			const result = await reminderApi.trigger();
			const created = result.createdExpenses.length;
			const notified = result.notifications.length;
			appStore.addNotification({
				type: 'success',
				message: `Processed reminders: ${created} expense(s) created, ${notified} notification(s).`
			});
			await load();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to run reminders:', error);
			appStore.addNotification({ type: 'error', message: 'Failed to run due reminders' });
		} finally {
			isTriggering = false;
		}
	}

	async function markNotificationRead(id: string) {
		// Optimistic: flip locally, then persist. On failure, reload to resync.
		notifications = notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
		try {
			await reminderApi.markNotificationRead(id);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to mark notification read:', error);
			appStore.addNotification({ type: 'error', message: 'Failed to mark as read' });
			await load();
		}
	}

	async function markAllNotificationsRead() {
		const unread = notifications.filter((n) => !n.isRead);
		if (unread.length === 0) return;
		notifications = notifications.map((n) => ({ ...n, isRead: true }));
		try {
			await Promise.all(unread.map((n) => reminderApi.markNotificationRead(n.id)));
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to mark all read:', error);
			appStore.addNotification({ type: 'error', message: 'Failed to mark all as read' });
			await load();
		}
	}

	async function toggleActive(item: ReminderWithVehicles) {
		try {
			await reminderApi.update(item.reminder.id, { isActive: !item.reminder.isActive });
			await load();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to toggle reminder:', error);
			appStore.addNotification({ type: 'error', message: 'Failed to update reminder' });
		}
	}

	// Styled confirm dialog (replaces native confirm()); holds the reminder pending
	// deletion so the dialog can name it.
	let deleteConfirmOpen = $state(false);
	let deletingReminder = $state<ReminderWithVehicles | null>(null);

	function requestDeleteReminder(item: ReminderWithVehicles) {
		deletingReminder = item;
		deleteConfirmOpen = true;
	}

	async function performDeleteReminder() {
		if (!deletingReminder) return;
		try {
			await reminderApi.delete(deletingReminder.reminder.id);
			appStore.addNotification({ type: 'success', message: 'Reminder deleted' });
			await load();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to delete reminder:', error);
			appStore.addNotification({ type: 'error', message: 'Failed to delete reminder' });
			throw error; // keep the dialog open on failure
		}
	}

	function frequencyLabel(r: ReminderWithVehicles): string {
		const { frequency, intervalValue, intervalUnit } = r.reminder;
		if (frequency === 'custom' && intervalValue && intervalUnit) {
			return `Every ${intervalValue} ${intervalUnit}${intervalValue > 1 ? 's' : ''}`;
		}
		return frequency.charAt(0).toUpperCase() + frequency.slice(1);
	}

	onMount(load);
</script>

<svelte:head>
	<title>Reminders - VROOM Car Tracker</title>
	<meta name="description" content="Recurring expenses and maintenance reminders" />
</svelte:head>

<div class="space-y-6">
	<PageHeader title="Reminders" description="Recurring expenses and maintenance reminders">
		{#snippet actions()}
			<Button
				variant="outline"
				onclick={runDueReminders}
				disabled={isTriggering || dueReminders.length === 0}
			>
				<RefreshCw class="mr-2 h-4 w-4 {isTriggering ? 'animate-spin' : ''}" />
				Run due reminders
			</Button>
			<Button onclick={openCreate}>
				<Plus class="mr-2 h-4 w-4" />
				New Reminder
			</Button>
		{/snippet}
	</PageHeader>

	{#if isLoading}
		<div class="space-y-3">
			{#each Array(3) as _, i (i)}
				<Skeleton class="h-24 w-full" />
			{/each}
		</div>
	{:else if loadError}
		<div class="rounded-lg border bg-card p-6">
			<div class="mb-4 flex items-center gap-3 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Failed to load reminders</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
			<Button onclick={load}>Retry</Button>
		</div>
	{:else if reminders.length === 0}
		<EmptyState>
			{#snippet icon()}
				<Bell class="h-12 w-12 text-muted-foreground mb-4" />
			{/snippet}
			{#snippet title()}
				No reminders yet
			{/snippet}
			{#snippet description()}
				Create reminders for recurring expenses (insurance premiums, loan payments) or maintenance
				schedules, and VROOM will track when they're due.
			{/snippet}
			{#snippet action()}
				<Button onclick={openCreate}>
					<Plus class="mr-2 h-4 w-4" />
					New Reminder
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		{#snippet reminderCard(item: ReminderWithVehicles, due: boolean)}
			<CardNs.Card data-testid="reminder-card-{item.reminder.id}">
				<CardNs.CardContent class="flex items-start justify-between gap-4 py-4">
					<div class="flex items-start gap-3 min-w-0">
						<div class="mt-0.5 {due ? 'text-warning' : 'text-muted-foreground'}">
							{#if due}
								<BellRing class="h-5 w-5" />
							{:else}
								<Bell class="h-5 w-5" />
							{/if}
						</div>
						<div class="min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-semibold truncate">{item.reminder.name}</span>
								<Badge variant="secondary">{frequencyLabel(item)}</Badge>
								{#if item.reminder.type === 'expense'}
									<Badge variant="outline">Expense</Badge>
								{:else}
									<Badge variant="outline">Notification</Badge>
								{/if}
								{#if !item.reminder.isActive}
									<Badge variant="outline">Paused</Badge>
								{/if}
							</div>
							{#if item.reminder.description}
								<p class="text-sm text-muted-foreground mt-1 truncate">
									{item.reminder.description}
								</p>
							{/if}
							<div class="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
								<span class="inline-flex items-center gap-1">
									<Calendar class="h-3.5 w-3.5" />
									{due ? 'Due' : 'Next'}: {formatDate(item.reminder.nextDueDate)}
								</span>
								{#if item.reminder.expenseAmount != null}
									<span>{formatCurrency(item.reminder.expenseAmount)}</span>
								{/if}
								{#if item.vehicleIds && item.vehicleIds.length > 0}
									<span class="inline-flex items-center gap-1">
										<Car class="h-3.5 w-3.5" />
										{item.vehicleIds
											.map((id) => vehicleNames.get(id) ?? 'Vehicle')
											.join(', ')}
									</span>
								{/if}
							</div>
						</div>
					</div>
					<div class="flex items-center gap-1 flex-shrink-0">
						<Button variant="ghost" size="sm" onclick={() => toggleActive(item)}>
							{item.reminder.isActive ? 'Pause' : 'Resume'}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onclick={() => openEdit(item)}
							aria-label="Edit reminder"
						>
							<Pencil class="h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onclick={() => requestDeleteReminder(item)}
							aria-label="Delete reminder"
						>
							<Trash2 class="h-4 w-4 text-destructive" />
						</Button>
					</div>
				</CardNs.CardContent>
			</CardNs.Card>
		{/snippet}

		{#if dueReminders.length > 0}
			<section class="space-y-3">
				<h2 class="text-lg font-semibold flex items-center gap-2">
					<BellRing class="h-5 w-5 text-warning" />
					Due now ({dueReminders.length})
				</h2>
				{#each dueReminders as item (item.reminder.id)}
					{@render reminderCard(item, true)}
				{/each}
			</section>
		{/if}

		{#if upcomingReminders.length > 0}
			<section class="space-y-3">
				<h2 class="text-lg font-semibold">Upcoming ({upcomingReminders.length})</h2>
				{#each upcomingReminders as item (item.reminder.id)}
					{@render reminderCard(item, false)}
				{/each}
			</section>
		{/if}

		{#if inactiveReminders.length > 0}
			<section class="space-y-3">
				<h2 class="text-lg font-semibold text-muted-foreground">
					Paused ({inactiveReminders.length})
				</h2>
				{#each inactiveReminders as item (item.reminder.id)}
					{@render reminderCard(item, false)}
				{/each}
			</section>
		{/if}
	{/if}

	<!-- Notification history: rows the trigger wrote when notification-type reminders
	     fired. The backend GET/PUT existed but nothing surfaced them, so a fired
	     reminder was invisible beyond a transient toast. Shown whenever any exist,
	     independent of the reminders list above. -->
	{#if !isLoading && !loadError && notifications.length > 0}
		<section class="space-y-3">
			<div class="flex items-center justify-between gap-2">
				<h2 class="text-lg font-semibold flex items-center gap-2">
					<History class="h-5 w-5 text-muted-foreground" />
					Notifications
					{#if unreadNotifications.length > 0}
						<Badge variant="secondary">{unreadNotifications.length} new</Badge>
					{/if}
				</h2>
				{#if unreadNotifications.length > 0}
					<Button variant="ghost" size="sm" onclick={markAllNotificationsRead}>
						<Check class="mr-2 h-4 w-4" />
						Mark all read
					</Button>
				{/if}
			</div>
			<CardNs.Card>
				<CardNs.CardContent class="divide-y p-0">
					{#each notifications as n (n.id)}
						<div
							class="flex items-center justify-between gap-3 px-4 py-3 {n.isRead
								? ''
								: 'bg-muted/40'}"
							data-testid="notification-{n.id}"
						>
							<div class="flex items-start gap-3 min-w-0">
								<div class="mt-0.5 {n.isRead ? 'text-muted-foreground' : 'text-warning'}">
									{#if n.isRead}
										<Bell class="h-4 w-4" />
									{:else}
										<BellRing class="h-4 w-4" />
									{/if}
								</div>
								<div class="min-w-0">
									<p class="text-sm font-medium truncate {n.isRead ? 'text-muted-foreground' : ''}">
										{reminderNames.get(n.reminderId) ?? 'Reminder'}
									</p>
									<p class="text-xs text-muted-foreground">
										Due {formatDate(n.dueDate)}
									</p>
								</div>
							</div>
							{#if !n.isRead}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => markNotificationRead(n.id)}
									aria-label="Mark as read"
								>
									<Check class="h-4 w-4" />
								</Button>
							{/if}
						</div>
					{/each}
				</CardNs.CardContent>
			</CardNs.Card>
		</section>
	{/if}

	<ReminderForm bind:open={formOpen} reminder={editingReminder} {vehicles} onSaved={load} />

	<ConfirmDialog
		bind:open={deleteConfirmOpen}
		title="Delete reminder?"
		description={deletingReminder
			? `"${deletingReminder.reminder.name}" will be permanently deleted. This cannot be undone.`
			: ''}
		onConfirm={performDeleteReminder}
	/>
</div>
