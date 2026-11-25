<script lang="ts">
	import { focusFirstProblem } from '#lib/utils/focus.ts';
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { page } from '$app/state';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { gotoDynamic } from '#lib/utils/navigation.ts';
	import { onMount, untrack } from 'svelte';
	import { onlineStatus } from '#lib/stores/offline.svelte.ts';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import {
		validateOdometerForm,
		type OdometerFormErrors
	} from '#lib/utils/odometer-form-validation.ts';
	import { ArrowLeft, Info, LoaderCircle, Trash2, WifiOff } from '@lucide/svelte';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { isOdometerOrderError, odometerApi } from '#lib/services/odometer-api.ts';
	import { dateOnlyToISO, formatNumber, toDateInputValue } from '#lib/utils/formatters.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import ExpensePhotoSection from '#lib/components/expenses/form/ExpensePhotoSection.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let vehicleId = $derived(data.vehicleId);
	let entryId = $derived(data.entryId);
	let returnTo = $derived(page.url.searchParams.get('returnTo') || `/vehicles/${vehicleId}`);

	let odometer = $state<string | number | null>('');
	let date = $state('');
	let note = $state('');
	let driverId = $state<string | null | undefined>(undefined);
	let entryDriverId = $state<string | null | undefined>(undefined);

	let isLoadingEntry = $state(true);
	let isSubmitting = $state(false);

	onMount(() => trackPendingSave(() => isSubmitting));
	let isDeleting = $state(false);
	let loadError = $state<string | null>(null);
	let offlineLoad = $state(false);
	let fieldErrors = $state<OdometerFormErrors>({});
	let submitError = $state<string | null>(null);
	let deleteDialogOpen = $state(false);
	let deleteError = $state<string | null>(null);
	let latest = $state<{ odometer: number; date: string } | null>(null);
	let formElement = $state<HTMLFormElement | null>(null);

	let showLatest = $derived.by(() => {
		if (latest === null || fieldErrors.odometer) return false;
		const val = enteredOdometer();
		if (val === undefined || Number.isNaN(val)) return false;
		return val <= latest.odometer && date >= latest.date;
	});

	function clearFieldError(field: 'odometer' | 'date' | 'note') {
		if (fieldErrors[field]) fieldErrors = { ...fieldErrors, [field]: undefined };
	}

	function enteredOdometer(): number | undefined {
		return odometer === '' || odometer === null ? undefined : Number(odometer);
	}

	onMount(loadEntry);

	$effect(() => {
		if (offlineLoad && onlineStatus.current) untrack(loadEntry);
	});

	async function loadEntry() {
		isLoadingEntry = true;
		loadError = null;
		offlineLoad = false;
		try {
			const [entry, latestResponse] = await Promise.all([
				odometerApi.getEntry(entryId),
				odometerApi.getEntries(vehicleId, { limit: 1, offset: 0 })
			]);

			if (!entry) {
				loadError = 'Odometer entry not found';
				return;
			}

			odometer = String(entry.odometer);
			date = toDateInputValue(entry.recordedAt);
			note = entry.note ?? '';
			entryDriverId = driverId = entry.driverId ?? null;

			const newest = latestResponse.data[0];
			if (newest && newest.id !== entryId) {
				latest = { odometer: newest.odometer, date: toDateInputValue(newest.recordedAt) };
			}
		} catch (e) {
			if (onlineStatus.current)
				loadError = `Couldn't load the reading. ${userFacingErrorMessage(e)}`;
			else offlineLoad = true;
		} finally {
			isLoadingEntry = false;
		}
	}

	function validate(): boolean {
		fieldErrors = validateOdometerForm({ odometer: enteredOdometer(), date, note });
		return Object.keys(fieldErrors).length === 0;
	}

	async function handleSubmit() {
		submitError = null;
		if (!validate()) {
			await focusFirstProblem(formElement);
			return;
		}

		isSubmitting = true;
		try {
			await odometerApi.update(entryId, {
				odometer: Number(odometer),
				recordedAt: dateOnlyToISO(date),
				note: note || undefined,
				...(driverId !== entryDriverId && { driverId })
			});
			await gotoDynamic(returnTo);
		} catch (e) {
			if (isOdometerOrderError(e)) fieldErrors = { odometer: userFacingErrorMessage(e) };
			else submitError = `Couldn't update the reading. ${userFacingErrorMessage(e)}`;
			await focusFirstProblem(formElement);
		} finally {
			isSubmitting = false;
		}
	}

	async function handleDelete() {
		isDeleting = true;
		deleteError = null;
		try {
			await odometerApi.delete(entryId);
			deleteDialogOpen = false;
			await gotoDynamic(returnTo);
		} catch (e) {
			deleteError = `Couldn't delete the reading. ${userFacingErrorMessage(e)}`;
		} finally {
			isDeleting = false;
		}
	}
</script>

<svelte:head>
	<title>Edit Odometer Reading - VROOM Car Tracker</title>
	<meta name="description" content="Edit an odometer reading" />
</svelte:head>

