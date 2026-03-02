<script lang="ts">
	import { Upload, Star, Trash2, ImagePlus } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import type { Photo } from '$lib/types';

	interface Props {
		vehicleId: string;
		photos: Photo[];
		onUpload: () => void;
		onDelete: (_photoId: string) => void;
		onSetCover: (_photoId: string) => void;
	}

	let { vehicleId, photos, onUpload, onDelete, onSetCover }: Props = $props();

	let hasPhotos = $derived(photos.length > 0);
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h3 class="text-lg font-semibold text-foreground">Photos</h3>
		<Button variant="outline" size="sm" onclick={onUpload}>
			<Upload class="mr-2 h-4 w-4" />
			Upload Photos
		</Button>
	</div>

	{#if hasPhotos}
		<div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
			{#each photos as photo (photo.id)}
				<div class="group relative overflow-hidden rounded-lg border border-border bg-muted">
					<img
						src={vehicleApi.getPhotoThumbnailUrl(vehicleId, photo.id)}
						alt={photo.fileName}
						loading="lazy"
						class="aspect-square w-full object-cover"
					/>

					{#if photo.isCover}
						<div class="absolute left-2 top-2">
							<Badge variant="secondary" class="bg-background/80 backdrop-blur-sm">
								<Star class="mr-1 h-3 w-3 fill-current" />
								Cover
							</Badge>
						</div>
					{/if}

					<div
						class="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100"
					>
						{#if !photo.isCover}
							<Button
								variant="secondary"
								size="sm"
								class="h-7 bg-background/80 text-xs backdrop-blur-sm"
								onclick={() => onSetCover(photo.id)}
							>
								<Star class="mr-1 h-3 w-3" />
								Set as cover
							</Button>
						{/if}
						<Button
							variant="destructive"
							size="sm"
							class="h-7 text-xs"
							onclick={() => onDelete(photo.id)}
						>
							<Trash2 class="h-3 w-3" />
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<EmptyState>
			{#snippet icon()}
				<div class="mb-4 rounded-full bg-muted p-4">
					<ImagePlus class="h-8 w-8 text-muted-foreground" />
				</div>
			{/snippet}
			{#snippet title()}No photos yet{/snippet}
			{#snippet description()}
				Upload photos to document your vehicle's condition and appearance.
			{/snippet}
			{#snippet action()}
				<Button variant="outline" onclick={onUpload}>
					<Upload class="mr-2 h-4 w-4" />
					Upload Photos
				</Button>
			{/snippet}
		</EmptyState>
	{/if}
</div>
