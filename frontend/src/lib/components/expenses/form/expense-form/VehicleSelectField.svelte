<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
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

	const ariaDescribedBy = $derived(
		[error ? 'vehicleId-error' : undefined, describedBy].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="space-y-2">
	<Label for="vehicle">Vehicle *</Label>
	<div class="flex gap-2">
		<Select.Root
			type="single"
			{value}
			onValueChange={v => {
				if (v) onSelect(v);
			}}
		>
			<Select.Trigger
				id="vehicle"
				class="w-full min-w-0 data-[size=default]:h-10 {error ? 'border-destructive' : ''}"
				aria-invalid={!!error}
				aria-describedby={ariaDescribedBy}
			>
				{#if value}
					{@const selectedVehicle = vehicles.find(v => v.id === value)}
					{#if selectedVehicle}
						<span class="truncate">
							{selectedVehicle.year}
							{selectedVehicle.make}
							{selectedVehicle.model}
							{#if selectedVehicle.nickname}({selectedVehicle.nickname}){/if}
						</span>
					{:else}
						Select a vehicle
					{/if}
				{:else}
					Select a vehicle
				{/if}
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
				class="shrink-0"
				onclick={onSplit}
				aria-label="Split cost across vehicles"
			>
				<GitBranch class="h-4 w-4" />
			</Button>
		{/if}
	</div>
	{#if error}
		<FormFieldError id="vehicleId-error">{error}</FormFieldError>
	{/if}
</div>
