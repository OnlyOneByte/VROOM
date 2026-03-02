<script lang="ts">
	import { LoaderCircle, Upload, X, CircleAlert, ImagePlus } from 'lucide-svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import type { Photo } from '$lib/types';

	const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
	const MAX_FILE_SIZE = 10_485_760; // 10MB

	interface Props {
		open: boolean;
		vehicleId: string;
		onClose: () => void;
		onUploadComplete: (_photo: Photo) => void;
	}

	let { open = $bindable(), vehicleId, onClose, onUploadComplete }: Props = $props();

	let selectedFiles = $state<File[]>([]);
	let validationErrors = $state<string[]>([]);
	let uploading = $state(false);
	let uploadIndex = $state(0);
	let uploadErrors = $state<string[]>([]);
	let isDragOver = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	let uploadTotal = $derived(selectedFiles.length);
	let uploadProgress = $derived(
		uploading ? `Uploading ${uploadIndex + 1} of ${uploadTotal}...` : ''
	);
	let allDone = $derived(!uploading && uploadIndex > 0 && uploadIndex >= uploadTotal);

	$effect(() => {
		if (open) {
			selectedFiles = [];
			validationErrors = [];
			uploading = false;
			uploadIndex = 0;
			uploadErrors = [];
			isDragOver = false;
		}
	});

	function validateFile(file: File): string | null {
		if (!ALLOWED_TYPES.includes(file.type)) {
			return `"${file.name}" is not a supported format. Only JPEG, PNG, and WebP are allowed.`;
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
			if (err) {
				errors.push(err);
			} else {
				valid.push(file);
			}
		}
		validationErrors = errors;
		if (valid.length > 0) {
			selectedFiles = [...selectedFiles, ...valid];
		}
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
				const photo = await vehicleApi.uploadPhoto(vehicleId, file);
				onUploadComplete(photo);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : `Failed to upload "${file.name}"`;
				uploadErrors = [...uploadErrors, message];
			}
		}

		uploadIndex = selectedFiles.length;
		uploading = false;
	}

	function handleClose() {
		if (!uploading) {
			open = false;
			onClose();
		}
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<Dialog.Root bind:open onOpenChange={isOpen => !isOpen && handleClose()}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Upload Photos</Dialog.Title>
			<Dialog.Description
				>Select or drag photos to upload (JPEG, PNG, WebP up to 10MB)</Dialog.Description
			>
		</Dialog.Header>

		{#if !uploading && !allDone}
			<!-- Drop zone -->
			<div
				role="button"
				tabindex="0"
				class="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors {isDragOver
					? 'border-primary bg-primary/5'
					: 'border-border hover:border-primary/50 hover:bg-muted/50'}"
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				ondrop={handleDrop}
				onclick={() => fileInputEl?.click()}
				onkeydown={e => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						fileInputEl?.click();
					}
				}}
			>
				<ImagePlus class="mb-3 h-10 w-10 text-muted-foreground" />
				<p class="text-sm font-medium text-foreground">Drop photos here or click to browse</p>
				<p class="mt-1 text-xs text-muted-foreground">
					JPEG, PNG, or WebP &middot; Max 10MB per file
				</p>
			</div>

			<input
				bind:this={fileInputEl}
				type="file"
				accept="image/jpeg,image/png,image/webp"
				multiple
				class="hidden"
				onchange={handleFileInput}
			/>
		{/if}

		<!-- Validation errors -->
		{#if validationErrors.length > 0}
			<div class="rounded-lg border border-destructive bg-destructive/10 p-3">
				{#each validationErrors as error}
					<div class="flex items-start gap-2 text-sm text-destructive">
						<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
						<span>{error}</span>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Selected files list -->
		{#if selectedFiles.length > 0 && !uploading && !allDone}
			<div class="max-h-48 space-y-2 overflow-y-auto">
				{#each selectedFiles as file, i (file.name + i)}
					<div
						class="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2"
					>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-foreground">{file.name}</p>
							<p class="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
						</div>
						<button
							type="button"
							class="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
							onclick={() => removeFile(i)}
						>
							<X class="h-4 w-4" />
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Upload progress -->
		{#if uploading}
			<div class="flex flex-col items-center gap-3 py-4">
				<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
				<p class="text-sm font-medium text-foreground">{uploadProgress}</p>
			</div>
		{/if}

		<!-- Upload errors -->
		{#if uploadErrors.length > 0}
			<div class="rounded-lg border border-destructive bg-destructive/10 p-3">
				{#each uploadErrors as error}
					<div class="flex items-start gap-2 text-sm text-destructive">
						<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
						<span>{error}</span>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Done state -->
		{#if allDone}
			<div class="py-4 text-center">
				<p class="text-sm font-medium text-foreground">
					Upload complete{uploadErrors.length > 0
						? ` (${uploadTotal - uploadErrors.length} of ${uploadTotal} succeeded)`
						: ''}
				</p>
			</div>
		{/if}

		<Dialog.Footer>
			{#if allDone}
				<Button variant="outline" onclick={handleClose}>Close</Button>
			{:else}
				<Button variant="outline" onclick={handleClose} disabled={uploading}>Cancel</Button>
				<Button onclick={startUpload} disabled={selectedFiles.length === 0 || uploading}>
					{#if uploading}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Uploading...
					{:else}
						<Upload class="mr-2 h-4 w-4" />
						Upload {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''}
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
