<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import type { Vehicle } from '#lib/types/index.ts';
	import type { DistanceUnit } from '#lib/types/settings.ts';
	import { formatNumber } from '#lib/utils/formatters.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { vehicleKindIcon, vehicleKindNote } from '#lib/utils/vehicle-kind.ts';

	interface Props {
		vehicle: Vehicle;
		displayName: string;
		coverPhotoUrl?: string | null;
		odometer?: number | null;
		odometerLoading?: boolean;
		distanceUnit?: DistanceUnit;
	}

	let {
		vehicle,
		displayName,
		coverPhotoUrl = null,
		odometer = null,
		odometerLoading = false,
		distanceUnit = 'miles'
	}: Props = $props();

	let KindIcon = $derived(vehicleKindIcon(vehicle.vehicleKind));
	let kindNote = $derived(vehicleKindNote(vehicle.vehicleKind));
</script>

{#snippet description()}
	<span class="block sm:flex sm:min-w-0 sm:gap-1">
		<span class="block truncate">
			{kindNote ? `${kindNote} · ` : ''}{vehicle.year}
			{vehicle.make}
			{vehicle.model}
		</span>
		{#if vehicle.licensePlate || odometerLoading || odometer !== null}
			<span class="shrink-0 max-sm:hidden" aria-hidden="true">·</span>
		{/if}
		<span class="block min-h-6 truncate sm:min-h-0 sm:shrink-0">
			{#if vehicle.licensePlate}
				<span
					class="whitespace-nowrap rounded-full px-2 py-px text-xs font-semibold ring-1 ring-inset ring-border-strong"
				>
					{vehicle.licensePlate}
				</span>
			{/if}
			{#if vehicle.licensePlate && (odometerLoading || odometer !== null)}
				<span aria-hidden="true">·</span>
			{/if}
			{#if odometerLoading}
				<Skeleton class="inline-block h-4 w-16 align-middle" />
			{:else if odometer !== null}
				<span class="whitespace-nowrap">
					{formatNumber(odometer, 0)}
					{getDistanceUnitLabel(distanceUnit, true)}
				</span>
			{/if}
		</span>
	</span>
{/snippet}

<PageHeader title={displayName} {description}>
	{#snippet back()}
		<Button
			variant="outline"
			size="icon-lg"
			class="shrink-0 sm:size-9"
			onclick={() => goto(resolve(routes.vehicles))}
			aria-label="Back to garage"
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
				<KindIcon class="h-6 w-6 text-muted-foreground" />
			</div>
		{/if}
	{/snippet}
</PageHeader>
