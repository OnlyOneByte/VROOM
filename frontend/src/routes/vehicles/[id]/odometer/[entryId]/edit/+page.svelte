<script lang="ts">
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { page } from '$app/state';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { gotoDynamic } from '#lib/utils/navigation.ts';
	import { onMount, tick } from 'svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { z } from 'zod';
	import { ArrowLeft, Info, LoaderCircle, Trash2 } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { isOdometerOrderError, odometerApi } from '#lib/services/odometer-api.ts';
	import { dateOnlyToISO, toDateInputValue } from '#lib/utils/formatters.ts';
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

	let isLoadingEntry = $state(true);
	let isSubmitting = $state(false);

	onMount(() => trackPendingSave(() => isSubmitting));
	let isDeleting = $state(false);
	let loadError = $state<string | null>(null);
	let fieldErrors = $state<{ odometer?: string; date?: string; note?: string }>({});
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

	async function focusFirstProblem() {
		await tick();
		const target = formElement?.querySelector<HTMLElement>('[aria-invalid="true"], #submit-error');
		target?.scrollIntoView({ block: 'center' });
		target?.focus({ preventScroll: true });
	}

	function clearFieldError(field: 'odometer' | 'date' | 'note') {
		if (fieldErrors[field]) fieldErrors = { ...fieldErrors, [field]: undefined };
	}

	function enteredOdometer(): number | undefined {
		return odometer === '' || odometer === null ? undefined : Number(odometer);
	}

	const formSchema = z.object({
		odometer: z
			.number({ error: 'Odometer reading is required' })
			.int('Odometer must be a whole number')
			.min(0, 'Odometer must be 0 or greater'),
		date: z.string().min(1, 'Date is required'),
		note: z.string().max(500, 'Note must be 500 characters or less').optional()
	});

	onMount(async () => {
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

			const newest = latestResponse.data[0];
			if (newest && newest.id !== entryId) {
				latest = { odometer: newest.odometer, date: toDateInputValue(newest.recordedAt) };
			}
		} catch (e) {
			loadError = `Couldn't load the reading. ${userFacingErrorMessage(e)}`;
		} finally {
			isLoadingEntry = false;
		}
	});

	function validate(): boolean {
		fieldErrors = {};
		const odometerNum = enteredOdometer();

		const result = formSchema.safeParse({
			odometer: odometerNum,
			date,
			note: note || undefined
		});

		if (!result.success) {
			const errs: { odometer?: string; date?: string; note?: string } = {};
			for (const issue of result.error.issues) {
				const field = issue.path[0];
				if (field === 'odometer') errs.odometer = issue.message;
				else if (field === 'date') errs.date = issue.message;
				else if (field === 'note') errs.note = issue.message;
			}
			fieldErrors = errs;
			return false;
		}

		return true;
	}

	async function handleSubmit() {
		submitError = null;
		if (!validate()) {
			await focusFirstProblem();
			return;
		}

		isSubmitting = true;
		try {
			await odometerApi.update(entryId, {
				odometer: Number(odometer),
				recordedAt: dateOnlyToISO(date),
				note: note || undefined
			});
			await gotoDynamic(returnTo);
		} catch (e) {
			if (isOdometerOrderError(e)) fieldErrors = { odometer: userFacingErrorMessage(e) };
			else submitError = `Couldn't update the reading. ${userFacingErrorMessage(e)}`;
			await focusFirstProblem();
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
		<PageHeader title="Edit Odometer Reading">
			{#snippet back()}
				<Button
					variant="ghost"
					size="icon-lg"
					class="shrink-0"
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
	{:else if loadError}
		<div class="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
			{loadError}
		</div>
	{:else}
		<form
			bind:this={formElement}
			class="space-y-6 rounded-lg border bg-card p-6"
			onsubmit={e => {
				e.preventDefault();
				handleSubmit();
			}}
		>
			<div class="space-y-2">
				<Label for="odometer">Odometer Reading *</Label>
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
							Your latest reading is {latest?.odometer.toLocaleString()}.
						</p>
					{/if}
				</div>
			</div>

			<div class="space-y-2">
				<Label for="date">Date *</Label>
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

			<div class="space-y-2">
				<Label for="note">Note (Optional)</Label>
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

			<div class="flex gap-3">
				<Button
					type="button"
					variant="destructive"
					size="lg"
					onclick={() => (deleteDialogOpen = true)}
					class="flex-shrink-0"
				>
					<Trash2 class="h-4 w-4 sm:mr-2" />
					<span class="max-sm:sr-only">Delete</span>
				</Button>
				<div class="flex flex-1 gap-3">
					<Button
						type="button"
						variant="outline"
						size="lg"
						onclick={() => gotoDynamic(returnTo)}
						class="flex-1 max-sm:px-4"
					>
						Cancel
					</Button>
					<Button type="submit" size="lg" disabled={isSubmitting} class="flex-1 max-sm:px-4">
						{#if isSubmitting}
							<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						{/if}
						Save Reading
					</Button>
				</div>
			</div>
		</form>
	{/if}
</FormLayout>

<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete Reading</Dialog.Title>
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
