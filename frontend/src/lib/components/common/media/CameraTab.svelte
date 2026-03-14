<script lang="ts">
	import { browser } from '$app/environment';
	import {
		LoaderCircle,
		Upload,
		X,
		CircleAlert,
		SwitchCamera,
		Circle
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		uploadErrors: string[];
		onUploadCapture: (file: File) => Promise<void>;
		onClose: () => void;
	}

	let { uploadErrors, onUploadCapture, onClose }: Props = $props();

	// --- Camera state ---
	let videoEl = $state<HTMLVideoElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let mediaStream = $state<MediaStream | null>(null);
	let cameraError = $state<string | null>(null);
	let cameraReady = $state(false);
	let facingMode = $state<'user' | 'environment'>('environment');
	let capturedPreview = $state<string | null>(null);
	let capturedFile = $state<File | null>(null);
	let uploadingCapture = $state(false);
	let cameraStartId = 0;

	let hasCameraSupport = $derived(browser && !!navigator.mediaDevices?.getUserMedia);

	// --- Camera lifecycle ---
	$effect(() => {
		startCamera();
		return () => {
			stopCamera();
			if (capturedPreview) {
				URL.revokeObjectURL(capturedPreview);
			}
		};
	});

	async function startCamera() {
		if (!hasCameraSupport) {
			cameraError = 'Camera is not supported in this browser.';
			return;
		}

		const thisStartId = ++cameraStartId;
		cameraError = null;
		cameraReady = false;
		capturedPreview = null;
		capturedFile = null;

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
				audio: false
			});

			if (thisStartId !== cameraStartId) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}

			mediaStream = stream;
			await new Promise((r) => setTimeout(r, 50));
			if (thisStartId !== cameraStartId) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
				cameraReady = true;
			}
		} catch (err: unknown) {
			if (thisStartId !== cameraStartId) return;

			if (err instanceof DOMException && err.name === 'NotAllowedError') {
				cameraError = 'Camera access was denied. Please allow camera permissions and try again.';
			} else if (err instanceof DOMException && err.name === 'NotFoundError') {
				cameraError = 'No camera found on this device.';
			} else if (
				err instanceof DOMException &&
				(err.name === 'OverconstrainedError' || err.name === 'NotReadableError')
			) {
				try {
					const fallbackStream = await navigator.mediaDevices.getUserMedia({
						video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
						audio: false
					});
					if (thisStartId !== cameraStartId) {
						for (const track of fallbackStream.getTracks()) track.stop();
						return;
					}
					mediaStream = fallbackStream;
					await new Promise((r) => setTimeout(r, 50));
					if (thisStartId !== cameraStartId) {
						for (const track of fallbackStream.getTracks()) track.stop();
						return;
					}
					if (videoEl) {
						videoEl.srcObject = fallbackStream;
						await videoEl.play();
						cameraReady = true;
					}
				} catch {
					if (thisStartId !== cameraStartId) return;
					cameraError = 'Could not access camera. Please try again.';
				}
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

		const maxRetries = 3;
		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				await startCamera();
				if (!cameraError) return;
			} catch {
				// startCamera handles its own errors
			}
			if (
				cameraError === 'Could not access camera. Please try again.' &&
				attempt < maxRetries - 1
			) {
				cameraError = null;
				await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
			} else {
				return;
			}
		}
	}

	function capturePhoto() {
		if (!videoEl || !canvasEl) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		canvasEl.width = videoEl.videoWidth;
		canvasEl.height = videoEl.videoHeight;
		ctx.drawImage(videoEl, 0, 0);

		canvasEl.toBlob(
			(blob) => {
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
			await onUploadCapture(capturedFile);
			capturedPreview = null;
			capturedFile = null;
			uploadingCapture = false;
		} catch {
			uploadingCapture = false;
		}
	}

	export function reset() {
		stopCamera();
		if (capturedPreview) {
			URL.revokeObjectURL(capturedPreview);
		}
		cameraError = null;
		cameraReady = false;
		capturedPreview = null;
		capturedFile = null;
		uploadingCapture = false;
	}

	export { hasCameraSupport };
</script>

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
		<Button variant="outline" size="sm" onclick={onClose} aria-label="Cancel">
			<X class="h-4 w-4" />
		</Button>
	</div>
{/if}

<!-- Upload errors from camera capture -->
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
