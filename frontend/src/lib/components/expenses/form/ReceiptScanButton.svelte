<script lang="ts">
	import { Sparkles, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { vlmApi, type ReceiptDraft } from '#lib/services/vlm-api.ts';
	import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	interface Props {
		onDraft: (_draft: ReceiptDraft, _image: File) => void;
	}
	let { onDraft }: Props = $props();

	const DISCLOSURE_KEY = 'vroom.vlm.receipt-scan-disclosed';

	let fileInput = $state<HTMLInputElement | null>(null);
	let isScanning = $state(false);
	let errorMessage = $state<string | null>(null);
	let showDisclosure = $state(false);
	let pendingFile = $state<File | null>(null);

	function onScanClick() {
		errorMessage = null;
		const disclosed =
			typeof localStorage !== 'undefined' && localStorage.getItem(DISCLOSURE_KEY) === '1';
		if (!disclosed) {
			showDisclosure = true;
			return;
		}
		fileInput?.click();
	}

	function acknowledgeDisclosure() {
		try {
			localStorage.setItem(DISCLOSURE_KEY, '1');
		} catch {
			// localStorage throws when storage is unavailable (private mode, blocked site data).
		}
		showDisclosure = false;
		fileInput?.click();
	}

	async function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Browsers skip the change event when the same file is picked again unless the value is cleared.
		input.value = '';
		if (!file) return;
		pendingFile = file;
		await runScan(file);
	}

	async function runScan(file: File) {
		isScanning = true;
		errorMessage = null;
		try {
			const draft = await vlmApi.parseReceipt(file);
			onDraft(draft, file);
		} catch (err) {
			if (err instanceof ApiError && err.code === 'NO_PROVIDER') {
				errorMessage =
					'No receipt-scanning provider is set up yet. Add one in Settings → Receipt Scanning.';
			} else if (err instanceof ApiError && (err.statusCode === 422 || err.statusCode === 503)) {
				errorMessage = `${err.message} Or fill it in manually.`;
			} else if (err instanceof ApiError && err.statusCode === 502) {
				errorMessage =
					"Couldn't reach the AI provider. Check the key and model, or fill it in manually.";
			} else {
				errorMessage = `Couldn't read the receipt. ${userFacingErrorMessage(err)} Or fill it in manually.`;
			}
		} finally {
			isScanning = false;
		}
	}

	function retry() {
		if (pendingFile) runScan(pendingFile);
	}
</script>

<div class="contents">
	<input
		bind:this={fileInput}
		type="file"
		accept="image/jpeg,image/png,image/webp"
		capture="environment"
		class="hidden"
		onchange={onFileChange}
		data-testid="receipt-scan-input"
	/>

	<Button
		type="button"
		variant="outline"
		class="ml-auto h-10 rounded-full px-3"
		onclick={onScanClick}
		disabled={isScanning}
		data-testid="receipt-scan-button"
	>
		{#if isScanning}
			<LoaderCircle class="h-4 w-4 animate-spin" />
			<span class="max-sm:sr-only">Reading receipt…</span>
		{:else}
			<Sparkles class="h-4 w-4" />
			<span class="max-sm:sr-only">Scan receipt</span>
		{/if}
	</Button>

	{#if errorMessage}
		<div
			class="flex basis-full flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
			data-testid="receipt-scan-error"
		>
			<p class="text-destructive">{errorMessage}</p>
			{#if pendingFile}
				<button
					type="button"
					class="inline-flex min-h-10 items-center self-start text-xs underline hover:text-foreground sm:min-h-0"
					onclick={retry}
				>
					Try again
				</button>
			{/if}
		</div>
	{/if}
</div>

<AlertDialog.Root bind:open={showDisclosure}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Scan a receipt</AlertDialog.Title>
			<AlertDialog.Description>
				Your receipt photo is read by the provider chosen in Settings → Receipt Scanning: the
				built-in text reader on your VROOM server, or an AI provider you added, which then receives
				the image. It fills in the amount, date and fuel details, and you review them before
				anything is saved. Nothing is stored by VROOM until you save the expense.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (showDisclosure = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={acknowledgeDisclosure}>Continue</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
