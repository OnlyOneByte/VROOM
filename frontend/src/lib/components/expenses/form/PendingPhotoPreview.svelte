<script lang="ts">
	import { X, Upload, ImagePlus } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';

	interface Props {
		files: File[];
		onAdd: (_file: File) => void;
		onRemove: (_index: number) => void;
		entityNoun?: string;
	}

	let { files, onAdd, onRemove, entityNoun = 'expense' }: Props = $props();

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

	let previews = $derived(
		files.map(f => ({
			name: f.name,
			size: f.size,
			isImage: f.type.startsWith('image/'),
			url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null
		}))
	);

	$effect(() => {
		const urls = previews.map(p => p.url).filter(Boolean) as string[];
		return () => {
			for (const url of urls) {
				URL.revokeObjectURL(url);
			}
		};
	});
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-medium text-foreground">Photos & receipts</h2>
		<Button variant="outline" size="sm" class="h-10 text-xs" onclick={openUploadDialog}>
			<Upload class="mr-1 h-3 w-3" />
			Add
		</Button>
	</div>

	{#if files.length === 0}
		<div class="flex flex-col items-center py-4 text-center">
			<ImagePlus class="mb-2 h-6 w-6 text-muted-foreground" />
			<p class="text-xs text-muted-foreground">
				Add photos or receipts. They'll upload when you save.
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-3 gap-2">
			{#each previews as preview, i (preview.name + i)}
				<div class="group relative overflow-hidden rounded-lg border border-border bg-muted">
					{#if preview.isImage && preview.url}
						<img src={preview.url} alt={preview.name} class="aspect-square w-full object-cover" />
					{:else}
						<div class="flex aspect-square items-center justify-center">
							<div class="text-center px-1">
								<ImagePlus class="mx-auto h-6 w-6 text-muted-foreground" />
								<p class="mt-1 truncate text-xs text-muted-foreground">{preview.name}</p>
							</div>
						</div>
					{/if}
					<button
						type="button"
						onclick={() => onRemove(i)}
						class="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-muted-foreground opacity-100 transition-opacity hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 after:absolute after:-top-1 after:-right-1 after:-bottom-4 after:-left-4 after:content-['']"
						aria-label="Remove {preview.name}"
					>
						<X class="h-3 w-3" />
					</button>
				</div>
			{/each}
		</div>
		<p class="text-xs text-muted-foreground">
			{files.length} file{files.length !== 1 ? 's' : ''} queued. Will upload on save.
		</p>
	{/if}
</div>

{#if mediaDialog}
	{#await mediaDialog then { default: MediaCaptureDialog }}
		<MediaCaptureDialog
			bind:open={showUploadDialog}
			title="Add photos & receipts"
			description="Select photos or receipts to attach to this {entityNoun}"
			acceptedTypes={['image/jpeg', 'image/png', 'image/webp', 'application/pdf']}
			onUpload={async file => {
				onAdd(file);
				return file;
			}}
			onClose={() => (showUploadDialog = false)}
		/>
	{:catch}

	{/await}
{/if}
