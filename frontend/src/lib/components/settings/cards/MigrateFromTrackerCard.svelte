<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { focusFirstButton } from '#lib/utils/focus.ts';
	import { DatabaseZap, Upload, LoaderCircle, CircleCheck, CircleAlert } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import CategoryRemapPanel from '#lib/components/expenses/import-expenses/CategoryRemapPanel.svelte';
	import { ImportExpensesForm } from '#lib/components/expenses/import-expenses/import-expenses-form.svelte';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import type { Vehicle } from '#lib/types/index.ts';

	let vehicles = $state<Vehicle[]>([]);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let content = $state<HTMLElement | null>(null);
	let dialogOpen = $state(false);

	const form = new ImportExpensesForm(() => vehicles, {
		presetsOnly: true,
		copy: {
			previewFailed: format => `Couldn't read that ${format ? `${format.label} ` : ''}file`,
			detectFailed: "Couldn't read that file",
			done: (imported, format) =>
				`Migrated ${imported} ${imported === 1 ? 'entry' : 'entries'} from ${format?.label ?? 'your old app'}`,
			failed: format => `Couldn't migrate from ${format?.label ?? 'your old app'}`
		}
	});

	let extensions = $derived(form.formats?.accept.filter(type => type.startsWith('.')) ?? []);
	let chooseLabel = $derived(
		`Choose your export file${extensions.length ? ` (${extensions.join(', ')})` : ''}`
	);

	async function loadVehicles() {
		isLoading = true;
		loadError = null;
		try {
			vehicles = await vehicleApi.getVehicles();
		} catch (e) {
			loadError = `Couldn't load your vehicles. ${userFacingErrorMessage(e)}`;
		} finally {
			isLoading = false;
		}
	}

	onMount(loadVehicles);

	async function retryVehicles() {
		await loadVehicles();
		await tick();
		focusFirstButton(content);
	}

	async function handleFileChange(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		// Clear so re-picking the same file after a cancel still fires change.
		input.value = '';
		await form.loadFile(file);
	}

	async function handleCommit() {
		if (await form.commit(() => {})) dialogOpen = false;
	}

	function openDialog() {
		const lastVehicleId = form.targetVehicleId;
		form.reset();
		form.targetVehicleId = vehicles.length === 1 && vehicles[0] ? vehicles[0].id : lastVehicleId;
		void form.loadFormats();
		dialogOpen = true;
	}
</script>

<Card>
	<CardHeader>
		<div class="flex items-center gap-2">
			<DatabaseZap class="h-5 w-5 text-muted-foreground" />
			<CardTitle>Migrate data from another tracker</CardTitle>
		</div>
		<CardDescription>
			Moving from another app? Bring your whole history in one go. Export your data from the other
			tracker, then import it here into one of your vehicles. This is a one-time bulk migration —
			re-running it won't create duplicates.
		</CardDescription>
	</CardHeader>
	<CardContent bind:ref={content}>
		{#if isLoading}
			<div class="flex items-center justify-center py-6" data-testid="migrate-loading">
				<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		{:else if loadError}
			<div class="space-y-3" data-testid="migrate-error">
				<p class="text-sm text-destructive" role="alert">{loadError}</p>
				<Button variant="outline" size="sm" class="h-10 sm:h-8" onclick={retryVehicles}>
					Retry
				</Button>
			</div>
		{:else if vehicles.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="migrate-no-vehicle">
				Add a vehicle first — migrated entries need a vehicle to belong to.
			</p>
		{:else}
			<div data-testid="migrate-card">
				<Button
					variant="outline"
					class="h-10 sm:h-9"
					onclick={openDialog}
					data-testid="migrate-open"
				>
					<Upload class="mr-2 h-4 w-4" />
					Migrate from another tracker
				</Button>
			</div>
		{/if}
	</CardContent>
</Card>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Migrate from another tracker</Dialog.Title>
			<Dialog.Description>
				Pick the vehicle to import into, then upload the export file from your old app. You'll see a
				preview before anything is saved. Units are converted to your vehicle's units automatically,
				and amounts import in your configured currency.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<div class="space-y-1.5">
				<label for="migrate-vehicle" class="text-xs font-medium text-foreground">
					Import into vehicle *
				</label>
				<Select.Root
					type="single"
					value={form.targetVehicleId}
					onValueChange={id => form.changeTargetVehicle(id)}
				>
					<Select.Trigger id="migrate-vehicle" class="w-full" data-testid="migrate-vehicle">
						{form.targetVehicle ? getVehicleDisplayName(form.targetVehicle) : 'Select a vehicle'}
					</Select.Trigger>
					<Select.Content>
						{#each vehicles as v (v.id)}
							<Select.Item value={v.id} label={getVehicleDisplayName(v)}>
								{getVehicleDisplayName(v)}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-2">
				<label
					for="migrate-file"
					class="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
				>
					<Upload class="h-5 w-5" />
					<span>{form.fileName ?? chooseLabel}</span>
				</label>
				<input
					id="migrate-file"
					type="file"
					accept={form.formats?.accept.join(',')}
					class="sr-only"
					data-testid="migrate-file"
					onchange={handleFileChange}
				/>
			</div>

			{#if form.isDetecting || form.isPreviewing}
				<div class="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
					<LoaderCircle class="h-4 w-4 animate-spin" />
					Reading your file…
				</div>
			{:else if form.preview}
				{@const preview = form.preview}
				<div class="rounded-lg border bg-card p-4" data-testid="migrate-preview">
					<div class="flex items-center gap-4 text-sm">
						<span class="flex items-center gap-1.5 font-medium text-foreground">
							<CircleCheck class="h-4 w-4 text-chart-2" />
							{preview.readyCount} ready
						</span>
						{#if preview.errorCount > 0}
							<span class="flex items-center gap-1.5 font-medium text-foreground">
								<CircleAlert class="h-4 w-4 text-destructive" />
								{preview.errorCount}
								{preview.errorCount === 1 ? 'row needs' : 'rows need'} attention
							</span>
						{/if}
					</div>

					{#if form.errorRows.length > 0}
						<div class="mt-3 max-h-40 space-y-1.5 overflow-y-auto border-t pt-3">
							{#each form.errorRows as row (row.row)}
								<div class="flex gap-2 text-xs">
									<span class="shrink-0 font-medium text-muted-foreground">Row {row.row}</span>
									<span class="text-foreground">{row.message}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
				<CategoryRemapPanel
					unmappedCategories={form.unmappedCategories}
					categoryRemap={form.categoryRemap}
					onRemap={(word, category) => form.setCategoryRemap(word, category)}
				/>
			{:else if form.unrecognized}
				<p class="text-sm text-destructive" role="alert" data-testid="migrate-unrecognized">
					We don't recognize this file. Check that it's the export file from your old app and try
					again.
				</p>
			{:else if form.csvText.trim() && form.needsTargetVehicle}
				<p class="text-sm text-muted-foreground">Choose a vehicle above to preview.</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (dialogOpen = false)} disabled={form.isImporting}>
				Cancel
			</Button>
			<Button
				onclick={handleCommit}
				disabled={form.isImporting || !form.preview || form.preview.readyCount === 0}
				data-testid="migrate-commit"
			>
				{#if form.isImporting}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
					Migrating…
				{:else}
					Migrate {form.preview?.readyCount ?? 0}
					{(form.preview?.readyCount ?? 0) === 1 ? 'entry' : 'entries'}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
