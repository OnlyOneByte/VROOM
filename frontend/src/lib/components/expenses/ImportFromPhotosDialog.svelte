<script lang="ts">
	/**
	 * "Import from Photos" review surface — photos-auto-expense T4.
	 *
	 * Opened from the expenses page header (mirrors ImportExpensesDialog). On open it sweeps the user's
	 * VROOM Photos album via the shipped stage endpoint (photosImportApi.getReceiptDrafts → the backend
	 * walked the app-created album, parsed each through the user's VLM, filtered already-imported photos,
	 * PERSISTED NOTHING), then shows a review CHECKLIST: each row = the photo thumbnail + editable draft
	 * fields (amount / category / date / vehicle) + a "include" checkbox. A batch "Add N expenses" fires N
	 * idempotent confirmDraft calls (clientId = photos:<photoId>), so a re-import never doubles a row (D3).
	 *
	 * Four-states (R9): loading (sweeping) / error (retry — never blocked) / empty ("no new receipts in
	 * your VROOM Photos album") / data (the checklist). The live Photos + VLM legs stay eyes-on-pending.
	 *
	 * R7/D1 disclosure: a one-time AlertDialog before the FIRST sweep states plainly that VROOM reads ONLY
	 * the receipts IT uploaded to Photos, never the camera roll (the app-created-only platform limit).
	 * Dismissal is remembered in localStorage (the VLM ReceiptScanButton pattern).
	 */
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Images, LoaderCircle, CircleAlert, ImageOff } from '@lucide/svelte';
	import { photosImportApi, type ReceiptDraftItem } from '$lib/services/photos-import-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import { toDateInputValue } from '$lib/utils/formatters';
	import type { ExpenseCategory, Vehicle } from '$lib/types';

	interface Props {
		open: boolean;
		/** The user's vehicles — needed for the per-row target-vehicle picker. */
		vehicles: Vehicle[];
		/** Called after a successful batch so the parent can refetch the list. */
		onImported: () => void;
	}

	let { open = $bindable(), vehicles, onImported }: Props = $props();

	const DISCLOSURE_KEY = 'vroom.photos.import-disclosed';
	const CATEGORY_VALUES = Object.keys(categoryLabels) as ExpenseCategory[];

	/** A reviewable row: the staged draft + the user's edits + whether to include it in the batch. */
	interface ReviewRow {
		photoId: string;
		thumbnailUrl: string | null;
		include: boolean;
		amount: string; // string-bound input; parsed on confirm
		category: ExpenseCategory;
		date: string; // YYYY-MM-DD
		vehicleId: string;
	}

	let isLoading = $state(false);
	let loadError = $state<string | null>(null);
	let rows = $state<ReviewRow[]>([]);
	let isImporting = $state(false);
	let showDisclosure = $state(false);

	const defaultVehicleId = $derived(vehicles[0]?.id ?? '');
	const selectedCount = $derived(rows.filter(r => r.include && r.vehicleId && Number(r.amount) > 0).length);

	/** Map a staged draft to an editable row, pre-filling from the draft + sensible defaults. */
	function toRow(item: ReceiptDraftItem): ReviewRow {
		return {
			photoId: item.photoId,
			thumbnailUrl: item.thumbnailUrl,
			include: true,
			amount: typeof item.draft.amount === 'number' ? String(item.draft.amount) : '',
			category: item.draft.category ?? 'misc',
			date: item.draft.date ?? toDateInputValue(new Date()),
			vehicleId: defaultVehicleId
		};
	}

	/** Open-gate: when the dialog opens, gate the FIRST-ever sweep behind the R7/D1 disclosure. */
	$effect(() => {
		if (open && rows.length === 0 && !isLoading && !loadError) {
			const disclosed =
				typeof localStorage !== 'undefined' && localStorage.getItem(DISCLOSURE_KEY) === '1';
			if (disclosed) {
				void sweep();
			} else {
				showDisclosure = true;
			}
		}
	});

	function acknowledgeDisclosure() {
		try {
			localStorage.setItem(DISCLOSURE_KEY, '1');
		} catch {
			// localStorage may be unavailable (private mode) — proceed; we just re-ask next time.
		}
		showDisclosure = false;
		void sweep();
	}

	async function sweep() {
		isLoading = true;
		loadError = null;
		try {
			const drafts = await photosImportApi.getReceiptDrafts();
			rows = drafts.map(toRow);
		} catch (e) {
			loadError =
				e instanceof Error
					? e.message
					: 'Could not read your Google Photos receipts. Check the connection and try again.';
		} finally {
			isLoading = false;
		}
	}

	async function handleImport() {
		const toImport = rows.filter(r => r.include && r.vehicleId && Number(r.amount) > 0);
		if (toImport.length === 0 || isImporting) return;
		isImporting = true;
		let created = 0;
		try {
			for (const row of toImport) {
				await photosImportApi.confirmDraft(row.photoId, {
					vehicleId: row.vehicleId,
					category: row.category,
					amount: Number(row.amount),
					date: row.date
				});
				created++;
			}
			appStore.showSuccess(`Added ${created} expense${created === 1 ? '' : 's'} from Photos`);
			open = false;
			rows = [];
			onImported();
		} catch (e) {
			// Idempotent creates: the ones that already succeeded are committed; surface the failure +
			// keep the dialog open so the user can retry (a re-run skips the already-created via clientId).
			appStore.showError(e instanceof Error ? e.message : 'Failed to add some expenses');
		} finally {
			isImporting = false;
		}
	}

	function retry() {
		rows = [];
		loadError = null;
		void sweep();
	}

	function vehicleLabel(id: string): string {
		const v = vehicles.find(x => x.id === id);
		return v ? getVehicleDisplayName(v) : 'Select a vehicle';
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
		<Dialog.Header>
			<div class="flex items-center gap-2">
				<Images class="h-5 w-5 text-muted-foreground" />
				<Dialog.Title>Import receipts from Photos</Dialog.Title>
			</div>
			<Dialog.Description>
				Reads only the receipts VROOM uploaded to your Photos album — not your camera roll. Review
				each draft, pick a vehicle, and add the ones you want.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex-1 overflow-y-auto py-2">
			{#if isLoading}
				<div class="space-y-3" data-testid="photos-import-loading">
					{#each Array(3) as _, i (i)}
						<Skeleton class="h-24 w-full" />
					{/each}
				</div>
			{:else if loadError}
				<div class="rounded-lg border bg-card p-6" data-testid="photos-import-error">
					<div class="mb-3 flex items-center gap-3 text-destructive">
						<CircleAlert class="h-5 w-5" />
						<p class="font-medium">Could not load Photos receipts</p>
					</div>
					<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
					<Button onclick={retry}>Try again</Button>
				</div>
			{:else if rows.length === 0}
				<div class="flex flex-col items-center justify-center py-12 text-center" data-testid="photos-import-empty">
					<Images class="h-12 w-12 text-muted-foreground mb-3" />
					<p class="text-sm font-medium">No new receipts in your VROOM Photos album</p>
					<p class="text-xs text-muted-foreground mt-1 max-w-sm">
						Receipts you have already imported are skipped. Upload a receipt to your VROOM Photos
						album, then sweep again.
					</p>
				</div>
			{:else}
				<div class="space-y-3" data-testid="photos-import-list">
					{#each rows as row (row.photoId)}
						<div
							class="flex gap-3 rounded-lg border p-3 {row.include ? '' : 'opacity-50'}"
							data-testid="photos-import-row"
						>
							<!-- include checkbox -->
							<div class="flex items-start pt-1">
								<Checkbox bind:checked={row.include} aria-label="Include this receipt" />
							</div>

							<!-- thumbnail -->
							<div class="h-20 w-20 shrink-0 overflow-hidden rounded-md border bg-muted">
								{#if row.thumbnailUrl}
									<img
										src={row.thumbnailUrl}
										alt="Receipt"
										loading="lazy"
										class="h-full w-full object-cover"
									/>
								{:else}
									<div class="flex h-full w-full items-center justify-center">
										<ImageOff class="h-6 w-6 text-muted-foreground" />
									</div>
								{/if}
							</div>

							<!-- editable draft fields -->
							<div class="grid flex-1 grid-cols-2 gap-2">
								<div class="space-y-1">
									<Label class="text-[11px] text-muted-foreground">Amount</Label>
									<Input
										type="number"
										step="0.01"
										min="0"
										bind:value={row.amount}
										placeholder="0.00"
										disabled={!row.include}
									/>
								</div>
								<div class="space-y-1">
									<Label class="text-[11px] text-muted-foreground">Date</Label>
									<Input type="date" bind:value={row.date} disabled={!row.include} />
								</div>
								<div class="space-y-1">
									<Label class="text-[11px] text-muted-foreground">Category</Label>
									<Select.Root
										type="single"
										value={row.category}
										onValueChange={v => {
											if (v) row.category = v as ExpenseCategory;
										}}
										disabled={!row.include}
									>
										<Select.Trigger class="w-full">{categoryLabels[row.category]}</Select.Trigger>
										<Select.Content>
											{#each CATEGORY_VALUES as c (c)}
												<Select.Item value={c} label={categoryLabels[c]}>{categoryLabels[c]}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
								<div class="space-y-1">
									<Label class="text-[11px] text-muted-foreground">Vehicle</Label>
									<Select.Root
										type="single"
										value={row.vehicleId}
										onValueChange={v => {
											if (v) row.vehicleId = v;
										}}
										disabled={!row.include}
									>
										<Select.Trigger class="w-full">{vehicleLabel(row.vehicleId)}</Select.Trigger>
										<Select.Content>
											{#each vehicles as v (v.id)}
												<Select.Item value={v.id} label={getVehicleDisplayName(v)}>
													{getVehicleDisplayName(v)}
												</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={isImporting}>Cancel</Button>
			{#if rows.length > 0 && !loadError}
				<Button
					onclick={handleImport}
					disabled={selectedCount === 0 || isImporting}
					data-testid="photos-import-confirm"
				>
					{#if isImporting}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Adding…
					{:else}
						Add {selectedCount} expense{selectedCount === 1 ? '' : 's'}
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={showDisclosure}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Import receipts from Photos</AlertDialog.Title>
			<AlertDialog.Description>
				VROOM reads only the receipt photos it uploaded to your Google Photos album — never your
				camera roll. Each receipt is sent to the AI provider you configured to read its amount and
				date; you review and confirm every draft before anything is saved. For maximum privacy, use a
				self-hosted (Ollama) provider.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => { showDisclosure = false; open = false; }}>
				Cancel
			</AlertDialog.Cancel>
			<AlertDialog.Action onclick={acknowledgeDisclosure}>Continue</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
