<script lang="ts">
	import { onMount } from 'svelte';
	import { Upload, Trash2, ImagePlus, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { expenseApi, type PhotoSectionEntityType } from '#lib/services/expense-api.ts';
	import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';
	import { focusFirstButton } from '#lib/utils/focus.ts';
	import type { Photo } from '#lib/types/index.ts';
	import { authStore } from '#lib/stores/auth.svelte.ts';

	interface Props {
		entityType: PhotoSectionEntityType;
		entityId: string;
	}

	const ENTITY_NOUN: Record<PhotoSectionEntityType, string> = {
		expense: 'expense',
		odometer_entry: 'reading'
	};

	let { entityType, entityId }: Props = $props();
	const demo = $derived(authStore.user?.demo === true);

	let photos = $state<Photo[]>([]);
	let isLoading = $state(true);
	let showUploadDialog = $state(false);
	let mediaDialog = $state<Promise<
		typeof import('#lib/components/common/MediaCaptureDialog.svelte')
	> | null>(null);

	function openUploadDialog() {
		mediaDialog ??= import('#lib/components/common/MediaCaptureDialog.svelte');
		mediaDialog.then(
			() => (showUploadDialog = true),
			error => {
				mediaDialog = null;
				handleErrorWithNotification(error, "Couldn't open the upload dialog");
			}
		);
	}

	onMount(async () => {
		await loadPhotos();
	});

	async function loadPhotos() {
		isLoading = true;
		try {
			const photosResult = await expenseApi.getPhotos(entityType, entityId);
			photos = photosResult.data;
		} catch (err) {
			handleErrorWithNotification(err, "Couldn't load the photos");
		} finally {
			isLoading = false;
		}
	}

	function handleUploadComplete(result: unknown) {
		photos = [...photos, result as Photo];
	}

	let confirmOpen = $state(false);
	let pendingDeleteId = $state<string | null>(null);
	let uploadButton = $state<HTMLButtonElement | null>(null);
	let grid = $state<HTMLDivElement | null>(null);
	let focusAfterDelete: number | null = null;

	function requestDelete(photoId: string) {
		pendingDeleteId = photoId;
		confirmOpen = true;
	}

	async function performDelete() {
		if (demo || !pendingDeleteId) return;
		const photoId = pendingDeleteId;
		try {
			await expenseApi.deletePhoto(entityType, entityId, photoId);
			const index = photos.findIndex(p => p.id === photoId);
			photos = photos.filter(p => p.id !== photoId);
			focusAfterDelete = Math.min(index, photos.length - 1);
		} catch (err) {
			handleErrorWithNotification(err, "Couldn't delete the photo");
			throw err;
		}
	}

	function handleCloseAutoFocus(event: Event) {
		if (focusAfterDelete === null) return;
		const index = focusAfterDelete;
		focusAfterDelete = null;
		event.preventDefault();
		if (index >= 0) focusFirstButton(grid?.children[index]);
		else uploadButton?.focus();
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-medium text-foreground">Photos & receipts</h2>
		<Button
			bind:ref={uploadButton}
			variant="outline"
			size="sm"
			class="h-10 text-xs"
			onclick={openUploadDialog}
			disabled={demo}
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
		<div bind:this={grid} class="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
						class="absolute inset-x-0 bottom-0 flex items-center justify-end bg-gradient-to-t from-black/60 to-transparent p-2 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
					>
						<Button
							variant="outline"
							size="sm"
							class="size-10 bg-background text-xs hover:bg-sunk dark:bg-background dark:hover:bg-accent"
							aria-label="Delete {photo.fileName}"
							onclick={() => requestDelete(photo.id)}
							disabled={demo}
						>
							<Trash2 class="h-3 w-3 text-destructive" />
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if mediaDialog}
	{#await mediaDialog then { default: MediaCaptureDialog }}
		<MediaCaptureDialog
			bind:open={showUploadDialog}
			title="Upload photos & receipts"
			description="Add photos or receipt images for this {ENTITY_NOUN[entityType]}"
			acceptedTypes={['image/jpeg', 'image/png', 'image/webp', 'application/pdf']}
			onUpload={file => expenseApi.uploadPhoto(entityType, entityId, file)}
			onUploadComplete={handleUploadComplete}
			onClose={() => (showUploadDialog = false)}
		/>
	{:catch}

	{/await}
{/if}

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete photo?"
	description="This permanently removes the photo from storage and cannot be undone."
	onConfirm={performDelete}
	onCloseAutoFocus={handleCloseAutoFocus}
/>
