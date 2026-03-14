<script lang="ts">
	import { LoaderCircle, Upload, X, CircleAlert, ImagePlus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		acceptedTypes: string[];
		maxFileSize: number;
		multiple: boolean;
		uploading: boolean;
		uploadIndex: number;
		uploadTotal: number;
		uploadErrors: string[];
		onFilesReady: (files: File[]) => void;
		onClose: () => void;
	}

	let {
		acceptedTypes,
		maxFileSize,
		multiple,
		uploading,
		uploadIndex,
		uploadTotal,
		uploadErrors,
		onFilesReady,
		onClose
	}: Props = $props();

	// --- Local state ---
	let selectedFiles = $state<File[]>([]);
	let validationErrors = $state<string[]>([]);
	let isDragOver = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	// --- Derived ---
	let acceptedInputStr = $derived(acceptedTypes.join(','));
	let maxSizeMB = $derived(Math.round(maxFileSize / (1024 * 1024)));
	let acceptedLabels = $derived(
		acceptedTypes
			.map((t) => {
				if (t === 'image/jpeg') return 'JPEG';
				if (t === 'image/png') return 'PNG';
				if (t === 'image/webp') return 'WebP';
				if (t === 'application/pdf') return 'PDF';
				return t.split('/')[1]?.toUpperCase() ?? t;
			})
			.join(', ')
	);

	// --- File validation ---
	function validateFile(file: File): string | null {
		if (!acceptedTypes.includes(file.type)) {
			return `"${file.name}" is not a supported format. Allowed: ${acceptedLabels}.`;
		}
		if (file.size > maxFileSize) {
			return `"${file.name}" exceeds the ${maxSizeMB}MB size limit.`;
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
		if (valid.length > 0) {
			selectedFiles = multiple ? [...selectedFiles, ...valid] : [valid[0]!];
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

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function handleUploadClick() {
		if (selectedFiles.length === 0 || uploading) return;
		onFilesReady(selectedFiles);
	}

	export function reset() {
		selectedFiles = [];
		validationErrors = [];
		isDragOver = false;
	}
</script>

{#if !uploading}
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
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				fileInputEl?.click();
			}
		}}
	>
		<ImagePlus class="mb-3 h-10 w-10 text-muted-foreground" />
		<p class="text-sm font-medium text-foreground">Drop files here or click to browse</p>
		<p class="mt-1 text-xs text-muted-foreground">
			{acceptedLabels} &middot; Max {maxSizeMB}MB per file
		</p>
	</div>

	<input
		bind:this={fileInputEl}
		type="file"
		accept={acceptedInputStr}
		{multiple}
		class="hidden"
		onchange={handleFileInput}
	/>
{/if}

<!-- Validation errors -->
{#if validationErrors.length > 0}
	<div class="rounded-lg border border-destructive bg-destructive/10 p-3">
		{#each validationErrors as error, idx (idx)}
			<div class="flex items-start gap-2 text-sm text-destructive">
				<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
				<span>{error}</span>
			</div>
		{/each}
	</div>
{/if}

<!-- Selected files list -->
{#if selectedFiles.length > 0 && !uploading}
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
		<p class="text-sm font-medium text-foreground">
			Uploading {uploadIndex + 1} of {uploadTotal}...
		</p>
	</div>
{/if}

<!-- Upload errors during progress -->
{#if uploadErrors.length > 0}
	<div class="rounded-lg border border-destructive bg-destructive/10 p-3">
		{#each uploadErrors as error, idx (idx)}
			<div class="flex items-start gap-2 text-sm text-destructive">
				<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
				<span>{error}</span>
			</div>
		{/each}
	</div>
{/if}

<div class="flex justify-end gap-2 pt-1">
	<Button variant="outline" onclick={onClose} disabled={uploading}>Cancel</Button>
	<Button onclick={handleUploadClick} disabled={selectedFiles.length === 0 || uploading}>
		{#if uploading}
			<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
			Uploading...
		{:else}
			<Upload class="mr-2 h-4 w-4" />
			Upload {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''}
		{/if}
	</Button>
</div>
