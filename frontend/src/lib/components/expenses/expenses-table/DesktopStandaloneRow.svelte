<script lang="ts">
	import { Car, MapPin, Pencil, Trash2 } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { TableCell, TableRow } from '#lib/components/ui/table/index.ts';
	import RecurringExpenseBadge from '../RecurringExpenseBadge.svelte';
	import type { Expense, Vehicle } from '#lib/types/index.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import {
		categoryLabels,
		getCategoryBadgeClasses,
		getCategoryIcon
	} from '#lib/utils/expense-helpers.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { expenseEditHref } from './expense-table-actions';
	import { rowTitle, tagsBesideCategory } from './expense-table-rows';
	import PendingSyncNote from './PendingSyncNote.svelte';
	import type { PendingRowState } from '#lib/utils/sync/pending-rows.ts';

	interface Props {
		expense: Expense;
		vehicleMap: ReadonlyMap<string, Vehicle>;
		showVehicleColumn: boolean;
		canWrite: boolean;
		canDelete: boolean;
		returnTo: string;
		onDelete: (_expense: Expense) => void;
		pending?: PendingRowState | undefined;
	}

	let {
		expense,
		vehicleMap,
		showVehicleColumn,
		canWrite,
		canDelete,
		returnTo,
		onDelete,
		pending
	}: Props = $props();
	let shownTags = $derived(tagsBesideCategory(expense.tags, expense.category));

	let vehicle: Vehicle | undefined = $derived(vehicleMap.get(expense.vehicleId));
	let IconComponent = $derived(getCategoryIcon(expense.category));
	let heading = $derived(rowTitle(expense.description, expense.category));
</script>

<TableRow class="group {pending ? 'motion-safe:animate-[row-arrive_200ms_ease-out]' : ''}">
	<TableCell class="max-w-[240px]">
		<div class="truncate font-medium text-foreground" title={heading.title}>{heading.title}</div>
		{#if expense.location}
			<div
				class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
				title={expense.location}
			>
				<MapPin class="h-3 w-3 shrink-0" aria-hidden="true" />
				<span class="truncate">{expense.location}</span>
			</div>
		{/if}
		{#if pending}
			<div class="mt-1">
				<PendingSyncNote
					{pending}
					entryId={expense.id}
					{returnTo}
					label="{formatCurrency(expense.amount)} {heading.title}"
				/>
			</div>
		{/if}
	</TableCell>
	<TableCell class="whitespace-nowrap text-muted-foreground">
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
			{#each shownTags as tag (tag)}
				<Badge variant="secondary" class="font-normal">{tag}</Badge>
			{/each}
		</div>
	</TableCell>
	<TableCell class="text-right font-semibold whitespace-nowrap">
		{formatCurrency(expense.amount)}
	</TableCell>
	<TableCell class="text-right">
		<!-- opacity-0 keeps these controls in the tab order, so they must reveal on focus. -->
		<div
			class="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
		>
			{#if canWrite && !pending}
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
			{#if canDelete && !pending}
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