<FormLayout>
	<div class="mb-6">
		<PageHeader variant="display" title="Edit odometer reading">
			{#snippet back()}
				<Button
					variant="outline"
					size="icon-lg"
					class="shrink-0 rounded-full"
					aria-label="Back"
					onclick={() => gotoDynamic(returnTo)}
				>
					<ArrowLeft class="size-5" />
				</Button>
			{/snippet}
		</PageHeader>
	</div>

	{#if isLoadingEntry}
		<div class="flex justify-center p-8">
			<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
		</div>
	{:else if offlineLoad}
		<Alert variant="warning" role="status" data-testid="odometer-edit-offline-notice">
			<WifiOff class="h-4 w-4" />
			<AlertTitle>You're offline</AlertTitle>
			<AlertDescription>
				Editing a reading needs a connection. This form loads when you reconnect.
			</AlertDescription>
		</Alert>
	{:else if loadError}
		<div class="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
			{loadError}
		</div>
	{:else}
		<form
			bind:this={formElement}
			class="space-y-6"
			onsubmit={e => {
				e.preventDefault();
				handleSubmit();
			}}
		>
			<div class="space-y-2">
				<Label for="odometer">Odometer reading</Label>
				<Input
					id="odometer"
					type="number"
					inputmode="numeric"
					placeholder="e.g. 45000"
					bind:value={odometer}
					class={fieldErrors.odometer ? 'border-destructive' : ''}
					aria-invalid={!!fieldErrors.odometer}
					oninput={() => clearFieldError('odometer')}
					aria-describedby={fieldErrors.odometer ? 'odometer-error' : undefined}
				/>
				{#if fieldErrors.odometer}
					<FormFieldError id="odometer-error">{fieldErrors.odometer}</FormFieldError>
				{/if}
				<div role="status">
					{#if showLatest}
						<p class="flex items-center gap-2 text-sm text-muted-foreground">
							<Info class="h-4 w-4 shrink-0" aria-hidden="true" />
							Your latest reading is {latest ? formatNumber(latest.odometer, 0) : ''}.
						</p>
					{/if}
				</div>
			</div>

			<div class="space-y-2">
				<Label for="date">Date</Label>
				<DatePicker
					id="date"
					bind:value={
						() => date,
						v => {
							date = v ?? '';
							clearFieldError('date');
						}
					}
					placeholder="Pick a date"
					class={fieldErrors.date ? 'border-destructive' : ''}
					aria-invalid={!!fieldErrors.date}
					aria-describedby={fieldErrors.date ? 'date-error' : undefined}
				/>
				{#if fieldErrors.date}
					<FormFieldError id="date-error">{fieldErrors.date}</FormFieldError>
				{/if}
			</div>

			{#if entryDriverId !== undefined}
				{#await import('#lib/components/drivers/DriverChip.svelte') then { default: DriverChip }}
					<DriverChip
						id="odometer-driver"
						{vehicleId}
						bind:value={driverId}
						entry={{ vehicleId, driverId: entryDriverId ?? null }}
					/>
				{/await}
			{/if}

			<div class="space-y-2">
				<Label for="note">
					Note <span class="font-normal text-muted-foreground">(optional)</span>
				</Label>
				<Textarea
					id="note"
					placeholder="e.g. Oil change visit"
					bind:value={note}
					rows={3}
					class={fieldErrors.note ? 'border-destructive' : ''}
					aria-invalid={!!fieldErrors.note}
					oninput={() => clearFieldError('note')}
					aria-describedby={fieldErrors.note ? 'note-error' : undefined}
				/>
				{#if fieldErrors.note}
					<FormFieldError id="note-error">{fieldErrors.note}</FormFieldError>
				{/if}
				<p class="text-xs text-muted-foreground">{note.length}/500</p>
			</div>

			<ExpensePhotoSection entityType="odometer_entry" entityId={entryId} />

			{#if submitError}
				<FormFieldError id="submit-error" tabindex={-1} class="rounded-md bg-destructive/10 p-3">
					{submitError}
				</FormFieldError>
			{/if}

			<div class="flex flex-wrap gap-3 border-t border-border pt-6">
				<Button
					type="button"
					variant="outline"
					size="lg"
					onclick={() => (deleteDialogOpen = true)}
					class="rounded-full text-destructive"
				>
					<Trash2 class="size-4" />
					Delete
				</Button>
				<div class="ml-auto flex gap-3">
					<Button
						type="button"
						variant="outline"
						size="lg"
						onclick={() => gotoDynamic(returnTo)}
						class="rounded-full"
					>
						Cancel
					</Button>
					<Button type="submit" size="lg" disabled={isSubmitting} class="rounded-full">
						{#if isSubmitting}
							<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						{/if}
						<span>Save <span class="max-[359px]:sr-only">reading</span></span>
					</Button>
				</div>
			</div>
		</form>
	{/if}
</FormLayout>

<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete reading</Dialog.Title>
			<Dialog.Description>
				Are you sure you want to delete this odometer reading? This action cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		{#if deleteError}
			<p class="text-sm text-destructive">{deleteError}</p>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (deleteDialogOpen = false)}>Cancel</Button>
			<Button variant="destructive" disabled={isDeleting} onclick={handleDelete}>
				{#if isDeleting}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
				{/if}
				Delete
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
