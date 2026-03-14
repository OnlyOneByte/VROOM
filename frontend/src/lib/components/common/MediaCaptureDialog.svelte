<script lang="ts">
	import { browser } from '$app/environment';
	import { CircleAlert, Upload, Camera } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import UploadTab from './media/UploadTab.svelte';
	import CameraTab from './media/CameraTab.svelte';

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

	// --- Orchestrator state ---
	let activeTab = $state('upload');
	let uploading = $state(false);
	let uploadIndex = $state(0);
	let uploadTotal = $state(0);
	let uploadErrors = $state<string[]>([]);

	let allDone = $derived(!uploading && uploadIndex > 0 && uploadIndex >= uploadTotal);

	let hasCameraSupport = $derived(browser && !!navigator.mediaDevices?.getUserMedia);

	// Child component refs
	let uploadTabRef = $state<ReturnType<typeof UploadTab> | null>(null);
	let cameraTabRef = $state<ReturnType<typeof CameraTab> | null>(null);

	// --- Reset on open/close ---
	$effect(() => {
		if (open) {
			activeTab = 'upload';
			uploading = false;
			uploadIndex = 0;
			uploadTotal = 0;
			uploadErrors = [];
			uploadTabRef?.reset();
			cameraTabRef?.reset();
		}
	});

	// --- Upload loop (orchestrated by parent) ---
	async function handleFilesReady(files: File[]) {
		if (files.length === 0 || uploading) return;
		uploading = true;
		uploadIndex = 0;
		uploadTotal = files.length;
		uploadErrors = [];

		for (let i = 0; i < files.length; i++) {
			uploadIndex = i;
			const file = files[i];
			if (!file) continue;
			try {
				const result = await onUpload(file);
				onUploadComplete?.(result);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : `Failed to upload "${file.name}"`;
				uploadErrors = [...uploadErrors, message];
			}
		}
		uploadIndex = files.length;
		uploading = false;
	}

	// --- Camera capture upload ---
	async function handleUploadCapture(file: File) {
		try {
			const result = await onUpload(file);
			onUploadComplete?.(result);
			handleClose();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to upload captured photo';
			uploadErrors = [message];
			throw err;
		}
	}

	// --- Dialog close ---
	function handleClose() {
		if (uploading) return;
		open = false;
		onClose();
	}
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => !isOpen && handleClose()}>
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

				<Tabs.Content value="upload" class="space-y-3 pt-3">
					<UploadTab
						bind:this={uploadTabRef}
						{acceptedTypes}
						{maxFileSize}
						{multiple}
						{uploading}
						{uploadIndex}
						uploadTotal={uploadTotal}
						{uploadErrors}
						onFilesReady={handleFilesReady}
						onClose={handleClose}
					/>
				</Tabs.Content>

				<Tabs.Content value="camera" class="space-y-3 pt-3">
					{#if activeTab === 'camera'}
						<CameraTab
							bind:this={cameraTabRef}
							{uploadErrors}
							onUploadCapture={handleUploadCapture}
							onClose={handleClose}
						/>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		{/if}
	</Dialog.Content>
</Dialog.Root>
