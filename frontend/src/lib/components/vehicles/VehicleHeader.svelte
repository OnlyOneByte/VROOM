<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import type { Vehicle } from '$lib/types';

	interface Props {
		vehicle: Vehicle;
		displayName: string;
	}

	let { vehicle, displayName }: Props = $props();
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
	<div>
		<h1 class="text-2xl font-bold text-gray-900">{displayName}</h1>
		<p class="text-gray-600">{vehicle.year} {vehicle.make} {vehicle.model}</p>
	</div>
</div>
