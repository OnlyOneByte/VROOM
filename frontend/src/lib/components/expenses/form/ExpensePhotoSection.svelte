<script lang="ts">
	import { onMount } from 'svelte';
	import { Upload, Trash2, ImagePlus, LoaderCircle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import MediaCaptureDialog from '$lib/components/common/MediaCaptureDialog.svelte';
	import ConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';
	import { expenseApi } from '$lib/services/expense-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import type { Photo } from '$lib/types';

	interface Props {
		entityType: 'expense';
		entityId: string;
	}

	let { entityType, entityId }: Props = $props();

	let photos = $state<Photo[]>([]);
	let isLoading = $state(true);
	let showUploadDialog = $state(false);

	onMount(async () => {
		await loadPhotos();
	});

	async function loadPhotos() {
		isLoading = true;
		try {
			const photosResult = await expenseApi.getPhotos(entityType, entityId);
			photos = photosResult.data;
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to load photos');
		} finally {
			isLoading = false;
		}
	}

	function handleUploadComplete(result: unknown) {
		photos = [...photos, result as Photo];
	}

	// Styled confirm dialog (replaces native confirm()) — deletion is permanent
	// (removes the file from storage too) and the trash button sits on a hover
	// overlay where a misclick is easy.
	let confirmOpen = $state(false);
	let pendingDeleteId = $state<string | null>(null);

	function requestDelete(photoId: string) {
		pendingDeleteId = photoId;
		confirmOpen = true;
	}

	async function performDelete() {
		if (!pendingDeleteId) return;
		const photoId = pendingDeleteId;
		try {
			await expenseApi.deletePhoto(entityType, entityId, photoId);
			photos = photos.filter(p => p.id !== photoId);
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to delete photo');
			throw err; // keep the dialog open on failure
		}
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-medium text-foreground">Photos & Receipts</h3>
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
	{:else if photos.length === 0}
		<div class="flex flex-col items-center py-4 text-center">
			<ImagePlus class="mb-2 h-6 w-6 text-muted-foreground" />
			<p class="text-xs text-muted-foreground">No photos or receipts yet.</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
			{#each photos as photo (photo.id)}
				<div class="group relative overflow-hidden rounded-lg border border-border bg-muted">
					{#if photo.mimeType === 'application/pdf'}
						<div class="flex aspect-square items-center justify-center">
							<div class="text-center">
								<ImagePlus class="mx-auto h-8 w-8 text-muted-foreground" />
								<p class="mt-1 truncate px-2 text-xs text-muted-foreground">
									{photo.fileName}
								</p>
							</div>
						</div>
					{:else}
						<img
							src={expenseApi.getPhotoThumbnailUrl(entityType, entityId, photo.id)}
							alt={photo.fileName}
							loading="lazy"
							class="aspect-square w-full object-cover"
						/>
					{/if}

					<div
						class="absolute inset-x-0 bottom-0 flex items-center justify-end bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100"
					>
						<Button
							variant="destructive"
							size="sm"
							class="h-7 text-xs"
							onclick={() => requestDelete(photo.id)}
						>
							<Trash2 class="h-3 w-3" />
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<MediaCaptureDialog
	bind:open={showUploadDialog}
	title="Upload Photos & Receipts"
	description="Add photos or receipt images for this expense"
	acceptedTypes={['image/jpeg', 'image/png', 'image/webp', 'application/pdf']}
	onUpload={file => expenseApi.uploadPhoto(entityType, entityId, file)}
	onUploadComplete={handleUploadComplete}
	onClose={() => (showUploadDialog = false)}
/>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete photo?"
	description="This permanently removes the photo from storage and cannot be undone."
	onConfirm={performDelete}
/>
