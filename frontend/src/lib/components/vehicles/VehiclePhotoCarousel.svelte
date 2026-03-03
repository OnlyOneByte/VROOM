<script lang="ts">
	import { Star, Trash2, Upload, ImagePlus } from 'lucide-svelte';
	import * as Carousel from '$lib/components/ui/carousel';
	import type { CarouselAPI } from '$lib/components/ui/carousel/context';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
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
	let carouselApi = $state<CarouselAPI | undefined>(undefined);
	let currentIndex = $derived(carouselApi?.selectedScrollSnap() ?? 0);

	function handleApiSet(api: CarouselAPI | undefined) {
		carouselApi = api;
		if (!api) return;
		api.on('select', () => {
			// Trigger reactivity by reassigning
			carouselApi = api;
		});
	}
</script>

<Card.Root>
	<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-3">
		<Card.Title class="text-lg font-semibold">Photos</Card.Title>
		<Button variant="outline" size="sm" onclick={onUpload}>
			<Upload class="mr-2 h-4 w-4" />
			Upload
		</Button>
	</Card.Header>
	<Card.Content>
		{#if hasPhotos}
			<Carousel.Root class="w-full" opts={{ loop: photos.length > 1 }} setApi={handleApiSet}>
				<Carousel.Content>
					{#each photos as photo, i (photo.id)}
						<Carousel.Item>
							<div class="group relative overflow-hidden rounded-lg border border-border bg-muted">
								<img
									src={vehicleApi.getPhotoThumbnailUrl(vehicleId, photo.id)}
									alt={photo.fileName}
									loading={i === 0 ? 'eager' : 'lazy'}
									class="aspect-video w-full object-cover"
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
						</Carousel.Item>
					{/each}
				</Carousel.Content>

				{#if photos.length > 1}
					<Carousel.Previous
						class="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
					/>
					<Carousel.Next
						class="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
					/>
				{/if}
			</Carousel.Root>

			{#if photos.length > 1}
				<div class="mt-2 flex items-center justify-center gap-1.5">
					{#each photos as photo, i (photo.id)}
						<button
							class="h-1.5 rounded-full transition-all {i === currentIndex
								? 'w-4 bg-foreground'
								: 'w-1.5 bg-muted-foreground/30'}"
							aria-label="Go to photo {i + 1}"
							onclick={() => carouselApi?.scrollTo(i)}
						></button>
					{/each}
				</div>
			{/if}

			<p class="mt-2 text-center text-xs text-muted-foreground">
				{currentIndex + 1} of {photos.length} photo{photos.length !== 1 ? 's' : ''}
			</p>
		{:else}
			<div class="flex flex-col items-center justify-center py-8 text-center">
				<div class="mb-3 rounded-full bg-muted p-3">
					<ImagePlus class="h-6 w-6 text-muted-foreground" />
				</div>
				<p class="text-sm text-muted-foreground">No photos yet</p>
				<Button variant="outline" size="sm" class="mt-3" onclick={onUpload}>
					<Upload class="mr-2 h-4 w-4" />
					Upload Photos
				</Button>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
