<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { LoaderCircle } from '@lucide/svelte';
	import { reminderApi } from '$lib/services/reminder-api';
	import { appStore } from '$lib/stores/app.svelte';
	import type { ReminderWithVehicles, Vehicle } from '$lib/types';
	import { ReminderFormState } from './reminder-form/reminder-form-state.svelte';
	import ReminderBasicsFields from './reminder-form/ReminderBasicsFields.svelte';
	import ReminderExpenseFields from './reminder-form/ReminderExpenseFields.svelte';
	import ReminderMileageFields from './reminder-form/ReminderMileageFields.svelte';
	import ReminderScheduleFields from './reminder-form/ReminderScheduleFields.svelte';
	import ReminderVehicleFields from './reminder-form/ReminderVehicleFields.svelte';

	interface Props {
		open: boolean;
		reminder?: ReminderWithVehicles | null;
		vehicles: Vehicle[];
		onSaved: () => void;
	}

	let { open = $bindable(), reminder = null, vehicles, onSaved }: Props = $props();

	const form = new ReminderFormState();
	let isEdit = $derived(!!reminder);

	// Keyed on open so reopening after a cancel starts clean.
	let lastKey = $state('');
	$effect(() => {
		const key = `${open}:${reminder?.reminder.id ?? 'new'}`;
		if (key === lastKey) return;
		lastKey = key;
		if (!open) return;
		form.load(reminder, vehicles);
	});

	async function handleSubmit() {
		if (!form.validate()) return;
		form.isSubmitting = true;
		try {
			const payload = form.toPayload();
			if (reminder) {
				await reminderApi.update(reminder.reminder.id, payload);
				appStore.addNotification({ type: 'success', message: 'Reminder updated' });
			} else {
				await reminderApi.create(payload);
				appStore.addNotification({ type: 'success', message: 'Reminder created' });
			}
			open = false;
			onSaved();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to save reminder:', error);
			appStore.addNotification({
				type: 'error',
				message: `Failed to ${isEdit ? 'update' : 'create'} reminder`
			});
		} finally {
			form.isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{isEdit ? 'Edit Reminder' : 'New Reminder'}</Dialog.Title>
			<Dialog.Description>
				Get notified about recurring maintenance or events on your vehicles.
			</Dialog.Description>
		</Dialog.Header>

		<form
			onsubmit={e => {
				e.preventDefault();
				handleSubmit();
			}}
			class="space-y-4"
		>
			<ReminderBasicsFields {form} />

			{#if form.values.kind === 'expense'}
				<ReminderExpenseFields {form} />
			{/if}

			{#if form.hasMileageAxis}
				<ReminderMileageFields {form} {vehicles} />
			{/if}

			{#if form.hasTimeAxis}
				<ReminderScheduleFields {form} />
			{/if}

			<ReminderVehicleFields {form} {vehicles} />

			<div class="space-y-2">
				<Label for="reminder-description">Notes (optional)</Label>
				<Textarea
					id="reminder-description"
					bind:value={form.values.description}
					rows={2}
					placeholder="Any extra details…"
				/>
			</div>

			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					onclick={() => (open = false)}
					disabled={form.isSubmitting}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={form.isSubmitting || vehicles.length === 0}>
					{#if form.isSubmitting}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						{isEdit ? 'Saving…' : 'Creating…'}
					{:else}
						{isEdit ? 'Save Changes' : 'Create Reminder'}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
