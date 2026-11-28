<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { onMount, tick } from 'svelte';
	import { Bell, BellRing, RefreshCw, Car, Plus, Check } from '@lucide/svelte';
	import { reminderApi } from '#lib/services/reminder-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import type { ReminderNotification, ReminderWithVehicles, Vehicle } from '#lib/types/index.ts';
	import { formatDate, formatNumber } from '#lib/utils/formatters.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { isReminderTimeDue } from '#lib/utils/reminder-helpers.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import ReminderRow, { type ReminderRowGroup } from '#lib/components/reminders/ReminderRow.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import NoVehiclesEmptyState, {
		NO_VEHICLES_TITLE
	} from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import ReminderForm from '#lib/components/reminders/ReminderForm.svelte';
	import MaterializedExpensesDialog from '#lib/components/reminders/MaterializedExpensesDialog.svelte';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';

	let isLoading = $state(true);
	let isTriggering = $state(false);
	let loadError = $state<string | null>(null);
	let reminders = $state<ReminderWithVehicles[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let notifications = $state<ReminderNotification[]>([]);

	let reminderNames = $derived(new Map(reminders.map(r => [r.reminder.id, r.reminder.name])));
	let unreadNotifications = $derived(notifications.filter(n => !n.isRead));

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

	let materializedOpen = $state(false);
	let materializedReminderId = $state<string | null>(null);
	let materializedReminderName = $state('');

	function openMaterialized(item: ReminderWithVehicles) {
		materializedReminderId = item.reminder.id;
		materializedReminderName = item.reminder.name;
		materializedOpen = true;
	}

	let vehicleNames = $derived(new Map(vehicles.map(v => [v.id, getVehicleDisplayName(v)])));
	let distanceUnits = $derived(
		new Map(vehicles.map(v => [v.id, v.unitPreferences?.distanceUnit ?? null]))
	);

	function distanceLabel(item: ReminderWithVehicles): string {
		const unit = distanceUnits.get(item.vehicleIds[0] ?? '');
		return getDistanceUnitLabel(unit ?? settingsStore.unitPreferences.distanceUnit, true);
	}

	const isDue = (r: ReminderWithVehicles) => isReminderTimeDue(r.reminder) || r.mileageDue === true;

	let dueReminders = $derived(reminders.filter(r => r.reminder.isActive && isDue(r)));
	let upcomingReminders = $derived(reminders.filter(r => r.reminder.isActive && !isDue(r)));
	let inactiveReminders = $derived(reminders.filter(r => !r.reminder.isActive));

	async function fetchAll() {
		const [reminderList, vehicleList, notificationList] = await Promise.all([
			reminderApi.list(),
			vehicleApi.getVehicles(),
			reminderApi.getNotifications()
		]);
		reminders = reminderList;
		vehicles = vehicleList;
		notifications = notificationList;
	}

	async function load() {
		isLoading = true;
		loadError = null;
		try {
			await fetchAll();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load reminders:', error);
			loadError = userFacingErrorMessage(error);
		} finally {
			isLoading = false;
		}
	}

	let newReminderButton = $state<HTMLElement | null>(null);

	async function afterSave() {
		const created = editingReminder === null;
		try {
			await fetchAll();
		} catch {
			await load();
			return;
		}
		if (!created) return;
		await tick();
		newReminderButton?.focus();
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
			appStore.showError(`Couldn't run the due reminders. ${userFacingErrorMessage(error)}`);
		} finally {
			isTriggering = false;
		}
	}

	async function markNotificationRead(id: string) {
		notifications = notifications.map(n => (n.id === id ? { ...n, isRead: true } : n));
		try {
			await reminderApi.markNotificationRead(id);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to mark notification read:', error);
			appStore.showError(
				`Couldn't mark the notification as read. ${userFacingErrorMessage(error)}`
			);
			await load();
		}
	}

	async function markAllNotificationsRead() {
		const unread = notifications.filter(n => !n.isRead);
		if (unread.length === 0) return;
		notifications = notifications.map(n => ({ ...n, isRead: true }));
		try {
			await Promise.all(unread.map(n => reminderApi.markNotificationRead(n.id)));
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to mark all read:', error);
			appStore.showError(
				`Couldn't mark the notifications as read. ${userFacingErrorMessage(error)}`
			);
			await load();
		}
	}

	async function toggleActive(item: ReminderWithVehicles) {
		try {
			await reminderApi.update(item.reminder.id, { isActive: !item.reminder.isActive });
			await load();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to toggle reminder:', error);
			appStore.showError(
				`Couldn't ${item.reminder.isActive ? 'pause' : 'resume'} the reminder. ${userFacingErrorMessage(error)}`
			);
		}
	}

	let servicingId = $state<string | null>(null);
	async function markServiced(item: ReminderWithVehicles) {
		servicingId = item.reminder.id;
		try {
			await reminderApi.markServiced(item.reminder.id);
			appStore.addNotification({ type: 'success', message: 'Marked serviced — reminder re-armed' });
			await load();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to mark serviced:', error);
			appStore.showError(
				`Couldn't mark the reminder as serviced. ${userFacingErrorMessage(error)}`
			);
		} finally {
			servicingId = null;
		}
	}

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
			appStore.showError(`Couldn't delete the reminder. ${userFacingErrorMessage(error)}`);
			throw error;
		}
	}

	let headerDescription = $derived(
		reminders.length === 0
			? 'Recurring expenses and maintenance reminders'
			: (
					[
						[dueReminders.length, 'due now'],
						[upcomingReminders.length, 'coming up'],
						[inactiveReminders.length, 'paused']
					] as const
				)
					.filter(([count]) => count > 0)
					.map(([count, label]) => `${formatNumber(count, 0)} ${label}`)
					.join(', ')
	);

	onMount(load);
