<script lang="ts">
	import { page } from '$app/state';
	import { gotoDynamic } from '$lib/utils/navigation';
	import { onMount } from 'svelte';
	import { z } from 'zod';
	import { ArrowLeft, LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import PendingPhotoPreview from '$lib/components/expenses/form/PendingPhotoPreview.svelte';
	import { odometerApi } from '$lib/services/odometer-api';
	import FormLayout from '$lib/components/common/form-layout.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let vehicleId = $derived(data.vehicleId);
	let returnTo = $derived(page.url.searchParams.get('returnTo') || `/vehicles/${vehicleId}`);

	// Form state
	let odometer = $state('');
	let date = $state(new Date().toISOString().split('T')[0] ?? '');
	let note = $state('');
	let pendingFiles = $state<File[]>([]);

	// UI state
	let isSubmitting = $state(false);
	let latestOdometer = $state<number | null>(null);
	let fieldErrors = $state<{ odometer?: string; date?: string; note?: string }>({});
	let submitError = $state<string | null>(null);

	// Soft warning for non-monotonic reading
	let showWarning = $derived.by(() => {
		if (latestOdometer === null) return false;
		const val = Number(odometer);
		if (Number.isNaN(val) || odometer === '') return false;
		return val < latestOdometer;
	});

	const formSchema = z.object({
		odometer: z
			.number()
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
				latestOdometer = first.odometer;
			}
		} catch {
			// Non-critical — just means we can't show the soft warning
		}
	});

	function validate(): boolean {
		fieldErrors = {};
		const odometerNum = odometer === '' ? undefined : Number(odometer);

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
		if (!validate()) return;

		isSubmitting = true;
		try {
			const entry = await odometerApi.create(vehicleId, {
				odometer: Number(odometer),
				recordedAt: new Date(date).toISOString(),
				note: note || undefined
			});

			// Upload pending photos after entry is created
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
			submitError = e instanceof Error ? e.message : 'Failed to save odometer reading';
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
	<!-- Header -->
	<div class="mb-6 flex items-center gap-3">
		<Button variant="ghost" size="icon" onclick={() => gotoDynamic(returnTo)}>
			<ArrowLeft class="h-5 w-5" />
		</Button>
		<h1 class="text-2xl font-bold text-foreground">Add Odometer Reading</h1>
	</div>

	<!-- Form -->
	<form
		class="space-y-6 rounded-lg border bg-card p-6"
		onsubmit={e => {
			e.preventDefault();
			handleSubmit();
		}}
	>
		<!-- Odometer field -->
		<div class="space-y-2">
			<Label for="odometer">Odometer Reading</Label>
			<Input
				id="odometer"
				type="number"
				placeholder="e.g. 45000"
				bind:value={odometer}
				class={fieldErrors.odometer ? 'border-destructive' : ''}
			/>
			{#if fieldErrors.odometer}
				<p class="text-sm text-destructive">{fieldErrors.odometer}</p>
			{/if}
			{#if showWarning}
				<div class="flex items-center gap-2 rounded-md bg-chart-5/10 p-3 text-sm text-chart-5">
					<TriangleAlert class="h-4 w-4 shrink-0" />
					<span>
						This reading ({Number(odometer).toLocaleString()}) is lower than the latest recorded
						value ({latestOdometer?.toLocaleString()}). Are you sure?
					</span>
				</div>
			{/if}
		</div>

		<!-- Date field -->
		<div class="space-y-2">
			<Label for="date">Date</Label>
			<Input
				id="date"
				type="date"
				bind:value={date}
				class={fieldErrors.date ? 'border-destructive' : ''}
			/>
			{#if fieldErrors.date}
				<p class="text-sm text-destructive">{fieldErrors.date}</p>
			{/if}
		</div>

		<!-- Note field -->
		<div class="space-y-2">
			<Label for="note">Note (optional)</Label>
			<Textarea
				id="note"
				placeholder="e.g. Oil change visit"
				bind:value={note}
				rows={3}
				class={fieldErrors.note ? 'border-destructive' : ''}
			/>
			{#if fieldErrors.note}
				<p class="text-sm text-destructive">{fieldErrors.note}</p>
			{/if}
			<p class="text-xs text-muted-foreground">{note.length}/500</p>
		</div>

		<!-- Photo upload -->
		<PendingPhotoPreview
			files={pendingFiles}
			onAdd={file => (pendingFiles = [...pendingFiles, file])}
			onRemove={i => (pendingFiles = pendingFiles.filter((_, idx) => idx !== i))}
		/>

		<!-- Submit error -->
		{#if submitError}
			<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
				{submitError}
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex gap-3">
			<Button type="button" variant="outline" onclick={() => gotoDynamic(returnTo)} class="flex-1">
				Cancel
			</Button>
			<Button type="submit" disabled={isSubmitting} class="flex-1">
				{#if isSubmitting}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
				{/if}
				Save Reading
			</Button>
		</div>
	</form>
</FormLayout>
