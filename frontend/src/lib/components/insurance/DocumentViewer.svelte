<script lang="ts">
	import { onMount } from 'svelte';
	import { Upload, Trash2, FileText, Download, LoaderCircle, ImagePlus } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import MediaCaptureDialog from '$lib/components/shared/MediaCaptureDialog.svelte';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import type { Photo } from '$lib/types';

	const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
	const ALLOWED_TYPES = [...IMAGE_TYPES, 'application/pdf'];

	interface Props {
		policyId: string;
	}

	let { policyId }: Props = $props();

	let documents = $state<Photo[]>([]);
	let isLoading = $state(true);
	let showUploadDialog = $state(false);

	onMount(async () => {
		await loadDocuments();
	});

	async function loadDocuments() {
		isLoading = true;
		try {
			const docsResult = await insuranceApi.getDocuments(policyId);
			documents = docsResult.data;
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to load documents');
		} finally {
			isLoading = false;
		}
	}

	function isImage(mimeType: string): boolean {
		return IMAGE_TYPES.includes(mimeType);
	}

	function handleUploadComplete(result: unknown) {
		documents = [...documents, result as Photo];
	}

	async function handleDelete(docId: string) {
		try {
			await insuranceApi.deleteDocument(policyId, docId);
			documents = documents.filter(d => d.id !== docId);
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
							<p class="w-full truncate text-center text-xs text-muted-foreground">
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

<MediaCaptureDialog
	bind:open={showUploadDialog}
	title="Upload Documents"
	description="Upload or capture insurance documents (JPEG, PNG, WebP, PDF up to 10MB)"
	acceptedTypes={ALLOWED_TYPES}
	onUpload={file => insuranceApi.uploadDocument(policyId, file)}
	onUploadComplete={handleUploadComplete}
	onClose={() => (showUploadDialog = false)}
/>
