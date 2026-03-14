<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { Vehicle } from '$lib/types';

	type SplitMethod = 'even' | 'absolute' | 'percentage';
	interface Allocation {
		vehicleId: string;
		amount?: number;
		percentage?: number;
	}

	interface Props {
		vehicles: Vehicle[];
		totalAmount: number;
		splitMethod: SplitMethod;
		allocations: Allocation[];
		onMethodChange: (_method: SplitMethod) => void;
		onAllocationsChange: (_allocations: Allocation[]) => void;
	}

	let {
		vehicles,
		totalAmount,
		splitMethod,
		allocations,
		onMethodChange,
		onAllocationsChange
	}: Props = $props();

	function vehicleLabel(v: Vehicle): string {
		return v.nickname || `${v.year} ${v.make} ${v.model}`;
	}

	let evenAmounts = $derived.by(() => {
		const count = vehicles.length;
		if (count === 0) return [];
		const base = Math.floor((totalAmount / count) * 100) / 100;
		const remainder = Math.round((totalAmount - base * count) * 100) / 100;
		return vehicles.map((v, i) => ({
			vehicleId: v.id,
			amount: i === 0 ? base + remainder : base
		}));
	});

	let absoluteSum = $derived(allocations.reduce((sum, a) => sum + (a.amount ?? 0), 0));
	let percentageSum = $derived(allocations.reduce((sum, a) => sum + (a.percentage ?? 0), 0));

	let absoluteError = $derived(
		splitMethod === 'absolute' && Math.abs(absoluteSum - totalAmount) > 0.01
			? `Sum (${formatCurrency(absoluteSum)}) must equal total (${formatCurrency(totalAmount)})`
			: undefined
	);

	let percentageError = $derived(
		splitMethod === 'percentage' && Math.abs(percentageSum - 100) > 0.01
			? `Sum (${percentageSum.toFixed(1)}%) must equal 100%`
			: undefined
	);

	function updateAllocation(vehicleId: string, field: 'amount' | 'percentage', value: number) {
		const updated = allocations.map(a =>
			a.vehicleId === vehicleId ? { ...a, [field]: value } : a
		);
		onAllocationsChange(updated);
	}

	const methods: { value: SplitMethod; label: string }[] = [
		{ value: 'even', label: 'Even' },
		{ value: 'absolute', label: 'Fixed $' },
		{ value: 'percentage', label: '%' }
	];
</script>

<div class="space-y-3">
	<!-- Segmented method selector -->
	<div class="flex rounded-lg border border-input p-0.5">
		{#each methods as m (m.value)}
			<Button
				type="button"
				variant={splitMethod === m.value ? 'default' : 'ghost'}
				size="sm"
				class="flex-1 rounded-md text-xs {splitMethod === m.value ? '' : 'text-muted-foreground'}"
				onclick={() => onMethodChange(m.value)}
			>
				{m.label}
			</Button>
		{/each}
	</div>

	<!-- Vehicle allocations -->
	<div class="space-y-2">
		{#each vehicles as vehicle (vehicle.id)}
			<div class="flex items-center gap-2 text-sm">
				<span class="min-w-0 flex-1 truncate text-foreground">
					{vehicleLabel(vehicle)}
				</span>

				{#if splitMethod === 'even'}
					{@const entry = evenAmounts.find(e => e.vehicleId === vehicle.id)}
					<span class="font-medium text-muted-foreground">
						{formatCurrency(entry?.amount ?? 0)}
					</span>
				{:else if splitMethod === 'absolute'}
					{@const alloc = allocations.find(a => a.vehicleId === vehicle.id)}
					<div class="w-24">
						<Input
							type="number"
							step="0.01"
							min="0"
							value={alloc?.amount?.toString() ?? ''}
							oninput={e => {
								const target = e.currentTarget as HTMLInputElement;
								updateAllocation(vehicle.id, 'amount', parseFloat(target.value) || 0);
							}}
							class="h-8 text-sm {absoluteError ? 'border-destructive' : ''}"
							aria-label="Amount for {vehicleLabel(vehicle)}"
						/>
					</div>
				{:else if splitMethod === 'percentage'}
					{@const alloc = allocations.find(a => a.vehicleId === vehicle.id)}
					<div class="flex w-24 items-center gap-1">
						<Input
							type="number"
							step="0.1"
							min="0"
							max="100"
							value={alloc?.percentage?.toString() ?? ''}
							oninput={e => {
								const target = e.currentTarget as HTMLInputElement;
								updateAllocation(vehicle.id, 'percentage', parseFloat(target.value) || 0);
							}}
							class="h-8 text-sm {percentageError ? 'border-destructive' : ''}"
							aria-label="Percentage for {vehicleLabel(vehicle)}"
						/>
						<span class="text-xs text-muted-foreground">%</span>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Total row -->
	<div class="flex items-center justify-between border-t border-border pt-2 text-sm">
		<span class="font-medium text-foreground">Total</span>
		{#if splitMethod === 'even'}
			<span class="font-medium text-foreground">{formatCurrency(totalAmount)}</span>
		{:else if splitMethod === 'absolute'}
			<span class="font-medium {absoluteError ? 'text-destructive' : 'text-foreground'}">
				{formatCurrency(absoluteSum)} / {formatCurrency(totalAmount)}
			</span>
		{:else}
			<span class="font-medium {percentageError ? 'text-destructive' : 'text-foreground'}">
				{percentageSum.toFixed(1)}% / 100%
			</span>
		{/if}
	</div>

	{#if absoluteError}
		<p class="text-xs text-destructive">{absoluteError}</p>
	{/if}
	{#if percentageError}
		<p class="text-xs text-destructive">{percentageError}</p>
	{/if}
</div>
