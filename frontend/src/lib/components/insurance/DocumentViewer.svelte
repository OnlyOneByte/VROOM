<script lang="ts">
	import { onMount } from 'svelte';
	import { Upload, Trash2, FileText, Download, LoaderCircle, ImagePlus } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import MediaCaptureDialog from '#lib/components/common/MediaCaptureDialog.svelte';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { insuranceApi } from '#lib/services/insurance-api.ts';
	import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';
	import type { Photo } from '#lib/types/index.ts';

	const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
	const ALLOWED_TYPES = [...IMAGE_TYPES, 'application/pdf'];

	interface Props {
		entityId: string;
		entityType?: string;
		readOnly?: boolean;
		level?: 4 | 5 | 6;
		compact?: boolean;
		count?: number | null;
		uploadOpen?: boolean;
	}

	let {
		entityId,
		entityType = 'insurance_policy',
		readOnly = false,
		level = 4,
		compact = false,
		count = $bindable(null),
		uploadOpen = $bindable(false)
	}: Props = $props();

	let documents = $state<Photo[]>([]);
	let isLoading = $state(true);
	let loadFailed = $state(false);

	$effect(() => {
		count = isLoading || loadFailed ? null : documents.length;
	});

	onMount(async () => {
		await loadDocuments();
	});

	async function loadDocuments() {
		isLoading = true;
		try {
			const docsResult = await insuranceApi.getEntityDocuments(entityType, entityId);
			documents = docsResult.data;
			loadFailed = false;
		} catch (err) {
			loadFailed = true;
			handleErrorWithNotification(err, "Couldn't load the documents");
		} finally {
			isLoading = false;
		}
	}

	function retryDocuments() {
		if (!isLoading) loadDocuments();
	}

	function isImage(mimeType: string): boolean {
		return IMAGE_TYPES.includes(mimeType);
	}

	function handleUploadComplete(result: unknown) {
		documents = [...documents, result as Photo];
	}

	let confirmOpen = $state(false);
	let pendingDeleteId = $state<string | null>(null);

	function requestDelete(docId: string) {
		pendingDeleteId = docId;
		confirmOpen = true;
	}

	async function performDelete() {
		if (!pendingDeleteId) return;
		const docId = pendingDeleteId;
		try {
			await insuranceApi.deleteEntityDocument(entityType, entityId, docId);
			documents = documents.filter(d => d.id !== docId);
		} catch (err) {
			handleErrorWithNotification(err, "Couldn't delete the document");
			throw err;
		}
	}
</script>

{#if compact}
	{#if loadFailed}
		<div class="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
			<p class="text-xs text-destructive">Couldn't load the documents.</p>
			<Button
				variant="outline"
				size="sm"
				class="mt-2 h-10 sm:h-8"
				aria-disabled={isLoading}
				onclick={retryDocuments}
			>
				{#if isLoading}
					<LoaderCircle class="animate-spin" />
				{/if}
				Retry
			</Button>
		</div>
	{:else if !isLoading && documents.length > 0}
		<div class="mt-3 space-y-3">
			<svelte:element this={`h${level}`} class="text-sm font-medium text-foreground">
				Documents
			</svelte:element>
			{@render documentGrid()}
		</div>
	{/if}
{:else}
	<div class="space-y-3">
		<div class="flex items-center justify-between">
			<svelte:element this={`h${level}`} class="text-sm font-medium text-foreground">
				Documents
			</svelte:element>
			{#if !readOnly}
				<Button variant="outline" size="sm" class="h-10 sm:h-8" onclick={() => (uploadOpen = true)}>
					<Upload />
					Upload
				</Button>
			{/if}
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
			{@render documentGrid()}
		{/if}
	</div>
{/if}

{#snippet documentGrid()}
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
		{#each documents as doc (doc.id)}
			<div class="group relative overflow-hidden rounded-md border border-border bg-muted/50">
				{#if isImage(doc.mimeType)}
					<img
						src={insuranceApi.getEntityDocumentThumbnailUrl(entityType, entityId, doc.id)}
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
						<!-- eslint-disable svelte/no-navigation-without-resolve -- API endpoint URL, not an app route -->
						<a
							href={insuranceApi.getEntityDocumentThumbnailUrl(entityType, entityId, doc.id)}
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
						>
							<Download class="h-3 w-3" />
							Download
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</div>
				{/if}
				{#if !readOnly}
					<div
						class="absolute right-0 top-0 p-1.5 motion-safe:transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
					>
						<Button
							variant="secondary"
							size="icon-lg"
							class="pointer-fine:size-7 focus-visible:ring-ring dark:focus-visible:ring-ring"
							aria-label={`Delete ${doc.fileName}`}
							onclick={() => requestDelete(doc.id)}
						>
							<Trash2 class="h-4 w-4" />
						</Button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/snippet}

<MediaCaptureDialog
	bind:open={uploadOpen}
	title="Upload Documents"
	description="Upload or capture insurance documents (JPEG, PNG, WebP, PDF up to 10MB)"
	acceptedTypes={ALLOWED_TYPES}
	onUpload={file => insuranceApi.uploadEntityDocument(entityType, entityId, file)}
	onUploadComplete={handleUploadComplete}
	onClose={() => (uploadOpen = false)}
/>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete document?"
	description="This permanently removes the document from storage and cannot be undone."
	onConfirm={performDelete}
/>
