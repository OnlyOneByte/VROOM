<script lang="ts">
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { page } from '$app/state';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { gotoDynamic } from '#lib/utils/navigation.ts';
	import { onMount, tick } from 'svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { z } from 'zod';
	import { ArrowLeft, Info, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import PendingPhotoPreview from '#lib/components/expenses/form/PendingPhotoPreview.svelte';
	import { isOdometerOrderError, odometerApi } from '#lib/services/odometer-api.ts';
	import { dateOnlyToISO, toDateInputValue } from '#lib/utils/formatters.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let vehicleId = $derived(data.vehicleId);
	let returnTo = $derived(page.url.searchParams.get('returnTo') || `/vehicles/${vehicleId}`);

	let odometer = $state<string | number | null>('');
	let date = $state(toDateInputValue(new Date()));
	let note = $state('');
	let pendingFiles = $state<File[]>([]);

	let isSubmitting = $state(false);

	onMount(() => trackPendingSave(() => isSubmitting));
	let latest = $state<{ odometer: number; date: string } | null>(null);
	let fieldErrors = $state<{ odometer?: string; date?: string; note?: string }>({});
	let submitError = $state<string | null>(null);
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
			const response = await odometerApi.getEntries(vehicleId, { limit: 1, offset: 0 });
			const first = response.data[0];
			if (first) {
				latest = { odometer: first.odometer, date: toDateInputValue(first.recordedAt) };
			}
		} catch {
			// The soft warning is optional; ignore failures.
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
			const entry = await odometerApi.create(vehicleId, {
				odometer: Number(odometer),
				recordedAt: dateOnlyToISO(date),
				note: note || undefined
			});

			if (pendingFiles.length > 0) {
				let failCount = 0;
				for (const file of pendingFiles) {
					try {
						await odometerApi.uploadPhoto(entry.id, file);
					} catch {
						failCount++;
					}
				}
				if (failCount > 0 && import.meta.env.DEV) {
					console.error(`${failCount} photo(s) failed to upload`);
				}
				pendingFiles = [];
			}

			await gotoDynamic(returnTo);
		} catch (e) {
			if (isOdometerOrderError(e)) fieldErrors = { odometer: userFacingErrorMessage(e) };
			else submitError = `Couldn't save the reading. ${userFacingErrorMessage(e)}`;
			await focusFirstProblem();
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Add Odometer Reading - VROOM Car Tracker</title>
	<meta name="description" content="Add a new odometer reading" />
</svelte:head>

<FormLayout>
	<div class="mb-6">
		<PageHeader title="Add Odometer Reading">
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

		<PendingPhotoPreview
			files={pendingFiles}
			onAdd={file => (pendingFiles = [...pendingFiles, file])}
			onRemove={i => (pendingFiles = pendingFiles.filter((_, idx) => idx !== i))}
		/>

		{#if submitError}
			<FormFieldError id="submit-error" tabindex={-1} class="rounded-md bg-destructive/10 p-3">
				{submitError}
			</FormFieldError>
		{/if}

		<div class="flex gap-3">
			<Button
				type="button"
				variant="outline"
				size="lg"
				onclick={() => gotoDynamic(returnTo)}
				class="flex-1"
			>
				Cancel
			</Button>
			<Button type="submit" size="lg" disabled={isSubmitting} class="flex-1">
				{#if isSubmitting}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
				{/if}
				Save Reading
			</Button>
		</div>
	</form>
</FormLayout>
