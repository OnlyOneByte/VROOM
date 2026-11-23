<script lang="ts" module>
	export const NO_VEHICLES_TITLE = 'Add a vehicle first';

	export function addVehicleFirstTo(action: string): string {
		return `${NO_VEHICLES_TITLE} to ${action}.`;
	}
</script>

<script lang="ts">
	import { Car, Plus } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { routes } from '#lib/routes.ts';

	interface Props {
		description: string;
		level?: 2 | 3 | 4;
	}

	let { description: text, level }: Props = $props();
</script>

<EmptyState {level}>
	{#snippet icon()}
		<Car class="mb-4 h-12 w-12 text-muted-foreground" />
	{/snippet}
	{#snippet title()}
		{NO_VEHICLES_TITLE}
	{/snippet}
	{#snippet description()}
		{text}
	{/snippet}
	{#snippet action()}
		<Button size="lg" href={resolve(routes.vehicleNew)}>
			<Plus class="mr-2 h-4 w-4" />
			Add Vehicle
		</Button>
	{/snippet}
</EmptyState>
