<script module lang="ts">
	import {
		amountStep,
		formatCurrency,
		formatNumber,
		fromMinor,
		toMinor
	} from '#lib/utils/formatters.ts';

	interface Allocation {
		vehicleId: string;
		amount?: number;
		percentage?: number;
	}

	export function splitPercentageBasisPoints(allocations: Allocation[]): number {
		return Math.round(allocations.reduce((sum, a) => sum + (a.percentage ?? 0), 0) * 100);
	}

	export function splitPercentagesTotal100(allocations: Allocation[]): boolean {
		return splitPercentageBasisPoints(allocations) === 10_000;
	}

	export function splitAmountsMatchTotal(allocations: Allocation[], totalAmount: number): boolean {
		const sum = allocations.reduce((s, a) => s + (a.amount ?? 0), 0);
		return toMinor(sum) === toMinor(totalAmount);
	}
</script>

<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import type { Vehicle } from '#lib/types/index.ts';

	type SplitMethod = 'even' | 'absolute' | 'percentage';

	interface Props {
		vehicles: Vehicle[];
		totalAmount: number;
		splitMethod: SplitMethod;
		allocations: Allocation[];
		onMethodChange?: (_method: SplitMethod) => void;
		onAllocationsChange?: (_allocations: Allocation[]) => void;
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
		const total = toMinor(totalAmount);
		const base = Math.floor(total / count);
		const remainder = total - base * count;
		return vehicles.map((v, i) => ({
			vehicleId: v.id,
			amount: fromMinor(base + (i < remainder ? 1 : 0))
		}));
	});

	let absoluteSum = $derived(allocations.reduce((sum, a) => sum + (a.amount ?? 0), 0));
	let percentageSumBasisPoints = $derived(splitPercentageBasisPoints(allocations));
	let percentageSumLabel = $derived(`${formatNumber(percentageSumBasisPoints / 100, 2)}%`);

	let absoluteError = $derived(
		splitMethod === 'absolute' && !splitAmountsMatchTotal(allocations, totalAmount)
			? `Sum (${formatCurrency(absoluteSum)}) must equal total (${formatCurrency(totalAmount)})`
			: undefined
	);

	let percentageError = $derived(
		splitMethod === 'percentage' && !splitPercentagesTotal100(allocations)
			? `Sum (${percentageSumLabel}) must equal 100%`
			: undefined
	);

	function updateAllocation(vehicleId: string, field: 'amount' | 'percentage', value: number) {
		const updated = allocations.map(a =>
			a.vehicleId === vehicleId ? { ...a, [field]: value } : a
		);
		onAllocationsChange?.(updated);
	}

	const methods: { value: SplitMethod; label: string }[] = [
		{ value: 'even', label: 'Even' },
		{ value: 'absolute', label: 'Fixed $' },
		{ value: 'percentage', label: '%' }
	];
</script>

<div class="space-y-3">
	{#if onMethodChange}
		<div class="flex gap-2 rounded-lg border border-input p-0.5">
			{#each methods as m (m.value)}
				<Button
					type="button"
					variant={splitMethod === m.value ? 'default' : 'ghost'}
					size="sm"
					class="h-10 flex-1 rounded-md text-xs {splitMethod === m.value
						? ''
						: 'text-muted-foreground'}"
					onclick={() => onMethodChange(m.value)}
				>
					{m.label}
				</Button>
			{/each}
		</div>
	{/if}

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
							step={amountStep()}
							min="0"
							value={alloc?.amount?.toString() ?? ''}
							oninput={e => {
								const target = e.currentTarget as HTMLInputElement;
								updateAllocation(vehicle.id, 'amount', parseFloat(target.value) || 0);
							}}
							class="text-sm {absoluteError ? 'border-destructive' : ''}"
							aria-label="Amount for {vehicleLabel(vehicle)}"
						/>
					</div>
				{:else if splitMethod === 'percentage'}
					{@const alloc = allocations.find(a => a.vehicleId === vehicle.id)}
					<div class="flex w-24 items-center gap-1">
						<Input
							type="number"
							step={0.01}
							min="0"
							max="100"
							value={alloc?.percentage?.toString() ?? ''}
							oninput={e => {
								const target = e.currentTarget as HTMLInputElement;
								updateAllocation(vehicle.id, 'percentage', parseFloat(target.value) || 0);
							}}
							class="text-sm {percentageError ? 'border-destructive' : ''}"
							aria-label="Percentage for {vehicleLabel(vehicle)}"
						/>
						<span class="text-xs text-muted-foreground">%</span>
					</div>
				{/if}
			</div>
		{/each}
	</div>

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
				{percentageSumLabel} / 100%
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
