<script lang="ts">
	/**
	 * "Scan receipt" button for the expense form — vlm-receipt-parsing T6.
	 *
	 * Mobile-first: a hidden `<input type="file" accept="image/*" capture="environment">` so a phone
	 * opens the camera directly. On pick it uploads to vlmApi.parseReceipt, then hands the resulting
	 * DRAFT (+ the picked File) back to the parent via onDraft — the parent pre-fills the expense form
	 * and pushes the image into its pending-photos list (R5: the image attaches via the existing
	 * expense_receipts flow on save). This component NEVER writes an expense itself.
	 *
	 * Four-states (R9): idle (button) / loading (spinner, disabled) / error (actionable message + a
	 * "fill manually" fallback — the form is never blocked) / data (handled by the parent pre-fill).
	 * D3 (ruled simple): we surface the draft straight into the form with no per-field confidence UI.
	 *
	 * R7 first-use privacy disclosure: before the FIRST scan ever, an AlertDialog explains the image is
	 * sent to the user's chosen provider (and that self-hosting keeps it local). Dismissal is remembered
	 * in localStorage so it shows once. ApiError statusCode distinguishes "no provider configured" (400 —
	 * link them to Settings) from "provider unreachable" (502).
	 */
	import { Sparkles, LoaderCircle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { vlmApi, type ReceiptDraft } from '$lib/services/vlm-api';
	import { ApiError } from '$lib/utils/error-handling';

	interface Props {
		/** Called with the validated draft + the picked image after a successful parse. */
		onDraft: (_draft: ReceiptDraft, _image: File) => void;
	}
	let { onDraft }: Props = $props();

	const DISCLOSURE_KEY = 'vroom.vlm.receipt-scan-disclosed';

	let fileInput = $state<HTMLInputElement | null>(null);
	let isScanning = $state(false);
	let errorMessage = $state<string | null>(null);
	let showDisclosure = $state(false);
	let pendingFile = $state<File | null>(null); // file awaiting the post-disclosure scan

	/** Click handler for the visible button — gate the very first scan behind the disclosure. */
	function onScanClick() {
		errorMessage = null;
		const disclosed =
			typeof localStorage !== 'undefined' && localStorage.getItem(DISCLOSURE_KEY) === '1';
		if (!disclosed) {
			showDisclosure = true; // open the picker only after they acknowledge
			return;
		}
		fileInput?.click();
	}

	function acknowledgeDisclosure() {
		try {
			localStorage.setItem(DISCLOSURE_KEY, '1');
		} catch {
			// localStorage may be unavailable (private mode) — proceed anyway; we just re-ask next time.
		}
		showDisclosure = false;
		fileInput?.click();
	}

	async function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Reset the input so picking the SAME file again re-fires change.
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
			if (err instanceof ApiError && err.statusCode === 400) {
				errorMessage =
					'No receipt-parsing provider is set up yet. Add one in Settings → Receipt Parsing.';
			} else if (err instanceof ApiError && err.statusCode === 502) {
				errorMessage =
					'The AI provider could not be reached. Check the key/model, or fill it in manually.';
			} else {
				errorMessage =
					err instanceof Error ? err.message : 'Could not read the receipt. Fill it in manually.';
			}
		} finally {
			isScanning = false;
		}
	}

	function retry() {
		if (pendingFile) runScan(pendingFile);
	}
</script>

<div class="space-y-2">
	<!-- Hidden capture input: accept any image, prefer the rear camera on mobile. -->
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
		class="w-full"
		onclick={onScanClick}
		disabled={isScanning}
		data-testid="receipt-scan-button"
	>
		{#if isScanning}
			<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
			Reading receipt…
		{:else}
			<Sparkles class="mr-2 h-4 w-4" />
			Scan receipt
		{/if}
	</Button>

	{#if errorMessage}
		<div
			class="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
			data-testid="receipt-scan-error"
		>
			<p class="text-destructive">{errorMessage}</p>
			{#if pendingFile}
				<button
					type="button"
					class="self-start text-xs underline hover:text-foreground"
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
			<AlertDialog.Title>Scan a receipt with AI</AlertDialog.Title>
			<AlertDialog.Description>
				Your receipt photo is sent to the AI provider you configured to read the amount, date, and
				category — then you review and confirm before anything is saved. Nothing is stored by VROOM
				until you save the expense. For maximum privacy, configure a self-hosted (Ollama) provider
				so the image never leaves your machine.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (showDisclosure = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={acknowledgeDisclosure}>Continue</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