</script>

<svelte:head>
	<title>Reminders - VROOM Car Tracker</title>
	<meta name="description" content="Recurring expenses and maintenance reminders" />
</svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<PageHeader variant="display" title="Reminders" description={headerDescription}>
		{#snippet actions()}
			{#if dueReminders.length > 0 && vehicles.length > 0}
				<Button variant="outline" size="lg" onclick={runDueReminders} disabled={isTriggering}>
					<RefreshCw class="mr-2 h-4 w-4 {isTriggering ? 'animate-spin' : ''}" />
					Run due reminders
				</Button>
			{/if}
			{#if !isLoading && !loadError && reminders.length > 0 && vehicles.length > 0}
				<Button size="lg" bind:ref={newReminderButton} onclick={openCreate}>
					<Plus class="mr-2 h-4 w-4" />
					New reminder
				</Button>
			{:else if isLoading}
				<Skeleton class="h-10 w-full sm:w-36" />
			{/if}
		{/snippet}
	</PageHeader>

	{#if isLoading}
		<div class="grid gap-6 lg:grid-cols-2" aria-hidden="true">
			{#each Array(2) as _, i (i)}
				<div class="space-y-3">
					<Skeleton class="h-5 w-24" />
					<Skeleton class="h-14 w-full" />
					<Skeleton class="h-14 w-full" />
				</div>
			{/each}
		</div>
	{:else if loadError}
		<LoadErrorCard title="Couldn't load reminders" message={loadError} onRetry={load} />
	{:else if reminders.length === 0 && vehicles.length === 0}
		<NoVehiclesEmptyState
			description="Every reminder belongs to a vehicle. Add one, then set reminders for its recurring costs and maintenance."
		/>
	{:else if reminders.length === 0}
		<EmptyState>
			{#snippet icon()}
				<Bell class="mb-4 h-12 w-12 text-muted-foreground" />
			{/snippet}
			{#snippet title()}
				No reminders yet
			{/snippet}
			{#snippet description()}
				Create reminders for recurring expenses (insurance premiums, loan payments) or maintenance
				schedules, and VROOM will track when they're due.
			{/snippet}
			{#snippet action()}
				<Button size="lg" onclick={openCreate}>
					<Plus class="mr-2 h-4 w-4" />
					New reminder
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		{#snippet reminderSection(
			title: string,
			items: ReminderWithVehicles[],
			group: ReminderRowGroup
		)}
			<Card.Root variant="section" data-testid="reminders-{group}">
				<Card.Header>
					<Card.Title level={2} class="text-base">{title}</Card.Title>
				</Card.Header>
				<Card.Content>
					<ul class="divide-y divide-border" role="list">
						{#each items as item (item.reminder.id)}
							<ReminderRow
								{item}
								{group}
								{vehicleNames}
								servicing={servicingId === item.reminder.id}
								distanceLabel={distanceLabel(item)}
								onEdit={openEdit}
								onDelete={requestDeleteReminder}
								onToggleActive={toggleActive}
								onMarkServiced={markServiced}
								onViewExpenses={openMaterialized}
							/>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/snippet}

		{#if vehicles.length === 0}
			<Alert role="status" data-testid="reminders-no-vehicles">
				<Car class="h-4 w-4" />
				<AlertTitle>{NO_VEHICLES_TITLE}</AlertTitle>
				<AlertDescription>
					<p>
						{reminders.length === 1
							? 'This reminder lost its vehicle and is paused. Add a vehicle, then edit the reminder to choose it.'
							: 'These reminders lost their vehicle and are paused. Add a vehicle, then edit each reminder to choose it.'}
					</p>
					<Button size="lg" class="mt-2" href={resolve(routes.vehicleNew)}>
						<Plus class="mr-2 h-4 w-4" />
						Add vehicle
					</Button>
				</AlertDescription>
			</Alert>
		{/if}

		<div class="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
			{#if dueReminders.length > 0}
				{@render reminderSection('Due now', dueReminders, 'due')}
			{/if}
			{#if upcomingReminders.length > 0}
				{@render reminderSection('Coming up', upcomingReminders, 'upcoming')}
			{/if}
			{#if inactiveReminders.length > 0}
				{@render reminderSection('Paused', inactiveReminders, 'paused')}
			{/if}
			<section class="border-t border-border pt-4" aria-labelledby="reminders-how">
				<h2 id="reminders-how" class="text-base font-semibold">How reminders work</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					A reminder can fire on a date, on distance driven, or both. An expense reminder adds the
					expense for you, like a monthly loan payment; a notification only tells you.
				</p>
			</section>
		</div>
	{/if}

	{#if !isLoading && !loadError && notifications.length > 0}
		<Card.Root variant="section">
			<Card.Header class="flex flex-row flex-wrap items-center justify-between gap-2">
				<Card.Title level={2} class="flex items-center gap-2 text-base">
					Notifications
					{#if unreadNotifications.length > 0}
						<Badge variant="due">{unreadNotifications.length} new</Badge>
					{/if}
				</Card.Title>
				{#if unreadNotifications.length > 0}
					<Button variant="ghost" size="sm" class="ml-auto h-10" onclick={markAllNotificationsRead}>
						<Check class="mr-2 h-4 w-4" />
						Mark all read
					</Button>
				{/if}
			</Card.Header>
			<Card.Content>
				<ul class="divide-y divide-border" role="list">
					{#each notifications as n (n.id)}
						<li
							class="flex items-center justify-between gap-3 py-3"
							data-testid="notification-{n.id}"
						>
							<div class="flex min-w-0 items-start gap-3">
								<span
									class="mt-0.5 {n.isRead ? 'text-muted-foreground' : 'text-warning'}"
									aria-hidden="true"
								>
									{#if n.isRead}
										<Bell class="h-4 w-4" />
									{:else}
										<BellRing class="h-4 w-4" />
									{/if}
								</span>
								<div class="min-w-0">
									<p
										class="truncate text-sm {n.isRead ? 'text-muted-foreground' : 'font-semibold'}"
									>
										{reminderNames.get(n.reminderId) ?? 'Reminder'}
										{#if !n.isRead}<span class="sr-only"> (unread)</span>{/if}
									</p>
									<p class="text-xs text-muted-foreground">
										{#if n.dueDate !== null}
											Due {formatDate(n.dueDate)}
										{:else if n.dueOdometer !== null}
											Due at {formatNumber(n.dueOdometer, 0)} (odometer)
										{/if}
									</p>
								</div>
							</div>
							{#if !n.isRead}
								<Button
									variant="ghost"
									size="icon-lg"
									onclick={() => markNotificationRead(n.id)}
									aria-label="Mark as read"
								>
									<Check class="h-4 w-4" />
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{/if}
	<ReminderForm bind:open={formOpen} reminder={editingReminder} {vehicles} onSaved={afterSave} />

	<MaterializedExpensesDialog
		bind:open={materializedOpen}
		reminderId={materializedReminderId}
		reminderName={materializedReminderName}
		{vehicleNames}
	/>

	<ConfirmDialog
		bind:open={deleteConfirmOpen}
		title="Delete reminder?"
		description={deletingReminder
			? `"${deletingReminder.reminder.name}" will be permanently deleted. This cannot be undone.`
			: ''}
		onConfirm={performDeleteReminder}
	/>
</div>
