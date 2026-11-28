<script lang="ts">
	import { onMount } from 'svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import { LoaderCircle } from '@lucide/svelte';
	import { reminderApi } from '#lib/services/reminder-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import DemoSaveNote, { DEMO_SAVE_NOTE_ID } from '#lib/components/common/demo-save-note.svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import type { ReminderWithVehicles, Vehicle } from '#lib/types/index.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { ReminderFormState } from './reminder-form/reminder-form-state.svelte';
	import {
		SERVER_FIELD_ERRORS_TOAST,
		serverFieldErrors
	} from './reminder-form/reminder-form-validation';
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
	const demo = $derived(authStore.user?.demo === true);

	onMount(() => trackPendingSave(() => form.isSubmitting));

	let lastKey = $state('');
	$effect(() => {
		const key = `${open}:${reminder?.reminder.id ?? 'new'}`;
		if (key === lastKey) return;
		lastKey = key;
		if (!open) return;
		form.load(reminder, vehicles);
	});

	async function handleSubmit() {
		if (demo || !form.validate()) return;
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
			const fieldErrors = serverFieldErrors(error);
			const hasFieldErrors = Object.keys(fieldErrors).length > 0;
			if (hasFieldErrors) form.errors = fieldErrors;
			appStore.addNotification({
				type: 'error',
				message: hasFieldErrors
					? SERVER_FIELD_ERRORS_TOAST
					: `Couldn't ${isEdit ? 'update' : 'create'} the reminder. ${userFacingErrorMessage(error)}`
			});
		} finally {
			form.isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{isEdit ? 'Edit reminder' : 'New reminder'}</Dialog.Title>
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

			{#if demo}
				<DemoSaveNote class="text-right" />
			{/if}
			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					onclick={() => (open = false)}
					disabled={form.isSubmitting}
				>
					Cancel
				</Button>
				<Button
					type="submit"
					disabled={form.isSubmitting || vehicles.length === 0}
					aria-disabled={demo || undefined}
					aria-describedby={demo ? DEMO_SAVE_NOTE_ID : undefined}
				>
					{#if form.isSubmitting}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						{isEdit ? 'Saving…' : 'Creating…'}
					{:else}
						{isEdit ? 'Save changes' : 'Create reminder'}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
