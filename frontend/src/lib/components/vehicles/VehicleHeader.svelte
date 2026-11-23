<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { ArrowLeft, Car } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import type { Vehicle } from '#lib/types/index.ts';
	import type { DistanceUnit } from '#lib/types/settings.ts';
	import { formatNumber } from '#lib/utils/formatters.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';

	interface Props {
		vehicle: Vehicle;
		displayName: string;
		coverPhotoUrl?: string | null;
		odometer?: number | null;
		distanceUnit?: DistanceUnit;
	}

	let {
		vehicle,
		displayName,
		coverPhotoUrl = null,
		odometer = null,
		distanceUnit = 'miles'
	}: Props = $props();

	let description = $derived(
		[
			`${vehicle.year} ${vehicle.make} ${vehicle.model}`,
			odometer !== null
				? `${formatNumber(odometer, 0)} ${getDistanceUnitLabel(distanceUnit, true)}`
				: null,
			vehicle.licensePlate || null
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<PageHeader title={displayName} {description}>
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
				class="hidden h-12 w-12 shrink-0 rounded-lg object-cover sm:block"
			/>
		{:else}
			<div
				class="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted sm:flex"
			>
				<Car class="h-6 w-6 text-muted-foreground" />
			</div>
		{/if}
	{/snippet}
</PageHeader>
