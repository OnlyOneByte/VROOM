<script lang="ts">
	import { browser } from '$app/environment';
	import {
		LoaderCircle,
		Upload,
		X,
		CircleAlert,
		ImagePlus,
		Camera,
		SwitchCamera,
		Circle
	} from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';

	const DEFAULT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
	const DEFAULT_MAX_SIZE = 10_485_760; // 10MB

	interface Props {
		open: boolean;
		/** Dialog title */
		title?: string;
		/** Dialog description */
		description?: string;
		/** Accepted MIME types */
		acceptedTypes?: string[];
		/** Max file size in bytes */
		maxFileSize?: number;
		/** Allow selecting multiple files */
		multiple?: boolean;
		/** Called for each file to upload. Return value is passed to onUploadComplete. */
		onUpload: (_file: File) => Promise<unknown>;
		/** Called after each successful upload */
		onUploadComplete?: (_result: unknown) => void;
		/** Called when dialog closes */
		onClose: () => void;
	}

	let {
		open = $bindable(),
		title = 'Upload Photos',
		description = 'Select, drag, or capture photos',
		acceptedTypes = DEFAULT_IMAGE_TYPES,
		maxFileSize = DEFAULT_MAX_SIZE,
		multiple = true,
		onUpload,
		onUploadComplete,
		onClose
	}: Props = $props();

	// --- Upload tab state ---
	let selectedFiles = $state<File[]>([]);
	let validationErrors = $state<string[]>([]);
	let uploading = $state(false);
	let uploadIndex = $state(0);
	let uploadErrors = $state<string[]>([]);
	let isDragOver = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	let uploadTotal = $derived(selectedFiles.length);
	let allDone = $derived(!uploading && uploadIndex > 0 && uploadIndex >= uploadTotal);

	// --- Camera tab state ---
	let activeTab = $state('upload');
	let videoEl = $state<HTMLVideoElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let mediaStream = $state<MediaStream | null>(null);
	let cameraError = $state<string | null>(null);
	let cameraReady = $state(false);
	let facingMode = $state<'user' | 'environment'>('environment');
	let capturedPreview = $state<string | null>(null);
	let capturedFile = $state<File | null>(null);
	let uploadingCapture = $state(false);

	let hasCameraSupport = $derived(browser && !!navigator.mediaDevices?.getUserMedia);

	let acceptedInputStr = $derived(acceptedTypes.join(','));
	let maxSizeMB = $derived(Math.round(maxFileSize / (1024 * 1024)));
	let acceptedLabels = $derived(
		acceptedTypes
			.map(t => {
				if (t === 'image/jpeg') return 'JPEG';
				if (t === 'image/png') return 'PNG';
				if (t === 'image/webp') return 'WebP';
				if (t === 'application/pdf') return 'PDF';
				return t.split('/')[1]?.toUpperCase() ?? t;
			})
			.join(', ')
	);

	// --- Reset on open ---
	$effect(() => {
		if (open) {
			selectedFiles = [];
			validationErrors = [];
			uploading = false;
			uploadIndex = 0;
			uploadErrors = [];
			isDragOver = false;
			activeTab = 'upload';
			capturedPreview = null;
			capturedFile = null;
			uploadingCapture = false;
			cameraError = null;
			cameraReady = false;
		} else {
			stopCamera();
		}
	});

	// --- Camera lifecycle: start/stop when tab changes ---
	$effect(() => {
		if (activeTab === 'camera' && open) {
			startCamera();
		} else {
			stopCamera();
		}
	});

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

	// --- Upload flow ---
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
				const result = await onUpload(file);
				onUploadComplete?.(result);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : `Failed to upload "${file.name}"`;
				uploadErrors = [...uploadErrors, message];
			}
		}
		uploadIndex = selectedFiles.length;
		uploading = false;
	}

	// --- Camera ---
	async function startCamera() {
		if (!hasCameraSupport) {
			cameraError = 'Camera is not supported in this browser.';
			return;
		}
		cameraError = null;
		cameraReady = false;
		capturedPreview = null;
		capturedFile = null;

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
				audio: false
			});
			mediaStream = stream;
			// Wait a tick for the video element to be in the DOM
			await new Promise(r => setTimeout(r, 50));
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
				cameraReady = true;
			}
		} catch (err: unknown) {
			if (err instanceof DOMException && err.name === 'NotAllowedError') {
				cameraError = 'Camera access was denied. Please allow camera permissions and try again.';
			} else if (err instanceof DOMException && err.name === 'NotFoundError') {
				cameraError = 'No camera found on this device.';
			} else {
				cameraError = 'Could not access camera. Please try again.';
			}
		}
	}

	function stopCamera() {
		if (mediaStream) {
			for (const track of mediaStream.getTracks()) {
				track.stop();
			}
			mediaStream = null;
		}
		cameraReady = false;
	}

	async function toggleFacingMode() {
		facingMode = facingMode === 'environment' ? 'user' : 'environment';
		stopCamera();
		await startCamera();
	}

	function capturePhoto() {
		if (!videoEl || !canvasEl) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		canvasEl.width = videoEl.videoWidth;
		canvasEl.height = videoEl.videoHeight;
		ctx.drawImage(videoEl, 0, 0);

		canvasEl.toBlob(
			blob => {
				if (!blob) return;
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const file = new File([blob], `capture-${timestamp}.jpg`, { type: 'image/jpeg' });
				capturedFile = file;
				capturedPreview = URL.createObjectURL(blob);
				stopCamera();
			},
			'image/jpeg',
			0.92
		);
	}

	function retakePhoto() {
		if (capturedPreview) {
			URL.revokeObjectURL(capturedPreview);
		}
		capturedPreview = null;
		capturedFile = null;
		startCamera();
	}

	async function uploadCapture() {
		if (!capturedFile || uploadingCapture) return;
		uploadingCapture = true;
		try {
			const result = await onUpload(capturedFile);
			onUploadComplete?.(result);
			// Reset for another capture
			capturedPreview = null;
			capturedFile = null;
			uploadingCapture = false;
			// Close dialog after successful capture upload
			handleClose();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to upload captured photo';
			uploadErrors = [message];
			uploadingCapture = false;
		}
	}

	// --- Dialog close ---
	function handleClose() {
		if (uploading || uploadingCapture) return;
		stopCamera();
		if (capturedPreview) {
			URL.revokeObjectURL(capturedPreview);
			capturedPreview = null;
		}
		open = false;
		onClose();
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
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

		{#if allDone}
			<!-- Done state -->
			<div class="py-4 text-center">
				<p class="text-sm font-medium text-foreground">
					Upload complete{uploadErrors.length > 0
						? ` (${uploadTotal - uploadErrors.length} of ${uploadTotal} succeeded)`
						: ''}
				</p>
			</div>

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

			<Dialog.Footer>
				<Button variant="outline" onclick={handleClose}>Close</Button>
			</Dialog.Footer>
		{:else}
			<Tabs.Root bind:value={activeTab}>
				<Tabs.List class="grid w-full grid-cols-2">
					<Tabs.Trigger value="upload" disabled={uploading}>
						<Upload class="mr-2 h-4 w-4" />
						Upload
					</Tabs.Trigger>
					<Tabs.Trigger value="camera" disabled={uploading || !hasCameraSupport}>
						<Camera class="mr-2 h-4 w-4" />
						Camera
					</Tabs.Trigger>
				</Tabs.List>

				<!-- ===== Upload Tab ===== -->
				<Tabs.Content value="upload" class="space-y-3 pt-3">
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
							onkeydown={e => {
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
					{#if uploadErrors.length > 0 && !allDone}
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
					</div>
				</Tabs.Content>

				<!-- ===== Camera Tab ===== -->
				<Tabs.Content value="camera" class="space-y-3 pt-3">
					{#if cameraError}
						<div
							class="flex flex-col items-center gap-3 rounded-lg border border-destructive bg-destructive/10 p-6 text-center"
						>
							<CircleAlert class="h-8 w-8 text-destructive" />
							<p class="text-sm text-destructive">{cameraError}</p>
							<Button variant="outline" size="sm" onclick={startCamera}>Try Again</Button>
						</div>
					{:else if capturedPreview}
						<!-- Preview captured photo -->
						<div class="relative overflow-hidden rounded-lg border border-border">
							<img
								src={capturedPreview}
								alt="Captured preview"
								class="aspect-video w-full object-cover"
							/>
						</div>
						<div class="flex justify-end gap-2">
							<Button variant="outline" onclick={retakePhoto} disabled={uploadingCapture}>
								Retake
							</Button>
							<Button onclick={uploadCapture} disabled={uploadingCapture}>
								{#if uploadingCapture}
									<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
									Uploading...
								{:else}
									<Upload class="mr-2 h-4 w-4" />
									Use Photo
								{/if}
							</Button>
						</div>
					{:else}
						<!-- Live viewfinder -->
						<div class="relative overflow-hidden rounded-lg border border-border bg-muted">
							{#if !cameraReady}
								<div class="flex aspect-video items-center justify-center">
									<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
								</div>
							{/if}
							<video
								bind:this={videoEl}
								autoplay
								playsinline
								muted
								class="aspect-video w-full object-cover {cameraReady ? '' : 'hidden'}"
							></video>
						</div>
						<canvas bind:this={canvasEl} class="hidden"></canvas>

						<div class="flex items-center justify-center gap-4">
							<Button
								variant="outline"
								size="sm"
								onclick={toggleFacingMode}
								disabled={!cameraReady}
								aria-label="Switch camera"
							>
								<SwitchCamera class="h-4 w-4" />
							</Button>
							<Button
								size="lg"
								class="h-14 w-14 rounded-full p-0"
								onclick={capturePhoto}
								disabled={!cameraReady}
								aria-label="Take photo"
							>
								<Circle class="h-8 w-8" />
							</Button>
							<Button variant="outline" size="sm" onclick={handleClose} aria-label="Cancel">
								<X class="h-4 w-4" />
							</Button>
						</div>
					{/if}

					<!-- Upload errors from camera capture -->
					{#if uploadErrors.length > 0 && activeTab === 'camera'}
						<div class="rounded-lg border border-destructive bg-destructive/10 p-3">
							{#each uploadErrors as error, idx (idx)}
								<div class="flex items-start gap-2 text-sm text-destructive">
									<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
									<span>{error}</span>
								</div>
							{/each}
						</div>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		{/if}
	</Dialog.Content>
</Dialog.Root>
