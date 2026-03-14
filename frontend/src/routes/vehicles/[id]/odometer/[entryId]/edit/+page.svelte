<script lang="ts">
	import { page } from '$app/state';
	import { gotoDynamic } from '$lib/utils/navigation';
	import { onMount } from 'svelte';
	import { z } from 'zod';
	import { ArrowLeft, LoaderCircle, Trash2, TriangleAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Dialog from '$lib/components/ui/dialog';
	import { odometerApi } from '$lib/services/odometer-api';
	import FormLayout from '$lib/components/common/form-layout.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let vehicleId = $derived(data.vehicleId);
	let entryId = $derived(data.entryId);
	let returnTo = $derived(page.url.searchParams.get('returnTo') || `/vehicles/${vehicleId}`);

	// Form state
	let odometer = $state('');
	let date = $state('');
	let note = $state('');

	// UI state
	let isLoadingEntry = $state(true);
	let isSubmitting = $state(false);
	let isDeleting = $state(false);
	let loadError = $state<string | null>(null);
	let fieldErrors = $state<{ odometer?: string; date?: string; note?: string }>({});
	let submitError = $state<string | null>(null);
	let deleteDialogOpen = $state(false);
	let deleteError = $state<string | null>(null);
	let latestOdometer = $state<number | null>(null);

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
			// Load the entry and latest reading in parallel
			const [entry, latestResponse] = await Promise.all([
				odometerApi.getEntry(entryId),
				odometerApi.getEntries(vehicleId, { limit: 1, offset: 0 })
			]);

			if (!entry) {
				loadError = 'Odometer entry not found';
				return;
			}

			odometer = String(entry.odometer);
			date = new Date(entry.recordedAt).toISOString().split('T')[0] ?? '';
			note = entry.note ?? '';

			const latest = latestResponse.data[0];
			if (latest && latest.id !== entryId) {
				latestOdometer = latest.odometer;
			}
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load entry';
		} finally {
			isLoadingEntry = false;
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
			await odometerApi.update(entryId, {
				odometer: Number(odometer),
				recordedAt: new Date(date).toISOString(),
				note: note || undefined
			});
			await gotoDynamic(returnTo);
		} catch (e) {
			submitError = e instanceof Error ? e.message : 'Failed to update odometer reading';
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
			deleteError = e instanceof Error ? e.message : 'Failed to delete reading';
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
	<!-- Header -->
	<div class="mb-6 flex items-center gap-3">
		<Button variant="ghost" size="icon" onclick={() => gotoDynamic(returnTo)}>
			<ArrowLeft class="h-5 w-5" />
		</Button>
		<h1 class="text-2xl font-bold text-foreground">Edit Odometer Reading</h1>
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

			<!-- Submit error -->
			{#if submitError}
				<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
					{submitError}
				</div>
			{/if}

			<!-- Actions -->
			<div class="flex gap-3">
				<Button
					type="button"
					variant="destructive"
					onclick={() => (deleteDialogOpen = true)}
					class="flex-shrink-0"
				>
					<Trash2 class="h-4 w-4 sm:mr-2" />
					<span class="hidden sm:inline">Delete</span>
				</Button>
				<div class="flex flex-1 gap-3">
					<Button
						type="button"
						variant="outline"
						onclick={() => gotoDynamic(returnTo)}
						class="flex-1"
					>
						Cancel
					</Button>
					<Button type="submit" disabled={isSubmitting} class="flex-1">
						{#if isSubmitting}
							<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						{/if}
						Save
					</Button>
				</div>
			</div>
		</form>
	{/if}
</FormLayout>

<!-- Delete Confirmation Dialog -->
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
