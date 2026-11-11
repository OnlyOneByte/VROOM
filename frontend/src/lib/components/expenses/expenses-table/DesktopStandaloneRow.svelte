<script lang="ts">
	import { Car, Pencil, Trash2 } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { TableCell, TableRow } from '$lib/components/ui/table';
	import RecurringExpenseBadge from '../RecurringExpenseBadge.svelte';
	import type { Expense, Vehicle } from '$lib/types';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import {
		categoryLabels,
		getCategoryBadgeClasses,
		getCategoryIcon
	} from '$lib/utils/expense-helpers';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { expenseEditHref } from './expense-table-actions';

	interface Props {
		expense: Expense;
		vehicleMap: ReadonlyMap<string, Vehicle>;
		showVehicleColumn: boolean;
		canWrite: boolean;
		canDelete: boolean;
		returnTo: string;
		onDelete: (_expense: Expense) => void;
	}

	let { expense, vehicleMap, showVehicleColumn, canWrite, canDelete, returnTo, onDelete }: Props =
		$props();

	let vehicle: Vehicle | undefined = $derived(vehicleMap.get(expense.vehicleId));
	let IconComponent = $derived(getCategoryIcon(expense.category));
</script>

<TableRow class="group">
	<TableCell class="font-medium text-muted-foreground">
		{formatDate(new Date(expense.date))}
	</TableCell>
	{#if showVehicleColumn}
		<TableCell>
			<div class="flex items-center gap-2">
				<Car class="h-4 w-4 text-muted-foreground flex-shrink-0" />
				<span class="truncate">
					{vehicle ? getVehicleDisplayName(vehicle) : 'Unknown'}
				</span>
			</div>
		</TableCell>
	{/if}
	<TableCell>
		<div class="flex items-center gap-2">
			<div class="p-1.5 rounded-lg {getCategoryBadgeClasses(expense.category)} flex-shrink-0">
				<IconComponent class="h-4 w-4" />
			</div>
			<span class="whitespace-nowrap">{categoryLabels[expense.category]}</span>
			{#if expense.sourceType === 'reminder'}
				<RecurringExpenseBadge />
			{/if}
		</div>
	</TableCell>
	<TableCell>
		<div class="flex flex-wrap gap-1">
			{#each expense.tags || [] as tag (tag)}
				<Badge variant="secondary" class="font-normal">{tag}</Badge>
			{/each}
		</div>
	</TableCell>
	<TableCell class="max-w-[200px]">
		<div class="truncate text-foreground">{expense.description || '-'}</div>
		{#if expense.location}
			<div class="truncate text-xs text-muted-foreground" title={expense.location}>
				📍 {expense.location}
			</div>
		{/if}
	</TableCell>
	<TableCell class="text-right font-semibold whitespace-nowrap">
		{formatCurrency(expense.amount)}
	</TableCell>
	<TableCell class="text-right">
		<!-- Focus variant is required: opacity-0 keeps these controls in the tab order. -->
		<div
			class="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
		>
			{#if canWrite}
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8"
					href={expenseEditHref(expense.id, returnTo)}
					aria-label="Edit expense"
					title="Edit expense"
				>
					<Pencil class="h-4 w-4" />
				</Button>
			{/if}
			{#if canDelete}
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
					onclick={() => onDelete(expense)}
					aria-label="Delete expense"
					title="Delete expense"
				>
					<Trash2 class="h-4 w-4" />
				</Button>
			{/if}
		</div>
	</TableCell>
</TableRow>
