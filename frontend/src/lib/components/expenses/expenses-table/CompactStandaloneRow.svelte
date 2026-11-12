<script lang="ts">
	import { Pencil, Trash2 } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
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
	import {
		MOBILE_ROW_ACTION_CLASS,
		MOBILE_ROW_ACTIONS_CONTAINER_CLASS,
		MOBILE_ROW_SUMMARY_CLASS
	} from './compact-row-classes';

	interface Props {
		expense: Expense;
		vehicleMap: ReadonlyMap<string, Vehicle>;
		showVehicleColumn: boolean;
		canWrite: boolean;
		canDelete: boolean;
		returnTo: string;
		isSelected: boolean;
		onSelect: (_id: string) => void;
		onDelete: (_expense: Expense) => void;
	}

	let {
		expense,
		vehicleMap,
		showVehicleColumn,
		canWrite,
		canDelete,
		returnTo,
		isSelected,
		onSelect,
		onDelete
	}: Props = $props();

	let vehicle: Vehicle | undefined = $derived(vehicleMap.get(expense.vehicleId));
	let IconComponent = $derived(getCategoryIcon(expense.category));
</script>

{#snippet summary()}
	<div class="mt-0.5 p-1.5 rounded-lg {getCategoryBadgeClasses(expense.category)} flex-shrink-0">
		<IconComponent class="h-4 w-4" />
	</div>
	<div class="flex-1 min-w-0">
		<div class="flex items-start justify-between gap-2">
			<p class="text-sm font-medium text-foreground truncate">
				{categoryLabels[expense.category]}
			</p>
			<span class="text-sm font-semibold text-foreground whitespace-nowrap">
				{formatCurrency(expense.amount)}
			</span>
		</div>
		<div class="flex items-center flex-wrap gap-1.5 mt-0.5 text-xs text-muted-foreground">
			<span>{formatDate(new Date(expense.date))}</span>
			{#if showVehicleColumn && vehicle}
				<span>·</span>
				<span class="truncate">{getVehicleDisplayName(vehicle)}</span>
			{/if}
		</div>
		{#if expense.sourceType === 'reminder'}
			<div class="mt-1.5">
				<RecurringExpenseBadge />
			</div>
		{/if}
		{#if expense.tags && expense.tags.length > 0}
			<div class="flex flex-wrap gap-1 mt-1.5">
				{#each expense.tags as tag (tag)}
					<Badge variant="secondary" class="font-normal text-xs px-1.5 py-0">{tag}</Badge>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<div class="transition-colors {isSelected ? 'bg-muted/50' : ''}">
	{#if canWrite}
		<!-- A button cannot contain interactive content, so actions sit beside the summary, not inside it. -->
		<button
			type="button"
			class="{MOBILE_ROW_SUMMARY_CLASS} cursor-pointer"
			aria-expanded={isSelected}
			onclick={() => onSelect(expense.id)}
		>
			{@render summary()}
		</button>
	{:else}
		<div class={MOBILE_ROW_SUMMARY_CLASS}>
			{@render summary()}
		</div>
	{/if}
	{#if isSelected && canWrite}
		<div class={MOBILE_ROW_ACTIONS_CONTAINER_CLASS}>
			<Button
				variant="ghost"
				size="sm"
				class={MOBILE_ROW_ACTION_CLASS}
				href={expenseEditHref(expense.id, returnTo)}
			>
				<Pencil class="h-3.5 w-3.5 mr-1" />
				Edit
			</Button>
			{#if canDelete}
				<Button
					variant="ghost"
					size="sm"
					class="{MOBILE_ROW_ACTION_CLASS} text-destructive hover:text-destructive hover:bg-destructive/10"
					onclick={() => onDelete(expense)}
				>
					<Trash2 class="h-3.5 w-3.5 mr-1" />
					Delete
				</Button>
			{/if}
		</div>
	{/if}
</div>
