<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { ArrowLeft, Car } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import type { Vehicle } from '#lib/types/index.ts';

	interface Props {
		vehicle: Vehicle;
		displayName: string;
		coverPhotoUrl?: string | null;
	}

	let { vehicle, displayName, coverPhotoUrl = null }: Props = $props();
</script>

<PageHeader title={displayName} description="{vehicle.year} {vehicle.make} {vehicle.model}">
	{#snippet back()}
		<Button
			variant="outline"
			size="icon-lg"
			class="shrink-0 sm:size-9"
			onclick={() => goto(resolve(routes.dashboard))}
			aria-label="Back to dashboard"
		>
			<ArrowLeft class="h-4 w-4" />
		</Button>
		{#if coverPhotoUrl}
			<img
				src={coverPhotoUrl}
				alt="{vehicle.year} {vehicle.make} {vehicle.model}"
				class="h-12 w-12 shrink-0 rounded-lg object-cover"
			/>
		{:else}
			<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
				<Car class="h-6 w-6 text-muted-foreground" />
			</div>
		{/if}
	{/snippet}
</PageHeader>
