<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Upload,
		Trash2,
		FileText,
		Download,
		LoaderCircle,
		ImagePlus,
		X,
		CircleAlert
	} from 'lucide-svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import type { Photo } from '$lib/types';

	const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
	const ALLOWED_TYPES = [...IMAGE_TYPES, 'application/pdf'];
	const ACCEPTED_INPUT = ALLOWED_TYPES.join(',');
	const MAX_FILE_SIZE = 10_485_760; // 10MB

	interface Props {
		policyId: string;
	}

	let { policyId }: Props = $props();

	let documents = $state<Photo[]>([]);
	let isLoading = $state(true);

	// Upload dialog state
	let showUploadDialog = $state(false);
	let selectedFiles = $state<File[]>([]);
	let validationErrors = $state<string[]>([]);
	let uploading = $state(false);
	let uploadIndex = $state(0);
	let uploadErrors = $state<string[]>([]);
	let isDragOver = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	let uploadTotal = $derived(selectedFiles.length);
	let allDone = $derived(!uploading && uploadIndex > 0 && uploadIndex >= uploadTotal);

	$effect(() => {
		if (showUploadDialog) {
			selectedFiles = [];
			validationErrors = [];
			uploading = false;
			uploadIndex = 0;
			uploadErrors = [];
			isDragOver = false;
		}
	});

	onMount(async () => {
		await loadDocuments();
	});

	async function loadDocuments() {
		isLoading = true;
		try {
			documents = await insuranceApi.getDocuments(policyId);
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to load documents');
		} finally {
			isLoading = false;
		}
	}

	function isImage(mimeType: string): boolean {
		return IMAGE_TYPES.includes(mimeType);
	}

	function validateFile(file: File): string | null {
		if (!ALLOWED_TYPES.includes(file.type)) {
			return `"${file.name}" is not supported. Only JPEG, PNG, WebP, and PDF are allowed.`;
		}
		if (file.size > MAX_FILE_SIZE) {
			return `"${file.name}" exceeds the 10MB size limit.`;
		}
		return null;
	}

	function addFiles(incoming: FileList | File[]) {
		const errors: string[] = [];
		const valid: File[] = [];
		for (const file of incoming) {
			const err = validateFile(file);
			if (err) errors.push(err);
			else valid.push(file);
		}
		validationErrors = errors;
		if (valid.length > 0) selectedFiles = [...selectedFiles, ...valid];
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			addFiles(input.files);
			input.value = '';
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragOver = true;
	}

	function handleDragLeave() {
		isDragOver = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragOver = false;
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			addFiles(e.dataTransfer.files);
		}
	}

	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, i) => i !== index);
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function startUpload() {
		if (selectedFiles.length === 0 || uploading) return;
		uploading = true;
		uploadIndex = 0;
		uploadErrors = [];

		for (let i = 0; i < selectedFiles.length; i++) {
			uploadIndex = i;
			const file = selectedFiles[i];
			if (!file) continue;
			try {
				const doc = await insuranceApi.uploadDocument(policyId, file);
				documents = [...documents, doc];
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : `Failed to upload "${file.name}"`;
				uploadErrors = [...uploadErrors, message];
			}
		}
		uploadIndex = selectedFiles.length;
		uploading = false;
	}

	function handleDialogClose() {
		if (!uploading) showUploadDialog = false;
	}

	async function handleDelete(docId: string) {
		try {
			await insuranceApi.deleteDocument(policyId, docId);
			documents = documents.filter((d) => d.id !== docId);
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to delete document');
		}
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h5 class="text-sm font-medium text-foreground">Documents</h5>
		<Button
			variant="outline"
			size="sm"
			class="h-7 text-xs"
			onclick={() => (showUploadDialog = true)}
		>
			<Upload class="mr-1 h-3 w-3" />
			Upload
		</Button>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-4">
			<LoaderCircle class="h-5 w-5 animate-spin text-muted-foreground" />
		</div>
	{:else if documents.length === 0}
		<div class="flex flex-col items-center py-4 text-center">
			<ImagePlus class="mb-2 h-6 w-6 text-muted-foreground" />
			<p class="text-xs text-muted-foreground">No documents uploaded yet.</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
			{#each documents as doc (doc.id)}
				<div class="group relative overflow-hidden rounded-md border border-border bg-muted/50">
					{#if isImage(doc.mimeType)}
						<img
							src={insuranceApi.getDocumentThumbnailUrl(policyId, doc.id)}
							alt={doc.fileName}
							loading="lazy"
							class="aspect-square w-full object-cover"
						/>
					{:else}
						<div class="flex aspect-square flex-col items-center justify-center gap-1 p-2">
							<FileText class="h-8 w-8 text-muted-foreground" />
							<p class="text-xs text-muted-foreground truncate w-full text-center">
								{doc.fileName}
							</p>
							{#if doc.webViewLink}
								<a
									href={doc.webViewLink}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
								>
									<Download class="h-3 w-3" />
									Download
								</a>
							{/if}
						</div>
					{/if}
					<div
						class="absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
					>
						<Button
							variant="destructive"
							size="sm"
							class="h-6 text-xs"
							onclick={() => handleDelete(doc.id)}
						>
							<Trash2 class="h-3 w-3" />
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Upload Dialog -->
<Dialog.Root bind:open={showUploadDialog} onOpenChange={(isOpen) => !isOpen && handleDialogClose()}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Upload Documents</Dialog.Title>
			<Dialog.Description>
				Upload insurance documents (JPEG, PNG, WebP, or PDF). Max 10MB per file.
			</Dialog.Description>
		</Dialog.Header>

		{#if allDone}
			<div class="py-6 text-center">
				<p class="text-sm text-foreground font-medium">
					{uploadErrors.length === 0
						? 'All documents uploaded successfully.'
						: `Uploaded with ${uploadErrors.length} error(s).`}
				</p>
				{#if uploadErrors.length > 0}
					<div class="mt-2 space-y-1">
						{#each uploadErrors as err}
							<p class="text-xs text-destructive">{err}</p>
						{/each}
					</div>
				{/if}
			</div>
			<Dialog.Footer>
				<Button onclick={handleDialogClose}>Done</Button>
			</Dialog.Footer>
		{:else}
			<!-- Drop zone -->
			<div
				role="button"
				tabindex="0"
				class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors
					{isDragOver ? 'border-primary bg-primary/5' : 'border-border'}"
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				ondrop={handleDrop}
				onclick={() => fileInputEl?.click()}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputEl?.click(); }}
			>
				<ImagePlus class="mb-2 h-8 w-8 text-muted-foreground" />
				<p class="text-sm text-muted-foreground">
					Drag & drop files here, or <span class="text-primary font-medium">browse</span>
				</p>
				<p class="mt-1 text-xs text-muted-foreground">JPEG, PNG, WebP, PDF up to 10MB</p>
			</div>
			<input
				bind:this={fileInputEl}
				type="file"
				accept={ACCEPTED_INPUT}
				multiple
				class="hidden"
				onchange={handleFileInput}
			/>

			<!-- Validation errors -->
			{#if validationErrors.length > 0}
				<div class="space-y-1">
					{#each validationErrors as err}
						<div class="flex items-center gap-1.5 text-xs text-destructive">
							<CircleAlert class="h-3 w-3 shrink-0" />
							<span>{err}</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Selected files -->
			{#if selectedFiles.length > 0}
				<div class="space-y-2 max-h-40 overflow-y-auto">
					{#each selectedFiles as file, i (file.name + i)}
						<div class="flex items-center justify-between rounded-md border border-border px-3 py-2">
							<div class="flex items-center gap-2 min-w-0">
								<FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
								<div class="min-w-0">
									<p class="text-sm text-foreground truncate">{file.name}</p>
									<p class="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
								</div>
							</div>
							{#if !uploading}
								<Button variant="ghost" size="sm" class="h-6 w-6 p-0" onclick={() => removeFile(i)}>
									<X class="h-3 w-3" />
								</Button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- Upload errors -->
			{#if uploadErrors.length > 0}
				<div class="space-y-1">
					{#each uploadErrors as err}
						<p class="text-xs text-destructive">{err}</p>
					{/each}
				</div>
			{/if}

			<Dialog.Footer>
				<Button variant="outline" onclick={handleDialogClose} disabled={uploading}>Cancel</Button>
				<Button onclick={startUpload} disabled={selectedFiles.length === 0 || uploading}>
					{#if uploading}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Uploading {uploadIndex + 1}/{uploadTotal}…
					{:else}
						<Upload class="mr-2 h-4 w-4" />
						Upload {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
					{/if}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
