<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import type { Vehicle } from '#lib/types/index.ts';

	interface Props {
		vehicles: Vehicle[];
		value: string;
		error?: string;
		describedBy?: string;
		canSplit: boolean;
		onSelect: (_vehicleId: string) => void;
		onSplit: () => void;
	}

	let { vehicles, value, error, describedBy, canSplit, onSelect, onSplit }: Props = $props();

	const selectedVehicle = $derived(vehicles.find(v => v.id === value));
	const ariaDescribedBy = $derived(
		[error ? 'vehicleId-error' : undefined, describedBy].filter(Boolean).join(' ') || undefined
	);
</script>

<Label id="vehicle-label" for="vehicle" class="sr-only">Vehicle *</Label>
<Select.Root
	type="single"
	{value}
	onValueChange={v => {
		if (v) onSelect(v);
	}}
>
	<Select.Trigger
		id="vehicle"
		aria-labelledby="vehicle-label vehicle"
		class="max-w-[14rem] min-w-0 gap-1.5 rounded-full border-primary bg-primary px-3.5 font-medium text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90 [&_svg:not([class*='text-'])]:text-primary-foreground {error
			? 'border-destructive'
			: ''}"
		aria-invalid={!!error}
		aria-describedby={ariaDescribedBy}
	>
		<span class="truncate">
			{selectedVehicle ? getVehicleDisplayName(selectedVehicle) : 'Select a vehicle'}
		</span>
	</Select.Trigger>
	<Select.Content>
		{#each vehicles as v (v.id)}
			<Select.Item value={v.id} label="{v.year} {v.make} {v.model}">
				{v.year}
				{v.make}
				{v.model}
				{#if v.nickname}({v.nickname}){/if}
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
{#if canSplit}
	<Button
		type="button"
		variant="outline"
		size="icon-lg"
		class="shrink-0 rounded-full sm:size-9"
		onclick={onSplit}
		aria-label="Split cost across vehicles"
	>
		<GitBranch class="h-4 w-4" />
	</Button>
{/if}
