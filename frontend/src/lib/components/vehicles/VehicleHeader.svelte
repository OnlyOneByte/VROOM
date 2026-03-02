<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, Car } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import type { Vehicle } from '$lib/types';

	interface Props {
		vehicle: Vehicle;
		displayName: string;
		coverPhotoUrl?: string | null;
	}

	let { vehicle, displayName, coverPhotoUrl = null }: Props = $props();
</script>

<div class="flex items-center gap-4">
	<Button
		variant="outline"
		size="icon"
		onclick={() => goto('/dashboard')}
		aria-label="Back to dashboard"
	>
		<ArrowLeft class="h-4 w-4" />
	</Button>
	{#if coverPhotoUrl}
		<img
			src={coverPhotoUrl}
			alt="{vehicle.year} {vehicle.make} {vehicle.model}"
			class="h-12 w-12 rounded-lg object-cover"
		/>
	{:else}
		<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
			<Car class="h-6 w-6 text-muted-foreground" />
		</div>
	{/if}
	<div>
		<h1 class="text-2xl font-bold text-foreground">{displayName}</h1>
		<p class="text-muted-foreground">{vehicle.year} {vehicle.make} {vehicle.model}</p>
	</div>
</div>
