<script lang="ts">
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { driverApi } from '#lib/services/driver-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import type {
		BackfillBatch,
		BackfillRequest,
		BackfillSummary,
		Driver
	} from '#lib/types/index.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { dateOnlyToISO, formatDate } from '#lib/utils/formatters.ts';

	interface Props {
		open: boolean;
		vehicleId: string;
		drivers: Driver[];
	}

	let { open = $bindable(), vehicleId, drivers }: Props = $props();

	let mode = $state<'logged' | 'range'>('logged');
	let driverId = $state('');
	let from = $state<string | undefined>(undefined);
	let to = $state<string | undefined>(undefined);
	let preview = $state<BackfillSummary | null>(null);
	let batches = $state<BackfillBatch[]>([]);
	let busy = $state(false);
	let latest = 0;

	let request = $derived.by((): BackfillRequest | null => {
		if (mode === 'logged') return { mode };
		if (!driverId || !from || !to || from > to) return null;
		const endOfDay = Date.parse(dateOnlyToISO(to)) + 24 * 60 * 60 * 1000 - 1;
		return {
			mode,
			driverId,
			from: dateOnlyToISO(from),
			to: new Date(endOfDay).toISOString()
		};
	});
	let chosen = $derived(drivers.find(d => d.id === driverId));

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

	async function refresh() {
		batches = await driverApi.backfills(vehicleId).catch(() => []);
	}

	$effect(() => {
		const wanted = request;
		const mine = ++latest;
		preview = null;
		if (!wanted) return;
		driverApi
			.previewBackfill(vehicleId, wanted)
			.then(result => {
				if (mine === latest) preview = result;
			})
			.catch(() => {});
	});

	$effect(() => {
		void refresh();
	});

	async function apply() {
		if (!request) return;
		busy = true;
		try {
			const done = await driverApi.backfill(vehicleId, request);
			appStore.addNotification({
				type: 'success',
				message: `Filled in ${done.total} ${done.total === 1 ? 'entry' : 'entries'}.`
			});
			await refresh();
			const again = request;
			preview = again ? await driverApi.previewBackfill(vehicleId, again) : null;
		} catch (error) {
			appStore.showError(`Couldn't fill in the drivers. ${userFacingErrorMessage(error)}`);
		} finally {
			busy = false;
		}
	}

	async function undo(batch: BackfillBatch) {
		busy = true;
		try {
			const { reverted } = await driverApi.undoBackfill(vehicleId, batch.id);
			appStore.addNotification({
				type: 'success',
				message: `Undid ${reverted} of ${batch.total}.`
			});
			await refresh();
			if (request) preview = await driverApi.previewBackfill(vehicleId, request);
		} catch (error) {
			appStore.showError(`Couldn't undo it. ${userFacingErrorMessage(error)}`);
		} finally {
			busy = false;
		}
	}

	let summaryText = $derived.by(() => {
		if (!preview) return '';
		if (preview.total === 0)
			return 'Nothing to fill in: every matching entry already has a driver.';
		const parts = [
			plural(preview.trips, 'trip'),
			plural(preview.readings, 'reading'),
			plural(preview.expenses, 'expense')
		].join(', ');
		const who = preview.byDriver.map(d => `${d.name} ${d.count}`).join(', ');
		return `${parts}. ${who}.`;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Fill in drivers on past entries</Dialog.Title>
			<Dialog.Description>
				Only entries without a driver change. You'll see what changes before anything is saved, and
				you can undo it later.
			</Dialog.Description>
		</Dialog.Header>

		<RadioGroup.Root bind:value={mode} aria-label="How to fill them in" class="space-y-2">
			<Label for="backfill-logged" class="flex min-h-10 items-start gap-3 font-normal">
				<RadioGroup.Item value="logged" id="backfill-logged" class="mt-0.5" />
				<span>
					<span class="block font-medium">Use who logged it</span>
					<span class="text-sm text-muted-foreground">
						Each entry goes to the member who logged it; your own entries go to you.
					</span>
				</span>
			</Label>
			<Label for="backfill-range" class="flex min-h-10 items-start gap-3 font-normal">
				<RadioGroup.Item value="range" id="backfill-range" class="mt-0.5" />
				<span>
					<span class="block font-medium">Assign a date range</span>
					<span class="text-sm text-muted-foreground">
						Everything between two dates goes to one driver, like "I had the car all of March".
					</span>
				</span>
			</Label>
		</RadioGroup.Root>

		{#if mode === 'range'}
			<div class="grid gap-3 sm:grid-cols-3">
				<div class="space-y-1 sm:col-span-3">
					<Label for="backfill-driver">Driver</Label>
					<Select.Root type="single" bind:value={driverId}>
						<Select.Trigger id="backfill-driver" class="w-full">
							{chosen?.name ?? 'Choose a driver'}
						</Select.Trigger>
						<Select.Content>
							{#each drivers as driver (driver.id)}
								<Select.Item value={driver.id} label={driver.name}>{driver.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-1">
					<Label for="backfill-from">From</Label>
					<DatePicker id="backfill-from" bind:value={from} />
				</div>
				<div class="space-y-1">
					<Label for="backfill-to">To</Label>
					<DatePicker id="backfill-to" bind:value={to} aria-invalid={!!from && !!to && from > to} />
				</div>
			</div>
		{/if}

		<p class="min-h-10 text-sm" role="status">{summaryText}</p>

		{#if batches.length > 0}
			<div class="space-y-1 border-t pt-3">
				<p class="text-sm font-medium">Recent fill-ins</p>
				{#each batches as batch (batch.id)}
					<div class="flex min-h-10 items-center justify-between gap-3 text-sm">
						<span>
							{batch.mode === 'logged' ? 'Who logged it' : 'Date range'} · {batch.total} · {formatDate(
								batch.createdAt
							)}
						</span>
						<Button
							size="lg"
							variant="ghost"
							class="px-3"
							disabled={busy}
							onclick={() => undo(batch)}
						>
							Undo
						</Button>
					</div>
				{/each}
			</div>
		{/if}

		<Dialog.Footer>
			<Button type="button" variant="outline" size="lg" onclick={() => (open = false)}>
				Close
			</Button>
			<Button size="lg" disabled={busy || !preview || preview.total === 0} onclick={apply}>
				{preview && preview.total > 0 ? `Fill in ${preview.total}` : 'Fill in'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
